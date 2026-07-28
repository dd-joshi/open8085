import assert from "node:assert/strict";
import test from "node:test";

import {
  assemble8085,
  type Assemble8085Result,
} from "../lib/assembler8085.ts";
import { CPU8085, type StepResult } from "../lib/cpu8085.ts";

function assemblyFailure(result: Assemble8085Result): string {
  return result.errors
    .map((error) => `line ${error.line}: ${error.message}`)
    .join("\n");
}

function loadProgram(
  source: string,
  defaultOrigin = 0,
): { assembled: Assemble8085Result; cpu: CPU8085 } {
  const assembled = assemble8085(source, defaultOrigin);
  assert.equal(
    assembled.success,
    true,
    `Assembly failed:\n${assemblyFailure(assembled)}`,
  );

  const cpu = new CPU8085();
  for (const segment of assembled.segments) {
    cpu.load(segment.bytes, segment.origin);
  }
  cpu.setRegister("PC", assembled.origin);
  return { assembled, cpu };
}

function runToHalt(cpu: CPU8085, maxSteps = 1_000): StepResult[] {
  const steps: StepResult[] = [];
  while (!cpu.halted && steps.length < maxSteps) {
    steps.push(cpu.step());
  }
  assert.equal(
    cpu.halted,
    true,
    `Program did not halt within ${maxSteps} instructions (PC=${cpu.pc
      .toString(16)
      .padStart(4, "0")}H).`,
  );
  return steps;
}

test("assembler resolves forward labels and common numeric formats", () => {
  const result = assemble8085(`
    ORG 2000H
    MVI A, 42
    MVI B, 0x2A
    MVI C, 0b00101010
    MVI D, %00101010
    MVI E, 00101010B
    JMP finished
    DB 2AH
finished: HLT
  `);

  assert.equal(result.success, true, assemblyFailure(result));
  assert.equal(result.origin, 0x2000);
  assert.equal(result.symbols.FINISHED, 0x200e);
  assert.deepEqual(result.bytes, [
    0x3e, 42,
    0x06, 0x2a,
    0x0e, 0x2a,
    0x16, 0x2a,
    0x1e, 0x2a,
    0xc3, 0x0e, 0x20,
    0x2a,
    0x76,
  ]);
  assert.deepEqual(result.segments, [{ origin: 0x2000, bytes: result.bytes }]);
});

test("assembler emits EQU, DB, DW, DS, ORG, strings, and little-endian words", () => {
  const result = assemble8085(`
COUNT EQU 3
ORG 0100H
table: DB "HI", '!', COUNT + 1
words: DW table, 1234H
space: DS 3
ORG 0120H
tail: DB $ - table
  `);

  assert.equal(result.success, true, assemblyFailure(result));
  assert.deepEqual(
    {
      COUNT: result.symbols.COUNT,
      TABLE: result.symbols.TABLE,
      WORDS: result.symbols.WORDS,
      SPACE: result.symbols.SPACE,
      TAIL: result.symbols.TAIL,
    },
    {
      COUNT: 3,
      TABLE: 0x0100,
      WORDS: 0x0104,
      SPACE: 0x0108,
      TAIL: 0x0120,
    },
  );
  assert.deepEqual(result.segments, [
    {
      origin: 0x0100,
      bytes: [
        0x48, 0x49, 0x21, 0x04,
        0x00, 0x01, 0x34, 0x12,
        0x00, 0x00, 0x00,
      ],
    },
    { origin: 0x0120, bytes: [0x20] },
  ]);
  assert.equal(result.bytes.length, 0x21);
  assert.deepEqual(result.bytes.slice(0, 11), result.segments[0].bytes);
  assert.ok(result.bytes.slice(11, 0x20).every((value) => value === 0));
  assert.equal(result.bytes[0x20], 0x20);
});

test("assembler reports line-specific errors without throwing", () => {
  const result = assemble8085(`
same: NOP
same: HLT
MVI A, 256
JMP nowhere
MOV M, M
BOGUS A
  `);

  assert.equal(result.success, false);
  assert.ok(result.errors.length >= 5, assemblyFailure(result));

  const messagesByLine = new Map<number, string[]>();
  for (const error of result.errors) {
    const messages = messagesByLine.get(error.line) ?? [];
    messages.push(error.message);
    messagesByLine.set(error.line, messages);
  }
  const lineMessages = (line: number): string =>
    (messagesByLine.get(line) ?? []).join("\n");

  assert.match(lineMessages(3), /duplicate symbol/i);
  assert.match(lineMessages(4), /(8-bit|0\.\.255|range)/i);
  assert.match(lineMessages(5), /(undefined|nowhere|unresolved)/i);
  assert.match(lineMessages(6), /(MOV M,\s*M|memory.*memory|invalid)/i);
  assert.match(lineMessages(7), /(unknown|unsupported|bogus)/i);
});

test("assembled 8-bit addition produces and then consumes carry", () => {
  const { cpu } = loadProgram(`
    ORG 0100H
    MVI A, 0FFH
    ADI 01H
    MVI B, 00H
    ADC B
    HLT
  `);

  cpu.step();
  cpu.step();
  assert.equal(cpu.a, 0x00);
  assert.deepEqual(cpu.flags, {
    s: false,
    z: true,
    ac: true,
    p: true,
    cy: true,
  });

  cpu.step();
  cpu.step();
  assert.equal(cpu.a, 0x01);
  assert.equal(cpu.flags.cy, false);
  assert.equal(cpu.flags.z, false);
  assert.equal(cpu.flags.p, false);

  runToHalt(cpu);
});

test("assembled conditional loop follows JNZ until the counter reaches zero", () => {
  const { cpu } = loadProgram(`
    ORG 0200H
    MVI B, 05H
    MVI A, 00H
loop: INR A
    DCR B
    JNZ loop
    HLT
  `);

  const steps = runToHalt(cpu);
  assert.equal(cpu.a, 5);
  assert.equal(cpu.b, 0);
  assert.equal(cpu.flags.z, true);
  assert.equal(
    steps.filter((step) => step.mnemonic.startsWith("JNZ")).length,
    5,
  );
});

test("assembled CALL and RET preserve the return address and restore SP", () => {
  const { cpu } = loadProgram(`
    ORG 0300H
    LXI SP, 4000H
    MVI A, 05H
    CALL twice
    STA 5000H
    HLT
twice:
    ADD A
    RET
  `);

  const steps = runToHalt(cpu);
  assert.equal(cpu.a, 0x0a);
  assert.equal(cpu.memory[0x5000], 0x0a);
  assert.equal(cpu.sp, 0x4000);
  assert.equal(cpu.memory[0x3ffe], 0x08);
  assert.equal(cpu.memory[0x3fff], 0x03);
  assert.ok(steps.some((step) => step.mnemonic.startsWith("CALL")));
  assert.ok(steps.some((step) => step.mnemonic === "RET"));
});

test("assembled block-copy loop moves bytes through HL and DE", () => {
  const { assembled, cpu } = loadProgram(`
    ORG 0400H
    LXI H, source
    LXI D, 6000H
    MVI C, 04H
copy:
    MOV A, M
    STAX D
    INX H
    INX D
    DCR C
    JNZ copy
    HLT
source:
    DB 11H, 22H, 33H, 44H
  `);

  runToHalt(cpu);
  assert.deepEqual(
    Array.from(cpu.memory.slice(0x6000, 0x6004)),
    [0x11, 0x22, 0x33, 0x44],
  );
  assert.equal(cpu.getRegister("HL"), assembled.symbols.SOURCE + 4);
  assert.equal(cpu.getRegister("DE"), 0x6004);
  assert.equal(cpu.c, 0);
});

test("assembled IN and OUT exchange data with the 8-bit port space", () => {
  const { cpu } = loadProgram(`
    ORG 0500H
    IN 10H
    ADI 01H
    OUT 11H
    HLT
  `);
  cpu.setPort(0x10, 0x41);

  const steps = runToHalt(cpu);
  assert.equal(cpu.a, 0x42);
  assert.equal(cpu.ports[0x11], 0x42);
  const outStep = steps.find((step) => step.mnemonic.startsWith("OUT"));
  assert.ok(outStep);
  assert.deepEqual(outStep.portWrites, [
    { port: 0x11, previous: 0x00, value: 0x42 },
  ]);
});

test("assembled DAA converts a binary sum to packed BCD and updates flags", () => {
  const { cpu } = loadProgram(`
    ORG 0600H
    MVI A, 09H
    ADI 09H
    DAA
    HLT
  `);

  runToHalt(cpu);
  assert.equal(cpu.a, 0x18);
  assert.equal(cpu.flags.cy, false);
  assert.equal(cpu.flags.z, false);
  assert.equal(cpu.flags.s, false);
  assert.equal(cpu.flags.p, true);
});
