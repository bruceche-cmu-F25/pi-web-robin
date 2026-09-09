import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays } from "./dates.ts";
import {
  practiceProgress, reviewDateFor, normalizePracticeRecord, dailyPracticePlan,
  problemsInList, recordMap, attemptDay, suggestNext,
} from "./practice.ts";

const today = "2026-09-08";
const problems = problemsInList("neetcode150");
const attempt = (on, patch = {}) => ({ at: `${on}T12:00:00Z`, on, outcome: "solved", hintLevel: 0, confidence: 4, ...patch });
const record = (slug, patch = {}) => ({ slug, status: "solved", updatedAt: "2026-09-01T12:00:00Z", attempts: [], ...patch });

test("six separate successful recalls expand 1/3/7/14/30/60 days and maintenance continues", () => {
  const history = record("two-sum");
  let on = today;
  for (const [index, days] of [1, 3, 7, 14, 30, 60, 60].entries()) {
    history.attempts.push(attempt(on));
    const progress = practiceProgress(history);
    assert.equal(progress.rounds, index + 1);
    const next = reviewDateFor(4, on, progress.stage);
    assert.equal(next, addDays(on, days));
    on = next;
  }
});

test("same-day repetition counts attempts but not extra independent rounds or spacing", () => {
  const history = record("two-sum", { attempts: Array.from({ length: 30 }, () => attempt(today)) });
  assert.deepEqual(practiceProgress(history), { attempts: 30, rounds: 1, stage: 1 });
});

test("hints, failure and low confidence reset spacing without erasing earlier rounds", () => {
  for (const weak of [{ hintLevel: 1 }, { outcome: "stuck" }, { outcome: "partial" }, { confidence: 2 }]) {
    const history = record("two-sum", { attempts: [attempt("2026-09-01"), attempt("2026-09-02"), attempt(today, weak)] });
    assert.deepEqual(practiceProgress(history), { attempts: 3, rounds: 2, stage: 0 });
    // Seeing a hint then retyping the answer does not qualify as cold recall.
    history.attempts.push(attempt(today));
    assert.equal(practiceProgress(history).rounds, 2);
  }
});

test("legacy histories are scheduled conservatively, without fabricating missing counts", () => {
  const legacy = record("two-sum", { nextReviewOn: "2026-11-01", confidence: 5 });
  const adapted = normalizePracticeRecord(legacy);
  assert.equal(adapted.nextReviewOn, "2026-09-02");
  assert.equal(practiceProgress(adapted).attempts, 0);
  assert.equal(practiceProgress(adapted).rounds, 0);
  assert.equal(legacy.nextReviewOn, "2026-11-01", "read adaptation is nonmutating");
  assert.deepEqual(normalizePracticeRecord(adapted), adapted);
  assert.equal(normalizePracticeRecord({ ...legacy, nextReviewOn: "2026-08-01" }).nextReviewOn, "2026-08-01");
  assert.equal(normalizePracticeRecord({ ...legacy, status: "attempted", nextReviewOn: undefined }).nextReviewOn, "2026-09-02");
  const paused = { ...legacy, status: "todo", nextReviewOn: undefined };
  assert.deepEqual(normalizePracticeRecord(paused), paused);
  assert.equal(practiceProgress(record("two-sum", { attempts: [attempt(today, { hintLevel: undefined })] })).rounds, 0);
});

test("daily plan starts with one new problem and never invents old reviews", () => {
  const plan = dailyPracticePlan(problems, recordMap([]), today);
  assert.equal(plan.newProblems.length, 1);
  assert.equal(plan.newProblems[0].link, problems[0].link);
  assert.deepEqual(plan.reviews, []);
  assert.equal(plan.roundTarget, 900);
});

test("daily review budget scopes the list and prioritizes overdue then weak records", () => {
  const records = problems.slice(0, 5).map((problem, index) => record(problem.link, {
    status: index === 3 ? "attempted" : "solved",
    nextReviewOn: index < 2 ? "2026-09-01" : "2026-09-07",
    confidence: index === 0 ? 4 : 1,
  }));
  records.push(record("not-in-catalog", { nextReviewOn: "2020-01-01" }));
  const plan = dailyPracticePlan(problems, recordMap(records), today);
  assert.equal(plan.reviews.length, 3);
  assert.equal(plan.dueCount, 5);
  assert.equal(plan.reviews[0].link, problems[1].link);
  assert.equal(plan.reviews[1].link, problems[0].link);
  assert.equal(plan.newProblems[0].link, problems[5].link);
  assert.equal(suggestNext(problems, recordMap(records), today).link, plan.reviews[0].link);
});

test("completed daily budgets do not refill on refresh, repeat clicks or tomorrow", () => {
  const records = problems.slice(0, 5).map((problem) => record(problem.link, {
    nextReviewOn: "2026-09-07", attempts: [attempt("2026-09-01")],
  }));
  for (const entry of records.slice(0, 3)) {
    entry.attempts.push(attempt(today), attempt(today));
    entry.nextReviewOn = "2026-09-11";
  }
  records.push(record(problems[5].link, { status: "attempted", attempts: [attempt(today, { kind: "new", outcome: "stuck" })], nextReviewOn: "2026-09-09" }));
  const plan = dailyPracticePlan(problems, recordMap(records), today);
  assert.equal(plan.newDone, 1);
  assert.equal(plan.reviewDone, 3);
  assert.deepEqual(plan.newProblems, []);
  assert.deepEqual(plan.reviews, []);
  assert.equal(plan.dueCount, 2);
  assert.deepEqual(dailyPracticePlan(problems, recordMap(records), today), plan);
  const tomorrow = dailyPracticePlan(problems, recordMap(records), "2026-09-09");
  assert.equal(tomorrow.newDone, 0);
  assert.equal(tomorrow.reviewDone, 0);
  assert.equal(tomorrow.reviews.length, 3);
  assert.equal(tomorrow.newProblems[0].link, problems[6].link);
});

test("reviewing a legacy status-only solve counts as a review, not new work", () => {
  const history = record(problems[0].link, { attempts: [attempt(today, { kind: "review" })], nextReviewOn: "2026-09-09" });
  const plan = dailyPracticePlan(problems, recordMap([history]), today);
  assert.equal(plan.newDone, 0);
  assert.equal(plan.reviewDone, 1);
  assert.equal(plan.newProblems.length, 1);
});

test("empty and exhausted lists still expose future maintenance reviews", () => {
  const records = recordMap(problems.map((problem) => record(problem.link, { nextReviewOn: "2026-09-09" })));
  const plan = dailyPracticePlan(problems, records, today);
  assert.deepEqual(plan.newProblems, []);
  assert.deepEqual(plan.reviews, []);
  assert.equal(plan.nextReviewOn, "2026-09-09");
  assert.equal(dailyPracticePlan([], records, today).roundTarget, 0);
});

test("recorded local days survive timezone changes; legacy timestamps use local dates", () => {
  const old = process.env.TZ;
  try {
    process.env.TZ = "America/Los_Angeles";
    const legacy = { at: "2026-09-09T01:00:00Z", outcome: "solved" };
    assert.equal(attemptDay(legacy), today);
    assert.equal(attemptDay({ ...legacy, on: "2026-09-09" }), "2026-09-09");
    assert.equal(reviewDateFor(4, "2026-03-07", 2), "2026-03-10", "DST is calendar arithmetic");
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});
