"use client";

// Small OLED-style screen (128x64, yellow status band over a blue graph, like the common SSD1306
// module) that draws the 8155 TIMER OUT signal over the last four timer periods.
import type { Pio8155Snapshot } from "@/lib/io/pio8155";
import { OLED_BOX, timerWavePoints, waveSpan } from "@/lib/io/waveform";

const MODE_TAGS = ["1×SQR", "SQR", "1×PLS", "PLS"] as const;

export function TimerOled({ timer }: { readonly timer: Pio8155Snapshot["timer"] }) {
  const started = timer.count > 0;
  const count = started ? timer.count : timer.countRegister;
  const mode = started ? timer.mode : timer.modeRegister;
  const points = timerWavePoints(timer.edges, timer.clock, timer.out, waveSpan(Math.max(2, count)));
  const state = timer.running ? "RUN" : started ? "STOP" : "IDLE";
  return (
    <div className="chip-oled">
      <svg
        viewBox="0 0 128 64"
        role="img"
        aria-label={`Timer output ${timer.out ? "high" : "low"}, ${state.toLowerCase()}, count ${count}`}
      >
        <text x="3" y="10" className="oled-head">
          TIMER OUT
        </text>
        <text x="125" y="10" className="oled-head" textAnchor="end">
          {MODE_TAGS[mode]}
        </text>
        <line x1="0" y1="14.5" x2="128" y2="14.5" className="oled-rule" />
        <line x1={OLED_BOX.x0} y1="51.5" x2={OLED_BOX.x1} y2="51.5" className="oled-base" />
        <polyline points={points} className="oled-wave" />
        <text x="3" y="62" className="oled-foot">
          N={count}
        </text>
        <text x="125" y="62" className="oled-foot" textAnchor="end">
          {state}
        </text>
      </svg>
    </div>
  );
}
