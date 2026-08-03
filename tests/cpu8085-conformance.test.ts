import assert from "node:assert/strict";
import test from "node:test";

import { CPU8085 } from "../lib/cpu8085.ts";

const HOLES = new Set([0x08, 0x10, 0x18, 0x28, 0x38, 0xcb, 0xd9, 0xdd, 0xed, 0xfd]);

const LENGTH_ROWS = [
  "1 3 1 1 1 1 2 1 - 1 1 1 1 1 2 1",
  "- 3 1 1 1 1 2 1 - 1 1 1 1 1 2 1",
  "1 3 3 1 1 1 2 1 - 1 3 1 1 1 2 1",
  "1 3 3 1 1 1 2 1 - 1 3 1 1 1 2 1",
  "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
  "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
  "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
  "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
  "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
  "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
  "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
  "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
  "1 1 3 3 3 1 2 1 1 1 3 - 3 3 2 1",
  "1 1 3 2 3 1 2 1 1 - 3 2 3 - 2 1",
  "1 1 3 1 3 1 2 1 1 1 3 1 3 - 2 1",
  "1 1 3 1 3 1 2 1 1 1 3 1 3 - 2 1",
] as const;

const TIMING_ROWS = [
  "4 10 7 6 4 4 7 4 - 10 7 6 4 4 7 4",
  "- 10 7 6 4 4 7 4 - 10 7 6 4 4 7 4",
  "4 10 16 6 4 4 7 4 - 10 16 6 4 4 7 4",
  "4 10 13 6 10 10 10 4 - 10 13 6 4 4 7 4",
  "4 4 4 4 4 4 7 4 4 4 4 4 4 4 7 4",
  "4 4 4 4 4 4 7 4 4 4 4 4 4 4 7 4",
  "4 4 4 4 4 4 7 4 4 4 4 4 4 4 7 4",
  "7 7 7 7 7 7 5 7 4 4 4 4 4 4 7 4",
  "4 4 4 4 4 4 7 4 4 4 4 4 4 4 7 4",
  "4 4 4 4 4 4 7 4 4 4 4 4 4 4 7 4",
  "4 4 4 4 4 4 7 4 4 4 4 4 4 4 7 4",
  "4 4 4 4 4 4 7 4 4 4 4 4 4 4 7 4",
  "6/12 10 7/10 10 9/18 12 7 12 6/12 10 7/10 - 9/18 18 7 12",
  "6/12 10 7/10 10 9/18 12 7 12 6/12 - 7/10 10 9/18 - 7 12",
  "6/12 10 7/10 16 9/18 12 7 12 6/12 6 7/10 4 9/18 - 7 12",
  "6/12 10 7/10 4 9/18 12 7 12 6/12 6 7/10 4 9/18 - 7 12",
] as const;

interface OpcodeExpectation {
  opcode: number;
  length: number;
  notTakenCycles: number;
  takenCycles: number;
}

function parseManifest(): OpcodeExpectation[] {
  const lengths = LENGTH_ROWS.flatMap((row) => row.split(" "));
  const timings = TIMING_ROWS.flatMap((row) => row.split(" "));
  assert.equal(lengths.length, 256);
  assert.equal(timings.length, 256);

  const result: OpcodeExpectation[] = [];
  for (let opcode = 0; opcode <= 0xff; opcode += 1) {
    const lengthToken = lengths[opcode];
    const timingToken = timings[opcode];
    if (lengthToken === "-" || timingToken === "-") {
      assert.equal(HOLES.has(opcode), true, `Unexpected hole at ${opcode.toString(16)}`);
      continue;
    }
    const [notTaken, taken = notTaken] = timingToken.split("/").map(Number);
    result.push({
      opcode,
      length: Number(lengthToken),
      notTakenCycles: notTaken,
      takenCycles: taken,
    });
  }
  return result;
}

const MANIFEST = parseManifest();

type Condition = "NZ" | "Z" | "NC" | "C" | "PO" | "PE" | "P" | "M";
type ConditionalKind = "return" | "jump" | "call";

interface ConditionalCase {
  opcode: number;
  condition: Condition;
  kind: ConditionalKind;
}

const CONDITIONALS: readonly ConditionalCase[] = [
  { opcode: 0xc0, condition: "NZ", kind: "return" },
  { opcode: 0xc2, condition: "NZ", kind: "jump" },
  { opcode: 0xc4, condition: "NZ", kind: "call" },
  { opcode: 0xc8, condition: "Z", kind: "return" },
  { opcode: 0xca, condition: "Z", kind: "jump" },
  { opcode: 0xcc, condition: "Z", kind: "call" },
  { opcode: 0xd0, condition: "NC", kind: "return" },
  { opcode: 0xd2, condition: "NC", kind: "jump" },
  { opcode: 0xd4, condition: "NC", kind: "call" },
  { opcode: 0xd8, condition: "C", kind: "return" },
  { opcode: 0xda, condition: "C", kind: "jump" },
  { opcode: 0xdc, condition: "C", kind: "call" },
  { opcode: 0xe0, condition: "PO", kind: "return" },
  { opcode: 0xe2, condition: "PO", kind: "jump" },
  { opcode: 0xe4, condition: "PO", kind: "call" },
  { opcode: 0xe8, condition: "PE", kind: "return" },
  { opcode: 0xea, condition: "PE", kind: "jump" },
  { opcode: 0xec, condition: "PE", kind: "call" },
  { opcode: 0xf0, condition: "P", kind: "return" },
  { opcode: 0xf2, condition: "P", kind: "jump" },
  { opcode: 0xf4, condition: "P", kind: "call" },
  { opcode: 0xf8, condition: "M", kind: "return" },
  { opcode: 0xfa, condition: "M", kind: "jump" },
  { opcode: 0xfc, condition: "M", kind: "call" },
] as const;

const CONDITIONAL_BY_OPCODE = new Map(CONDITIONALS.map((item) => [item.opcode, item]));

function conditionState(condition: Condition, desired: boolean): Partial<CPU8085["flags"]> {
  switch (condition) {
    case "NZ": return { z: !desired };
    case "Z": return { z: desired };
    case "NC": return { cy: !desired };
    case "C": return { cy: desired };
    case "PO": return { p: !desired };
    case "PE": return { p: desired };
    case "P": return { s: !desired };
    case "M": return { s: desired };
  }
}

function seededCpu(opcode: number): CPU8085 {
  const cpu = new CPU8085();
  cpu.pc = 0x2000;
  cpu.sp = 0x4000;
  cpu.a = 0x59;
  cpu.b = 0x31;
  cpu.c = 0x00;
  cpu.d = 0x32;
  cpu.e = 0x00;
  cpu.h = 0x30;
  cpu.l = 0x00;
  cpu.memory[0x2000] = opcode;
  cpu.memory[0x2001] = 0x45;
  cpu.memory[0x2002] = 0x23;
  cpu.memory[0x3000] = 0x17;
  cpu.memory[0x3100] = 0x28;
  cpu.memory[0x3200] = 0x39;
  cpu.memory[0x4000] = 0x67;
  cpu.memory[0x4001] = 0x45;
  return cpu;
}

test("static Intel manifest covers exactly 246 documented opcode values", () => {
  assert.equal(MANIFEST.length, 246);
  assert.equal(new Set(MANIFEST.map((item) => item.opcode)).size, 246);
  assert.deepEqual(
    [...Array(256).keys()].filter((opcode) => !MANIFEST.some((item) => item.opcode === opcode)),
    [...HOLES],
  );
});

test("every documented opcode executes raw bytes with its exact length and base timing", () => {
  const nonSequential = new Set([
    0x76, 0xc3, 0xc9, 0xcd, 0xe9,
    0xc7, 0xcf, 0xd7, 0xdf, 0xe7, 0xef, 0xf7, 0xff,
  ]);

  for (const expected of MANIFEST) {
    const cpu = seededCpu(expected.opcode);
    const conditional = CONDITIONAL_BY_OPCODE.get(expected.opcode);
    if (conditional) Object.assign(cpu.flags, conditionState(conditional.condition, false));

    const beforeCycles = cpu.totalCycles;
    const result = cpu.step();
    assert.equal(
      result.bytes.length,
      expected.length,
      `Length mismatch for opcode ${expected.opcode.toString(16).padStart(2, "0")}`,
    );
    assert.equal(
      result.cycles,
      expected.notTakenCycles,
      `Timing mismatch for opcode ${expected.opcode.toString(16).padStart(2, "0")}`,
    );
    assert.equal(result.totalCycles - beforeCycles, expected.notTakenCycles);

    if (!nonSequential.has(expected.opcode)) {
      assert.equal(
        cpu.pc,
        (0x2000 + expected.length) & 0xffff,
        `PC advance mismatch for opcode ${expected.opcode.toString(16).padStart(2, "0")}`,
      );
    }
  }
});

test("all 24 conditional instructions take and skip their paths with exact timing", () => {
  assert.equal(CONDITIONALS.length, 24);

  for (const item of CONDITIONALS) {
    const expected = MANIFEST.find((entry) => entry.opcode === item.opcode);
    assert.ok(expected);

    for (const taken of [false, true]) {
      const cpu = seededCpu(item.opcode);
      Object.assign(cpu.flags, conditionState(item.condition, taken));
      const initialSp = cpu.sp;
      const result = cpu.step();
      assert.equal(
        result.cycles,
        taken ? expected.takenCycles : expected.notTakenCycles,
        `${item.condition} ${item.kind} taken=${taken}`,
      );

      if (!taken) {
        assert.equal(cpu.pc, 0x2000 + expected.length);
        assert.equal(cpu.sp, initialSp);
      } else if (item.kind === "jump") {
        assert.equal(cpu.pc, 0x2345);
        assert.equal(cpu.sp, initialSp);
      } else if (item.kind === "call") {
        assert.equal(cpu.pc, 0x2345);
        assert.equal(cpu.sp, 0x3ffe);
        assert.equal(cpu.memory[0x3ffe], 0x03);
        assert.equal(cpu.memory[0x3fff], 0x20);
      } else {
        assert.equal(cpu.pc, 0x4567);
        assert.equal(cpu.sp, 0x4002);
      }
    }
  }
});
