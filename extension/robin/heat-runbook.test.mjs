import assert from "node:assert/strict";
import test from "node:test";
import {
  CALL_SITES,
  COMMITTED_RUNS,
  DISCIPLINE,
  EDITS,
  FAILURES,
  PREREQS,
  REALITY,
  RUN_META,
  SEVERITIES,
  STEPS,
  UNKNOWNS,
} from "./heat-runbook.ts";

const bilinguals = [
  RUN_META.title, RUN_META.subtitle, RUN_META.framing,
  REALITY.title, REALITY.body, REALITY.goals,
  EDITS.headline, EDITS.body,
  DISCIPLINE.title, DISCIPLINE.body,
  ...PREREQS.flatMap((p) => [p.what, p.detail, ...(p.gotcha ? [p.gotcha] : [])]),
  ...COMMITTED_RUNS.map((r) => r.note),
  ...EDITS.rows.map((r) => r.why),
  ...STEPS.flatMap((s) => [s.title, s.expect, ...(s.watch ? [s.watch] : [])]),
  ...CALL_SITES.map((c) => c.perRecord),
  ...FAILURES.flatMap((f) => [f.symptom, f.cause, f.action]),
  ...UNKNOWNS,
];

test("both languages are present everywhere", () => {
  for (const value of bilinguals) {
    assert.ok(value.en.trim().length > 0, `empty en: ${JSON.stringify(value).slice(0, 60)}`);
    assert.ok(value.zh.trim().length > 0, `empty zh: ${JSON.stringify(value).slice(0, 60)}`);
  }
});

test("headings carry no backticks", () => {
  // These render as headings, outside CodeProse, so a backtick would reach the
  // page as a literal character rather than as code.
  const headings = [
    RUN_META.title, RUN_META.subtitle,
    REALITY.title, EDITS.headline, DISCIPLINE.title,
    ...PREREQS.map((p) => p.what),
    ...STEPS.map((s) => s.title),
    ...FAILURES.map((f) => f.symptom),
  ];
  for (const value of headings) {
    for (const text of [value.en, value.zh]) {
      assert.ok(!text.includes("`"), `backtick in a heading: ${text}`);
    }
  }
});

test("ids are unique within each list", () => {
  const lists = [
    ["prereqs", PREREQS], ["runs", COMMITTED_RUNS], ["edits", EDITS.rows],
    ["steps", STEPS], ["callSites", CALL_SITES], ["failures", FAILURES],
  ];
  for (const [name, list] of lists) {
    const ids = list.map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate id in ${name}`);
  }
});

test("the steps are numbered consecutively from one", () => {
  // The page's claim is that this is a procedure. A gap in the numbering means
  // a step was dropped without the ones after it being renumbered.
  assert.deepEqual(STEPS.map((s) => s.n), STEPS.map((_, i) => i + 1));
});

test("the first step costs nothing", () => {
  // Recomputing from the committed reports needs no API key, and putting it
  // anywhere but first would have the reader spending money before they can
  // tell whether they understand the metric.
  assert.equal(STEPS[0].id, "recompute");
  assert.equal(STEPS[0].command, undefined);
});

test("every edit and call site points at a line of the file", () => {
  for (const row of [...EDITS.rows, ...CALL_SITES]) {
    assert.match(row.ref, /^visualize\.py:\d+$/, `${row.id} has no usable reference`);
  }
});

test("every failure has a known severity and all three fields", () => {
  for (const row of FAILURES) {
    assert.ok(SEVERITIES.includes(row.severity), `unknown severity "${row.severity}" on ${row.id}`);
    for (const field of ["symptom", "cause", "action"]) {
      assert.ok(row[field].en.trim().length > 0, `${row.id} has no ${field}`);
    }
  }
});

test("the two committed runs carry the figures a budget needs", () => {
  // Token totals were read out of the committed summaries rather than
  // estimated; without them there is no basis for pricing a rerun.
  assert.equal(COMMITTED_RUNS.length, 2);
  for (const run of COMMITTED_RUNS) {
    assert.match(run.tokens, /^[\d,]+$/, `${run.id} has no token total`);
    assert.match(run.input, /\.json$/, `${run.id} has no input file`);
    assert.match(run.outputDir, /\/$/, `${run.id} has no output directory`);
  }
});
