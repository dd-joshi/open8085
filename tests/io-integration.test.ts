// The real 8085 engine driving the virtual 8255 and 8155 through stepWithIo().
import assert from "node:assert/strict";
import test from "node:test";

import { assemble8085 } from "../lib/assembler8085.ts";
import { CPU8085 } from "../lib/cpu8085.ts";
import { createIoChips, moveChip, stepWithIo } from "../lib/io/chips.ts";
import type { IoBus } from "../lib/io/bus.ts";

function runProgram(source: string, bus: IoBus | null, maxSteps = 10_000) {
  const assembled = assemble8085(source, 0x2000);
  assert.equal(assembled.success, true, assembled.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n"));
  const cpu = new CPU8085();
  cpu.reset(true, true);
  for (const segment of assembled.segments) cpu.load(segment.bytes, segment.origin, false);
  cpu.setRegister("PC", assembled.entryPoint);
  let steps = 0;
  while (!cpu.halted && steps < maxSteps) {
    stepWithIo(cpu, bus);
    steps += 1;
  }
  return cpu;
}

test("8255: program sets 89H, drives Port A and reads switches on Port C", () => {
  const chips = createIoChips();
  chips.ppi.setPins("c", 0x05);
  const cpu = runProgram(
    `ORG 2000H
MVI A,89H
OUT 83H
MVI A,0C1H
OUT 80H
IN 82H
HLT`,
    chips.bus,
  );
  const snap = chips.ppi.snapshot();
  assert.equal(snap.latch.a, 0xc1);
  assert.equal(snap.summary, "Mode 0 · Port A out · Port B out · Port C in");
  assert.equal(cpu.a, 0x05, "IN 82H returns the Port C switches");
  assert.equal(chips.bus.lastFor("8255")?.kind, "IN");
  assert.equal(chips.bus.fault, null);
});

test("8155: single-shot timer runs in T-states, IN 20H sees the TIMER bit and clears it", () => {
  const chips = createIoChips();
  const cpu = runProgram(
    `ORG 2000H
MVI A,0AH
OUT 24H
MVI A,00H
OUT 25H
MVI A,0C1H
OUT 20H
WAIT: IN 20H
ANI 40H
JZ WAIT
MOV B,A
IN 20H
HLT`,
    chips.bus,
  );
  assert.equal(cpu.b, 0x40, "the program saw terminal count");
  assert.equal(cpu.a & 0x40, 0, "the second status read sees the bit cleared");
  const timer = chips.pio.snapshot().timer;
  assert.equal(timer.running, false, "mode 0 stops after one terminal count");
  assert.equal(timer.count, 10);
  assert.ok(timer.edges.length >= 2, "TIMER OUT toggled");
});

test("chips off: stepWithIo(cpu, null) behaves exactly like cpu.step()", () => {
  const source = `ORG 2000H
MVI A,89H
OUT 83H
IN 82H
HLT`;
  const plain = runProgram(source, null);
  const reference = new CPU8085();
  const assembled = assemble8085(source, 0x2000);
  reference.reset(true, true);
  for (const segment of assembled.segments) reference.load(segment.bytes, segment.origin, false);
  reference.setRegister("PC", assembled.entryPoint);
  while (!reference.halted) reference.step();
  assert.deepEqual(plain.getState(), reference.getState());
  assert.deepEqual([...plain.ports], [...reference.ports]);
});

test("the Virtual I/O board ports 01H/02H keep working with chips on", () => {
  const chips = createIoChips();
  const assembled = assemble8085(`ORG 2000H
IN 02H
OUT 01H
HLT`, 0x2000);
  const cpu = new CPU8085();
  cpu.reset(true, true);
  for (const segment of assembled.segments) cpu.load(segment.bytes, segment.origin, false);
  cpu.setRegister("PC", assembled.entryPoint);
  cpu.setPort(0x02, 0x3c);
  while (!cpu.halted) stepWithIo(cpu, chips.bus);
  assert.equal(cpu.ports[0x01], 0x3c);
});

test("moveChip refuses clashes and keeps the old base", () => {
  const chips = createIoChips();
  assert.match(moveChip(chips, "ppi", 0x00) ?? "", /Virtual I\/O board/);
  assert.equal(chips.ppi.base, 0x80);
  assert.match(moveChip(chips, "ppi", 0x24) ?? "", /already used by 8155/);
  assert.equal(moveChip(chips, "ppi", 0x40), null);
  assert.equal(chips.bus.owner(0x43)?.id, "8255");
  assert.equal(chips.bus.owner(0x83), undefined);
});

test("built-in chip examples drive the 8255 and the 8155 as described", async () => {
  const { examples8085 } = await import("../lib/examples8085.ts");
  const ppiExample = examples8085.find((example) => example.id === "ppi-8255-running-light");
  const pioExample = examples8085.find((example) => example.id === "pio-8155-timer-counter");
  assert.ok(ppiExample && pioExample);

  const ppiChips = createIoChips();
  ppiChips.ppi.setPins("c", 0x5a);
  runProgram(ppiExample.source, ppiChips.bus, 5_000);
  const ppi = ppiChips.ppi.snapshot();
  assert.equal(ppi.summary, "Mode 0 · Port A out · Port B out · Port C in");
  assert.equal(ppi.latch.b, 0x5a, "Port B copies the Port C switches");
  assert.equal([1, 2, 4, 8, 16, 32, 64, 128].includes(ppi.latch.a), true, "one Port A LED lit");

  const pioChips = createIoChips();
  pioChips.pio.setPins("b", 0x3c);
  const cpu = runProgram(pioExample.source, pioChips.bus, 20_000);
  const pio = pioChips.pio.snapshot();
  assert.equal(pio.timer.running, true);
  assert.equal(pio.timer.count, 1000);
  assert.equal(pio.timer.mode, 1);
  assert.ok(pio.latch.a > 0, "Port A counts timer periods");
  assert.equal(cpu.memory[0x2800], 0x3c, "Port B switches stored in 8155 RAM");
});
