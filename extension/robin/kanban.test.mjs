process.env.TZ = "America/Los_Angeles";
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareKanbanTodos, calendarCapacity, DEFAULT_PLANNING, inKanbanView, needsReview, planningCandidates, validatePlanningOptions, validateSuggestion } from "./kanban.ts";

const today = "2030-05-13"; // Monday
const task = (extra = {}) => ({ id: "a", title: "A task", done: false, createdAt: "2030-05-01T00:00:00Z", ...extra });
const event = (start, end, extra = {}) => ({ id: "event", title: "Busy", date: today, start, end, createdAt: "", ...extra });
const options = { ...DEFAULT_PLANNING, dailyMinutes: 180 };
const proposal = (extra = {}) => ({ items: [{ id: "a", plannedOn: today, estimateMinutes: 30, reason: "Finish it", ...extra }] });

test("focus is deliberate: deadlines do not auto-select tasks; Monday-first weeks and local completion dates", () => {
  assert.equal(inKanbanView(task({ due: today }), "today", today), false);
  assert.equal(inKanbanView(task({ plannedOn: today }), "today", today), true);
  assert.equal(inKanbanView(task({ plannedOn: "2030-05-19" }), "week", today), true);
  assert.equal(inKanbanView(task({ plannedOn: "2030-05-20" }), "week", today), false);
  assert.equal(inKanbanView(task({ done: true, completedAt: "2030-05-14T02:00:00Z" }), "today", today), true);
  assert.equal(inKanbanView(task({ archivedAt: "x" }), "pool", today), false);
  assert.equal(inKanbanView(task({ archivedAt: "x" }), "archive", today), true);
});

test("overdue and missed plans require review, then recur after the seven-day decision window", () => {
  const overdue = task({ due: "2030-05-12" });
  assert.equal(needsReview(overdue, today), true);
  assert.equal(needsReview(task({ plannedOn: "2030-05-12" }), today), true);
  assert.equal(inKanbanView(overdue, "pool", today), false);
  assert.equal(inKanbanView(overdue, "review", today), true);
  assert.equal(needsReview({ ...overdue, reviewAfter: "2030-05-20" }, today), false);
  assert.equal(needsReview({ ...overdue, reviewAfter: "2030-05-20" }, "2030-05-20"), true);
  assert.equal(needsReview({ ...overdue, done: true }, today), false);
  assert.equal(needsReview({ ...overdue, archivedAt: "x" }, today), false);
  assert.deepEqual(planningCandidates([overdue, task({ id: "planned", plannedOn: today }), task()], today).map((todo) => todo.id), ["a"]);
});

test("ongoing and explicitly-next work remains visible across days without silently changing plans", () => {
  const ongoing = task({ status: "doing", plannedOn: "2030-05-12", due: "2030-05-12" });
  const next = task({ next: true, plannedOn: "2030-05-12" });
  for (const todo of [ongoing, next]) {
    for (const view of ["today", "week", "pool", "review"]) assert.equal(inKanbanView(todo, view, today), true);
    assert.equal(needsReview(todo, today), true);
    assert.equal(todo.plannedOn, "2030-05-12");
    assert.equal(inKanbanView({ ...todo, archivedAt: "x" }, "today", today), false);
  }
  assert.equal(inKanbanView(task({ next: true }), "today", today), true);
  assert.equal(inKanbanView(task({ status: "doing" }), "today", today), true);
  assert.equal(inKanbanView(task(), "today", today), false);
  const tasks = [task({ id: "due", due: today }), task({ id: "next", next: true }), task({ id: "later" })];
  assert.deepEqual(tasks.sort(compareKanbanTodos).map((todo) => todo.id), ["next", "due", "later"]);
});

test("capacity unions overlapping and duplicated meetings and never allocates elapsed time", () => {
  const events = [event("09:00", "10:00"), event("09:00", "10:00", { id: "google-copy" }), event("09:30", "11:00")];
  const [day] = calendarCapacity(events, [], today, 9 * 60 + 5, options);
  assert.deepEqual(day.gaps, [[11 * 60, 18 * 60]]);
  assert.equal(day.freeMinutes, 420);
  assert.equal(day.remainingMinutes, 180);
  assert.equal(calendarCapacity([], [], today, 19 * 60, options)[0].remainingMinutes, 0);
});

test("calendar edge cases are explicit: all-day policy, unknown end, spanning timed events", () => {
  const allDay = event(undefined, undefined);
  assert.equal(calendarCapacity([allDay], [], today, 0, options)[0].allDayCount, 1);
  assert.equal(calendarCapacity([allDay], [], today, 0, options)[0].remainingMinutes, 180);
  assert.equal(calendarCapacity([allDay], [], today, 0, { ...options, allDayBusy: true })[0].remainingMinutes, 0);
  const unknown = calendarCapacity([event("09:00", undefined)], [], today, 0, options)[0];
  assert.equal(unknown.unknownEnds, 1);
  assert.equal(unknown.freeMinutes, 480);
  const spanning = event("17:00", "10:00", { date: "2030-05-12", endDate: "2030-05-14" });
  const days = calendarCapacity([spanning], [], today, 0, { ...options, horizon: "week" });
  assert.equal(days[0].freeMinutes, 0);
  assert.equal(days[1].freeMinutes, 480);
  assert.equal(days.length, 7);
});

test("existing tasks consume budget and slots; finished tasks consume budget but not future gaps", () => {
  const todo = task({ plannedOn: today, estimateMinutes: 60 });
  const [day] = calendarCapacity([], [todo], today, 0, options);
  assert.equal(day.remainingMinutes, 120);
  assert.equal(day.remainingTasks, 2);
  assert.equal(day.gaps[0][0], 600);
  const finished = calendarCapacity([], [{ ...todo, done: true }], today, 0, options)[0];
  assert.equal(finished.remainingMinutes, 120);
  assert.equal(finished.gaps[0][0], 540);
  const unknown = calendarCapacity([], [task({ plannedOn: today })], today, 0, options)[0];
  assert.equal(unknown.unknownEstimates, 1);
  assert.equal(unknown.plannedMinutes, 30);
  const overbooked = calendarCapacity([], [task({ plannedOn: today, estimateMinutes: 240 })], today, 0, options)[0];
  assert.equal(overbooked.overbooked, true);
  assert.equal(overbooked.remainingMinutes, 0);
});

test("model output is bounded by identity, dates, estimates, task count and actual free gaps", () => {
  const todos = [task({ due: today }), task({ id: "b" }), task({ id: "c" }), task({ id: "d" })];
  const capacity = calendarCapacity([], [], today, 0, options);
  assert.deepEqual(validateSuggestion(proposal(), todos, today, capacity), proposal());
  for (const invalid of [{ id: "invented" }, { plannedOn: "2030-05-14" }, { estimateMinutes: 1 }, { estimateMinutes: 800 }, { estimateMinutes: "30" }]) {
    assert.throws(() => validateSuggestion(proposal(invalid), todos, today, capacity));
  }
  assert.throws(() => validateSuggestion({ items: [...proposal().items, ...proposal().items] }, todos, today, capacity), /unavailable/);
  assert.throws(() => validateSuggestion({ items: todos.map((todo) => ({ ...proposal().items[0], id: todo.id })) }, todos, today, capacity), /capacity/);
  assert.throws(() => validateSuggestion(proposal(), [task({ estimateMinutes: 60 })], today, capacity), /own time estimate/);
  const fragmented = calendarCapacity([event("09:20", "17:40")], [], today, 0, options);
  assert.equal(fragmented[0].remainingMinutes, 40);
  assert.throws(() => validateSuggestion(proposal(), todos, today, fragmented), /capacity/);
  assert.throws(() => validateSuggestion(proposal(), [task({ startDate: "2030-05-14" })], today, capacity), /before/);
});

test("planning preferences reject malformed time windows and invalid budgets", () => {
  assert.deepEqual(validatePlanningOptions(options), options);
  for (const patch of [{ start: "25:00" }, { end: "08:00" }, { dailyMinutes: -1 }, { dailyMinutes: "120" }, { horizon: "year" }, { allDayBusy: "yes" }]) {
    assert.throws(() => validatePlanningOptions({ ...options, ...patch }));
  }
});
