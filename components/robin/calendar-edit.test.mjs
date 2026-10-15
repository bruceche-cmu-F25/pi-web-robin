import assert from "node:assert/strict";
import { test } from "node:test";
import { eventFields, moveEvent, newEventAt, selectEventRange, resizeEvent, moveTodo } from "./calendar-edit.ts";

const timed = { id: "a", title: "Meeting", date: "2030-03-09", start: "09:00", end: "10:30", location: "Office" };
test("week movement snaps to 15 minutes, keeps duration, and never mutates input", () => {
  const moved = moveEvent(timed, { date: timed.date, minute: 555 }, { date: "2030-03-10", minute: 628 });
  assert.deepEqual(moved, { ...eventFields(timed), date: "2030-03-10", start: "10:15", end: "11:45" });
  assert.equal(timed.start, "09:00");
});
test("horizontal or returned-to-origin week drags preserve off-grid start times", () => {
  for (const start of ["09:07", "23:59"]) {
    const event = { ...timed, start, end: undefined };
    const origin = { date: timed.date, minute: 555 };
    assert.deepEqual(moveEvent(event, origin, { ...origin }), eventFields(event));
    assert.deepEqual(moveEvent(event, origin, { ...origin, date: "2030-03-10", minute: 556 }),
      { ...eventFields(event), date: "2030-03-10" });
  }
});

test("month movement preserves times; cross-week grabbed-day offset preserves inclusive spans", () => {
  assert.deepEqual(moveEvent(timed, { date: timed.date }, { date: "2030-04-01" }), { ...eventFields(timed), date: "2030-04-01" });
  const trip = { title: "Trip", date: "2030-03-08", endDate: "2030-03-12" };
  assert.deepEqual(moveEvent(trip, { date: "2030-03-11" }, { date: "2030-03-14" }), eventFields({ ...trip, date: "2030-03-11", endDate: "2030-03-15" }));
});
test("movement uses calendar days across DST and year boundaries", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const trip = { title: "DST", date: "2030-03-09", endDate: "2030-03-12" };
    assert.equal(moveEvent(trip, { date: trip.date }, { date: "2030-03-11" }).endDate, "2030-03-14");
    assert.equal(moveEvent(trip, { date: trip.date }, { date: "2030-12-31" }).endDate, "2031-01-03");
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test("late moves use the next date rather than invalid 24:00 or shortening duration", () => {
  const moved = moveEvent(timed, { date: timed.date, minute: 540 }, { date: timed.date, minute: 1425 });
  assert.equal(moved.start, "23:45"); assert.equal(moved.end, "01:15"); assert.equal(moved.endDate, "2030-03-10");
  const unknownEnd = moveEvent({ ...timed, end: undefined }, { date: timed.date, minute: 540 }, { date: timed.date, minute: 1425 });
  assert.equal(unknownEnd.end, ""); assert.equal(unknownEnd.endDate, "");
  const early = moveEvent(timed, { date: timed.date, minute: 600 }, { date: timed.date, minute: 0 });
  assert.equal(early.start, "00:00"); assert.equal(early.end, "01:30");
});
test("moving between bands never silently converts timed/all-day events", () => {
  const trip = { title: "Trip", date: timed.date, endDate: "2030-03-11" };
  assert.equal(moveEvent(trip, { date: timed.date }, { date: "2030-03-10", minute: 540 }).start, "");
  assert.equal(moveEvent(timed, { date: timed.date, minute: 540 }, { date: "2030-03-10" }).start, "09:00");
});
test("range creation is reversible, includes the selected slot, and handles midnight", () => {
  const a = { date: "2030-05-13", minute: 555 }, b = { date: "2030-05-13", minute: 628 };
  assert.deepEqual(selectEventRange(a, b), eventFields({ date: a.date, start: "09:15", end: "10:30" }));
  assert.deepEqual(selectEventRange(b, a), selectEventRange(a, b));
  assert.deepEqual(selectEventRange({ date: "2030-12-31", minute: 1435 }, { date: "2031-01-01", minute: 10 }),
    eventFields({ date: "2030-12-31", endDate: "2031-01-01", start: "23:45", end: "00:15" }));
  assert.deepEqual(selectEventRange({ date: "2031-01-02" }, { date: "2030-12-31" }),
    eventFields({ date: "2030-12-31", endDate: "2031-01-02" }));
});
test("resize changes only the end and cannot invert or emit 24:00", () => {
  assert.deepEqual(resizeEvent(timed, { date: timed.date, minute: 647 }), { ...eventFields(timed), end: "10:45" });
  assert.equal(resizeEvent(timed, { date: timed.date, minute: 300 }).end, "09:15");
  assert.deepEqual(resizeEvent(timed, { date: timed.date, minute: 1439 }),
    { ...eventFields(timed), end: "00:00", endDate: "2030-03-10" });
  assert.deepEqual(resizeEvent(timed, { date: timed.date }), eventFields(timed));
});

test("todo drops assign dates, preserve ranges and grabbed-day offsets without changing the source", () => {
  const task = { startDate: "2030-05-10", due: "2030-05-15" };
  assert.deepEqual(moveTodo({}, null, { date: "2030-05-20", minute: 600 }), { startDate: "", due: "2030-05-20" });
  assert.deepEqual(moveTodo({ due: "2030-05-13" }, { date: "2030-05-13" }, { date: "2030-05-13", minute: 700 }), { startDate: "", due: "2030-05-13" });
  assert.deepEqual(moveTodo(task, null, { date: "2030-05-20" }), { startDate: "2030-05-15", due: "2030-05-20" });
  assert.deepEqual(moveTodo(task, { date: "2030-05-13" }, { date: "2030-05-16" }), { startDate: "2030-05-13", due: "2030-05-18" });
  assert.deepEqual(task, { startDate: "2030-05-10", due: "2030-05-15" });
});
test("todo movement crosses DST and year boundaries by calendar day", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const task = { startDate: "2030-03-09", due: "2030-03-12" };
    assert.deepEqual(moveTodo(task, { date: "2030-03-09" }, { date: "2030-03-11" }), { startDate: "2030-03-11", due: "2030-03-14" });
    assert.deepEqual(moveTodo(task, { date: "2030-03-09" }, { date: "2030-12-31" }), { startDate: "2030-12-31", due: "2031-01-03" });
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("creation seeds all-day or a snapped one-hour slot including midnight", () => {
  assert.deepEqual(newEventAt({ date: timed.date }), eventFields({ date: timed.date }));
  assert.equal(newEventAt({ date: timed.date, minute: 556 }).start, "09:15");
  assert.deepEqual(newEventAt({ date: timed.date, minute: 1439 }), eventFields({ date: timed.date, start: "23:45", end: "00:45", endDate: "2030-03-10" }));
});
