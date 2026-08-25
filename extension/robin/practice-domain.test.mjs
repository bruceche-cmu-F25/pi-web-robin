import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { localDate } from "./dates.ts";
import { reviewDateFor } from "./practice.ts";
import {
  currentList,
  currentProblem,
  logAttempt,
  reschedule,
  setCurrentProblem,
  setNote,
  setPracticeList,
  setStatus,
  snapshot,
} from "./practice-domain.ts";
import { readPracticeRecords, writePracticeRecords, writePracticeState } from "./store.ts";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-practice-"));
process.env.ROBIN_DATA_DIR = dataDir;

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

beforeEach(() => {
  writePracticeRecords([]);
  writePracticeState({ currentSlug: undefined, list: undefined });
});

test("logging a solve creates the record and schedules the review", () => {
  const result = logAttempt({ problem: "Two Sum", outcome: "solved", minutes: 18 });

  assert.equal("error" in result, false);
  assert.equal(result.problem.link, "two-sum");
  assert.equal(result.record.status, "solved");
  assert.equal(result.record.attempts.length, 1);
  assert.equal(result.record.attempts[0].minutes, 18);
  assert.equal(result.record.confidence, 4);
  assert.equal(result.record.nextReviewOn, reviewDateFor(4, localDate()));
  assert.equal(readPracticeRecords().length, 1);
});

/**
 * The reason hintLevel is recorded at all: a solve that needed to be walked
 * most of the way there must come back sooner than one that did not.
 */
test("hints lower the inferred confidence and pull the review closer", () => {
  const cold = logAttempt({ problem: "two-sum", outcome: "solved" });
  writePracticeRecords([]);
  const walked = logAttempt({ problem: "two-sum", outcome: "solved", hintLevel: 4 });

  assert.equal(cold.record.confidence, 4);
  assert.equal(walked.record.confidence, 2);
  assert.ok(walked.record.nextReviewOn < cold.record.nextReviewOn);
});

test("a later bad sitting does not un-solve a problem, but does reschedule it", () => {
  logAttempt({ problem: "two-sum", outcome: "solved" });
  const stuck = logAttempt({ problem: "two-sum", outcome: "stuck" });

  assert.equal(stuck.record.status, "solved");
  assert.equal(stuck.record.attempts.length, 2);
  assert.equal(stuck.record.confidence, 1);
  assert.equal(stuck.record.nextReviewOn, reviewDateFor(1, localDate()));
});

test("an unsolved attempt carries no review date", () => {
  const result = logAttempt({ problem: "two-sum", outcome: "partial" });
  assert.equal(result.record.status, "attempted");
  assert.equal(result.record.nextReviewOn, undefined);
});

test("attempt history is bounded", () => {
  for (let index = 0; index < 25; index += 1) {
    logAttempt({ problem: "two-sum", outcome: "partial" });
  }
  assert.equal(readPracticeRecords()[0].attempts.length, 20);
});

test("resetting to todo drops the schedule but keeps the note", () => {
  logAttempt({ problem: "two-sum", outcome: "solved", note: "Complement in a dict, one pass" });
  const reset = setStatus("two-sum", "todo");

  assert.equal(reset.record.status, "todo");
  assert.equal(reset.record.nextReviewOn, undefined);
  assert.equal(reset.record.confidence, undefined);
  assert.equal(reset.record.note, "Complement in a dict, one pass");
});

test("marking solved by hand schedules from the existing confidence", () => {
  logAttempt({ problem: "two-sum", outcome: "partial", confidence: 2 });
  const solved = setStatus("two-sum", "solved");
  assert.equal(solved.record.nextReviewOn, reviewDateFor(2, localDate()));
});

test("rescheduling a review moves the date without adding an attempt", () => {
  logAttempt({ problem: "two-sum", outcome: "solved" });
  const again = reschedule("two-sum", 5);

  assert.equal(again.record.attempts.length, 1);
  assert.equal(again.record.confidence, 5);
  assert.equal(again.record.nextReviewOn, reviewDateFor(5, localDate()));
});

test("an empty note clears the note", () => {
  setNote("two-sum", "  something  ");
  assert.equal(readPracticeRecords()[0].note, "something");
  setNote("two-sum", "   ");
  assert.equal(readPracticeRecords()[0].note, undefined);
});

test("unknown problems are refused rather than invented", () => {
  const result = logAttempt({ problem: "no-such-problem-anywhere", outcome: "solved" });
  assert.ok("error" in result);
  assert.match(result.error, /No problem in the NeetCode catalog/);
  assert.deepEqual(readPracticeRecords(), []);
});

/**
 * The coach's only route to "this problem": a cross-origin frame tells the
 * server nothing, so selection has to be written down as it happens.
 */
test("the open problem is what the coach reads back", () => {
  assert.equal(currentProblem(), null);

  setCurrentProblem("Valid Anagram");
  const open = currentProblem();
  assert.equal(open.problem.link, "valid-anagram");
  assert.equal(open.record, null);
  assert.equal(open.due, false);

  logAttempt({ problem: "valid-anagram", outcome: "solved", confidence: 1 });
  const afterSolve = currentProblem();
  assert.equal(afterSolve.record.status, "solved");
});

test("a snapshot reports a problem that is due today", () => {
  logAttempt({ problem: "two-sum", outcome: "solved", confidence: 1 });
  const tomorrow = reviewDateFor(1, localDate());
  const result = snapshot("two-sum", tomorrow);
  assert.equal(result.due, true);
});

/**
 * The rail and the coach have to agree on which list is being worked through,
 * or "what's left?" answers about a list the user is not looking at.
 */
test("the workspace list is mirrored for the coach to default to", () => {
  assert.equal(currentList(), "neetcode150");

  setPracticeList("blind75");
  assert.equal(currentList(), "blind75");

  // Opening a problem must not quietly reset the list along the way.
  setCurrentProblem("two-sum");
  assert.equal(currentList(), "blind75");
  assert.equal(currentProblem().problem.link, "two-sum");

  // …and naming one explicitly still moves it.
  setCurrentProblem("valid-anagram", "all");
  assert.equal(currentList(), "all");
});
