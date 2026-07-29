import type { CPU8085Flags, CPU8085State, StepResult } from "./cpu8085";

export interface InstructionInsight {
  instruction: string;
  purpose: string;
  action: string;
  effect: string;
}

const REGISTERS = ["B", "C", "D", "E", "H", "L", "M", "A"] as const;
const PAIRS = ["BC", "DE", "HL", "SP"] as const;
const STACK_PAIRS = ["BC", "DE", "HL", "PSW"] as const;
const CONDITIONS = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"] as const;
const UNDOCUMENTED_NOP_OPCODES = new Set([
  0x08, 0x10, 0x18, 0x28, 0x38, 0xcb, 0xd9, 0xdd, 0xed, 0xfd,
]);

const byte = (value: number): number => value & 0xff;
const word = (value: number): number => value & 0xffff;
const bit = (value: boolean): "0" | "1" => (value ? "1" : "0");
const hex8 = (value: number): string =>
  `${byte(value).toString(16).toUpperCase().padStart(2, "0")}H`;
const hex16 = (value: number): string =>
  `${word(value).toString(16).toUpperCase().padStart(4, "0")}H`;
const hexMagnitude = (value: number): string =>
  `${Math.abs(value).toString(16).toUpperCase().padStart(2, "0")}H`;

type InsightContext = {
  before: CPU8085State;
  after: CPU8085State;
  step: StepResult;
  memory: Uint8Array;
  ports: Uint8Array;
};

type InsightBody = Omit<InstructionInsight, "instruction">;

export function packFlagRegister(flags: CPU8085Flags): number {
  return (
    (flags.s ? 0x80 : 0) |
    (flags.z ? 0x40 : 0) |
    (flags.ac ? 0x10 : 0) |
    (flags.p ? 0x04 : 0) |
    0x02 |
    (flags.cy ? 0x01 : 0)
  );
}

function pairValue(state: CPU8085State, index: number): number {
  switch (index & 3) {
    case 0:
      return state.bc;
    case 1:
      return state.de;
    case 2:
      return state.hl;
    default:
      return state.sp;
  }
}

function memoryBefore(context: InsightContext, address: number): number {
  const normalized = word(address);
  const firstWrite = context.step.memoryWrites.find(
    (write) => word(write.address) === normalized,
  );
  return firstWrite ? byte(firstWrite.previous) : byte(context.memory[normalized]);
}

function registerBefore(context: InsightContext, index: number): number {
  switch (index & 7) {
    case 0:
      return context.before.b;
    case 1:
      return context.before.c;
    case 2:
      return context.before.d;
    case 3:
      return context.before.e;
    case 4:
      return context.before.h;
    case 5:
      return context.before.l;
    case 6:
      return memoryBefore(context, context.before.hl);
    default:
      return context.before.a;
  }
}

function registerAfter(context: InsightContext, index: number): number {
  switch (index & 7) {
    case 0:
      return context.after.b;
    case 1:
      return context.after.c;
    case 2:
      return context.after.d;
    case 3:
      return context.after.e;
    case 4:
      return context.after.h;
    case 5:
      return context.after.l;
    case 6:
      return byte(context.memory[context.before.hl]);
    default:
      return context.after.a;
  }
}

function operandText(
  context: InsightContext,
  registerIndex: number,
  value = registerBefore(context, registerIndex),
): string {
  const name = REGISTERS[registerIndex & 7];
  return name === "M"
    ? `M[${hex16(context.before.hl)}]=${hex8(value)}`
    : `${name}=${hex8(value)}`;
}

function transition(name: string, before: number, after: number, width = 8): string {
  const format = width === 16 ? hex16 : hex8;
  return before === after
    ? `${name} remains ${format(after)}`
    : `${name} ${format(before)}→${format(after)}`;
}

function memoryWriteText(step: StepResult): string {
  return step.memoryWrites
    .map(
      (write) =>
        `[${hex16(write.address)}] written ${hex8(write.previous)}→${hex8(write.value)}`,
    )
    .join("; ");
}

function portWriteText(step: StepResult): string {
  return step.portWrites
    .map(
      (write) =>
        `port ${hex8(write.port)} written ${hex8(write.previous)}→${hex8(write.value)}`,
    )
    .join("; ");
}

function szpText(flags: CPU8085Flags, result: number): string {
  const ones = byte(result)
    .toString(2)
    .split("")
    .filter((digit) => digit === "1").length;
  return `S=${bit(flags.s)} (D7=${bit((byte(result) & 0x80) !== 0)}), Z=${bit(flags.z)}, P=${bit(flags.p)} (${ones % 2 === 0 ? "even" : "odd"} parity)`;
}

function flagsUnchanged(before: CPU8085Flags, after: CPU8085Flags): boolean {
  return (
    before.s === after.s &&
    before.z === after.z &&
    before.ac === after.ac &&
    before.p === after.p &&
    before.cy === after.cy
  );
}

function unchangedFlagsText(context: InsightContext): string {
  return flagsUnchanged(context.before.flags, context.after.flags)
    ? "flags unchanged"
    : `F ${hex8(packFlagRegister(context.before.flags))}→${hex8(packFlagRegister(context.after.flags))}`;
}

function conditionResult(flags: CPU8085Flags, index: number): boolean {
  switch (index & 7) {
    case 0:
      return !flags.z;
    case 1:
      return flags.z;
    case 2:
      return !flags.cy;
    case 3:
      return flags.cy;
    case 4:
      return !flags.p;
    case 5:
      return flags.p;
    case 6:
      return !flags.s;
    default:
      return flags.s;
  }
}

function conditionText(flags: CPU8085Flags, index: number): string {
  switch (index & 7) {
    case 0:
      return `NZ tests Z=${bit(flags.z)}`;
    case 1:
      return `Z tests Z=${bit(flags.z)}`;
    case 2:
      return `NC tests CY=${bit(flags.cy)}`;
    case 3:
      return `C tests CY=${bit(flags.cy)}`;
    case 4:
      return `PO tests P=${bit(flags.p)}`;
    case 5:
      return `PE tests P=${bit(flags.p)}`;
    case 6:
      return `P tests S=${bit(flags.s)}`;
    default:
      return `M tests S=${bit(flags.s)}`;
  }
}

function immediate8(step: StepResult): number {
  return byte(step.bytes[1] ?? 0);
}

function immediate16(step: StepResult): number {
  return immediate8(step) | (byte(step.bytes[2] ?? 0) << 8);
}

function arithmeticBody(
  context: InsightContext,
  operation: number,
  operand: number,
  operandDescription: string,
): InsightBody {
  const accumulator = byte(context.before.a);
  const carryIn = context.before.flags.cy ? 1 : 0;

  if (operation === 0 || operation === 1) {
    const usesCarry = operation === 1;
    const addend = usesCarry ? carryIn : 0;
    const raw = accumulator + operand + addend;
    const operator = usesCarry
      ? `${hex8(accumulator)} + ${hex8(operand)} + CY(${addend})`
      : `${hex8(accumulator)} + ${hex8(operand)}`;
    return {
      purpose: usesCarry
        ? "Add the operand and incoming Carry to the Accumulator"
        : "Add the operand to the Accumulator",
      action: `${operator} = ${raw > 0xff ? hexMagnitude(raw) : hex8(raw)}; operand ${operandDescription}`,
      effect: `${transition("A", accumulator, context.after.a)}; CY=${bit(context.after.flags.cy)} (${raw > 0xff ? "carry beyond D7" : "no carry beyond D7"}), AC=${bit(context.after.flags.ac)} (${context.after.flags.ac ? "low-nibble carry" : "no low-nibble carry"}); ${szpText(context.after.flags, context.after.a)}`,
    };
  }

  if (operation === 2 || operation === 3 || operation === 7) {
    const isCompare = operation === 7;
    const usesBorrow = operation === 3;
    const borrowIn = usesBorrow ? carryIn : 0;
    const raw = accumulator - operand - borrowIn;
    const result = byte(raw);
    const operator = usesBorrow
      ? `${hex8(accumulator)} - ${hex8(operand)} - CY(${borrowIn})`
      : `${hex8(accumulator)} - ${hex8(operand)}`;
    return {
      purpose: isCompare
        ? "Compare the operand with the Accumulator using an internal subtraction"
        : usesBorrow
          ? "Subtract the operand and incoming borrow from the Accumulator"
          : "Subtract the operand from the Accumulator",
      action: `${operator} = ${raw < 0 ? `-${hexMagnitude(raw)} (8-bit ${hex8(result)})` : hex8(raw)}; operand ${operandDescription}`,
      effect: `${isCompare ? `A remains ${hex8(accumulator)}` : transition("A", accumulator, context.after.a)}; CY=${bit(context.after.flags.cy)} (${raw < 0 ? "unsigned borrow required" : "no unsigned borrow"}), AC=${bit(context.after.flags.ac)} (${context.after.flags.ac ? "low-nibble borrow" : "no low-nibble borrow"}); ${szpText(context.after.flags, result)}`,
    };
  }

  const result = context.after.a;
  const operator = operation === 4 ? "AND" : operation === 5 ? "XOR" : "OR";
  const purpose =
    operation === 4
      ? "Logically AND the operand with the Accumulator"
      : operation === 5
        ? "Logically XOR the operand with the Accumulator"
        : "Logically OR the operand with the Accumulator";
  const forcedFlags =
    operation === 4
      ? "AC=1 and CY=0 for logical AND"
      : `AC=0 and CY=0 for logical ${operation === 5 ? "XOR" : "OR"}`;
  return {
    purpose,
    action: `${hex8(accumulator)} ${operator} ${hex8(operand)} = ${hex8(result)}; operand ${operandDescription}`,
    effect: `${transition("A", accumulator, result)}; ${forcedFlags}; ${szpText(context.after.flags, result)}`,
  };
}

function explainMove(context: InsightContext, destination: number, source: number): InsightBody {
  const value = registerBefore(context, source);
  const destinationName = REGISTERS[destination];
  const sourceDescription = operandText(context, source, value);

  if (destination === 6) {
    return {
      purpose: `Copy ${REGISTERS[source]} into the memory byte addressed by HL`,
      action: `${sourceDescription} → M[${hex16(context.before.hl)}]`,
      effect: `${memoryWriteText(context.step)}; ${unchangedFlagsText(context)}`,
    };
  }

  const beforeValue = registerBefore(context, destination);
  const afterValue = registerAfter(context, destination);
  return {
    purpose: `Copy ${REGISTERS[source]} into ${destinationName}`,
    action: `${sourceDescription} → ${destinationName}`,
    effect: `${transition(destinationName, beforeValue, afterValue)}; ${unchangedFlagsText(context)}`,
  };
}

function explainIncrement(
  context: InsightContext,
  register: number,
  increment: boolean,
): InsightBody {
  const name = REGISTERS[register];
  const beforeValue = registerBefore(context, register);
  const afterValue = registerAfter(context, register);
  const operation = increment ? "+" : "-";
  const carryDescription = `CY remains ${bit(context.after.flags.cy)}`;
  const acDescription = increment
    ? context.after.flags.ac
      ? "low-nibble carry"
      : "no low-nibble carry"
    : context.after.flags.ac
      ? "low-nibble borrow"
      : "no low-nibble borrow";
  const destination =
    name === "M" ? `M[${hex16(context.before.hl)}]` : name;
  return {
    purpose: `${increment ? "Increment" : "Decrement"} ${name === "M" ? "the memory byte addressed by HL" : `register ${name}`} by one`,
    action: `${destination}=${hex8(beforeValue)} ${operation} 01H = ${hex8(afterValue)}`,
    effect: `${name === "M" ? memoryWriteText(context.step) : transition(name, beforeValue, afterValue)}; ${carryDescription}; AC=${bit(context.after.flags.ac)} (${acDescription}); ${szpText(context.after.flags, afterValue)}`,
  };
}

function explainConditionalJump(context: InsightContext, condition: number): InsightBody {
  const target = immediate16(context.step);
  const taken = conditionResult(context.before.flags, condition);
  return {
    purpose: `Jump to ${hex16(target)} when condition ${CONDITIONS[condition]} is true`,
    action: `${conditionText(context.before.flags, condition)}: ${taken ? "true" : "false"}`,
    effect: `${taken ? "Jump taken" : "Jump not taken"}; PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}; flags unchanged`,
  };
}

function explainConditionalCall(context: InsightContext, condition: number): InsightBody {
  const target = immediate16(context.step);
  const taken = conditionResult(context.before.flags, condition);
  return {
    purpose: `Call ${hex16(target)} when condition ${CONDITIONS[condition]} is true`,
    action: taken
      ? `${conditionText(context.before.flags, condition)}: true; return address ${hex16(word(context.before.pc + 3))} pushed`
      : `${conditionText(context.before.flags, condition)}: false; stack not written`,
    effect: taken
      ? `Call taken; PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}, SP ${hex16(context.before.sp)}→${hex16(context.after.sp)}; ${memoryWriteText(context.step)}`
      : `Call not taken; PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}; SP and flags unchanged`,
  };
}

function explainConditionalReturn(context: InsightContext, condition: number): InsightBody {
  const taken = conditionResult(context.before.flags, condition);
  const low = memoryBefore(context, context.before.sp);
  const high = memoryBefore(context, context.before.sp + 1);
  const returnAddress = low | (high << 8);
  return {
    purpose: `Return from the subroutine when condition ${CONDITIONS[condition]} is true`,
    action: taken
      ? `${conditionText(context.before.flags, condition)}: true; return ${hex16(returnAddress)} read from [${hex16(context.before.sp)}]/[${hex16(context.before.sp + 1)}]`
      : `${conditionText(context.before.flags, condition)}: false; stack not read`,
    effect: taken
      ? `Return taken; PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}, SP ${hex16(context.before.sp)}→${hex16(context.after.sp)}; flags unchanged`
      : `Return not taken; PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}; SP and flags unchanged`,
  };
}

function explainPush(context: InsightContext, pair: number): InsightBody {
  const pairName = STACK_PAIRS[pair];
  const value =
    pair === 3
      ? (byte(context.before.a) << 8) | packFlagRegister(context.before.flags)
      : pairValue(context.before, pair);
  return {
    purpose: `Push ${pairName} onto the stack`,
    action:
      pair === 3
        ? `PSW=${hex16(value)} combines A=${hex8(context.before.a)} and F=${hex8(packFlagRegister(context.before.flags))}`
        : `${pairName}=${hex16(value)}; high byte then low byte written while SP decrements`,
    effect: `SP ${hex16(context.before.sp)}→${hex16(context.after.sp)}; ${memoryWriteText(context.step)}; source registers and flags unchanged`,
  };
}

function explainPop(context: InsightContext, pair: number): InsightBody {
  const pairName = STACK_PAIRS[pair];
  const lowAddress = context.before.sp;
  const highAddress = word(context.before.sp + 1);
  const low = memoryBefore(context, lowAddress);
  const high = memoryBefore(context, highAddress);
  const value = low | (high << 8);
  const valueDescription = `[${hex16(lowAddress)}]=${hex8(low)}, [${hex16(highAddress)}]=${hex8(high)} → ${hex16(value)}`;

  if (pair === 3) {
    return {
      purpose: "Restore the Accumulator and Flag Register from the stack",
      action: `${valueDescription}; high byte → A, low byte → flags`,
      effect: `${transition("A", context.before.a, context.after.a)}; F ${hex8(packFlagRegister(context.before.flags))}→${hex8(packFlagRegister(context.after.flags))} (D5/D3=0, D1=1 normalized); SP ${hex16(context.before.sp)}→${hex16(context.after.sp)}`,
    };
  }

  return {
    purpose: `Restore ${pairName} from the stack`,
    action: valueDescription,
    effect: `${transition(pairName, pairValue(context.before, pair), pairValue(context.after, pair), 16)}; SP ${hex16(context.before.sp)}→${hex16(context.after.sp)}; flags unchanged`,
  };
}

function explainOpcode(context: InsightContext): InsightBody {
  const opcode = byte(context.step.opcode);

  if (context.step.bytes.length === 0 && context.step.mnemonic === "HALTED") {
    return {
      purpose: "Report that the processor was already halted",
      action: "No instruction was executed",
      effect: "CPU state and cycle count remain unchanged",
    };
  }

  if (UNDOCUMENTED_NOP_OPCODES.has(opcode)) {
    return {
      purpose: "Execute an undocumented opcode hole as a stable one-byte NOP",
      action: `Opcode ${hex8(opcode)} performs no processor data operation`,
      effect: `PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}; data registers, memory, ports, and flags unchanged`,
    };
  }

  if (opcode >= 0x40 && opcode <= 0x7f) {
    if (opcode === 0x76) {
      return {
        purpose: "Halt instruction execution in the current engine",
        action: `HLT completed at ${hex16(context.before.pc)}`,
        effect: `CPU halted; PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}; data registers and flags unchanged`,
      };
    }
    return explainMove(context, (opcode >>> 3) & 7, opcode & 7);
  }

  if (opcode >= 0x80 && opcode <= 0xbf) {
    const operation = (opcode >>> 3) & 7;
    const source = opcode & 7;
    const operand = registerBefore(context, source);
    return arithmeticBody(context, operation, operand, operandText(context, source, operand));
  }

  if ((opcode & 0xcf) === 0x01) {
    const pair = (opcode >>> 4) & 3;
    const value = immediate16(context.step);
    return {
      purpose: `Load the 16-bit immediate value into ${PAIRS[pair]}`,
      action: `${hex16(value)} → ${PAIRS[pair]}`,
      effect: `${transition(PAIRS[pair], pairValue(context.before, pair), pairValue(context.after, pair), 16)}; flags unchanged`,
    };
  }

  if ((opcode & 0xef) === 0x02) {
    const pair = (opcode >>> 4) & 1;
    const address = pairValue(context.before, pair);
    return {
      purpose: `Store the Accumulator in the memory byte addressed by ${PAIRS[pair]}`,
      action: `A=${hex8(context.before.a)} → [${hex16(address)}]`,
      effect: `${memoryWriteText(context.step)}; A and flags unchanged`,
    };
  }

  if ((opcode & 0xcf) === 0x03 || (opcode & 0xcf) === 0x0b) {
    const pair = (opcode >>> 4) & 3;
    const increment = (opcode & 0x0f) === 0x03;
    const beforeValue = pairValue(context.before, pair);
    const afterValue = pairValue(context.after, pair);
    return {
      purpose: `${increment ? "Increment" : "Decrement"} ${PAIRS[pair]} by one`,
      action: `${hex16(beforeValue)} ${increment ? "+" : "-"} 0001H = ${hex16(afterValue)}`,
      effect: `${transition(PAIRS[pair], beforeValue, afterValue, 16)}; flags unchanged`,
    };
  }

  if ((opcode & 0xc7) === 0x04 || (opcode & 0xc7) === 0x05) {
    return explainIncrement(context, (opcode >>> 3) & 7, (opcode & 7) === 4);
  }

  if ((opcode & 0xc7) === 0x06) {
    const register = (opcode >>> 3) & 7;
    const name = REGISTERS[register];
    const value = immediate8(context.step);
    if (register === 6) {
      return {
        purpose: "Load an immediate byte into the memory location addressed by HL",
        action: `${hex8(value)} → M[${hex16(context.before.hl)}]`,
        effect: `${memoryWriteText(context.step)}; flags unchanged`,
      };
    }
    return {
      purpose: `Load an immediate byte into register ${name}`,
      action: `${hex8(value)} → ${name}`,
      effect: `${transition(name, registerBefore(context, register), registerAfter(context, register))}; flags unchanged`,
    };
  }

  if ((opcode & 0xcf) === 0x09) {
    const pair = (opcode >>> 4) & 3;
    const left = context.before.hl;
    const right = pairValue(context.before, pair);
    const raw = left + right;
    return {
      purpose: `Add ${PAIRS[pair]} to HL as a 16-bit value`,
      action: `${hex16(left)} + ${hex16(right)} = ${raw > 0xffff ? hexMagnitude(raw) : hex16(raw)}`,
      effect: `${transition("HL", left, context.after.hl, 16)}; CY=${bit(context.after.flags.cy)} (${raw > 0xffff ? "carry beyond D15" : "no carry beyond D15"}); S, Z, AC, and P unchanged`,
    };
  }

  if ((opcode & 0xef) === 0x0a) {
    const pair = (opcode >>> 4) & 1;
    const address = pairValue(context.before, pair);
    const value = memoryBefore(context, address);
    return {
      purpose: `Load the Accumulator from the memory byte addressed by ${PAIRS[pair]}`,
      action: `[${hex16(address)}]=${hex8(value)} → A`,
      effect: `${transition("A", context.before.a, context.after.a)}; flags unchanged`,
    };
  }

  if ((opcode & 0xc7) === 0xc0) {
    return explainConditionalReturn(context, (opcode >>> 3) & 7);
  }

  if ((opcode & 0xcf) === 0xc1) {
    return explainPop(context, (opcode >>> 4) & 3);
  }

  if ((opcode & 0xc7) === 0xc2) {
    return explainConditionalJump(context, (opcode >>> 3) & 7);
  }

  if ((opcode & 0xc7) === 0xc4) {
    return explainConditionalCall(context, (opcode >>> 3) & 7);
  }

  if ((opcode & 0xcf) === 0xc5) {
    return explainPush(context, (opcode >>> 4) & 3);
  }

  if ((opcode & 0xc7) === 0xc6) {
    const operation = (opcode >>> 3) & 7;
    const operand = immediate8(context.step);
    return arithmeticBody(context, operation, operand, `data=${hex8(operand)}`);
  }

  if ((opcode & 0xc7) === 0xc7) {
    const target = opcode & 0x38;
    return {
      purpose: `Call restart vector ${hex16(target)}`,
      action: `Return address ${hex16(word(context.before.pc + 1))} pushed; PC loaded with vector ${hex16(target)}`,
      effect: `PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}, SP ${hex16(context.before.sp)}→${hex16(context.after.sp)}; ${memoryWriteText(context.step)}; flags unchanged`,
    };
  }

  switch (opcode) {
    case 0x00:
      return {
        purpose: "Perform no processor data operation",
        action: "One-byte NOP completed",
        effect: `PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}; data registers, memory, ports, and flags unchanged`,
      };
    case 0x07:
    case 0x0f:
    case 0x17:
    case 0x1f: {
      const left = opcode === 0x07 || opcode === 0x17;
      const throughCarry = opcode === 0x17 || opcode === 0x1f;
      const outgoing = left
        ? (byte(context.before.a) >>> 7) & 1
        : byte(context.before.a) & 1;
      const incoming = context.before.flags.cy ? 1 : 0;
      const name = opcode === 0x07 ? "RLC" : opcode === 0x0f ? "RRC" : opcode === 0x17 ? "RAL" : "RAR";
      return {
        purpose: `${left ? "Rotate the Accumulator left" : "Rotate the Accumulator right"}${throughCarry ? " through Carry" : ""}`,
        action: `${name}: A=${hex8(context.before.a)}; outgoing D${left ? "7" : "0"}=${outgoing}${throughCarry ? `, incoming CY=${incoming}` : ""}`,
        effect: `${transition("A", context.before.a, context.after.a)}; CY=${bit(context.after.flags.cy)}; S, Z, AC, and P unchanged`,
      };
    }
    case 0x20: {
      const value = context.after.a;
      return {
        purpose: "Read serial input and interrupt status into the Accumulator",
        action: `SID=${bit((value & 0x80) !== 0)}; pending 7.5/6.5/5.5=${bit((value & 0x40) !== 0)}${bit((value & 0x20) !== 0)}${bit((value & 0x10) !== 0)}; IE sampled=${bit((value & 0x08) !== 0)}; masks 7.5/6.5/5.5=${bit((value & 0x04) !== 0)}${bit((value & 0x02) !== 0)}${bit((value & 0x01) !== 0)}`,
        effect: `${transition("A", context.before.a, value)}; flags unchanged`,
      };
    }
    case 0x22: {
      const address = immediate16(context.step);
      return {
        purpose: "Store L and H in two consecutive memory bytes",
        action: `L=${hex8(context.before.l)} → [${hex16(address)}]; H=${hex8(context.before.h)} → [${hex16(address + 1)}]`,
        effect: `${memoryWriteText(context.step)}; HL and flags unchanged`,
      };
    }
    case 0x27: {
      const adjustLow = (context.before.a & 0x0f) > 9 || context.before.flags.ac;
      const adjustHigh = context.before.a > 0x99 || context.before.flags.cy;
      const correction = (adjustLow ? 0x06 : 0) | (adjustHigh ? 0x60 : 0);
      const raw = context.before.a + correction;
      const reasons = [
        adjustLow ? "06H low-digit correction" : "",
        adjustHigh ? "60H high-digit correction" : "",
      ].filter(Boolean);
      return {
        purpose: "Apply the 8085 decimal adjustment after a packed-BCD addition",
        action: `A=${hex8(context.before.a)} + correction ${hex8(correction)}${reasons.length ? ` (${reasons.join(" + ")})` : " (no correction required)"} = ${raw > 0xff ? hexMagnitude(raw) : hex8(raw)}`,
        effect: `${transition("A", context.before.a, context.after.a)}; CY=${bit(context.after.flags.cy)}, AC=${bit(context.after.flags.ac)}; ${szpText(context.after.flags, context.after.a)}`,
      };
    }
    case 0x2a: {
      const address = immediate16(context.step);
      const low = memoryBefore(context, address);
      const high = memoryBefore(context, address + 1);
      return {
        purpose: "Load L and H from two consecutive memory bytes",
        action: `[${hex16(address)}]=${hex8(low)} → L; [${hex16(address + 1)}]=${hex8(high)} → H`,
        effect: `${transition("HL", context.before.hl, context.after.hl, 16)}; flags unchanged`,
      };
    }
    case 0x2f:
      return {
        purpose: "Complement every bit of the Accumulator",
        action: `NOT ${hex8(context.before.a)} = ${hex8(context.after.a)}`,
        effect: `${transition("A", context.before.a, context.after.a)}; flags unchanged`,
      };
    case 0x30: {
      const accumulator = byte(context.before.a);
      const maskSetEnable = (accumulator & 0x08) !== 0;
      const reset75 = (accumulator & 0x10) !== 0;
      const serialOutputEnable = (accumulator & 0x40) !== 0;
      const serialOutputData = (accumulator & 0x80) !== 0;
      const maskBits = `${bit((accumulator & 0x04) !== 0)}${bit((accumulator & 0x02) !== 0)}${bit((accumulator & 0x01) !== 0)}`;
      const masksAfter = `${bit(context.after.interruptMasks.rst75)}${bit(context.after.interruptMasks.rst65)}${bit(context.after.interruptMasks.rst55)}`;
      return {
        purpose: "Apply interrupt-mask, RST7.5-reset, and serial-output controls from the Accumulator",
        action: `A=${hex8(accumulator)}; MSE=${bit(maskSetEnable)} (mask bits ${maskBits}); reset7.5=${bit(reset75)}; SOE=${bit(serialOutputEnable)}, SOD=${bit(serialOutputData)}`,
        effect: `Masks ${maskSetEnable ? `set to ${masksAfter}` : `remain ${masksAfter}`}; RST7.5 pending ${reset75 ? "reset to 0" : `remains ${bit(context.after.pendingInterrupts.rst75)}`}; serial output ${serialOutputEnable ? `set to ${bit(context.after.serialOutput)}` : `remains ${bit(context.after.serialOutput)}`}; A and flags unchanged`,
      };
    }
    case 0x32: {
      const address = immediate16(context.step);
      return {
        purpose: "Store the Accumulator at the direct memory address",
        action: `A=${hex8(context.before.a)} → [${hex16(address)}]`,
        effect: `${memoryWriteText(context.step)}; A and flags unchanged`,
      };
    }
    case 0x37:
      return {
        purpose: "Set the Carry flag",
        action: `CY ${bit(context.before.flags.cy)}→1`,
        effect: "CY=1; S, Z, AC, P, data registers, and memory unchanged",
      };
    case 0x3a: {
      const address = immediate16(context.step);
      const value = memoryBefore(context, address);
      return {
        purpose: "Load the Accumulator from the direct memory address",
        action: `[${hex16(address)}]=${hex8(value)} → A`,
        effect: `${transition("A", context.before.a, context.after.a)}; flags unchanged`,
      };
    }
    case 0x3f:
      return {
        purpose: "Complement the Carry flag",
        action: `CY ${bit(context.before.flags.cy)}→${bit(context.after.flags.cy)}`,
        effect: `CY=${bit(context.after.flags.cy)}; S, Z, AC, P, data registers, and memory unchanged`,
      };
    case 0xc3: {
      const target = immediate16(context.step);
      return {
        purpose: `Jump unconditionally to ${hex16(target)}`,
        action: `${hex16(target)} loaded into PC`,
        effect: `PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}; general-purpose registers and flags unchanged`,
      };
    }
    case 0xc9: {
      const low = memoryBefore(context, context.before.sp);
      const high = memoryBefore(context, context.before.sp + 1);
      const address = low | (high << 8);
      return {
        purpose: "Return unconditionally from the subroutine",
        action: `${hex16(address)} read from [${hex16(context.before.sp)}]=${hex8(low)} and [${hex16(context.before.sp + 1)}]=${hex8(high)}`,
        effect: `PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}, SP ${hex16(context.before.sp)}→${hex16(context.after.sp)}; flags unchanged`,
      };
    }
    case 0xcd: {
      const target = immediate16(context.step);
      return {
        purpose: `Call subroutine ${hex16(target)} unconditionally`,
        action: `Return address ${hex16(word(context.before.pc + 3))} pushed; ${hex16(target)} loaded into PC`,
        effect: `PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}, SP ${hex16(context.before.sp)}→${hex16(context.after.sp)}; ${memoryWriteText(context.step)}; flags unchanged`,
      };
    }
    case 0xd3: {
      const port = immediate8(context.step);
      return {
        purpose: "Write the Accumulator to an 8-bit output port",
        action: `A=${hex8(context.before.a)} → port ${hex8(port)}`,
        effect: `${portWriteText(context.step)}; A and flags unchanged`,
      };
    }
    case 0xdb: {
      const port = immediate8(context.step);
      const value = byte(context.ports[port]);
      return {
        purpose: "Read an 8-bit input port into the Accumulator",
        action: `Port ${hex8(port)}=${hex8(value)} → A`,
        effect: `${transition("A", context.before.a, context.after.a)}; flags unchanged`,
      };
    }
    case 0xe3: {
      const stackLow = memoryBefore(context, context.before.sp);
      const stackHigh = memoryBefore(context, context.before.sp + 1);
      return {
        purpose: "Exchange HL with the top two stack bytes",
        action: `L=${hex8(context.before.l)} ↔ [${hex16(context.before.sp)}]=${hex8(stackLow)}; H=${hex8(context.before.h)} ↔ [${hex16(context.before.sp + 1)}]=${hex8(stackHigh)}`,
        effect: `${transition("HL", context.before.hl, context.after.hl, 16)}; ${memoryWriteText(context.step)}; SP and flags unchanged`,
      };
    }
    case 0xe9:
      return {
        purpose: "Load the Program Counter from HL",
        action: `HL=${hex16(context.before.hl)} → PC`,
        effect: `PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}; HL and flags unchanged`,
      };
    case 0xeb:
      return {
        purpose: "Exchange the DE and HL register pairs",
        action: `DE=${hex16(context.before.de)} ↔ HL=${hex16(context.before.hl)}`,
        effect: `DE=${hex16(context.after.de)}, HL=${hex16(context.after.hl)}; flags unchanged`,
      };
    case 0xf3:
      return {
        purpose: "Disable maskable interrupts immediately",
        action: `IE ${bit(context.before.interruptEnabled)}→0; deferred EI request ${context.before.interruptEnablePending ? "cancelled" : "was not pending"}`,
        effect: "Interrupts disabled and deferred enable cleared; data registers and flags unchanged",
      };
    case 0xf9:
      return {
        purpose: "Copy HL into the Stack Pointer",
        action: `HL=${hex16(context.before.hl)} → SP`,
        effect: `${transition("SP", context.before.sp, context.after.sp, 16)}; HL and flags unchanged`,
      };
    case 0xfb:
      return {
        purpose: "Schedule maskable interrupts to be enabled after the following instruction",
        action: "A deferred interrupt-enable request was set",
        effect: `IE=${bit(context.after.interruptEnabled)} now; deferred enable pending=1; data registers and flags unchanged`,
      };
    default:
      return {
        purpose: "Execute the decoded instruction",
        action: `Opcode ${hex8(opcode)} completed`,
        effect: `PC ${hex16(context.before.pc)}→${hex16(context.after.pc)}`,
      };
  }
}

function appendDeferredInterruptEffect(
  context: InsightContext,
  effect: string,
): string {
  if (
    context.step.opcode !== 0xf3 &&
    context.before.interruptEnablePending &&
    !context.before.interruptEnabled &&
    context.after.interruptEnabled
  ) {
    return `${effect}; deferred EI became active after this instruction`;
  }
  return effect;
}

export function createInstructionInsight(context: {
  before: CPU8085State;
  after: CPU8085State;
  step: StepResult;
  memory: Uint8Array;
  ports: Uint8Array;
}): InstructionInsight {
  const normalizedContext: InsightContext = context;
  const opcode = byte(context.step.opcode);
  const body = explainOpcode(normalizedContext);
  const instruction = UNDOCUMENTED_NOP_OPCODES.has(opcode)
    ? `NOP* ${hex8(opcode)}`
    : context.step.mnemonic || `OPCODE ${hex8(opcode)}`;
  return {
    instruction,
    purpose: body.purpose,
    action: body.action,
    effect: appendDeferredInterruptEffect(normalizedContext, body.effect),
  };
}
