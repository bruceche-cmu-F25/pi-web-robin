import assert from "node:assert/strict";
import test from "node:test";
import {
  ARCH_META,
  BRANCHES,
  LABELS,
  LADDER,
  MATH,
  MODULES,
  MODULE_GROUPS,
  OBSERVATIONS,
  OFFLINE_STAGES,
  ONLINE_RULES,
  ORIENTATION,
  SEVERITIES,
  THESIS,
} from "./urrag-architecture.ts";

const bilinguals = [
  ARCH_META.title, ARCH_META.subtitle, ARCH_META.framing,
  ORIENTATION.title, ORIENTATION.body, ORIENTATION.soWhat,
  THESIS.title, THESIS.body,
  ...BRANCHES.flatMap((b) => [b.holds, b.note]),
  ...MODULES.flatMap((m) => [m.role, m.note]),
  ...OFFLINE_STAGES.flatMap((s) => [s.name, s.does]),
  ...LABELS.flatMap((l) => [l.meaning, l.why]),
  ...MATH.flatMap((f) => [f.label, f.gloss]),
  ...ONLINE_RULES.flatMap((r) => [r.rule, r.why]),
  ...LADDER.flatMap((r) => [r.name, r.reads]),
  ...OBSERVATIONS.flatMap((o) => [o.what, o.why]),
];

test("both languages are present everywhere", () => {
  for (const value of bilinguals) {
    assert.ok(value.en.trim().length > 0, `empty en: ${JSON.stringify(value).slice(0, 60)}`);
    assert.ok(value.zh.trim().length > 0, `empty zh: ${JSON.stringify(value).slice(0, 60)}`);
  }
});

test("headings carry no backticks", () => {
  // These fields render as headings and labels, outside CodeProse, so a
  // backtick would reach the page as a literal character rather than as code.
  const headings = [
    ARCH_META.title, ARCH_META.subtitle,
    ORIENTATION.title, THESIS.title,
    ...BRANCHES.map((b) => b.holds),
    ...MODULES.map((m) => m.role),
    ...OFFLINE_STAGES.map((s) => s.name),
    ...LABELS.map((l) => l.meaning),
    ...MATH.map((f) => f.label),
    ...ONLINE_RULES.map((r) => r.rule),
    ...LADDER.map((r) => r.name),
    ...OBSERVATIONS.map((o) => o.what),
  ];
  for (const value of headings) {
    for (const text of [value.en, value.zh]) {
      assert.ok(!text.includes("`"), `backtick in a heading: ${text}`);
    }
  }
});

test("ids are unique within each list", () => {
  const lists = [
    ["branches", BRANCHES], ["modules", MODULES], ["stages", OFFLINE_STAGES],
    ["labels", LABELS], ["math", MATH], ["rules", ONLINE_RULES],
    ["ladder", LADDER], ["observations", OBSERVATIONS],
  ];
  for (const [name, list] of lists) {
    const ids = list.map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate id in ${name}`);
  }
});

test("every module is filed under a known group", () => {
  for (const row of MODULES) {
    assert.ok(MODULE_GROUPS.includes(row.group), `unknown group "${row.group}" on ${row.id}`);
  }
});

test("every module names a path inside the source repository", () => {
  // A module row whose path cannot be opened is a description, not a map.
  for (const row of MODULES) {
    assert.match(row.path, /^(se_crc_rag|semantic_uncertainty|scripts|makefiles)\//, `${row.id} has no usable path`);
  }
});

test("the offline stages are numbered consecutively from one", () => {
  // The page's claim is that this is the order the makefile runs them in, so a
  // gap or a repeat in the numbering is a claim that is no longer true.
  assert.deepEqual(
    OFFLINE_STAGES.map((s) => s.step),
    OFFLINE_STAGES.map((_, index) => index + 1),
  );
});

test("the three labels are the three the collector writes", () => {
  // Section 3 is load-bearing: if a label is renamed upstream, this page is
  // quietly describing a schema that no longer exists.
  assert.deepEqual(LABELS.map((l) => l.name), ["fail_ret", "is_correct", "fail_gen"]);
});

test("every observation has a known severity and points somewhere", () => {
  for (const row of OBSERVATIONS) {
    assert.ok(SEVERITIES.includes(row.severity), `unknown severity "${row.severity}" on ${row.id}`);
    assert.ok(row.where.trim().length > 0, `${row.id} does not say where`);
  }
});

test("the ladder ends at the unified policy", () => {
  // The ablation is an argument with a conclusion; the last rung is it.
  assert.equal(LADDER.at(-1).id, "unified");
});
