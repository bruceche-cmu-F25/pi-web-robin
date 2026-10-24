import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyQueue, parseWorkQueue, queueCandidates, queueWindow, recommendTask, validWorkHours } from "./work-queue.ts";

const day = "2030-05-12";
const at = (time) => new Date(`${day}T${time}:00`);
const task = (id, extra = {}) => ({ id, title: id, createdAt: "", done: false, ...extra });
const event = (start, end, extra = {}) => ({ id: "event", title: "Meeting", date: day, start, end, createdAt: "", ...extra });
const windowAt = (events, time = "10:00", reliable = true) => queueWindow(events, at(time), "09:00", "18:00", reliable);
const confirmed = () => ({ ...emptyQueue(day), confirmed: true, ids: ["a", "b", "c"] });

test("free time respects event buffers, working hours and the nearest overlapping event", () => {
  assert.deepEqual(windowAt([event("11:00", "12:00")]), { kind: "free", minutes: 50 });
  assert.equal(windowAt([event("10:05", "11:00")]).kind, "busy");
  assert.equal(windowAt([event("09:00", "10:00")], "10:09").kind, "busy");
  assert.equal(windowAt([event("09:00", "10:00")], "10:10").kind, "free");
  assert.equal(windowAt([event("09:00", "10:30"), event("10:00", "11:00")], "10:45").kind, "busy");
  assert.deepEqual(windowAt([event("12:00", "13:00"), event("11:00", "12:30")]), { kind: "free", minutes: 50 });
  assert.equal(windowAt([], "08:59").kind, "outside");
  assert.equal(windowAt([], "18:00").kind, "outside");
  assert.deepEqual(windowAt([], "17:56"), { kind: "short", minutes: 4 });
  assert.equal(validWorkHours("18:00", "09:00"), false);
  assert.equal(validWorkHours("24:00", "25:00"), false);
});

test("all-day entries do not block free time; incomplete calendars and timed events still do", () => {
  assert.equal(windowAt([], "10:00", false).kind, "uncertain");
  assert.deepEqual(windowAt([event(undefined, undefined)]), windowAt([]));
  assert.deepEqual(windowAt([event(undefined, undefined, { date: "2030-05-10", endDate: "2030-05-15" })]), windowAt([]));
  assert.deepEqual(windowAt([event("09:00", undefined)]), windowAt([]));
  assert.deepEqual(windowAt([event("11:00", undefined)]), windowAt([]));
  assert.deepEqual(windowAt([event("09:00", undefined, { date: "2030-05-11", endDate: "2030-05-15" })]), windowAt([]));
  assert.deepEqual(windowAt([event("09:00", undefined), event("11:00", "12:00")]), { kind: "free", minutes: 50 });
  assert.equal(windowAt([event("23:00", "11:00", { date: "2030-05-11", endDate: day })]).kind, "busy");
  assert.equal(windowAt([event("09:00", "01:00", { endDate: "2030-05-13" })]).kind, "busy");
  assert.equal(windowAt([event("bad", "time")]).kind, "uncertain");
  assert.equal(windowAt([event(undefined, undefined, { date: "2030-05-13" })]).kind, "free");
});

test("suggestions respect explicit priorities and exclude completed, archived and future-planned work", () => {
  const todos = [task("due", { due: day }), task("later", { due: "2030-05-15" }), task("next", { next: true }),
    task("doing", { status: "doing" }), task("planned", { plannedOn: day }), task("done", { done: true }),
    task("archived", { archivedAt: "yesterday" }), task("future", { plannedOn: "2030-05-15" }), task("not-started", { startDate: "2030-05-13" })];
  assert.deepEqual(queueCandidates(todos, day).map((item) => item.id), ["next", "doing", "planned", "due", "later"]);
  assert.equal(todos[0].id, "due", "Input ordering is not mutated");
});

test("recommendations choose a fitting task, or explicitly offer only a five-minute kickoff", () => {
  const tasks = [task("a", { estimateMinutes: 60 }), task("b", { estimateMinutes: 20 }), task("c")];
  const state = confirmed();
  const now = at("10:00").getTime();
  const free = { kind: "free", minutes: 30 };
  assert.equal(recommendTask(tasks, state, now, free).todo.id, "b");
  state.notes.b = { step: "", skips: 1, until: now + 60_000 };
  assert.deepEqual(recommendTask(tasks, state, now, free), { todo: tasks[0], kickoff: true });
  assert.equal(recommendTask(tasks, state, now + 60_000, free).todo.id, "b");
  assert.equal(recommendTask([task("agent", { estimateMinutes: 10, estimateSource: "agent" })], state, now, free).kickoff, true);
  assert.equal(recommendTask(tasks, { ...state, restUntil: now + 60_000 }, now, free), null);
  assert.equal(recommendTask(tasks, { ...state, confirmed: false }, now, free), null);
  assert.equal(recommendTask(tasks, state, now, { kind: "busy", minutes: 0 }), null);
  assert.equal(recommendTask([task("done", { done: true }), task("moved", { plannedOn: "2030-05-13" })], state, now, free), null);
});

test("refresh preserves daily queue, timer and notes; midnight resets commitments but keeps next steps and hours", () => {
  const state = { ...confirmed(), start: "10:00", end: "19:00", restUntil: 1000, active: { id: "a", endsAt: 2000 }, notes: { a: { step: "Open the draft", skips: 2, until: 1000 } } };
  const restored = parseWorkQueue(JSON.stringify(state), day);
  assert.deepEqual(restored.ids, state.ids);
  assert.deepEqual(restored.active, state.active);
  assert.equal(restored.notes.a.skips, 2);
  const tomorrow = parseWorkQueue(JSON.stringify(state), "2030-05-13");
  assert.equal(tomorrow.confirmed, false);
  assert.deepEqual(tomorrow.ids, []);
  assert.equal(tomorrow.active, null);
  assert.equal(tomorrow.restUntil, 0);
  assert.equal(tomorrow.start, "10:00");
  assert.deepEqual(tomorrow.notes.a, { step: "Open the draft", skips: 0, until: 0 });
});

test("malformed storage is bounded and cannot invent completion or run an orphan timer", () => {
  for (const raw of [null, "{", "null", "[]", '{"version":2}']) assert.deepEqual(parseWorkQueue(raw, day), emptyQueue(day));
  const state = { ...confirmed(), ids: ["a", "a", false, "b", "c", "d"], start: "nonsense", active: { id: "gone", endsAt: 100 }, notes: { a: { step: "x".repeat(600), skips: 1, until: 0 }, bad: { step: 2 } } };
  const parsed = parseWorkQueue(JSON.stringify(state), day);
  assert.deepEqual(parsed.ids, ["a", "b", "c"]);
  assert.equal(parsed.active, null);
  assert.equal(parsed.start, "09:00");
  assert.equal(parsed.notes.a.step.length, 500);
  assert.equal(parsed.notes.bad, undefined);
});
