import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarTaskPreview } from "./calendar-task-layout.ts";
import { weekDays } from "../../extension/robin/dates.ts";

const days = weekDays("2030-05-13");
const task = (id, extra = {}) => ({ id, title: id, due: days[0], done: false, ...extra });

test("each date has at most three previews and an exact, local overflow count", () => {
  const todos = days.flatMap((due, day) => Array.from({ length: day + 1 }, (_, i) => task(`${day}-${i}`, { due })));
  const result = calendarTaskPreview(todos, days);
  assert.equal(result.total, 28);
  for (const [index, day] of result.days.entries()) {
    assert.equal(day.todos.length, index + 1);
    assert.equal(day.hidden, Math.max(0, index - 2));
    assert.equal(result.visible.filter((bar) => bar.startIndex <= index && bar.endIndex >= index).length, Math.min(3, index + 1));
  }
});

test("cross-week ranges remain one continuous bar and hidden ranges count on every covered day", () => {
  const todos = Array.from({ length: 4 }, (_, i) => task(`range-${i}`, { startDate: "2030-05-10", due: "2030-05-22" }));
  todos.push(task("one-day", { due: days[3] }));
  const result = calendarTaskPreview(todos, days);
  assert.equal(result.visible.length, 3);
  assert.ok(result.visible.every((bar) => bar.startIndex === 0 && bar.endIndex === 6 && bar.continuesBefore && bar.continuesAfter));
  assert.deepEqual(result.days.map((day) => day.hidden), [1, 1, 1, 2, 1, 1, 1]);
  assert.ok(result.days.every((day) => day.todos.filter((todo) => todo.id === "range-3").length === 1));
  assert.equal(todos[0].startDate, "2030-05-10", "preview clipping never rewrites task dates");
});

test("day view is bounded too, and completed/archived/undated/outside tasks never enter counts", () => {
  const todos = Array.from({ length: 5 }, (_, i) => task(`task-${i}`));
  todos.push(task("done", { done: true }), task("archived", { archivedAt: "2030-01-01" }), task("undated", { due: undefined }), task("outside", { due: "2031-01-01" }));
  const result = calendarTaskPreview(todos, [days[0]]);
  assert.equal(result.total, 5);
  assert.equal(result.visible.length, 3);
  assert.equal(result.days[0].hidden, 2);
  assert.equal(calendarTaskPreview(todos.filter((todo) => todo.id !== "task-0"), [days[0]]).days[0].hidden, 1);
  assert.deepEqual(calendarTaskPreview([], days).visible, []);
  assert.equal(calendarTaskPreview(todos, []).total, 0);
});
