process.env.TZ = "America/Los_Angeles";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { createJiti } from "jiti";
import { addTodo, listTodos } from "../../../../extension/robin/todo-domain.ts";
import { DEFAULT_PLANNER, defaultSelection } from "../../../../extension/robin/planner.ts";
import { resetTaskStore } from "../../../../extension/robin/task-store.test-support.mjs";
const previous = process.env.ROBIN_DATA_DIR, agent = process.env.PI_CODING_AGENT_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-weekly-api-"));
process.env.ROBIN_DATA_DIR = dir; process.env.PI_CODING_AGENT_DIR = dir;
writeFileSync(join(dir, "assistant.mjs"), "export const runScopedAssistantTurn = (options) => globalThis.__weeklyTestAgent(options);");
const jiti = createJiti(import.meta.url, { alias: { "@/lib/robin-assistant": join(dir, "assistant.mjs"), "@": process.cwd() }, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
after(() => {
  delete globalThis.__weeklyTestAgent; rmSync(dir, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
  if (agent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = agent;
});
beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2030-05-13T15:00:00Z") }); resetTaskStore(dir);
  globalThis.__weeklyTestAgent = async (options) => {
    assert.deepEqual(options.toolNames, []); assert.equal(options.oneShot, true); assert.ok(options.signal);
    assert.equal(JSON.parse(options.message).today, "2030-05-13");
    return { reply: JSON.stringify({ tasks: [{ title: "Assignment", due: "2030-05-16", minutes: 120, continuous: false, estimated: true }], events: [], questions: [] }) };
  };
});
afterEach(() => mock.timers.reset());
const request = (method, body, headers = {}) => new Request("http://localhost:30141/api/robin/planner", { method, headers: { host: "localhost:30141", "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const post = (body, headers) => POST(request("POST", body, headers));

test("note -> reviewed capture -> deterministic preview -> explicit acceptance", async () => {
  const extraction = await post({ action: "extract", note: "Assignment due Thursday" });
  assert.equal(extraction.status, 200);
  const { capture } = await extraction.json();
  assert.equal(listTodos().todos.length, 0);
  const body = { action: "capture", capture, requestId: "c".repeat(32) };
  const captured = await post(body); assert.equal(captured.status, 200);
  const { ids } = await captured.json(); assert.equal((await post(body)).status, 200);
  assert.equal(listTodos().todos.length, 1);
  const board = await (await GET(request("GET"))).json(); assert.equal(board.todos[0].id, ids[0]);
  globalThis.__weeklyTestAgent = () => { throw new Error("Scheduling must not spend tokens"); };
  const response = await post({ action: "preview", options: DEFAULT_PLANNER, selected: board.todos.map(defaultSelection), replace: false });
  assert.equal(response.status, 200);
  const proposal = await response.json(); assert.ok(proposal.plan.blocks.length);
  assert.equal((await post({ action: "accept", proposal })).status, 200);
  assert.equal((await post({ action: "accept", proposal })).status, 200);
  assert.ok(listTodos().todos[0].workPlan.blocks.length);
});

test("unknown actions, model garbage, input bounds and request guards", async () => {
  assert.equal((await post({ action: "delete-everything" })).status, 400);
  assert.equal((await post({ action: "extract", note: "x" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ action: "extract", note: "x" }, { "content-type": "text/plain" })).status, 415);
  assert.equal((await post({ action: "extract", note: "x".repeat(5001) })).status, 400);
  globalThis.__weeklyTestAgent = async () => ({ reply: "not json" });
  assert.equal((await post({ action: "extract", note: "hello" })).status, 400);
  const todo = addTodo({ title: "Task" }).todo;
  assert.equal((await post({ action: "preview", options: DEFAULT_PLANNER, selected: [defaultSelection(todo)], replace: "yes" })).status, 400);
  assert.equal(listTodos().todos[0].workPlan, undefined);
});
