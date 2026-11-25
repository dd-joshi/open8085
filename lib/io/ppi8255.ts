// Intel 8255A Programmable Peripheral Interface, as wired on 8085 trainer kits (A0/A1 -> port offset).
//
//   base+0 PA · base+1 PB · base+2 PC · base+3 CW (write only)
//
// Simulated: mode 0 for both groups, Port C split into upper/lower halves, bit set/reset (BSR) on
// Port C, "mode set clears all output latches", reading an output port returns its latch.
// Modes 1 and 2 (strobed handshake) are decoded and reported in `warning`; their ports then behave
// like mode 0 with the programmed directions.
import type { IoDevice } from "./bus";

export type PortDirection = "in" | "out";

export interface Ppi8255Snapshot {
  readonly base: number;
  /** Last mode-set control word (bit 7 = 1). After reset: 9BH (all ports input). */
  readonly control: number;
  /** True after the program has written a mode-set control word since reset. */
  readonly programmed: boolean;
  readonly groupAMode: 0 | 1 | 2;
  readonly groupBMode: 0 | 1;
  readonly direction: { readonly a: PortDirection; readonly b: PortDirection; readonly cUpper: PortDirection; readonly cLower: PortDirection };
  /** Values an IN would read now. */
  readonly value: { readonly a: number; readonly b: number; readonly c: number };
  /** Output latches. */
  readonly latch: { readonly a: number; readonly b: number; readonly c: number };
  /** External pins (switches) driving input ports. */
  readonly pins: { readonly a: number; readonly b: number; readonly c: number };
  /** Plain-language meaning of the control word, e.g. "Mode 0 · Port A out · Port B out · Port C in". */
  readonly summary: string;
  readonly warning: string | null;
}

export type Ppi8255Port = "a" | "b" | "c";

const RESET_CONTROL = 0x9b; // mode 0, all ports input

const dirOf = (bit: number): PortDirection => (bit ? "in" : "out");

export function describe8255Control(control: number): string {
  if ((control & 0x80) === 0) {
    const bit = (control >> 1) & 0x07;
    return `Bit set/reset: ${control & 1 ? "set" : "reset"} PC${bit}`;
  }
  const groupA = (control >> 5) & 0x03;
  const groupB = (control >> 2) & 0x01;
  const a = dirOf(control & 0x10);
  const b = dirOf(control & 0x02);
  const cu = dirOf(control & 0x08);
  const cl = dirOf(control & 0x01);
  const modeA = groupA >= 2 ? 2 : groupA;
  const mode = modeA === groupB ? `Mode ${modeA}` : `Group A mode ${modeA} · Group B mode ${groupB}`;
  const portC = cu === cl ? `Port C ${cu}` : `PC upper ${cu} · PC lower ${cl}`;
  return `${mode} · Port A ${a} · Port B ${b} · ${portC}`;
}

export class Ppi8255 implements IoDevice {
  readonly id = "8255";
  private baseAddress: number;
  private control = RESET_CONTROL;
  private programmed = false;
  private latchA = 0;
  private latchB = 0;
  private latchC = 0;
  private pinA = 0;
  private pinB = 0;
  private pinC = 0;
  /** Last byte written to the control port (mode set or BSR), or null. */
  lastControlWrite: number | null = null;

  constructor(base = 0x80) {
    this.baseAddress = base & 0xfc;
  }

  get base(): number {
    return this.baseAddress;
  }

  /** Move the chip; the bus must call rebuildOwners() afterwards. Base is aligned to 4 ports. */
  setBase(base: number): void {
    this.baseAddress = base & 0xfc;
  }

  ports(): readonly number[] {
    return [0, 1, 2, 3].map((offset) => (this.baseAddress + offset) & 0xff);
  }

  portName(port: number): string {
    return ["PA", "PB", "PC", "CW"][(port - this.baseAddress) & 0x03];
  }

  /** Set the external pins (the switches the student flips) of one port. */
  setPins(port: Ppi8255Port, value: number): void {
    const byte = value & 0xff;
    if (port === "a") this.pinA = byte;
    else if (port === "b") this.pinB = byte;
    else this.pinC = byte;
  }

  read(port: number): number {
    switch ((port - this.baseAddress) & 0x03) {
      case 0:
        return this.control & 0x10 ? this.pinA : this.latchA;
      case 1:
        return this.control & 0x02 ? this.pinB : this.latchB;
      case 2: {
        const upper = this.control & 0x08 ? this.pinC : this.latchC;
        const lower = this.control & 0x01 ? this.pinC : this.latchC;
        return (upper & 0xf0) | (lower & 0x0f);
      }
      default:
        return 0xff; // the control register cannot be read; the data bus floats high
    }
  }

  write(port: number, value: number): void {
    const byte = value & 0xff;
    switch ((port - this.baseAddress) & 0x03) {
      case 0:
        this.latchA = byte;
        return;
      case 1:
        this.latchB = byte;
        return;
      case 2:
        this.latchC = byte;
        return;
      default:
        if (byte & 0x80) {
          // Mode set: new directions and all output latches cleared.
          this.control = byte;
          this.programmed = true;
          this.latchA = 0;
          this.latchB = 0;
          this.latchC = 0;
        } else {
          // Bit set/reset on Port C: D3-D1 select the bit, D0 is the new value.
          const mask = 1 << ((byte >> 1) & 0x07);
          this.latchC = byte & 1 ? this.latchC | mask : this.latchC & ~mask & 0xff;
        }
        this.lastControlWrite = byte;
    }
  }

  reset(): void {
    this.control = RESET_CONTROL;
    this.programmed = false;
    this.latchA = 0;
    this.latchB = 0;
    this.latchC = 0;
    this.lastControlWrite = null;
  }

  snapshot(): Ppi8255Snapshot {
    const groupA = (this.control >> 5) & 0x03;
    const groupAMode = (groupA >= 2 ? 2 : groupA) as 0 | 1 | 2;
    const groupBMode = ((this.control >> 2) & 0x01) as 0 | 1;
    const base = this.baseAddress;
    const warning =
      groupAMode !== 0 || groupBMode !== 0
        ? `Mode ${groupAMode !== 0 ? groupAMode : groupBMode} handshake (strobe/ACK on Port C) is not simulated; ports act like mode 0.`
        : null;
    return {
      base,
      control: this.control,
      programmed: this.programmed,
      groupAMode,
      groupBMode,
      direction: {
        a: dirOf(this.control & 0x10),
        b: dirOf(this.control & 0x02),
        cUpper: dirOf(this.control & 0x08),
        cLower: dirOf(this.control & 0x01),
      },
      value: { a: this.read(base), b: this.read(base + 1), c: this.read(base + 2) },
      latch: { a: this.latchA, b: this.latchB, c: this.latchC },
      pins: { a: this.pinA, b: this.pinB, c: this.pinC },
      summary: this.programmed ? describe8255Control(this.control) : "Not programmed · all ports input after reset",
      warning,
    };
  }
}
