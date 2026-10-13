/** Browser-safe focus, review and capacity rules. No calendar or task writes here. */
import { addDays, isInstantOnLocalDate, startOfWeek } from "./dates.ts";
import { occursOn, type DashboardEvent } from "./events.ts";
import type { Todo } from "./todo-domain.ts";
import { todoStatus } from "./todo-status.ts";

export const KANBAN_VIEWS = ["today", "week", "pool", "review", "archive"] as const;
export type KanbanView = typeof KANBAN_VIEWS[number];
export interface PlanningOptions {
  horizon: "today" | "week";
  start: string;
  end: string;
  dailyMinutes: number;
  allDayBusy: boolean;
}
export const DEFAULT_PLANNING: PlanningOptions = { horizon: "today", start: "09:00", end: "18:00", dailyMinutes: 120, allDayBusy: false };
export const MAX_DAILY_TASKS = 3;
export const UNKNOWN_ESTIMATE = 30;

export function needsReview(todo: Todo, today: string): boolean {
  return !todo.done && !todo.archivedAt
    && (!todo.reviewAfter || todo.reviewAfter <= today)
    && Boolean((todo.due && todo.due < today) || (todo.plannedOn && todo.plannedOn < today));
}

export function inKanbanView(todo: Todo, view: KanbanView, today: string): boolean {
  if (view === "archive") return Boolean(todo.archivedAt);
  if (todo.archivedAt) return false;
  if (view === "review") return needsReview(todo, today);
  // Review is an annotation, not a place to hide work already in progress or
  // explicitly chosen as next. Keep historical dates unchanged until reviewed.
  if (!todo.done && (todoStatus(todo) === "doing" || todo.next)) return true;
  if (needsReview(todo, today)) return false;
  if (view === "pool") return true;
  if (!today) return false;
  const from = view === "today" ? today : startOfWeek(today);
  const to = view === "today" ? today : addDays(from, 6);
  // Focus is a deliberate plan, never an inferred deadline. Completed work
  // remains visible for reflection even if it was not planned beforehand.
  return Boolean(todo.plannedOn && todo.plannedOn >= from && todo.plannedOn <= to)
    || (todo.done && Boolean(todo.completedAt) && (view === "today"
      ? isInstantOnLocalDate(todo.completedAt, today)
      : Array.from({ length: 7 }, (_, i) => addDays(from, i)).some((day) => isInstantOnLocalDate(todo.completedAt, day))));
}

/** Same ordering in board and list: next first, then deadlines; history newest first. */
export function compareKanbanTodos(a: Todo, b: Todo): number {
  return Number(Boolean(b.next)) - Number(Boolean(a.next))
    || (a.done && b.done
      ? (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt)
      : (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.createdAt.localeCompare(b.createdAt));
}

function minute(time: string): number {
  const [hour, minutes] = time.split(":").map(Number);
  return hour * 60 + minutes;
}

export function validatePlanningOptions(input: unknown): PlanningOptions {
  if (!input || typeof input !== "object") throw new Error("Planning options are required");
  const value = input as Record<string, unknown>;
  const time = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  if (value.horizon !== "today" && value.horizon !== "week") throw new Error("Unknown planning horizon");
  if (!time(value.start) || !time(value.end) || value.end <= value.start) throw new Error("Choose a valid daytime planning window");
  if (!Number.isInteger(value.dailyMinutes) || (value.dailyMinutes as number) < 15 || (value.dailyMinutes as number) > 720) throw new Error("Daily budget must be 15–720 minutes");
  if (typeof value.allDayBusy !== "boolean") throw new Error("allDayBusy must be a boolean");
  return { horizon: value.horizon, start: value.start, end: value.end, dailyMinutes: value.dailyMinutes as number, allDayBusy: value.allDayBusy };
}

export interface DayCapacity {
  date: string;
  /** Remaining wall-clock gaps, in minutes since local midnight. */
  gaps: [number, number][];
  freeMinutes: number;
  plannedMinutes: number;
  plannedCount: number;
  unknownEstimates: number;
  unknownEnds: number;
  allDayCount: number;
  remainingMinutes: number;
  remainingTasks: number;
  overbooked: boolean;
}

/** Place one uninterrupted work block, respecting fragmented free time. */
function reserve(gaps: [number, number][], minutes: number): boolean {
  const index = gaps.findIndex(([start, end]) => end - start >= minutes);
  if (index < 0) return false;
  gaps[index][0] += minutes;
  return true;
}

export function calendarCapacity(events: DashboardEvent[], todos: Todo[], today: string, nowMinute: number, options: PlanningOptions): DayCapacity[] {
  const endDate = options.horizon === "today" ? today : addDays(startOfWeek(today), 6);
  const days: DayCapacity[] = [];
  for (let date = today; date <= endDate; date = addDays(date, 1)) {
    const windowStart = Math.max(minute(options.start), date === today ? Math.ceil(nowMinute / 15) * 15 : 0);
    const windowEnd = minute(options.end);
    const dayEvents = events.filter((event) => occursOn(event, date));
    const allDayCount = dayEvents.filter((event) => !event.start).length;
    const unknownEnds = dayEvents.filter((event) => event.start && !event.end).length;
    const busy: [number, number][] = [];
    for (const event of dayEvents) {
      if (!event.start) {
        if (options.allDayBusy) busy.push([windowStart, windowEnd]);
        continue;
      }
      const start = event.date === date ? minute(event.start) : 0;
      const end = event.endDate && event.endDate > date ? 1440
        : event.end ? minute(event.end) : Math.min(1440, start + 60);
      busy.push([Math.max(windowStart, start), Math.min(windowEnd, end)]);
    }
    // Union of intervals naturally deduplicates local + Google copies and overlaps.
    busy.sort((a, b) => a[0] - b[0]);
    const gaps: [number, number][] = [];
    let cursor = windowStart;
    for (const [start, end] of busy) {
      if (end <= cursor || start >= windowEnd) continue;
      if (start > cursor) gaps.push([cursor, start]);
      cursor = Math.max(cursor, end);
    }
    if (cursor < windowEnd) gaps.push([cursor, windowEnd]);
    const freeMinutes = gaps.reduce((sum, [start, end]) => sum + end - start, 0);
    const planned = todos.filter((todo) => !todo.archivedAt && todo.plannedOn === date);
    const plannedMinutes = planned.reduce((sum, todo) => sum + (todo.estimateMinutes ?? UNKNOWN_ESTIMATE), 0);
    let fits = true;
    // Work already completed consumes the daily budget, not future free slots.
    for (const todo of planned.filter((entry) => !entry.done).sort((a, b) => (b.estimateMinutes ?? UNKNOWN_ESTIMATE) - (a.estimateMinutes ?? UNKNOWN_ESTIMATE))) {
      if (!reserve(gaps, todo.estimateMinutes ?? UNKNOWN_ESTIMATE)) fits = false;
    }
    const gapMinutes = gaps.reduce((sum, [start, end]) => sum + end - start, 0);
    days.push({
      date, gaps, freeMinutes, plannedMinutes, plannedCount: planned.length,
      unknownEstimates: planned.filter((todo) => !todo.estimateMinutes).length,
      unknownEnds, allDayCount,
      remainingMinutes: fits ? Math.max(0, Math.min(options.dailyMinutes - plannedMinutes, gapMinutes)) : 0,
      remainingTasks: Math.max(0, MAX_DAILY_TASKS - planned.length),
      overbooked: !fits || plannedMinutes > options.dailyMinutes || planned.length > MAX_DAILY_TASKS,
    });
  }
  return days;
}

export interface PlanItem { id: string; plannedOn: string; estimateMinutes: number; reason: string }
export interface PlanSuggestion { items: PlanItem[] }

export function planningCandidates(todos: Todo[], today: string): Todo[] {
  return todos.filter((todo) => !todo.done && !todo.archivedAt && !todo.plannedOn && !needsReview(todo, today));
}

/** Validate model AND browser input. Unknown ids, estimates and overbooking fail closed. */
export function validateSuggestion(input: unknown, todos: Todo[], today: string, capacity: DayCapacity[]): PlanSuggestion {
  const items = (input as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length > 21) throw new Error("Invalid plan: expected at most 21 tasks");
  const candidates = new Map(planningCandidates(todos, today).map((todo) => [todo.id, todo]));
  const available = structuredClone(capacity);
  const seen = new Set<string>();
  const validated: PlanItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") throw new Error("Invalid plan item");
    const { id, plannedOn, estimateMinutes, reason } = item as Record<string, unknown>;
    const todo = typeof id === "string" ? candidates.get(id) : undefined;
    const day = available.find((entry) => entry.date === plannedOn);
    if (!todo || !day || seen.has(todo.id)) throw new Error("Plan contains an unavailable task or date; regenerate it");
    if (!Number.isInteger(estimateMinutes) || (estimateMinutes as number) < 5 || (estimateMinutes as number) > 720) throw new Error("Estimate must be 5–720 minutes");
    const minutes = estimateMinutes as number;
    if (todo.estimateMinutes && minutes !== todo.estimateMinutes) throw new Error("The plan must respect your own time estimate");
    if (typeof reason !== "string" || reason.length > 500) throw new Error("A short reason is required");
    // Continuing an old deadline after review does not rewrite that historical deadline.
    if (todo.due && todo.due >= today && day.date > todo.due) throw new Error("Plan falls after the task deadline");
    if (todo.startDate && day.date < todo.startDate) throw new Error("Plan falls before the task start date");
    if (day.remainingTasks < 1 || minutes > day.remainingMinutes || !reserve(day.gaps, minutes)) throw new Error("Not enough calendar capacity; shorten the selection or regenerate");
    day.remainingTasks--;
    day.remainingMinutes -= minutes;
    seen.add(todo.id);
    validated.push({ id: todo.id, plannedOn: day.date, estimateMinutes: minutes, reason });
  }
  return { items: validated };
}
