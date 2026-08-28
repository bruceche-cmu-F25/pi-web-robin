import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { claimJobs, deleteJob, dropJobs, scoreJob, updateJob } from "./job-domain.ts";
import { deleteLink, updateLink } from "./link-domain.ts";
import { addTodo, completeTodo, listTodos, updateTodo } from "./todo-domain.ts";
import { readJobs, readLinks, writeJobs, writeLinks } from "./store.ts";

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
  assert.equal(scoreJob({ id: "job-1", score: 4.5, reason: "Strong fit" }).job.score, 4.5);
  assert.equal(claimJobs(["job-1"]), 1);
  assert.equal(claimJobs(["job-1"]), 0, "a delivered job is claimed once");
  assert.equal(dropJobs(["job-1"]), 1);
  assert.equal(deleteJob("job-1")?.id, "job-1");
  assert.deepEqual(readJobs(), []);
});
