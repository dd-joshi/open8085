import assert from "node:assert/strict";
import test from "node:test";

import { CPU8085 } from "../lib/cpu8085.ts";
import {
  createInstructionInsight,
  packFlagRegister,
  type InstructionInsight,
} from "../lib/insight8085.ts";

const UNDOCUMENTED = new Set([
  0x08, 0x10, 0x18, 0x28, 0x38, 0xcb, 0xd9, 0xdd, 0xed, 0xfd,
]);
const REGISTER_NAMES = ["B", "C", "D", "E", "H", "L", "M", "A"] as const;
const PAIR_NAMES = ["B", "D", "H", "SP"] as const;
const STACK_PAIR_NAMES = ["B", "D", "H", "PSW"] as const;
const CONDITION_NAMES = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"] as const;
const ALU_NAMES = ["ADD", "ADC", "SUB", "SBB", "ANA", "XRA", "ORA", "CMP"] as const;
const IMMEDIATE_ALU_NAMES = ["ADI", "ACI", "SUI", "SBI", "ANI", "XRI", "ORI", "CPI"] as const;

function execute(cpu: CPU8085): {
  insight: InstructionInsight;
  before: ReturnType<CPU8085["getState"]>;
  after: ReturnType<CPU8085["getState"]>;
} {
  const before = cpu.getState();
  const step = cpu.step();
  const after = cpu.getState();
  return {
    before,
    after,
    insight: createInstructionInsight({
      before,
      after,
      step,
      memory: cpu.memory,
      ports: cpu.ports,
    }),
  };
}

function cpuFor(opcode: number, operands: number[] = []): CPU8085 {
  const cpu = new CPU8085();
  cpu.pc = 0x2000;
  cpu.sp = 0x4000;
  cpu.b = 0x30;
  cpu.c = 0x00;
  cpu.d = 0x31;
  cpu.e = 0x00;
  cpu.h = 0x32;
  cpu.l = 0x00;
  cpu.a = 0x55;
  cpu.memory[0x2000] = opcode;
  cpu.memory[0x2001] = operands[0] ?? 0x34;
  cpu.memory[0x2002] = operands[1] ?? 0x12;
  cpu.memory[0x3000] = 0x11;
  cpu.memory[0x3100] = 0x22;
  cpu.memory[0x3200] = 0x33;
  cpu.memory[0x4000] = 0x78;
  cpu.memory[0x4001] = 0x56;
  cpu.ports[0x34] = 0x9a;
  return cpu;
}

function expectedMnemonic(opcode: number): string {
  if (UNDOCUMENTED.has(opcode)) {
    return `NOP* ${opcode.toString(16).toUpperCase().padStart(2, "0")}H`;
  }
  if (opcode >= 0x40 && opcode <= 0x7f) {
    if (opcode === 0x76) return "HLT";
    return `MOV ${REGISTER_NAMES[(opcode >>> 3) & 7]}, ${REGISTER_NAMES[opcode & 7]}`;
  }
  if (opcode >= 0x80 && opcode <= 0xbf) {
    return `${ALU_NAMES[(opcode >>> 3) & 7]} ${REGISTER_NAMES[opcode & 7]}`;
  }
  if ((opcode & 0xcf) === 0x01) return `LXI ${PAIR_NAMES[(opcode >>> 4) & 3]}, 1234H`;
  if ((opcode & 0xef) === 0x02) return `STAX ${PAIR_NAMES[(opcode >>> 4) & 1]}`;
  if ((opcode & 0xcf) === 0x03) return `INX ${PAIR_NAMES[(opcode >>> 4) & 3]}`;
  if ((opcode & 0xc7) === 0x04) return `INR ${REGISTER_NAMES[(opcode >>> 3) & 7]}`;
  if ((opcode & 0xc7) === 0x05) return `DCR ${REGISTER_NAMES[(opcode >>> 3) & 7]}`;
  if ((opcode & 0xc7) === 0x06) return `MVI ${REGISTER_NAMES[(opcode >>> 3) & 7]}, 34H`;
  if ((opcode & 0xcf) === 0x09) return `DAD ${PAIR_NAMES[(opcode >>> 4) & 3]}`;
  if ((opcode & 0xef) === 0x0a) return `LDAX ${PAIR_NAMES[(opcode >>> 4) & 1]}`;
  if ((opcode & 0xcf) === 0x0b) return `DCX ${PAIR_NAMES[(opcode >>> 4) & 3]}`;
  if ((opcode & 0xc7) === 0xc0) return `R${CONDITION_NAMES[(opcode >>> 3) & 7]}`;
  if ((opcode & 0xcf) === 0xc1) return `POP ${STACK_PAIR_NAMES[(opcode >>> 4) & 3]}`;
  if ((opcode & 0xc7) === 0xc2) return `J${CONDITION_NAMES[(opcode >>> 3) & 7]} 1234H`;
  if ((opcode & 0xc7) === 0xc4) return `C${CONDITION_NAMES[(opcode >>> 3) & 7]} 1234H`;
  if ((opcode & 0xcf) === 0xc5) return `PUSH ${STACK_PAIR_NAMES[(opcode >>> 4) & 3]}`;
  if ((opcode & 0xc7) === 0xc6) return `${IMMEDIATE_ALU_NAMES[(opcode >>> 3) & 7]} 34H`;
  if ((opcode & 0xc7) === 0xc7) return `RST ${(opcode >>> 3) & 7}`;

  const fixed = new Map<number, string>([
    [0x00, "NOP"],
    [0x07, "RLC"],
    [0x0f, "RRC"],
    [0x17, "RAL"],
    [0x1f, "RAR"],
    [0x20, "RIM"],
    [0x22, "SHLD 1234H"],
    [0x27, "DAA"],
    [0x2a, "LHLD 1234H"],
    [0x2f, "CMA"],
    [0x30, "SIM"],
    [0x32, "STA 1234H"],
    [0x37, "STC"],
    [0x3a, "LDA 1234H"],
    [0x3f, "CMC"],
    [0xc3, "JMP 1234H"],
    [0xc9, "RET"],
    [0xcd, "CALL 1234H"],
    [0xd3, "OUT 34H"],
    [0xdb, "IN 34H"],
    [0xe3, "XTHL"],
    [0xe9, "PCHL"],
    [0xeb, "XCHG"],
    [0xf3, "DI"],
    [0xf9, "SPHL"],
    [0xfb, "EI"],
  ]);
  const mnemonic = fixed.get(opcode);
  assert.ok(mnemonic, `Test decoder did not classify opcode ${opcode.toString(16)}`);
  return mnemonic;
}

function expectedPurposeFamily(opcode: number): RegExp {
  if (UNDOCUMENTED.has(opcode)) return /undocumented opcode hole/i;
  if (opcode >= 0x40 && opcode <= 0x7f) return opcode === 0x76 ? /Halt instruction/i : /^Copy /;
  if (opcode >= 0x80 && opcode <= 0xbf) {
    return [
      /^Add the operand/,
      /incoming Carry/,
      /^Subtract the operand/,
      /incoming borrow/,
      /Logically AND/,
      /Logically XOR/,
      /Logically OR/,
      /^Compare the operand/,
    ][(opcode >>> 3) & 7];
  }
  if ((opcode & 0xcf) === 0x01) return /Load the 16-bit immediate/;
  if ((opcode & 0xef) === 0x02) return /Store the Accumulator.*addressed by/;
  if ((opcode & 0xcf) === 0x03) return /^Increment /;
  if ((opcode & 0xc7) === 0x04) return /^Increment /;
  if ((opcode & 0xc7) === 0x05) return /^Decrement /;
  if ((opcode & 0xc7) === 0x06) return /Load an immediate byte/;
  if ((opcode & 0xcf) === 0x09) return /Add .* to HL/;
  if ((opcode & 0xef) === 0x0a) return /Load the Accumulator.*addressed by/;
  if ((opcode & 0xcf) === 0x0b) return /^Decrement /;
  if ((opcode & 0xc7) === 0xc0) return /Return from the subroutine when condition/;
  if ((opcode & 0xcf) === 0xc1) return /Restore .* from the stack|Restore the Accumulator and Flag Register/;
  if ((opcode & 0xc7) === 0xc2) return /Jump to .* when condition/;
  if ((opcode & 0xc7) === 0xc4) return /Call .* when condition/;
  if ((opcode & 0xcf) === 0xc5) return /Push .* onto the stack/;
  if ((opcode & 0xc7) === 0xc6) {
    return [
      /^Add the operand/,
      /incoming Carry/,
      /^Subtract the operand/,
      /incoming borrow/,
      /Logically AND/,
      /Logically XOR/,
      /Logically OR/,
      /^Compare the operand/,
    ][(opcode >>> 3) & 7];
  }
  if ((opcode & 0xc7) === 0xc7) return /Call restart vector/;

  return new Map<number, RegExp>([
    [0x00, /no processor data operation/i],
    [0x07, /Rotate the Accumulator/],
    [0x0f, /Rotate the Accumulator/],
    [0x17, /Rotate the Accumulator/],
    [0x1f, /Rotate the Accumulator/],
    [0x20, /serial input and interrupt status/],
    [0x22, /Store L and H/],
    [0x27, /decimal adjustment/],
    [0x2a, /Load L and H/],
    [0x2f, /Complement every bit/],
    [0x30, /interrupt-mask.*serial-output/],
    [0x32, /Store the Accumulator at/],
    [0x37, /Set the Carry flag/],
    [0x3a, /Load the Accumulator from/],
    [0x3f, /Complement the Carry flag/],
    [0xc3, /Jump unconditionally/],
    [0xc9, /Return unconditionally/],
    [0xcd, /Call subroutine/],
    [0xd3, /output port/],
    [0xdb, /input port/],
    [0xe3, /Exchange HL/],
    [0xe9, /Program Counter from HL/],
    [0xeb, /Exchange the DE and HL/],
    [0xf3, /Disable maskable interrupts/],
    [0xf9, /Stack Pointer/],
    [0xfb, /Schedule maskable interrupts/],
  ]).get(opcode) ?? /THIS OPCODE MUST HAVE AN EXPECTED FAMILY/;
}

function setCondition(cpu: CPU8085, condition: number, expected: boolean): void {
  switch (condition) {
    case 0:
      cpu.flags.z = !expected;
      break;
    case 1:
      cpu.flags.z = expected;
      break;
    case 2:
      cpu.flags.cy = !expected;
      break;
    case 3:
      cpu.flags.cy = expected;
      break;
    case 4:
      cpu.flags.p = !expected;
      break;
    case 5:
      cpu.flags.p = expected;
      break;
    case 6:
      cpu.flags.s = !expected;
      break;
    default:
      cpu.flags.s = expected;
      break;
  }
}

test("all 32 functional-flag combinations produce the canonical 8085 F byte", () => {
  for (let combination = 0; combination < 32; combination += 1) {
    const flags = {
      s: (combination & 0x10) !== 0,
      z: (combination & 0x08) !== 0,
      ac: (combination & 0x04) !== 0,
      p: (combination & 0x02) !== 0,
      cy: (combination & 0x01) !== 0,
    };
    const packed = packFlagRegister(flags);

    assert.equal((packed & 0x20) >>> 5, 0, `D5 was not zero for ${combination}`);
    assert.equal((packed & 0x08) >>> 3, 0, `D3 was not zero for ${combination}`);
    assert.equal((packed & 0x02) >>> 1, 1, `D1 was not one for ${combination}`);
    assert.equal((packed & 0x80) !== 0, flags.s);
    assert.equal((packed & 0x40) !== 0, flags.z);
    assert.equal((packed & 0x10) !== 0, flags.ac);
    assert.equal((packed & 0x04) !== 0, flags.p);
    assert.equal((packed & 0x01) !== 0, flags.cy);
  }

  assert.equal(
    packFlagRegister({ s: false, z: false, ac: false, p: false, cy: false }),
    0x02,
  );
  assert.equal(
    packFlagRegister({ s: true, z: true, ac: true, p: true, cy: true }),
    0xd7,
  );
});

test("all 256 opcodes produce exactly four nonempty Insight fields", () => {
  let documented = 0;
  let undocumented = 0;

  for (let opcode = 0; opcode <= 0xff; opcode += 1) {
    const { insight } = execute(cpuFor(opcode));
    assert.deepEqual(
      Object.keys(insight).sort(),
      ["action", "effect", "instruction", "purpose"],
      `Unexpected shape for opcode ${opcode.toString(16)}`,
    );
    for (const [field, value] of Object.entries(insight)) {
      assert.equal(
        value.trim().length > 0,
        true,
        `${field} was empty for opcode ${opcode.toString(16)}`,
      );
    }
    assert.notEqual(
      insight.purpose,
      "Execute the decoded instruction",
      `Opcode ${opcode.toString(16)} fell through the family dispatch`,
    );
    assert.equal(
      insight.instruction,
      expectedMnemonic(opcode),
      `Wrong decoded mnemonic for opcode ${opcode.toString(16)}`,
    );
    assert.match(
      insight.purpose,
      expectedPurposeFamily(opcode),
      `Wrong Insight family for opcode ${opcode.toString(16)}`,
    );

    if (UNDOCUMENTED.has(opcode)) {
      undocumented += 1;
      assert.equal(insight.instruction, `NOP* ${opcode.toString(16).toUpperCase().padStart(2, "0")}H`);
      assert.match(insight.purpose, /undocumented opcode hole/i);
    } else {
      documented += 1;
      assert.doesNotMatch(insight.instruction, /^NOP\*/);
    }
  }

  assert.equal(documented, 246);
  assert.equal(undocumented, 10);
});

test("dispatch is opcode-driven rather than mnemonic-string driven", () => {
  const cpu = cpuFor(0xb8);
  cpu.a = 0x32;
  cpu.b = 0x35;
  const before = cpu.getState();
  const step = cpu.step();
  step.mnemonic = "NOT A REAL MNEMONIC";
  const after = cpu.getState();
  const insight = createInstructionInsight({
    before,
    after,
    step,
    memory: cpu.memory,
    ports: cpu.ports,
  });

  assert.match(insight.purpose, /compare/i);
  assert.match(insight.action, /32H - 35H/);
});

test("CMP explains wrapped subtraction, unsigned borrow, flags, and preserved A", () => {
  const cpu = cpuFor(0xb8);
  cpu.a = 0x32;
  cpu.b = 0x35;

  const { insight, after } = execute(cpu);

  assert.equal(after.a, 0x32);
  assert.equal(after.flags.cy, true);
  assert.equal(after.flags.s, true);
  assert.equal(after.flags.z, false);
  assert.match(insight.action, /-03H \(8-bit FDH\)/);
  assert.match(insight.effect, /A remains 32H/);
  assert.match(insight.effect, /CY=1 \(unsigned borrow required\)/);
  assert.match(insight.effect, /S=1/);
  assert.match(insight.effect, /Z=0/);
});

test("ADC and SBB include the incoming Carry as carry or borrow", () => {
  const adc = cpuFor(0x88);
  adc.a = 0xfe;
  adc.b = 0x05;
  adc.flags.cy = true;
  const adcResult = execute(adc);
  assert.equal(adcResult.after.a, 0x04);
  assert.match(adcResult.insight.action, /FEH \+ 05H \+ CY\(1\) = 104H/);
  assert.match(adcResult.insight.effect, /CY=1 \(carry beyond D7\)/);

  const sbb = cpuFor(0x98);
  sbb.a = 0x00;
  sbb.b = 0x00;
  sbb.flags.cy = true;
  const sbbResult = execute(sbb);
  assert.equal(sbbResult.after.a, 0xff);
  assert.match(sbbResult.insight.action, /00H - 00H - CY\(1\)/);
  assert.match(sbbResult.insight.effect, /unsigned borrow required/);
});

test("INR and DCR report that Carry is preserved", () => {
  const increment = cpuFor(0x04);
  increment.b = 0xff;
  increment.flags.cy = true;
  const incrementResult = execute(increment);
  assert.equal(incrementResult.after.b, 0x00);
  assert.equal(incrementResult.after.flags.cy, true);
  assert.match(incrementResult.insight.effect, /CY remains 1/);

  const decrement = cpuFor(0x35);
  decrement.h = 0x32;
  decrement.l = 0x00;
  decrement.memory[0x3200] = 0x00;
  decrement.flags.cy = false;
  const decrementResult = execute(decrement);
  assert.equal(decrement.memory[0x3200], 0xff);
  assert.match(decrementResult.insight.effect, /written 00H→FFH/);
  assert.match(decrementResult.insight.effect, /CY remains 0/);
});

test("M operands use the pre-instruction HL address even when H changes", () => {
  const cpu = cpuFor(0x66);
  cpu.h = 0x32;
  cpu.l = 0x00;
  cpu.memory[0x3200] = 0xab;

  const { insight, after } = execute(cpu);

  assert.equal(after.h, 0xab);
  assert.equal(after.hl, 0xab00);
  assert.match(insight.action, /M\[3200H\]=ABH → H/);
  assert.doesNotMatch(insight.action, /AB00H/);
});

test("consecutive direct-memory addresses wrap at FFFFH", () => {
  const cpu = cpuFor(0x22, [0xff, 0xff]);
  cpu.h = 0x12;
  cpu.l = 0x34;

  const { insight } = execute(cpu);

  assert.equal(cpu.memory[0xffff], 0x34);
  assert.equal(cpu.memory[0x0000], 0x12);
  assert.match(insight.action, /L=34H → \[FFFFH\]/);
  assert.match(insight.action, /H=12H → \[0000H\]/);
});

test("DAD reports 16-bit carry and preserves the other flags", () => {
  const cpu = cpuFor(0x19);
  cpu.h = 0xff;
  cpu.l = 0xff;
  cpu.d = 0x00;
  cpu.e = 0x01;
  cpu.flags.s = true;
  cpu.flags.z = true;
  cpu.flags.ac = true;
  cpu.flags.p = false;

  const { insight, after } = execute(cpu);

  assert.equal(after.hl, 0x0000);
  assert.equal(after.flags.cy, true);
  assert.match(insight.action, /FFFFH \+ 0001H = 10000H/);
  assert.match(insight.effect, /S, Z, AC, and P unchanged/);
});

test("logical operations state their architecturally forced AC and CY values", () => {
  const ana = cpuFor(0xa0);
  ana.a = 0xf0;
  ana.b = 0x0f;
  const anaInsight = execute(ana).insight;
  assert.match(anaInsight.effect, /AC=1 and CY=0 for logical AND/);

  const xra = cpuFor(0xa8);
  xra.a = 0xff;
  xra.b = 0x0f;
  const xraInsight = execute(xra).insight;
  assert.match(xraInsight.effect, /AC=0 and CY=0 for logical XOR/);

  const ora = cpuFor(0xb0);
  ora.a = 0xf0;
  ora.b = 0x0f;
  const oraInsight = execute(ora).insight;
  assert.match(oraInsight.effect, /AC=0 and CY=0 for logical OR/);
});

test("immediate logical Insight does not misname ANI, XRI, or ORI as register forms", () => {
  const cases = [
    { opcode: 0xe6, instruction: "ANI 34H", operation: /logical AND/i },
    { opcode: 0xee, instruction: "XRI 34H", operation: /logical XOR/i },
    { opcode: 0xf6, instruction: "ORI 34H", operation: /logical OR/i },
  ];

  for (const item of cases) {
    const { insight } = execute(cpuFor(item.opcode));
    const explanation = `${insight.purpose} ${insight.action} ${insight.effect}`;
    assert.equal(insight.instruction, item.instruction);
    assert.match(explanation, item.operation);
    assert.doesNotMatch(explanation, /\b(?:ANA|XRA|ORA)\b/);
  }
});

test("rotates explain outgoing and incoming Carry without claiming other flag changes", () => {
  const cpu = cpuFor(0x17);
  cpu.a = 0x80;
  cpu.flags.cy = true;

  const { insight, after } = execute(cpu);

  assert.equal(after.a, 0x01);
  assert.equal(after.flags.cy, true);
  assert.match(insight.action, /outgoing D7=1, incoming CY=1/);
  assert.match(insight.effect, /S, Z, AC, and P unchanged/);
});

test("DAA reports and produces every low/high correction path", () => {
  const paths = [
    {
      accumulator: 0x12,
      ac: false,
      cy: false,
      correction: "00H",
      result: 0x12,
      flags: { s: false, z: false, ac: false, p: true, cy: false },
    },
    {
      accumulator: 0x0a,
      ac: false,
      cy: false,
      correction: "06H",
      result: 0x10,
      flags: { s: false, z: false, ac: true, p: false, cy: false },
    },
    {
      accumulator: 0xa0,
      ac: false,
      cy: false,
      correction: "60H",
      result: 0x00,
      flags: { s: false, z: true, ac: false, p: true, cy: true },
    },
    {
      accumulator: 0x9a,
      ac: false,
      cy: false,
      correction: "66H",
      result: 0x00,
      flags: { s: false, z: true, ac: true, p: true, cy: true },
    },
    {
      accumulator: 0x12,
      ac: true,
      cy: false,
      correction: "06H",
      result: 0x18,
      flags: { s: false, z: false, ac: false, p: true, cy: false },
    },
    {
      accumulator: 0x12,
      ac: false,
      cy: true,
      correction: "60H",
      result: 0x72,
      flags: { s: false, z: false, ac: false, p: true, cy: true },
    },
  ];

  for (const path of paths) {
    const cpu = cpuFor(0x27);
    cpu.a = path.accumulator;
    cpu.flags.ac = path.ac;
    cpu.flags.cy = path.cy;
    const { insight, after } = execute(cpu);
    assert.equal(after.a, path.result);
    assert.deepEqual(after.flags, path.flags);
    assert.match(insight.purpose, /after a packed-BCD addition/);
    assert.match(insight.action, new RegExp(`correction ${path.correction}`));
    assert.match(
      insight.effect,
      new RegExp(`A .*${path.result.toString(16).toUpperCase().padStart(2, "0")}H`),
    );
    assert.match(insight.effect, new RegExp(`CY=${Number(path.flags.cy)}`));
    assert.match(insight.effect, new RegExp(`AC=${Number(path.flags.ac)}`));
    assert.match(insight.effect, new RegExp(`S=${Number(path.flags.s)}`));
    assert.match(insight.effect, new RegExp(`Z=${Number(path.flags.z)}`));
    assert.match(insight.effect, new RegExp(`P=${Number(path.flags.p)}`));
    assert.doesNotMatch(insight.effect, /valid BCD/i);
  }
});

test("a conditional jump reports taken from flags even when target equals fall-through", () => {
  const cpu = cpuFor(0xc2, [0x03, 0x20]);
  cpu.flags.z = false;

  const { insight, after } = execute(cpu);

  assert.equal(after.pc, 0x2003);
  assert.match(insight.action, /NZ tests Z=0: true/);
  assert.match(insight.effect, /Jump taken/);
});

test("all eight conditions drive jump, call, and return in both directions", () => {
  for (let condition = 0; condition < 8; condition += 1) {
    for (const taken of [false, true]) {
      const jump = cpuFor(0xc2 | (condition << 3), [0x00, 0x30]);
      setCondition(jump, condition, taken);
      const jumpResult = execute(jump);
      assert.equal(jumpResult.after.pc, taken ? 0x3000 : 0x2003);
      assert.match(
        jumpResult.insight.effect,
        new RegExp(`Jump ${taken ? "taken" : "not taken"}`),
      );
      assert.match(
        jumpResult.insight.action,
        new RegExp(`: ${taken ? "true" : "false"}$`),
      );

      const call = cpuFor(0xc4 | (condition << 3), [0x00, 0x30]);
      setCondition(call, condition, taken);
      const callResult = execute(call);
      assert.equal(callResult.after.pc, taken ? 0x3000 : 0x2003);
      assert.equal(callResult.after.sp, taken ? 0x3ffe : 0x4000);
      assert.match(
        callResult.insight.effect,
        new RegExp(`Call ${taken ? "taken" : "not taken"}`),
      );
      assert.match(
        callResult.insight.action,
        new RegExp(`: ${taken ? "true" : "false"}`),
      );
      if (taken) {
        assert.equal(call.memory[0x3ffe], 0x03);
        assert.equal(call.memory[0x3fff], 0x20);
      } else {
        assert.doesNotMatch(callResult.insight.action, /return address/i);
      }

      const conditionalReturn = cpuFor(0xc0 | (condition << 3));
      setCondition(conditionalReturn, condition, taken);
      const returnResult = execute(conditionalReturn);
      assert.equal(returnResult.after.pc, taken ? 0x5678 : 0x2001);
      assert.equal(returnResult.after.sp, taken ? 0x4002 : 0x4000);
      assert.match(
        returnResult.insight.effect,
        new RegExp(`Return ${taken ? "taken" : "not taken"}`),
      );
      assert.match(
        returnResult.insight.action,
        new RegExp(`: ${taken ? "true" : "false"}`),
      );
    }
  }
});

test("all RST opcodes report the exact vector and pushed return address", () => {
  for (let rst = 0; rst < 8; rst += 1) {
    const cpu = cpuFor(0xc7 | (rst << 3));
    const { insight, after } = execute(cpu);
    assert.equal(after.pc, rst << 3);
    assert.match(insight.action, new RegExp(`vector ${hex16ForTest(rst << 3)}`));
    assert.match(insight.action, /Return address 2001H/);
  }
});

test("all PUSH and POP pairs preserve byte order across SP wrapping", () => {
  const pushValues = [0x1234, 0x5678, 0x9abc, 0xde93];

  for (let pair = 0; pair < 4; pair += 1) {
    const push = cpuFor(0xc5 | (pair << 4));
    push.b = 0x12;
    push.c = 0x34;
    push.d = 0x56;
    push.e = 0x78;
    push.h = 0x9a;
    push.l = 0xbc;
    push.a = 0xde;
    push.flags.s = true;
    push.flags.z = false;
    push.flags.ac = true;
    push.flags.p = false;
    push.flags.cy = true;
    push.sp = 0x0000;

    const pushResult = execute(push);
    const value = pushValues[pair];
    assert.equal(pushResult.insight.instruction, `PUSH ${STACK_PAIR_NAMES[pair]}`);
    assert.equal(pushResult.after.sp, 0xfffe);
    assert.equal(push.memory[0xffff], value >>> 8);
    assert.equal(push.memory[0xfffe], value & 0xff);
    assert.deepEqual(pushResult.after.flags, pushResult.before.flags);
    assert.match(pushResult.insight.effect, /SP 0000H→FFFEH/);
    assert.match(pushResult.insight.effect, /\[FFFFH\] written 00H→[0-9A-F]{2}H/);
    assert.match(pushResult.insight.effect, /\[FFFEH\] written 00H→[0-9A-F]{2}H/);

    const pop = cpuFor(0xc1 | (pair << 4));
    pop.sp = 0xffff;
    pop.memory[0xffff] = 0xef;
    pop.memory[0x0000] = 0xa0 + pair;
    const popResult = execute(pop);
    const popped = ((0xa0 + pair) << 8) | 0xef;

    assert.equal(popResult.insight.instruction, `POP ${STACK_PAIR_NAMES[pair]}`);
    assert.equal(popResult.after.sp, 0x0001);
    assert.match(popResult.insight.action, /\[FFFFH\]=EFH, \[0000H\]=A[0-3]H/);
    assert.match(popResult.insight.effect, /SP FFFFH→0001H/);
    if (pair === 0) {
      assert.equal(popResult.after.bc, popped);
      assert.deepEqual(popResult.after.flags, popResult.before.flags);
    } else if (pair === 1) {
      assert.equal(popResult.after.de, popped);
      assert.deepEqual(popResult.after.flags, popResult.before.flags);
    } else if (pair === 2) {
      assert.equal(popResult.after.hl, popped);
      assert.deepEqual(popResult.after.flags, popResult.before.flags);
    } else {
      assert.equal(popResult.after.a, 0xa3);
      assert.equal(packFlagRegister(popResult.after.flags), 0xc7);
      assert.match(popResult.insight.effect, /D5\/D3=0, D1=1 normalized/);
    }
  }
});

test("XTHL reports wrapped stack addresses and exact exchanges", () => {
  const cpu = cpuFor(0xe3);
  cpu.sp = 0xffff;
  cpu.h = 0xaa;
  cpu.l = 0xbb;
  cpu.memory[0xffff] = 0x34;
  cpu.memory[0x0000] = 0x12;

  const { insight, after } = execute(cpu);

  assert.equal(after.hl, 0x1234);
  assert.equal(cpu.memory[0xffff], 0xbb);
  assert.equal(cpu.memory[0x0000], 0xaa);
  assert.match(insight.action, /\[FFFFH\]=34H/);
  assert.match(insight.action, /\[0000H\]=12H/);
  assert.match(insight.effect, /SP and flags unchanged/);
});

test("same-value memory and port writes are described as writes, not changes", () => {
  const store = cpuFor(0x32, [0x00, 0x30]);
  store.a = 0x42;
  store.memory[0x3000] = 0x42;
  const storeInsight = execute(store).insight;
  assert.match(storeInsight.effect, /\[3000H\] written 42H→42H/);
  assert.doesNotMatch(storeInsight.effect, /\bchanged\b/i);

  const output = cpuFor(0xd3, [0x01]);
  output.a = 0x55;
  output.ports[0x01] = 0x55;
  const outputInsight = execute(output).insight;
  assert.match(outputInsight.effect, /port 01H written 55H→55H/);
});

test("IN and OUT use the actual 8-bit port and preserve flags", () => {
  const input = cpuFor(0xdb, [0x02]);
  input.ports[0x02] = 0xa5;
  const inputResult = execute(input);
  assert.equal(inputResult.after.a, 0xa5);
  assert.match(inputResult.insight.action, /Port 02H=A5H → A/);
  assert.match(inputResult.insight.effect, /flags unchanged/);

  const output = cpuFor(0xd3, [0x01]);
  output.a = 0x5a;
  const outputResult = execute(output);
  assert.equal(output.ports[0x01], 0x5a);
  assert.match(outputResult.insight.action, /A=5AH → port 01H/);
});

test("RIM encodes every serial, pending, IE, and mask combination", () => {
  for (let status = 0; status <= 0xff; status += 1) {
    const cpu = cpuFor(0x20);
    cpu.serialInput = (status & 0x80) !== 0;
    cpu.pendingInterrupts.rst75 = (status & 0x40) !== 0;
    cpu.pendingInterrupts.rst65 = (status & 0x20) !== 0;
    cpu.pendingInterrupts.rst55 = (status & 0x10) !== 0;
    cpu.interruptEnabled = (status & 0x08) !== 0;
    cpu.interruptMasks.rst75 = (status & 0x04) !== 0;
    cpu.interruptMasks.rst65 = (status & 0x02) !== 0;
    cpu.interruptMasks.rst55 = (status & 0x01) !== 0;

    const { insight, before, after } = execute(cpu);
    const pending = `${Number((status & 0x40) !== 0)}${Number((status & 0x20) !== 0)}${Number((status & 0x10) !== 0)}`;
    const masks = `${Number((status & 0x04) !== 0)}${Number((status & 0x02) !== 0)}${Number((status & 0x01) !== 0)}`;

    assert.equal(after.a, status);
    assert.deepEqual(after.flags, before.flags);
    assert.match(insight.action, new RegExp(`SID=${Number((status & 0x80) !== 0)}`));
    assert.match(insight.action, new RegExp(`pending 7\\.5/6\\.5/5\\.5=${pending}`));
    assert.match(insight.action, new RegExp(`IE sampled=${Number((status & 0x08) !== 0)}`));
    assert.match(insight.action, new RegExp(`masks 7\\.5/6\\.5/5\\.5=${masks}`));
  }
});

test("RIM reports sampled bits and the deferred EI transition accurately", () => {
  const cpu = cpuFor(0xfb);
  cpu.memory[0x2001] = 0x20;
  cpu.serialInput = true;
  cpu.pendingInterrupts.rst75 = true;
  cpu.pendingInterrupts.rst55 = true;
  cpu.interruptMasks.rst65 = true;

  execute(cpu);
  const { insight, before, after } = execute(cpu);

  assert.equal(before.interruptEnablePending, true);
  assert.equal(before.interruptEnabled, false);
  assert.equal(after.interruptEnabled, true);
  assert.equal(after.a, 0xd2);
  assert.match(insight.action, /SID=1/);
  assert.match(insight.action, /pending 7\.5\/6\.5\/5\.5=101/);
  assert.match(insight.action, /IE sampled=0/);
  assert.match(insight.action, /masks 7\.5\/6\.5\/5\.5=010/);
  assert.match(insight.effect, /deferred EI became active after this instruction/);
});

test("SIM exhaustively gates mask, reset, and serial controls from A", () => {
  const baselines = [
    { masks: 0b101, pending75: true, serialOutput: false },
    { masks: 0b010, pending75: false, serialOutput: true },
  ];

  for (const baseline of baselines) {
    for (let control = 0; control <= 0xff; control += 1) {
      const cpu = cpuFor(0x30);
      cpu.a = control;
      cpu.interruptMasks.rst75 = (baseline.masks & 0b100) !== 0;
      cpu.interruptMasks.rst65 = (baseline.masks & 0b010) !== 0;
      cpu.interruptMasks.rst55 = (baseline.masks & 0b001) !== 0;
      cpu.pendingInterrupts.rst75 = baseline.pending75;
      cpu.serialOutput = baseline.serialOutput;

      const { insight, before, after } = execute(cpu);
      const mse = (control & 0x08) !== 0;
      const reset75 = (control & 0x10) !== 0;
      const soe = (control & 0x40) !== 0;
      const requestedMasks = control & 0x07;
      const expectedMasks = mse ? requestedMasks : baseline.masks;
      const expectedPending75 = reset75 ? false : baseline.pending75;
      const expectedSerialOutput = soe
        ? (control & 0x80) !== 0
        : baseline.serialOutput;
      const maskText = expectedMasks.toString(2).padStart(3, "0");

      assert.equal(after.a, control);
      assert.deepEqual(after.flags, before.flags);
      assert.deepEqual(after.interruptMasks, {
        rst55: (expectedMasks & 0b001) !== 0,
        rst65: (expectedMasks & 0b010) !== 0,
        rst75: (expectedMasks & 0b100) !== 0,
      });
      assert.equal(after.pendingInterrupts.rst75, expectedPending75);
      assert.equal(after.serialOutput, expectedSerialOutput);
      assert.match(insight.action, new RegExp(`MSE=${Number(mse)}`));
      assert.match(insight.action, new RegExp(`reset7\\.5=${Number(reset75)}`));
      assert.match(
        insight.action,
        new RegExp(`SOE=${Number(soe)}, SOD=${Number((control & 0x80) !== 0)}`),
      );
      assert.match(
        insight.effect,
        new RegExp(`Masks ${mse ? "set to" : "remain"} ${maskText}`),
      );
      assert.match(
        insight.effect,
        new RegExp(
          `RST7\\.5 pending ${reset75 ? "reset to 0" : `remains ${Number(expectedPending75)}`}`,
        ),
      );
      assert.match(
        insight.effect,
        new RegExp(
          `serial output ${soe ? "set to" : "remains"} ${Number(expectedSerialOutput)}`,
        ),
      );
    }
  }
});

test("EI is delayed and DI immediately cancels a pending enable", () => {
  const cpu = cpuFor(0xfb);
  cpu.memory[0x2001] = 0xf3;

  const ei = execute(cpu);
  assert.equal(ei.after.interruptEnabled, false);
  assert.equal(ei.after.interruptEnablePending, true);
  assert.match(ei.insight.effect, /IE=0 now; deferred enable pending=1/);

  const di = execute(cpu);
  assert.equal(di.before.interruptEnablePending, true);
  assert.equal(di.after.interruptEnabled, false);
  assert.equal(di.after.interruptEnablePending, false);
  assert.match(di.insight.action, /deferred EI request cancelled/);
});

test("HLT describes only the current engine halt", () => {
  const { insight, after } = execute(cpuFor(0x76));
  assert.equal(after.halted, true);
  assert.match(insight.effect, /CPU halted/);
  assert.doesNotMatch(`${insight.purpose} ${insight.action} ${insight.effect}`, /wake|interrupt.*resume/i);
});

function hex16ForTest(value: number): string {
  return `${(value & 0xffff).toString(16).toUpperCase().padStart(4, "0")}H`;
}
