// Glue between the 8085 engine and the virtual chips. The simulator calls stepWithIo() instead of
// cpu.step(); with no bus (chips switched OFF) it is exactly cpu.step().
import type { CPU8085, StepResult } from "../cpu8085";
import { IoBus } from "./bus";
import { Pio8155 } from "./pio8155";
import { Ppi8255 } from "./ppi8255";

/** Ports owned by the built-in Virtual I/O board; chips may not use them. */
export const RESERVED_PORTS: ReadonlyMap<number, string> = new Map([
  [0x01, "the Virtual I/O board (OUT 01H)"],
  [0x02, "the Virtual I/O board (IN 02H)"],
]);

export interface ChipBases {
  /** 8255 base port (PA); aligned to 4. */
  readonly ppi: number;
  /** 8155 base port (command/status); aligned to 8. */
  readonly pio: number;
  /** 8155 RAM start address; aligned to 256. */
  readonly ram: number;
}

export const DEFAULT_CHIP_BASES: ChipBases = { ppi: 0x80, pio: 0x20, ram: 0x2800 };

export interface IoChips {
  readonly bus: IoBus;
  readonly ppi: Ppi8255;
  readonly pio: Pio8155;
}

export function createIoChips(bases: ChipBases = DEFAULT_CHIP_BASES): IoChips {
  const bus = new IoBus(RESERVED_PORTS);
  const ppi = new Ppi8255(bases.ppi);
  const pio = new Pio8155(bases.pio, bases.ram);
  bus.attach(ppi);
  bus.attach(pio);
  return { bus, ppi, pio };
}

/**
 * Move a chip to a new base port. Returns an error message and leaves the chip where it was if
 * the new ports clash with the Virtual I/O board or the other chip.
 */
export function moveChip(chips: IoChips, chip: "ppi" | "pio", base: number): string | null {
  const device = chips[chip];
  const previous = device.base;
  device.setBase(base);
  const reason = chips.bus.conflict(device);
  if (reason) {
    device.setBase(previous);
    return reason;
  }
  chips.bus.rebuildOwners();
  return null;
}

/** Run one instruction with the chips on the bus. bus === null: plain cpu.step(). */
export function stepWithIo(cpu: CPU8085, bus: IoBus | null): StepResult {
  if (!bus) return cpu.step();
  bus.beforeStep(cpu);
  const result = cpu.step();
  bus.afterStep(result);
  return result;
}
