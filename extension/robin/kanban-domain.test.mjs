process.env.TZ = "America/Los_Angeles";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { addDays, localDate } from "./dates.ts";
import { addTodo, applyTodoPlan, listTodos, reviewTodo, todoRevision, updateTodo } from "./todo-domain.ts";
import { acceptPlan, kanbanContext, parsePlanReply, plannerMessage } from "./kanban-domain.ts";
import { DEFAULT_PLANNING, needsReview } from "./kanban.ts";
import { createCalendarEvent } from "./calendar-domain.ts";
import { resetTaskStore } from "./task-store.test-support.mjs";

const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-focus-"));
process.env.ROBIN_DATA_DIR = dir;
after(() => {
  rmSync(dir, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
});
beforeEach(() => resetTaskStore(dir));
const snapshot = () => listTodos({ includeDone: true, includeArchived: true }).todos;

test("planned work dates and estimates never overwrite deadlines or status", () => {
  const today = localDate();
  const todo = addTodo({ title: "Report", due: addDays(today, 5) }).todo;
  const planned = updateTodo({ id: todo.id }, { plannedOn: today, estimateMinutes: 45 });
  assert.equal(planned.due, todo.due);
  assert.equal(planned.status, "todo");
  assert.equal(planned.done, false);
  updateTodo({ id: todo.id }, { plannedOn: "", estimateMinutes: null });
  assert.equal(snapshot()[0].plannedOn, undefined);
  assert.equal(snapshot()[0].due, todo.due);
  for (const patch of [{ plannedOn: "2030-02-31" }, { estimateMinutes: -1 }, { estimateMinutes: 30.5 }]) {
    assert.throws(() => updateTodo({ id: todo.id }, patch));
  }
});

test("review continues for seven days or abandons reversibly without completing anything", () => {
  const today = localDate();
  const todo = addTodo({ title: "Old task", due: addDays(today, -5), plannedOn: addDays(today, -1) }).todo;
  const continued = reviewTodo({ id: todo.id }, "continue");
  assert.equal(continued.reviewAfter, addDays(today, 7));
  assert.equal(continued.plannedOn, undefined);
  assert.equal(continued.due, todo.due);
  assert.equal(needsReview(continued, today), false);
  assert.equal(needsReview(continued, addDays(today, 7)), true);
  const edited = updateTodo({ id: todo.id }, { due: todo.due, estimateMinutes: 60 });
  assert.equal(edited.reviewAfter, continued.reviewAfter);
  const archived = reviewTodo({ id: todo.id }, "abandon");
  assert.equal(archived.done, false);
  assert.equal(archived.completedAt, undefined);
  assert.deepEqual(listTodos({ includeDone: true }).todos, []);
  assert.equal(snapshot().length, 1);
  const restored = reviewTodo({ id: todo.id }, "restore");
  assert.equal(restored.archivedAt, undefined);
  assert.equal(listTodos().todos.length, 1);
});

test("plan acceptance is atomic, stale-safe and keeps Agent estimates labelled", () => {
  const today = localDate();
  const a = addTodo({ title: "A" }).todo;
  const b = addTodo({ title: "B", estimateMinutes: 45 }).todo;
  const before = snapshot();
  const items = [{ id: a.id, plannedOn: today, estimateMinutes: 30 }, { id: b.id, plannedOn: today, estimateMinutes: 45 }];
  assert.throws(() => applyTodoPlan(todoRevision(before), [items[0], { ...items[1], plannedOn: "bad" }]));
  assert.deepEqual(snapshot(), before);
  applyTodoPlan(todoRevision(before), items);
  const after = snapshot();
  assert.equal(after[0].estimateSource, "agent");
  assert.equal(after[1].estimateSource, undefined);
  assert.ok(after.every((todo) => !todo.done && todo.status === "todo"));
  assert.throws(() => applyTodoPlan(todoRevision(before), items), /changed/);
  updateTodo({ id: a.id }, { estimateMinutes: 40 });
  assert.equal(snapshot()[0].estimateSource, undefined);
});

test("context reads calendar without task writes, and fingerprint changes invalidate proposals", async () => {
  addTodo({ title: "Existing" });
  const options = { ...DEFAULT_PLANNING, start: "00:00", end: "23:59" };
  const before = snapshot();
  const first = await kanbanContext(options);
  assert.deepEqual(snapshot(), before);
  assert.equal(first.google.connected, false);
  assert.match(plannerMessage(first, "zh-CN"), /Chinese/);
  assert.deepEqual(parsePlanReply('```json\n{"items":[]}\n```', first), { items: [] });
  assert.throws(() => parsePlanReply("I did it!", first), /valid plan/);
  createCalendarEvent({ title: "New meeting", date: first.today, start: "10:00", end: "11:00" });
  const second = await kanbanContext(options);
  assert.notEqual(first.revision, second.revision);
  assert.throws(() => acceptPlan(second, first.revision, { items: [] }), /changed/);
  assert.throws(() => acceptPlan({ ...second, google: { connected: true, error: "offline" } }, second.revision, { items: [] }), /incomplete/);
});
