import assert from "node:assert/strict";
import test from "node:test";

import {
  assemble8085,
  type Assemble8085Result,
} from "../lib/assembler8085.ts";

interface EncodingCase {
  source: string;
  bytes: number[];
}

function assemblyFailure(result: Assemble8085Result): string {
  return result.errors
    .map((error) => `line ${error.line}: ${error.message}`)
    .join("\n");
}

function assertEncoded(source: string, bytes: number[]): void {
  const result = assemble8085(source);
  assert.equal(
    result.success,
    true,
    `${source} failed to assemble:\n${assemblyFailure(result)}`,
  );
  assert.deepEqual(result.bytes, bytes, source);
}

function assertRejected(source: string): void {
  const result = assemble8085(source);
  assert.equal(
    result.success,
    false,
    `${source} was accepted as ${result.bytes
      .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
      .join(" ")}`,
  );
  assert.ok(result.errors.length > 0, `${source} failed without an error`);
}

test("assembler rejects all 24 non-Intel register-pair aliases", () => {
  const aliases = [
    "LXI BC,1234H",
    "LXI DE,1234H",
    "LXI HL,1234H",
    "INX BC",
    "INX DE",
    "INX HL",
    "DCX BC",
    "DCX DE",
    "DCX HL",
    "DAD BC",
    "DAD DE",
    "DAD HL",
    "LDAX BC",
    "LDAX DE",
    "STAX BC",
    "STAX DE",
    "PUSH BC",
    "PUSH DE",
    "PUSH HL",
    "PUSH AF",
    "POP BC",
    "POP DE",
    "POP HL",
    "POP AF",
  ];

  assert.equal(aliases.length, 24);
  for (const source of aliases) assertRejected(source);

  const ldaxAlias = assemble8085("LDAX BC");
  assert.match(assemblyFailure(ldaxAlias), /use B instead of BC/i);
  const pswAlias = assemble8085("PUSH AF");
  assert.match(assemblyFailure(pswAlias), /use PSW instead of AF/i);

  const invalidGeneralAf = assemble8085("LXI AF,1234H");
  assert.doesNotMatch(assemblyFailure(invalidGeneralAf), /use PSW/i);
});

test("assembler rejects all 75 two-operand forms that omit the comma", () => {
  const registers = ["B", "C", "D", "E", "H", "L", "M", "A"];
  const sources: string[] = [];

  for (const destination of registers) {
    for (const source of registers) {
      if (destination !== "M" || source !== "M") {
        sources.push(`MOV ${destination} ${source}`);
      }
    }
    sources.push(`MVI ${destination} 5AH`);
  }
  for (const pair of ["B", "D", "H", "SP"]) {
    sources.push(`LXI ${pair} 1234H`);
  }

  assert.equal(sources.length, 75);
  for (const source of sources) assertRejected(source);

  assert.match(
    assemblyFailure(assemble8085("MOV A B")),
    /two operands separated by a comma/i,
  );

  assertEncoded("MVI A, VALUE + 1\nVALUE EQU 41H", [0x3e, 0x42]);
  assertEncoded("LXI H, TARGET + 2\nTARGET EQU 1232H", [0x21, 0x34, 0x12]);
  assertEncoded("DB 1 2 3", [1, 2, 3]);
  assertEncoded("DW 1 2", [1, 0, 2, 0]);
});

test("signed byte operands encode every affected instruction form", () => {
  const registers = ["B", "C", "D", "E", "H", "L", "M", "A"];
  const cases: EncodingCase[] = registers.map((register, index) => ({
    source: `MVI ${register},-1`,
    bytes: [0x06 + index * 8, 0xff],
  }));

  for (const [mnemonic, opcode] of [
    ["ADI", 0xc6],
    ["ACI", 0xce],
    ["OUT", 0xd3],
    ["SUI", 0xd6],
    ["IN", 0xdb],
    ["SBI", 0xde],
    ["ANI", 0xe6],
    ["XRI", 0xee],
    ["ORI", 0xf6],
    ["CPI", 0xfe],
  ] as const) {
    cases.push({ source: `${mnemonic} -1`, bytes: [opcode, 0xff] });
  }

  assert.equal(cases.length, 18);
  for (const item of cases) assertEncoded(item.source, item.bytes);

  assertEncoded("MVI A,-256", [0x3e, 0x00]);
  assertEncoded("MVI A,0-1", [0x3e, 0xff]);
  assertEncoded("NEG EQU -1\nMVI A,NEG", [0x3e, 0xff]);
  assertRejected("MVI A,-257");
  assertRejected("MVI A,256");

  const normalized = assemble8085("MVI A,-1");
  assert.deepEqual(normalized.listing[0].bytes, [0x3e, 0xff]);
  assert.deepEqual(normalized.segments, [
    { origin: 0, bytes: [0x3e, 0xff] },
  ]);
});

test("signed word operands encode every affected instruction form", () => {
  const cases: EncodingCase[] = ["B", "D", "H", "SP"].map(
    (pair, index) => ({
      source: `LXI ${pair},-1`,
      bytes: [0x01 + index * 0x10, 0xff, 0xff],
    }),
  );

  for (const [mnemonic, opcode] of [
    ["SHLD", 0x22],
    ["LHLD", 0x2a],
    ["STA", 0x32],
    ["LDA", 0x3a],
    ["JNZ", 0xc2],
    ["JMP", 0xc3],
    ["CNZ", 0xc4],
    ["JZ", 0xca],
    ["CZ", 0xcc],
    ["CALL", 0xcd],
    ["JNC", 0xd2],
    ["CNC", 0xd4],
    ["JC", 0xda],
    ["CC", 0xdc],
    ["JPO", 0xe2],
    ["CPO", 0xe4],
    ["JPE", 0xea],
    ["CPE", 0xec],
    ["JP", 0xf2],
    ["CP", 0xf4],
    ["JM", 0xfa],
    ["CM", 0xfc],
  ] as const) {
    cases.push({ source: `${mnemonic} -1`, bytes: [opcode, 0xff, 0xff] });
  }

  assert.equal(cases.length, 26);
  for (const item of cases) assertEncoded(item.source, item.bytes);

  assertEncoded("LXI H,-65536", [0x21, 0x00, 0x00]);
  assertEncoded("LXI H,0-1", [0x21, 0xff, 0xff]);
  assertEncoded("NEG EQU -1\nJMP NEG", [0xc3, 0xff, 0xff]);
  assertRejected("LXI H,-65537");
  assertRejected("LXI H,65536");
});

test("one- and two-byte character expressions use Intel word ordering", () => {
  for (const [pair, opcode] of [
    ["B", 0x01],
    ["D", 0x11],
    ["H", 0x21],
    ["SP", 0x31],
  ] as const) {
    assertEncoded(`LXI ${pair},'AZ'`, [opcode, 0x5a, 0x41]);
  }

  assertEncoded("MVI A,'A'", [0x3e, 0x41]);
  assertRejected("MVI A,'AZ'");
  assertRejected("LXI H,'ABC'");
  assertRejected("LXI H,'Ā'");
  assertEncoded('DB "ABC"', [0x41, 0x42, 0x43]);
});

test("all 246 canonical Intel instruction forms retain exact encodings", () => {
  const cases: EncodingCase[] = [];
  const add = (source: string, bytes: number[]): void => {
    cases.push({ source, bytes });
  };
  const registers = ["B", "C", "D", "E", "H", "L", "M", "A"];
  const pairs = ["B", "D", "H", "SP"];
  const stackPairs = ["B", "D", "H", "PSW"];

  for (let destination = 0; destination < 8; destination += 1) {
    for (let source = 0; source < 8; source += 1) {
      if (destination !== 6 || source !== 6) {
        add(`MOV ${registers[destination]},${registers[source]}`, [
          0x40 + destination * 8 + source,
        ]);
      }
    }
    add(`MVI ${registers[destination]},5AH`, [
      0x06 + destination * 8,
      0x5a,
    ]);
  }

  for (let pair = 0; pair < 4; pair += 1) {
    add(`LXI ${pairs[pair]},1234H`, [
      0x01 + pair * 0x10,
      0x34,
      0x12,
    ]);
  }
  for (const [mnemonic, opcode] of [
    ["LDA", 0x3a],
    ["STA", 0x32],
    ["LHLD", 0x2a],
    ["SHLD", 0x22],
  ] as const) {
    add(`${mnemonic} 1234H`, [opcode, 0x34, 0x12]);
  }
  add("LDAX B", [0x0a]);
  add("LDAX D", [0x1a]);
  add("STAX B", [0x02]);
  add("STAX D", [0x12]);
  add("XCHG", [0xeb]);

  for (const [mnemonic, base] of [
    ["ADD", 0x80],
    ["ADC", 0x88],
    ["SUB", 0x90],
    ["SBB", 0x98],
    ["ANA", 0xa0],
    ["XRA", 0xa8],
    ["ORA", 0xb0],
    ["CMP", 0xb8],
  ] as const) {
    for (let register = 0; register < 8; register += 1) {
      add(`${mnemonic} ${registers[register]}`, [base + register]);
    }
  }
  for (const [mnemonic, opcode] of [
    ["ADI", 0xc6],
    ["ACI", 0xce],
    ["SUI", 0xd6],
    ["SBI", 0xde],
    ["ANI", 0xe6],
    ["XRI", 0xee],
    ["ORI", 0xf6],
    ["CPI", 0xfe],
  ] as const) {
    add(`${mnemonic} 5AH`, [opcode, 0x5a]);
  }
  for (const [mnemonic, base] of [
    ["INR", 0x04],
    ["DCR", 0x05],
  ] as const) {
    for (let register = 0; register < 8; register += 1) {
      add(`${mnemonic} ${registers[register]}`, [base + register * 8]);
    }
  }
  for (const [mnemonic, base] of [
    ["INX", 0x03],
    ["DCX", 0x0b],
    ["DAD", 0x09],
  ] as const) {
    for (let pair = 0; pair < 4; pair += 1) {
      add(`${mnemonic} ${pairs[pair]}`, [base + pair * 0x10]);
    }
  }
  for (const [mnemonic, opcode] of [
    ["DAA", 0x27],
    ["RLC", 0x07],
    ["RRC", 0x0f],
    ["RAL", 0x17],
    ["RAR", 0x1f],
    ["CMA", 0x2f],
    ["CMC", 0x3f],
    ["STC", 0x37],
  ] as const) {
    add(mnemonic, [opcode]);
  }

  for (const [mnemonic, opcode] of [
    ["JMP", 0xc3],
    ["JNZ", 0xc2],
    ["JZ", 0xca],
    ["JNC", 0xd2],
    ["JC", 0xda],
    ["JPO", 0xe2],
    ["JPE", 0xea],
    ["JP", 0xf2],
    ["JM", 0xfa],
    ["CALL", 0xcd],
    ["CNZ", 0xc4],
    ["CZ", 0xcc],
    ["CNC", 0xd4],
    ["CC", 0xdc],
    ["CPO", 0xe4],
    ["CPE", 0xec],
    ["CP", 0xf4],
    ["CM", 0xfc],
  ] as const) {
    add(`${mnemonic} 1234H`, [opcode, 0x34, 0x12]);
  }
  for (const [mnemonic, opcode] of [
    ["RET", 0xc9],
    ["RNZ", 0xc0],
    ["RZ", 0xc8],
    ["RNC", 0xd0],
    ["RC", 0xd8],
    ["RPO", 0xe0],
    ["RPE", 0xe8],
    ["RP", 0xf0],
    ["RM", 0xf8],
    ["PCHL", 0xe9],
  ] as const) {
    add(mnemonic, [opcode]);
  }
  for (let vector = 0; vector < 8; vector += 1) {
    add(`RST ${vector}`, [0xc7 + vector * 8]);
  }
  for (const [mnemonic, base] of [
    ["PUSH", 0xc5],
    ["POP", 0xc1],
  ] as const) {
    for (let pair = 0; pair < 4; pair += 1) {
      add(`${mnemonic} ${stackPairs[pair]}`, [base + pair * 0x10]);
    }
  }
  add("XTHL", [0xe3]);
  add("SPHL", [0xf9]);
  add("IN 5AH", [0xdb, 0x5a]);
  add("OUT 5AH", [0xd3, 0x5a]);
  for (const [mnemonic, opcode] of [
    ["NOP", 0x00],
    ["HLT", 0x76],
    ["EI", 0xfb],
    ["DI", 0xf3],
    ["RIM", 0x20],
    ["SIM", 0x30],
  ] as const) {
    add(mnemonic, [opcode]);
  }

  assert.equal(cases.length, 246);
  assert.equal(new Set(cases.map((item) => item.bytes[0])).size, 246);
  for (const item of cases) assertEncoded(item.source, item.bytes);
});
