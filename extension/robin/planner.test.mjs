import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PLANNER, blockMinutes, defaultSelection, focusConflicts, focusEvents, scheduleWeek, validatePlannerOptions, validateSelections } from "./planner.ts";

const today = "2030-05-13"; // Monday
const normalOnly = { ...DEFAULT_PLANNER, deadlineEvenings: false };
const task = (id, patch = {}) => ({ id, title: id, done: false, createdAt: "2030-05-01T00:00:00Z", ...patch });
const event = (id, date, start, end) => ({ id, title: id, date, start, end, createdAt: "" });
const schedule = (tasks, events = [], options = DEFAULT_PLANNER, replace = false, now = 8 * 60) => scheduleWeek(tasks, events, tasks.map(defaultSelection), options, today, now, replace);

test("deadline order, lunch, buffers, daily budget and exact total effort", () => {
  const tasks = [task("later", { due: "2030-05-16", estimateMinutes: 240 }), task("first", { due: today, estimateMinutes: 120 })];
  const events = [event("meeting", today, "10:30", "11:00"), event("duplicate", today, "10:30", "11:00")];
  const result = schedule(tasks, events);
  assert.equal(result.remaining.length, 0);
  assert.equal(result.blocks[0].todoId, "first");
  assert.deepEqual(result.tight, ["first"]);
  for (const todo of tasks) assert.equal(result.blocks.filter((b) => b.todoId === todo.id).reduce((s, b) => s + blockMinutes(b), 0), todo.estimateMinutes);
  for (const b of result.blocks) {
    assert.ok(b.start >= "09:00" && b.end <= "18:00");
    assert.ok(b.end <= "12:00" || b.start >= "13:00");
    if (b.date === today) assert.ok(b.end <= "10:15" || b.start >= "11:15");
  }
  assert.ok(result.days.every((d) => d.minutes <= 240));
});

test("an experiment needs a single gap, not a fictional sum of fragments", () => {
  const tasks = [task("lab", { due: today, estimateMinutes: 240, workPlan: { continuous: true, blocks: [] } })];
  const result = schedule(tasks, [event("meeting", today, "15:00", "16:00")]);
  assert.equal(result.blocks.length, 0);
  assert.deepEqual(result.remaining, [{ id: "lab", minutes: 240, reason: "continuous" }]);
  assert.equal(schedule(tasks).blocks.length, 1);
});

test("complete timed spans, overdue and weekends still constrain scheduling", () => {
  assert.equal(schedule([task("x", { due: today })], [{ ...event("trip", "2030-05-12", "15:00", "17:00"), endDate: "2030-05-14" }]).blocks.length, 0);
  assert.equal(schedule([task("late", { due: "2030-05-12" })]).remaining[0].reason, "deadline");
  const weekend = task("sat", { startDate: "2030-05-18", estimateMinutes: 60 });
  assert.equal(schedule([weekend]).blocks.length, 0);
  assert.equal(schedule([weekend], [], { ...DEFAULT_PLANNER, weekends: true }).blocks[0].date, "2030-05-18");
});

test("all-day entries never consume capacity or cause conflicts, without any opt-in", () => {
  const tasks = [task("work", { due: today, estimateMinutes: 60 })];
  const reminder = event("reminder", today);
  const allDay = [reminder, { ...event("multi-day", "2030-05-12"), endDate: "2030-05-19" }];
  assert.deepEqual(schedule(tasks, allDay), schedule(tasks), "single and multi-day date-only entries reserve no minutes");
  const meeting = event("meeting", today, "09:00", "10:00");
  assert.deepEqual(schedule(tasks, [...allDay, meeting]), schedule(tasks, [meeting]), "timed meetings still reserve their interval and buffer");
  assert.deepEqual(schedule(tasks, [{ ...reminder, start: "09:00" }]), schedule(tasks), "a start without an end still reserves nothing");
  const confirmed = task("work", { workPlan: { continuous: false, blocks: [{ id: "slot", date: today, start: "09:00", end: "10:00" }] } });
  assert.deepEqual(focusConflicts([confirmed], allDay, today, 480), []);
  assert.deepEqual(focusConflicts([confirmed], [meeting], today, 480), ["work"]);
  assert.deepEqual(validatePlannerOptions({ ...DEFAULT_PLANNER, reminderEventIds: ["obsolete"] }), DEFAULT_PLANNER, "old browser preferences no longer need reminder exceptions");
});

test("missing ends never reserve the rest of a day, buffers or spanning days", () => {
  const tasks = [task("work", { due: today, estimateMinutes: 240 })];
  const unknown = [event("morning", today, "09:00"), event("afternoon", today, "14:00"), { ...event("span", "2030-05-12", "17:00"), endDate: "2030-05-19" }];
  assert.deepEqual(schedule(tasks, unknown), schedule(tasks));
  const booked = task("work", { workPlan: { continuous: false, blocks: [{ id: "slot", date: today, start: "14:00", end: "15:00" }] } });
  assert.deepEqual(focusConflicts([booked], unknown, today, 480), []);
  const complete = { ...unknown[1], end: "15:00" };
  assert.deepEqual(focusConflicts([booked], [complete], today, 480), ["work"]);
  assert.ok(schedule(tasks, [complete]).blocks.every((b) => b.end <= "13:45" || b.start >= "15:15"));
});

test("keep confirmations; repair only future selected slots; missed is not completed", () => {
  const tasks = [task("x", { estimateMinutes: 180, workPlan: { continuous: false, blocks: [
    { id: "done", date: "2030-05-12", start: "09:00", end: "10:00", done: true },
    { id: "missed", date: today, start: "09:00", end: "10:00" },
    { id: "future", date: "2030-05-15", start: "14:00", end: "15:00" },
  ] } })];
  const kept = schedule(tasks, [], DEFAULT_PLANNER, false, 11 * 60);
  assert.equal(kept.blocks.reduce((s, b) => s + blockMinutes(b), 0), 60);
  const repair = schedule(tasks, [], DEFAULT_PLANNER, true, 11 * 60);
  assert.equal(repair.blocks.reduce((s, b) => s + blockMinutes(b), 0), 120);
  assert.ok(repair.blocks.every((b) => b.start >= "11:15" || b.date > today));
});

test("at most three distinct tasks/day; no task shrinkage to hide overload", () => {
  const result = schedule([1, 2, 3, 4].map((i) => task(String(i), { due: today, estimateMinutes: 30 })));
  assert.equal(new Set(result.blocks.map((b) => b.todoId)).size, 3);
  assert.equal(result.remaining[0].minutes, 30);
  const huge = schedule([task("huge", { due: today, estimateMinutes: 720 })], [], normalOnly);
  assert.equal(huge.blocks.reduce((s, b) => s + blockMinutes(b), 0), 240);
  assert.equal(huge.remaining[0].minutes, 480);
});

test("focus calendar derives from tasks and flags collisions without moving slots", () => {
  const todo = task("x", { workPlan: { continuous: false, blocks: [{ id: "a", date: today, start: "09:00", end: "10:00" }] } });
  assert.equal(focusEvents([todo], today)[0].source, "planner");
  assert.equal(focusEvents([{ ...todo, done: true }], today).length, 0);
  assert.equal(focusEvents([{ ...todo, archivedAt: "now" }], today).length, 0);
  assert.deepEqual(focusConflicts([todo], [event("new", today, "09:30", "10:30")], today, 8 * 60), ["x"]);
  assert.equal(todo.workPlan.blocks[0].start, "09:00");
});

test("split task slots are numbered chronologically without changing the task or its effort", () => {
  const todo = task("homework", { title: "HW4", workPlan: { continuous: false, blocks: [
    { id: "later", date: "2030-05-14", start: "09:00", end: "10:00" },
    { id: "first", date: today, start: "14:00", end: "15:30" },
  ] } });
  const before = structuredClone(todo);
  const events = focusEvents([todo], today);
  assert.deepEqual(events.map((e) => e.title), ["1/2 · HW4", "2/2 · HW4"]);
  assert.deepEqual(events.map((e) => e.id), ["focus:homework:first", "focus:homework:later"]);
  assert.equal(events.reduce((sum, e) => sum + blockMinutes(e), 0), 150);
  assert.deepEqual(todo, before);
});

test("validate malformed input and whole-task estimates", () => {
  assert.throws(() => validatePlannerOptions({ ...DEFAULT_PLANNER, end: "08:00" }));
  assert.throws(() => validatePlannerOptions({ ...DEFAULT_PLANNER, dailyMinutes: -1 }));
  const x = task("x");
  assert.throws(() => validateSelections([{ ...defaultSelection(x), minutes: 1 }], [x]));
  assert.throws(() => validateSelections([defaultSelection(x), defaultSelection(x)], [x]));
  assert.throws(() => validateSelections([defaultSelection(x)], []));
});

test("completed focus and unselected date-only commitments consume the daily budget", () => {
  const finished = task("finished", { done: true, workPlan: { continuous: false, blocks: [{ id: "logged", date: today, start: "09:00", end: "11:00", done: true }] } });
  const next = task("next", { due: today, estimateMinutes: 240 });
  const doneResult = scheduleWeek([finished, next], [], [defaultSelection(next)], normalOnly, today, 11 * 60, false);
  assert.equal(doneResult.blocks.reduce((s, b) => s + blockMinutes(b), 0), 120);
  assert.equal(doneResult.remaining[0].minutes, 120);
  const dated = task("dated", { plannedOn: today, estimateMinutes: 120 });
  const dayResult = scheduleWeek([dated, next], [], [defaultSelection(next)], normalOnly, today, 480, false);
  assert.equal(dayResult.blocks.reduce((s, b) => s + blockMinutes(b), 0), 120);
  assert.ok(dayResult.blocks.every((b) => b.start >= "11:15"));
  const future = task("later", { plannedOn: "2030-05-15", estimateMinutes: 60 });
  assert.equal(schedule([future]).blocks[0].date, "2030-05-15");
});

test("repair does not move another task or a block already underway", () => {
  const x = task("x", { estimateMinutes: 180, workPlan: { continuous: false, blocks: [{ id: "live", date: today, start: "09:00", end: "10:30" }, { id: "future", date: "2030-05-15", start: "09:00", end: "10:30" }] } });
  const y = task("y", { estimateMinutes: 120, workPlan: { continuous: false, blocks: [{ id: "keep", date: today, start: "13:00", end: "15:00" }] } });
  const p = scheduleWeek([x, y], [], [defaultSelection(x)], DEFAULT_PLANNER, today, 600, true);
  assert.equal(p.blocks.reduce((s, b) => s + blockMinutes(b), 0), 90);
  assert.ok(p.blocks.every((b) => b.date > today || (b.start >= "10:45" && (b.end <= "12:45" || b.start >= "15:15"))));
  assert.throws(() => scheduleWeek([x], [], [{ ...defaultSelection(x), minutes: 60 }], DEFAULT_PLANNER, today, 600, false), /reserved time/);
});

test("deadline overflow uses evenings only after all available normal hours", () => {
  const busyToday = [event("workday", today, "09:00", "18:00")];
  const tomorrow = task("tomorrow", { due: "2030-05-14", estimateMinutes: 120 });
  const daytime = schedule([tomorrow], busyToday);
  assert.equal(daytime.remaining.length, 0);
  assert.ok(daytime.blocks.every((b) => b.date === "2030-05-14" && !b.evening), "tomorrow's normal hours beat tonight's overtime");
  const urgent = task("urgent", { due: today, estimateMinutes: 120 });
  const rescued = schedule([urgent], busyToday);
  assert.equal(rescued.remaining.length, 0);
  assert.ok(rescued.blocks.every((b) => b.evening && b.date === today && b.start >= "19:00" && b.end <= "22:00"));
  assert.deepEqual(rescued.tight, [urgent.id]);
  assert.equal(schedule([urgent], busyToday, normalOnly).blocks.length, 0);
});

test("overflow adds bounded effort to the normal budget, never beyond appointments or 22:00", () => {
  const urgent = task("urgent", { due: today, estimateMinutes: 720 });
  const result = schedule([urgent], [event("dinner", today, "19:00", "20:00")]);
  const normal = result.blocks.filter((b) => !b.evening), extra = result.blocks.filter((b) => b.evening);
  assert.equal(normal.reduce((sum, b) => sum + blockMinutes(b), 0), 240);
  assert.ok(extra.length > 0);
  assert.ok(extra.every((b) => b.start >= "20:15" && b.end <= "22:00"));
  const total = result.blocks.reduce((sum, b) => sum + blockMinutes(b), 0);
  assert.ok(total <= 420);
  assert.equal(total + result.remaining[0].minutes, 720);
  assert.equal(result.days[0].minutes, total);
  assert.equal(schedule([urgent], [], DEFAULT_PLANNER, false, 22 * 60).blocks.length, 0);
  const noOverlap = schedule([urgent], [], { ...DEFAULT_PLANNER, end: "21:00" });
  assert.ok(noOverlap.blocks.filter((b) => b.evening).every((b) => b.start >= "21:00" && b.end <= "22:00"));
});

test("evenings are not for undated, later-week or overdue work and respect weekends and continuity", () => {
  const blockedWeek = Array.from({ length: 5 }, (_, i) => event(`day-${i}`, `2030-05-${13 + i}`, "09:00", "18:00"));
  for (const due of [undefined, "2030-05-20", "2030-05-12"]) {
    assert.equal(schedule([task("not-urgent", { due, estimateMinutes: 60 })], blockedWeek).blocks.length, 0);
  }
  const weekend = task("weekend", { due: "2030-05-19", startDate: "2030-05-18", estimateMinutes: 60 });
  assert.equal(schedule([weekend], blockedWeek).blocks.length, 0);
  const continuous = task("lab", { due: today, estimateMinutes: 180, workPlan: { continuous: true, blocks: [] } });
  const intact = schedule([continuous], [blockedWeek[0]]);
  assert.equal(intact.blocks.length, 1);
  assert.deepEqual([intact.blocks[0].start, intact.blocks[0].end, intact.blocks[0].evening], ["19:00", "22:00", true]);
  assert.equal(schedule([continuous], [blockedWeek[0], event("call", today, "20:00", "20:30")]).blocks.length, 0);
});

test("retained evening effort consumes overflow budget, not the normal allowance", () => {
  const existing = task("existing", { workPlan: { continuous: false, blocks: [{ id: "evening", date: today, start: "19:00", end: "20:30", evening: true }] } });
  const urgent = task("urgent", { due: today, estimateMinutes: 720 });
  const result = scheduleWeek([existing, urgent], [], [defaultSelection(urgent)], DEFAULT_PLANNER, today, 480, false);
  assert.equal(result.blocks.filter((b) => !b.evening).reduce((s, b) => s + blockMinutes(b), 0), 240);
  const extra = result.blocks.filter((b) => b.evening);
  assert.ok(extra.length > 0 && extra.every((b) => b.start >= "20:45"));
  assert.ok(extra.reduce((s, b) => s + blockMinutes(b), 90) <= 180);
  assert.ok(result.days[0].minutes <= 420);
  assert.deepEqual(validatePlannerOptions({ start: "09:00", end: "18:00", dailyMinutes: 240, weekends: false }), DEFAULT_PLANNER);
  assert.throws(() => validatePlannerOptions({ ...DEFAULT_PLANNER, deadlineEvenings: "yes" }));
});

// Fixed seed, no wall-clock dependence. Fragmented calendar fuzzing checks the
// scheduler's safety properties rather than requiring one particular packing.
test("generated weeks never overlap busy time or themselves", () => {
  let seed = 17;
  const random = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let run = 0; run < 100; run++) {
    const events = Array.from({ length: 8 }, (_, i) => { const start = 9 + random(8); return event(String(i), `2030-05-${13 + random(5)}`, `${String(start).padStart(2, "0")}:00`, `${String(start + 1).padStart(2, "0")}:00`); });
    const tasks = Array.from({ length: 6 }, (_, i) => task(String(i), { estimateMinutes: (1 + random(8)) * 30, due: `2030-05-${13 + random(5)}` }));
    const result = schedule(tasks, events);
    assert.ok(result.days.every((day) => day.minutes <= 420));
    for (const b of result.blocks) {
      if (b.evening) assert.ok(b.start >= "19:00" && b.end <= "22:00");
      else assert.ok(b.start >= "09:00" && b.end <= "18:00");
      assert.ok(b.date <= tasks.find((t) => t.id === b.todoId).due);
      for (const e of events.filter((e) => e.date === b.date)) assert.ok(b.end <= e.start || b.start >= e.end);
      for (const other of result.blocks.filter((o) => o !== b && o.date === b.date)) assert.ok(b.end <= other.start || b.start >= other.end);
    }
    for (const t of tasks) assert.equal(result.blocks.filter((b) => b.todoId === t.id).reduce((s, b) => s + blockMinutes(b), 0) + (result.remaining.find((r) => r.id === t.id)?.minutes ?? 0), t.estimateMinutes);
  }
});
