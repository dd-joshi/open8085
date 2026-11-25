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
