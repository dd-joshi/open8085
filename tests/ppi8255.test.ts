// 8255A behaviour, named after the datasheet rules they check.
import assert from "node:assert/strict";
import test from "node:test";

import { describe8255Control, Ppi8255 } from "../lib/io/ppi8255.ts";

test("ports are base+0..3 named PA, PB, PC, CW; base aligns to 4", () => {
  const ppi = new Ppi8255(0x81);
  assert.equal(ppi.base, 0x80);
  assert.deepEqual(ppi.ports(), [0x80, 0x81, 0x82, 0x83]);
  assert.deepEqual(ppi.ports().map((port) => ppi.portName(port)), ["PA", "PB", "PC", "CW"]);
});

test("after reset every port is an input and reads its pins", () => {
  const ppi = new Ppi8255(0x80);
  ppi.setPins("a", 0x12);
  ppi.setPins("b", 0x34);
  ppi.setPins("c", 0x56);
  assert.deepEqual([ppi.read(0x80), ppi.read(0x81), ppi.read(0x82)], [0x12, 0x34, 0x56]);
  const snap = ppi.snapshot();
  assert.equal(snap.programmed, false);
  assert.deepEqual(snap.direction, { a: "in", b: "in", cUpper: "in", cLower: "in" });
});

test("mode 0 output ports latch OUT data and read back the latch", () => {
  const ppi = new Ppi8255(0x80);
  ppi.write(0x83, 0x80); // all outputs
  ppi.write(0x80, 0xc1);
  ppi.write(0x81, 0x18);
  ppi.write(0x82, 0xa5);
  ppi.setPins("a", 0xff);
  assert.deepEqual([ppi.read(0x80), ppi.read(0x81), ppi.read(0x82)], [0xc1, 0x18, 0xa5]);
});

test("control word 89H: A out, B out, C in", () => {
  const ppi = new Ppi8255(0x80);
  ppi.write(0x83, 0x89);
  ppi.setPins("c", 0x05);
  ppi.write(0x80, 0xc1);
  assert.equal(ppi.read(0x82), 0x05);
  assert.equal(ppi.read(0x80), 0xc1);
  assert.equal(ppi.snapshot().summary, "Mode 0 · Port A out · Port B out · Port C in");
});

test("Port C halves follow their own direction bits", () => {
  const ppi = new Ppi8255(0x80);
  ppi.write(0x83, 0x88); // C upper in, C lower out
  ppi.write(0x82, 0x0f);
  ppi.setPins("c", 0xa0);
  assert.equal(ppi.read(0x82), 0xaf);
  assert.equal(describe8255Control(0x88), "Mode 0 · Port A out · Port B out · PC upper in · PC lower out");
});

test("a mode-set control word clears all output latches", () => {
  const ppi = new Ppi8255(0x80);
  ppi.write(0x83, 0x80);
  ppi.write(0x80, 0xff);
  ppi.write(0x82, 0xff);
  ppi.write(0x83, 0x80);
  assert.equal(ppi.read(0x80), 0);
  assert.equal(ppi.read(0x82), 0);
});

test("bit set/reset changes one Port C bit and keeps the mode", () => {
  const ppi = new Ppi8255(0x80);
  ppi.write(0x83, 0x80);
  ppi.write(0x83, 0x07); // set PC3
  ppi.write(0x83, 0x0f); // set PC7
  assert.equal(ppi.read(0x82), 0x88);
  ppi.write(0x83, 0x06); // reset PC3
  assert.equal(ppi.read(0x82), 0x80);
  assert.equal(ppi.snapshot().control, 0x80);
  assert.equal(describe8255Control(0x07), "Bit set/reset: set PC3");
});

test("the control register cannot be read back", () => {
  const ppi = new Ppi8255(0x80);
  ppi.write(0x83, 0x80);
  assert.equal(ppi.read(0x83), 0xff);
});

test("modes 1 and 2 are flagged as not simulated", () => {
  const ppi = new Ppi8255(0x80);
  ppi.write(0x83, 0x80);
  assert.equal(ppi.snapshot().warning, null);
  ppi.write(0x83, 0xa0); // group A mode 1
  assert.match(ppi.snapshot().warning ?? "", /Mode 1 handshake .* not simulated/);
  ppi.write(0x83, 0xc0); // group A mode 2
  assert.equal(ppi.snapshot().groupAMode, 2);
});

test("reset returns to all-input and clears latches but keeps the pins", () => {
  const ppi = new Ppi8255(0x80);
  ppi.write(0x83, 0x80);
  ppi.write(0x80, 0x55);
  ppi.setPins("a", 0x0f);
  ppi.reset();
  assert.equal(ppi.read(0x80), 0x0f);
  assert.equal(ppi.snapshot().latch.a, 0);
  assert.equal(ppi.lastControlWrite, null);
});
