import assert from "node:assert/strict";
import { test } from "node:test";
import { timelineDay, timelineDays, timelineEntries, timelineRange } from "./planner-timeline.ts";
import { DEFAULT_PLANNER } from "../../extension/robin/planner.ts";
const today = "2030-05-13";
const entry = (id, patch = {}) => ({ id, title: id, date: today, start: "09:00", end: "10:00", kind: "fixed", createdAt: "", ...patch });

test("true-duration time coordinates and shared overlap lanes", () => {
  const items = [entry("short", { start: "09:00", end: "09:05" }), entry("next", { start: "09:10", end: "10:10" }), entry("overlap", { start: "09:30", end: "10:00" })];
  const { timed } = timelineDay(items, today, 540, 1080);
  assert.equal(timed[0].endMinutes - timed[0].startMinutes, 5, "five minutes must not be drawn as thirty");
  assert.equal(timed[0].columns, 1);
  assert.equal(timed[1].columns, 2);
  assert.notEqual(timed[1].column, timed[2].column);
  assert.equal(timed[1].endMinutes - timed[1].startMinutes, 60);
});

test("missing ends remain in the reminder band without a fictional duration; complete spans are clipped", () => {
  const unknown = entry("unknown", { start: "15:00", end: undefined });
  const { timed, allDay } = timelineDay([unknown], today, 540, 1080);
  assert.deepEqual(timed, []);
  assert.deepEqual(allDay, [unknown], "the known start is retained for inspection");
  const trip = entry("trip", { date: "2030-05-12", endDate: "2030-05-14", start: "17:00", end: "11:00" });
  assert.deepEqual(timelineDay([trip], today, 540, 1080).timed.map((e) => [e.startMinutes, e.endMinutes]), [[540, 1080]]);
  assert.deepEqual(timelineDay([trip], "2030-05-14", 540, 1080).timed.map((e) => [e.startMinutes, e.endMinutes]), [[540, 660]]);
});

test("all-day and off-window events remain discoverable, clipped blocks retain original detail", () => {
  const outside = entry("early", { start: "07:00", end: "08:00" });
  const allDay = entry("off", { start: undefined, end: undefined });
  const crosses = entry("crosses", { start: "08:00", end: "09:30" });
  const day = timelineDay([outside, allDay, crosses], today, 540, 1080);
  assert.deepEqual(day.outside, [outside]);
  assert.deepEqual(day.allDay, [allDay]);
  assert.equal(day.timed[0].startMinutes, 540);
  assert.equal(day.timed[0].event.start, "08:00");
  assert.deepEqual(timelineRange({ ...DEFAULT_PLANNER, start: "" }), { first: 540, last: 1080 });
  assert.equal(timelineDays(today, "2030-05-19").length, 7);
});

test("reminders remain visible but are no longer depicted as fixed commitments", () => {
  const data = { today, to: "2030-05-19", timezone: "America/Los_Angeles", minuteOfDay: 480, todos: [], events: [entry("reminder", { start: undefined, end: undefined }), entry("unknown-end", { end: undefined })] };
  const shown = timelineEntries(data, null);
  assert.ok(shown.every((e) => e.kind === "reminder"));
  assert.equal(timelineDay(shown, today, 540, 1080).allDay.length, 2);
  assert.equal(timelineDay(shown, today, 540, 1080).timed.length, 0);
});

test("the timeline collapses duplicate appointments without collapsing task slots", () => {
  const fixed = entry("google:original", { title: "OpenAI talk", source: "google", location: "https://forum.example/talk" });
  const todo = { id: "task", title: "Homework", createdAt: "", workPlan: { blocks: [
    { id: "one", date: today, start: "13:00", end: "14:00" },
    { id: "two", date: today, start: "15:00", end: "16:00" },
  ] } };
  const data = { today, to: "2030-05-19", timezone: "America/Los_Angeles", minuteOfDay: 480, todos: [todo], events: [fixed, { ...fixed, id: "google:copy" }] };
  const before = structuredClone(data);
  const shown = timelineEntries(data, null);
  assert.equal(shown.filter((e) => e.kind === "fixed").length, 1);
  assert.equal(shown.filter((e) => e.kind === "confirmed").length, 2);
  assert.deepEqual(data, before, "source records stay available to revision/race checks");
});

test("evening focus expands the time grid and remains visible with overflow disabled", () => {
  const todo = { id: "due", title: "Due today", createdAt: "", workPlan: { blocks: [{ id: "night", date: today, start: "19:00", end: "21:30", evening: true }] } };
  const data = { today, to: "2030-05-19", timezone: "America/Los_Angeles", minuteOfDay: 480, todos: [todo], events: [] };
  const entries = timelineEntries(data, null);
  assert.equal(entries[0].evening, true);
  const range = timelineRange({ ...DEFAULT_PLANNER, deadlineEvenings: false }, entries);
  assert.deepEqual(range, { first: 540, last: 1320 });
  const shown = timelineDay(entries, today, range.first, range.last);
  assert.equal(shown.timed.length, 1);
  assert.equal(shown.outside.length, 0);
  assert.deepEqual(timelineRange(DEFAULT_PLANNER), { first: 540, last: 1080 }, "no extra empty hours without actual focus slots");
});

test("proposal overlay retains unselected/logged slots and replaces only selected future slots", () => {
  const task = (id) => ({ id, title: id, createdAt: "", done: false, workPlan: { blocks: [{ id: "keep", date: today, start: "09:00", end: "10:00" }, { id: "done", date: today, start: "07:00", end: "08:00", done: true }] } });
  const data = { today, to: "2030-05-19", timezone: "America/Los_Angeles", minuteOfDay: 700, todos: [task("x"), task("y")], events: [entry("meeting")] };
  const proposal = { generatedAt: "2030-05-13T15:00:00Z", replace: true, selected: [{ id: "x" }], plan: { blocks: [{ todoId: "x", date: today, start: "13:00", end: "14:00" }] } };
  const entries = timelineEntries(data, proposal);
  assert.equal(entries.filter((e) => e.kind === "fixed").length, 1);
  assert.ok(entries.some((e) => e.id === "kept:y:keep"));
  assert.ok(!entries.some((e) => e.id === "kept:x:keep"));
  assert.equal(entries.filter((e) => e.kind === "logged").length, 2);
  assert.equal(entries.find((e) => e.kind === "proposed").title, "x");
  assert.equal(data.todos[0].workPlan.blocks[0].start, "09:00", "drawing never mutates a plan");
});
