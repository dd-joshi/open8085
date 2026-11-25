// 8155 behaviour, named after the datasheet rules they check.
import assert from "node:assert/strict";
import test from "node:test";

import { describe8155Command, Pio8155 } from "../lib/io/pio8155.ts";

const B = 0x20;
const CMD = B, PA = B + 1, PB = B + 2, PC = B + 3, TL = B + 4, TH = B + 5;

/** Program the timer: count N, mode M, then START with the given port bits. */
const startTimer = (chip: Pio8155, count: number, mode: number, portBits = 0) => {
  chip.write(TL, count & 0xff);
  chip.write(TH, (mode << 6) | ((count >> 8) & 0x3f));
  chip.write(CMD, 0xc0 | portBits);
};

/** TIMER OUT level after each of the next n clocks. */
const levels = (chip: Pio8155, n: number) =>
  Array.from({ length: n }, () => {
    chip.tick(1);
    return chip.snapshot().timer.out;
  }).join("");

test("ports are base+0..5 named CMD, PA, PB, PC, TL, TH; base aligns to 8", () => {
  const chip = new Pio8155(0x23);
  assert.equal(chip.base, 0x20);
  assert.deepEqual(chip.ports(), [0x20, 0x21, 0x22, 0x23, 0x24, 0x25]);
  assert.deepEqual(chip.ports().map((port) => chip.portName(port)), ["CMD", "PA", "PB", "PC", "TL", "TH"]);
});

test("after reset all ports are inputs and read their pins (Port C is 6 bits)", () => {
  const chip = new Pio8155();
  chip.setPins("a", 0x12);
  chip.setPins("b", 0x34);
  chip.setPins("c", 0xff);
  assert.deepEqual([chip.read(PA), chip.read(PB), chip.read(PC)], [0x12, 0x34, 0x3f]);
});

test("command register sets port directions; output ports read back their latch", () => {
  const chip = new Pio8155();
  chip.write(CMD, 0x0d); // A out, B in, C ALT2 (out)
  chip.write(PA, 0x55);
  chip.write(PC, 0xff);
  chip.setPins("b", 0xf0);
  assert.deepEqual([chip.read(PA), chip.read(PB), chip.read(PC)], [0x55, 0xf0, 0x3f]);
  assert.equal(describe8155Command(0x0d), "A out · B in · C out · timer unchanged");
  assert.equal(describe8155Command(0xc1), "A out · B in · C in · start timer");
});

test("status register: INTE bits mirror the command, TIMER bit set at TC and cleared by reading status", () => {
  const chip = new Pio8155();
  chip.write(CMD, 0x30);
  assert.equal(chip.read(CMD), 0x24);
  startTimer(chip, 4, 1);
  chip.tick(4);
  assert.equal(chip.read(CMD) & 0x40, 0x40);
  chip.afterRead(PA);
  assert.equal(chip.read(CMD) & 0x40, 0x40, "reading another port keeps the TIMER bit");
  chip.afterRead(CMD);
  assert.equal(chip.read(CMD) & 0x40, 0);
});

test("mode 1 square wave: high for ceil(N/2) clocks, low for floor(N/2), repeats", () => {
  const chip = new Pio8155();
  startTimer(chip, 4, 1);
  assert.equal(levels(chip, 12), "100110011001");
  const odd = new Pio8155();
  startTimer(odd, 5, 1);
  assert.equal(levels(odd, 10), "1100111001");
});

test("mode 0 single square wave runs once and stops with TIMER OUT high", () => {
  const chip = new Pio8155();
  startTimer(chip, 4, 0);
  assert.equal(levels(chip, 8), "10011111");
  assert.equal(chip.snapshot().timer.running, false);
});

test("mode 3 continuous pulse: one-clock low pulse at every terminal count", () => {
  const chip = new Pio8155();
  startTimer(chip, 4, 3);
  assert.equal(levels(chip, 9), "111011101");
});

test("mode 2 single pulse: one pulse, then the timer stops", () => {
  const chip = new Pio8155();
  startTimer(chip, 3, 2);
  assert.equal(levels(chip, 7), "1101111");
  assert.equal(chip.snapshot().timer.running, false);
});

test("STOP halts the count immediately; STOP after TC finishes the current period", () => {
  const chip = new Pio8155();
  startTimer(chip, 4, 1);
  chip.tick(1);
  chip.write(CMD, 0x40);
  const remaining = chip.snapshot().timer.remaining;
  chip.tick(10);
  assert.equal(chip.snapshot().timer.remaining, remaining);
  const late = new Pio8155();
  startTimer(late, 4, 1);
  late.tick(1);
  late.write(CMD, 0x80);
  late.tick(3);
  assert.equal(late.snapshot().timer.running, false);
  assert.equal(late.snapshot().timer.terminalCount, true);
});

test("START while running loads the new count and mode at the next terminal count", () => {
  const chip = new Pio8155();
  startTimer(chip, 4, 1);
  chip.tick(1);
  startTimer(chip, 6, 1);
  assert.equal(chip.snapshot().timer.count, 4);
  chip.tick(3);
  assert.equal(chip.snapshot().timer.count, 6);
  assert.equal(chip.snapshot().timer.remaining, 6);
});

test("timer registers read back the live count and mode", () => {
  const chip = new Pio8155();
  startTimer(chip, 0x03e8, 1);
  assert.equal(chip.read(TL), 0xe8);
  assert.equal(chip.read(TH), 0x43);
  chip.tick(8);
  assert.equal(chip.read(TL), 0xe0);
});

test("a count below 2 is raised to 2 and flagged", () => {
  const chip = new Pio8155();
  startTimer(chip, 1, 1);
  assert.equal(chip.snapshot().timer.count, 2);
  assert.match(chip.snapshot().warning ?? "", /below 2/);
});

test("ALT3/ALT4 Port C handshake is flagged as not simulated", () => {
  const chip = new Pio8155();
  chip.write(CMD, 0x04);
  assert.equal(chip.snapshot().portCMode, "ALT3");
  assert.match(chip.snapshot().warning ?? "", /ALT3 handshake .* not simulated/);
});

test("TIMER OUT edges are recorded with their timer clock for the waveform view", () => {
  const chip = new Pio8155();
  startTimer(chip, 4, 1);
  chip.tick(8);
  assert.deepEqual(chip.snapshot().timer.edges, [
    { clock: 2, level: 0 },
    { clock: 4, level: 1 },
    { clock: 6, level: 0 },
    { clock: 8, level: 1 },
  ]);
});

test("reset: ports to input, timer stopped, count register kept", () => {
  const chip = new Pio8155();
  startTimer(chip, 0x03e8, 1, 0x01);
  chip.write(PA, 0x55);
  chip.tick(10);
  chip.reset();
  const snap = chip.snapshot();
  assert.equal(snap.direction.a, "in");
  assert.equal(snap.timer.running, false);
  assert.equal(snap.timer.countRegister, 0x03e8);
  assert.equal(snap.timer.edges.length, 0);
  assert.equal(snap.programmed, false);
});
