import rawExperiments from "./lab-experiments.json";

export interface LabExperiment {
  readonly number: number;
  readonly aim: string;
}

export interface LabExperimentPage {
  readonly page: number;
  readonly pageCount: number;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly items: readonly LabExperiment[];
}

const ALLOWED_FIELDS = new Set(["number", "aim"]);
const MAX_EXPERIMENTS = 200;
const MAX_EXPERIMENT_NUMBER = 999;
const MAX_AIM_LENGTH = 300;
// Control characters are intentionally rejected from untrusted catalog text.
// eslint-disable-next-line no-control-regex
const UNSAFE_AIM_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const EXPERIMENT_METADATA_LINE =
  /^;[ \t]*(?:Experiment No|Title):[^\n]*(?:\n|$)/gimu;

const entryError = (index: number, message: string): Error =>
  new Error(`lab-experiments.json entry ${index + 1}: ${message}`);

export const validateLabExperiments = (value: unknown): LabExperiment[] => {
  if (!Array.isArray(value)) {
    throw new Error("lab-experiments.json must contain a JSON array.");
  }

  if (value.length === 0) {
    throw new Error(
      "lab-experiments.json must contain at least one experiment.",
    );
  }

  if (value.length > MAX_EXPERIMENTS) {
    throw new Error(
      `lab-experiments.json supports at most ${MAX_EXPERIMENTS} experiments.`,
    );
  }

  const seenNumbers = new Set<number>();
  const seenAims = new Set<string>();
  const validated = value.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw entryError(index, "must be an object with number and aim.");
    }

    const record = item as Record<string, unknown>;
    const unsupported = Object.keys(record).filter(
      (field) => !ALLOWED_FIELDS.has(field),
    );
    if (unsupported.length) {
      throw entryError(
        index,
        `unsupported field${unsupported.length === 1 ? "" : "s"}: ${unsupported.join(", ")}.`,
      );
    }

    if (
      !Number.isSafeInteger(record.number) ||
      Number(record.number) < 1 ||
      Number(record.number) > MAX_EXPERIMENT_NUMBER
    ) {
      throw entryError(
        index,
        `number must be a positive whole number from 1 to ${MAX_EXPERIMENT_NUMBER}.`,
      );
    }
    const number = Number(record.number);
    if (seenNumbers.has(number)) {
      throw entryError(index, `experiment number ${number} is duplicated.`);
    }
    seenNumbers.add(number);

    if (typeof record.aim !== "string") {
      throw entryError(index, "aim must be text.");
    }
    const aim = record.aim.normalize("NFC").trim();
    if (!aim) {
      throw entryError(index, "aim cannot be empty.");
    }
    if (aim.length > MAX_AIM_LENGTH) {
      throw entryError(
        index,
        `aim must be ${MAX_AIM_LENGTH} characters or fewer.`,
      );
    }
    if (UNSAFE_AIM_CHARACTERS.test(aim)) {
      throw entryError(index, "aim must remain on one line.");
    }
    const comparableAim = aim.replace(/\s+/gu, " ").toLocaleLowerCase("en");
    if (seenAims.has(comparableAim)) {
      throw entryError(index, "aim is duplicated.");
    }
    seenAims.add(comparableAim);

    return Object.freeze({ number, aim });
  });

  return validated.sort((left, right) => left.number - right.number);
};

export const formatExperimentNumber = (number: number): string => {
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > MAX_EXPERIMENT_NUMBER
  ) {
    throw new Error(
      `Experiment number must be a positive whole number from 1 to ${MAX_EXPERIMENT_NUMBER}.`,
    );
  }
  return number.toString().padStart(2, "0");
};

export const createExperimentHeader = (experiment: LabExperiment): string => {
  const validated = validateLabExperiments([experiment])[0];
  return `; Experiment No: ${formatExperimentNumber(validated.number)}\n; Title: ${validated.aim}\n\n`;
};

export const ensureExperimentHeader = (
  experiment: LabExperiment,
  source: string,
): string => {
  const header = createExperimentHeader(experiment);
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  if (normalizedSource.startsWith(header)) return normalizedSource;
  const sourceWithoutOldHeader = normalizedSource.replace(
    EXPERIMENT_METADATA_LINE,
    "",
  );
  return `${header}${sourceWithoutOldHeader.replace(/^\n+/u, "")}`;
};

export const createExperimentFilename = (
  experiment: LabExperiment,
): string => `EXP${formatExperimentNumber(experiment.number)}.asm`;

export const paginateLabExperiments = (
  experiments: readonly LabExperiment[],
  requestedPage: number,
  pageSize = 10,
): LabExperimentPage => {
  if (!Number.isSafeInteger(requestedPage)) {
    throw new Error("Experiment page must be a whole number.");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error("Experiment page size must be a positive whole number.");
  }

  const pageCount = Math.max(1, Math.ceil(experiments.length / pageSize));
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  const startIndex = page * pageSize;
  const items = experiments.slice(startIndex, startIndex + pageSize);

  return {
    page,
    pageCount,
    rangeStart: experiments.length ? startIndex + 1 : 0,
    rangeEnd: Math.min(startIndex + pageSize, experiments.length),
    items,
  };
};

export const labExperiments = Object.freeze(
  validateLabExperiments(rawExperiments),
);
