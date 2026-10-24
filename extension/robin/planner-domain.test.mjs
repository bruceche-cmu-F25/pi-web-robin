process.env.TZ = "America/Los_Angeles";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { resetTaskStore } from "./task-store.test-support.mjs";
import { addTodo, listTodos, todoRevision, updateTodo, completeTodo } from "./todo-domain.ts";
import { calendarBoard, createCalendarEvent } from "./calendar-domain.ts";
import { acceptWeek, plannerContext, previewWeek, saveCapture, settleFocus, parseCaptureReply } from "./planner-domain.ts";
import { DEFAULT_PLANNER, defaultSelection } from "./planner.ts";
const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-weekly-"));
process.env.ROBIN_DATA_DIR = dir;
beforeEach(() => { resetTaskStore(dir); mock.timers.enable({ apis: ["Date"], now: new Date("2030-05-13T15:00:00Z") }); });
afterEach(() => mock.timers.reset());
after(() => { rmSync(dir, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const preview = async (replace = false) => { const context = await plannerContext(); return previewWeek(context, { options: DEFAULT_PLANNER, selected: context.todos.map(defaultSelection), replace }); };

test("preview writes nothing, acceptance is retry safe and calendar follows todo state", async () => {
  const todo = addTodo({ title: "Assignment", due: "2030-05-16", estimateMinutes: 120 }).todo;
  const p = await preview();
  assert.deepEqual(listTodos().todos, [todo]);
  await acceptWeek(await plannerContext(), p);
  const planned = listTodos().todos[0];
  assert.ok(planned.workPlan.blocks.length);
  assert.equal(planned.due, todo.due);
  assert.equal(planned.done, false);
  assert.equal(planned.plannedOn, undefined);
  assert.equal((await calendarBoard()).events[0].source, "planner");
  await acceptWeek(await plannerContext(), p);
  assert.deepEqual(listTodos().todos[0], planned);
  completeTodo({ id: todo.id });
  assert.equal((await calendarBoard()).events.length, 0);
});

test("all-day and missing-end entries need no exceptions for preview, acceptance or conflict checks", async () => {
  addTodo({ title: "Assignment", due: "2030-05-13", estimateMinutes: 60 });
  createCalendarEvent({ title: "Watch a tutorial", date: "2030-05-13" });
  createCalendarEvent({ title: "Time marker", date: "2030-05-13", start: "09:00" });
  const context = await plannerContext();
  const proposal = await preview();
  assert.equal(proposal.plan.remaining.length, 0);
  assert.equal(listTodos().todos[0].workPlan, undefined);
  acceptWeek(await plannerContext(), proposal);
  assert.ok(listTodos().todos[0].workPlan.blocks.length);
  assert.equal(listTodos().todos[0].workPlan.reminderEventIds, undefined);
  const fresh = await plannerContext();
  assert.deepEqual(fresh.events, context.events);
  assert.deepEqual(fresh.conflicts, []);
  acceptWeek(fresh, proposal); // lost-response retry still works
});

test("evening overflow is read-only until acceptance, recomputed and preserved on reload", async () => {
  addTodo({ title: "Due today", due: "2030-05-13", estimateMinutes: 120 });
  createCalendarEvent({ title: "Daytime busy", date: "2030-05-13", start: "09:00", end: "18:00" });
  const p = await preview();
  assert.ok(p.plan.blocks.length > 0 && p.plan.blocks.every((b) => b.evening));
  assert.equal(listTodos().todos[0].workPlan, undefined);
  p.plan.blocks[0].start = "23:00";
  acceptWeek(await plannerContext(), p);
  const saved = listTodos().todos[0].workPlan.blocks;
  assert.ok(saved.every((b) => b.evening && b.start >= "19:00" && b.end <= "22:00"));
  assert.deepEqual((await plannerContext()).conflicts, []);
  assert.equal((await preview()).plan.blocks.length, 0, "kept evening effort is not proposed twice");
  const context = await plannerContext();
  const disabled = previewWeek(context, { options: { ...DEFAULT_PLANNER, deadlineEvenings: false }, selected: context.todos.map(defaultSelection), replace: false });
  assert.equal(disabled.plan.remaining.length, 0, "turning off future overflow retains already accepted slots");
  const repaired = previewWeek(context, { options: disabled.options, selected: disabled.selected, replace: true });
  assert.equal(repaired.plan.blocks.length, 0);
  assert.equal(repaired.plan.remaining[0].minutes, 120);
});

test("task/calendar revisions, stale local races, elapsed time and incomplete Google reject acceptance", async () => {
  const todo = addTodo({ title: "Task" }).todo;
  const p = await preview();
  updateTodo({ id: todo.id }, { title: "Other title" });
  const changed = await plannerContext();
  assert.throws(() => acceptWeek(changed, p), /changed/);
  const p2 = await preview();
  const snapshot = await plannerContext();
  createCalendarEvent({ title: "New class", date: snapshot.today, start: "09:00", end: "10:00" });
  assert.throws(() => acceptWeek(snapshot, p2), /Calendar changed/);
  const p3 = await preview();
  const current = await plannerContext();
  assert.throws(() => acceptWeek({ ...current, google: { connected: true, error: "offline" } }, p3), /incomplete/);
  mock.timers.setTime(new Date("2030-05-13T16:31:00Z").getTime());
  assert.throws(() => acceptWeek({ ...current, now: new Date().toISOString() }, p3), /expired/);
  assert.equal(listTodos().todos[0].workPlan, undefined);
});

test("client cannot inject arbitrary slots or edit another task through a proposal", async () => {
  addTodo({ title: "Work", estimateMinutes: 60 });
  const p = await preview();
  p.plan.blocks[0].date = "2031-01-01";
  p.plan.blocks[0].start = "03:00";
  acceptWeek(await plannerContext(), p);
  assert.equal(listTodos().todos[0].workPlan.blocks[0].date, "2030-05-13");
  assert.equal(listTodos().todos[0].workPlan.blocks[0].start, "09:00");
});

test("logging is not task completion, release restores unplaced effort", async () => {
  addTodo({ title: "Work", estimateMinutes: 120 });
  const p = await preview(); acceptWeek(await plannerContext(), p);
  let todo = listTodos().todos[0];
  const id = todo.workPlan.blocks[0].id;
  assert.throws(() => settleFocus({ id: todo.id, blockId: id, revision: todoRevision([todo]), action: "done" }), /not started/);
  mock.timers.setTime(new Date("2030-05-13T17:00:00Z").getTime());
  settleFocus({ id: todo.id, blockId: id, revision: todoRevision([todo]), action: "done" });
  todo = listTodos().todos[0];
  assert.equal(todo.done, false);
  assert.equal(todo.workPlan.blocks[0].done, true);
  settleFocus({ id: todo.id, blockId: id, revision: todoRevision([todo]), action: "undo" });
  todo = listTodos().todos[0];
  settleFocus({ id: todo.id, blockId: id, revision: todoRevision([todo]), action: "release" });
  const again = await preview();
  assert.ok(again.plan.blocks.length > 0);
});

test("capture is preview-only until saved; duplicate requests do not duplicate tasks/events", async () => {
  const existing = addTodo({ title: "Already here" }).todo;
  const input = { tasks: [{ id: existing.id, title: existing.title, minutes: 120, continuous: false, estimated: true }, { title: "Assignment", due: "2030-05-16", minutes: 240, continuous: false, estimated: true }], events: [{ title: "Interview", date: "2030-05-17", start: "11:00", end: "12:00" }], questions: [] };
  const capture = parseCaptureReply(JSON.stringify(input), await plannerContext());
  assert.equal(listTodos().todos.length, 1);
  const requestId = "a".repeat(32);
  const ids = saveCapture(capture, requestId);
  assert.equal(ids[0], existing.id);
  assert.deepEqual(saveCapture(capture, requestId), ids);
  assert.equal(listTodos().todos.length, 2);
  assert.equal((await calendarBoard()).events.length, 1);
  const repeatedEvent = { tasks: [], events: input.events, questions: [] };
  saveCapture(repeatedEvent, "c".repeat(32));
  saveCapture(repeatedEvent, "c".repeat(32));
  assert.equal((await calendarBoard()).events.length, 1, "a fresh capture of the same appointment reuses it");
  assert.throws(() => saveCapture({ ...repeatedEvent, events: [{ ...input.events[0], title: "Changed after save" }] }, "c".repeat(32)), /already saved/);
  assert.throws(() => saveCapture({ ...input, tasks: [...input.tasks, { title: "invalid", minutes: -1 }] }, "b".repeat(32)));
  assert.equal(listTodos().todos.length, 2);
  assert.throws(() => parseCaptureReply('{"tasks": [{"id":"invented"}]}', { todos: [] }));
});
