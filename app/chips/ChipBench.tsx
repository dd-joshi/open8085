"use client";

// I/O chips column (8255 PPI + 8155 RAM·I/O·TIMER). Presentational only: it renders chip snapshots
// and reports clicks to the simulator, which owns the chips and the 8085.
import type { ReactNode } from "react";
import type { BusTransfer } from "@/lib/io/bus";
import type { IoChips } from "@/lib/io/chips";
import { TIMER_MODE_NAMES } from "@/lib/io/pio8155";
import type { PortDirection } from "@/lib/io/ppi8255";

export type ChipId = "ppi" | "pio";
export type ChipPort = "a" | "b" | "c";
export type ChipBaseTarget = ChipId | "ram";

export interface ChipBenchProps {
  readonly chips: IoChips;
  /** True while the program runs: base addresses are locked. */
  readonly locked: boolean;
  readonly onToggleBit: (chip: ChipId, port: ChipPort, bit: number) => void;
  readonly onBaseChange: (target: ChipBaseTarget, text: string) => void;
  readonly onShowRam: () => void;
  /** Optional timer display (the OLED), shown left of the timer registers. */
  readonly timerDisplay?: ReactNode;
}

type Cell =
  | { readonly kind: "led"; readonly on: boolean }
  | { readonly kind: "switch"; readonly on: boolean }
  | { readonly kind: "bit"; readonly on: boolean }
  | { readonly kind: "none" };

const BITS = [7, 6, 5, 4, 3, 2, 1, 0] as const;

const hex = (value: number, digits = 2) => value.toString(16).toUpperCase().padStart(digits, "0");

const isOn = (value: number, bit: number) => Boolean(value & (1 << bit));

/** LEDs for an output port, switches for an input port. */
const portCells = (direction: PortDirection, latch: number, pins: number): Cell[] =>
  BITS.map((bit) => (direction === "out" ? { kind: "led", on: isOn(latch, bit) } : { kind: "switch", on: isOn(pins, bit) }));

const transferText = (transfer: BusTransfer | null) =>
  transfer ? `${transfer.kind} ${hex(transfer.port)}H ${transfer.kind === "OUT" ? "←" : "→"} ${hex(transfer.value)}H` : "none yet";

function AddressTag({ children }: { readonly children: ReactNode }) {
  return <span className="chip-addr">{children}</span>;
}

function BitHeader() {
  return (
    <>
      <span />
      {BITS.map((bit) => (
        <span className="chip-bit-head" key={bit}>
          {bit}
        </span>
      ))}
      <span />
    </>
  );
}

function PortRow({
  address,
  name,
  cells,
  value,
  badge,
  onToggle,
}: {
  readonly address: number;
  readonly name: string;
  readonly cells: readonly Cell[];
  readonly value: number | null;
  readonly badge: string;
  readonly onToggle?: (bit: number) => void;
}) {
  return (
    <>
      <span className="chip-port">
        <AddressTag>{hex(address)}H</AddressTag>
        {name}
      </span>
      {cells.map((cell, index) => {
        const bit = 7 - index;
        if (cell.kind === "switch") {
          return (
            <button
              className={`chip-switch${cell.on ? " on" : ""}`}
              type="button"
              key={bit}
              aria-pressed={cell.on}
              aria-label={`${name} ${hex(address)}H input bit ${bit}`}
              title={`${name} bit ${bit}: click to toggle the input switch`}
              onClick={() => onToggle?.(bit)}
            />
          );
        }
        if (cell.kind === "led") {
          return (
            <span
              className={`chip-led${cell.on ? " on" : ""}`}
              key={bit}
              role="img"
              aria-label={`${name} ${hex(address)}H output bit ${bit} ${cell.on ? "on" : "off"}`}
            />
          );
        }
        if (cell.kind === "bit") {
          return (
            <span className={`chip-bit${cell.on ? " one" : ""}`} key={bit}>
              {cell.on ? 1 : 0}
            </span>
          );
        }
        return (
          <span className="chip-none" key={bit} aria-hidden="true">
            ·
          </span>
        );
      })}
      <span className="chip-value">
        {value === null ? "--" : `${hex(value)}H`}
        <em className={`chip-dir ${badge.toLowerCase()}`}>{badge}</em>
      </span>
    </>
  );
}

function BaseField({
  label,
  value,
  digits,
  locked,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly digits: number;
  readonly locked: boolean;
  readonly onCommit: (text: string) => void;
}) {
  return (
    <label className="chip-base" title={locked ? "Pause the program to change the address" : `Change the ${label}`}>
      base
      <span className="chip-base-box">
        <input
          key={value}
          className="chip-base-input"
          defaultValue={hex(value, digits)}
          disabled={locked}
          maxLength={digits}
          size={digits}
          spellCheck={false}
          aria-label={label}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => onCommit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        H
      </span>
    </label>
  );
}

function Ppi8255Card({ chips, locked, onToggleBit, onBaseChange }: ChipBenchProps) {
  const snap = chips.ppi.snapshot();
  const base = snap.base;
  const toggle = (port: ChipPort) => (bit: number) => onToggleBit("ppi", port, bit);
  const cUpper = portCells(snap.direction.cUpper, snap.latch.c, snap.pins.c).slice(0, 4);
  const cLower = portCells(snap.direction.cLower, snap.latch.c, snap.pins.c).slice(4);
  const cBadge = snap.direction.cUpper === snap.direction.cLower ? snap.direction.cUpper.toUpperCase() : "MIX";
  return (
    <section className="chip-card" aria-label="8255 programmable peripheral interface">
      <div className="chip-head">
        <span className="chip-name">
          8255<small>PPI</small>
        </span>
        <BaseField label="8255 base port" value={base} digits={2} locked={locked} onCommit={(text) => onBaseChange("ppi", text)} />
      </div>
      <div className="chip-grid">
        <BitHeader />
        <PortRow address={base} name="PA" cells={portCells(snap.direction.a, snap.latch.a, snap.pins.a)} value={snap.value.a} badge={snap.direction.a.toUpperCase()} onToggle={toggle("a")} />
        <PortRow address={base + 1} name="PB" cells={portCells(snap.direction.b, snap.latch.b, snap.pins.b)} value={snap.value.b} badge={snap.direction.b.toUpperCase()} onToggle={toggle("b")} />
        <PortRow address={base + 2} name="PC" cells={[...cUpper, ...cLower]} value={snap.value.c} badge={cBadge} onToggle={toggle("c")} />
        <PortRow
          address={base + 3}
          name="CW"
          cells={snap.programmed ? BITS.map((bit) => ({ kind: "bit", on: isOn(snap.control, bit) })) : BITS.map(() => ({ kind: "none" }))}
          value={snap.programmed ? snap.control : null}
          badge="CTL"
        />
      </div>
      <div className="chip-say">{snap.summary}</div>
      {snap.warning && <div className="chip-warning">{snap.warning}</div>}
      <div className="chip-last">
        last: <b>{transferText(chips.bus.lastFor("8255"))}</b>
      </div>
    </section>
  );
}

function Pio8155Card({ chips, locked, onToggleBit, onBaseChange, onShowRam, timerDisplay }: ChipBenchProps) {
  const snap = chips.pio.snapshot();
  const base = snap.base;
  const timer = snap.timer;
  const toggle = (port: ChipPort) => (bit: number) => onToggleBit("pio", port, bit);
  const pcCells: Cell[] = BITS.map((bit) => {
    if (bit > 5) return { kind: "none" };
    if (snap.portCMode === "ALT1") return { kind: "switch", on: isOn(snap.pins.c, bit) };
    if (snap.portCMode === "ALT2") return { kind: "led", on: isOn(snap.latch.c, bit) };
    if (snap.portCMode === "ALT3" && bit >= 3) return { kind: "led", on: isOn(snap.latch.c, bit) };
    return { kind: "none" };
  });
  const pcBadge = snap.portCMode === "ALT1" ? "IN" : snap.portCMode === "ALT2" ? "OUT" : "HS";
  const shownCount = timer.running || timer.count ? timer.count : timer.countRegister;
  const shownMode = timer.running || timer.count ? timer.mode : timer.modeRegister;
  const timerState = timer.running ? "running" : timer.count ? "stopped" : "not started";
  return (
    <section className="chip-card" aria-label="8155 RAM, I/O and timer">
      <div className="chip-head">
        <span className="chip-name">
          8155<small>RAM · I/O · TIMER</small>
        </span>
        <BaseField label="8155 base port" value={base} digits={2} locked={locked} onCommit={(text) => onBaseChange("pio", text)} />
      </div>
      <div className="chip-grid">
        <BitHeader />
        <PortRow
          address={base}
          name="CMD"
          cells={snap.programmed ? BITS.map((bit) => ({ kind: "bit", on: isOn(snap.command, bit) })) : BITS.map(() => ({ kind: "none" }))}
          value={snap.programmed ? snap.command : null}
          badge="CTL"
        />
        <PortRow address={base + 1} name="PA" cells={portCells(snap.direction.a, snap.latch.a, snap.pins.a)} value={snap.value.a} badge={snap.direction.a.toUpperCase()} onToggle={toggle("a")} />
        <PortRow address={base + 2} name="PB" cells={portCells(snap.direction.b, snap.latch.b, snap.pins.b)} value={snap.value.b} badge={snap.direction.b.toUpperCase()} onToggle={toggle("b")} />
        <PortRow address={base + 3} name="PC" cells={pcCells} value={snap.value.c} badge={pcBadge} onToggle={toggle("c")} />
      </div>
      <div className="chip-say">{snap.summary}</div>
      {snap.warning && <div className="chip-warning">{snap.warning}</div>}
      <div className="chip-last">
        status: IN {hex(base)}H → {hex(snap.status)}H{timer.terminalCount ? " (TIMER done)" : ""}
      </div>
      <div className="chip-last">
        last: <b>{transferText(chips.bus.lastFor("8155"))}</b>
      </div>
      <div className={`chip-timer${timerDisplay ? " with-display" : ""}`}>
        {timerDisplay}
        <div className="chip-timer-info">
          <span className="chip-reg">
            <AddressTag>{hex(base + 4)}H</AddressTag>TL<b>{hex(chips.pio.read(base + 4))}H</b>
          </span>
          <span className="chip-reg">
            <AddressTag>{hex(base + 5)}H</AddressTag>TH<b>{hex(chips.pio.read(base + 5))}H</b>
          </span>
          <span className="chip-note">
            count {hex(shownCount, 4)}H = {shownCount}
            <br />
            mode {shownMode.toString(2).padStart(2, "0")}: {TIMER_MODE_NAMES[shownMode]}
            <br />
            {timerState} · TIMER OUT {timer.out ? "high" : "low"}
          </span>
        </div>
      </div>
      <div className="chip-ram">
        <span>
          <BaseField label="8155 RAM start address" value={snap.ramBase} digits={4} locked={locked} onCommit={(text) => onBaseChange("ram", text)} />
          <span className="chip-ram-range">
            – <AddressTag>{hex(snap.ramBase + 0xff, 4)}H</AddressTag> RAM
          </span>
        </span>
        <button type="button" className="chip-show" onClick={onShowRam}>
          Show
        </button>
      </div>
    </section>
  );
}

export function ChipBench(props: ChipBenchProps) {
  return (
    <section className="panel chip-bench" aria-label="I/O chips">
      <div className="panel-heading">
        <h2 className="panel-title">I/O chips</h2>
        <span className="chip-mode">Virtual</span>
      </div>
      <div className="chip-body">
        <Ppi8255Card {...props} />
        <Pio8155Card {...props} />
      </div>
    </section>
  );
}
