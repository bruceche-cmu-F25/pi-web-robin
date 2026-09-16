import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

// Point the store at a scratch directory before importing it.
const dir = mkdtempSync(join(tmpdir(), "robin-rounds-"));
process.env.ROBIN_DATA_DIR = dir;

const { companyKey, docket, dueAt, normalizeWhen, pressingAssessments } = await import("./rounds.ts");
const { deleteRound, listRounds, recordRound, updateRound } = await import("./round-domain.ts");
const { addTodo, listTodos, updateTodo } = await import("./todo-domain.ts");
const { registerRoundTools } = await import("./round-tools.ts");
const { ROBIN_MAIL_TOOL_NAMES, ROBIN_TOOL_NAMES } = await import("./tools.ts");

beforeEach(() => {
  rmSync(join(dir, "rounds.json"), { force: true });
  rmSync(join(dir, "todos.json"), { force: true });
});
after(() => rmSync(dir, { recursive: true, force: true }));

test("a day stays a day and anything with a time becomes a UTC instant", () => {
  assert.equal(normalizeWhen("2026-09-21"), "2026-09-21");
  assert.equal(normalizeWhen("2026-09-21T08:28:00-07:00"), "2026-09-21T15:28:00.000Z");
  assert.throws(() => normalizeWhen("2026-02-30"));
  assert.throws(() => normalizeWhen("next Tuesday"));
});

test("an OA due on a bare day runs to the end of it; an interview on one sorts at its start", () => {
  const oa = dueAt({ kind: "oa", due: "2026-09-21" });
  const call = dueAt({ kind: "interview", due: "2026-09-21" });
  assert.equal(new Date(oa).getHours(), 23);
  assert.equal(new Date(call).getHours(), 0);
});

test("company names compare without legal suffixes or punctuation", () => {
  assert.equal(companyKey("Salesforce, Inc."), companyKey("salesforce"));
  assert.notEqual(companyKey("Everlaw"), companyKey("Evernote"));
});

test("repeat mail about one OA updates it instead of adding a second", () => {
  const first = recordRound({ kind: "oa", company: "Salesforce", due: "2026-09-21", threadId: "t1" });
  const reminder = recordRound({ kind: "oa", company: "Salesforce, Inc.", due: "2026-09-21T08:28:00-07:00", detail: "HackerRank · 90 min" });
  assert.equal(first.created, true);
  assert.equal(reminder.created, false);
  const rounds = listRounds();
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].due, "2026-09-21T15:28:00.000Z");
  assert.equal(rounds[0].detail, "HackerRank · 90 min");
  assert.equal(rounds[0].threadId, "t1");
});

test("a bare day never overwrites a time already known for that day", () => {
  recordRound({ kind: "oa", company: "Everlaw", due: "2026-09-16T11:42:00-07:00" });
  recordRound({ kind: "oa", company: "Everlaw", due: "2026-09-16" });
  assert.equal(listRounds()[0].due, "2026-09-16T18:42:00.000Z");
});

test("a second interview on another day is a second round", () => {
  recordRound({ kind: "interview", company: "Claude Corps", due: "2026-09-16T07:15:00-07:00" });
  recordRound({ kind: "interview", company: "Claude Corps", due: "2026-09-23T10:00:00-07:00" });
  assert.equal(listRounds().length, 2);
});

test("a closed round stays closed when its thread writes again", () => {
  const { round } = recordRound({ kind: "oa", company: "IBM", due: "2026-09-15", threadId: "ibm" });
  updateRound(round.id, { status: "done" });
  recordRound({ kind: "oa", company: "IBM", threadId: "ibm", detail: "reminder" });
  const [only] = listRounds();
  assert.equal(only.status, "done");
});

test("an OA links to its todo, and ticking either one settles both", () => {
  const { todo } = addTodo({ title: "完成 Everlaw CodeSignal 测评（90 分钟）", due: "2026-09-16" });
  const { round } = recordRound({ kind: "oa", company: "Everlaw", due: "2026-09-16T11:42:00-07:00" });
  assert.equal(round.todoId, todo.id);

  updateRound(round.id, { status: "done" });
  assert.equal(listTodos({ includeDone: true }).todos.find((entry) => entry.id === todo.id).done, true);

  updateRound(round.id, { status: "open" });
  assert.equal(listTodos().todos.find((entry) => entry.id === todo.id).done, false);

  updateTodo({ id: todo.id }, { done: true });
  assert.equal(listRounds()[0].status, "done");
});

test("a ticked todo only settles a round it matches by day", () => {
  const { todo } = addTodo({ title: "验证 Roblox 申请邮箱地址" });
  updateTodo({ id: todo.id }, { done: true });
  const { round } = recordRound({ kind: "interview", company: "Roblox", due: "2026-09-20" });
  assert.equal(round.todoId, undefined);
  assert.equal(listRounds()[0].status, "open");
});

test("an interview never links to a todo — booking it is not having it", () => {
  addTodo({ title: "预约 Claude Corps 25 分钟面试（自己挑时间，视频）" });
  const { round } = recordRound({ kind: "interview", company: "Claude Corps", due: "2026-09-16T07:15:00-07:00" });
  assert.equal(round.todoId, undefined);
  assert.equal(listRounds()[0].todoId, undefined);
});

test("the docket orders open OAs by deadline and moves past interviews to history", () => {
  const now = Date.parse("2026-09-15T12:00:00-07:00");
  recordRound({ kind: "oa", company: "Salesforce", due: "2026-09-21" });
  recordRound({ kind: "oa", company: "IBM", due: "2026-09-15" });
  recordRound({ kind: "oa", company: "Goaly" });
  recordRound({ kind: "interview", company: "Claude Corps", due: "2026-09-16T07:15:00-07:00" });
  recordRound({ kind: "interview", company: "Old Co", due: "2026-09-10T09:00:00-07:00" });
  const { assessments, interviews, history } = docket(listRounds(), now);
  assert.deepEqual(assessments.map((round) => round.company), ["IBM", "Salesforce", "Goaly"]);
  assert.deepEqual(interviews.map((round) => round.company), ["Claude Corps"]);
  assert.deepEqual(history.map((round) => round.company), ["Old Co"]);
  assert.equal(pressingAssessments(listRounds(), now), 1);
});

test("delete removes a round", () => {
  const { round } = recordRound({ kind: "oa", company: "Abridge", due: "2026-09-09" });
  assert.equal(deleteRound(round.id).id, round.id);
  assert.equal(listRounds().length, 0);
  assert.ok("error" in deleteRound(round.id));
});

test("round tools are registered and reachable from chat and the mail turn", () => {
  const tools = new Map();
  registerRoundTools({ registerTool(tool) { tools.set(tool.name, tool); } });
  assert.deepEqual([...tools.keys()], ["round_add", "round_list", "round_update"]);
  for (const name of tools.keys()) {
    assert.ok(ROBIN_TOOL_NAMES.includes(name));
    assert.ok(ROBIN_MAIL_TOOL_NAMES.includes(name));
  }
});

test("round_add records without a mail id and rejects an unknown kind", async () => {
  const tools = new Map();
  registerRoundTools({ registerTool(tool) { tools.set(tool.name, tool); } });
  const added = await tools.get("round_add").execute("t", { kind: "oa", company: "Goaly", detail: "take-home · 48h" });
  assert.match(added.content[0].text, /^Recorded .*OA: Goaly/);
  const wrong = await tools.get("round_add").execute("t", { kind: "phone", company: "X" });
  assert.match(wrong.content[0].text, /kind must be/);
});

test("gmail_review records its oa and interview items as rounds, and only those", async () => {
  const { registerGmailTools } = await import("./gmail-tools.ts");
  const tools = new Map();
  registerGmailTools({ registerTool(tool) { tools.set(tool.name, tool); } });
  // No Google here: the metadata lookup fails and the review saves anyway.
  const result = await tools.get("gmail_review").execute("t", {
    items: [
      { id: "m1", category: "oa", summary: "IBM coding assessment", action: "todo", company: "IBM", due: "2026-09-15", detail: "HackerRank" },
      { id: "m2", category: "interview", summary: "Claude Corps call", action: "event", company: "Claude Corps", due: "not a date" },
      { id: "m3", category: "oa", summary: "No company given", action: "none" },
      { id: "m4", category: "important", summary: "Rejection", action: "none", company: "NVIDIA" },
    ],
  });
  assert.match(result.content[0].text, /2 recorded/);
  const rounds = listRounds();
  assert.deepEqual(rounds.map((round) => [round.kind, round.company, round.due ?? null, round.threadId]), [
    ["oa", "IBM", "2026-09-15", "m1"],
    ["interview", "Claude Corps", null, "m2"],
  ]);
});
