import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarDays, calendarView, stepCalendar } from "./calendar-view.ts";

test("month means the complete natural month, with adjacent days filling whole weeks", () => {
  const days = calendarDays("month", "2030-05-19");
  assert.equal(days[0], "2030-04-29");
  assert.equal(days.at(-1), "2030-06-02");
  assert.equal(days.length, 35);
  assert.equal(calendarDays("month", "2026-08-14").length, 42);
  assert.ok(calendarDays("month", "2028-02-10").includes("2028-02-29"));
});
test("period navigation moves by calendar month, week or day and crosses year boundaries", () => {
  assert.equal(stepCalendar("month", "2030-01-31", 1), "2030-02-01");
  assert.equal(stepCalendar("month", "2030-12-01", 1), "2031-01-01");
  assert.equal(stepCalendar("month", "2030-01-01", -1), "2029-12-01");
  assert.equal(stepCalendar("week", "2030-05-13", 1), "2030-05-20");
  assert.equal(stepCalendar("day", "2030-12-31", 1), "2031-01-01");
  assert.deepEqual(calendarDays("day", "2030-05-13"), ["2030-05-13"]);
  assert.equal(calendarView("day"), "day");
  assert.equal(calendarView("invalid"), null);
});
