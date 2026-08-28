import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { addTodo, deleteTodo, listTodos } from "./todo-domain.ts";
import { registerTodoTools } from "./todo-tools.ts";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-todo-tools-"));
process.env.ROBIN_DATA_DIR = dataDir;

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

const tools = new Map();
registerTodoTools({ registerTool: (tool) => tools.set(tool.name, tool) });

beforeEach(() => {
  for (const todo of listTodos({ includeDone: true }).todos) deleteTodo({ id: todo.id });
});

function resultText(result) {
  return result.content[0].text;
}

test("todo_update edits a title and due date", async () => {
  const todo = addTodo({ title: "Pay rent" }).todo;

  const result = await tools.get("todo_update").execute("call", {
    id: todo.id,
    newTitle: "Pay apartment rent",
    due: "2026-08-21",
  });

  assert.match(resultText(result), /Updated/);
  const updated = listTodos().todos[0];
  assert.equal(updated.id, todo.id);
  assert.equal(updated.title, "Pay apartment rent");
  assert.equal(updated.due, "2026-08-21");
  assert.equal(updated.done, false);
});

test("todo_delete removes only the selected todo", async () => {
  addTodo({ title: "Pay rent" });
  const milk = addTodo({ title: "Buy milk" }).todo;

  const result = await tools.get("todo_delete").execute("call", { title: "rent" });

  assert.equal(resultText(result), "Deleted \"Pay rent\".");
  assert.deepEqual(listTodos().todos.map((todo) => todo.id), [milk.id]);
});
