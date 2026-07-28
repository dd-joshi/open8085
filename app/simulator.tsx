"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  assemble8085,
  INSTRUCTION_SET_8085,
  type Assemble8085Result,
} from "@/lib/assembler8085";
import {
  CPU8085,
  type CPU8085State,
  type RegisterName,
  type StepResult,
} from "@/lib/cpu8085";
import {
  defaultBeginnerExample,
  examples8085,
  instructionCategories,
  type Example8085,
} from "@/lib/examples8085";

type InspectorTab = "memory" | "trace" | "io";
type StatusTone = "idle" | "ready" | "running" | "halted" | "error";

const SPEEDS = [1, 10, 100, 1_000, 10_000] as const;

const hex = (value: number, digits = 2) =>
  (value >>> 0).toString(16).toUpperCase().padStart(digits, "0");

const parseHex = (value: string, max: number): number | null => {
  const cleaned = value.trim().replace(/^0x/i, "").replace(/h$/i, "");
  if (!/^[0-9a-f]+$/i.test(cleaned)) return null;
  const parsed = Number.parseInt(cleaned, 16);
  return Number.isFinite(parsed) ? Math.min(parsed, max) : null;
};

const applyExampleMemory = (cpu: CPU8085, example: Example8085) => {
  for (const setupLine of example.setup.memory) {
    const assignment = setupLine.split("=");
    if (assignment.length < 2) continue;

    const left = assignment[0].trim();
    const right = assignment.slice(1).join("=");
    const range = left.match(
      /^([0-9a-f]+)h\s*\.\.\s*([0-9a-f]+)h$/i,
    );
    const single = left.match(/^([0-9a-f]+)h$/i);
    const values = Array.from(right.matchAll(/\b([0-9a-f]+)h\b/gi)).map(
      (match) => Number.parseInt(match[1], 16) & 0xff,
    );

    if (range && values.length) {
      const start = Number.parseInt(range[1], 16) & 0xffff;
      const end = Number.parseInt(range[2], 16) & 0xffff;
      values.slice(0, Math.max(0, end - start + 1)).forEach((value, index) => {
        cpu.setMemory(start + index, value);
      });
    } else if (single && values.length) {
      cpu.setMemory(Number.parseInt(single[1], 16), values[0]);
    }
  }
};

const loadAssembly = (
  cpu: CPU8085,
  assembly: Assemble8085Result,
  example: Example8085,
) => {
  cpu.reset(true, true);
  for (const segment of assembly.segments) {
    cpu.load(segment.bytes, segment.origin, false);
  }
  cpu.setRegister("PC", assembly.origin);
  applyExampleMemory(cpu, example);
};

const stateKeys = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "h",
  "l",
  "bc",
  "de",
  "hl",
  "sp",
  "pc",
] as const;

type StateKey = (typeof stateKeys)[number];

const changedStateKeys = (
  before: CPU8085State,
  after: CPU8085State,
): Set<StateKey> =>
  new Set(stateKeys.filter((key) => before[key] !== after[key]));

const registerDefinitions: ReadonlyArray<{
  label: string;
  register: RegisterName;
  key: StateKey;
  digits: 2 | 4;
}> = [
  { label: "A", register: "A", key: "a", digits: 2 },
  { label: "B", register: "B", key: "b", digits: 2 },
  { label: "C", register: "C", key: "c", digits: 2 },
  { label: "D", register: "D", key: "d", digits: 2 },
  { label: "E", register: "E", key: "e", digits: 2 },
  { label: "H", register: "H", key: "h", digits: 2 },
  { label: "L", register: "L", key: "l", digits: 2 },
  { label: "BC", register: "BC", key: "bc", digits: 4 },
  { label: "DE", register: "DE", key: "de", digits: 4 },
  { label: "HL", register: "HL", key: "hl", digits: 4 },
  { label: "SP", register: "SP", key: "sp", digits: 4 },
  { label: "PC", register: "PC", key: "pc", digits: 4 },
];

export function Simulator() {
  const initialAssemblyRef = useRef<Assemble8085Result | null>(null);
  const cpuRef = useRef<CPU8085 | null>(null);

  if (cpuRef.current === null) {
    const cpu = new CPU8085();
    const assembly = assemble8085(defaultBeginnerExample.source, 0x2000);
    if (assembly.success) {
      loadAssembly(cpu, assembly, defaultBeginnerExample);
    }
    cpuRef.current = cpu;
    initialAssemblyRef.current = assembly;
  }

  const cpu = cpuRef.current;
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const skipBreakpointOnceRef = useRef<number | null>(null);

  const [code, setCode] = useState(defaultBeginnerExample.source);
  const [selectedExampleId, setSelectedExampleId] = useState(
    defaultBeginnerExample.id,
  );
  const [assembly, setAssembly] = useState<Assemble8085Result | null>(
    initialAssemblyRef.current,
  );
  const [snapshot, setSnapshot] = useState<CPU8085State>(() => cpu.getState());
  const [changedRegisters, setChangedRegisters] = useState<Set<StateKey>>(
    new Set(),
  );
  const [trace, setTrace] = useState<StepResult[]>([]);
  const [breakpointLines, setBreakpointLines] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Ready. Example data is loaded at 2500H.",
  );
  const [inspectorTab, setInspectorTab] =
    useState<InspectorTab>("memory");
  const [memoryBaseText, setMemoryBaseText] = useState("2000");
  const [memoryBase, setMemoryBase] = useState(0x2000);
  const [selectedPortText, setSelectedPortText] = useState("01");
  const [selectedPort, setSelectedPort] = useState(0x01);
  const [speedIndex, setSpeedIndex] = useState(2);
  const [renderTick, setRenderTick] = useState(0);
  const [storageReady, setStorageReady] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceQuery, setReferenceQuery] = useState("");

  const selectedExample =
    examples8085.find((example) => example.id === selectedExampleId) ??
    defaultBeginnerExample;
  const sourceLines = code.split(/\r?\n/);
  const displayedPC =
    snapshot.halted && trace[0] ? trace[0].pc : snapshot.pc;
  const currentSourceLine = assembly?.addressToLine[displayedPC] ?? null;
  const assembledByteCount =
    assembly?.segments.reduce((total, segment) => total + segment.bytes.length, 0) ??
    0;

  const breakpointAddresses = useMemo(() => {
    const addresses = new Set<number>();
    if (!assembly?.success) return addresses;
    for (const entry of assembly.listing) {
      if (
        entry.address !== null &&
        entry.bytes.length > 0 &&
        breakpointLines.has(entry.line)
      ) {
        addresses.add(entry.address);
      }
    }
    return addresses;
  }, [assembly, breakpointLines]);

  const filteredInstructions = useMemo(() => {
    const query = referenceQuery.trim().toUpperCase();
    if (!query) return INSTRUCTION_SET_8085;
    return INSTRUCTION_SET_8085.filter(
      (instruction) =>
        instruction.mnemonic.includes(query) ||
        instruction.syntax.toUpperCase().includes(query) ||
        instruction.description.toUpperCase().includes(query),
    );
  }, [referenceQuery]);

  const syncMachine = useCallback(
    (before?: CPU8085State) => {
      const next = cpu.getState();
      setSnapshot(next);
      setChangedRegisters(before ? changedStateKeys(before, next) : new Set());
      setRenderTick((value) => value + 1);
    },
    [cpu],
  );

  const focusLine = useCallback((line: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    const lines = editor.value.split(/\r?\n/);
    const start = lines
      .slice(0, Math.max(0, line - 1))
      .reduce((position, current) => position + current.length + 1, 0);
    const end = start + (lines[line - 1]?.length ?? 0);
    editor.focus();
    editor.setSelectionRange(start, end);
    const lineHeight = 24;
    editor.scrollTop = Math.max(0, (line - 3) * lineHeight);
    if (gutterRef.current) gutterRef.current.scrollTop = editor.scrollTop;
  }, []);

  const assembleProgram = useCallback(
    (
      source = code,
      example = selectedExample,
    ): Assemble8085Result | null => {
      setRunning(false);
      const result = assemble8085(source, 0x2000);
      setAssembly(result);
      setTrace([]);
      skipBreakpointOnceRef.current = null;

      if (!result.success) {
        setDirty(true);
        setStatusMessage(
          `${result.errors.length} assembler ${
            result.errors.length === 1 ? "error" : "errors"
          }. Select a message to jump to the line.`,
        );
        return null;
      }

      loadAssembly(cpu, result, example);
      setDirty(false);
      setStatusMessage(
        `Assembled ${result.segments.reduce(
          (total, segment) => total + segment.bytes.length,
          0,
        )} bytes at ${hex(result.origin, 4)}H. Lab data loaded.`,
      );
      syncMachine();
      return result;
    },
    [code, cpu, selectedExample, syncMachine],
  );

  const resetMachine = useCallback(() => {
    setRunning(false);
    cpu.reset(false, false);
    cpu.setRegister("PC", assembly?.origin ?? 0x2000);
    setTrace([]);
    skipBreakpointOnceRef.current = null;
    setStatusMessage("Processor reset. Program and lab data are preserved.");
    syncMachine();
  }, [assembly?.origin, cpu, syncMachine]);

  const stepOnce = useCallback(() => {
    let activeAssembly = assembly;
    if (dirty || !assembly?.success) {
      activeAssembly = assembleProgram();
      if (!activeAssembly) return;
    }

    if (cpu.halted) {
      cpu.reset(false, false);
      cpu.setRegister("PC", activeAssembly?.origin ?? 0x2000);
    }

    const before = cpu.getState();
    try {
      const result = cpu.step();
      setTrace((previous) => [result, ...previous].slice(0, 120));
      syncMachine(before);
      setStatusMessage(
        result.halted
          ? `HLT reached at ${hex(result.pc, 4)}H.`
          : `${hex(result.pc, 4)}H  ${result.mnemonic} · ${result.cycles} T-states`,
      );
    } catch (error) {
      setRunning(false);
      setStatusMessage(
        error instanceof Error ? error.message : "Execution stopped unexpectedly.",
      );
    }
  }, [assembly, assembleProgram, cpu, dirty, syncMachine]);

  const toggleRun = useCallback(() => {
    if (running) {
      setRunning(false);
      setStatusMessage(`Paused at ${hex(cpu.pc, 4)}H.`);
      return;
    }

    let activeAssembly = assembly;
    if (dirty || !assembly?.success) {
      activeAssembly = assembleProgram();
      if (!activeAssembly) return;
    }

    if (cpu.halted) {
      cpu.reset(false, false);
      cpu.setRegister("PC", activeAssembly?.origin ?? 0x2000);
      setTrace([]);
      syncMachine();
    }

    skipBreakpointOnceRef.current = cpu.pc;
    setStatusMessage(`Running from ${hex(cpu.pc, 4)}H…`);
    setRunning(true);
  }, [assembly, assembleProgram, cpu, dirty, running, syncMachine]);

  useEffect(() => {
    if (!running) return;

    const speed = SPEEDS[speedIndex];
    const intervalMs = speed < 20 ? Math.round(1000 / speed) : 50;
    const stepsPerTick = speed < 20 ? 1 : Math.max(1, Math.round(speed / 20));

    const timer = window.setInterval(() => {
      const before = cpu.getState();
      const results: StepResult[] = [];
      let stopReason = "";

      for (let index = 0; index < stepsPerTick; index += 1) {
        if (cpu.halted) {
          stopReason = `HLT reached at ${hex(
            results.at(-1)?.pc ?? cpu.pc,
            4,
          )}H.`;
          break;
        }

        if (
          breakpointAddresses.has(cpu.pc) &&
          skipBreakpointOnceRef.current !== cpu.pc
        ) {
          stopReason = `Breakpoint at ${hex(cpu.pc, 4)}H.`;
          break;
        }

        if (skipBreakpointOnceRef.current === cpu.pc) {
          skipBreakpointOnceRef.current = null;
        }

        try {
          results.push(cpu.step());
        } catch (error) {
          stopReason =
            error instanceof Error
              ? error.message
              : "Execution stopped unexpectedly.";
          break;
        }
      }

      if (results.length) {
        setTrace((previous) => [
          ...[...results].reverse(),
          ...previous,
        ].slice(0, 120));
        syncMachine(before);
      }

      if (stopReason || cpu.halted) {
        setRunning(false);
        setStatusMessage(
          stopReason ||
            `HLT reached at ${hex(results.at(-1)?.pc ?? cpu.pc, 4)}H.`,
        );
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [breakpointAddresses, cpu, running, speedIndex, syncMachine]);

  useEffect(() => {
    const saved = window.localStorage.getItem("open8085-lab-source");
    if (saved && saved !== defaultBeginnerExample.source) {
      setCode(saved);
      setDirty(true);
      setStatusMessage("Restored your unsaved program. Assemble it to continue.");
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (storageReady) {
      window.localStorage.setItem("open8085-lab-source", code);
    }
  }, [code, storageReady]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        assembleProgram();
      } else if (event.key === "F8") {
        event.preventDefault();
        toggleRun();
      } else if (event.key === "F10") {
        event.preventDefault();
        stepOnce();
      } else if (event.shiftKey && event.key === "F5") {
        event.preventDefault();
        resetMachine();
      } else if (event.key === "Escape") {
        setReferenceOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [assembleProgram, resetMachine, stepOnce, toggleRun]);

  const chooseExample = (id: string) => {
    const example =
      examples8085.find((candidate) => candidate.id === id) ??
      defaultBeginnerExample;
    setSelectedExampleId(example.id);
    setCode(example.source);
    setBreakpointLines(new Set());
    setDirty(true);
    assembleProgram(example.source, example);
    setMemoryBaseText("2000");
    setMemoryBase(0x2000);
  };

  const editRegister = (
    register: RegisterName,
    value: string,
    digits: 2 | 4,
  ) => {
    const parsed = parseHex(value, digits === 2 ? 0xff : 0xffff);
    if (parsed === null) {
      syncMachine();
      return;
    }
    const before = cpu.getState();
    cpu.setRegister(register, parsed);
    syncMachine(before);
    setStatusMessage(`${register} set to ${hex(parsed, digits)}H.`);
  };

  const editMemory = (address: number, value: string) => {
    const parsed = parseHex(value, 0xff);
    if (parsed === null) {
      syncMachine();
      return;
    }
    cpu.setMemory(address, parsed);
    setRenderTick((current) => current + 1);
    setStatusMessage(
      `Memory ${hex(address, 4)}H set to ${hex(parsed, 2)}H.`,
    );
  };

  const jumpMemory = () => {
    const parsed = parseHex(memoryBaseText, 0xffff);
    if (parsed === null) {
      setMemoryBaseText(hex(memoryBase, 4));
      return;
    }
    const aligned = parsed & 0xfff8;
    setMemoryBase(aligned);
    setMemoryBaseText(hex(aligned, 4));
  };

  const selectPort = () => {
    const parsed = parseHex(selectedPortText, 0xff);
    if (parsed === null) {
      setSelectedPortText(hex(selectedPort, 2));
      return;
    }
    setSelectedPort(parsed);
    setSelectedPortText(hex(parsed, 2));
  };

  const toggleInputBit = (bit: number) => {
    const before = cpu.ports[0x02];
    cpu.setPort(0x02, before ^ (1 << bit));
    setRenderTick((current) => current + 1);
    setStatusMessage(
      `Input port 02H is now ${hex(cpu.ports[0x02], 2)}H.`,
    );
  };

  const downloadSource = () => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedExample.id || "program"}.asm`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const statusTone: StatusTone = running
    ? "running"
    : assembly && !assembly.success
      ? "error"
      : snapshot.halted
        ? "halted"
        : assembly?.success && !dirty
          ? "ready"
          : "idle";
  const currentInstruction =
    assembly?.success && !dirty
      ? cpu.disassembleAt(snapshot.pc).mnemonic
      : "Not assembled";
  const outputPort = cpu.ports[0x01];
  const inputPort = cpu.ports[0x02];
  void renderTick;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            8085
          </div>
          <div className="brand-copy">
            <span className="brand-name">Open8085 Lab</span>
            <span className="brand-tagline">
              Code · run · understand
            </span>
          </div>
        </div>
        <div className="topbar-meta">
          <button
            className="btn"
            type="button"
            onClick={() => setReferenceOpen(true)}
          >
            Instruction reference
          </button>
          <span className="free-badge">Free · no sign-in</span>
          <span className="status-pill">
            <span className={`status-dot ${statusTone}`} aria-hidden="true" />
            {statusTone === "running"
              ? "Running"
              : statusTone === "error"
                ? "Fix errors"
                : statusTone === "halted"
                  ? "Halted"
                  : dirty
                    ? "Edited"
                    : "Ready"}
          </span>
        </div>
      </header>

      <nav className="command-bar" aria-label="Simulator controls">
        <div className="command-group samples">
          <span className="field-label">Lab exercise</span>
          <select
            className="select-control"
            value={selectedExampleId}
            onChange={(event) => chooseExample(event.target.value)}
            aria-label="Choose a lab exercise"
          >
            {examples8085.map((example) => (
              <option key={example.id} value={example.id}>
                {example.title}
              </option>
            ))}
          </select>
        </div>
        <div className="command-spacer" />
        <div className="command-group actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => assembleProgram()}
            title="Assemble (Ctrl+Enter)"
          >
            Assemble <span className="key-hint">Ctrl ↵</span>
          </button>
          <button
            className="btn btn-run"
            type="button"
            onClick={toggleRun}
            title="Run or pause (F8)"
          >
            {running ? "Ⅱ Pause" : "▶ Run"}{" "}
            <span className="key-hint">F8</span>
          </button>
          <button
            className="btn"
            type="button"
            onClick={stepOnce}
            disabled={running}
            title="Execute one instruction (F10)"
          >
            Step <span className="key-hint">F10</span>
          </button>
          <button
            className="btn btn-danger"
            type="button"
            onClick={resetMachine}
            title="Reset processor (Shift+F5)"
          >
            Reset
          </button>
        </div>
        <div className="speed-control">
          <span className="field-label">Speed</span>
          <input
            type="range"
            min={0}
            max={SPEEDS.length - 1}
            step={1}
            value={speedIndex}
            onChange={(event) => setSpeedIndex(Number(event.target.value))}
            aria-label="Execution speed"
          />
          <span className="speed-value">
            {SPEEDS[speedIndex].toLocaleString()} instr/s
          </span>
        </div>
      </nav>

      <main className="workspace">
        <section className="panel editor-panel" aria-label="Assembly editor">
          <div className="panel-heading">
            <h1 className="panel-title">
              <span className="panel-title-dot" aria-hidden="true" />
              Program.asm
            </h1>
            <div className="command-group">
              <span className="panel-note">
                Click a line number to add a breakpoint
              </span>
              <button className="btn" type="button" onClick={downloadSource}>
                Save .asm
              </button>
            </div>
          </div>
          <div className="editor-shell">
            <div className="line-gutter" ref={gutterRef}>
              {sourceLines.map((_, index) => {
                const line = index + 1;
                const classes = [
                  "line-number",
                  currentSourceLine === line ? "active" : "",
                  breakpointLines.has(line) ? "breakpoint" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    key={line}
                    className={classes}
                    type="button"
                    tabIndex={-1}
                    aria-label={`Toggle breakpoint on line ${line}`}
                    onClick={() =>
                      setBreakpointLines((previous) => {
                        const next = new Set(previous);
                        if (next.has(line)) next.delete(line);
                        else next.add(line);
                        return next;
                      })
                    }
                  >
                    {line}
                  </button>
                );
              })}
            </div>
            <textarea
              ref={editorRef}
              className="code-editor"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setDirty(true);
                setRunning(false);
              }}
              onScroll={(event) => {
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Tab") {
                  event.preventDefault();
                  const target = event.currentTarget;
                  const start = target.selectionStart;
                  const end = target.selectionEnd;
                  const next = `${code.slice(0, start)}    ${code.slice(end)}`;
                  setCode(next);
                  setDirty(true);
                  window.requestAnimationFrame(() => {
                    target.selectionStart = target.selectionEnd = start + 4;
                  });
                }
              }}
              aria-label="8085 assembly source code"
              spellCheck={false}
            />
          </div>
          <div className="editor-footer" aria-live="polite">
            {assembly?.success ? (
              <div className="build-summary">
                <strong>{dirty ? "Source edited" : "Build successful"}</strong>
                <span>
                  {assembledByteCount} bytes · origin{" "}
                  {hex(assembly.origin, 4)}H ·{" "}
                  {Object.keys(assembly.symbols).length} labels
                </span>
              </div>
            ) : (
              <div className="build-summary error">
                <strong>
                  {assembly?.errors.length ?? 0} assembler{" "}
                  {(assembly?.errors.length ?? 0) === 1 ? "error" : "errors"}
                </strong>
              </div>
            )}
            {assembly && !assembly.success && (
              <div className="error-list">
                {assembly.errors.map((error, index) => (
                  <button
                    className="error-item"
                    type="button"
                    key={`${error.line}-${index}`}
                    onClick={() => focusLine(error.line)}
                  >
                    <span>Line {error.line}</span>
                    <span>{error.message}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="inspector-column" aria-label="Processor inspector">
          <section className="panel cpu-panel">
            <div className="panel-heading">
              <h2 className="panel-title">
                <span className="panel-title-dot" aria-hidden="true" />
                Processor state
              </h2>
              <span className="panel-note">
                PC {hex(snapshot.pc, 4)}H · {snapshot.totalCycles.toLocaleString()}{" "}
                T
              </span>
            </div>
            <div className="cpu-body">
              <div className="register-grid">
                {registerDefinitions.map((definition) => (
                  <label
                    className={`register ${
                      changedRegisters.has(definition.key) ? "changed" : ""
                    }`}
                    key={definition.register}
                  >
                    <span className="register-label">{definition.label}</span>
                    <input
                      className="register-input"
                      key={`${definition.register}-${snapshot[definition.key]}`}
                      defaultValue={hex(
                        snapshot[definition.key],
                        definition.digits,
                      )}
                      maxLength={definition.digits}
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={(event) =>
                        editRegister(
                          definition.register,
                          event.currentTarget.value,
                          definition.digits,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      aria-label={`${definition.label} register in hexadecimal`}
                    />
                  </label>
                ))}
              </div>
              <div className="flag-stack">
                <div>
                  <span className="field-label">Flags</span>
                  <div className="flag-grid">
                    {(
                      [
                        ["S", snapshot.flags.s],
                        ["Z", snapshot.flags.z],
                        ["AC", snapshot.flags.ac],
                        ["P", snapshot.flags.p],
                        ["CY", snapshot.flags.cy],
                      ] as const
                    ).map(([label, active]) => (
                      <span
                        className={`flag ${active ? "on" : ""}`}
                        key={label}
                        title={`${label} flag is ${active ? "set" : "clear"}`}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="cycles-card">
                  <span className="field-label">T-states</span>
                  <span className="cycles-number">
                    {snapshot.totalCycles.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="panel inspector-panel">
            <div className="panel-heading">
              <h2 className="panel-title">Inspect</h2>
              <div className="tabs" role="tablist" aria-label="Inspect data">
                {(["memory", "trace", "io"] as const).map((tab) => (
                  <button
                    className={`tab ${inspectorTab === tab ? "active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={inspectorTab === tab}
                    key={tab}
                    onClick={() => setInspectorTab(tab)}
                  >
                    {tab === "io" ? "I/O" : `${tab[0].toUpperCase()}${tab.slice(1)}`}
                  </button>
                ))}
              </div>
            </div>

            {inspectorTab === "memory" && (
              <div className="tab-panel">
                <div className="memory-toolbar">
                  <span className="memory-heading">
                    32 bytes from {hex(memoryBase, 4)}H
                  </span>
                  <div className="command-group">
                    <label className="sr-only" htmlFor="memory-jump">
                      Memory address
                    </label>
                    <input
                      id="memory-jump"
                      className="hex-jump"
                      value={memoryBaseText}
                      onChange={(event) => setMemoryBaseText(event.target.value)}
                      onBlur={jumpMemory}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") jumpMemory();
                      }}
                      maxLength={5}
                    />
                    <button className="btn" type="button" onClick={jumpMemory}>
                      Go
                    </button>
                  </div>
                </div>
                <div className="memory-grid">
                  <span className="memory-header">ADDR</span>
                  {Array.from({ length: 8 }, (_, column) => (
                    <span className="memory-header" key={column}>
                      +{hex(column, 1)}
                    </span>
                  ))}
                  {Array.from({ length: 4 }, (_, row) => {
                    const rowAddress = (memoryBase + row * 8) & 0xffff;
                    return [
                      <span className="memory-row-label" key={`r-${row}`}>
                        {hex(rowAddress, 4)}
                      </span>,
                      ...Array.from({ length: 8 }, (_, column) => {
                        const address = (rowAddress + column) & 0xffff;
                        const classes = [
                          "memory-cell",
                          address === snapshot.pc ? "pc-cell" : "",
                          address === snapshot.sp ? "sp-cell" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <input
                            className={classes}
                            key={`${address}-${cpu.memory[address]}-${renderTick}`}
                            defaultValue={hex(cpu.memory[address], 2)}
                            maxLength={2}
                            onFocus={(event) => event.currentTarget.select()}
                            onBlur={(event) =>
                              editMemory(address, event.currentTarget.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter")
                                event.currentTarget.blur();
                            }}
                            aria-label={`Memory ${hex(address, 4)} hexadecimal`}
                          />
                        );
                      }),
                    ];
                  })}
                </div>
              </div>
            )}

            {inspectorTab === "trace" && (
              <div className="tab-panel">
                {trace.length ? (
                  <div className="trace-list">
                    {trace.map((entry, index) => (
                      <div
                        className="trace-row"
                        key={`${entry.totalCycles}-${entry.pc}-${index}`}
                      >
                        <span className="trace-address">
                          {hex(entry.pc, 4)}
                        </span>
                        <span className="trace-bytes">
                          {entry.bytes.map((byte) => hex(byte, 2)).join(" ")}
                        </span>
                        <span className="trace-mnemonic">
                          {entry.mnemonic}
                        </span>
                        <span className="trace-cycles">{entry.cycles}T</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="trace-empty">
                    Step or run the program to build
                    <br />
                    an instruction-by-instruction history.
                  </div>
                )}
              </div>
            )}

            {inspectorTab === "io" && (
              <div className="tab-panel">
                <div className="io-grid">
                  <div className="io-card">
                    <span className="field-label">Inspect port</span>
                    <div className="io-card-row">
                      <input
                        className="hex-jump"
                        value={selectedPortText}
                        onChange={(event) =>
                          setSelectedPortText(event.target.value)
                        }
                        onBlur={selectPort}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") selectPort();
                        }}
                        aria-label="I/O port address"
                        maxLength={3}
                      />
                      <span className="port-value">
                        {hex(cpu.ports[selectedPort], 2)}H
                      </span>
                    </div>
                  </div>
                  <div className="io-card">
                    <span className="field-label">Write value</span>
                    <div className="io-card-row">
                      <input
                        className="hex-jump"
                        key={`port-${selectedPort}-${cpu.ports[selectedPort]}-${renderTick}`}
                        defaultValue={hex(cpu.ports[selectedPort], 2)}
                        onFocus={(event) => event.currentTarget.select()}
                        onBlur={(event) => {
                          const parsed = parseHex(event.currentTarget.value, 0xff);
                          if (parsed !== null) {
                            cpu.setPort(selectedPort, parsed);
                            setRenderTick((current) => current + 1);
                            setStatusMessage(
                              `Port ${hex(selectedPort, 2)}H set to ${hex(
                                parsed,
                                2,
                              )}H.`,
                            );
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter")
                            event.currentTarget.blur();
                        }}
                        aria-label="I/O port value"
                        maxLength={2}
                      />
                      <span className="panel-note">
                        decimal {cpu.ports[selectedPort]}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="panel trainer-panel">
            <div className="panel-heading">
              <h2 className="panel-title">Virtual trainer kit</h2>
              <span className="panel-note">
                Use OUT 01H · read switches with IN 02H
              </span>
            </div>
            <div className="trainer-body">
              <div className="trainer-module">
                <div className="module-title">
                  8-bit LED output
                  <span className="module-port">
                    PORT 01H = {hex(outputPort, 2)}H
                  </span>
                </div>
                <div className="led-row">
                  {Array.from({ length: 8 }, (_, index) => {
                    const bit = 7 - index;
                    const active = Boolean(outputPort & (1 << bit));
                    return (
                      <div className="led-wrap" key={bit}>
                        <span
                          className={`led ${active ? "on" : ""}`}
                          aria-label={`Output bit ${bit} ${
                            active ? "on" : "off"
                          }`}
                        />
                        <span className="bit-label">{bit}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="trainer-module">
                <div className="module-title">
                  Input switches
                  <span className="module-port">
                    PORT 02H = {hex(inputPort, 2)}H
                  </span>
                </div>
                <div className="dip-row">
                  {Array.from({ length: 8 }, (_, index) => {
                    const bit = 7 - index;
                    const active = Boolean(inputPort & (1 << bit));
                    return (
                      <button
                        className={`dip ${active ? "on" : ""}`}
                        type="button"
                        key={bit}
                        onClick={() => toggleInputBit(bit)}
                        aria-pressed={active}
                        aria-label={`Toggle input bit ${bit}`}
                      >
                        {bit}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </aside>
      </main>

      <footer className="status-footer">
        <div className="status-message" aria-live="polite">
          <strong>{currentInstruction}</strong> · {statusMessage}
        </div>
        <div className="learning-tip">
          <span className="tip-mark" aria-hidden="true">
            i
          </span>
          {selectedExample.learningGoal}
        </div>
      </footer>

      {referenceOpen && (
        <div
          className="reference-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReferenceOpen(false);
          }}
        >
          <aside
            className="reference-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reference-title"
          >
            <div className="reference-header">
              <div>
                <span className="field-label">Intel 8085</span>
                <h2 id="reference-title">Instruction reference</h2>
              </div>
              <button
                className="btn btn-icon"
                type="button"
                onClick={() => setReferenceOpen(false)}
                aria-label="Close instruction reference"
              >
                ×
              </button>
            </div>
            <div className="reference-search">
              <input
                value={referenceQuery}
                onChange={(event) => setReferenceQuery(event.target.value)}
                placeholder="Search MOV, jump, stack…"
                autoFocus
                aria-label="Search instructions"
              />
            </div>
            {!referenceQuery && (
              <div className="category-strip">
                {instructionCategories.map((category) => (
                  <span key={category.id}>{category.title}</span>
                ))}
              </div>
            )}
            <div className="instruction-list">
              {filteredInstructions.map((instruction, index) => (
                <article
                  className="instruction-card"
                  key={`${instruction.mnemonic}-${instruction.syntax}-${index}`}
                >
                  <div className="instruction-name">
                    <strong>{instruction.mnemonic}</strong>
                    <span>{instruction.bytes}B</span>
                  </div>
                  <code>{instruction.syntax}</code>
                  <p>{instruction.description}</p>
                </article>
              ))}
              {!filteredInstructions.length && (
                <div className="reference-empty">
                  No instruction matches “{referenceQuery}”.
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
