"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Hammer,
  Pause,
  Play,
  RotateCcw,
  StepForward,
  X,
} from "lucide-react";
import {
  assemble8085,
  INSTRUCTION_SET_8085,
  type Assemble8085Result,
} from "@/lib/assembler8085";
import {
  CPU8085,
  type CPU8085Flags,
  type CPU8085State,
  type RegisterName,
  type StepResult,
} from "@/lib/cpu8085";
import {
  formatByteFields,
  parseByteInput,
  type ByteConverterField,
  type ByteConverterFields,
} from "@/lib/byteConverter";
import {
  defaultBeginnerExample,
  examples8085,
  type Example8085,
} from "@/lib/examples8085";
import {
  createInstructionInsight,
  packFlagRegister,
  type InstructionInsight,
} from "@/lib/insight8085";
import {
  createExperimentFilename,
  createExperimentHeader,
  ensureExperimentHeader,
  formatExperimentNumber,
  labExperiments,
  paginateLabExperiments,
} from "@/lib/labExperiments";

type InspectorTab = "memory" | "trace" | "io";
type StatusTone = "idle" | "ready" | "running" | "halted" | "error";
type FlagKey = keyof CPU8085Flags;
type ActiveDocument =
  | { readonly kind: "example"; readonly id: string }
  | { readonly kind: "experiment"; readonly number: number }
  | { readonly kind: "scratch" };

const SPEEDS = [1, 10, 1_000] as const;
const EXPERIMENTS_PER_PAGE = 10;
const MEMORY_ROWS = 4;
const MEMORY_BYTES_PER_ROW = 8;
const SESSION_STORAGE_KEY = "open8085-lab-session-v2";
const LEGACY_SOURCE_STORAGE_KEY = "open8085-lab-source";
const MAX_STORED_SOURCE_LENGTH = 500_000;

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
  example: Example8085 | null,
) => {
  cpu.reset(true, true);
  for (const segment of assembly.segments) {
    cpu.load(segment.bytes, segment.origin, false);
  }
  cpu.setRegister("PC", assembly.entryPoint);
  if (example) applyExampleMemory(cpu, example);
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

const changedFlagKeys = (
  before: CPU8085State,
  after: CPU8085State,
): Set<FlagKey> =>
  new Set(
    (Object.keys(before.flags) as FlagKey[]).filter(
      (key) => before.flags[key] !== after.flags[key],
    ),
  );

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
  const [{ cpu, initialAssembly }] = useState(() => {
    const cpu = new CPU8085();
    const assembly = assemble8085(defaultBeginnerExample.source, 0x2000);
    if (assembly.success) {
      loadAssembly(cpu, assembly, defaultBeginnerExample);
    }
    return { cpu, initialAssembly: assembly };
  });
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const skipBreakpointOnceRef = useRef<number | null>(null);
  const latestRunInsightRef = useRef<InstructionInsight | null>(null);

  const [code, setCode] = useState(defaultBeginnerExample.source);
  const [activeDocument, setActiveDocument] = useState<ActiveDocument>({
    kind: "example",
    id: defaultBeginnerExample.id,
  });
  const [savedSource, setSavedSource] = useState(
    defaultBeginnerExample.source,
  );
  const [experimentPage, setExperimentPage] = useState(0);
  const [assembly, setAssembly] = useState<Assemble8085Result | null>(
    initialAssembly,
  );
  const [snapshot, setSnapshot] = useState<CPU8085State>(() => cpu.getState());
  const [changedRegisters, setChangedRegisters] = useState<Set<StateKey>>(
    new Set(),
  );
  const [changedFlags, setChangedFlags] = useState<Set<FlagKey>>(new Set());
  const [trace, setTrace] = useState<StepResult[]>([]);
  const [insight, setInsight] = useState<InstructionInsight | null>(null);
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
  const [speedIndex, setSpeedIndex] = useState(1);
  const [converterValue, setConverterValue] = useState(0);
  const [converterFields, setConverterFields] =
    useState<ByteConverterFields>(() => formatByteFields(0));
  const [renderTick, setRenderTick] = useState(0);
  const [storageReady, setStorageReady] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceQuery, setReferenceQuery] = useState("");

  const selectedExample =
    activeDocument.kind === "example"
      ? examples8085.find((example) => example.id === activeDocument.id) ?? null
      : null;
  const selectedExperiment =
    activeDocument.kind === "experiment"
      ? labExperiments.find(
          (experiment) => experiment.number === activeDocument.number,
        ) ?? null
      : null;
  const experimentPagination = paginateLabExperiments(
    labExperiments,
    experimentPage,
    EXPERIMENTS_PER_PAGE,
  );
  const experimentPageCount = experimentPagination.pageCount;
  const safeExperimentPage = experimentPagination.page;
  const visibleExperiments = experimentPagination.items;
  const selectedExperimentValue =
    selectedExperiment &&
    visibleExperiments.some(
      (experiment) => experiment.number === selectedExperiment.number,
    )
      ? String(selectedExperiment.number)
      : "";
  const experimentRangeWidth = Math.max(
    2,
    String(labExperiments.length).length,
  );
  const experimentRangeLabel = `${String(
    experimentPagination.rangeStart,
  ).padStart(
    experimentRangeWidth,
    "0",
  )}–${String(experimentPagination.rangeEnd).padStart(
    experimentRangeWidth,
    "0",
  )} of ${String(labExperiments.length).padStart(
    experimentRangeWidth,
    "0",
  )}`;
  const hasUserEdits = code !== savedSource;
  const editorFilename = selectedExperiment
    ? createExperimentFilename(selectedExperiment)
    : "Program.asm";
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

  const clearInsight = useCallback(() => {
    latestRunInsightRef.current = null;
    setInsight(null);
  }, []);

  const syncMachine = useCallback(
    (before?: CPU8085State) => {
      const next = cpu.getState();
      setSnapshot(next);
      setChangedRegisters(before ? changedStateKeys(before, next) : new Set());
      setChangedFlags(before ? changedFlagKeys(before, next) : new Set());
      setRenderTick((value) => value + 1);
    },
    [cpu],
  );

  useEffect(() => {
    if (!changedRegisters.size && !changedFlags.size) return;
    const timer = window.setTimeout(() => {
      setChangedRegisters(new Set());
      setChangedFlags(new Set());
    }, 520);
    return () => window.clearTimeout(timer);
  }, [changedFlags, changedRegisters]);

  const executeInstruction = useCallback(() => {
    const before = cpu.getState();
    const result = cpu.step();
    const after = cpu.getState();
    const nextInsight = createInstructionInsight({
      before,
      after,
      step: result,
      memory: cpu.memory,
      ports: cpu.ports,
    });
    return { before, result, insight: nextInsight };
  }, [cpu]);

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
      example: Example8085 | null = selectedExample,
    ): Assemble8085Result | null => {
      setRunning(false);
      const result = assemble8085(source, 0x2000);
      setTrace([]);
      clearInsight();
      skipBreakpointOnceRef.current = null;

      if (!result.success) {
        setAssembly(result);
        setDirty(true);
        setStatusMessage(
          `${result.errors.length} assembler ${
            result.errors.length === 1 ? "error" : "errors"
          }. Select a message to jump to the line.`,
        );
        return null;
      }

      const byteCount = result.segments.reduce(
        (total, segment) => total + segment.bytes.length,
        0,
      );
      if (byteCount === 0) {
        setAssembly(null);
        setDirty(false);
        cpu.reset(true, true);
        cpu.setRegister("PC", 0x2000);
        setStatusMessage(
          "Add at least one 8085 instruction before assembling or running.",
        );
        syncMachine();
        return null;
      }

      setAssembly(result);
      loadAssembly(cpu, result, example);
      setDirty(false);
      setStatusMessage(
        `Assembled ${byteCount} bytes. Entry PC ${hex(result.entryPoint, 4)}H. ${
          example ? "Example data loaded." : "Machine cleared for this experiment."
        }`,
      );
      syncMachine();
      return result;
    },
    [clearInsight, code, cpu, selectedExample, syncMachine],
  );

  const resetMachine = useCallback(() => {
    setRunning(false);
    cpu.reset(false, false);
    cpu.setRegister("PC", assembly?.entryPoint ?? 0x2000);
    setTrace([]);
    clearInsight();
    skipBreakpointOnceRef.current = null;
    setStatusMessage("Processor reset. Program, memory, and ports are preserved.");
    syncMachine();
  }, [assembly?.entryPoint, clearInsight, cpu, syncMachine]);

  const stepOnce = useCallback(() => {
    if (running) return;

    if (dirty || !assembly?.success) {
      if (!assembleProgram()) return;
    }

    if (cpu.halted) {
      setStatusMessage("Halted — Reset before stepping.");
      return;
    }

    try {
      const execution = executeInstruction();
      const { result } = execution;
      setTrace((previous) => [result, ...previous].slice(0, 120));
      latestRunInsightRef.current = execution.insight;
      setInsight(execution.insight);
      syncMachine(execution.before);
      if (result.halted) {
        setStatusMessage(`HLT reached at ${hex(result.pc, 4)}H.`);
      }
    } catch (error) {
      setRunning(false);
      setStatusMessage(
        error instanceof Error ? error.message : "Execution stopped unexpectedly.",
      );
    }
  }, [
    assembly,
    assembleProgram,
    cpu,
    dirty,
    executeInstruction,
    running,
    syncMachine,
  ]);

  const toggleRun = useCallback(() => {
    if (running) {
      setRunning(false);
      if (latestRunInsightRef.current) {
        setInsight(latestRunInsightRef.current);
      }
      setStatusMessage(`Paused at ${hex(cpu.pc, 4)}H.`);
      return;
    }

    if (dirty || !assembly?.success) {
      if (!assembleProgram()) return;
    }

    if (cpu.halted) {
      setStatusMessage("Halted — Reset before running.");
      return;
    }

    skipBreakpointOnceRef.current = cpu.pc;
    setStatusMessage(`Running from ${hex(cpu.pc, 4)}H…`);
    setRunning(true);
  }, [
    assembly,
    assembleProgram,
    cpu,
    dirty,
    running,
  ]);

  useEffect(() => {
    if (!running) return;

    const speed = SPEEDS[speedIndex];
    const intervalMs = speed < 20 ? Math.round(1000 / speed) : 50;
    const stepsPerTick = speed < 20 ? 1 : Math.max(1, Math.round(speed / 20));

    const timer = window.setInterval(() => {
      let batchBefore: CPU8085State | null = null;
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
          const execution = executeInstruction();
          batchBefore ??= execution.before;
          results.push(execution.result);
          latestRunInsightRef.current = execution.insight;
          if (execution.result.halted) {
            stopReason = `HLT reached at ${hex(execution.result.pc, 4)}H.`;
            break;
          }
          if (breakpointAddresses.has(cpu.pc)) {
            stopReason = `Breakpoint at ${hex(cpu.pc, 4)}H.`;
            break;
          }
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
        syncMachine(batchBefore ?? undefined);
      }

      if (stopReason || cpu.halted) {
        setRunning(false);
        if (latestRunInsightRef.current) {
          setInsight(latestRunInsightRef.current);
        }
        setStatusMessage(
          stopReason ||
            `HLT reached at ${hex(results.at(-1)?.pc ?? cpu.pc, 4)}H.`,
        );
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [
    breakpointAddresses,
    cpu,
    executeInstruction,
    running,
    speedIndex,
    syncMachine,
  ]);

  useEffect(() => {
    const restoreDocument = (
      document: ActiveDocument,
      source: string,
      storedSavedSource?: string,
    ): boolean => {
      if (source.length > MAX_STORED_SOURCE_LENGTH) return false;

      const example =
        document.kind === "example"
          ? examples8085.find((candidate) => candidate.id === document.id)
          : null;
      const experiment =
        document.kind === "experiment"
          ? labExperiments.find(
              (candidate) => candidate.number === document.number,
            )
          : null;
      const isScratch = document.kind === "scratch";
      if (!example && !experiment && !isScratch) return false;

      const canonicalSource =
        example?.source ??
        (experiment ? createExperimentHeader(experiment) : "");
      const restoredSource = experiment
        ? ensureExperimentHeader(experiment, source)
        : source;
      const persistedSavedSource =
        typeof storedSavedSource === "string" &&
        storedSavedSource.length <= MAX_STORED_SOURCE_LENGTH
          ? storedSavedSource
          : canonicalSource;
      const restoredSavedSource = experiment
        ? ensureExperimentHeader(experiment, persistedSavedSource)
        : persistedSavedSource;
      if (
        document.kind === "example" &&
        document.id === defaultBeginnerExample.id &&
        restoredSource === defaultBeginnerExample.source &&
        restoredSavedSource === defaultBeginnerExample.source
      ) {
        return true;
      }

      setActiveDocument(document);
      setCode(restoredSource);
      setSavedSource(restoredSavedSource);
      setAssembly(null);
      setDirty(restoredSource !== canonicalSource);
      setRunning(false);
      setTrace([]);
      clearInsight();
      setBreakpointLines(new Set());
      if (experiment) {
        const experimentIndex = labExperiments.findIndex(
          (candidate) => candidate.number === experiment.number,
        );
        setExperimentPage(
          Math.max(0, Math.floor(experimentIndex / EXPERIMENTS_PER_PAGE)),
        );
      }
      cpu.reset(true, true);
      cpu.setRegister("PC", 0x2000);
      syncMachine();
      setStatusMessage(
        restoredSource === restoredSavedSource
          ? `${
              experiment
                ? `Experiment ${formatExperimentNumber(experiment.number)}`
                : example
                  ? "Example"
                  : "Program"
            } restored. Assemble it before running.`
          : "Restored your unsaved work. Assemble it before running.",
      );
      return true;
    };

    const readStorageItem = (key: string): string | null => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    };

    let restored = false;
    const savedSession = readStorageItem(SESSION_STORAGE_KEY);
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession) as {
          version?: unknown;
          activeDocument?: unknown;
          code?: unknown;
          savedSource?: unknown;
        };
        const storedDocument =
          parsed.activeDocument !== null &&
          typeof parsed.activeDocument === "object"
            ? (parsed.activeDocument as Record<string, unknown>)
            : null;
        if (
          parsed.version === 2 &&
          typeof parsed.code === "string" &&
          storedDocument?.kind === "example" &&
          typeof storedDocument.id === "string"
        ) {
          restored = restoreDocument(
            { kind: "example", id: storedDocument.id },
            parsed.code,
            typeof parsed.savedSource === "string"
              ? parsed.savedSource
              : undefined,
          );
        } else if (
          parsed.version === 2 &&
          typeof parsed.code === "string" &&
          storedDocument?.kind === "experiment" &&
          Number.isSafeInteger(storedDocument.number)
        ) {
          restored = restoreDocument(
            { kind: "experiment", number: Number(storedDocument.number) },
            parsed.code,
            typeof parsed.savedSource === "string"
              ? parsed.savedSource
              : undefined,
          );
        } else if (
          parsed.version === 2 &&
          typeof parsed.code === "string" &&
          storedDocument?.kind === "scratch"
        ) {
          restored = restoreDocument(
            { kind: "scratch" },
            parsed.code,
            typeof parsed.savedSource === "string"
              ? parsed.savedSource
              : undefined,
          );
        }
      } catch {
        restored = false;
      }
    }

    if (!savedSession && !restored) {
      const legacySource = readStorageItem(LEGACY_SOURCE_STORAGE_KEY);
      if (
        legacySource &&
        legacySource !== defaultBeginnerExample.source
      ) {
        restoreDocument(
          { kind: "scratch" },
          legacySource,
        );
      }
    }
    const readyTimer = window.setTimeout(() => setStorageReady(true), 0);
    return () => window.clearTimeout(readyTimer);
  }, [clearInsight, cpu, syncMachine]);

  useEffect(() => {
    if (
      !storageReady ||
      code.length > MAX_STORED_SOURCE_LENGTH ||
      savedSource.length > MAX_STORED_SOURCE_LENGTH
    ) {
      return;
    }
    try {
      window.localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ version: 2, activeDocument, code, savedSource }),
      );
    } catch {
      // The editor remains usable when private browsing or quota blocks storage.
    }
  }, [activeDocument, code, savedSource, storageReady]);

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

  const confirmProgramReplacement = (nextLabel: string): boolean => {
    if (!hasUserEdits) return true;
    const confirmed = window.confirm(
      `Open ${nextLabel}? This replaces the current editor text. Export your .asm file first if you want to keep these edits.`,
    );
    if (!confirmed) setStatusMessage("Current program kept.");
    return confirmed;
  };

  const chooseExample = (id: string) => {
    if (!id) return;
    const example = examples8085.find((candidate) => candidate.id === id);
    if (!example) {
      setStatusMessage("That solved example is no longer available.");
      return;
    }
    if (activeDocument.kind === "example" && activeDocument.id === id) return;
    if (!confirmProgramReplacement(`the example “${example.title}”`)) return;

    setRunning(false);
    setActiveDocument({ kind: "example", id: example.id });
    setCode(example.source);
    setSavedSource(example.source);
    setBreakpointLines(new Set());
    setDirty(true);
    assembleProgram(example.source, example);
    setMemoryBaseText("2000");
    setMemoryBase(0x2000);
    window.requestAnimationFrame(() => editorRef.current?.focus());
  };

  const chooseExperiment = (number: number) => {
    const experiment = labExperiments.find(
      (candidate) => candidate.number === number,
    );
    if (!experiment) {
      setStatusMessage("That experiment is no longer published.");
      return;
    }
    if (
      activeDocument.kind === "experiment" &&
      activeDocument.number === number
    ) {
      return;
    }
    if (
      !confirmProgramReplacement(
        `Experiment ${formatExperimentNumber(experiment.number)}`,
      )
    ) {
      return;
    }

    const source = createExperimentHeader(experiment);
    setRunning(false);
    setActiveDocument({ kind: "experiment", number: experiment.number });
    setCode(source);
    setSavedSource(source);
    setAssembly(null);
    setTrace([]);
    clearInsight();
    setBreakpointLines(new Set());
    setDirty(false);
    skipBreakpointOnceRef.current = null;
    cpu.reset(true, true);
    cpu.setRegister("PC", 0x2000);
    setMemoryBaseText("2000");
    setMemoryBase(0x2000);
    setStatusMessage(
      `Experiment ${formatExperimentNumber(experiment.number)} opened. Write the complete program below the header.`,
    );
    syncMachine();
    window.requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.setSelectionRange(source.length, source.length);
    });
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
    clearInsight();
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
    clearInsight();
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

  const updateConverterField = (
    field: ByteConverterField,
    rawValue: string,
  ) => {
    const parsed = parseByteInput(field, rawValue);
    if (parsed === null) return;
    if (parsed.value === null) {
      setConverterFields((current) => ({ ...current, [field]: "" }));
      return;
    }

    setConverterValue(parsed.value);
    setConverterFields({
      ...formatByteFields(parsed.value),
      [field]: parsed.text,
    });
  };

  const normalizeConverterFields = () => {
    setConverterFields(formatByteFields(converterValue));
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
    clearInsight();
    setRenderTick((current) => current + 1);
    setStatusMessage(
      `Input port 02H is now ${hex(cpu.ports[0x02], 2)}H.`,
    );
  };

  const downloadSource = () => {
    const normalizedSource = code.replace(/\r\n?/g, "\n");
    const exportSource = selectedExperiment
      ? ensureExperimentHeader(selectedExperiment, normalizedSource)
      : normalizedSource;
    const headerWasRestored =
      Boolean(selectedExperiment) && exportSource !== normalizedSource;
    const blob = new Blob([exportSource], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = selectedExperiment
      ? createExperimentFilename(selectedExperiment)
      : `${selectedExample?.id ?? "program"}.asm`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    if (exportSource !== code) {
      setCode(exportSource);
      setDirty(true);
      setBreakpointLines(new Set());
      clearInsight();
    }
    setSavedSource(exportSource);
    setStatusMessage(
      `${link.download} exported${headerWasRestored ? " with the required header restored" : ""}.`,
    );
  };

  const statusTone: StatusTone = running
    ? "running"
    : assembly && !assembly.success
      ? "error"
      : snapshot.halted
        ? "halted"
        : assembly?.success && !dirty && !hasUserEdits
          ? "ready"
          : "idle";
  const outputPort = cpu.ports[0x01];
  const inputPort = cpu.ports[0x02];
  const flagByte = packFlagRegister(snapshot.flags);
  const flagBinary = flagByte.toString(2).padStart(8, "0");
  const flagBits: ReadonlyArray<{
    bit: number;
    shortLabel: string;
    value: boolean;
    flag?: FlagKey;
    constant?: boolean;
  }> = [
    {
      bit: 7,
      shortLabel: "S",
      value: snapshot.flags.s,
      flag: "s",
    },
    {
      bit: 6,
      shortLabel: "Z",
      value: snapshot.flags.z,
      flag: "z",
    },
    {
      bit: 5,
      shortLabel: "UNUSED",
      value: false,
      constant: true,
    },
    {
      bit: 4,
      shortLabel: "AC",
      value: snapshot.flags.ac,
      flag: "ac",
    },
    {
      bit: 3,
      shortLabel: "UNUSED",
      value: false,
      constant: true,
    },
    {
      bit: 2,
      shortLabel: "P",
      value: snapshot.flags.p,
      flag: "p",
    },
    {
      bit: 1,
      shortLabel: "FIX",
      value: true,
      constant: true,
    },
    {
      bit: 0,
      shortLabel: "CY",
      value: snapshot.flags.cy,
      flag: "cy",
    },
  ];
  void renderTick;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="sr-only">Open8085 Lab</span>
          <div className="brand-mark">
            <span>OPEN</span>
            <strong>8085</strong>
          </div>
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-tagline">
            <strong>IITRAM</strong>
            <span className="brand-department">Dept. of ECSE</span>
          </span>
        </div>
        <div className="topbar-meta">
          <span className="author-credit">
            Designed by <strong>D. Joshi</strong>
          </span>
          <span className="equipment-id">Intel 8085A · 8-bit</span>
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => setReferenceOpen(true)}
          >
            <BookOpen size={14} strokeWidth={1.8} aria-hidden="true" />
            Opcodes
          </button>
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
                    : hasUserEdits
                      ? "Unsaved"
                    : "Ready"}
          </span>
        </div>
      </header>

      <nav
        className={`command-bar ${running ? "is-running" : ""}`}
        aria-label="Simulator controls"
        aria-busy={running}
      >
        <div className="library-controls">
          <div className="command-group samples">
            <span className="field-label">Examples</span>
            <select
              className="select-control example-select"
              value={
                activeDocument.kind === "example" ? activeDocument.id : ""
              }
              onChange={(event) => chooseExample(event.target.value)}
              aria-label="Choose a solved example"
            >
              <option value="" disabled>
                Choose a solved example…
              </option>
              {examples8085.map((example) => (
                <option key={example.id} value={example.id}>
                  {example.title}
                </option>
              ))}
            </select>
          </div>
          <div className="command-group experiments">
            <span className="field-label">Experiments</span>
            <select
              className={`select-control experiment-select ${
                selectedExperiment ? "active" : ""
              }`}
              value={selectedExperimentValue}
              onChange={(event) =>
                chooseExperiment(Number(event.target.value))
              }
              aria-label={`Choose a lab experiment from ${experimentRangeLabel}`}
            >
              <option value="" disabled>
                {selectedExperiment
                  ? `Open ${formatExperimentNumber(selectedExperiment.number)} · ${selectedExperiment.aim}`
                  : "Select from this group…"}
              </option>
              {visibleExperiments.map((experiment) => (
                <option
                  key={experiment.number}
                  value={experiment.number}
                >
                  {formatExperimentNumber(experiment.number)} · {experiment.aim}
                </option>
              ))}
            </select>
            <button
              className="btn btn-icon experiment-nav"
              type="button"
              disabled={safeExperimentPage === 0}
              onClick={() =>
                setExperimentPage(Math.max(0, safeExperimentPage - 1))
              }
              aria-label="Show the previous 10 experiments"
              title="Previous 10 experiments"
            >
              <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <output
              className="experiment-range"
              aria-label={`Experiment list positions ${experimentRangeLabel}`}
              aria-live="polite"
              title="List positions on this page"
            >
              {experimentRangeLabel}
            </output>
            <button
              className="btn btn-icon experiment-nav"
              type="button"
              disabled={safeExperimentPage >= experimentPageCount - 1}
              onClick={() =>
                setExperimentPage(
                  Math.min(experimentPageCount - 1, safeExperimentPage + 1),
                )
              }
              aria-label="Show the next 10 experiments"
              title="Next 10 experiments"
            >
              <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="command-spacer" />
        <div className="execution-controls">
          <div className="command-group actions">
            <button
              className="btn"
              type="button"
              onClick={() => assembleProgram()}
              title="Assemble (Ctrl+Enter)"
            >
              <Hammer size={14} strokeWidth={1.8} aria-hidden="true" />
              Assemble
            </button>
            <button
              className={`btn btn-primary ${running ? "is-running" : ""}`}
              type="button"
              onClick={toggleRun}
              title="Run or pause (F8)"
            >
              {running ? (
                <Pause size={15} fill="currentColor" aria-hidden="true" />
              ) : (
                <Play size={15} fill="currentColor" aria-hidden="true" />
              )}
              {running ? "Pause" : "Run"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={stepOnce}
              disabled={running}
              title="Execute one instruction (F10)"
            >
              <StepForward size={14} strokeWidth={1.8} aria-hidden="true" />
              Step
            </button>
            <button
              className="btn btn-danger"
              type="button"
              onClick={resetMachine}
              title="Reset processor (Shift+F5)"
            >
              <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />
              Reset
            </button>
          </div>
          <div className="speed-control">
            <span className="field-label">Speed</span>
            <div
              className="speed-segments"
              role="group"
              aria-label="Execution speed"
            >
              {SPEEDS.map((speed, index) => (
                <button
                  className={`speed-segment ${
                    speedIndex === index ? "active" : ""
                  }`}
                  type="button"
                  key={speed}
                  onClick={() => setSpeedIndex(index)}
                  aria-pressed={speedIndex === index}
                  title={`${speed.toLocaleString()} instructions per second`}
                >
                  {speed}
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      <main className="workspace">
        <section className="panel editor-panel" aria-label="Assembly editor">
          <div className="panel-heading">
            <h1 className="panel-title">
              <span className="file-kind">ASM</span>
              {editorFilename}
              {hasUserEdits && (
                <span className="dirty-mark" aria-label="Unsaved changes" />
              )}
            </h1>
            <div className="command-group">
              <span className="panel-note">
                Click a line number to add a breakpoint
              </span>
              <button className="btn btn-quiet" type="button" onClick={downloadSource}>
                <Download size={14} strokeWidth={1.8} aria-hidden="true" />
                Export
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
                clearInsight();
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
                  setRunning(false);
                  clearInsight();
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
            {assembly === null ? (
              <div className="build-summary">
                <strong>
                  {selectedExperiment ? "Ready for code" : "Assembly required"}
                </strong>
                <span>
                  {selectedExperiment
                    ? "Add the complete 8085 program below the two-line header."
                    : "Assemble the restored source before running."}
                </span>
              </div>
            ) : assembly.success ? (
              <div className="build-summary">
                <strong>{dirty ? "Source edited" : "Build successful"}</strong>
                <span>
                  {assembledByteCount} bytes · entry{" "}
                  {hex(assembly.entryPoint, 4)}H ·{" "}
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
              <h2 className="panel-title">Processor state</h2>
            </div>
            <div className="cpu-body">
              <div className="processor-registers">
                <div className="register-grid byte-register-grid">
                  {registerDefinitions.slice(0, 7).map((definition) => (
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

                <div className="register-grid pair-register-grid">
                  {registerDefinitions.slice(7, 11).map((definition) => (
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

                <div
                  className="flag-register"
                  role="group"
                  aria-label={`Flag Register F, hexadecimal ${hex(
                    flagByte,
                  )}H, binary ${flagBinary}B. Sign ${Number(
                    snapshot.flags.s,
                  )}, Zero ${Number(
                    snapshot.flags.z,
                  )}, bit 5 unused and zero, Auxiliary Carry ${Number(
                    snapshot.flags.ac,
                  )}, bit 3 unused and zero, Parity ${Number(
                    snapshot.flags.p,
                  )}, bit 1 fixed one, Carry ${Number(snapshot.flags.cy)}.`}
                >
                  <div className="flag-register-heading">
                    <span className="field-label">Flag register</span>
                    <strong>
                      F = {hex(flagByte)}H <span aria-hidden="true">·</span>{" "}
                      {flagBinary}B
                    </strong>
                  </div>
                  <div className="flag-byte-grid" aria-hidden="true">
                    {flagBits.map((entry) => (
                      <span
                        className={[
                          "flag-bit",
                          entry.value ? "on" : "",
                          entry.constant ? "flag-bit--constant" : "",
                          entry.flag && changedFlags.has(entry.flag)
                            ? "changed"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={entry.bit}
                      >
                        <span className="flag-position">D{entry.bit}</span>
                        <span className="flag-name">{entry.shortLabel}</span>
                        <strong>{Number(entry.value)}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="processor-rail">
                <label
                  className={`register pc-register ${
                    changedRegisters.has("pc") ? "changed" : ""
                  }`}
                >
                  <span className="register-label">PC</span>
                  <input
                    className="register-input"
                    key={`PC-${snapshot.pc}`}
                    defaultValue={hex(snapshot.pc, 4)}
                    maxLength={4}
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={(event) =>
                      editRegister("PC", event.currentTarget.value, 4)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    aria-label="Program Counter register in hexadecimal"
                  />
                </label>
                <div className="cycles-card">
                  <span className="field-label">Total T-states</span>
                  <span className="cycles-number">
                    {snapshot.totalCycles.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="panel insight-panel" aria-labelledby="insight-title">
            <div className="insight-heading">
              <h2 className="panel-title" id="insight-title">
                Insight
              </h2>
            </div>
            <div
              className="insight-content"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {insight ? (
                <>
                  <div className="insight-row insight-purpose">
                    <code>[{insight.instruction}]</code>
                    <span>{insight.purpose}</span>
                  </div>
                  <div className="insight-row">
                    <strong>Action:</strong>
                    <span>{insight.action}</span>
                  </div>
                  <div className="insight-row">
                    <strong>Effect:</strong>
                    <span>{insight.effect}</span>
                  </div>
                </>
              ) : (
                <p className="insight-empty">
                  Step the program to see instruction insight.
                </p>
              )}
            </div>
          </section>

          <section className="panel inspector-panel">
            <div className="panel-heading">
              <h2 className="panel-title">Machine dock</h2>
              <div className="tabs" role="tablist" aria-label="Inspect data">
                {(["memory", "trace", "io"] as const).map((tab) => (
                  <button
                    className={`tab ${inspectorTab === tab ? "active" : ""}`}
                    type="button"
                    role="tab"
                    id={`tab-${tab}`}
                    aria-controls={`panel-${tab}`}
                    aria-selected={inspectorTab === tab}
                    key={tab}
                    onClick={() => setInspectorTab(tab)}
                  >
                    {tab === "io" ? (
                      "I/O"
                    ) : (
                      `${tab[0].toUpperCase()}${tab.slice(1)}`
                    )}
                  </button>
                ))}
              </div>
            </div>

            {inspectorTab === "memory" && (
              <div className="tab-panel" role="tabpanel" id="panel-memory" aria-labelledby="tab-memory">
                <div className="memory-toolbar">
                  <span className="memory-heading">
                    {MEMORY_ROWS * MEMORY_BYTES_PER_ROW} bytes from{" "}
                    {hex(memoryBase, 4)}H
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
                  {Array.from({ length: MEMORY_ROWS }, (_, row) => {
                    const rowAddress =
                      (memoryBase + row * MEMORY_BYTES_PER_ROW) & 0xffff;
                    return [
                      <span className="memory-row-label" key={`r-${row}`}>
                        {hex(rowAddress, 4)}
                      </span>,
                      ...Array.from(
                        { length: MEMORY_BYTES_PER_ROW },
                        (_, column) => {
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
                        },
                      ),
                    ];
                  })}
                </div>
                <div
                  className="number-converter"
                  aria-label="8-bit hexadecimal decimal binary converter"
                >
                  <div className="converter-heading">
                    <span className="converter-title">Number converter</span>
                    <span className="converter-note" id="converter-note">
                      8-bit · edit any field
                    </span>
                  </div>
                  <div className="converter-grid">
                    <label className="converter-field">
                      <span>Hex</span>
                      <input
                        className="converter-input"
                        value={converterFields.hex}
                        onChange={(event) =>
                          updateConverterField("hex", event.target.value)
                        }
                        onFocus={(event) => event.currentTarget.select()}
                        onBlur={normalizeConverterFields}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                        maxLength={2}
                        aria-describedby="converter-note"
                        aria-label="Hexadecimal byte value"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <label className="converter-field">
                      <span>Decimal</span>
                      <input
                        className="converter-input"
                        value={converterFields.decimal}
                        onChange={(event) =>
                          updateConverterField("decimal", event.target.value)
                        }
                        onFocus={(event) => event.currentTarget.select()}
                        onBlur={normalizeConverterFields}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                        inputMode="numeric"
                        maxLength={3}
                        aria-describedby="converter-note"
                        aria-label="Decimal byte value"
                        autoComplete="off"
                      />
                    </label>
                    <label className="converter-field">
                      <span>Binary</span>
                      <input
                        className="converter-input"
                        value={converterFields.binary}
                        onChange={(event) =>
                          updateConverterField("binary", event.target.value)
                        }
                        onFocus={(event) => event.currentTarget.select()}
                        onBlur={normalizeConverterFields}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                        inputMode="numeric"
                        maxLength={8}
                        aria-describedby="converter-note"
                        aria-label="Binary byte value"
                        autoComplete="off"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {inspectorTab === "trace" && (
              <div className="tab-panel" role="tabpanel" id="panel-trace" aria-labelledby="tab-trace">
                {trace.length ? (
                  <div className="trace-list">
                    {trace.map((entry, index) => (
                      <div
                        className={`trace-row ${index === 0 && !running ? "latest" : ""}`}
                        key={`${entry.totalCycles}-${entry.pc}`}
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
              <div className="tab-panel" role="tabpanel" id="panel-io" aria-labelledby="tab-io">
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
                            clearInsight();
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

          <section className="panel trainer-panel" aria-label="Virtual I/O board">
            <div className="panel-heading">
              <h2 className="panel-title">
                Virtual I/O board
                <span className="sr-only">Virtual trainer kit</span>
              </h2>
              <span className="panel-note">OUT 01H · IN 02H</span>
            </div>
            <div className="trainer-body">
              <div className="trainer-module">
                <div className="module-title">
                  <span>Output · Port 01H</span>
                  <span className="module-port">
                    {hex(outputPort, 2)}H
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
                        <span className="bit-label">D{bit}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="trainer-module">
                <div className="module-title">
                  <span>Input · Port 02H</span>
                  <span className="module-port">
                    {hex(inputPort, 2)}H
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
                        D{bit}
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
          {statusMessage}
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
                <X size={16} strokeWidth={1.8} aria-hidden="true" />
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
