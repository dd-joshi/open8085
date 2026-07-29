import assert from "node:assert/strict";
import test from "node:test";

import rawExperiments from "../lib/lab-experiments.json";
import {
  createExperimentFilename,
  createExperimentHeader,
  ensureExperimentHeader,
  formatExperimentNumber,
  labExperiments,
  paginateLabExperiments,
  validateLabExperiments,
  type LabExperiment,
} from "../lib/labExperiments.ts";

test("the supplied experiment catalog has the strict two-field schema", () => {
  const validated = validateLabExperiments(rawExperiments);

  assert.equal(validated.length, rawExperiments.length);
  assert.ok(validated.length > 0);
  assert.deepEqual(
    validated.map(({ number }) => number),
    [...validated.map(({ number }) => number)].sort(
      (left, right) => left - right,
    ),
  );

  for (const experiment of rawExperiments) {
    assert.deepEqual(Object.keys(experiment).sort(), ["aim", "number"]);
  }

  assert.equal(Object.isFrozen(labExperiments), true);
  assert.ok(labExperiments.every((experiment) => Object.isFrozen(experiment)));
});

test("validation sorts experiment numbers without requiring contiguity", () => {
  const validated = validateLabExperiments([
    { number: 9, aim: "Ninth experiment" },
    { number: 2, aim: "Second experiment" },
  ]);

  assert.deepEqual(
    validated.map(({ number }) => number),
    [2, 9],
  );
});

test("pagination exposes at most ten experiments and clamps edge pages", () => {
  const experiments = Array.from({ length: 23 }, (_, index) => ({
    number: index + 1,
    aim: `Experiment ${index + 1}`,
  }));

  const first = paginateLabExperiments(experiments, 0);
  assert.equal(first.page, 0);
  assert.equal(first.pageCount, 3);
  assert.equal(first.rangeStart, 1);
  assert.equal(first.rangeEnd, 10);
  assert.equal(first.items.length, 10);

  const middle = paginateLabExperiments(experiments, 1);
  assert.deepEqual(
    middle.items.map(({ number }) => number),
    [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  );

  const last = paginateLabExperiments(experiments, 99);
  assert.equal(last.page, 2);
  assert.equal(last.rangeStart, 21);
  assert.equal(last.rangeEnd, 23);
  assert.equal(last.items.length, 3);

  assert.equal(paginateLabExperiments(experiments, -4).page, 0);
  assert.throws(
    () => paginateLabExperiments(experiments, 0.5),
    /page must be a whole number/i,
  );
  assert.throws(
    () => paginateLabExperiments(experiments, 0, 0),
    /page size must be a positive whole number/i,
  );
});

test("validation rejects malformed experiment catalogs", () => {
  const tooLongAim = "A".repeat(301);
  const invalidCatalogs: ReadonlyArray<{
    name: string;
    value: unknown;
    message: RegExp;
  }> = [
    {
      name: "non-array root",
      value: { number: 1, aim: "Aim" },
      message: /JSON array/i,
    },
    {
      name: "empty catalog",
      value: [],
      message: /at least one experiment/i,
    },
    {
      name: "null row",
      value: [null],
      message: /entry 1.*object/i,
    },
    {
      name: "missing number",
      value: [{ aim: "Aim" }],
      message: /entry 1.*positive whole number/i,
    },
    {
      name: "missing aim",
      value: [{ number: 1 }],
      message: /entry 1.*aim must be text/i,
    },
    {
      name: "extra field",
      value: [{ number: 1, aim: "Aim", difficulty: "Easy" }],
      message: /entry 1.*unsupported field.*difficulty/i,
    },
    {
      name: "numeric string",
      value: [{ number: "01", aim: "Aim" }],
      message: /entry 1.*positive whole number/i,
    },
    {
      name: "zero number",
      value: [{ number: 0, aim: "Aim" }],
      message: /entry 1.*positive whole number/i,
    },
    {
      name: "fractional number",
      value: [{ number: 1.5, aim: "Aim" }],
      message: /entry 1.*positive whole number/i,
    },
    {
      name: "unsafe integer",
      value: [{ number: Number.MAX_SAFE_INTEGER + 1, aim: "Aim" }],
      message: /entry 1.*positive whole number/i,
    },
    {
      name: "number above supported range",
      value: [{ number: 1000, aim: "Aim" }],
      message: /entry 1.*1 to 999/i,
    },
    {
      name: "duplicate number",
      value: [
        { number: 1, aim: "First" },
        { number: 1, aim: "Second" },
      ],
      message: /entry 2.*number 1 is duplicated/i,
    },
    {
      name: "blank aim",
      value: [{ number: 1, aim: " \u00a0 " }],
      message: /entry 1.*cannot be empty/i,
    },
    {
      name: "multiline aim",
      value: [{ number: 1, aim: "First line\nORG 0000H" }],
      message: /entry 1.*one line/i,
    },
    {
      name: "Unicode line separator",
      value: [{ number: 1, aim: "First\u2028second" }],
      message: /entry 1.*one line/i,
    },
    {
      name: "C1 control",
      value: [{ number: 1, aim: "First\u0085second" }],
      message: /entry 1.*one line/i,
    },
    {
      name: "overlong aim",
      value: [{ number: 1, aim: tooLongAim }],
      message: /entry 1.*300 characters or fewer/i,
    },
    {
      name: "normalized duplicate aim",
      value: [
        { number: 1, aim: "Add two numbers" },
        { number: 2, aim: "  ADD   TWO NUMBERS  " },
      ],
      message: /entry 2.*aim is duplicated/i,
    },
  ];

  for (const fixture of invalidCatalogs) {
    assert.throws(
      () => validateLabExperiments(fixture.value),
      fixture.message,
      fixture.name,
    );
  }
});

test("experiment filenames use only a validated number", () => {
  const hostileAim = "../../CON\r\nmalicious title";

  assert.equal(formatExperimentNumber(1), "01");
  assert.equal(formatExperimentNumber(12), "12");
  assert.equal(
    createExperimentFilename({ number: 1, aim: hostileAim }),
    "EXP01.asm",
  );
  assert.equal(
    createExperimentFilename({ number: 105, aim: "Large number" }),
    "EXP105.asm",
  );

  for (const invalid of [
    0,
    -1,
    1.5,
    1000,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(
      () => formatExperimentNumber(invalid),
      /positive whole number/i,
    );
  }
});

test("experiment headers contain exactly two safe metadata lines", () => {
  const experiment: LabExperiment = {
    number: 1,
    aim: "  Add two 8-bit numbers  ",
  };

  assert.equal(
    createExperimentHeader(experiment),
    "; Experiment No: 01\n; Title: Add two 8-bit numbers\n\n",
  );
  assert.equal(
    createExperimentHeader({ number: 2, aim: "Cafe\u0301 values" }),
    "; Experiment No: 02\n; Title: Café values\n\n",
  );
  assert.throws(
    () =>
      createExperimentHeader({
        number: 1,
        aim: "Injected title\r\nORG 0000H",
      }),
    /one line/i,
  );
  assert.throws(
    () =>
      createExperimentHeader({
        number: 1,
        aim: "Injected\u2028title",
      }),
    /one line/i,
  );
});

test("exports keep one authoritative header without deleting student comments", () => {
  const experiment: LabExperiment = {
    number: 7,
    aim: "Test an 8-bit output program",
  };
  const header =
    "; Experiment No: 07\n; Title: Test an 8-bit output program\n\n";
  const body = "; Student observation\nMVI A,55H\nOUT 01H\nHLT\n";

  assert.equal(ensureExperimentHeader(experiment, body), `${header}${body}`);
  assert.equal(
    ensureExperimentHeader(experiment, `${header}${body}`),
    `${header}${body}`,
  );
  assert.equal(
    ensureExperimentHeader(
      experiment,
      `${header.replaceAll("\n", "\r\n")}${body.replaceAll("\n", "\r\n")}`,
    ),
    `${header}${body}`,
  );
  assert.equal(
    ensureExperimentHeader(
      experiment,
      `; Experiment No: 99\n; Title: Outdated title\n\n${body}`,
    ),
    `${header}${body}`,
  );

  const repaired = ensureExperimentHeader(
    experiment,
    `; Student preface\n; Experiment No: 99\n\n; Title: Outdated title\n\nMVI A,01H\n`,
  );
  assert.equal(repaired.match(/^; Experiment No:/gmu)?.length, 1);
  assert.equal(repaired.match(/^; Title:/gmu)?.length, 1);
  assert.match(repaired, /; Student preface/);
  assert.match(repaired, /MVI A,01H/);
});
