/**
 * A dependency-free, two-pass Intel 8085 assembler.
 *
 * The implementation intentionally has no Node.js dependencies so it can run in
 * a browser, Web Worker, server component, or test runner.
 */

export type InstructionCategory =
  | "data-transfer"
  | "arithmetic"
  | "logical"
  | "branch"
  | "stack-io"
  | "machine-control";

export interface InstructionMetadata {
  mnemonic: string;
  syntax: string;
  operands: string;
  bytes: 1 | 2 | 3;
  opcode: string;
  tStates: string;
  category: InstructionCategory;
  description: string;
}

type InstructionMetadataDefinition = Omit<InstructionMetadata, "tStates">;

export interface AssemblyError {
  /** One-based source line; zero is reserved for invalid assembler options. */
  line: number;
  message: string;
}

export interface AssemblyListingEntry {
  line: number;
  /** Address at which the line takes effect, or null for blank/comment lines. */
  address: number | null;
  bytes: number[];
  source: string;
}

export interface AssemblySegment {
  origin: number;
  bytes: number[];
}

export interface Assemble8085Result {
  success: boolean;
  /** Lowest emitted address, or defaultOrigin when no bytes were emitted. */
  origin: number;
  /**
   * Address of the first instruction in source order. Data-only programs fall
   * back to origin.
   */
  entryPoint: number;
  /**
   * A contiguous image beginning at origin. Gaps made by ORG are zero-filled.
   * Use segments when gaps must be distinguished from emitted zeroes.
   */
  bytes: number[];
  segments: AssemblySegment[];
  /** Symbol names are returned in canonical upper-case form. */
  symbols: Record<string, number>;
  listing: AssemblyListingEntry[];
  /** Maps every emitted/reserved address to its one-based source line. */
  addressToLine: Record<number, number>;
  errors: AssemblyError[];
}

/**
 * Instruction reference data suitable for autocomplete, a help panel, or a
 * mnemonic picker. Opcode strings use Intel's conventional r/rp placeholders.
 */
function timingEntries(
  mnemonics: readonly string[],
  tStates: string,
): Record<string, string> {
  return Object.fromEntries(mnemonics.map((mnemonic) => [mnemonic, tStates]));
}

const INSTRUCTION_T_STATES: Readonly<Record<string, string>> = {
  MOV: "4 (register), 7 (memory)",
  MVI: "7 (register), 10 (memory)",
  INR: "4 (register), 10 (memory)",
  DCR: "4 (register), 10 (memory)",
  ...timingEntries(
    ["ADD", "ADC", "SUB", "SBB", "ANA", "XRA", "ORA", "CMP"],
    "4 (register), 7 (memory)",
  ),
  ...timingEntries(
    ["ADI", "ACI", "SUI", "SBI", "ANI", "XRI", "ORI", "CPI", "LDAX", "STAX"],
    "7",
  ),
  ...timingEntries(["INX", "DCX", "PCHL", "SPHL"], "6"),
  ...timingEntries(["LXI", "DAD", "JMP", "RET", "POP", "IN", "OUT"], "10"),
  ...timingEntries(["LDA", "STA"], "13"),
  ...timingEntries(["LHLD", "SHLD", "XTHL"], "16"),
  ...timingEntries(
    ["XCHG", "DAA", "RLC", "RRC", "RAL", "RAR", "CMA", "CMC", "STC", "NOP", "EI", "DI", "RIM", "SIM"],
    "4",
  ),
  ...timingEntries(["JNZ", "JZ", "JNC", "JC", "JPO", "JPE", "JP", "JM"], "7 (not taken), 10 (taken)"),
  CALL: "18",
  ...timingEntries(["CNZ", "CZ", "CNC", "CC", "CPO", "CPE", "CP", "CM"], "9 (not taken), 18 (taken)"),
  ...timingEntries(["RNZ", "RZ", "RNC", "RC", "RPO", "RPE", "RP", "RM"], "6 (not taken), 12 (taken)"),
  ...timingEntries(["PUSH", "RST"], "12"),
  HLT: "5",
};

const INSTRUCTION_DEFINITIONS_8085: readonly InstructionMetadataDefinition[] = [
  {
    mnemonic: "MOV",
    syntax: "MOV dst, src",
    operands: "r, r",
    bytes: 1,
    opcode: "01dddsss",
    category: "data-transfer",
    description: "Copy an 8-bit register or memory value.",
  },
  {
    mnemonic: "MVI",
    syntax: "MVI r, data8",
    operands: "r, data8",
    bytes: 2,
    opcode: "00ddd110",
    category: "data-transfer",
    description: "Load an 8-bit immediate value.",
  },
  {
    mnemonic: "LXI",
    syntax: "LXI rp, data16",
    operands: "rp, data16",
    bytes: 3,
    opcode: "00rp0001",
    category: "data-transfer",
    description: "Load a register pair with a 16-bit immediate value.",
  },
  {
    mnemonic: "LDA",
    syntax: "LDA address",
    operands: "address16",
    bytes: 3,
    opcode: "3A",
    category: "data-transfer",
    description: "Load A directly from memory.",
  },
  {
    mnemonic: "STA",
    syntax: "STA address",
    operands: "address16",
    bytes: 3,
    opcode: "32",
    category: "data-transfer",
    description: "Store A directly in memory.",
  },
  {
    mnemonic: "LHLD",
    syntax: "LHLD address",
    operands: "address16",
    bytes: 3,
    opcode: "2A",
    category: "data-transfer",
    description: "Load L and H directly from two consecutive bytes.",
  },
  {
    mnemonic: "SHLD",
    syntax: "SHLD address",
    operands: "address16",
    bytes: 3,
    opcode: "22",
    category: "data-transfer",
    description: "Store L and H directly in two consecutive bytes.",
  },
  {
    mnemonic: "LDAX",
    syntax: "LDAX B|D",
    operands: "B|D",
    bytes: 1,
    opcode: "0A/1A",
    category: "data-transfer",
    description: "Load A indirectly through BC or DE.",
  },
  {
    mnemonic: "STAX",
    syntax: "STAX B|D",
    operands: "B|D",
    bytes: 1,
    opcode: "02/12",
    category: "data-transfer",
    description: "Store A indirectly through BC or DE.",
  },
  {
    mnemonic: "XCHG",
    syntax: "XCHG",
    operands: "",
    bytes: 1,
    opcode: "EB",
    category: "data-transfer",
    description: "Exchange HL and DE.",
  },

  {
    mnemonic: "ADD",
    syntax: "ADD r",
    operands: "r",
    bytes: 1,
    opcode: "80+r",
    category: "arithmetic",
    description: "Add a register or memory byte to A.",
  },
  {
    mnemonic: "ADI",
    syntax: "ADI data8",
    operands: "data8",
    bytes: 2,
    opcode: "C6",
    category: "arithmetic",
    description: "Add an immediate byte to A.",
  },
  {
    mnemonic: "ADC",
    syntax: "ADC r",
    operands: "r",
    bytes: 1,
    opcode: "88+r",
    category: "arithmetic",
    description: "Add a byte and carry to A.",
  },
  {
    mnemonic: "ACI",
    syntax: "ACI data8",
    operands: "data8",
    bytes: 2,
    opcode: "CE",
    category: "arithmetic",
    description: "Add an immediate byte and carry to A.",
  },
  {
    mnemonic: "SUB",
    syntax: "SUB r",
    operands: "r",
    bytes: 1,
    opcode: "90+r",
    category: "arithmetic",
    description: "Subtract a register or memory byte from A.",
  },
  {
    mnemonic: "SUI",
    syntax: "SUI data8",
    operands: "data8",
    bytes: 2,
    opcode: "D6",
    category: "arithmetic",
    description: "Subtract an immediate byte from A.",
  },
  {
    mnemonic: "SBB",
    syntax: "SBB r",
    operands: "r",
    bytes: 1,
    opcode: "98+r",
    category: "arithmetic",
    description: "Subtract a byte and borrow from A.",
  },
  {
    mnemonic: "SBI",
    syntax: "SBI data8",
    operands: "data8",
    bytes: 2,
    opcode: "DE",
    category: "arithmetic",
    description: "Subtract an immediate byte and borrow from A.",
  },
  {
    mnemonic: "INR",
    syntax: "INR r",
    operands: "r",
    bytes: 1,
    opcode: "04+8r",
    category: "arithmetic",
    description: "Increment a register or memory byte.",
  },
  {
    mnemonic: "DCR",
    syntax: "DCR r",
    operands: "r",
    bytes: 1,
    opcode: "05+8r",
    category: "arithmetic",
    description: "Decrement a register or memory byte.",
  },
  {
    mnemonic: "INX",
    syntax: "INX rp",
    operands: "rp",
    bytes: 1,
    opcode: "03+10h*rp",
    category: "arithmetic",
    description: "Increment a register pair.",
  },
  {
    mnemonic: "DCX",
    syntax: "DCX rp",
    operands: "rp",
    bytes: 1,
    opcode: "0B+10h*rp",
    category: "arithmetic",
    description: "Decrement a register pair.",
  },
  {
    mnemonic: "DAD",
    syntax: "DAD rp",
    operands: "rp",
    bytes: 1,
    opcode: "09+10h*rp",
    category: "arithmetic",
    description: "Add a register pair to HL.",
  },
  {
    mnemonic: "DAA",
    syntax: "DAA",
    operands: "",
    bytes: 1,
    opcode: "27",
    category: "arithmetic",
    description: "Decimal-adjust A after BCD addition.",
  },

  {
    mnemonic: "ANA",
    syntax: "ANA r",
    operands: "r",
    bytes: 1,
    opcode: "A0+r",
    category: "logical",
    description: "AND a register or memory byte with A.",
  },
  {
    mnemonic: "ANI",
    syntax: "ANI data8",
    operands: "data8",
    bytes: 2,
    opcode: "E6",
    category: "logical",
    description: "AND an immediate byte with A.",
  },
  {
    mnemonic: "XRA",
    syntax: "XRA r",
    operands: "r",
    bytes: 1,
    opcode: "A8+r",
    category: "logical",
    description: "XOR a register or memory byte with A.",
  },
  {
    mnemonic: "XRI",
    syntax: "XRI data8",
    operands: "data8",
    bytes: 2,
    opcode: "EE",
    category: "logical",
    description: "XOR an immediate byte with A.",
  },
  {
    mnemonic: "ORA",
    syntax: "ORA r",
    operands: "r",
    bytes: 1,
    opcode: "B0+r",
    category: "logical",
    description: "OR a register or memory byte with A.",
  },
  {
    mnemonic: "ORI",
    syntax: "ORI data8",
    operands: "data8",
    bytes: 2,
    opcode: "F6",
    category: "logical",
    description: "OR an immediate byte with A.",
  },
  {
    mnemonic: "CMP",
    syntax: "CMP r",
    operands: "r",
    bytes: 1,
    opcode: "B8+r",
    category: "logical",
    description: "Compare a register or memory byte with A.",
  },
  {
    mnemonic: "CPI",
    syntax: "CPI data8",
    operands: "data8",
    bytes: 2,
    opcode: "FE",
    category: "logical",
    description: "Compare an immediate byte with A.",
  },
  {
    mnemonic: "RLC",
    syntax: "RLC",
    operands: "",
    bytes: 1,
    opcode: "07",
    category: "logical",
    description: "Rotate A left.",
  },
  {
    mnemonic: "RRC",
    syntax: "RRC",
    operands: "",
    bytes: 1,
    opcode: "0F",
    category: "logical",
    description: "Rotate A right.",
  },
  {
    mnemonic: "RAL",
    syntax: "RAL",
    operands: "",
    bytes: 1,
    opcode: "17",
    category: "logical",
    description: "Rotate A left through carry.",
  },
  {
    mnemonic: "RAR",
    syntax: "RAR",
    operands: "",
    bytes: 1,
    opcode: "1F",
    category: "logical",
    description: "Rotate A right through carry.",
  },
  {
    mnemonic: "CMA",
    syntax: "CMA",
    operands: "",
    bytes: 1,
    opcode: "2F",
    category: "logical",
    description: "Complement A.",
  },
  {
    mnemonic: "CMC",
    syntax: "CMC",
    operands: "",
    bytes: 1,
    opcode: "3F",
    category: "logical",
    description: "Complement the carry flag.",
  },
  {
    mnemonic: "STC",
    syntax: "STC",
    operands: "",
    bytes: 1,
    opcode: "37",
    category: "logical",
    description: "Set the carry flag.",
  },

  ...(
    [
      ["JMP", "C3", "Jump unconditionally."],
      ["JNZ", "C2", "Jump when zero is clear."],
      ["JZ", "CA", "Jump when zero is set."],
      ["JNC", "D2", "Jump when carry is clear."],
      ["JC", "DA", "Jump when carry is set."],
      ["JPO", "E2", "Jump when parity is odd."],
      ["JPE", "EA", "Jump when parity is even."],
      ["JP", "F2", "Jump when sign is positive."],
      ["JM", "FA", "Jump when sign is negative."],
      ["CALL", "CD", "Call a subroutine unconditionally."],
      ["CNZ", "C4", "Call when zero is clear."],
      ["CZ", "CC", "Call when zero is set."],
      ["CNC", "D4", "Call when carry is clear."],
      ["CC", "DC", "Call when carry is set."],
      ["CPO", "E4", "Call when parity is odd."],
      ["CPE", "EC", "Call when parity is even."],
      ["CP", "F4", "Call when sign is positive."],
      ["CM", "FC", "Call when sign is negative."],
    ] as const
  ).map(
    ([mnemonic, opcode, description]): InstructionMetadataDefinition => ({
      mnemonic,
      syntax: `${mnemonic} address`,
      operands: "address16",
      bytes: 3,
      opcode,
      category: "branch",
      description,
    }),
  ),
  ...(
    [
      ["RET", "C9", "Return unconditionally."],
      ["RNZ", "C0", "Return when zero is clear."],
      ["RZ", "C8", "Return when zero is set."],
      ["RNC", "D0", "Return when carry is clear."],
      ["RC", "D8", "Return when carry is set."],
      ["RPO", "E0", "Return when parity is odd."],
      ["RPE", "E8", "Return when parity is even."],
      ["RP", "F0", "Return when sign is positive."],
      ["RM", "F8", "Return when sign is negative."],
    ] as const
  ).map(
    ([mnemonic, opcode, description]): InstructionMetadataDefinition => ({
      mnemonic,
      syntax: mnemonic,
      operands: "",
      bytes: 1,
      opcode,
      category: "branch",
      description,
    }),
  ),
  {
    mnemonic: "RST",
    syntax: "RST 0..7",
    operands: "vector",
    bytes: 1,
    opcode: "C7+8n",
    category: "branch",
    description: "Call one of the eight restart vectors.",
  },
  {
    mnemonic: "PCHL",
    syntax: "PCHL",
    operands: "",
    bytes: 1,
    opcode: "E9",
    category: "branch",
    description: "Jump indirectly through HL.",
  },

  {
    mnemonic: "PUSH",
    syntax: "PUSH B|D|H|PSW",
    operands: "rp|PSW",
    bytes: 1,
    opcode: "C5+10h*rp",
    category: "stack-io",
    description: "Push a register pair onto the stack.",
  },
  {
    mnemonic: "POP",
    syntax: "POP B|D|H|PSW",
    operands: "rp|PSW",
    bytes: 1,
    opcode: "C1+10h*rp",
    category: "stack-io",
    description: "Pop a register pair from the stack.",
  },
  {
    mnemonic: "XTHL",
    syntax: "XTHL",
    operands: "",
    bytes: 1,
    opcode: "E3",
    category: "stack-io",
    description: "Exchange HL with the top of the stack.",
  },
  {
    mnemonic: "SPHL",
    syntax: "SPHL",
    operands: "",
    bytes: 1,
    opcode: "F9",
    category: "stack-io",
    description: "Copy HL to SP.",
  },
  {
    mnemonic: "IN",
    syntax: "IN port8",
    operands: "port8",
    bytes: 2,
    opcode: "DB",
    category: "stack-io",
    description: "Read an input port into A.",
  },
  {
    mnemonic: "OUT",
    syntax: "OUT port8",
    operands: "port8",
    bytes: 2,
    opcode: "D3",
    category: "stack-io",
    description: "Write A to an output port.",
  },

  {
    mnemonic: "NOP",
    syntax: "NOP",
    operands: "",
    bytes: 1,
    opcode: "00",
    category: "machine-control",
    description: "Perform no operation.",
  },
  {
    mnemonic: "HLT",
    syntax: "HLT",
    operands: "",
    bytes: 1,
    opcode: "76",
    category: "machine-control",
    description:
      "Halt CPU execution. Interrupt wake-up is not modeled by this simulator.",
  },
  {
    mnemonic: "EI",
    syntax: "EI",
    operands: "",
    bytes: 1,
    opcode: "FB",
    category: "machine-control",
    description: "Enable maskable interrupts after the next instruction.",
  },
  {
    mnemonic: "DI",
    syntax: "DI",
    operands: "",
    bytes: 1,
    opcode: "F3",
    category: "machine-control",
    description: "Disable maskable interrupts.",
  },
  {
    mnemonic: "RIM",
    syntax: "RIM",
    operands: "",
    bytes: 1,
    opcode: "20",
    category: "machine-control",
    description: "Read interrupt masks and serial input into A.",
  },
  {
    mnemonic: "SIM",
    syntax: "SIM",
    operands: "",
    bytes: 1,
    opcode: "30",
    category: "machine-control",
    description: "Set interrupt masks and serial output from A.",
  },
];

export const INSTRUCTION_SET_8085: readonly InstructionMetadata[] =
  INSTRUCTION_DEFINITIONS_8085.map((instruction) => {
    const tStates = INSTRUCTION_T_STATES[instruction.mnemonic];
    if (!tStates) {
      throw new Error(`Missing T-state metadata for ${instruction.mnemonic}.`);
    }
    return { ...instruction, tStates };
  });

type Phase = 1 | 2;

interface ParsedLine {
  line: number;
  source: string;
  label?: string;
  mnemonic?: string;
  operands: string;
}

interface AnalyzedLine {
  parsed: ParsedLine;
  address: number | null;
  size: number;
}

interface PendingEqu {
  name: string;
  expression: string;
  line: number;
  address: number;
}

interface Evaluation {
  value: number;
  unresolved: string[];
}

class ExpressionSyntaxError extends Error {}

type ExpressionToken =
  | { kind: "number"; value: number; text: string }
  | { kind: "identifier"; text: string }
  | { kind: "current"; text: "$" }
  | { kind: "plus"; text: "+" }
  | { kind: "minus"; text: "-" }
  | { kind: "left"; text: "(" }
  | { kind: "right"; text: ")" }
  | { kind: "end"; text: "" };

const DIRECTIVES = new Set(["ORG", "DB", "DW", "DS", "EQU"]);
const INSTRUCTION_NAMES = new Set(
  INSTRUCTION_SET_8085.map((instruction) => instruction.mnemonic),
);

const FIXED_OPCODES: Readonly<Record<string, number>> = {
  NOP: 0x00,
  RLC: 0x07,
  RRC: 0x0f,
  RAL: 0x17,
  RAR: 0x1f,
  RIM: 0x20,
  DAA: 0x27,
  CMA: 0x2f,
  SIM: 0x30,
  STC: 0x37,
  CMC: 0x3f,
  HLT: 0x76,
  RNZ: 0xc0,
  RZ: 0xc8,
  RET: 0xc9,
  RNC: 0xd0,
  RC: 0xd8,
  RPO: 0xe0,
  XTHL: 0xe3,
  RPE: 0xe8,
  PCHL: 0xe9,
  XCHG: 0xeb,
  RP: 0xf0,
  DI: 0xf3,
  RM: 0xf8,
  SPHL: 0xf9,
  EI: 0xfb,
};

const REGISTER_ALU_BASES: Readonly<Record<string, number>> = {
  ADD: 0x80,
  ADC: 0x88,
  SUB: 0x90,
  SBB: 0x98,
  ANA: 0xa0,
  XRA: 0xa8,
  ORA: 0xb0,
  CMP: 0xb8,
};

const REGISTER_STEP_BASES: Readonly<Record<string, number>> = {
  INR: 0x04,
  DCR: 0x05,
};

const PAIR_BASES: Readonly<Record<string, number>> = {
  INX: 0x03,
  DCX: 0x0b,
  DAD: 0x09,
};

const IMMEDIATE_8_OPCODES: Readonly<Record<string, number>> = {
  ADI: 0xc6,
  ACI: 0xce,
  OUT: 0xd3,
  SUI: 0xd6,
  IN: 0xdb,
  SBI: 0xde,
  ANI: 0xe6,
  XRI: 0xee,
  ORI: 0xf6,
  CPI: 0xfe,
};

const ADDRESS_16_OPCODES: Readonly<Record<string, number>> = {
  SHLD: 0x22,
  LHLD: 0x2a,
  STA: 0x32,
  LDA: 0x3a,
  JNZ: 0xc2,
  JMP: 0xc3,
  CNZ: 0xc4,
  JZ: 0xca,
  CZ: 0xcc,
  CALL: 0xcd,
  JNC: 0xd2,
  CNC: 0xd4,
  JC: 0xda,
  CC: 0xdc,
  JPO: 0xe2,
  CPO: 0xe4,
  JPE: 0xea,
  CPE: 0xec,
  JP: 0xf2,
  CP: 0xf4,
  JM: 0xfa,
  CM: 0xfc,
};

const REGISTER_CODES: Readonly<Record<string, number>> = {
  B: 0,
  C: 1,
  D: 2,
  E: 3,
  H: 4,
  L: 5,
  M: 6,
  A: 7,
};

const PAIR_CODES: Readonly<Record<string, number>> = {
  B: 0,
  D: 1,
  H: 2,
  SP: 3,
};

const STACK_PAIR_CODES: Readonly<Record<string, number>> = {
  B: 0,
  D: 1,
  H: 2,
  PSW: 3,
};

const PAIR_ALIAS_REPLACEMENTS: Readonly<Record<string, string>> = {
  BC: "B",
  DE: "D",
  HL: "H",
};

const STACK_PAIR_ALIAS_REPLACEMENTS: Readonly<Record<string, string>> = {
  ...PAIR_ALIAS_REPLACEMENTS,
  AF: "PSW",
};

function canonicalName(value: string): string {
  return value.trim().toUpperCase();
}

function normalizedMnemonic(value: string): string {
  const upper = canonicalName(value);
  if (upper.startsWith(".") && DIRECTIVES.has(upper.slice(1))) {
    return upper.slice(1);
  }
  return upper;
}

function isLabelName(value: string): boolean {
  return /^[A-Za-z_?.][A-Za-z0-9_?.]*$/.test(value);
}

function isKnownStatement(value: string): boolean {
  const normalized = normalizedMnemonic(value);
  return DIRECTIVES.has(normalized) || INSTRUCTION_NAMES.has(normalized);
}

function stripComment(source: string): string {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      if (!quote) {
        quote = character;
      } else if (quote === character) {
        quote = "";
      }
      continue;
    }
    if (character === ";" && !quote) {
      return source.slice(0, index);
    }
  }
  return source;
}

function parseSourceLine(source: string, line: number): ParsedLine {
  let code = stripComment(source).trim();
  const parsed: ParsedLine = { line, source, operands: "" };
  if (!code) {
    return parsed;
  }

  const colon = code.match(/^([^:\s]+)\s*:\s*(.*)$/);
  if (colon) {
    parsed.label = colon[1];
    code = colon[2].trim();
    if (!code) {
      return parsed;
    }
  }

  const firstMatch = code.match(/^(\S+)(?:\s+(.*))?$/);
  if (!firstMatch) {
    return parsed;
  }
  let first = firstMatch[1];
  let remainder = (firstMatch[2] ?? "").trim();

  if (!parsed.label && remainder) {
    const secondMatch = remainder.match(/^(\S+)(?:\s+(.*))?$/);
    const second = secondMatch?.[1] ?? "";
    if (
      normalizedMnemonic(second) === "EQU" ||
      (!isKnownStatement(first) &&
        isLabelName(first) &&
        isKnownStatement(second))
    ) {
      parsed.label = first;
      first = second;
      remainder = (secondMatch?.[2] ?? "").trim();
    }
  }

  parsed.mnemonic = normalizedMnemonic(first);
  parsed.operands = remainder;
  return parsed;
}

function splitAtTopLevelCommas(value: string): string[] | null {
  const parts: string[] = [];
  let quote = "";
  let escaped = false;
  let depth = 0;
  let start = 0;
  let foundComma = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      if (!quote) {
        quote = character;
      } else if (quote === character) {
        quote = "";
      }
      continue;
    }
    if (quote) {
      continue;
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      foundComma = true;
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (!foundComma) {
    return null;
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function splitTopLevelWhitespace(value: string): string[] {
  const parts: string[] = [];
  let quote = "";
  let escaped = false;
  let depth = 0;
  let start = -1;

  const finish = (end: number): void => {
    if (start >= 0) {
      parts.push(value.slice(start, end).trim());
      start = -1;
    }
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && character === "\\") {
      escaped = true;
      if (start < 0) start = index;
      continue;
    }
    if (character === "'" || character === '"') {
      if (start < 0) start = index;
      if (!quote) {
        quote = character;
      } else if (quote === character) {
        quote = "";
      }
      continue;
    }
    if (!quote) {
      if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth = Math.max(0, depth - 1);
      }
      if (/\s/.test(character) && depth === 0) {
        finish(index);
        continue;
      }
    }
    if (start < 0) start = index;
  }
  finish(value.length);
  return parts.filter(Boolean);
}

function splitInstructionOperands(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const commaParts = splitAtTopLevelCommas(trimmed);
  if (commaParts) return commaParts;
  return [trimmed];
}

function splitDataItems(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const commaParts = splitAtTopLevelCommas(trimmed);
  if (commaParts) return commaParts;

  const raw = splitTopLevelWhitespace(trimmed);
  const result: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    let item = raw[index];
    if ((item === "+" || item === "-") && index + 1 < raw.length) {
      item += ` ${raw[index + 1]}`;
      index += 1;
    }
    while (
      index + 2 < raw.length &&
      (raw[index + 1] === "+" || raw[index + 1] === "-")
    ) {
      item += ` ${raw[index + 1]} ${raw[index + 2]}`;
      index += 2;
    }
    result.push(item);
  }
  return result;
}

function decodeQuotedLiteral(raw: string): string {
  if (raw.length < 2 || raw[0] !== raw[raw.length - 1]) {
    throw new ExpressionSyntaxError("unterminated quoted literal");
  }
  const quote = raw[0];
  if (quote !== "'" && quote !== '"') {
    throw new ExpressionSyntaxError("expected a quoted literal");
  }
  let result = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      result += character;
      continue;
    }
    index += 1;
    if (index >= raw.length - 1) {
      throw new ExpressionSyntaxError("incomplete escape sequence");
    }
    const escape = raw[index];
    const simple: Record<string, string> = {
      "0": "\0",
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      v: "\v",
      "\\": "\\",
      "'": "'",
      '"': '"',
    };
    if (simple[escape] !== undefined) {
      result += simple[escape];
      continue;
    }
    if (escape === "x") {
      const digits = raw.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(digits)) {
        throw new ExpressionSyntaxError("\\x must be followed by two hex digits");
      }
      result += String.fromCharCode(Number.parseInt(digits, 16));
      index += 2;
      continue;
    }
    if (escape === "u") {
      const digits = raw.slice(index + 1, index + 5);
      if (!/^[0-9A-Fa-f]{4}$/.test(digits)) {
        throw new ExpressionSyntaxError("\\u must be followed by four hex digits");
      }
      result += String.fromCharCode(Number.parseInt(digits, 16));
      index += 4;
      continue;
    }
    throw new ExpressionSyntaxError(`unsupported escape sequence \\${escape}`);
  }
  return result;
}

function parseNumericLiteral(text: string): number {
  const compact = text.replace(/_/g, "");
  if (/^0x[0-9A-F]+$/i.test(compact)) {
    return Number.parseInt(compact.slice(2), 16);
  }
  if (/^0b[01]+$/i.test(compact)) {
    return Number.parseInt(compact.slice(2), 2);
  }
  if (/^%[01]+$/.test(compact)) {
    return Number.parseInt(compact.slice(1), 2);
  }
  if (/^[0-9][0-9A-F]*H$/i.test(compact)) {
    return Number.parseInt(compact.slice(0, -1), 16);
  }
  if (/^[01]+B$/i.test(compact)) {
    return Number.parseInt(compact.slice(0, -1), 2);
  }
  if (/^[0-9]+D$/i.test(compact)) {
    return Number.parseInt(compact.slice(0, -1), 10);
  }
  if (/^[0-9]+$/.test(compact)) {
    return Number.parseInt(compact, 10);
  }
  throw new ExpressionSyntaxError(`invalid numeric literal "${text}"`);
}

function tokenizeExpression(expression: string): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  for (let index = 0; index < expression.length; ) {
    const character = expression[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "+") {
      tokens.push({ kind: "plus", text: "+" });
      index += 1;
      continue;
    }
    if (character === "-") {
      tokens.push({ kind: "minus", text: "-" });
      index += 1;
      continue;
    }
    if (character === "(") {
      tokens.push({ kind: "left", text: "(" });
      index += 1;
      continue;
    }
    if (character === ")") {
      tokens.push({ kind: "right", text: ")" });
      index += 1;
      continue;
    }
    if (character === "$") {
      tokens.push({ kind: "current", text: "$" });
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      const quote = character;
      let end = index + 1;
      let escaped = false;
      for (; end < expression.length; end += 1) {
        const current = expression[end];
        if (escaped) {
          escaped = false;
        } else if (current === "\\") {
          escaped = true;
        } else if (current === quote) {
          break;
        }
      }
      if (end >= expression.length) {
        throw new ExpressionSyntaxError("unterminated character literal");
      }
      const raw = expression.slice(index, end + 1);
      const decoded = decodeQuotedLiteral(raw);
      const characters = Array.from(decoded);
      if (characters.length < 1 || characters.length > 2) {
        throw new ExpressionSyntaxError(
          "an expression character literal must contain one or two characters",
        );
      }
      let value = 0;
      for (const item of characters) {
        const characterValue = item.codePointAt(0) ?? 0;
        if (characterValue > 0xff) {
          throw new ExpressionSyntaxError(
            "an expression character literal may contain only 8-bit characters",
          );
        }
        value = (value << 8) | characterValue;
      }
      tokens.push({ kind: "number", value, text: raw });
      index = end + 1;
      continue;
    }
    if (/[0-9%]/.test(character)) {
      let end = index + 1;
      while (end < expression.length && /[A-Za-z0-9_]/.test(expression[end])) {
        end += 1;
      }
      const text = expression.slice(index, end);
      tokens.push({ kind: "number", value: parseNumericLiteral(text), text });
      index = end;
      continue;
    }
    if (/[A-Za-z_?.]/.test(character)) {
      let end = index + 1;
      while (end < expression.length && /[A-Za-z0-9_?.]/.test(expression[end])) {
        end += 1;
      }
      const text = expression.slice(index, end);
      tokens.push({ kind: "identifier", text });
      index = end;
      continue;
    }
    throw new ExpressionSyntaxError(`unexpected character "${character}"`);
  }
  tokens.push({ kind: "end", text: "" });
  return tokens;
}

function evaluateExpression(
  expression: string,
  symbols: ReadonlyMap<string, number>,
  currentAddress: number,
): Evaluation {
  if (!expression.trim()) {
    throw new ExpressionSyntaxError("expression is empty");
  }
  const tokens = tokenizeExpression(expression);
  const unresolved = new Set<string>();
  let position = 0;

  const peek = (): ExpressionToken => tokens[position];
  const consume = (): ExpressionToken => {
    const token = tokens[position];
    position += 1;
    return token;
  };

  const primary = (): number => {
    const token = consume();
    if (token.kind === "number") return token.value;
    if (token.kind === "current") return currentAddress;
    if (token.kind === "identifier") {
      const name = canonicalName(token.text);
      const value = symbols.get(name);
      if (value === undefined) {
        unresolved.add(name);
        return 0;
      }
      return value;
    }
    if (token.kind === "left") {
      const value = sum();
      if (peek().kind !== "right") {
        throw new ExpressionSyntaxError('expected ")"');
      }
      consume();
      return value;
    }
    throw new ExpressionSyntaxError(`expected a value, found "${token.text}"`);
  };

  const unary = (): number => {
    if (peek().kind === "plus") {
      consume();
      return unary();
    }
    if (peek().kind === "minus") {
      consume();
      return -unary();
    }
    return primary();
  };

  function sum(): number {
    let value = unary();
    while (peek().kind === "plus" || peek().kind === "minus") {
      const operator = consume().kind;
      const right = unary();
      value = operator === "plus" ? value + right : value - right;
      if (!Number.isSafeInteger(value)) {
        throw new ExpressionSyntaxError("expression exceeds the safe integer range");
      }
    }
    return value;
  }

  const value = sum();
  const trailing = peek();
  if (trailing.kind !== "end") {
    throw new ExpressionSyntaxError(`unexpected token "${trailing.text}"`);
  }
  return { value, unresolved: [...unresolved] };
}

function addError(
  errors: AssemblyError[],
  seen: Set<string>,
  line: number,
  message: string,
): void {
  const key = `${line}\0${message}`;
  if (seen.has(key)) return;
  seen.add(key);
  errors.push({ line, message });
}

function formatHex(value: number, width: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(width, "0")}`;
}

function intelHexLiteralHint(unresolved: readonly string[]): string {
  const candidate = unresolved.find((name) =>
    /^[A-F][0-9A-F]*H$/i.test(name),
  );
  if (!candidate) return "";
  const literal = candidate.toUpperCase();
  return ` If hexadecimal ${literal} was intended, write 0${literal}.`;
}

function evaluatedOperand(
  expression: string,
  currentAddress: number,
  symbols: ReadonlyMap<string, number>,
  phase: Phase,
  minimum: number,
  maximum: number,
  description: string,
  line: number,
  errors: AssemblyError[],
  seenErrors: Set<string>,
): number {
  let evaluation: Evaluation;
  try {
    evaluation = evaluateExpression(expression, symbols, currentAddress);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "invalid expression syntax";
    addError(
      errors,
      seenErrors,
      line,
      `Invalid ${description} expression "${expression.trim()}": ${detail}.`,
    );
    return 0;
  }
  if (evaluation.unresolved.length > 0) {
    if (phase === 2) {
      addError(
        errors,
        seenErrors,
        line,
        `Undefined symbol${evaluation.unresolved.length === 1 ? "" : "s"} in ${description}: ${evaluation.unresolved.join(", ")}.${intelHexLiteralHint(evaluation.unresolved)}`,
      );
    }
    return 0;
  }
  if (
    !Number.isInteger(evaluation.value) ||
    evaluation.value < minimum ||
    evaluation.value > maximum
  ) {
    addError(
      errors,
      seenErrors,
      line,
      minimum < 0
        ? `${description[0].toUpperCase()}${description.slice(1)} must be ${minimum}..${maximum}; got ${evaluation.value}.`
        : `${description[0].toUpperCase()}${description.slice(1)} must be ${minimum}..${maximum} (${formatHex(minimum, minimum > 0xff ? 4 : 2)}..${formatHex(maximum, maximum > 0xff ? 4 : 2)}); got ${evaluation.value}.`,
    );
    return 0;
  }
  return evaluation.value;
}

function evaluatedEncodedOperand(
  expression: string,
  currentAddress: number,
  symbols: ReadonlyMap<string, number>,
  phase: Phase,
  bits: 8 | 16,
  description: string,
  line: number,
  errors: AssemblyError[],
  seenErrors: Set<string>,
): number {
  const modulus = bits === 8 ? 0x100 : 0x10000;
  return (
    evaluatedOperand(
      expression,
      currentAddress,
      symbols,
      phase,
      -modulus,
      modulus - 1,
      description,
      line,
      errors,
      seenErrors,
    ) &
    (modulus - 1)
  );
}

function expectedOperands(
  mnemonic: string,
  operandText: string,
  count: number,
  line: number,
  errors: AssemblyError[],
  seenErrors: Set<string>,
): string[] | null {
  const operands = splitInstructionOperands(operandText);
  if (operands.length !== count || operands.some((operand) => !operand.trim())) {
    addError(
      errors,
      seenErrors,
      line,
      count === 2 && operands.length === 1
        ? `${mnemonic} requires two operands separated by a comma.`
        : `${mnemonic} expects ${count === 0 ? "no operands" : `${count} operand${count === 1 ? "" : "s"}`}; got ${operands.length}.`,
    );
    return null;
  }
  return operands;
}

function registerCode(
  operand: string,
  mnemonic: string,
  line: number,
  errors: AssemblyError[],
  seenErrors: Set<string>,
): number {
  const name = canonicalName(operand);
  const code = REGISTER_CODES[name];
  if (code === undefined) {
    addError(
      errors,
      seenErrors,
      line,
      `${mnemonic} requires an 8-bit register (A, B, C, D, E, H, L, or M); got "${operand.trim()}".`,
    );
    return 0;
  }
  return code;
}

function pairCode(
  operand: string,
  mnemonic: string,
  stackPair: boolean,
  line: number,
  errors: AssemblyError[],
  seenErrors: Set<string>,
): number {
  const name = canonicalName(operand);
  const table = stackPair ? STACK_PAIR_CODES : PAIR_CODES;
  const code = table[name];
  if (code === undefined) {
    const replacements = stackPair
      ? STACK_PAIR_ALIAS_REPLACEMENTS
      : PAIR_ALIAS_REPLACEMENTS;
    const replacement = replacements[name];
    addError(
      errors,
      seenErrors,
      line,
      `${stackPair
        ? `${mnemonic} requires B, D, H, or PSW`
        : `${mnemonic} requires B, D, H, or SP`}; got "${operand.trim()}".${replacement ? ` Use ${replacement} instead of ${name}.` : ""}`,
    );
    return 0;
  }
  return code;
}

function encodeInstruction(
  mnemonic: string,
  operandText: string,
  address: number,
  symbols: ReadonlyMap<string, number>,
  phase: Phase,
  line: number,
  errors: AssemblyError[],
  seenErrors: Set<string>,
): number[] {
  const fixed = FIXED_OPCODES[mnemonic];
  if (fixed !== undefined) {
    expectedOperands(mnemonic, operandText, 0, line, errors, seenErrors);
    return [fixed];
  }

  if (mnemonic === "MOV") {
    const operands = expectedOperands(
      mnemonic,
      operandText,
      2,
      line,
      errors,
      seenErrors,
    );
    if (!operands) return [0x40];
    const destination = registerCode(
      operands[0],
      mnemonic,
      line,
      errors,
      seenErrors,
    );
    const source = registerCode(
      operands[1],
      mnemonic,
      line,
      errors,
      seenErrors,
    );
    if (destination === 6 && source === 6) {
      addError(
        errors,
        seenErrors,
        line,
        "MOV M,M is not an 8085 instruction (opcode 0x76 is HLT); use HLT explicitly.",
      );
    }
    return [0x40 + destination * 8 + source];
  }

  if (mnemonic === "MVI") {
    const operands = expectedOperands(
      mnemonic,
      operandText,
      2,
      line,
      errors,
      seenErrors,
    );
    if (!operands) return [0x06, 0];
    const register = registerCode(
      operands[0],
      mnemonic,
      line,
      errors,
      seenErrors,
    );
    const immediate = evaluatedEncodedOperand(
      operands[1],
      address,
      symbols,
      phase,
      8,
      "8-bit immediate",
      line,
      errors,
      seenErrors,
    );
    return [0x06 + register * 8, immediate];
  }

  if (mnemonic === "LXI") {
    const operands = expectedOperands(
      mnemonic,
      operandText,
      2,
      line,
      errors,
      seenErrors,
    );
    if (!operands) return [0x01, 0, 0];
    const pair = pairCode(
      operands[0],
      mnemonic,
      false,
      line,
      errors,
      seenErrors,
    );
    const immediate = evaluatedEncodedOperand(
      operands[1],
      address,
      symbols,
      phase,
      16,
      "16-bit immediate",
      line,
      errors,
      seenErrors,
    );
    return [0x01 + pair * 0x10, immediate & 0xff, (immediate >>> 8) & 0xff];
  }

  const aluBase = REGISTER_ALU_BASES[mnemonic];
  if (aluBase !== undefined) {
    const operands = expectedOperands(
      mnemonic,
      operandText,
      1,
      line,
      errors,
      seenErrors,
    );
    if (!operands) return [aluBase];
    return [
      aluBase +
        registerCode(operands[0], mnemonic, line, errors, seenErrors),
    ];
  }

  const stepBase = REGISTER_STEP_BASES[mnemonic];
  if (stepBase !== undefined) {
    const operands = expectedOperands(
      mnemonic,
      operandText,
      1,
      line,
      errors,
      seenErrors,
    );
    if (!operands) return [stepBase];
    return [
      stepBase +
        registerCode(operands[0], mnemonic, line, errors, seenErrors) * 8,
    ];
  }

  const pairBase = PAIR_BASES[mnemonic];
  if (pairBase !== undefined) {
    const operands = expectedOperands(
      mnemonic,
      operandText,
      1,
      line,
      errors,
      seenErrors,
    );
    if (!operands) return [pairBase];
    return [
      pairBase +
        pairCode(
          operands[0],
          mnemonic,
          false,
          line,
          errors,
          seenErrors,
        ) *
          0x10,
    ];
  }

  if (mnemonic === "PUSH" || mnemonic === "POP") {
    const base = mnemonic === "PUSH" ? 0xc5 : 0xc1;
    const operands = expectedOperands(
      mnemonic,
      operandText,
      1,
      line,
      errors,
      seenErrors,
    );
    if (!operands) return [base];
    return [
      base +
        pairCode(
          operands[0],
          mnemonic,
          true,
          line,
          errors,
          seenErrors,
        ) *
          0x10,
    ];
  }

  if (mnemonic === "LDAX" || mnemonic === "STAX") {
    const operands = expectedOperands(
      mnemonic,
      operandText,
      1,
      line,
      errors,
      seenErrors,
    );
    const base = mnemonic === "LDAX" ? 0x0a : 0x02;
    if (!operands) return [base];
    const name = canonicalName(operands[0]);
    const pair = name === "B" ? 0 : name === "D" ? 1 : -1;
    if (pair < 0) {
      const replacement = PAIR_ALIAS_REPLACEMENTS[name];
      addError(
        errors,
        seenErrors,
        line,
        `${mnemonic} only supports B or D; got "${operands[0].trim()}".${replacement === "B" || replacement === "D" ? ` Use ${replacement} instead of ${name}.` : ""}`,
      );
      return [base];
    }
    return [base + pair * 0x10];
  }

  const immediateOpcode = IMMEDIATE_8_OPCODES[mnemonic];
  if (immediateOpcode !== undefined) {
    const operands = expectedOperands(
      mnemonic,
      operandText,
      1,
      line,
      errors,
      seenErrors,
    );
    if (!operands) return [immediateOpcode, 0];
    const description =
      mnemonic === "IN" || mnemonic === "OUT"
        ? "8-bit port number"
        : "8-bit immediate";
    const immediate = evaluatedEncodedOperand(
      operands[0],
      address,
      symbols,
      phase,
      8,
      description,
      line,
      errors,
      seenErrors,
    );
    return [immediateOpcode, immediate];
  }

  const addressOpcode = ADDRESS_16_OPCODES[mnemonic];
  if (addressOpcode !== undefined) {
    const operands = expectedOperands(
      mnemonic,
      operandText,
      1,
      line,
      errors,
      seenErrors,
    );
    if (!operands) return [addressOpcode, 0, 0];
    const target = evaluatedEncodedOperand(
      operands[0],
      address,
      symbols,
      phase,
      16,
      "16-bit address",
      line,
      errors,
      seenErrors,
    );
    return [addressOpcode, target & 0xff, (target >>> 8) & 0xff];
  }

  if (mnemonic === "RST") {
    const operands = expectedOperands(
      mnemonic,
      operandText,
      1,
      line,
      errors,
      seenErrors,
    );
    if (!operands) return [0xc7];
    const vector = evaluatedOperand(
      operands[0],
      address,
      symbols,
      phase,
      0,
      7,
      "restart vector",
      line,
      errors,
      seenErrors,
    );
    return [0xc7 + vector * 8];
  }

  addError(
    errors,
    seenErrors,
    line,
    `Unknown 8085 mnemonic or directive "${mnemonic}".`,
  );
  return [];
}

function quotedDataItem(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length >= 2 &&
    (trimmed[0] === "'" || trimmed[0] === '"') &&
    trimmed[trimmed.length - 1] === trimmed[0]
  );
}

function encodeDb(
  operandText: string,
  address: number,
  symbols: ReadonlyMap<string, number>,
  phase: Phase,
  line: number,
  errors: AssemblyError[],
  seenErrors: Set<string>,
): number[] {
  const items = splitDataItems(operandText);
  if (items.length === 0 || items.some((item) => !item.trim())) {
    addError(
      errors,
      seenErrors,
      line,
      "DB requires one or more comma- or space-separated values.",
    );
    return [];
  }
  const bytes: number[] = [];
  for (const item of items) {
    if (quotedDataItem(item)) {
      try {
        const decoded = decodeQuotedLiteral(item.trim());
        for (const character of Array.from(decoded)) {
          const value = character.codePointAt(0) ?? 0;
          if (value > 0xff) {
            addError(
              errors,
              seenErrors,
              line,
              `DB string character ${JSON.stringify(character)} is outside the 8-bit range.`,
            );
            bytes.push(0);
          } else {
            bytes.push(value);
          }
        }
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "invalid quoted literal";
        addError(
          errors,
          seenErrors,
          line,
          `Invalid DB string ${item.trim()}: ${detail}.`,
        );
      }
      continue;
    }
    bytes.push(
      evaluatedOperand(
        item,
        address + bytes.length,
        symbols,
        phase,
        0,
        0xff,
        "DB value",
        line,
        errors,
        seenErrors,
      ),
    );
  }
  return bytes;
}

function encodeDw(
  operandText: string,
  address: number,
  symbols: ReadonlyMap<string, number>,
  phase: Phase,
  line: number,
  errors: AssemblyError[],
  seenErrors: Set<string>,
): number[] {
  const items = splitDataItems(operandText);
  if (items.length === 0 || items.some((item) => !item.trim())) {
    addError(
      errors,
      seenErrors,
      line,
      "DW requires one or more comma- or space-separated 16-bit values.",
    );
    return [];
  }
  const bytes: number[] = [];
  for (const item of items) {
    const value = evaluatedOperand(
      item,
      address + bytes.length,
      symbols,
      phase,
      0,
      0xffff,
      "DW value",
      line,
      errors,
      seenErrors,
    );
    bytes.push(value & 0xff, (value >>> 8) & 0xff);
  }
  return bytes;
}

function advanceAddress(
  address: number,
  size: number,
  line: number,
  errors: AssemblyError[],
  seenErrors: Set<string>,
): number {
  if (address < 0 || address > 0xffff || address + size > 0x10000) {
    addError(
      errors,
      seenErrors,
      line,
      `Output crosses the 8085 address-space boundary at ${formatHex(0xffff, 4)}.`,
    );
  }
  return Math.min(0x10000, Math.max(0, address + size));
}

function resolveEquSymbols(
  pendingEqus: PendingEqu[],
  symbols: Map<string, number>,
  errors: AssemblyError[],
  seenErrors: Set<string>,
): void {
  let remaining = [...pendingEqus];
  let madeProgress = true;
  while (remaining.length > 0 && madeProgress) {
    madeProgress = false;
    const next: PendingEqu[] = [];
    for (const equ of remaining) {
      try {
        const evaluation = evaluateExpression(
          equ.expression,
          symbols,
          equ.address,
        );
        if (evaluation.unresolved.length === 0) {
          if (
            !Number.isSafeInteger(evaluation.value) ||
            evaluation.value < -0x80000000 ||
            evaluation.value > 0xffffffff
          ) {
            addError(
              errors,
              seenErrors,
              equ.line,
              `EQU value for ${equ.name} is outside the supported 32-bit expression range.`,
            );
            symbols.set(equ.name, 0);
          } else {
            symbols.set(equ.name, evaluation.value);
          }
          madeProgress = true;
        } else {
          next.push(equ);
        }
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "invalid expression syntax";
        addError(
          errors,
          seenErrors,
          equ.line,
          `Invalid EQU expression for ${equ.name}: ${detail}.`,
        );
        symbols.set(equ.name, 0);
        madeProgress = true;
      }
    }
    remaining = next;
  }

  const pendingNames = new Set(remaining.map((equ) => equ.name));
  for (const equ of remaining) {
    let unresolved: string[] = [];
    try {
      unresolved = evaluateExpression(
        equ.expression,
        symbols,
        equ.address,
      ).unresolved;
    } catch {
      // Syntax failures were already reported in the progress loop.
    }
    const undefinedNames = unresolved.filter(
      (name) => !pendingNames.has(name),
    );
    addError(
      errors,
      seenErrors,
      equ.line,
      undefinedNames.length > 0
        ? `Cannot resolve EQU ${equ.name}; undefined symbol${undefinedNames.length === 1 ? "" : "s"}: ${undefinedNames.join(", ")}.${intelHexLiteralHint(undefinedNames)}`
        : `Cannot resolve EQU ${equ.name}; the EQU definitions are circular.`,
    );
    symbols.set(equ.name, 0);
  }
}

function symbolRecord(symbols: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(symbols.entries()) as Record<string, number>;
}

/**
 * Assemble Intel 8085 source code.
 *
 * Supported directives:
 * - ORG address
 * - DB byte/string [, ...]
 * - DW word [, ...] (little-endian)
 * - DS count (zero-initialized reserved bytes)
 * - name EQU expression
 *
 * Expressions support symbols, $, parentheses, unary/binary + and -, decimal,
 * 0x hex, Intel H-suffix hex, 0b/%/B-suffix binary, and character literals.
 */
export function assemble8085(
  source: string,
  defaultOrigin = 0,
): Assemble8085Result {
  const errors: AssemblyError[] = [];
  const seenErrors = new Set<string>();
  let initialOrigin = defaultOrigin;
  if (
    !Number.isInteger(defaultOrigin) ||
    defaultOrigin < 0 ||
    defaultOrigin > 0xffff
  ) {
    addError(
      errors,
      seenErrors,
      0,
      `defaultOrigin must be an integer from 0 to 65535; got ${String(defaultOrigin)}.`,
    );
    initialOrigin = 0;
  }

  const parsedLines = source
    .split(/\r?\n/)
    .map((lineSource, index) => parseSourceLine(lineSource, index + 1));
  const analyzedLines: AnalyzedLine[] = [];
  const symbols = new Map<string, number>();
  const definedAt = new Map<string, number>();
  const pendingEqus: PendingEqu[] = [];
  let address = initialOrigin;
  let entryPoint: number | null = null;

  for (const parsed of parsedLines) {
    if (!parsed.mnemonic && !parsed.label) {
      analyzedLines.push({ parsed, address: null, size: 0 });
      continue;
    }

    const mnemonic = parsed.mnemonic;
    const lineAddress = address;
    const canonicalLabel = parsed.label
      ? canonicalName(parsed.label)
      : undefined;

    if (parsed.label && !isLabelName(parsed.label)) {
      addError(
        errors,
        seenErrors,
        parsed.line,
        `Invalid label "${parsed.label}". Labels must start with a letter, _, ?, or . and contain only letters, digits, _, ?, or ..`,
      );
    }

    const equDefinition = mnemonic === "EQU";
    if (canonicalLabel && isLabelName(parsed.label ?? "")) {
      const previousLine = definedAt.get(canonicalLabel);
      if (previousLine !== undefined) {
        addError(
          errors,
          seenErrors,
          parsed.line,
          `Duplicate symbol ${canonicalLabel}; it was first defined on line ${previousLine}.`,
        );
      } else {
        definedAt.set(canonicalLabel, parsed.line);
        if (equDefinition) {
          if (!parsed.operands.trim()) {
            // The dedicated EQU validation below reports the friendlier error.
            symbols.set(canonicalLabel, 0);
          } else {
            try {
              const evaluation = evaluateExpression(
                parsed.operands,
                symbols,
                address,
              );
              if (evaluation.unresolved.length > 0) {
                pendingEqus.push({
                  name: canonicalLabel,
                  expression: parsed.operands,
                  line: parsed.line,
                  address,
                });
              } else if (
                !Number.isSafeInteger(evaluation.value) ||
                evaluation.value < -0x80000000 ||
                evaluation.value > 0xffffffff
              ) {
                addError(
                  errors,
                  seenErrors,
                  parsed.line,
                  `EQU value for ${canonicalLabel} is outside the supported 32-bit expression range.`,
                );
                symbols.set(canonicalLabel, 0);
              } else {
                // Resolve backward/immediate EQU values now so a following ORG
                // or DS can legally use them during pass one.
                symbols.set(canonicalLabel, evaluation.value);
              }
            } catch (error) {
              const detail =
                error instanceof Error
                  ? error.message
                  : "invalid expression syntax";
              addError(
                errors,
                seenErrors,
                parsed.line,
                `Invalid EQU expression for ${canonicalLabel}: ${detail}.`,
              );
              symbols.set(canonicalLabel, 0);
            }
          }
        } else {
          symbols.set(canonicalLabel, address);
        }
      }
    }

    if (!mnemonic) {
      analyzedLines.push({ parsed, address: lineAddress, size: 0 });
      continue;
    }

    if (mnemonic === "EQU") {
      if (!parsed.label) {
        addError(
          errors,
          seenErrors,
          parsed.line,
          "EQU requires a symbol name, for example: BUFFER_SIZE EQU 32.",
        );
      } else if (!parsed.operands.trim()) {
        addError(
          errors,
          seenErrors,
          parsed.line,
          `EQU for ${canonicalLabel ?? parsed.label} requires an expression.`,
        );
      }
      analyzedLines.push({ parsed, address: lineAddress, size: 0 });
      continue;
    }

    if (mnemonic === "ORG") {
      let nextAddress = address;
      try {
        const evaluation = evaluateExpression(
          parsed.operands,
          symbols,
          address,
        );
        if (evaluation.unresolved.length > 0) {
          addError(
            errors,
            seenErrors,
            parsed.line,
            `ORG must be resolvable on the first pass; unresolved symbol${evaluation.unresolved.length === 1 ? "" : "s"}: ${evaluation.unresolved.join(", ")}.${intelHexLiteralHint(evaluation.unresolved)}`,
          );
        } else if (
          !Number.isInteger(evaluation.value) ||
          evaluation.value < 0 ||
          evaluation.value > 0xffff
        ) {
          addError(
            errors,
            seenErrors,
            parsed.line,
            `ORG address must be 0..65535 (0x0000..0xFFFF); got ${evaluation.value}.`,
          );
        } else {
          nextAddress = evaluation.value;
        }
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "invalid expression syntax";
        addError(
          errors,
          seenErrors,
          parsed.line,
          `Invalid ORG expression "${parsed.operands.trim()}": ${detail}.`,
        );
      }
      address = nextAddress;
      analyzedLines.push({ parsed, address, size: 0 });
      continue;
    }

    if (mnemonic === "DB") {
      const bytes = encodeDb(
        parsed.operands,
        address,
        symbols,
        1,
        parsed.line,
        errors,
        seenErrors,
      );
      analyzedLines.push({ parsed, address, size: bytes.length });
      address = advanceAddress(
        address,
        bytes.length,
        parsed.line,
        errors,
        seenErrors,
      );
      continue;
    }

    if (mnemonic === "DW") {
      const bytes = encodeDw(
        parsed.operands,
        address,
        symbols,
        1,
        parsed.line,
        errors,
        seenErrors,
      );
      analyzedLines.push({ parsed, address, size: bytes.length });
      address = advanceAddress(
        address,
        bytes.length,
        parsed.line,
        errors,
        seenErrors,
      );
      continue;
    }

    if (mnemonic === "DS") {
      let count = 0;
      try {
        const evaluation = evaluateExpression(
          parsed.operands,
          symbols,
          address,
        );
        if (evaluation.unresolved.length > 0) {
          addError(
            errors,
            seenErrors,
            parsed.line,
            `DS size must be resolvable on the first pass; unresolved symbol${evaluation.unresolved.length === 1 ? "" : "s"}: ${evaluation.unresolved.join(", ")}.${intelHexLiteralHint(evaluation.unresolved)}`,
          );
        } else if (
          !Number.isInteger(evaluation.value) ||
          evaluation.value < 0 ||
          evaluation.value > 0x10000
        ) {
          addError(
            errors,
            seenErrors,
            parsed.line,
            `DS size must be 0..65536; got ${evaluation.value}.`,
          );
        } else {
          count = evaluation.value;
        }
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "invalid expression syntax";
        addError(
          errors,
          seenErrors,
          parsed.line,
          `Invalid DS size expression "${parsed.operands.trim()}": ${detail}.`,
        );
      }
      analyzedLines.push({ parsed, address, size: count });
      address = advanceAddress(
        address,
        count,
        parsed.line,
        errors,
        seenErrors,
      );
      continue;
    }

    entryPoint ??= address;
    const bytes = encodeInstruction(
      mnemonic,
      parsed.operands,
      address,
      symbols,
      1,
      parsed.line,
      errors,
      seenErrors,
    );
    analyzedLines.push({ parsed, address, size: bytes.length });
    address = advanceAddress(
      address,
      bytes.length,
      parsed.line,
      errors,
      seenErrors,
    );
  }

  resolveEquSymbols(pendingEqus, symbols, errors, seenErrors);

  const memory = new Map<number, number>();
  const addressToLine: Record<number, number> = Object.create(null) as Record<
    number,
    number
  >;
  const listing: AssemblyListingEntry[] = [];

  for (const analyzed of analyzedLines) {
    const { parsed } = analyzed;
    let lineBytes: number[] = [];
    const mnemonic = parsed.mnemonic;

    if (mnemonic && analyzed.address !== null) {
      if (mnemonic === "DB") {
        lineBytes = encodeDb(
          parsed.operands,
          analyzed.address,
          symbols,
          2,
          parsed.line,
          errors,
          seenErrors,
        );
      } else if (mnemonic === "DW") {
        lineBytes = encodeDw(
          parsed.operands,
          analyzed.address,
          symbols,
          2,
          parsed.line,
          errors,
          seenErrors,
        );
      } else if (mnemonic === "DS") {
        lineBytes = new Array<number>(analyzed.size).fill(0);
      } else if (mnemonic !== "ORG" && mnemonic !== "EQU") {
        lineBytes = encodeInstruction(
          mnemonic,
          parsed.operands,
          analyzed.address,
          symbols,
          2,
          parsed.line,
          errors,
          seenErrors,
        );
      }
    }

    if (analyzed.address !== null) {
      for (let offset = 0; offset < lineBytes.length; offset += 1) {
        const outputAddress = analyzed.address + offset;
        if (outputAddress < 0 || outputAddress > 0xffff) {
          continue;
        }
        if (memory.has(outputAddress)) {
          addError(
            errors,
            seenErrors,
            parsed.line,
            `Output overlaps an earlier byte at ${formatHex(outputAddress, 4)}.`,
          );
          continue;
        }
        memory.set(outputAddress, lineBytes[offset] & 0xff);
        addressToLine[outputAddress] = parsed.line;
      }
    }

    listing.push({
      line: parsed.line,
      address: analyzed.address,
      bytes: lineBytes,
      source: parsed.source,
    });
  }

  const sortedMemory = [...memory.entries()].sort(
    ([left], [right]) => left - right,
  );
  const segments: AssemblySegment[] = [];
  for (const [byteAddress, byte] of sortedMemory) {
    const previous = segments[segments.length - 1];
    if (
      !previous ||
      byteAddress !== previous.origin + previous.bytes.length
    ) {
      segments.push({ origin: byteAddress, bytes: [byte] });
    } else {
      previous.bytes.push(byte);
    }
  }

  let origin = initialOrigin;
  let bytes: number[] = [];
  if (sortedMemory.length > 0) {
    origin = sortedMemory[0][0];
    const lastAddress = sortedMemory[sortedMemory.length - 1][0];
    bytes = new Array<number>(lastAddress - origin + 1).fill(0);
    for (const [byteAddress, byte] of sortedMemory) {
      bytes[byteAddress - origin] = byte;
    }
  }

  const sortedErrors = errors
    .map((error, index) => ({ error, index }))
    .sort(
      (left, right) =>
        left.error.line - right.error.line || left.index - right.index,
    )
    .map(({ error }) => error);

  return {
    success: sortedErrors.length === 0,
    origin,
    entryPoint: entryPoint ?? origin,
    bytes,
    segments,
    symbols: symbolRecord(symbols),
    listing,
    addressToLine,
    errors: sortedErrors,
  };
}
