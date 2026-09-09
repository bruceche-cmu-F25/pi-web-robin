import assert from "node:assert/strict";
import { test } from "node:test";
import { groupAgendaItems } from "./agenda.ts";

const event = (id, date) => ({ id, title: id, date, createdAt: "" });
const todo = (id, due, done = false, patch = {}) => ({ id, title: id, due, done, createdAt: "", ...patch });

test("groupAgendaItems merges dated open todos with calendar days", () => {
  const days = groupAgendaItems(
    [event("meeting", "2026-08-18")],
    [todo("prepare", "2026-08-18"), todo("apply", "2026-08-19")],
  );

  assert.deepEqual(days.map(({ date, events, todos }) => [
    date,
    events.map(({ id }) => id),
    todos.map(({ id }) => id),
  ]), [
    ["2026-08-18", ["meeting"], ["prepare"]],
    ["2026-08-19", [], ["apply"]],
  ]);
});

test("groupAgendaItems shows a ranged todo once, when its visible work starts", () => {
  const task = todo("report", "2026-08-21", false, { startDate: "2026-08-17" });
  assert.deepEqual(
    groupAgendaItems([], [task], "2026-08-19").map(({ date, todos }) => [date, todos.map(({ id }) => id)]),
    [["2026-08-19", ["report"]]],
  );
});

test("groupAgendaItems omits completed and undated todos", () => {
  const days = groupAgendaItems([], [todo("done", "2026-08-18", true), todo("someday")]);
  assert.deepEqual(days, []);
});
