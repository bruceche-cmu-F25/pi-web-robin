import assert from "node:assert/strict";
import test from "node:test";
import { jobBriefActions } from "./job-brief.ts";

const now = Date.parse("2026-11-08T20:00:00Z");
const rounds = [
  { id: "ab", kind: "oa", company: "Abridge", due: "2026-11-16", status: "open", todoId: "ab-todo" },
  { id: "p", kind: "interview", company: "Persona", due: "2026-11-13T22:00:00Z", status: "open" },
  { id: "past", kind: "interview", company: "Past", due: "2026-10-20T22:00:00Z", status: "open" },
  { id: "done", kind: "oa", company: "Done", due: "2026-11-10", status: "done" },
];
const todos = [
  { id: "ab-todo", title: "完成 Abridge OA", done: false },
  { id: "avi", title: "回复 Avi Asherov", done: false, url: "mailto:avi@example.com" },
  { id: "generic", title: "申请 CMU ChatGPT Edu", done: false },
];
const review = { items: [
  { id: "reminder", category: "oa", subject: "Abridge reminder", summary: "Finish", triage: "tracked" },
  { id: "reply", category: "important", subject: "Founding team opportunity", summary: "Reply Avi", from: "Avi <avi@example.com>", triage: "tracked", next: "回复 Avi 的问题" },
  { id: "alert", category: "other", subject: "Job recommendation", summary: "new job", triage: "fyi" },
  { id: "applied", category: "other", subject: "Job application receipt", summary: "Received", triage: "fyi" },
] };

test("job brief shows open rounds and actual replies, not reminders, receipts, closed or duplicate todos", () => {
  const rows = jobBriefActions(rounds, todos, review, now);
  assert.deepEqual(rows.map((row) => row.key), ["round:p", "round:ab", "mail:reply"]);
  assert.equal(rows[0].due, "2026-11-13T22:00:00Z");
  assert.equal(rows[2].href, "https://mail.google.com/mail/u/0/#all/reply");
});

test("an older unhandled recruiter todo remains visible after mail review expires", () => {
  assert.deepEqual(jobBriefActions([], todos, null, now).map((row) => row.key), ["todo:ab-todo", "todo:avi"]);
});

test("an overdue open OA is marked for verification; recommendations are not actions", () => {
  const rows = jobBriefActions([{ id: "late", kind: "oa", company: "Late", due: "2026-11-01", status: "open" }], [], review, now);
  assert.match(rows[0].title, /核实过期测评/);
  assert.deepEqual(rows.map((row) => row.key), ["round:late", "mail:reply"]);
});
