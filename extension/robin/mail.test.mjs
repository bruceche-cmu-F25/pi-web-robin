import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countReviewActions,
  groupByTriage,
  isMailCategory,
  normalizeAction,
  normalizeCategory,
  normalizeTriage,
  triageOf,
} from "./mail.ts";

test("category normalisation accepts the known set and falls back to other", () => {
  assert.equal(isMailCategory("interview"), true);
  assert.equal(isMailCategory("bogus"), false);
  assert.equal(normalizeCategory("interview"), "interview");
  assert.equal(normalizeCategory("  "), "other");
  assert.equal(normalizeCategory(undefined), "other");
});

test("action normalisation accepts none/todo/event/both and falls back to none", () => {
  assert.equal(normalizeAction("todo"), "todo");
  assert.equal(normalizeAction("both"), "both");
  assert.equal(normalizeAction("maybe"), "none");
  assert.equal(normalizeAction(undefined), "none");
});

test("countReviewActions tallies todos and events, and a both item counts in each", () => {
  const review = {
    day: "2026-08-17",
    reviewedAt: "2026-08-17T08:00:00.000Z",
    items: [
      { id: "a", threadId: "a", from: "", subject: "", snippet: "", date: "", category: "other", summary: "", action: "none" },
      { id: "b", threadId: "b", from: "", subject: "", snippet: "", date: "", category: "deadline", summary: "", action: "todo" },
      { id: "c", threadId: "c", from: "", subject: "", snippet: "", date: "", category: "appointment", summary: "", action: "event" },
      { id: "d", threadId: "d", from: "", subject: "", snippet: "", date: "", category: "interview", summary: "", action: "both" },
    ],
  };
  assert.deepEqual(countReviewActions(review), { todos: 2, events: 2 });
});

const item = (id, extra = {}) => ({ id, threadId: id, from: "", subject: "", snippet: "", date: "", category: "deadline", summary: "", action: "none", ...extra });

test("triageOf trusts a stored triage and infers one for older reviews", () => {
  assert.equal(triageOf(item("a", { triage: "fyi" })), "fyi");
  assert.equal(triageOf(item("b", { category: "other" })), "fyi");
  assert.equal(triageOf(item("c", { action: "todo" })), "tracked");
  assert.equal(triageOf(item("d")), "act");
  assert.equal(triageOf(item("e", { triage: "act", done: true })), "tracked");
  assert.equal(normalizeTriage("act"), "act");
  assert.equal(normalizeTriage("urgent"), undefined);
});

test("groupByTriage puts the soonest deadline first and keeps undated items in review order", () => {
  const groups = groupByTriage([
    item("late", { due: "2026-09-30" }),
    item("undated-1"),
    item("soon", { due: "2026-09-25" }),
    item("undated-2"),
    item("note", { category: "other" }),
  ]);
  assert.deepEqual(groups.act.map((entry) => entry.id), ["soon", "late", "undated-1", "undated-2"]);
  assert.deepEqual(groups.fyi.map((entry) => entry.id), ["note"]);
  assert.deepEqual(groups.tracked, []);
});

test("groupByTriage sinks handled items below the ones still tracked", () => {
  const groups = groupByTriage([
    item("handled", { action: "todo", due: "2026-09-20", done: true }),
    item("tracked", { action: "todo", due: "2026-09-30" }),
  ]);
  assert.deepEqual(groups.tracked.map((entry) => entry.id), ["tracked", "handled"]);
});
