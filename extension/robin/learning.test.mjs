import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { FULLSTACK_STEPS, fullstackPlan, practicePlan, practiceHref } from "./learning.ts";
import { learningSnapshot, setFullstackCompleted } from "./learning-domain.ts";
import { logAttempt } from "./practice-domain.ts";
import { writePracticeRecords } from "./store.ts";

const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "robin-learning-"));
process.env.ROBIN_DATA_DIR = directory;
const progressFile = join(directory, "fullstack-open-progress.json");
after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});
beforeEach(() => {
  rmSync(progressFile, { force: true });
  writePracticeRecords([]);
});

test("a new learner starts at Part 0; reading the plan never saves or advances anything", () => {
  const first = learningSnapshot();
  assert.equal(first.fullstack.next.id, "/en/part0/general_info");
  assert.equal(first.fullstack.completed, 0);
  assert.deepEqual(learningSnapshot(), first);
  assert.equal(existsSync(progressFile), false);
});

test("explicit completion persists, is idempotent, and undo returns to the unfinished step", () => {
  const first = FULLSTACK_STEPS[0];
  const second = FULLSTACK_STEPS[1];
  setFullstackCompleted(first.id, true);
  assert.equal(learningSnapshot().fullstack.next.id, second.id);
  setFullstackCompleted(first.id, true);
  assert.equal(learningSnapshot().fullstack.completed, 1);
  assert.deepEqual(JSON.parse(readFileSync(progressFile)).completedIds, [first.id]);
  setFullstackCompleted(first.id, false);
  assert.equal(learningSnapshot().fullstack.next.id, first.id);
});

test("out-of-order completion cannot skip earlier unfinished work", () => {
  setFullstackCompleted(FULLSTACK_STEPS[2].id, true);
  assert.equal(learningSnapshot().fullstack.next.id, FULLSTACK_STEPS[0].id);
  assert.equal(learningSnapshot().fullstack.lastCompleted.id, FULLSTACK_STEPS[2].id);
});

test("reading, exercise, and part boundaries advance in course order", () => {
  const ids = [];
  for (const step of FULLSTACK_STEPS) {
    assert.equal(fullstackPlan(ids).next.id, step.id);
    ids.push(step.id);
  }
  assert.equal(fullstackPlan(ids).next, null);
  assert.equal(fullstackPlan(ids).completed, FULLSTACK_STEPS.length);
  assert.equal(FULLSTACK_STEPS[2].title, "0.1: HTML");
});

test("catalog identities and links are valid; advanced-course granularity is honest", () => {
  assert.equal(new Set(FULLSTACK_STEPS.map((step) => step.id)).size, FULLSTACK_STEPS.length);
  for (const step of FULLSTACK_STEPS) {
    assert.ok(step.title.trim());
    assert.equal(new URL(step.url).protocol, "https:");
    assert.ok(["fullstackopen.com", "courses.mooc.fi"].includes(new URL(step.url).hostname));
    if (step.part >= 8) assert.equal(step.kind, "course");
    assert.ok(!step.id.includes("legacy"));
  }
});

test("invalid writes and corrupt files never erase progress", () => {
  assert.throws(() => setFullstackCompleted("../../not-a-step", true), /Unknown/);
  assert.equal(existsSync(progressFile), false);
  writeFileSync(progressFile, '{"completedIds":"broken"}');
  assert.throws(() => learningSnapshot(), /Invalid/);
  assert.throws(() => setFullstackCompleted(FULLSTACK_STEPS[0].id, true), /Invalid/);
  assert.equal(readFileSync(progressFile, "utf8"), '{"completedIds":"broken"}');
});

test("new NeetCode work stays fixed over dates and failed attempts, advances on a solve", () => {
  const first = practicePlan([], "neetcode150", "2026-09-01").next;
  const partial = logAttempt({ problem: first.link, outcome: "partial" }).record;
  assert.equal(practicePlan([partial], "neetcode150", "2026-10-01").next.link, first.link);
  const solved = logAttempt({ problem: first.link, outcome: "solved" }).record;
  const records = [{ ...solved, nextReviewOn: "2026-09-02" }];
  const before = practicePlan(records, "neetcode150", "2026-09-01");
  const after = practicePlan(records, "neetcode150", "2026-09-03");
  assert.notEqual(before.next.link, first.link);
  assert.equal(after.next.link, before.next.link);
  assert.equal(before.review, null);
  assert.equal(after.review.link, first.link);
  assert.equal(after.stats.due, 1);
});

test("practice reuses saved records, scopes by list, and deep-links both list and problem", () => {
  const snapshot = learningSnapshot();
  logAttempt({ problem: snapshot.practice.next.link, outcome: "solved" });
  assert.equal(learningSnapshot().practice.stats.solved, 1);
  const blind = practicePlan([], "blind75", "2026-09-01");
  assert.equal(blind.stats.total, 75);
  assert.equal(new URL(practiceHref(blind.next.link, "blind75"), "https://local").searchParams.get("problem"), blind.next.link);
  assert.match(practiceHref(blind.next.link, "blind75"), /list=blind75/);
});

test("chapter summary and upcoming steps derive from the catalog and saved completions", () => {
  const initial = fullstackPlan([]);
  assert.equal(initial.currentPart.part, 0);
  assert.equal(initial.currentPart.total, 8);
  assert.deepEqual(initial.currentPart.byKind, [
    { kind: "reading", completed: 0, total: 2 },
    { kind: "exercise", completed: 0, total: 6 },
  ]);
  assert.deepEqual(initial.currentPart.topics, ["General info", "Fundamentals of Web apps"]);
  assert.deepEqual(initial.upcoming, FULLSTACK_STEPS.slice(1, 4));
  const ids = [FULLSTACK_STEPS[0].id, FULLSTACK_STEPS[2].id, FULLSTACK_STEPS[2].id, "unknown"];
  const plan = fullstackPlan(ids);
  assert.equal(plan.currentPart.completed, 2, "duplicates and unknown ids never inflate counts");
  assert.deepEqual(plan.currentPart.byKind.map((group) => group.completed), [1, 1]);
  assert.deepEqual(plan.upcoming, FULLSTACK_STEPS.slice(3, 6));
  assert.deepEqual(ids, [FULLSTACK_STEPS[0].id, FULLSTACK_STEPS[2].id, FULLSTACK_STEPS[2].id, "unknown"]);
});

test("preview crosses part boundaries, keeps migrated checkpoints honest, and ends cleanly", () => {
  const part0 = FULLSTACK_STEPS.filter((step) => step.part === 0);
  const nearEnd = fullstackPlan(part0.slice(0, -1).map((step) => step.id));
  assert.equal(nearEnd.currentPart.part, 0);
  assert.equal(nearEnd.currentPart.completed, 7);
  assert.equal(nearEnd.upcoming[0].part, 1);
  const nextPart = fullstackPlan(part0.map((step) => step.id));
  assert.equal(nextPart.currentPart.part, 1);
  assert.equal(nextPart.currentPart.completed, 0);
  const advanced = fullstackPlan(FULLSTACK_STEPS.filter((step) => step.part < 8).map((step) => step.id));
  assert.deepEqual(advanced.currentPart.byKind, [{ kind: "course", completed: 0, total: 1 }]);
  assert.deepEqual(advanced.currentPart.topics, ["GraphQL"]);
  const finished = fullstackPlan(FULLSTACK_STEPS.map((step) => step.id));
  assert.equal(finished.currentPart, null);
  assert.deepEqual(finished.upcoming, []);
});
