// Turns the 8155 TIMER OUT edge history into a polyline for the small OLED-style display.
import type { TimerEdge } from "./pio8155";

export interface WaveBox {
  /** Left and right x of the trace. */
  readonly x0: number;
  readonly x1: number;
  /** y for a high (1) and a low (0) level. */
  readonly yHigh: number;
  readonly yLow: number;
  /** Narrowest drawn pulse, so a one-clock pulse is still visible. */
  readonly minPulse: number;
}

export const OLED_BOX: WaveBox = { x0: 4, x1: 124, yHigh: 22, yLow: 48, minPulse: 1.5 };

/** How many timer clocks the display spans: four periods of the count, at least 8 clocks. */
export const waveSpan = (count: number) => Math.max(8, 4 * count);

/**
 * Polyline points ("x,y x,y ...") of TIMER OUT over the last `span` timer clocks ending at `now`.
 * `levelNow` is the current output level (used when no edge falls inside the window).
 */
export function timerWavePoints(
  edges: readonly TimerEdge[],
  now: number,
  levelNow: 0 | 1,
  span: number,
  box: WaveBox = OLED_BOX,
): string {
  const start = now - span;
  const inside = edges.filter((edge) => edge.clock > start && edge.clock <= now);
  const before = edges.filter((edge) => edge.clock <= start).at(-1);
  let level: 0 | 1 = before ? before.level : inside.length ? (inside[0].level === 1 ? 0 : 1) : levelNow;
  const y = (value: 0 | 1) => (value ? box.yHigh : box.yLow);
  const xOf = (clock: number) => box.x0 + ((clock - start) / span) * (box.x1 - box.x0);
  const round = (value: number) => Math.round(value * 100) / 100;
  const points: string[] = [`${box.x0},${y(level)}`];
  let lastX = box.x0;
  for (const edge of inside) {
    const x = Math.min(box.x1, Math.max(xOf(edge.clock), lastX + box.minPulse));
    points.push(`${round(x)},${y(level)}`, `${round(x)},${y(edge.level)}`);
    level = edge.level;
    lastX = x;
  }
  points.push(`${box.x1},${y(level)}`);
  return points.join(" ");
}

/** 8085 kits feed the 8155 TIMER IN from CLK OUT: 6.144 MHz crystal / 2 = 3.072 MHz. */
export const TIMER_CLOCK_HZ = 3_072_000;

export interface TimerTiming {
  /** Output frequency for repeating modes (one period = N timer clocks). */
  readonly frequencyHz: number;
  /** Time TIMER OUT is high (ON) and low (OFF) in one period. */
  readonly highSeconds: number;
  readonly lowSeconds: number;
  /** False for the single square wave / single pulse modes. */
  readonly repeating: boolean;
}

/**
 * Real-hardware timing of the 8155 TIMER OUT for count N and mode M.
 * Square wave: high ceil(N/2) clocks, low floor(N/2). Pulse: high N-1 clocks, low 1 clock.
 */
export function timerTiming(count: number, mode: 0 | 1 | 2 | 3, clockHz = TIMER_CLOCK_HZ): TimerTiming {
  const n = Math.max(2, count & 0x3fff);
  const square = mode === 0 || mode === 1;
  const high = square ? Math.ceil(n / 2) : n - 1;
  return {
    frequencyHz: clockHz / n,
    highSeconds: high / clockHz,
    lowSeconds: (n - high) / clockHz,
    repeating: mode === 1 || mode === 3,
  };
}

const threeDigits = (value: number) => Number(value.toPrecision(3)).toString();

export function formatFrequency(hz: number): string {
  if (hz >= 1e6) return `${threeDigits(hz / 1e6)} MHz`;
  if (hz >= 1e3) return `${threeDigits(hz / 1e3)} kHz`;
  return `${threeDigits(hz)} Hz`;
}

export function formatDuration(seconds: number): string {
  if (seconds >= 1) return `${threeDigits(seconds)} s`;
  if (seconds >= 1e-3) return `${threeDigits(seconds * 1e3)} ms`;
  return `${threeDigits(seconds * 1e6)} µs`;
}
