import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { claimJobs, deleteJob, dropJobs, scoreJob, updateJob } from "./job-domain.ts";
import { deleteLink, updateLink } from "./link-domain.ts";
import { mailBoard, markMailDone, saveMailReview } from "./mail-domain.ts";
import { addTodo, completeTodo, listTodos, updateTodo } from "./todo-domain.ts";
import { readJobs, readLinks, writeJobs, writeLinks, writeMailReview } from "./store.ts";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-domain-writes-"));
process.env.ROBIN_DATA_DIR = dataDir;

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

test("todo writes keep completion and update invariants behind one interface", () => {
  const { todo } = addTodo({ title: "Pay rent" });
  const updated = updateTodo({ id: todo.id }, {
    title: "Pay apartment rent",
    due: "2026-08-21",
    url: "portal.example.com/rent",
  });
  assert.equal("error" in updated, false);
  // A scheme-less host is normalized, since the dashboard renders it as an href.
  assert.equal(updated.url, "https://portal.example.com/rent");
  assert.throws(() => updateTodo({ id: todo.id }, { url: "javascript:alert(1)" }), /Unsupported URL scheme/);
  updateTodo({ id: todo.id }, { url: "" });
  const completed = completeTodo({ id: todo.id });
  assert.equal("error" in completed, false);
  assert.equal(completed.alreadyDone, false);
  assert.deepEqual(listTodos({ includeDone: true }).todos[0], completed.todo);
  assert.equal(completed.todo.title, "Pay apartment rent");
  assert.equal(completed.todo.due, "2026-08-21");
  assert.equal(completed.todo.url, undefined);
});

test("link writes preserve metadata while editing and cleanly delete", async () => {
  writeLinks([{ id: "pi", title: "Pi", url: "https://example.com/", group: "Apps", createdAt: "2026-08-01T00:00:00.000Z" }]);
  const link = await updateLink("pi", { title: "Pi Web", group: "Tools" });
  assert.deepEqual(link, readLinks()[0]);
  assert.equal(link.title, "Pi Web");
  assert.equal(deleteLink("pi")?.id, "pi");
  assert.deepEqual(readLinks(), []);
});

test("job writes share applied timestamps, scoring, notes and deletion", () => {
  writeJobs([{
    id: "job-1",
    url: "https://example.com/job/1",
    company: "Acme",
    title: "Engineer",
    location: "Remote",
    source: "test",
    discoveredAt: "2026-08-01T00:00:00.000Z",
    status: "new",
  }]);
  const applied = updateJob("job-1", { status: "applied", note: " referred " });
  assert.equal(applied.note, "referred");
  const appliedAt = applied.appliedAt;
  updateJob("job-1", { status: "new" });
  assert.equal(updateJob("job-1", { status: "applied" }).appliedAt, appliedAt);
  assert.equal(scoreJob({ id: "job-1", score: 3, reason: "Plausible fit" }).job.score, 3);
  assert.equal(claimJobs(["job-1"]), 1);
  assert.equal(claimJobs(["job-1"]), 0, "a delivered job is claimed once");
  assert.equal(dropJobs(["job-1"]), 1);
  assert.equal(deleteJob("job-1")?.id, "job-1");
  assert.deepEqual(readJobs(), []);
});

const mailItem = (id) => ({ id, threadId: id, from: "", subject: id, snippet: "", date: "", category: "oa", summary: "", action: "none", triage: "act" });

test("marking mail done moves it out of needs-you and survives a re-check", () => {
  saveMailReview([mailItem("m1"), mailItem("m2")]);
  const board = markMailDone("m1", true);
  assert.equal("error" in board, false);
  assert.deepEqual(board.review.items.map((item) => item.done ?? false), [true, false]);

  // The next check re-reads m1; the user's "done" is about the email, not the review.
  saveMailReview([mailItem("m1"), mailItem("m3")]);
  assert.deepEqual(mailBoard().review.items.map((item) => [item.id, item.done ?? false]), [["m1", true], ["m3", false]]);

  markMailDone("m1", false);
  assert.equal(mailBoard().review.items[0].done, undefined);
  assert.match(markMailDone("nope", true).error, /No email/);
});

test("a review from a past day is not today's, but the board still says when it ran", () => {
  writeMailReview({ day: "2020-01-01", reviewedAt: "2020-01-01T15:00:00.000Z", items: [mailItem("old")] });
  const board = mailBoard();
  assert.equal(board.review, null);
  assert.equal(board.lastReviewedAt, "2020-01-01T15:00:00.000Z");
  assert.match(markMailDone("old", true).error, /no review for today/);
});
