process.env.TZ = "America/Los_Angeles";

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import {
  addTodo,
  completeTodo,
  formatTodo,
  listTodos,
  updateTodo,
} from "./todo-domain.ts";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-todo-domain-"));
process.env.ROBIN_DATA_DIR = dataDir;
const todosFile = join(dataDir, "todos.json");

beforeEach(() => writeFileSync(todosFile, "[]\n", "utf8"));

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

test("Todo listing prunes expired completions but retains malformed legacy timestamps", () => {
  const now = Date.now();
  const rows = [
    { id: "open", title: "Open", done: false, createdAt: new Date(now - 30 * 86_400_000).toISOString() },
    { id: "recent", title: "Recent", done: true, createdAt: "", completedAt: new Date(now - 6 * 86_400_000).toISOString() },
    { id: "expired", title: "Expired", done: true, createdAt: "", completedAt: new Date(now - 8 * 86_400_000).toISOString() },
    { id: "legacy", title: "Legacy", done: true, createdAt: "not-a-date" },
  ];
  writeFileSync(todosFile, `${JSON.stringify(rows)}\n`, "utf8");

  assert.deepEqual(
    listTodos({ includeDone: true }).todos.map(({ id }) => id),
    ["open", "recent", "legacy"],
  );
});

test("Todo listing surfaces damaged storage without replacing it", () => {
  const damaged = "{\"todos\":[]}\n";
  writeFileSync(todosFile, damaged, "utf8");

  assert.throws(() => listTodos({ includeDone: true }), /does not contain a JSON array/);
  assert.equal(readFileSync(todosFile, "utf8"), damaged);
});
