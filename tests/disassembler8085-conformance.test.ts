import assert from "node:assert/strict";
import test from "node:test";

import { CPU8085 } from "../lib/cpu8085.ts";

const UNDOCUMENTED_OPCODES = [
  0x08, 0x10, 0x18, 0x28, 0x38, 0xcb, 0xd9, 0xdd, 0xed, 0xfd,
] as const;
const UNDOCUMENTED = new Set<number>(UNDOCUMENTED_OPCODES);

const D8 = "{d8}";
const D16 = "{d16}";

/**
 * Literal Intel 8085 opcode map. Null slots are the ten undocumented holes.
 * Keeping this table explicit prevents production decoder masks or their
 * ordering from becoming the expected-value oracle.
 */
const OPCODE_TEMPLATE_ROWS: readonly (readonly (string | null)[])[] = [
  [
    "NOP", `LXI B, ${D16}`, "STAX B", "INX B",
    "INR B", "DCR B", `MVI B, ${D8}`, "RLC",
    null, "DAD B", "LDAX B", "DCX B",
    "INR C", "DCR C", `MVI C, ${D8}`, "RRC",
  ],
  [
    null, `LXI D, ${D16}`, "STAX D", "INX D",
    "INR D", "DCR D", `MVI D, ${D8}`, "RAL",
    null, "DAD D", "LDAX D", "DCX D",
    "INR E", "DCR E", `MVI E, ${D8}`, "RAR",
  ],
  [
    "RIM", `LXI H, ${D16}`, `SHLD ${D16}`, "INX H",
    "INR H", "DCR H", `MVI H, ${D8}`, "DAA",
    null, "DAD H", `LHLD ${D16}`, "DCX H",
    "INR L", "DCR L", `MVI L, ${D8}`, "CMA",
  ],
  [
    "SIM", `LXI SP, ${D16}`, `STA ${D16}`, "INX SP",
    "INR M", "DCR M", `MVI M, ${D8}`, "STC",
    null, "DAD SP", `LDA ${D16}`, "DCX SP",
    "INR A", "DCR A", `MVI A, ${D8}`, "CMC",
  ],
  [
    "MOV B, B", "MOV B, C", "MOV B, D", "MOV B, E",
    "MOV B, H", "MOV B, L", "MOV B, M", "MOV B, A",
    "MOV C, B", "MOV C, C", "MOV C, D", "MOV C, E",
    "MOV C, H", "MOV C, L", "MOV C, M", "MOV C, A",
  ],
  [
    "MOV D, B", "MOV D, C", "MOV D, D", "MOV D, E",
    "MOV D, H", "MOV D, L", "MOV D, M", "MOV D, A",
    "MOV E, B", "MOV E, C", "MOV E, D", "MOV E, E",
    "MOV E, H", "MOV E, L", "MOV E, M", "MOV E, A",
  ],
  [
    "MOV H, B", "MOV H, C", "MOV H, D", "MOV H, E",
    "MOV H, H", "MOV H, L", "MOV H, M", "MOV H, A",
    "MOV L, B", "MOV L, C", "MOV L, D", "MOV L, E",
    "MOV L, H", "MOV L, L", "MOV L, M", "MOV L, A",
  ],
  [
    "MOV M, B", "MOV M, C", "MOV M, D", "MOV M, E",
    "MOV M, H", "MOV M, L", "HLT", "MOV M, A",
    "MOV A, B", "MOV A, C", "MOV A, D", "MOV A, E",
    "MOV A, H", "MOV A, L", "MOV A, M", "MOV A, A",
  ],
  [
    "ADD B", "ADD C", "ADD D", "ADD E",
    "ADD H", "ADD L", "ADD M", "ADD A",
    "ADC B", "ADC C", "ADC D", "ADC E",
    "ADC H", "ADC L", "ADC M", "ADC A",
  ],
  [
    "SUB B", "SUB C", "SUB D", "SUB E",
    "SUB H", "SUB L", "SUB M", "SUB A",
    "SBB B", "SBB C", "SBB D", "SBB E",
    "SBB H", "SBB L", "SBB M", "SBB A",
  ],
  [
    "ANA B", "ANA C", "ANA D", "ANA E",
    "ANA H", "ANA L", "ANA M", "ANA A",
    "XRA B", "XRA C", "XRA D", "XRA E",
    "XRA H", "XRA L", "XRA M", "XRA A",
  ],
  [
    "ORA B", "ORA C", "ORA D", "ORA E",
    "ORA H", "ORA L", "ORA M", "ORA A",
    "CMP B", "CMP C", "CMP D", "CMP E",
    "CMP H", "CMP L", "CMP M", "CMP A",
  ],
  [
    "RNZ", "POP B", `JNZ ${D16}`, `JMP ${D16}`,
    `CNZ ${D16}`, "PUSH B", `ADI ${D8}`, "RST 0",
    "RZ", "RET", `JZ ${D16}`, null,
    `CZ ${D16}`, `CALL ${D16}`, `ACI ${D8}`, "RST 1",
  ],
  [
    "RNC", "POP D", `JNC ${D16}`, `OUT ${D8}`,
    `CNC ${D16}`, "PUSH D", `SUI ${D8}`, "RST 2",
    "RC", null, `JC ${D16}`, `IN ${D8}`,
    `CC ${D16}`, null, `SBI ${D8}`, "RST 3",
  ],
  [
    "RPO", "POP H", `JPO ${D16}`, "XTHL",
    `CPO ${D16}`, "PUSH H", `ANI ${D8}`, "RST 4",
    "RPE", "PCHL", `JPE ${D16}`, "XCHG",
    `CPE ${D16}`, null, `XRI ${D8}`, "RST 5",
  ],
  [
    "RP", "POP PSW", `JP ${D16}`, "DI",
    `CP ${D16}`, "PUSH PSW", `ORI ${D8}`, "RST 6",
    "RM", "SPHL", `JM ${D16}`, "EI",
    `CM ${D16}`, null, `CPI ${D8}`, "RST 7",
  ],
] as const;

const OPCODE_TEMPLATES = OPCODE_TEMPLATE_ROWS.flat();

type ExpectedDecode = {
  length: 1 | 2 | 3;
  mnemonic: string;
};

function hex8(value: number): string {
  const digits = (value & 0xff).toString(16).toUpperCase().padStart(2, "0");
  return `${/^[A-F]/.test(digits) ? "0" : ""}${digits}H`;
}

function hex16(value: number): string {
  const digits = (value & 0xffff).toString(16).toUpperCase().padStart(4, "0");
  return `${/^[A-F]/.test(digits) ? "0" : ""}${digits}H`;
}

function expectedDecode(
  opcode: number,
  immediate8: number,
  immediate16: number,
): ExpectedDecode {
  const template = OPCODE_TEMPLATES[opcode];
  if (template === null) {
    return { length: 1, mnemonic: `NOP* ${hex8(opcode)}` };
  }
  assert.notEqual(template, undefined, `Missing test template for opcode ${hex8(opcode)}`);
  const length: 1 | 2 | 3 = template.includes(D16)
    ? 3
    : template.includes(D8)
      ? 2
      : 1;
  return {
    length,
    mnemonic: template
      .replace(D16, hex16(immediate16))
      .replace(D8, hex8(immediate8)),
  };
}

function disassemble(
  opcode: number,
  immediate8: number,
  immediateHigh: number,
) {
  const cpu = new CPU8085();
  const address = 0x2000;
  cpu.memory[address] = opcode;
  cpu.memory[address + 1] = immediate8;
  cpu.memory[address + 2] = immediateHigh;
  return cpu.disassembleAt(address);
}

test("static Intel table defines all 256 opcode slots and exactly ten explicit holes", () => {
  assert.equal(OPCODE_TEMPLATE_ROWS.length, 16);
  for (const row of OPCODE_TEMPLATE_ROWS) assert.equal(row.length, 16);
  assert.equal(OPCODE_TEMPLATES.length, 256);
  assert.deepEqual(
    OPCODE_TEMPLATES
      .map((template, opcode) => (template === null ? opcode : -1))
      .filter((opcode) => opcode >= 0),
    [...UNDOCUMENTED_OPCODES],
  );
});

test("all 246 documented opcodes disassemble with assembler-safe high hexadecimal operands", () => {
  const immediate8 = 0xcd;
  const immediateHigh = 0xab;
  const immediate16 = 0xabcd;
  let documented = 0;
  let immediate8Instructions = 0;
  let immediate16Instructions = 0;

  for (let opcode = 0; opcode <= 0xff; opcode += 1) {
    if (UNDOCUMENTED.has(opcode)) continue;
    const expected = expectedDecode(opcode, immediate8, immediate16);
    const actual = disassemble(opcode, immediate8, immediateHigh);
    const expectedBytes = [opcode, immediate8, immediateHigh].slice(0, expected.length);

    assert.deepEqual(
      actual,
      {
        address: 0x2000,
        opcode,
        bytes: expectedBytes,
        length: expected.length,
        mnemonic: expected.mnemonic,
      },
      `Wrong high-value disassembly for opcode ${hex8(opcode)}`,
    );
    documented += 1;
    if (expected.length === 2) immediate8Instructions += 1;
    if (expected.length === 3) immediate16Instructions += 1;
  }

  assert.equal(documented, 246);
  assert.equal(immediate8Instructions, 18);
  assert.equal(immediate16Instructions, 26);
});

test("all ten undocumented holes remain explicit stable one-byte decodes", () => {
  const expectedMnemonics = [
    "NOP* 08H",
    "NOP* 10H",
    "NOP* 18H",
    "NOP* 28H",
    "NOP* 38H",
    "NOP* 0CBH",
    "NOP* 0D9H",
    "NOP* 0DDH",
    "NOP* 0EDH",
    "NOP* 0FDH",
  ];

  assert.deepEqual([...UNDOCUMENTED], [...UNDOCUMENTED_OPCODES]);
  for (const [index, opcode] of UNDOCUMENTED_OPCODES.entries()) {
    const actual = disassemble(opcode, 0xcd, 0xab);
    assert.equal(actual.length, 1);
    assert.deepEqual(actual.bytes, [opcode]);
    assert.equal(actual.mnemonic, expectedMnemonics[index]);
  }
});

test("low hexadecimal operand formatting remains unchanged for all documented opcodes", () => {
  const immediate8 = 0x34;
  const immediateHigh = 0x12;
  const immediate16 = 0x1234;
  let documented = 0;

  for (let opcode = 0; opcode <= 0xff; opcode += 1) {
    if (UNDOCUMENTED.has(opcode)) continue;
    const expected = expectedDecode(opcode, immediate8, immediate16);
    const actual = disassemble(opcode, immediate8, immediateHigh);
    assert.equal(
      actual.mnemonic,
      expected.mnemonic,
      `Low-value text changed for opcode ${hex8(opcode)}`,
    );
    documented += 1;
  }

  assert.equal(documented, 246);
  assert.equal(disassemble(0x3e, immediate8, immediateHigh).mnemonic, "MVI A, 34H");
  assert.equal(disassemble(0x21, immediate8, immediateHigh).mnemonic, "LXI H, 1234H");
  assert.equal(disassemble(0xc3, immediate8, immediateHigh).mnemonic, "JMP 1234H");
  assert.equal(disassemble(0xd3, immediate8, immediateHigh).mnemonic, "OUT 34H");
});

test("the assembler-safe leading zero begins exactly at the A-prefix boundary", () => {
  assert.equal(disassemble(0x3e, 0x9f, 0x00).mnemonic, "MVI A, 9FH");
  assert.equal(disassemble(0x3e, 0xa0, 0x00).mnemonic, "MVI A, 0A0H");
  assert.equal(disassemble(0xc3, 0xff, 0x9f).mnemonic, "JMP 9FFFH");
  assert.equal(disassemble(0xc3, 0x00, 0xa0).mnemonic, "JMP 0A000H");
});
