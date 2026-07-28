export interface CPU8085Flags {
  s: boolean;
  z: boolean;
  ac: boolean;
  p: boolean;
  cy: boolean;
}

export interface InterruptMaskState {
  rst55: boolean;
  rst65: boolean;
  rst75: boolean;
}

export interface InterruptPendingState {
  rst55: boolean;
  rst65: boolean;
  rst75: boolean;
}

export type RegisterName =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "H"
  | "L"
  | "BC"
  | "DE"
  | "HL"
  | "SP"
  | "PC";

export interface CPU8085State {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
  bc: number;
  de: number;
  hl: number;
  sp: number;
  pc: number;
  flags: CPU8085Flags;
  halted: boolean;
  interruptEnabled: boolean;
  interruptEnablePending: boolean;
  interruptMasks: InterruptMaskState;
  pendingInterrupts: InterruptPendingState;
  serialInput: boolean;
  serialOutput: boolean;
  totalCycles: number;
}

export interface MemoryWrite {
  address: number;
  previous: number;
  value: number;
}

export interface PortWrite {
  port: number;
  previous: number;
  value: number;
}

export interface DisassembledInstruction {
  address: number;
  opcode: number;
  bytes: number[];
  length: number;
  mnemonic: string;
}

export interface StepResult {
  pc: number;
  nextPC: number;
  opcode: number;
  bytes: number[];
  mnemonic: string;
  cycles: number;
  totalCycles: number;
  memoryWrites: MemoryWrite[];
  portWrites: PortWrite[];
  halted: boolean;
}

export type InterruptLine = "RST5.5" | "RST6.5" | "RST7.5";

const REG_NAMES = ["B", "C", "D", "E", "H", "L", "M", "A"] as const;
const PAIR_NAMES = ["B", "D", "H", "SP"] as const;
const STACK_PAIR_NAMES = ["B", "D", "H", "PSW"] as const;
const CONDITIONS = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"] as const;
const ALU_NAMES = ["ADD", "ADC", "SUB", "SBB", "ANA", "XRA", "ORA", "CMP"] as const;
const ALU_IMMEDIATE_NAMES = ["ADI", "ACI", "SUI", "SBI", "ANI", "XRI", "ORI", "CPI"] as const;

const byte = (value: number): number => value & 0xff;
const word = (value: number): number => value & 0xffff;
const hex8 = (value: number): string => `${byte(value).toString(16).toUpperCase().padStart(2, "0")}H`;
const hex16 = (value: number): string => `${word(value).toString(16).toUpperCase().padStart(4, "0")}H`;

/** Dependency-free Intel 8085 CPU core suitable for browser UIs. */
export class CPU8085 {
  public readonly memory = new Uint8Array(0x10000);
  public readonly ports = new Uint8Array(0x100);

  public a = 0;
  public b = 0;
  public c = 0;
  public d = 0;
  public e = 0;
  public h = 0;
  public l = 0;
  public sp = 0;
  public pc = 0;

  public readonly flags: CPU8085Flags = {
    s: false,
    z: false,
    ac: false,
    p: false,
    cy: false,
  };

  public halted = false;
  public interruptEnabled = false;
  public readonly interruptMasks: InterruptMaskState = {
    rst55: false,
    rst65: false,
    rst75: false,
  };
  public readonly pendingInterrupts: InterruptPendingState = {
    rst55: false,
    rst65: false,
    rst75: false,
  };
  public serialInput = false;
  public serialOutput = false;
  public totalCycles = 0;

  private interruptEnablePending = false;
  private activeMemoryWrites: MemoryWrite[] | null = null;
  private activePortWrites: PortWrite[] | null = null;

  /**
   * Resets CPU state. Memory and ports are retained like real hardware unless
   * their optional clear arguments are true.
   */
  public reset(clearMemory = false, clearPorts = false): void {
    this.a = 0;
    this.b = 0;
    this.c = 0;
    this.d = 0;
    this.e = 0;
    this.h = 0;
    this.l = 0;
    this.sp = 0;
    this.pc = 0;
    this.flags.s = false;
    this.flags.z = false;
    this.flags.ac = false;
    this.flags.p = false;
    this.flags.cy = false;
    this.halted = false;
    this.interruptEnabled = false;
    this.interruptEnablePending = false;
    this.interruptMasks.rst55 = false;
    this.interruptMasks.rst65 = false;
    this.interruptMasks.rst75 = false;
    this.pendingInterrupts.rst55 = false;
    this.pendingInterrupts.rst65 = false;
    this.pendingInterrupts.rst75 = false;
    this.serialInput = false;
    this.serialOutput = false;
    this.totalCycles = 0;
    this.activeMemoryWrites = null;
    this.activePortWrites = null;
    if (clearMemory) this.memory.fill(0);
    if (clearPorts) this.ports.fill(0);
  }

  /**
   * Loads bytes with 16-bit address wrapping and returns the first address
   * after the loaded data.
   */
  public load(data: ArrayLike<number>, address = 0, setProgramCounter = false): number {
    const start = word(address);
    for (let index = 0; index < data.length; index += 1) {
      this.memory[word(start + index)] = byte(Number(data[index]));
    }
    if (setProgramCounter) this.pc = start;
    return word(start + data.length);
  }

  public getState(): CPU8085State {
    return {
      a: byte(this.a),
      b: byte(this.b),
      c: byte(this.c),
      d: byte(this.d),
      e: byte(this.e),
      h: byte(this.h),
      l: byte(this.l),
      bc: this.getPair(0),
      de: this.getPair(1),
      hl: this.getPair(2),
      sp: word(this.sp),
      pc: word(this.pc),
      flags: { ...this.flags },
      halted: this.halted,
      interruptEnabled: this.interruptEnabled,
      interruptEnablePending: this.interruptEnablePending,
      interruptMasks: { ...this.interruptMasks },
      pendingInterrupts: { ...this.pendingInterrupts },
      serialInput: this.serialInput,
      serialOutput: this.serialOutput,
      totalCycles: this.totalCycles,
    };
  }

  public getRegister(name: RegisterName): number {
    switch (name) {
      case "A": return byte(this.a);
      case "B": return byte(this.b);
      case "C": return byte(this.c);
      case "D": return byte(this.d);
      case "E": return byte(this.e);
      case "H": return byte(this.h);
      case "L": return byte(this.l);
      case "BC": return this.getPair(0);
      case "DE": return this.getPair(1);
      case "HL": return this.getPair(2);
      case "SP": return word(this.sp);
      case "PC": return word(this.pc);
    }
  }

  public setRegister(name: RegisterName, value: number): void {
    const value8 = byte(value);
    const value16 = word(value);
    switch (name) {
      case "A": this.a = value8; break;
      case "B": this.b = value8; break;
      case "C": this.c = value8; break;
      case "D": this.d = value8; break;
      case "E": this.e = value8; break;
      case "H": this.h = value8; break;
      case "L": this.l = value8; break;
      case "BC": this.setPair(0, value16); break;
      case "DE": this.setPair(1, value16); break;
      case "HL": this.setPair(2, value16); break;
      case "SP": this.sp = value16; break;
      case "PC": this.pc = value16; break;
    }
  }

  public setFlag(name: keyof CPU8085Flags, value: boolean): void {
    this.flags[name] = Boolean(value);
  }

  public setMemory(address: number, value: number): void {
    this.memory[word(address)] = byte(value);
  }

  public setPort(port: number, value: number): void {
    this.ports[byte(port)] = byte(value);
  }

  public setInterruptPending(line: InterruptLine, pending = true): void {
    if (line === "RST5.5") this.pendingInterrupts.rst55 = pending;
    else if (line === "RST6.5") this.pendingInterrupts.rst65 = pending;
    else this.pendingInterrupts.rst75 = pending;
  }

  public setSerialInput(value: boolean): void {
    this.serialInput = Boolean(value);
  }

  public disassembleAt(address: number): DisassembledInstruction {
    const pc = word(address);
    const opcode = this.memory[pc];
    const decoded = this.decode(pc, opcode);
    const bytes: number[] = [];
    for (let index = 0; index < decoded.length; index += 1) {
      bytes.push(this.memory[word(pc + index)]);
    }
    return {
      address: pc,
      opcode,
      bytes,
      length: decoded.length,
      mnemonic: decoded.mnemonic,
    };
  }

  public step(): StepResult {
    if (this.halted) {
      return {
        pc: word(this.pc),
        nextPC: word(this.pc),
        opcode: 0x76,
        bytes: [],
        mnemonic: "HALTED",
        cycles: 0,
        totalCycles: this.totalCycles,
        memoryWrites: [],
        portWrites: [],
        halted: true,
      };
    }

    const startPC = word(this.pc);
    const disassembled = this.disassembleAt(startPC);
    const opcode = disassembled.opcode;
    const memoryWrites: MemoryWrite[] = [];
    const portWrites: PortWrite[] = [];
    this.activeMemoryWrites = memoryWrites;
    this.activePortWrites = portWrites;

    const enableInterruptsAfterStep = this.interruptEnablePending;
    this.interruptEnablePending = false;
    this.pc = word(startPC + 1);
    let cycles = 4;

    const fetch8 = (): number => {
      const result = this.memory[word(this.pc)];
      this.pc = word(this.pc + 1);
      return result;
    };
    const fetch16 = (): number => {
      const low = fetch8();
      return low | (fetch8() << 8);
    };

    if (opcode >= 0x40 && opcode <= 0x7f) {
      if (opcode === 0x76) {
        this.halted = true;
        cycles = 7;
      } else {
        const destination = (opcode >>> 3) & 7;
        const source = opcode & 7;
        this.writeReg(destination, this.readReg(source));
        cycles = destination === 6 || source === 6 ? 7 : 4;
      }
    } else if (opcode >= 0x80 && opcode <= 0xbf) {
      const operation = (opcode >>> 3) & 7;
      const source = opcode & 7;
      this.executeAlu(operation, this.readReg(source));
      cycles = source === 6 ? 7 : 4;
    } else if ((opcode & 0xcf) === 0x01) {
      this.setPair((opcode >>> 4) & 3, fetch16());
      cycles = 10;
    } else if ((opcode & 0xef) === 0x02) {
      this.writeMemory(this.getPair((opcode >>> 4) & 1), this.a);
      cycles = 7;
    } else if ((opcode & 0xcf) === 0x03) {
      const pair = (opcode >>> 4) & 3;
      this.setPair(pair, this.getPair(pair) + 1);
      cycles = 6;
    } else if ((opcode & 0xc7) === 0x04) {
      const register = (opcode >>> 3) & 7;
      const oldCarry = this.flags.cy;
      const value = this.readReg(register);
      const result = byte(value + 1);
      this.flags.ac = (value & 0x0f) === 0x0f;
      this.setSZP(result);
      this.flags.cy = oldCarry;
      this.writeReg(register, result);
      cycles = register === 6 ? 10 : 4;
    } else if ((opcode & 0xc7) === 0x05) {
      const register = (opcode >>> 3) & 7;
      const oldCarry = this.flags.cy;
      const value = this.readReg(register);
      const result = byte(value - 1);
      this.flags.ac = (value & 0x0f) === 0;
      this.setSZP(result);
      this.flags.cy = oldCarry;
      this.writeReg(register, result);
      cycles = register === 6 ? 10 : 4;
    } else if ((opcode & 0xc7) === 0x06) {
      const register = (opcode >>> 3) & 7;
      this.writeReg(register, fetch8());
      cycles = register === 6 ? 10 : 7;
    } else if ((opcode & 0xcf) === 0x09) {
      const result = this.getPair(2) + this.getPair((opcode >>> 4) & 3);
      this.flags.cy = result > 0xffff;
      this.setPair(2, result);
      cycles = 10;
    } else if ((opcode & 0xef) === 0x0a) {
      this.a = this.memory[this.getPair((opcode >>> 4) & 1)];
      cycles = 7;
    } else if ((opcode & 0xcf) === 0x0b) {
      const pair = (opcode >>> 4) & 3;
      this.setPair(pair, this.getPair(pair) - 1);
      cycles = 6;
    } else if ((opcode & 0xc7) === 0xc0) {
      if (this.condition((opcode >>> 3) & 7)) {
        this.pc = this.popWord();
        cycles = 12;
      } else {
        cycles = 6;
      }
    } else if ((opcode & 0xcf) === 0xc1) {
      const pair = (opcode >>> 4) & 3;
      const value = this.popWord();
      if (pair === 3) {
        this.a = byte(value >>> 8);
        this.unpackFlags(value);
      } else {
        this.setPair(pair, value);
      }
      cycles = 10;
    } else if ((opcode & 0xc7) === 0xc2) {
      const target = fetch16();
      if (this.condition((opcode >>> 3) & 7)) {
        this.pc = target;
        cycles = 10;
      } else {
        cycles = 7;
      }
    } else if ((opcode & 0xc7) === 0xc4) {
      const target = fetch16();
      if (this.condition((opcode >>> 3) & 7)) {
        this.pushWord(this.pc);
        this.pc = target;
        cycles = 18;
      } else {
        cycles = 9;
      }
    } else if ((opcode & 0xcf) === 0xc5) {
      const pair = (opcode >>> 4) & 3;
      this.pushWord(pair === 3 ? (byte(this.a) << 8) | this.packFlags() : this.getPair(pair));
      cycles = 12;
    } else if ((opcode & 0xc7) === 0xc6) {
      this.executeAlu((opcode >>> 3) & 7, fetch8());
      cycles = 7;
    } else if ((opcode & 0xc7) === 0xc7) {
      this.pushWord(this.pc);
      this.pc = opcode & 0x38;
      cycles = 12;
    } else {
      switch (opcode) {
        case 0x00:
          cycles = 4;
          break;
        case 0x07: {
          const outgoing = (byte(this.a) >>> 7) & 1;
          this.a = byte((this.a << 1) | outgoing);
          this.flags.cy = outgoing !== 0;
          cycles = 4;
          break;
        }
        case 0x0f: {
          const outgoing = byte(this.a) & 1;
          this.a = byte((byte(this.a) >>> 1) | (outgoing << 7));
          this.flags.cy = outgoing !== 0;
          cycles = 4;
          break;
        }
        case 0x17: {
          const incoming = this.flags.cy ? 1 : 0;
          const outgoing = (byte(this.a) >>> 7) & 1;
          this.a = byte((this.a << 1) | incoming);
          this.flags.cy = outgoing !== 0;
          cycles = 4;
          break;
        }
        case 0x1f: {
          const incoming = this.flags.cy ? 0x80 : 0;
          const outgoing = byte(this.a) & 1;
          this.a = byte((byte(this.a) >>> 1) | incoming);
          this.flags.cy = outgoing !== 0;
          cycles = 4;
          break;
        }
        case 0x20:
          this.a =
            (this.serialInput ? 0x80 : 0) |
            (this.pendingInterrupts.rst75 ? 0x40 : 0) |
            (this.pendingInterrupts.rst65 ? 0x20 : 0) |
            (this.pendingInterrupts.rst55 ? 0x10 : 0) |
            (this.interruptEnabled ? 0x08 : 0) |
            (this.interruptMasks.rst75 ? 0x04 : 0) |
            (this.interruptMasks.rst65 ? 0x02 : 0) |
            (this.interruptMasks.rst55 ? 0x01 : 0);
          cycles = 4;
          break;
        case 0x22: {
          const address = fetch16();
          this.writeMemory(address, this.l);
          this.writeMemory(address + 1, this.h);
          cycles = 16;
          break;
        }
        case 0x27:
          this.decimalAdjustAccumulator();
          cycles = 4;
          break;
        case 0x2a: {
          const address = fetch16();
          this.l = this.memory[word(address)];
          this.h = this.memory[word(address + 1)];
          cycles = 16;
          break;
        }
        case 0x2f:
          this.a = byte(~this.a);
          cycles = 4;
          break;
        case 0x30:
          if ((this.a & 0x08) !== 0) {
            this.interruptMasks.rst55 = (this.a & 0x01) !== 0;
            this.interruptMasks.rst65 = (this.a & 0x02) !== 0;
            this.interruptMasks.rst75 = (this.a & 0x04) !== 0;
          }
          if ((this.a & 0x10) !== 0) this.pendingInterrupts.rst75 = false;
          if ((this.a & 0x40) !== 0) this.serialOutput = (this.a & 0x80) !== 0;
          cycles = 4;
          break;
        case 0x32:
          this.writeMemory(fetch16(), this.a);
          cycles = 13;
          break;
        case 0x37:
          this.flags.cy = true;
          cycles = 4;
          break;
        case 0x3a:
          this.a = this.memory[fetch16()];
          cycles = 13;
          break;
        case 0x3f:
          this.flags.cy = !this.flags.cy;
          cycles = 4;
          break;
        case 0xc3:
          this.pc = fetch16();
          cycles = 10;
          break;
        case 0xc9:
          this.pc = this.popWord();
          cycles = 10;
          break;
        case 0xcd: {
          const target = fetch16();
          this.pushWord(this.pc);
          this.pc = target;
          cycles = 18;
          break;
        }
        case 0xd3:
          this.writePort(fetch8(), this.a);
          cycles = 10;
          break;
        case 0xdb:
          this.a = this.ports[fetch8()];
          cycles = 10;
          break;
        case 0xe3: {
          const low = this.memory[word(this.sp)];
          const high = this.memory[word(this.sp + 1)];
          this.writeMemory(this.sp, this.l);
          this.writeMemory(this.sp + 1, this.h);
          this.l = low;
          this.h = high;
          cycles = 16;
          break;
        }
        case 0xe9:
          this.pc = this.getPair(2);
          cycles = 6;
          break;
        case 0xeb: {
          const de = this.getPair(1);
          this.setPair(1, this.getPair(2));
          this.setPair(2, de);
          cycles = 4;
          break;
        }
        case 0xf3:
          this.interruptEnabled = false;
          this.interruptEnablePending = false;
          cycles = 4;
          break;
        case 0xf9:
          this.sp = this.getPair(2);
          cycles = 6;
          break;
        case 0xfb:
          this.interruptEnablePending = true;
          cycles = 4;
          break;
        default:
          // Undocumented opcode holes behave as stable one-byte NOPs.
          cycles = 4;
          break;
      }
    }

    if (enableInterruptsAfterStep && opcode !== 0xf3) {
      this.interruptEnabled = true;
    }
    this.a = byte(this.a);
    this.b = byte(this.b);
    this.c = byte(this.c);
    this.d = byte(this.d);
    this.e = byte(this.e);
    this.h = byte(this.h);
    this.l = byte(this.l);
    this.sp = word(this.sp);
    this.pc = word(this.pc);
    this.totalCycles += cycles;
    this.activeMemoryWrites = null;
    this.activePortWrites = null;

    return {
      pc: startPC,
      nextPC: this.pc,
      opcode,
      bytes: disassembled.bytes,
      mnemonic: disassembled.mnemonic,
      cycles,
      totalCycles: this.totalCycles,
      memoryWrites,
      portWrites,
      halted: this.halted,
    };
  }

  private decode(address: number, opcode: number): { length: number; mnemonic: string } {
    const immediate8 = this.memory[word(address + 1)];
    const immediate16 = immediate8 | (this.memory[word(address + 2)] << 8);

    if (opcode >= 0x40 && opcode <= 0x7f) {
      if (opcode === 0x76) return { length: 1, mnemonic: "HLT" };
      return {
        length: 1,
        mnemonic: `MOV ${REG_NAMES[(opcode >>> 3) & 7]}, ${REG_NAMES[opcode & 7]}`,
      };
    }
    if (opcode >= 0x80 && opcode <= 0xbf) {
      return {
        length: 1,
        mnemonic: `${ALU_NAMES[(opcode >>> 3) & 7]} ${REG_NAMES[opcode & 7]}`,
      };
    }
    if ((opcode & 0xcf) === 0x01) {
      return {
        length: 3,
        mnemonic: `LXI ${PAIR_NAMES[(opcode >>> 4) & 3]}, ${hex16(immediate16)}`,
      };
    }
    if ((opcode & 0xef) === 0x02) {
      return { length: 1, mnemonic: `STAX ${PAIR_NAMES[(opcode >>> 4) & 1]}` };
    }
    if ((opcode & 0xcf) === 0x03) {
      return { length: 1, mnemonic: `INX ${PAIR_NAMES[(opcode >>> 4) & 3]}` };
    }
    if ((opcode & 0xc7) === 0x04) {
      return { length: 1, mnemonic: `INR ${REG_NAMES[(opcode >>> 3) & 7]}` };
    }
    if ((opcode & 0xc7) === 0x05) {
      return { length: 1, mnemonic: `DCR ${REG_NAMES[(opcode >>> 3) & 7]}` };
    }
    if ((opcode & 0xc7) === 0x06) {
      return {
        length: 2,
        mnemonic: `MVI ${REG_NAMES[(opcode >>> 3) & 7]}, ${hex8(immediate8)}`,
      };
    }
    if ((opcode & 0xcf) === 0x09) {
      return { length: 1, mnemonic: `DAD ${PAIR_NAMES[(opcode >>> 4) & 3]}` };
    }
    if ((opcode & 0xef) === 0x0a) {
      return { length: 1, mnemonic: `LDAX ${PAIR_NAMES[(opcode >>> 4) & 1]}` };
    }
    if ((opcode & 0xcf) === 0x0b) {
      return { length: 1, mnemonic: `DCX ${PAIR_NAMES[(opcode >>> 4) & 3]}` };
    }
    if ((opcode & 0xc7) === 0xc0) {
      return { length: 1, mnemonic: `R${CONDITIONS[(opcode >>> 3) & 7]}` };
    }
    if ((opcode & 0xcf) === 0xc1) {
      return { length: 1, mnemonic: `POP ${STACK_PAIR_NAMES[(opcode >>> 4) & 3]}` };
    }
    if ((opcode & 0xc7) === 0xc2) {
      return {
        length: 3,
        mnemonic: `J${CONDITIONS[(opcode >>> 3) & 7]} ${hex16(immediate16)}`,
      };
    }
    if ((opcode & 0xc7) === 0xc4) {
      return {
        length: 3,
        mnemonic: `C${CONDITIONS[(opcode >>> 3) & 7]} ${hex16(immediate16)}`,
      };
    }
    if ((opcode & 0xcf) === 0xc5) {
      return { length: 1, mnemonic: `PUSH ${STACK_PAIR_NAMES[(opcode >>> 4) & 3]}` };
    }
    if ((opcode & 0xc7) === 0xc6) {
      return {
        length: 2,
        mnemonic: `${ALU_IMMEDIATE_NAMES[(opcode >>> 3) & 7]} ${hex8(immediate8)}`,
      };
    }
    if ((opcode & 0xc7) === 0xc7) {
      return { length: 1, mnemonic: `RST ${(opcode >>> 3) & 7}` };
    }

    switch (opcode) {
      case 0x00: return { length: 1, mnemonic: "NOP" };
      case 0x07: return { length: 1, mnemonic: "RLC" };
      case 0x0f: return { length: 1, mnemonic: "RRC" };
      case 0x17: return { length: 1, mnemonic: "RAL" };
      case 0x1f: return { length: 1, mnemonic: "RAR" };
      case 0x20: return { length: 1, mnemonic: "RIM" };
      case 0x22: return { length: 3, mnemonic: `SHLD ${hex16(immediate16)}` };
      case 0x27: return { length: 1, mnemonic: "DAA" };
      case 0x2a: return { length: 3, mnemonic: `LHLD ${hex16(immediate16)}` };
      case 0x2f: return { length: 1, mnemonic: "CMA" };
      case 0x30: return { length: 1, mnemonic: "SIM" };
      case 0x32: return { length: 3, mnemonic: `STA ${hex16(immediate16)}` };
      case 0x37: return { length: 1, mnemonic: "STC" };
      case 0x3a: return { length: 3, mnemonic: `LDA ${hex16(immediate16)}` };
      case 0x3f: return { length: 1, mnemonic: "CMC" };
      case 0xc3: return { length: 3, mnemonic: `JMP ${hex16(immediate16)}` };
      case 0xc9: return { length: 1, mnemonic: "RET" };
      case 0xcd: return { length: 3, mnemonic: `CALL ${hex16(immediate16)}` };
      case 0xd3: return { length: 2, mnemonic: `OUT ${hex8(immediate8)}` };
      case 0xdb: return { length: 2, mnemonic: `IN ${hex8(immediate8)}` };
      case 0xe3: return { length: 1, mnemonic: "XTHL" };
      case 0xe9: return { length: 1, mnemonic: "PCHL" };
      case 0xeb: return { length: 1, mnemonic: "XCHG" };
      case 0xf3: return { length: 1, mnemonic: "DI" };
      case 0xf9: return { length: 1, mnemonic: "SPHL" };
      case 0xfb: return { length: 1, mnemonic: "EI" };
      default: return { length: 1, mnemonic: `NOP* ${hex8(opcode)}` };
    }
  }

  private readReg(index: number): number {
    switch (index & 7) {
      case 0: return byte(this.b);
      case 1: return byte(this.c);
      case 2: return byte(this.d);
      case 3: return byte(this.e);
      case 4: return byte(this.h);
      case 5: return byte(this.l);
      case 6: return this.memory[this.getPair(2)];
      default: return byte(this.a);
    }
  }

  private writeReg(index: number, value: number): void {
    const result = byte(value);
    switch (index & 7) {
      case 0: this.b = result; break;
      case 1: this.c = result; break;
      case 2: this.d = result; break;
      case 3: this.e = result; break;
      case 4: this.h = result; break;
      case 5: this.l = result; break;
      case 6: this.writeMemory(this.getPair(2), result); break;
      default: this.a = result; break;
    }
  }

  private getPair(index: number): number {
    switch (index & 3) {
      case 0: return (byte(this.b) << 8) | byte(this.c);
      case 1: return (byte(this.d) << 8) | byte(this.e);
      case 2: return (byte(this.h) << 8) | byte(this.l);
      default: return word(this.sp);
    }
  }

  private setPair(index: number, value: number): void {
    const result = word(value);
    switch (index & 3) {
      case 0:
        this.b = result >>> 8;
        this.c = byte(result);
        break;
      case 1:
        this.d = result >>> 8;
        this.e = byte(result);
        break;
      case 2:
        this.h = result >>> 8;
        this.l = byte(result);
        break;
      default:
        this.sp = result;
        break;
    }
  }

  private writeMemory(address: number, value: number): void {
    const normalizedAddress = word(address);
    const normalizedValue = byte(value);
    const previous = this.memory[normalizedAddress];
    this.memory[normalizedAddress] = normalizedValue;
    this.activeMemoryWrites?.push({
      address: normalizedAddress,
      previous,
      value: normalizedValue,
    });
  }

  private writePort(port: number, value: number): void {
    const normalizedPort = byte(port);
    const normalizedValue = byte(value);
    const previous = this.ports[normalizedPort];
    this.ports[normalizedPort] = normalizedValue;
    this.activePortWrites?.push({
      port: normalizedPort,
      previous,
      value: normalizedValue,
    });
  }

  private pushWord(value: number): void {
    const normalized = word(value);
    this.sp = word(this.sp - 1);
    this.writeMemory(this.sp, normalized >>> 8);
    this.sp = word(this.sp - 1);
    this.writeMemory(this.sp, normalized);
  }

  private popWord(): number {
    const low = this.memory[word(this.sp)];
    this.sp = word(this.sp + 1);
    const high = this.memory[word(this.sp)];
    this.sp = word(this.sp + 1);
    return low | (high << 8);
  }

  private executeAlu(operation: number, value: number): void {
    const operand = byte(value);
    switch (operation & 7) {
      case 0: this.add(operand, 0); break;
      case 1: this.add(operand, this.flags.cy ? 1 : 0); break;
      case 2: this.subtract(operand, 0, true); break;
      case 3: this.subtract(operand, this.flags.cy ? 1 : 0, true); break;
      case 4:
        this.a = byte(this.a & operand);
        this.flags.cy = false;
        this.flags.ac = true;
        this.setSZP(this.a);
        break;
      case 5:
        this.a = byte(this.a ^ operand);
        this.flags.cy = false;
        this.flags.ac = false;
        this.setSZP(this.a);
        break;
      case 6:
        this.a = byte(this.a | operand);
        this.flags.cy = false;
        this.flags.ac = false;
        this.setSZP(this.a);
        break;
      default:
        this.subtract(operand, 0, false);
        break;
    }
  }

  private add(value: number, carry: number): void {
    const accumulator = byte(this.a);
    const result = accumulator + byte(value) + carry;
    this.flags.ac = (accumulator & 0x0f) + (value & 0x0f) + carry > 0x0f;
    this.flags.cy = result > 0xff;
    this.a = byte(result);
    this.setSZP(this.a);
  }

  private subtract(value: number, borrow: number, storeResult: boolean): void {
    const accumulator = byte(this.a);
    const operand = byte(value);
    const result = accumulator - operand - borrow;
    this.flags.ac = (accumulator & 0x0f) - (operand & 0x0f) - borrow < 0;
    this.flags.cy = result < 0;
    this.setSZP(byte(result));
    if (storeResult) this.a = byte(result);
  }

  private decimalAdjustAccumulator(): void {
    const accumulator = byte(this.a);
    let correction = 0;
    const adjustLow = (accumulator & 0x0f) > 9 || this.flags.ac;
    const adjustHigh = accumulator > 0x99 || this.flags.cy;
    if (adjustLow) correction |= 0x06;
    if (adjustHigh) correction |= 0x60;
    const result = accumulator + correction;
    this.flags.ac = adjustLow && (accumulator & 0x0f) + 6 > 0x0f;
    this.flags.cy = adjustHigh || result > 0xff;
    this.a = byte(result);
    this.setSZP(this.a);
  }

  private setSZP(value: number): void {
    const result = byte(value);
    this.flags.s = (result & 0x80) !== 0;
    this.flags.z = result === 0;
    let bits = result;
    let ones = 0;
    while (bits !== 0) {
      ones += bits & 1;
      bits >>>= 1;
    }
    this.flags.p = (ones & 1) === 0;
  }

  private condition(index: number): boolean {
    switch (index & 7) {
      case 0: return !this.flags.z;
      case 1: return this.flags.z;
      case 2: return !this.flags.cy;
      case 3: return this.flags.cy;
      case 4: return !this.flags.p;
      case 5: return this.flags.p;
      case 6: return !this.flags.s;
      default: return this.flags.s;
    }
  }

  private packFlags(): number {
    return (
      (this.flags.s ? 0x80 : 0) |
      (this.flags.z ? 0x40 : 0) |
      (this.flags.ac ? 0x10 : 0) |
      (this.flags.p ? 0x04 : 0) |
      0x02 |
      (this.flags.cy ? 0x01 : 0)
    );
  }

  private unpackFlags(value: number): void {
    const packed = byte(value);
    this.flags.s = (packed & 0x80) !== 0;
    this.flags.z = (packed & 0x40) !== 0;
    this.flags.ac = (packed & 0x10) !== 0;
    this.flags.p = (packed & 0x04) !== 0;
    this.flags.cy = (packed & 0x01) !== 0;
  }
}

export default CPU8085;
