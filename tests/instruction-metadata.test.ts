import assert from "node:assert/strict";
import test from "node:test";

import { INSTRUCTION_SET_8085 } from "../lib/assembler8085.ts";

test("all 80 instruction-reference entries expose opcode and qualified T-states", () => {
  assert.equal(INSTRUCTION_SET_8085.length, 80);
  assert.equal(
    new Set(INSTRUCTION_SET_8085.map((instruction) => instruction.mnemonic)).size,
    80,
  );

  for (const instruction of INSTRUCTION_SET_8085) {
    assert.ok(instruction.opcode.trim(), `${instruction.mnemonic} has no opcode`);
    assert.ok(instruction.tStates.trim(), `${instruction.mnemonic} has no T-states`);
  }
});

test("all 80 reference opcode fields match the Intel opcode map", () => {
  const expected: Readonly<Record<string, string>> = {
    MOV: "01dddsss", MVI: "00ddd110", LXI: "00rp0001",
    LDA: "3A", STA: "32", LHLD: "2A", SHLD: "22",
    LDAX: "0A/1A", STAX: "02/12", XCHG: "EB",
    ADD: "80+r", ADI: "C6", ADC: "88+r", ACI: "CE",
    SUB: "90+r", SUI: "D6", SBB: "98+r", SBI: "DE",
    INR: "04+8r", DCR: "05+8r", INX: "03+10h*rp",
    DCX: "0B+10h*rp", DAD: "09+10h*rp", DAA: "27",
    ANA: "A0+r", ANI: "E6", XRA: "A8+r", XRI: "EE",
    ORA: "B0+r", ORI: "F6", CMP: "B8+r", CPI: "FE",
    RLC: "07", RRC: "0F", RAL: "17", RAR: "1F",
    CMA: "2F", CMC: "3F", STC: "37", JMP: "C3",
    JNZ: "C2", JZ: "CA", JNC: "D2", JC: "DA",
    JPO: "E2", JPE: "EA", JP: "F2", JM: "FA",
    CALL: "CD", CNZ: "C4", CZ: "CC", CNC: "D4",
    CC: "DC", CPO: "E4", CPE: "EC", CP: "F4", CM: "FC",
    RET: "C9", RNZ: "C0", RZ: "C8", RNC: "D0", RC: "D8",
    RPO: "E0", RPE: "E8", RP: "F0", RM: "F8",
    RST: "C7+8n", PCHL: "E9", PUSH: "C5+10h*rp",
    POP: "C1+10h*rp", XTHL: "E3", SPHL: "F9",
    IN: "DB", OUT: "D3", NOP: "00", HLT: "76",
    EI: "FB", DI: "F3", RIM: "20", SIM: "30",
  };

  assert.equal(Object.keys(expected).length, 80);
  for (const instruction of INSTRUCTION_SET_8085) {
    assert.equal(
      instruction.opcode,
      expected[instruction.mnemonic],
      instruction.mnemonic,
    );
  }
});

test("all 80 reference timings match the Intel timing table", () => {
  const expectedGroups: readonly (readonly [
    timing: string,
    mnemonics: readonly string[],
  ])[] = [
    ["4 (register), 7 (memory)", ["MOV", "ADD", "ADC", "SUB", "SBB", "ANA", "XRA", "ORA", "CMP"]],
    ["7 (register), 10 (memory)", ["MVI"]],
    ["4 (register), 10 (memory)", ["INR", "DCR"]],
    ["7", ["ADI", "ACI", "SUI", "SBI", "ANI", "XRI", "ORI", "CPI", "LDAX", "STAX"]],
    ["6", ["INX", "DCX", "PCHL", "SPHL"]],
    ["10", ["LXI", "DAD", "JMP", "RET", "POP", "IN", "OUT"]],
    ["13", ["LDA", "STA"]],
    ["16", ["LHLD", "SHLD", "XTHL"]],
    ["4", ["XCHG", "DAA", "RLC", "RRC", "RAL", "RAR", "CMA", "CMC", "STC", "NOP", "EI", "DI", "RIM", "SIM"]],
    ["7 (not taken), 10 (taken)", ["JNZ", "JZ", "JNC", "JC", "JPO", "JPE", "JP", "JM"]],
    ["18", ["CALL"]],
    ["9 (not taken), 18 (taken)", ["CNZ", "CZ", "CNC", "CC", "CPO", "CPE", "CP", "CM"]],
    ["6 (not taken), 12 (taken)", ["RNZ", "RZ", "RNC", "RC", "RPO", "RPE", "RP", "RM"]],
    ["12", ["PUSH", "RST"]],
    ["5", ["HLT"]],
  ];
  const expected = new Map<string, string>();
  for (const [timing, mnemonics] of expectedGroups) {
    for (const mnemonic of mnemonics) {
      assert.equal(expected.has(mnemonic), false, `Duplicate timing for ${mnemonic}`);
      expected.set(mnemonic, timing);
    }
  }

  assert.equal(expected.size, 80);
  assert.deepEqual(
    INSTRUCTION_SET_8085.map((instruction) => instruction.mnemonic).sort(),
    [...expected.keys()].sort(),
  );
  for (const instruction of INSTRUCTION_SET_8085) {
    assert.equal(
      instruction.tStates,
      expected.get(instruction.mnemonic),
      instruction.mnemonic,
    );
  }
});
