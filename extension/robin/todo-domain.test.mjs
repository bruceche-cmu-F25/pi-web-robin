process.env.TZ = "America/Los_Angeles";

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import {
  addTodo,
  chooseNextTodo,
  deleteTodo,
  reviewTodo,
  todoRevision,
  TodoConflictError,
  completeTodo,
  formatTodo,
  listTodos,
  updateTodo,
} from "./todo-domain.ts";

import { todoStatus } from "./todo-status.ts";
import { resetTaskStore } from "./task-store.test-support.mjs";
import { migrateTasksToSqlite } from "./task-migration.ts";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-todo-domain-"));
process.env.ROBIN_DATA_DIR = dataDir;
const todosFile = join(dataDir, "todos.json");

beforeEach(() => resetTaskStore(dataDir));

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

test("Todo interface owns listing, completion visibility, and tool formatting", () => {
  const { todo } = addTodo({
    title: "  Pay rent  ",
    due: "2026-08-15",
    url: "portal.example.com/rent",
  });

  assert.equal(todo.title, "Pay rent");
  assert.equal(todo.url, "https://portal.example.com/rent");
  assert.deepEqual(listTodos().todos.map(({ id }) => id), [todo.id]);
  assert.match(formatTodo(todo, "2026-08-14"), /due tomorrow/);

  const completed = completeTodo({ id: todo.id });
  assert.equal("error" in completed, false);
  assert.deepEqual(listTodos().todos, []);
  assert.deepEqual(
    listTodos({ includeDone: true }).todos.map(({ id }) => id),
    [todo.id],
  );
});

test("Todo stores and formats a validated multi-day range", () => {
  const { todo } = addTodo({
    title: "Write report",
    startDate: "2026-08-17",
    due: "2026-08-21",
  });

  assert.equal(todo.startDate, "2026-08-17");
  assert.equal(todo.due, "2026-08-21");
  assert.match(formatTodo(todo, "2026-08-16"), /2026-08-17 – 2026-08-21/);
  assert.throws(
    () => addTodo({ title: "No deadline", startDate: "2026-08-17" }),
    /due is required/,
  );
  assert.throws(
    () => updateTodo({ id: todo.id }, { due: "2026-08-16" }),
    /startDate cannot be after due/,
  );
  assert.equal(listTodos().todos[0].due, "2026-08-21");
});

test("Todo references reject ambiguity and prefer an explicit id", () => {
  const rent = addTodo({ title: "Pay rent" }).todo;
  addTodo({ title: "Pay parking" });

  const ambiguous = updateTodo({ title: "pay" }, { due: "2026-08-21" });
  assert.equal("error" in ambiguous, true);
  assert.match(ambiguous.error, /matches 2 todos/);

  const byId = updateTodo({ id: rent.id, title: "parking" }, { title: "Pay apartment rent" });
  assert.equal("error" in byId, false);
  assert.equal(byId.title, "Pay apartment rent");
  assert.deepEqual(updateTodo({}, { due: "2026-08-21" }), { error: "Provide either id or title." });
});

test("Todo updates clear optional fields and completion is idempotent", () => {
  const todo = addTodo({
    title: "Submit assignment",
    due: "2026-08-21",
    url: "canvas.cmu.edu",
  }).todo;
  const colored = updateTodo({ id: todo.id }, { color: " Plum " });
  assert.equal("error" in colored, false);
  assert.equal(colored.color, "plum");
  assert.throws(() => updateTodo({ id: todo.id }, { color: "red" }), /Unknown todo colour/);

  const cleared = updateTodo({ id: todo.id }, { due: "", url: "", color: "" });
  assert.equal("error" in cleared, false);
  assert.equal(cleared.due, undefined);
  assert.equal(cleared.url, undefined);
  assert.equal(cleared.color, undefined);

  const first = completeTodo({ id: todo.id });
  assert.equal("error" in first, false);
  const completedAt = first.todo.completedAt;
  const second = completeTodo({ id: todo.id });
  assert.equal("error" in second, false);
  assert.equal(second.alreadyDone, true);
  assert.equal(second.todo.completedAt, completedAt);
});

test("Todo listing preserves completed history, including legacy timestamps", () => {
  const now = Date.now();
  const rows = [
    { id: "open", title: "Open", done: false, createdAt: new Date(now - 30 * 86_400_000).toISOString() },
    { id: "recent", title: "Recent", done: true, createdAt: "", completedAt: new Date(now - 6 * 86_400_000).toISOString() },
    { id: "expired", title: "Expired", done: true, createdAt: "", completedAt: new Date(now - 8 * 86_400_000).toISOString() },
    { id: "legacy", title: "Legacy", done: true, createdAt: "not-a-date" },
  ];
  resetTaskStore(dataDir, rows);

  const original = readFileSync(todosFile, "utf8");
  assert.deepEqual(
    listTodos({ includeDone: true }).todos.map(({ id }) => id),
    ["open", "recent", "expired", "legacy"],
  );
  assert.equal(readFileSync(todosFile, "utf8"), original, "reading must never erase history");
});

test("Kanban workflow keeps completion, tools and existing checkbox writes in sync", () => {
  const todo = addTodo({ title: "Build board", due: "2026-11-01", url: "example.com/task" }).todo;
  assert.equal(todoStatus(todo), "todo");
  const doing = updateTodo({ id: todo.id }, { status: "doing" });
  assert.equal(doing.done, false);
  assert.equal(todoStatus(listTodos().todos[0]), "doing");
  assert.match(formatTodo(doing), /in progress/);
  assert.equal(doing.url, todo.url);
  assert.equal(doing.due, todo.due);

  const done = updateTodo({ id: todo.id }, { status: "done" });
  assert.equal(done.done, true);
  assert.ok(done.completedAt);
  assert.deepEqual(listTodos().todos, []);
  assert.equal(updateTodo({ id: todo.id }, { status: "done" }).completedAt, done.completedAt);

  const reopened = updateTodo({ id: todo.id }, { done: false });
  assert.equal(todoStatus(reopened), "todo");
  assert.equal(reopened.completedAt, undefined);
  updateTodo({ id: todo.id }, { status: "doing" });
  assert.equal(completeTodo({ id: todo.id }).todo.status, "done");
  const resumed = updateTodo({ id: todo.id }, { status: "doing" });
  assert.equal(resumed.done, false);
  assert.equal(resumed.completedAt, undefined);
  assert.equal(updateTodo({ id: todo.id }, { done: true }).status, "done");
});

test("Kanban accepts direct creation, derives legacy columns and rejects invalid writes atomically", () => {
  assert.equal(todoStatus({ done: false }), "todo");
  assert.equal(todoStatus({ done: true }), "done");
  assert.equal(todoStatus({ done: true, status: "doing" }), "done");
  assert.equal(addTodo({ title: "Started", status: "doing" }).todo.status, "doing");
  const done = addTodo({ title: "Finished", status: "done" }).todo;
  assert.equal(done.done, true);
  assert.ok(done.completedAt);
  const before = listTodos({ includeDone: true });
  assert.throws(() => addTodo({ title: "Bad", status: "blocked" }), /Unknown todo status/);
  assert.throws(() => updateTodo({ id: done.id }, { status: "blocked" }), /Unknown todo status/);
  assert.throws(() => updateTodo({ id: done.id }, { status: "doing", done: true }), /conflict/);
  assert.throws(() => updateTodo({ id: done.id }, { status: "doing", due: "invalid" }));
  assert.deepEqual(listTodos({ includeDone: true }), before);
});

test("task revisions reject stale edits/deletes/reviews under the write lock, without blocking unrelated changes", () => {
  const a = addTodo({ title: "First", due: "2030-05-15" }).todo;
  const b = addTodo({ title: "Second" }).todo;
  const ref = { id: a.id, revision: todoRevision([a]) };
  updateTodo({ id: b.id }, { title: "Changed elsewhere" });
  const updated = updateTodo(ref, { title: "Edited first" });
  assert.equal(updated.title, "Edited first");
  assert.equal(updated.due, a.due);
  assert.throws(() => updateTodo(ref, { status: "done", due: "" }), TodoConflictError);
  assert.throws(() => deleteTodo(ref), TodoConflictError);
  assert.throws(() => reviewTodo(ref, "abandon"), TodoConflictError);
  assert.throws(() => chooseNextTodo(ref, true), TodoConflictError);
  assert.deepEqual(listTodos().todos.find((todo) => todo.id === a.id), updated);
});

test("only one active task can be next, without changing dates or status; completion and abandonment clear it", () => {
  const a = addTodo({ title: "First", due: "2030-05-15" }).todo;
  const b = addTodo({ title: "Second", status: "doing" }).todo;
  assert.deepEqual(chooseNextTodo({ id: a.id }, true), { ...a, next: true });
  chooseNextTodo({ id: b.id }, true);
  assert.deepEqual(listTodos().todos.filter((todo) => todo.next).map((todo) => todo.id), [b.id]);
  completeTodo({ id: b.id });
  assert.equal(listTodos({ includeDone: true }).todos.some((todo) => todo.next), false);
  assert.throws(() => chooseNextTodo({ id: b.id }, true), /active task/);
  chooseNextTodo({ id: a.id }, true);
  reviewTodo({ id: a.id }, "abandon");
  assert.equal(listTodos({ includeArchived: true }).todos.find((todo) => todo.id === a.id).next, undefined);
  assert.throws(() => chooseNextTodo({ id: a.id }, true), /active task/);
  assert.throws(() => chooseNextTodo({ id: a.id }, "true"), /boolean/);
});

test("Todo listing surfaces damaged storage without replacing it", () => {
  const damaged = "{\"todos\":[]}\n";
  // An invalid legacy source must fail migration, never become an empty DB.
  rmSync(join(dataDir, "task-storage.json"), { force: true });
  rmSync(join(dataDir, "tasks.sqlite"), { force: true });
  writeFileSync(todosFile, damaged, "utf8");

  assert.throws(() => migrateTasksToSqlite(), /does not contain a JSON array/);
  assert.throws(() => listTodos({ includeDone: true }), /does not contain a JSON array/);
  assert.equal(readFileSync(todosFile, "utf8"), damaged);
});
