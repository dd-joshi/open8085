import assert from "node:assert/strict";
import test from "node:test";

import { Pio8155 } from "../lib/io/pio8155.ts";
import { timerWavePoints, waveSpan, type WaveBox } from "../lib/io/waveform.ts";

const BOX: WaveBox = { x0: 0, x1: 100, yHigh: 10, yLow: 20, minPulse: 2 };

test("no edges: a flat line at the current level", () => {
  assert.equal(timerWavePoints([], 50, 1, 40, BOX), "0,10 100,10");
  assert.equal(timerWavePoints([], 50, 0, 40, BOX), "0,20 100,20");
});

test("square wave edges become vertical steps at their clock positions", () => {
  const edges = [
    { clock: 10, level: 0 as const },
    { clock: 20, level: 1 as const },
  ];
  // Window 0..40: starts high (opposite of the first edge), low at 25%, high at 50%.
  assert.equal(timerWavePoints(edges, 40, 1, 40, BOX), "0,10 25,10 25,20 50,20 50,10 100,10");
});

test("the level before the window comes from the last earlier edge", () => {
  const edges = [
    { clock: 5, level: 0 as const },
    { clock: 30, level: 1 as const },
  ];
  assert.equal(timerWavePoints(edges, 50, 1, 40, BOX), "0,20 50,20 50,10 100,10");
});

test("a one-clock pulse is drawn at least minPulse wide", () => {
  const edges = [
    { clock: 1000, level: 0 as const },
    { clock: 1001, level: 1 as const },
  ];
  const points = timerWavePoints(edges, 2000, 1, 2000, BOX).split(" ");
  const xs = points.map((point) => Number(point.split(",")[0]));
  assert.ok(xs[3] - xs[1] >= 2, `pulse width ${xs[3] - xs[1]}`);
});

test("works on a real 8155 square wave: four periods in view", () => {
  const chip = new Pio8155();
  chip.write(0x24, 10);
  chip.write(0x25, 0x40);
  chip.write(0x20, 0xc0);
  chip.tick(100);
  const timer = chip.snapshot().timer;
  const points = timerWavePoints(timer.edges, timer.clock, timer.out, waveSpan(timer.count), BOX);
  const pairs = points.split(" ").map((point) => point.split(",").map(Number));
  const verticals = pairs.filter(([x, y], index) => index > 0 && x === pairs[index - 1][0] && y !== pairs[index - 1][1]);
  assert.equal(verticals.length, 8, "4 periods = 8 edges");
});
