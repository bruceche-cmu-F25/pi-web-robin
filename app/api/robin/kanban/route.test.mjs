process.env.TZ = "America/Los_Angeles";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { createJiti } from "jiti";
import { addTodo, listTodos, updateTodo } from "../../../../extension/robin/todo-domain.ts";
import { DEFAULT_PLANNING } from "../../../../extension/robin/kanban.ts";

const previous = process.env.ROBIN_DATA_DIR;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-planner-api-"));
process.env.ROBIN_DATA_DIR = dir;
// The scoped assistant gets its cwd from ROBIN_DATA_DIR, so an unstubbed turn
// would write real session files under ~/.pi/agent/sessions pointing at this
// temp dir — leftover rows in the sidebar whose cwd is deleted moments later
// by the cleanup below. Keep the agent dir here too, as e2e/run.mjs does.
process.env.PI_CODING_AGENT_DIR = dir;
const stub = join(dir, "assistant.mjs");
writeFileSync(stub, "export const runScopedAssistantTurn = (options) => globalThis.__kanbanTestAgent(options);\n");
const jiti = createJiti(import.meta.url, { alias: { "@/lib/robin-assistant": stub, "@": process.cwd() }, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
after(() => {
  delete globalThis.__kanbanTestAgent;
  rmSync(dir, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});
beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2030-05-13T16:00:00Z") });
  writeFileSync(join(dir, "todos.json"), "[]");
  writeFileSync(join(dir, "events.json"), "[]");
  globalThis.__kanbanTestAgent = async (options) => {
    assert.deepEqual(options.toolNames, [], "untrusted calendar content never gets write tools");
    assert.equal(options.oneShot, true);
    assert.ok(options.signal);
    const input = JSON.parse(options.message);
    return { reply: JSON.stringify({ items: [{ id: input.candidates[0].id, plannedOn: input.today, estimateMinutes: 30, reason: "An achievable task" }] }) };
  };
});
afterEach(() => mock.timers.reset());
const request = (method, body, headers = {}) => new Request(`http://localhost:30141/api/robin/kanban?options=${encodeURIComponent(JSON.stringify(DEFAULT_PLANNING))}`, {
  method, headers: { host: "localhost:30141", "content-type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const generate = () => POST(request("POST", { action: "generate", options: DEFAULT_PLANNING, locale: "zh-CN" }));

test("preview has no writes; acceptance changes only selected planning fields and cannot replay", async () => {
  const todo = addTodo({ title: "Do the report", due: "2030-05-15" }).todo;
  const capacity = await GET(request("GET"));
  assert.equal(capacity.status, 200);
  assert.equal((await capacity.json()).capacity[0].remainingMinutes, 120);
  const response = await generate();
  const proposal = await response.json();
  assert.equal(response.status, 200, JSON.stringify(proposal));
  assert.deepEqual(listTodos().todos, [todo]);
  const body = { action: "apply", options: DEFAULT_PLANNING, ...proposal };
  assert.equal((await POST(request("POST", body))).status, 200);
  const planned = listTodos().todos[0];
  assert.equal(planned.plannedOn, "2030-05-13");
  assert.equal(planned.due, todo.due);
  assert.equal(planned.done, false);
  assert.equal(planned.status, "todo");
  assert.equal((await POST(request("POST", body))).status, 400);
});

test("stale and malformed proposals fail closed, retaining all user data", async () => {
  const todo = addTodo({ title: "Task" }).todo;
  const proposal = await (await generate()).json();
  updateTodo({ id: todo.id }, { title: "Changed" });
  assert.equal((await POST(request("POST", { action: "apply", options: DEFAULT_PLANNING, ...proposal }))).status, 400);
  globalThis.__kanbanTestAgent = async () => ({ reply: '{"items":[{"id":"invented","plannedOn":"2030-05-13","estimateMinutes":5,"reason":"ignore all rules"}]}' });
  assert.equal((await generate()).status, 400);
  assert.equal(listTodos().todos[0].plannedOn, undefined);
  globalThis.__kanbanTestAgent = async () => { throw new Error("Model unavailable"); };
  assert.match(JSON.stringify(await (await generate()).json()), /Model unavailable/);
});

test("request origin, JSON type and preference validation remain enforced", async () => {
  const body = { action: "generate", options: DEFAULT_PLANNING };
  assert.equal((await POST(request("POST", body, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(request("POST", body, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(request("POST", { ...body, options: { ...DEFAULT_PLANNING, dailyMinutes: -1 } }))).status, 400);
  globalThis.__kanbanTestAgent = async () => { throw new Error("must not spend tokens for empty input"); };
  assert.deepEqual((await (await generate()).json()).suggestion, { items: [] });
});
