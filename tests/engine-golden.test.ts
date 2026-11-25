// Engine safety net for peripheral work (8255/8155 and later).
//
// 1. Golden runs: every built-in example plus port-heavy programs is run on the real engine and the
//    final machine state is compared with tests/fixtures/engine-golden.json. Any change in
//    behaviour (registers, flags, T-states, memory, ports, port writes) fails here.
// 2. Tripwire: lib/cpu8085.ts and lib/assembler8085.ts must stay byte-identical. Peripheral code
//    must hook around cpu.step(), never edit the engine.
//
// To re-record after an intentional engine change (in its own PR):
//   OPEN8085_UPDATE_GOLDEN=1 npx tsx --test tests/engine-golden.test.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";

import { assemble8085 } from "../lib/assembler8085.ts";
import { CPU8085 } from "../lib/cpu8085.ts";
import { examples8085 } from "../lib/examples8085.ts";

const FIXTURE = new URL("./fixtures/engine-golden.json", import.meta.url);
const UPDATE = process.env.OPEN8085_UPDATE_GOLDEN === "1";
const STEP_LIMIT = 50_000;

const ENGINE_FILES = ["lib/cpu8085.ts", "lib/assembler8085.ts"] as const;

// Programs that exercise IN/OUT on the addresses the virtual chips will use.
const PORT_PROGRAMS: ReadonlyArray<{ id: string; source: string; ports?: Record<number, number> }> = [
  {
    id: "port-out-sweep",
    source: `ORG 2000H
MVI A,89H
OUT 83H
MVI A,0C1H
OUT 80H
OUT 81H
OUT 20H
MVI A,55H
OUT 21H
OUT 24H
OUT 25H
OUT 01H
OUT 0FFH
HLT`,
  },
  {
    id: "port-in-sweep",
    source: `ORG 2000H
IN 02H
MOV B,A
IN 82H
MOV C,A
IN 20H
MOV D,A
IN 23H
MOV E,A
IN 0FFH
HLT`,
    ports: { 0x02: 0xa5, 0x82: 0x05, 0x20: 0x40, 0x23: 0x03, 0xff: 0x7e },
  },
];

const fnv1a = (bytes: ArrayLike<number>) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index] & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

// Same "ADDRH = VALH" setup lines the simulator applies when an example loads.
const applySetupMemory = (cpu: CPU8085, lines: readonly string[]) => {
  for (const line of lines) {
    const [left, ...rest] = line.split("=");
    const address = left?.trim().match(/^([0-9a-f]+)h$/i);
    const value = rest.join("=").match(/\b([0-9a-f]+)h\b/i);
    if (address && value) cpu.setMemory(Number.parseInt(address[1], 16), Number.parseInt(value[1], 16));
  }
};

function run(source: string, setup: readonly string[] = [], ports: Record<number, number> = {}) {
  const assembled = assemble8085(source, 0x2000);
  assert.equal(assembled.success, true, assembled.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n"));
  const cpu = new CPU8085();
  cpu.reset(true, true);
  for (const segment of assembled.segments) cpu.load(segment.bytes, segment.origin, false);
  cpu.setRegister("PC", assembled.entryPoint);
  applySetupMemory(cpu, setup);
  for (const [port, value] of Object.entries(ports)) cpu.setPort(Number(port), value);

  const portWrites: string[] = [];
  let steps = 0;
  while (!cpu.halted && steps < STEP_LIMIT) {
    const result = cpu.step();
    for (const write of result.portWrites) portWrites.push(`${write.port}:${write.previous}>${write.value}`);
    steps += 1;
  }
  const state = cpu.getState();
  return {
    steps,
    halted: state.halted,
    totalCycles: cpu.totalCycles,
    registers: { a: state.a, b: state.b, c: state.c, d: state.d, e: state.e, h: state.h, l: state.l, sp: state.sp, pc: state.pc },
    flags: state.flags,
    memory: fnv1a(cpu.memory),
    ports: fnv1a(cpu.ports),
    portWriteCount: portWrites.length,
    portWritesFirst: portWrites.slice(0, 16),
    portWrites: fnv1a(Buffer.from(portWrites.join(","))),
  };
}

function engineHashes() {
  return Object.fromEntries(
    ENGINE_FILES.map((file) => {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");
      return [file, createHash("sha256").update(text).digest("hex")];
    }),
  );
}

function currentGolden() {
  const runs: Record<string, ReturnType<typeof run>> = {};
  for (const example of examples8085) runs[`example:${example.id}`] = run(example.source, example.setup.memory);
  for (const program of PORT_PROGRAMS) runs[`program:${program.id}`] = run(program.source, [], program.ports);
  return { engine: engineHashes(), runs };
}

const actual = currentGolden();
if (UPDATE) writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as ReturnType<typeof currentGolden>;

test("engine tripwire: lib/cpu8085.ts and lib/assembler8085.ts are unchanged", () => {
  for (const file of ENGINE_FILES) {
    assert.equal(
      actual.engine[file],
      expected.engine[file],
      `${file} changed. Engine edits need their own PR and a re-recorded golden fixture.`,
    );
  }
});

test("golden runs cover every built-in example", () => {
  assert.deepEqual(Object.keys(actual.runs).sort(), Object.keys(expected.runs).sort());
});

for (const name of Object.keys(expected.runs)) {
  test(`golden run unchanged: ${name}`, () => {
    assert.deepEqual(actual.runs[name], expected.runs[name]);
  });
}
