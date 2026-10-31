import assert from "node:assert/strict";
import test from "node:test";
import { dailyEventPreview, dashboardView, eventRecordHref, nearbyTodos, todoRecordHref, upcomingEvents } from "./dashboard-view.ts";

test("phone destinations are explicit; old bookmarks and record links still resolve", () => {
  const view = (search, hash) => dashboardView(new URLSearchParams(search), hash);
  assert.equal(view(""), "daily");
  assert.equal(view("calendar=week"), "calendar");
  assert.equal(view("view=daily&calendar=week"), "daily");
  assert.equal(view("view=more&todo=task"), "todos");
  assert.equal(view("view=todos&event=appointment"), "calendar");
  assert.equal(view("view=nonsense"), "daily");
  assert.equal(view("", "#dashboard-todos"), "todos");
  assert.equal(view("", "#dashboard-links"), "more");
  assert.equal(new URL(todoRecordHref("task/银行?#"), "https://local.invalid").searchParams.get("todo"), "task/银行?#");
  const eventLink = new URL(eventRecordHref({ id: "g/a#", date: "2030-05-13" }), "https://local.invalid");
  assert.equal(eventLink.searchParams.get("event"), "g/a#");
  assert.equal(eventLink.searchParams.has("calendar"), false, 'Record links must not force the timeline back to agenda');
});

test("upcoming includes ongoing spans and unknown ends, not finished appointments", () => {
  const events = [
    { id: "past", title: "Finished", date: "2030-05-13", start: "09:00", end: "10:00" },
    { id: "unknown", title: "Unknown end", date: "2030-05-13", start: "09:00" },
    { id: "all-day", title: "No hour", date: "2030-05-13" },
    { id: "trip", title: "Trip", date: "2030-05-12", endDate: "2030-05-14", start: "08:00", end: "09:00" },
    { id: "next", title: "Meeting", date: "2030-05-13", start: "15:00", end: "16:00" },
    { id: "duplicate", title: "Meeting", date: "2030-05-13", start: "15:00", end: "16:00" },
  ];
  assert.deepEqual(upcomingEvents(events, "2030-05-13", "14:00").map(e => e.id), ["trip", "all-day", "unknown", "next"]);
});

test("today features ongoing then upcoming timed entries without hiding the rest", () => {
  const date = "2030-05-13";
  const events = [
    { id: "past", title: "Earlier", date, start: "08:00", end: "09:00" },
    { id: "unknown", title: "Unknown end", date, start: "09:00" },
    { id: "all-day", title: "All day", date },
    { id: "now", title: "Meeting", date, start: "10:00", end: "11:00" },
    { id: "duplicate", title: "Meeting", date, start: "10:00", end: "11:00" },
    { id: "next", title: "Next", date, start: "14:00", end: "15:00" },
  ];
  const preview = time => dailyEventPreview(events, date, date, time);
  assert.equal(preview("10:30").featured.id, "now");
  assert.equal(preview("10:30").phase, "ongoing");
  assert.deepEqual(preview("10:30").others.map(e => e.id), ["all-day", "past", "unknown", "next"]);
  assert.equal(preview("11:00").featured.id, "next", "An exact end is no longer ongoing");
  assert.equal(preview("11:00").phase, "next");
  assert.equal(preview("15:00").featured.id, "all-day");
  assert.equal(preview("15:00").phase, null, "An all-day record isn't a timed appointment");
  const unknown = dailyEventPreview([events[1]], date, date, "15:00");
  assert.equal(unknown.featured.id, "unknown");
  assert.equal(unknown.phase, "started", "Never guess that a missing end means finished or ongoing");
  const finished = dailyEventPreview([events[0]], date, date, "15:00");
  assert.equal(finished.featured, undefined);
  assert.equal(finished.others[0].id, "past", "Finished entries remain available");
  assert.equal(dailyEventPreview(events, date, "2030-05-14", "10:30").featured.id, "all-day");
  assert.equal(dailyEventPreview(events, date, "2030-05-12", "10:30").phase, null);
  assert.equal(dailyEventPreview(events, date, date).phase, null, "No clock means no timing claim");
  assert.deepEqual(dailyEventPreview([], date, date, "10:30").others, []);
});

test("today respects inclusive multi-day end dates and their actual end time", () => {
  const event = { id: "trip", title: "Trip", date: "2030-05-12", endDate: "2030-05-14", start: "20:00", end: "09:00" };
  assert.equal(dailyEventPreview([event], "2030-05-13", "2030-05-13", "14:00").phase, "ongoing");
  assert.equal(dailyEventPreview([event], "2030-05-14", "2030-05-14", "08:59").phase, "ongoing");
  assert.equal(dailyEventPreview([event], "2030-05-14", "2030-05-14", "09:00").featured, undefined);
});

test("attention uses deadlines, never promotes undated intentions or planned dates to deadlines", () => {
  const tasks = [
    { id: "later", due: "2030-05-20" }, { id: "today", due: "2030-05-13" },
    { id: "wish", plannedOn: "2030-05-13" }, { id: "done", due: "2030-05-13", done: true },
    { id: "archived", due: "2030-05-13", archivedAt: "2030-05-12" }, { id: "late", due: "2030-05-12" },
  ];
  assert.deepEqual(nearbyTodos(tasks, "2030-05-13").map(t => t.id), ["late", "today"]);
});
