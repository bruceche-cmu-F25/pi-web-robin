import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardAttention } from "./dashboard-attention.ts";

const today = "2030-05-12";
const now = new Date(`${today}T12:00:00`).getTime();
const round = (id, extra = {}) => ({ id, company: id, kind: "oa", status: "open", createdAt: "", updatedAt: "", ...extra });
const mail = (id, extra = {}) => ({ id, threadId: `thread-${id}`, subject: id, next: `Reply to ${id}`, summary: "Read and respond", category: "important", triage: "act", action: "none", ...extra });
const review = (items) => ({ day: today, reviewedAt: "", items });

test("only open, near-term rounds and today's actionable mail, earliest deadline first", () => {
  const result = dashboardAttention([
    round("overdue", { due: "2030-05-11" }), round("soon", { due: "2030-05-15" }),
    round("far", { due: "2030-05-20" }), round("done", { status: "done", due: today }),
    round("past-call", { kind: "interview", due: "2030-05-11T09:00:00" }),
    round("unknown"),
  ], review([mail("urgent", { due: today }), mail("fyi", { triage: "fyi" }), mail("handled", { done: true }), mail("tracked", { triage: "tracked" })]), [], today, now);
  assert.deepEqual(result.map((item) => item.id), ["round:overdue", "mail:urgent", "round:soon", "round:unknown"]);
  assert.equal(result[0].overdue, true);
  assert.equal(result[1].overdue, false, "A day-only deadline stays open until the end of the local day");
  assert.equal(result[2].href, "/dashboard/jobs#jobs-rounds");
});
test("known todo/round references deduplicate; titles alone never hide distinct work", () => {
  const result = dashboardAttention([
    round("tracked-round", { todoId: "task" }),
    round("call", { kind: "interview", threadId: "thread-invite", due: "2030-05-13" }),
    round("orphan", { todoId: "deleted-task" }),
  ], review([
    mail("invite", { category: "interview" }), mail("doc"), mail("other"), mail("created", { action: "todo" }),
  ]), [{ id: "task", title: "Tracked", done: false }, { id: "doc-task", title: "other", done: false, url: "https://mail.google.com/mail/u/0/#all/thread-doc" }], today, now);
  assert.deepEqual(new Set(result.map((item) => item.id)), new Set(["round:call", "round:orphan", "mail:other"]));
});
test("stale reviews are not today's work and same-day interviews without a time remain visible", () => {
  const result = dashboardAttention([round("today", { kind: "interview", due: today })],
    { ...review([mail("old")]), day: "2030-05-11" }, [], today, now);
  assert.deepEqual(result.map((item) => item.id), ["round:today"]);
});
test("empty inputs stay empty; mail links encode the actual thread identity", () => {
  assert.deepEqual(dashboardAttention([], null, [], today, now), []);
  const [item] = dashboardAttention([], review([mail("id", { threadId: "a/b?x", due: "2030-05-12T13:00:00" })]), [], today, now);
  assert.equal(item.href, "https://mail.google.com/mail/u/0/#all/a%2Fb%3Fx");
  assert.equal(item.overdue, false);
});
