/** Read-only timetable projection; never moves or creates a reservation. */
import { addDays } from "../../extension/robin/dates.ts";
import { deduplicateCalendarEvents, occursOn, type DashboardEvent } from "../../extension/robin/events.ts";
import { layoutDayEvents } from "../../extension/robin/layout.ts";
import { blockHasEnded, blockIsFuture, clock, DEFAULT_PLANNER, minute, plannerEventBlocksTime, type PlannerOptions } from "../../extension/robin/planner.ts";
import type { PlannerProposal } from "../../extension/robin/planner-domain.ts";
import type { Todo } from "../../extension/robin/todo-domain.ts";

export interface TimelineEntry extends DashboardEvent {
  kind: "fixed" | "confirmed" | "proposed" | "logged" | "reminder";
  todo?: Todo;
  evening?: boolean;
}
export interface TimelineSource { today: string; to: string; minuteOfDay: number; timezone: string; events: DashboardEvent[]; todos: Todo[] }
export function timelineDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let date = from; date <= to && days.length < 7; date = addDays(date, 1)) days.push(date);
  return days;
}
export function timelineEntries(data: TimelineSource, proposal: PlannerProposal | null): TimelineEntry[] {
  // Replacement semantics belong to the shown snapshot, not the wall clock a
  // later poll brought in while the user was reading it.
  let anchorMinute = data.minuteOfDay;
  if (proposal) {
    const parts = new Intl.DateTimeFormat("en", { timeZone: data.timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(proposal.generatedAt));
    const part = (name: string) => Number(parts.find((p) => p.type === name)?.value ?? 0);
    anchorMinute = part("hour") * 60 + part("minute") + part("second") / 60;
  }
  const selected = new Set(proposal?.selected.map((s) => s.id));
  const existing: TimelineEntry[] = data.todos.flatMap((todo) => (todo.workPlan?.blocks ?? [])
    .filter((block) => block.date >= data.today && block.date <= data.to && (block.done || !blockHasEnded(block, data.today, anchorMinute))
      && (block.done || !proposal?.replace || !selected.has(todo.id) || !blockIsFuture(block, data.today, anchorMinute)))
    .map((block) => ({ ...block, id: `kept:${todo.id}:${block.id}`, title: todo.title, todo, createdAt: todo.createdAt, kind: block.done ? "logged" as const : "confirmed" as const })));
  return [
    ...deduplicateCalendarEvents(data.events.filter((e) => e.source !== "planner")).map((e): TimelineEntry => ({ ...e, kind: plannerEventBlocksTime(e) ? "fixed" : "reminder" })),
    ...existing,
    ...(proposal?.plan.blocks ?? []).map((block, i): TimelineEntry => {
      const todo = data.todos.find((t) => t.id === block.todoId);
      return { ...block, id: `proposed:${i}`, title: todo?.title ?? block.todoId, todo, kind: "proposed", createdAt: "" };
    }),
  ];
}
export function timelineRange(options: PlannerOptions, entries: TimelineEntry[] = []): { first: number; last: number } {
  // A native time input can briefly be empty while editing. Keep a legible
  // chart rather than throwing before the server validates the preference.
  try {
    // Focus slots outside the normal window (including retained evening work)
    // must stay on the grid, even after the user disables future evening overflow.
    const focus = entries.filter((e) => e.todo && e.start && e.end);
    const first = Math.floor(Math.min(minute(options.start), ...focus.map((e) => minute(e.start!))) / 60) * 60;
    const last = Math.ceil(Math.max(minute(options.end), ...focus.map((e) => minute(e.end!))) / 60) * 60;
    if (last > first) return { first, last };
  } catch { /* Invalid draft preference: show the default window. */ }
  return { first: minute(DEFAULT_PLANNER.start), last: minute(DEFAULT_PLANNER.end) };
}
export function timelineDay(entries: TimelineEntry[], date: string, first: number, last: number) {
  const allDay: TimelineEntry[] = [], outside: TimelineEntry[] = [], segments: TimelineEntry[] = [];
  for (const event of entries.filter((entry) => occursOn(entry, date))) {
    if (!plannerEventBlocksTime(event)) { allDay.push(event); continue; }
    const start = event.date < date ? 0 : minute(event.start);
    const end = (event.endDate ?? event.date) > date ? 1440 : minute(event.end);
    if (end <= first || start >= last) { outside.push(event); continue; }
    segments.push({ ...event, date, endDate: undefined, start: clock(Math.max(first, start)), end: clock(Math.min(last, end)) });
  }
  return { allDay, outside, timed: layoutDayEvents(segments, 1).map((item) => ({ ...item, event: entries.find((entry) => entry.id === item.event.id)! })) };
}
