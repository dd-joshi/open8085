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
  cpu.setRegister("PC", assembled.entryPoint);
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

function evenParity(value: number): boolean {
  let bits = value & 0xff;
  let ones = 0;
  while (bits !== 0) {
    ones += bits & 1;
    bits >>>= 1;
  }
  return ones % 2 === 0;
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
  assert.equal(result.entryPoint, 0x2000);
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

test("assembler keeps alphabetic H-suffix symbols distinct from hexadecimal literals", () => {
  const result = assemble8085(`
    ORG 2000H
    JMP deadh
    MVI A, FFH
    LXI H, 0DEADH
DEADH: HLT
FFH EQU 5
  `);

  assert.equal(result.success, true, assemblyFailure(result));
  assert.equal(result.symbols.DEADH, 0x2008);
  assert.equal(result.symbols.FFH, 5);
  assert.deepEqual(result.bytes, [
    0xc3, 0x08, 0x20,
    0x3e, 0x05,
    0x21, 0xad, 0xde,
    0x76,
  ]);

  const undefinedLiteral = assemble8085("MVI A, FFH", 0x2000);
  assert.equal(undefinedLiteral.success, false);
  assert.match(assemblyFailure(undefinedLiteral), /undefined symbol.*FFH/i);
  assert.match(assemblyFailure(undefinedLiteral), /write 0FFH/i);

  const explicitLiteral = assemble8085("MVI A, 0FFH", 0x2000);
  assert.equal(explicitLiteral.success, true, assemblyFailure(explicitLiteral));
  assert.deepEqual(explicitLiteral.bytes, [0x3e, 0xff]);
});

test("assembler separates the lowest emitted origin from the execution entry point", () => {
  const lowerDataAfterCode = assemble8085(`
    ORG 2000H
    MVI A, 42H
    HLT
    ORG 1000H
    DB 99H
  `);
  assert.equal(lowerDataAfterCode.success, true, assemblyFailure(lowerDataAfterCode));
  assert.equal(lowerDataAfterCode.origin, 0x1000);
  assert.equal(lowerDataAfterCode.entryPoint, 0x2000);

  const lowerDataBeforeCode = assemble8085(`
    ORG 1000H
BUFFER: DS 4
    ORG 2000H
START: HLT
  `);
  assert.equal(lowerDataBeforeCode.success, true, assemblyFailure(lowerDataBeforeCode));
  assert.equal(lowerDataBeforeCode.origin, 0x1000);
  assert.equal(lowerDataBeforeCode.entryPoint, 0x2000);

  const firstInstructionInSourceOrder = assemble8085(`
    ORG 3000H
FIRST: NOP
    ORG 2000H
SECOND: HLT
  `);
  assert.equal(
    firstInstructionInSourceOrder.success,
    true,
    assemblyFailure(firstInstructionInSourceOrder),
  );
  assert.equal(firstInstructionInSourceOrder.origin, 0x2000);
  assert.equal(firstInstructionInSourceOrder.entryPoint, 0x3000);

  const dataOnly = assemble8085("ORG 1000H\nDB 11H, 22H", 0x2000);
  assert.equal(dataOnly.success, true, assemblyFailure(dataOnly));
  assert.equal(dataOnly.entryPoint, dataOnly.origin);

  const empty = assemble8085("", 0x2345);
  assert.equal(empty.success, true, assemblyFailure(empty));
  assert.equal(empty.origin, 0x2345);
  assert.equal(empty.entryPoint, 0x2345);

  const { cpu } = loadProgram(`
    ORG 2000H
    MVI A, 42H
    HLT
    ORG 1000H
    DB 99H
  `);
  assert.equal(cpu.pc, 0x2000);
  cpu.step();
  assert.equal(cpu.a, 0x42);
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

test("SUB, SBB, and CMP exhaustively implement Intel borrow and Auxiliary Carry rules", () => {
  const families = [
    { name: "SUB B", opcode: 0x90, borrows: [0], compare: false },
    { name: "SBB B", opcode: 0x98, borrows: [0, 1], compare: false },
    { name: "CMP B", opcode: 0xb8, borrows: [0], compare: true },
  ] as const;

  for (const family of families) {
    const cpu = new CPU8085();
    cpu.memory[0] = family.opcode;
    for (const borrow of family.borrows) {
      for (let accumulator = 0; accumulator <= 0xff; accumulator += 1) {
        for (let operand = 0; operand <= 0xff; operand += 1) {
          cpu.pc = 0;
          cpu.halted = false;
          cpu.a = accumulator;
          cpu.b = operand;
          cpu.flags.cy = borrow === 1;
          cpu.step();

          const raw = accumulator - operand - borrow;
          const result = raw & 0xff;
          const expected = {
            a: family.compare ? accumulator : result,
            cy: raw < 0,
            ac:
              (accumulator & 0x0f) >=
              (operand & 0x0f) + borrow,
            s: (result & 0x80) !== 0,
            z: result === 0,
            p: evenParity(result),
          };
          const actual = {
            a: cpu.a,
            cy: cpu.flags.cy,
            ac: cpu.flags.ac,
            s: cpu.flags.s,
            z: cpu.flags.z,
            p: cpu.flags.p,
          };

          if (
            actual.a !== expected.a ||
            actual.cy !== expected.cy ||
            actual.ac !== expected.ac ||
            actual.s !== expected.s ||
            actual.z !== expected.z ||
            actual.p !== expected.p
          ) {
            assert.deepEqual(
              actual,
              expected,
              `${family.name}: A=${accumulator.toString(16)} operand=${operand.toString(16)} borrow=${borrow}`,
            );
          }
        }
      }
    }
  }
});

test("every subtraction-family opcode variant reaches the corrected flag behavior", () => {
  const registerNames = ["b", "c", "d", "e", "h", "l"] as const;
  const families = [
    { base: 0x90, borrow: 0, compare: false },
    { base: 0x98, borrow: 1, compare: false },
    { base: 0xb8, borrow: 0, compare: true },
  ] as const;

  for (const family of families) {
    for (let source = 0; source < 8; source += 1) {
      const cpu = new CPU8085();
      cpu.memory[0] = family.base + source;
      cpu.pc = 0;
      cpu.a = 0x10;
      cpu.flags.cy = family.borrow === 1;

      let operand = 0x01;
      if (source < 6) {
        cpu[registerNames[source]] = operand;
      } else if (source === 6) {
        cpu.h = 0x20;
        cpu.l = 0x00;
        cpu.memory[0x2000] = operand;
      } else {
        operand = cpu.a;
      }

      const accumulator = cpu.a;
      cpu.step();
      const raw = accumulator - operand - family.borrow;
      const result = raw & 0xff;

      assert.equal(cpu.a, family.compare ? accumulator : result);
      assert.equal(cpu.flags.cy, raw < 0);
      assert.equal(
        cpu.flags.ac,
        (accumulator & 0x0f) >= (operand & 0x0f) + family.borrow,
      );
    }
  }

  for (const { opcode, borrow, compare } of [
    { opcode: 0xd6, borrow: 0, compare: false },
    { opcode: 0xde, borrow: 1, compare: false },
    { opcode: 0xfe, borrow: 0, compare: true },
  ]) {
    const cpu = new CPU8085();
    cpu.memory[0] = opcode;
    cpu.memory[1] = 0x01;
    cpu.a = 0x10;
    cpu.flags.cy = borrow === 1;
    const accumulator = cpu.a;
    cpu.step();
    const raw = accumulator - 0x01 - borrow;
    assert.equal(cpu.a, compare ? accumulator : raw & 0xff);
    assert.equal(cpu.flags.cy, raw < 0);
    assert.equal(
      cpu.flags.ac,
      (accumulator & 0x0f) >= 0x01 + borrow,
    );
  }
});

test("DCR exhaustively sets Auxiliary Carry from D3 and preserves Carry", () => {
  const registerNames = ["b", "c", "d", "e", "h", "l"] as const;

  for (let destination = 0; destination < 8; destination += 1) {
    const cpu = new CPU8085();
    cpu.memory[0] = 0x05 | (destination << 3);

    for (const carry of [false, true]) {
      for (let value = 0; value <= 0xff; value += 1) {
        cpu.pc = 0;
        cpu.halted = false;
        cpu.flags.cy = carry;

        if (destination < 6) {
          cpu[registerNames[destination]] = value;
        } else if (destination === 6) {
          cpu.h = 0x20;
          cpu.l = 0x00;
          cpu.memory[0x2000] = value;
        } else {
          cpu.a = value;
        }

        cpu.step();
        const result = (value - 1) & 0xff;
        const actual =
          destination < 6
            ? cpu[registerNames[destination]]
            : destination === 6
              ? cpu.memory[0x2000]
              : cpu.a;

        assert.equal(actual, result);
        assert.equal(cpu.flags.ac, (value & 0x0f) !== 0);
        assert.equal(cpu.flags.cy, carry);
        assert.equal(cpu.flags.s, (result & 0x80) !== 0);
        assert.equal(cpu.flags.z, result === 0);
        assert.equal(cpu.flags.p, evenParity(result));
      }
    }
  }
});

test("reset masks interrupts and RIM reports the reset state without changing flags", () => {
  const cpu = new CPU8085();
  assert.deepEqual(cpu.interruptMasks, {
    rst55: true,
    rst65: true,
    rst75: true,
  });

  cpu.interruptMasks.rst55 = false;
  cpu.interruptMasks.rst65 = false;
  cpu.interruptMasks.rst75 = false;
  cpu.memory[0x2000] = 0x20;
  cpu.ports[0x02] = 0xa5;
  cpu.reset(false, false);

  assert.deepEqual(cpu.interruptMasks, {
    rst55: true,
    rst65: true,
    rst75: true,
  });
  assert.equal(cpu.memory[0x2000], 0x20);
  assert.equal(cpu.ports[0x02], 0xa5);

  cpu.pc = 0x2000;
  const flagsBefore = { ...cpu.flags };
  const rim = cpu.step();
  assert.equal(rim.mnemonic, "RIM");
  assert.equal(rim.cycles, 4);
  assert.equal(cpu.a, 0x07);
  assert.deepEqual(cpu.flags, flagsBefore);
});

test("HLT consumes five T-states once and preserves the halted machine", () => {
  const cpu = new CPU8085();
  cpu.pc = 0xffff;
  cpu.sp = 0x1234;
  cpu.a = 0x56;
  cpu.flags.ac = true;
  cpu.memory[0xffff] = 0x76;
  cpu.ports[0x01] = 0xaa;
  cpu.totalCycles = 12;

  const halt = cpu.step();
  assert.equal(halt.mnemonic, "HLT");
  assert.equal(halt.cycles, 5);
  assert.equal(halt.totalCycles, 17);
  assert.equal(halt.nextPC, 0x0000);
  assert.equal(cpu.pc, 0x0000);
  assert.equal(cpu.halted, true);
  assert.equal(cpu.sp, 0x1234);
  assert.equal(cpu.a, 0x56);
  assert.equal(cpu.flags.ac, true);
  assert.equal(cpu.memory[0xffff], 0x76);
  assert.equal(cpu.ports[0x01], 0xaa);

  const haltedAgain = cpu.step();
  assert.equal(haltedAgain.cycles, 0);
  assert.equal(haltedAgain.totalCycles, 17);
  assert.equal(cpu.pc, 0x0000);
  assert.equal(cpu.totalCycles, 17);
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
