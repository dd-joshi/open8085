// I/O bus for virtual peripheral chips (8255, 8155, ...).
//
// The 8085 engine (lib/cpu8085.ts) is never modified. The bus works only through its public API:
//   beforeStep(cpu)    -> loads each chip's current input value into cpu.ports with setPort(),
//                         so an IN instruction reads what the chip drives.
//   afterStep(result)  -> hands OUT writes (result.portWrites) to the owning chip, reports IN side
//                         effects (e.g. reading 8155 status clears the TIMER bit) and advances chip
//                         clocks by result.cycles.
// If a chip throws, the bus records the fault, stops calling chips and the CPU keeps running as if
// no chip were attached.
import type { PortWrite } from "../cpu8085";

export const OPCODE_IN = 0xdb;
export const OPCODE_OUT = 0xd3;
const LOG_SIZE = 32;

export interface IoDevice {
  /** Short chip name used in logs and the UI, e.g. "8255". */
  readonly id: string;
  /** Absolute port addresses this chip answers on. */
  ports(): readonly number[];
  /** Register name for a port, e.g. "PA" or "CW". */
  portName(port: number): string;
  /** Value an IN from this port returns right now. Must not change chip state. */
  read(port: number): number;
  /** OUT to this port. */
  write(port: number, value: number): void;
  /** Side effect after an IN from this port has completed. */
  afterRead?(port: number): void;
  /** Advance the chip clock by this many CPU T-states. */
  tick?(tStates: number): void;
  /** Hardware reset (the kit's RESET OUT line). */
  reset(): void;
}

/** The parts of CPU8085 the bus uses. */
export interface BusCpu {
  setPort(port: number, value: number): void;
}

/** The parts of a StepResult the bus uses. */
export interface BusStep {
  readonly pc: number;
  readonly opcode: number;
  readonly bytes: readonly number[];
  readonly cycles: number;
  readonly portWrites: readonly PortWrite[];
}

export interface BusTransfer {
  readonly pc: number;
  readonly kind: "IN" | "OUT";
  readonly port: number;
  readonly value: number;
  readonly device: string;
  readonly register: string;
}

export interface BusFault {
  readonly device: string;
  readonly message: string;
  /** Last transfers before the fault, oldest first. */
  readonly log: readonly BusTransfer[];
}

const hex2 = (value: number) => value.toString(16).toUpperCase().padStart(2, "0");

export const formatTransfer = (transfer: BusTransfer) =>
  `${transfer.pc.toString(16).toUpperCase().padStart(4, "0")}: ${transfer.kind} ${hex2(transfer.port)}H ${
    transfer.kind === "OUT" ? "←" : "→"
  } ${hex2(transfer.value)}H (${transfer.device} ${transfer.register})`;

export class IoBus {
  private readonly devices: IoDevice[] = [];
  private readonly owners = new Map<number, IoDevice>();
  private readonly reserved: ReadonlyMap<number, string>;
  private transfers: BusTransfer[] = [];
  private faultState: BusFault | null = null;

  /** reserved: ports already used elsewhere (e.g. 01H/02H on the Virtual I/O board) and by whom. */
  constructor(reserved: ReadonlyMap<number, string> = new Map()) {
    this.reserved = reserved;
  }

  get fault(): BusFault | null {
    return this.faultState;
  }

  get log(): readonly BusTransfer[] {
    return this.transfers;
  }

  get attached(): readonly IoDevice[] {
    return this.devices;
  }

  /** Returns a reason when the device's ports clash with reserved ports or another chip. */
  conflict(device: IoDevice, ignore?: IoDevice): string | null {
    for (const port of device.ports()) {
      const address = `${hex2(port)}H`;
      if (port < 0 || port > 0xff) return `Port ${port} is outside 00H–FFH.`;
      const reservedBy = this.reserved.get(port);
      if (reservedBy) return `${device.id} port ${address} is already used by ${reservedBy}.`;
      const owner = this.owners.get(port);
      if (owner && owner !== device && owner !== ignore) return `${device.id} port ${address} is already used by ${owner.id}.`;
    }
    return null;
  }

  attach(device: IoDevice): void {
    const reason = this.conflict(device);
    if (reason) throw new Error(reason);
    if (!this.devices.includes(device)) this.devices.push(device);
    this.rebuildOwners();
  }

  detach(device: IoDevice): void {
    const index = this.devices.indexOf(device);
    if (index >= 0) this.devices.splice(index, 1);
    this.rebuildOwners();
  }

  /** Call after a device's base address changed. */
  rebuildOwners(): void {
    this.owners.clear();
    for (const device of this.devices) for (const port of device.ports()) this.owners.set(port, device);
  }

  owner(port: number): IoDevice | undefined {
    return this.owners.get(port & 0xff);
  }

  /** Hardware reset of every chip; also clears the log and any fault. */
  reset(): void {
    this.transfers = [];
    this.faultState = null;
    for (const device of this.devices) device.reset();
  }

  /**
   * Chips switched off: clear every chip port in cpu.ports to 00H, so no chip value is left behind
   * and those addresses are plain ports again. Calls no chip code, so it is safe after a fault.
   */
  release(cpu: BusCpu): void {
    for (const port of this.owners.keys()) cpu.setPort(port, 0);
  }

  /** Before cpu.step(): load chip outputs into cpu.ports so IN reads them. */
  beforeStep(cpu: BusCpu): void {
    if (this.faultState) return;
    let device: IoDevice | undefined;
    try {
      for (const [port, owner] of this.owners) {
        device = owner;
        cpu.setPort(port, owner.read(port) & 0xff);
      }
    } catch (error) {
      this.fail(device, error);
    }
  }

  /** After cpu.step(): deliver OUT writes, IN side effects and clock ticks to the chips. */
  afterStep(step: BusStep): void {
    if (this.faultState) return;
    let device: IoDevice | undefined;
    try {
      for (const write of step.portWrites) {
        device = this.owners.get(write.port);
        if (!device) continue;
        device.write(write.port, write.value);
        this.record({ pc: step.pc, kind: "OUT", port: write.port, value: write.value, device: device.id, register: device.portName(write.port) });
      }
      if (step.opcode === OPCODE_IN && step.bytes.length > 1) {
        const port = step.bytes[1] & 0xff;
        device = this.owners.get(port);
        if (device) {
          this.record({ pc: step.pc, kind: "IN", port, value: device.read(port) & 0xff, device: device.id, register: device.portName(port) });
          device.afterRead?.(port);
        }
      }
      for (const each of this.devices) {
        device = each;
        each.tick?.(step.cycles);
      }
    } catch (error) {
      this.fail(device, error);
    }
  }

  /** Last transfer handled by one chip, for the "last:" line in the UI. */
  lastFor(deviceId: string): BusTransfer | null {
    for (let index = this.transfers.length - 1; index >= 0; index -= 1) {
      if (this.transfers[index].device === deviceId) return this.transfers[index];
    }
    return null;
  }

  private record(transfer: BusTransfer): void {
    this.transfers.push(transfer);
    if (this.transfers.length > LOG_SIZE) this.transfers.shift();
  }

  private fail(device: IoDevice | undefined, error: unknown): void {
    this.faultState = {
      device: device?.id ?? "I/O bus",
      message: error instanceof Error ? error.message : String(error),
      log: [...this.transfers],
    };
  }
}
