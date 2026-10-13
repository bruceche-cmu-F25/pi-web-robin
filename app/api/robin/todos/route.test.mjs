import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST, PATCH, DELETE } = await jiti.import("./route.ts");
const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "robin-kanban-api-"));
process.env.ROBIN_DATA_DIR = directory;
after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});
beforeEach(() => writeFileSync(join(directory, "todos.json"), "[]"));
const request = (method, body, origin) => new Request("http://localhost:30141/api/robin/todos", {
  method,
  headers: { host: "localhost:30141", "content-type": "application/json", ...(origin ? { origin } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test("Kanban HTTP writes share the dashboard collection and preserve done compatibility", async () => {
  const created = await POST(request("POST", { title: "Board task", status: "doing" }));
  assert.equal(created.status, 200);
  const { todo } = await created.json();
  assert.equal(todo.status, "doing");
  assert.equal(todo.done, false);
  const completed = await PATCH(request("PATCH", { id: todo.id, status: "done" }));
  assert.equal(completed.status, 200);
  const response = await (await GET(request("GET"))).json();
  assert.equal(response.todos[0].done, true);
  assert.ok(response.todos[0].completedAt);
  const reopened = await (await PATCH(request("PATCH", { id: todo.id, done: false }))).json();
  assert.equal(reopened.todo.status, "todo");
  assert.equal(reopened.todo.completedAt, undefined);
});

test("HTTP revisions protect edits and deletions while legacy tools can still write", async () => {
  const { todo } = await (await POST(request("POST", { title: "Original", due: "2030-05-15" }))).json();
  assert.match(todo.revision, /^[a-f0-9]{64}$/);
  await PATCH(request("PATCH", { id: todo.id, done: true }));
  assert.equal((await PATCH(request("PATCH", { id: todo.id, revision: todo.revision, title: "Stale", status: "todo" }))).status, 409);
  assert.equal((await DELETE(request("DELETE", { id: todo.id, revision: todo.revision }))).status, 409);
  const latest = (await (await GET(request("GET"))).json()).todos[0];
  const saved = await (await PATCH(request("PATCH", { id: todo.id, revision: latest.revision, title: "Fresh" }))).json();
  assert.equal(saved.todo.done, true);
  assert.equal(saved.todo.due, todo.due);
  assert.equal(saved.todo.title, "Fresh");
  assert.equal((await PATCH(request("PATCH", { id: todo.id, revision: null, title: "Bad" }))).status, 400);
});

test("HTTP next-task selection is exclusive and validates the boundary", async () => {
  const a = (await (await POST(request("POST", { title: "A" }))).json()).todo;
  const b = (await (await POST(request("POST", { title: "B" }))).json()).todo;
  await PATCH(request("PATCH", { id: a.id, revision: a.revision, next: true }));
  await PATCH(request("PATCH", { id: b.id, revision: b.revision, next: true }));
  assert.deepEqual((await (await GET(request("GET"))).json()).todos.filter((todo) => todo.next).map((todo) => todo.id), [b.id]);
  assert.equal((await PATCH(request("PATCH", { id: a.id, next: "yes" }))).status, 400);
  assert.equal((await PATCH(request("PATCH", { id: a.id, next: true, status: "done" }))).status, 400);
});

test("invalid statuses and conflicting flags cannot mutate tasks, and origin checks remain active", async () => {
  const { todo } = await (await POST(request("POST", { title: "Keep me" }))).json();
  for (const status of ["blocked", "", 1, null, {}]) {
    assert.equal((await POST(request("POST", { title: "Invalid", status }))).status, 400);
    assert.equal((await PATCH(request("PATCH", { id: todo.id, status }))).status, 400);
  }
  assert.equal((await PATCH(request("PATCH", { id: todo.id, status: "doing", done: true }))).status, 400);
  assert.equal((await PATCH(request("PATCH", { id: todo.id, status: "doing" }, "https://evil.example"))).status, 403);
  assert.equal((await PATCH(request("PATCH", { id: "missing", status: "doing" }))).status, 404);
  assert.deepEqual((await (await GET(request("GET"))).json()).todos, [todo]);
});
