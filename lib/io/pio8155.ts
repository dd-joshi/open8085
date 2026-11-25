// Intel 8155 RAM + I/O ports + 14-bit timer, as wired on 8085 trainer kits.
//
//   base+0 write: command register · read: status register
//   base+1 PA · base+2 PB · base+3 PC (6 bits)
//   base+4 TL (count bits 7-0) · base+5 TH (bits 7-6 timer mode, bits 5-0 count bits 13-8)
//
// The 256-byte RAM is ordinary kit memory (e.g. 2800H-28FFH) and already lives in the 8085 memory;
// ramBase is kept only so the UI can show where it is.
//
// Timer clock: one timer clock per CPU T-state (kits feed TIMER IN from the 8085 CLK OUT).
// Square-wave modes: TIMER OUT is high for the first ceil(N/2) clocks and low for the rest.
// Pulse modes: TIMER OUT goes low for one clock at terminal count.
// Simulated: ports in ALT1/ALT2, status TIMER bit (cleared when status is read), all four timer
// modes, START/STOP/STOP-after-TC, reload of a new count at TC when START is given while running.
// ALT3/ALT4 strobed handshake on Port C is reported in `warning`, not simulated.
import type { IoDevice } from "./bus";

export type TimerMode = 0 | 1 | 2 | 3;
export const TIMER_MODE_NAMES = ["single square wave", "square wave", "single pulse", "continuous pulse"] as const;
export type PortCMode = "ALT1" | "ALT2" | "ALT3" | "ALT4";
export type Pio8155Port = "a" | "b" | "c";

export interface TimerEdge {
  /** Timer clock count (since reset) at which TIMER OUT changed. */
  readonly clock: number;
  readonly level: 0 | 1;
}

export interface Pio8155Snapshot {
  readonly base: number;
  readonly ramBase: number;
  readonly command: number;
  /** True after the program has written the command register since reset. */
  readonly programmed: boolean;
  readonly status: number;
  readonly direction: { readonly a: "in" | "out"; readonly b: "in" | "out" };
  readonly portCMode: PortCMode;
  readonly value: { readonly a: number; readonly b: number; readonly c: number };
  readonly latch: { readonly a: number; readonly b: number; readonly c: number };
  readonly pins: { readonly a: number; readonly b: number; readonly c: number };
  readonly summary: string;
  readonly timer: {
    /** Count and mode registers as written through TL/TH. */
    readonly countRegister: number;
    readonly modeRegister: TimerMode;
    /** Count and mode the running timer is using. */
    readonly count: number;
    readonly mode: TimerMode;
    readonly remaining: number;
    readonly running: boolean;
    readonly out: 0 | 1;
    /** Status bit D6: set at terminal count, cleared when the status register is read. */
    readonly terminalCount: boolean;
    readonly clock: number;
    readonly edges: readonly TimerEdge[];
  };
  readonly warning: string | null;
}

const EDGE_LIMIT = 256;
const PORT_C_MODES: readonly PortCMode[] = ["ALT1", "ALT3", "ALT4", "ALT2"]; // command bits D3-D2 = 00, 01, 10, 11
const TIMER_COMMANDS = ["timer unchanged", "stop timer", "stop timer after TC", "start timer"] as const;

const portCModeOf = (command: number) => PORT_C_MODES[(command >> 2) & 0x03];

export function describe8155Command(command: number): string {
  const parts = [`A ${command & 0x01 ? "out" : "in"}`, `B ${command & 0x02 ? "out" : "in"}`];
  const pc = portCModeOf(command);
  parts.push(pc === "ALT1" ? "C in" : pc === "ALT2" ? "C out" : pc === "ALT3" ? "C = A handshake + C3–C5 out" : "C = A and B handshake");
  if (command & 0x10) parts.push("INTE A");
  if (command & 0x20) parts.push("INTE B");
  parts.push(TIMER_COMMANDS[(command >> 6) & 0x03]);
  return parts.join(" · ");
}

export class Pio8155 implements IoDevice {
  readonly id = "8155";
  private baseAddress: number;
  ramBase: number;
  private command = 0;
  private programmed = false;
  private latchA = 0;
  private latchB = 0;
  private latchC = 0;
  private pinA = 0;
  private pinB = 0;
  private pinC = 0;
  // Timer registers (TL/TH) and live counter.
  private countRegister = 0;
  private modeRegister: TimerMode = 0;
  private count = 0;
  private mode: TimerMode = 0;
  private remaining = 0;
  private started = false;
  private running = false;
  private stopAfterTc = false;
  private reloadAtTc = false;
  private out: 0 | 1 = 1;
  private pulseLow = false;
  private terminalCount = false;
  private clock = 0;
  private edges: TimerEdge[] = [];
  private countAdjusted = false;
  /** Last byte written to the command register, or null. */
  lastCommandWrite: number | null = null;

  constructor(base = 0x20, ramBase = 0x2800) {
    this.baseAddress = base & 0xf8;
    this.ramBase = ramBase & 0xff00;
  }

  get base(): number {
    return this.baseAddress;
  }

  /** Where the kit maps the 8155's 256-byte RAM (display only); aligned to 256. */
  setRamBase(address: number): void {
    this.ramBase = address & 0xff00;
  }

  /** Move the chip; the bus must call rebuildOwners() afterwards. Base is aligned to 8 ports. */
  setBase(base: number): void {
    this.baseAddress = base & 0xf8;
  }

  ports(): readonly number[] {
    return [0, 1, 2, 3, 4, 5].map((offset) => (this.baseAddress + offset) & 0xff);
  }

  portName(port: number): string {
    return ["CMD", "PA", "PB", "PC", "TL", "TH", "?", "?"][(port - this.baseAddress) & 0x07];
  }

  setPins(port: Pio8155Port, value: number): void {
    if (port === "a") this.pinA = value & 0xff;
    else if (port === "b") this.pinB = value & 0xff;
    else this.pinC = value & 0x3f;
  }

  private status(): number {
    return ((this.command & 0x10) >> 2) | ((this.command & 0x20) >> 0) | (this.terminalCount ? 0x40 : 0);
  }

  private portC(): number {
    switch (portCModeOf(this.command)) {
      case "ALT1":
        return this.pinC & 0x3f;
      case "ALT2":
        return this.latchC & 0x3f;
      case "ALT3":
        return this.latchC & 0x38; // PC0-PC2 carry port A handshake signals (not simulated: read as 0)
      default:
        return 0; // ALT4: all of Port C is handshake (not simulated)
    }
  }

  read(port: number): number {
    const shown = this.started ? this.remaining : this.countRegister;
    const mode = this.started ? this.mode : this.modeRegister;
    switch ((port - this.baseAddress) & 0x07) {
      case 0:
        return this.status();
      case 1:
        return this.command & 0x01 ? this.latchA : this.pinA;
      case 2:
        return this.command & 0x02 ? this.latchB : this.pinB;
      case 3:
        return this.portC();
      case 4:
        return shown & 0xff;
      case 5:
        return (mode << 6) | ((shown >> 8) & 0x3f);
      default:
        return 0xff;
    }
  }

  afterRead(port: number): void {
    if (((port - this.baseAddress) & 0x07) === 0) this.terminalCount = false;
  }

  write(port: number, value: number): void {
    const byte = value & 0xff;
    switch ((port - this.baseAddress) & 0x07) {
      case 0:
        this.writeCommand(byte);
        return;
      case 1:
        this.latchA = byte;
        return;
      case 2:
        this.latchB = byte;
        return;
      case 3:
        this.latchC = byte & 0x3f;
        return;
      case 4:
        this.countRegister = (this.countRegister & 0x3f00) | byte;
        return;
      case 5:
        this.countRegister = (this.countRegister & 0x00ff) | ((byte & 0x3f) << 8);
        this.modeRegister = (byte >> 6) as TimerMode;
        return;
      default:
        return;
    }
  }

  private writeCommand(byte: number): void {
    this.command = byte;
    this.programmed = true;
    this.lastCommandWrite = byte;
    switch ((byte >> 6) & 0x03) {
      case 1: // STOP immediately
        this.running = false;
        this.stopAfterTc = false;
        this.reloadAtTc = false;
        break;
      case 2: // STOP after terminal count
        if (this.running) this.stopAfterTc = true;
        break;
      case 3: // START (or reload at next TC if already running)
        if (this.running) this.reloadAtTc = true;
        else this.loadAndStart();
        break;
      default:
        break;
    }
  }

  private loadAndStart(): void {
    this.countAdjusted = this.countRegister < 2;
    this.count = Math.max(2, this.countRegister);
    this.mode = this.modeRegister;
    this.remaining = this.count;
    this.started = true;
    this.running = true;
    this.stopAfterTc = false;
    this.reloadAtTc = false;
    this.pulseLow = false;
    this.setOut(1);
  }

  private setOut(level: 0 | 1): void {
    if (level === this.out) return;
    this.out = level;
    this.edges.push({ clock: this.clock, level });
    if (this.edges.length > EDGE_LIMIT) this.edges.shift();
  }

  tick(tStates: number): void {
    for (let index = 0; index < tStates; index += 1) {
      this.clock += 1;
      if (this.pulseLow) {
        this.pulseLow = false;
        this.setOut(1);
      }
      if (!this.running) continue;
      this.remaining -= 1;
      const square = this.mode === 0 || this.mode === 1;
      if (square && this.remaining === Math.floor(this.count / 2) && this.remaining > 0) this.setOut(0);
      if (this.remaining <= 0) this.atTerminalCount(square);
    }
  }

  private atTerminalCount(square: boolean): void {
    this.terminalCount = true;
    if (square) {
      this.setOut(1);
    } else {
      this.setOut(0);
      this.pulseLow = true;
    }
    if (this.stopAfterTc) {
      this.running = false;
      this.stopAfterTc = false;
      return;
    }
    if (this.reloadAtTc) {
      this.reloadAtTc = false;
      this.countAdjusted = this.countRegister < 2;
      this.count = Math.max(2, this.countRegister);
      this.mode = this.modeRegister;
      this.remaining = this.count;
      return;
    }
    if (this.mode === 1 || this.mode === 3) this.remaining = this.count;
    else this.running = false;
  }

  /** Hardware reset: ports become inputs, timer stops; count/mode registers are kept. */
  reset(): void {
    this.command = 0;
    this.programmed = false;
    this.latchA = 0;
    this.latchB = 0;
    this.latchC = 0;
    this.count = 0;
    this.mode = 0;
    this.remaining = 0;
    this.started = false;
    this.running = false;
    this.stopAfterTc = false;
    this.reloadAtTc = false;
    this.out = 1;
    this.pulseLow = false;
    this.terminalCount = false;
    this.clock = 0;
    this.edges = [];
    this.countAdjusted = false;
    this.lastCommandWrite = null;
  }

  snapshot(): Pio8155Snapshot {
    const base = this.baseAddress;
    const pcMode = portCModeOf(this.command);
    const warnings: string[] = [];
    if (pcMode === "ALT3" || pcMode === "ALT4") warnings.push(`Port C ${pcMode} handshake (strobe/buffer-full) is not simulated.`);
    if (this.countAdjusted) warnings.push("Timer count below 2 is not allowed; using 2.");
    return {
      base,
      ramBase: this.ramBase,
      command: this.command,
      programmed: this.programmed,
      status: this.status(),
      direction: { a: this.command & 0x01 ? "out" : "in", b: this.command & 0x02 ? "out" : "in" },
      portCMode: pcMode,
      value: { a: this.read(base + 1), b: this.read(base + 2), c: this.read(base + 3) },
      latch: { a: this.latchA, b: this.latchB, c: this.latchC },
      pins: { a: this.pinA, b: this.pinB, c: this.pinC },
      summary: this.programmed ? describe8155Command(this.command) : "Not programmed · all ports input after reset",
      timer: {
        countRegister: this.countRegister,
        modeRegister: this.modeRegister,
        count: this.count,
        mode: this.mode,
        remaining: this.remaining,
        running: this.running,
        out: this.out,
        terminalCount: this.terminalCount,
        clock: this.clock,
        edges: [...this.edges],
      },
      warning: warnings.length ? warnings.join(" ") : null,
    };
  }
}
