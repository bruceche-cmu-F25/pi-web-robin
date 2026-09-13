import assert from "node:assert/strict";
import test from "node:test";
import {
  activityByDay, activityWeeks, attemptResult, daysBetween, practiceStreak, previewAttempt, reviewForecast,
} from "./practice-tracking.ts";

const attempt = (on, outcome, hintLevel, confidence) => ({ at: `${on}T15:00:00Z`, on, outcome, hintLevel, confidence });
const record = (slug, attempts, extra = {}) => ({ slug, status: "solved", attempts, updatedAt: "2026-09-01T00:00:00Z", ...extra });

test("a sitting is independent only when it would count as a round", () => {
  assert.equal(attemptResult(attempt("2026-09-01", "solved", 0, 4)), "independent");
  assert.equal(attemptResult(attempt("2026-09-01", "solved", 0, 2)), "assisted");
  assert.equal(attemptResult(attempt("2026-09-01", "solved", 2, 4)), "assisted");
  assert.equal(attemptResult(attempt("2026-09-01", "solved", undefined, 4)), "assisted");
  assert.equal(attemptResult(attempt("2026-09-01", "partial", 1, 2)), "partial");
  assert.equal(attemptResult(attempt("2026-09-01", "stuck", 3, 1)), "stuck");
});

test("activity buckets by day and the streak survives an unstarted today", () => {
  const days = activityByDay([
    record("two-sum", [attempt("2026-09-08", "solved", 0, 4), attempt("2026-09-09", "solved", 0, 4)]),
    record("valid-anagram", [attempt("2026-09-09", "stuck", 3, 1)]),
  ]);
  assert.equal(days.get("2026-09-09").length, 2);
  assert.equal(practiceStreak(days, "2026-09-10"), 2);
  assert.equal(practiceStreak(days, "2026-09-09"), 2);
  assert.equal(practiceStreak(days, "2026-09-12"), 0);
});

test("activity weeks are Monday-first and stop at today", () => {
  const weeks = activityWeeks("2026-09-10", 3); // a Thursday
  assert.equal(weeks.length, 3);
  assert.equal(weeks[0][0], "2026-08-24");
  assert.deepEqual(weeks[2].slice(3), ["2026-09-10", null, null, null]);
  assert.equal(daysBetween("2026-09-10", "2026-09-13"), 3);
});

test("the forecast folds overdue reviews into today and ignores other lists", () => {
  const forecast = reviewForecast([
    record("a", [], { nextReviewOn: "2026-09-08" }),
    record("b", [], { nextReviewOn: "2026-09-10" }),
    record("c", [], { nextReviewOn: "2026-09-13" }),
    record("d", [], { nextReviewOn: "2026-10-30" }),
    record("e", [], { nextReviewOn: "2026-09-11" }),
    record("f", [], { status: "todo", nextReviewOn: "2026-09-11" }),
  ], (slug) => slug !== "e", "2026-09-10", 7);
  assert.equal(forecast.length, 7);
  assert.deepEqual(forecast[0], { date: "2026-09-10", slugs: ["b"], overdue: ["a"] });
  assert.deepEqual(forecast[3].slugs, ["c"]);
  assert.equal(forecast.flatMap((day) => day.slugs).length, 2);
});

test("the preview promises the schedule the write path will store", () => {
  const history = record("two-sum", [attempt("2026-09-01", "solved", 0, 4), attempt("2026-09-04", "solved", 0, 4)], { confidence: 4 });
  const cold = previewAttempt(history, "two-sum", { outcome: "solved", hintLevel: 0, confidence: 4 }, "2026-09-10");
  assert.deepEqual(cold, { nextReviewOn: "2026-09-17", roundsBefore: 2, roundsAfter: 3 });
  const helped = previewAttempt(history, "two-sum", { outcome: "solved", hintLevel: 2, confidence: 3 }, "2026-09-10");
  assert.deepEqual(helped, { nextReviewOn: "2026-09-11", roundsBefore: 2, roundsAfter: 2 });
  assert.equal(history.attempts.length, 2, "previewing never touches the real record");
  const first = previewAttempt(null, "valid-anagram", { outcome: "stuck", hintLevel: 3, confidence: 1 }, "2026-09-10");
  assert.equal(first.nextReviewOn, "2026-09-11");
});
