import assert from "node:assert/strict";
import test from "node:test";

import { CPU8085 } from "../lib/cpu8085.ts";

type ExpectedFlags = {
  s: boolean;
  z: boolean;
  ac: boolean;
  p: boolean;
  cy: boolean;
};

function evenParity(value: number): boolean {
  let bits = value & 0xff;
  let ones = 0;
  while (bits !== 0) {
    ones += bits & 1;
    bits >>>= 1;
  }
  return (ones & 1) === 0;
}

function resultFlags(result: number, ac: boolean, cy: boolean): ExpectedFlags {
  const value = result & 0xff;
  return {
    s: (value & 0x80) !== 0,
    z: value === 0,
    ac,
    p: evenParity(value),
    cy,
  };
}

function assertAccumulatorAndFlags(
  cpu: CPU8085,
  accumulator: number,
  flags: ExpectedFlags,
  context: string,
): void {
  if (
    cpu.a !== accumulator ||
    cpu.flags.s !== flags.s ||
    cpu.flags.z !== flags.z ||
    cpu.flags.ac !== flags.ac ||
    cpu.flags.p !== flags.p ||
    cpu.flags.cy !== flags.cy
  ) {
    assert.deepEqual(
      { a: cpu.a, flags: { ...cpu.flags } },
      { a: accumulator, flags },
      context,
    );
  }
}

function assertFlags(
  cpu: CPU8085,
  flags: ExpectedFlags,
  context: string,
): void {
  if (
    cpu.flags.s !== flags.s ||
    cpu.flags.z !== flags.z ||
    cpu.flags.ac !== flags.ac ||
    cpu.flags.p !== flags.p ||
    cpu.flags.cy !== flags.cy
  ) {
    assert.deepEqual({ ...cpu.flags }, flags, context);
  }
}

function prepare(cpu: CPU8085, opcode: number): void {
  cpu.pc = 0;
  cpu.halted = false;
  cpu.totalCycles = 0;
  cpu.memory[0] = opcode;
}

function expectedAdd(
  accumulator: number,
  operand: number,
  carry: number,
): { accumulator: number; flags: ExpectedFlags } {
  const raw = accumulator + operand + carry;
  const result = raw & 0xff;
  const ac = (accumulator & 0x0f) + (operand & 0x0f) + carry > 0x0f;
  return {
    accumulator: result,
    flags: resultFlags(result, ac, raw > 0xff),
  };
}

test("ADD and ADC exhaustively implement 8-bit result, carry, AC, SZP, and carry input rules", () => {
  let checks = 0;

  for (const { opcode, usesCarry, name } of [
    { opcode: 0x80, usesCarry: false, name: "ADD B" },
    { opcode: 0x88, usesCarry: true, name: "ADC B" },
  ]) {
    const cpu = new CPU8085();
    cpu.memory[0] = opcode;

    for (let accumulator = 0; accumulator <= 0xff; accumulator += 1) {
      for (let operand = 0; operand <= 0xff; operand += 1) {
        for (const incomingCarry of [0, 1]) {
          cpu.pc = 0;
          cpu.halted = false;
          cpu.a = accumulator;
          cpu.b = operand;
          cpu.flags.s = (operand & 0x80) === 0;
          cpu.flags.z = operand !== 0;
          cpu.flags.ac = (operand & 1) === 0;
          cpu.flags.p = (accumulator & 1) !== 0;
          cpu.flags.cy = incomingCarry === 1;

          cpu.step();
          const expected = expectedAdd(
            accumulator,
            operand,
            usesCarry ? incomingCarry : 0,
          );
          assertAccumulatorAndFlags(
            cpu,
            expected.accumulator,
            expected.flags,
            `${name}: A=${accumulator.toString(16)}, operand=${operand.toString(16)}, CY=${incomingCarry}`,
          );
          checks += 1;
        }
      }
    }
  }

  assert.equal(checks, 262_144);
});

test("ANA, XRA, and ORA exhaustively implement their result and forced AC/CY rules", () => {
  let checks = 0;

  for (const operation of [
    {
      opcode: 0xa0,
      name: "ANA B",
      apply: (left: number, right: number) => left & right,
      ac: true,
    },
    {
      opcode: 0xa8,
      name: "XRA B",
      apply: (left: number, right: number) => left ^ right,
      ac: false,
    },
    {
      opcode: 0xb0,
      name: "ORA B",
      apply: (left: number, right: number) => left | right,
      ac: false,
    },
  ]) {
    const cpu = new CPU8085();
    cpu.memory[0] = operation.opcode;

    for (let accumulator = 0; accumulator <= 0xff; accumulator += 1) {
      for (let operand = 0; operand <= 0xff; operand += 1) {
        cpu.pc = 0;
        cpu.halted = false;
        cpu.a = accumulator;
        cpu.b = operand;
        cpu.flags.s = (operand & 0x80) === 0;
        cpu.flags.z = operand !== 0;
        cpu.flags.ac = (accumulator & 1) === 0;
        cpu.flags.p = (operand & 1) !== 0;
        cpu.flags.cy = ((accumulator ^ operand) & 1) !== 0;

        cpu.step();
        const result = operation.apply(accumulator, operand) & 0xff;
        assertAccumulatorAndFlags(
          cpu,
          result,
          resultFlags(result, operation.ac, false),
          `${operation.name}: A=${accumulator.toString(16)}, operand=${operand.toString(16)}`,
        );
        checks += 1;
      }
    }
  }

  assert.equal(checks, 196_608);
});

function setInrDestination(cpu: CPU8085, index: number, value: number): void {
  switch (index) {
    case 0: cpu.b = value; break;
    case 1: cpu.c = value; break;
    case 2: cpu.d = value; break;
    case 3: cpu.e = value; break;
    case 4: cpu.h = value; break;
    case 5: cpu.l = value; break;
    case 6:
      cpu.h = 0x30;
      cpu.l = 0x00;
      cpu.memory[0x3000] = value;
      break;
    default: cpu.a = value; break;
  }
}

function getInrDestination(cpu: CPU8085, index: number): number {
  switch (index) {
    case 0: return cpu.b;
    case 1: return cpu.c;
    case 2: return cpu.d;
    case 3: return cpu.e;
    case 4: return cpu.h;
    case 5: return cpu.l;
    case 6: return cpu.memory[0x3000];
    default: return cpu.a;
  }
}

test("every INR destination exhaustively sets AC/SZP and preserves both Carry states", () => {
  let checks = 0;

  for (let destination = 0; destination < 8; destination += 1) {
    const cpu = new CPU8085();
    const opcode = 0x04 | (destination << 3);
    cpu.memory[0] = opcode;

    for (let value = 0; value <= 0xff; value += 1) {
      for (const carry of [false, true]) {
        cpu.pc = 0;
        cpu.halted = false;
        setInrDestination(cpu, destination, value);
        cpu.flags.s = (value & 0x80) === 0;
        cpu.flags.z = value !== 0;
        cpu.flags.ac = (value & 1) !== 0;
        cpu.flags.p = (value & 2) !== 0;
        cpu.flags.cy = carry;

        const step = cpu.step();
        const result = (value + 1) & 0xff;
        const expectedFlags = resultFlags(
          result,
          (value & 0x0f) === 0x0f,
          carry,
        );
        const actual = getInrDestination(cpu, destination);
        if (actual !== result) {
          assert.equal(actual, result, `INR destination ${destination}, value=${value}`);
        }
        assertFlags(
          cpu,
          expectedFlags,
          `INR destination ${destination}, value=${value}, CY=${Number(carry)}`,
        );
        assert.equal(step.cycles, destination === 6 ? 10 : 4);
        checks += 1;
      }
    }
  }

  assert.equal(checks, 4_096);
});

function expectedDaa(
  accumulator: number,
  auxiliaryCarry: boolean,
  carry: boolean,
): { accumulator: number; flags: ExpectedFlags } {
  let adjusted = accumulator & 0xff;
  let nextCarry = carry;
  let nextAuxiliaryCarry = false;

  if ((adjusted & 0x0f) > 9 || auxiliaryCarry) {
    const raw = adjusted + 0x06;
    nextAuxiliaryCarry = (adjusted & 0x0f) + 0x06 > 0x0f;
    nextCarry = nextCarry || raw > 0xff;
    adjusted = raw & 0xff;
  }
  if (((adjusted >>> 4) & 0x0f) > 9 || nextCarry) {
    const raw = adjusted + 0x60;
    nextCarry = nextCarry || raw > 0xff;
    adjusted = raw & 0xff;
  }

  return {
    accumulator: adjusted,
    flags: resultFlags(adjusted, nextAuxiliaryCarry, nextCarry),
  };
}

test("DAA exhaustively follows both sequential decimal corrections for every A/AC/CY input", () => {
  const cpu = new CPU8085();
  cpu.memory[0] = 0x27;
  let checks = 0;

  for (let accumulator = 0; accumulator <= 0xff; accumulator += 1) {
    for (const auxiliaryCarry of [false, true]) {
      for (const carry of [false, true]) {
        cpu.pc = 0;
        cpu.halted = false;
        cpu.a = accumulator;
        cpu.flags.s = (accumulator & 1) !== 0;
        cpu.flags.z = (accumulator & 2) !== 0;
        cpu.flags.ac = auxiliaryCarry;
        cpu.flags.p = (accumulator & 4) !== 0;
        cpu.flags.cy = carry;

        cpu.step();
        const expected = expectedDaa(accumulator, auxiliaryCarry, carry);
        assertAccumulatorAndFlags(
          cpu,
          expected.accumulator,
          expected.flags,
          `DAA: A=${accumulator.toString(16)}, AC=${Number(auxiliaryCarry)}, CY=${Number(carry)}`,
        );
        checks += 1;
      }
    }
  }

  assert.equal(checks, 1_024);
});

test("all four rotates exhaustively update only A and Carry", () => {
  let checks = 0;

  for (const { opcode, name } of [
    { opcode: 0x07, name: "RLC" },
    { opcode: 0x0f, name: "RRC" },
    { opcode: 0x17, name: "RAL" },
    { opcode: 0x1f, name: "RAR" },
  ]) {
    const cpu = new CPU8085();
    cpu.memory[0] = opcode;

    for (let accumulator = 0; accumulator <= 0xff; accumulator += 1) {
      for (const incomingCarry of [false, true]) {
        for (let preserved = 0; preserved < 16; preserved += 1) {
          cpu.pc = 0;
          cpu.halted = false;
          cpu.a = accumulator;
          cpu.flags.s = (preserved & 0x08) !== 0;
          cpu.flags.z = (preserved & 0x04) !== 0;
          cpu.flags.ac = (preserved & 0x02) !== 0;
          cpu.flags.p = (preserved & 0x01) !== 0;
          cpu.flags.cy = incomingCarry;
          const before = { ...cpu.flags };

          const step = cpu.step();
          let expectedAccumulator: number;
          let expectedCarry: boolean;
          if (opcode === 0x07) {
            expectedCarry = (accumulator & 0x80) !== 0;
            expectedAccumulator = ((accumulator << 1) | (expectedCarry ? 1 : 0)) & 0xff;
          } else if (opcode === 0x0f) {
            expectedCarry = (accumulator & 0x01) !== 0;
            expectedAccumulator =
              ((accumulator >>> 1) | (expectedCarry ? 0x80 : 0)) & 0xff;
          } else if (opcode === 0x17) {
            expectedCarry = (accumulator & 0x80) !== 0;
            expectedAccumulator =
              ((accumulator << 1) | (incomingCarry ? 1 : 0)) & 0xff;
          } else {
            expectedCarry = (accumulator & 0x01) !== 0;
            expectedAccumulator =
              ((accumulator >>> 1) | (incomingCarry ? 0x80 : 0)) & 0xff;
          }

          assert.equal(cpu.a, expectedAccumulator, `${name}: A=${accumulator.toString(16)}`);
          assert.equal(cpu.flags.cy, expectedCarry, `${name}: CY for A=${accumulator.toString(16)}`);
          assert.deepEqual(
            {
              s: cpu.flags.s,
              z: cpu.flags.z,
              ac: cpu.flags.ac,
              p: cpu.flags.p,
            },
            { s: before.s, z: before.z, ac: before.ac, p: before.p },
            `${name} changed a preserved flag`,
          );
          assert.equal(step.cycles, 4);
          checks += 1;
        }
      }
    }
  }

  assert.equal(checks, 32_768);
});

test("CMA, STC, and CMC exhaustively change only their documented A or Carry state", () => {
  let checks = 0;

  for (const operation of [
    { name: "CMA", opcode: 0x2f },
    { name: "STC", opcode: 0x37 },
    { name: "CMC", opcode: 0x3f },
  ] as const) {
    const cpu = new CPU8085();
    cpu.memory[0] = operation.opcode;
    cpu.b = 0x12;
    cpu.c = 0x34;
    cpu.d = 0x56;
    cpu.e = 0x78;
    cpu.h = 0x9a;
    cpu.l = 0xbc;
    cpu.sp = 0xdef0;
    const preservedRegisters = {
      b: cpu.b,
      c: cpu.c,
      d: cpu.d,
      e: cpu.e,
      h: cpu.h,
      l: cpu.l,
      sp: cpu.sp,
    };

    for (let accumulator = 0; accumulator <= 0xff; accumulator += 1) {
      for (let flagBits = 0; flagBits < 32; flagBits += 1) {
        cpu.pc = 0;
        cpu.halted = false;
        cpu.a = accumulator;
        cpu.flags.s = (flagBits & 0x10) !== 0;
        cpu.flags.z = (flagBits & 0x08) !== 0;
        cpu.flags.ac = (flagBits & 0x04) !== 0;
        cpu.flags.p = (flagBits & 0x02) !== 0;
        cpu.flags.cy = (flagBits & 0x01) !== 0;
        const beforeFlags = { ...cpu.flags };

        const step = cpu.step();
        const expectedAccumulator = operation.opcode === 0x2f
          ? (~accumulator) & 0xff
          : accumulator;
        const expectedCarry = operation.opcode === 0x37
          ? true
          : operation.opcode === 0x3f
            ? !beforeFlags.cy
            : beforeFlags.cy;

        assertAccumulatorAndFlags(
          cpu,
          expectedAccumulator,
          { ...beforeFlags, cy: expectedCarry },
          `${operation.name}: A=${accumulator.toString(16)}, flags=${flagBits.toString(2).padStart(5, "0")}`,
        );
        assert.deepEqual(
          {
            b: cpu.b,
            c: cpu.c,
            d: cpu.d,
            e: cpu.e,
            h: cpu.h,
            l: cpu.l,
            sp: cpu.sp,
          },
          preservedRegisters,
          `${operation.name} changed an unrelated register`,
        );
        assert.equal(step.memoryWrites.length, 0);
        assert.equal(step.portWrites.length, 0);
        assert.equal(step.cycles, 4);
        checks += 1;
      }
    }
  }

  assert.equal(checks, 24_576);
});

function setPair(cpu: CPU8085, pair: number, value: number): void {
  const normalized = value & 0xffff;
  switch (pair) {
    case 0:
      cpu.b = normalized >>> 8;
      cpu.c = normalized & 0xff;
      break;
    case 1:
      cpu.d = normalized >>> 8;
      cpu.e = normalized & 0xff;
      break;
    case 2:
      cpu.h = normalized >>> 8;
      cpu.l = normalized & 0xff;
      break;
    default:
      cpu.sp = normalized;
      break;
  }
}

test("DAD covers carry boundaries for every pair while preserving all other flags and sources", () => {
  let checks = 0;

  for (let pair = 0; pair < 4; pair += 1) {
    const vectors = pair === 2
      ? [
          { hl: 0x0000, operand: 0x0000 },
          { hl: 0x7fff, operand: 0x7fff },
          { hl: 0x8000, operand: 0x8000 },
          { hl: 0xffff, operand: 0xffff },
        ]
      : [
          { hl: 0x0000, operand: 0x0000 },
          { hl: 0x1234, operand: 0xedcb },
          { hl: 0xffff, operand: 0x0001 },
          { hl: 0x8000, operand: 0x8000 },
        ];

    for (const vector of vectors) {
      for (const oldCarry of [false, true]) {
        for (let preserved = 0; preserved < 16; preserved += 1) {
          const cpu = new CPU8085();
          prepare(cpu, 0x09 | (pair << 4));
          cpu.a = 0x5a;
          cpu.b = 0x11;
          cpu.c = 0x22;
          cpu.d = 0x33;
          cpu.e = 0x44;
          cpu.sp = 0x5566;
          setPair(cpu, 2, vector.hl);
          if (pair !== 2) setPair(cpu, pair, vector.operand);
          const sourceBefore = {
            a: cpu.a,
            b: cpu.b,
            c: cpu.c,
            d: cpu.d,
            e: cpu.e,
            sp: cpu.sp,
          };
          cpu.flags.s = (preserved & 0x08) !== 0;
          cpu.flags.z = (preserved & 0x04) !== 0;
          cpu.flags.ac = (preserved & 0x02) !== 0;
          cpu.flags.p = (preserved & 0x01) !== 0;
          cpu.flags.cy = oldCarry;
          const flagsBefore = { ...cpu.flags };

          const step = cpu.step();
          const raw = vector.hl + vector.operand;
          assert.equal((cpu.h << 8) | cpu.l, raw & 0xffff);
          assert.equal(cpu.flags.cy, raw > 0xffff);
          assert.deepEqual(
            { s: cpu.flags.s, z: cpu.flags.z, ac: cpu.flags.ac, p: cpu.flags.p },
            {
              s: flagsBefore.s,
              z: flagsBefore.z,
              ac: flagsBefore.ac,
              p: flagsBefore.p,
            },
          );
          assert.deepEqual(
            { a: cpu.a, b: cpu.b, c: cpu.c, d: cpu.d, e: cpu.e, sp: cpu.sp },
            sourceBefore,
          );
          assert.equal(step.cycles, 10);
          checks += 1;
        }
      }
    }
  }

  assert.equal(checks, 512);
});

function setAluSource(cpu: CPU8085, source: number, value: number): number {
  switch (source) {
    case 0: cpu.b = value; return value;
    case 1: cpu.c = value; return value;
    case 2: cpu.d = value; return value;
    case 3: cpu.e = value; return value;
    case 4: cpu.h = value; return value;
    case 5: cpu.l = value; return value;
    case 6:
      cpu.h = 0x30;
      cpu.l = 0x00;
      cpu.memory[0x3000] = value;
      return value;
    default: return cpu.a;
  }
}

test("every register, memory, and immediate route reaches the covered ALU flag behavior", () => {
  const accumulator = 0xca;
  const requestedOperand = 0x35;
  let checks = 0;

  for (const family of [
    { base: 0x80, immediate: 0xc6, carry: 0, kind: "add" },
    { base: 0x88, immediate: 0xce, carry: 1, kind: "add" },
    { base: 0xa0, immediate: 0xe6, carry: 0, kind: "and" },
    { base: 0xa8, immediate: 0xee, carry: 0, kind: "xor" },
    { base: 0xb0, immediate: 0xf6, carry: 0, kind: "or" },
  ] as const) {
    for (let source = 0; source < 8; source += 1) {
      const cpu = new CPU8085();
      prepare(cpu, family.base + source);
      cpu.a = accumulator;
      const operand = setAluSource(cpu, source, requestedOperand);
      cpu.flags.cy = family.carry === 1;
      cpu.step();

      let expected: { accumulator: number; flags: ExpectedFlags };
      if (family.kind === "add") {
        expected = expectedAdd(accumulator, operand, family.carry);
      } else {
        const result = family.kind === "and"
          ? accumulator & operand
          : family.kind === "xor"
            ? accumulator ^ operand
            : accumulator | operand;
        expected = {
          accumulator: result,
          flags: resultFlags(result, family.kind === "and", false),
        };
      }
      assertAccumulatorAndFlags(
        cpu,
        expected.accumulator,
        expected.flags,
        `ALU route base=${family.base.toString(16)}, source=${source}`,
      );
      checks += 1;
    }

    const immediateCpu = new CPU8085();
    prepare(immediateCpu, family.immediate);
    immediateCpu.memory[1] = requestedOperand;
    immediateCpu.a = accumulator;
    immediateCpu.flags.cy = family.carry === 1;
    immediateCpu.step();
    const expected = family.kind === "add"
      ? expectedAdd(accumulator, requestedOperand, family.carry)
      : {
          accumulator: family.kind === "and"
            ? accumulator & requestedOperand
            : family.kind === "xor"
              ? accumulator ^ requestedOperand
              : accumulator | requestedOperand,
          flags: resultFlags(
            family.kind === "and"
              ? accumulator & requestedOperand
              : family.kind === "xor"
                ? accumulator ^ requestedOperand
                : accumulator | requestedOperand,
            family.kind === "and",
            false,
          ),
        };
    assertAccumulatorAndFlags(
      immediateCpu,
      expected.accumulator,
      expected.flags,
      `Immediate ALU route opcode=${family.immediate.toString(16)}`,
    );
    checks += 1;
  }

  assert.equal(checks, 45);
});
