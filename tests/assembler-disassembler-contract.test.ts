import assert from "node:assert/strict";
import test from "node:test";

import { assemble8085, type Assemble8085Result } from "../lib/assembler8085.ts";
import { CPU8085 } from "../lib/cpu8085.ts";

const UNDOCUMENTED_OPCODES = [
  0x08, 0x10, 0x18, 0x28, 0x38, 0xcb, 0xd9, 0xdd, 0xed, 0xfd,
] as const;
const UNDOCUMENTED = new Set<number>(UNDOCUMENTED_OPCODES);

function assemblyFailure(result: Assemble8085Result): string {
  return result.errors
    .map((error) => `line ${error.line}: ${error.message}`)
    .join("\n");
}

function decodedInstruction(
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

function assertRoundTrip(
  opcode: number,
  immediate8: number,
  immediateHigh: number,
): number {
  const decoded = decodedInstruction(opcode, immediate8, immediateHigh);
  const assembled = assemble8085(decoded.mnemonic, 0x2000);
  assert.equal(
    assembled.success,
    true,
    `Could not reassemble ${decoded.mnemonic} from opcode ${opcode
      .toString(16)
      .toUpperCase()
      .padStart(2, "0")}H:\n${assemblyFailure(assembled)}`,
  );
  assert.deepEqual(
    assembled.bytes,
    decoded.bytes,
    `Round-trip bytes changed for ${decoded.mnemonic}`,
  );
  assert.equal(assembled.origin, 0x2000);
  assert.equal(assembled.entryPoint, 0x2000);
  return decoded.length;
}

test("all 246 documented high-value disassemblies reassemble to their original bytes", () => {
  let documented = 0;
  let high8 = 0;
  let high16 = 0;

  for (let opcode = 0; opcode <= 0xff; opcode += 1) {
    if (UNDOCUMENTED.has(opcode)) continue;
    const decoded = decodedInstruction(opcode, 0xcd, 0xab);
    const length = assertRoundTrip(opcode, 0xcd, 0xab);

    if (length === 2) {
      assert.match(decoded.mnemonic, /0CDH$/);
      high8 += 1;
    } else if (length === 3) {
      assert.match(decoded.mnemonic, /0ABCDH$/);
      high16 += 1;
    }
    documented += 1;
  }

  assert.equal(documented, 246);
  assert.equal(high8, 18);
  assert.equal(high16, 26);
});

test("all 246 documented low-value disassemblies retain their round-trip behavior", () => {
  let documented = 0;

  for (let opcode = 0; opcode <= 0xff; opcode += 1) {
    if (UNDOCUMENTED.has(opcode)) continue;
    assertRoundTrip(opcode, 0x34, 0x12);
    documented += 1;
  }

  assert.equal(documented, 246);
});

test("round-trip coverage excludes exactly the ten explicit undocumented holes", () => {
  assert.deepEqual(
    [...UNDOCUMENTED].map((opcode) => opcode.toString(16).toUpperCase().padStart(2, "0")),
    ["08", "10", "18", "28", "38", "CB", "D9", "DD", "ED", "FD"],
  );

  for (const opcode of UNDOCUMENTED_OPCODES) {
    assert.match(decodedInstruction(opcode, 0xcd, 0xab).mnemonic, /^NOP\* /);
  }
});
