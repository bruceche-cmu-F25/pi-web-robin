/** Browser-safe weekly scheduling. The model extracts intent; these rules own time. */
import { addDays, parseLocalDate, startOfWeek } from "./dates.ts";
import { occursOn, type DashboardEvent } from "./events.ts";
import type { Todo } from "./todo-domain.ts";

export interface FocusBlock { id: string; date: string; start: string; end: string; done?: boolean; evening?: boolean }
export interface WorkPlan {
  continuous: boolean;
  blocks: FocusBlock[];
  /** Idempotency receipt for the latest accepted proposal. */
  receipt?: string;
}
export interface PlannerOptions {
  start: string; end: string; dailyMinutes: number; weekends: boolean; deadlineEvenings: boolean;
}
export const DEFAULT_PLANNER: PlannerOptions = { start: "09:00", end: "18:00", dailyMinutes: 240, weekends: false, deadlineEvenings: true };
export const DEADLINE_EVENING = { start: "19:00", end: "22:00", minutes: 180 };
export const ESTIMATE_CHOICES = [30, 60, 120, 240, 480];
export interface PlannerSelection { id: string; minutes: number; continuous: boolean; estimated: boolean }
export interface ProposedBlock { todoId: string; date: string; start: string; end: string; evening?: boolean }
export interface PlanResult {
  blocks: ProposedBlock[];
  remaining: { id: string; minutes: number; reason: "deadline" | "continuous" | "capacity" }[];
  tight: string[];
  days: { date: string; minutes: number }[];
}
export function minute(time: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Expected HH:MM");
  const [hour, minutes] = time.split(":").map(Number);
  return hour * 60 + minutes;
}
export function clock(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
export const blockMinutes = (block: Pick<FocusBlock, "start" | "end">) => minute(block.end) - minute(block.start);
export function validatePlannerOptions(input: unknown): PlannerOptions {
  if (!input || typeof input !== "object") throw new Error("Planning preferences are required");
  const p = input as PlannerOptions;
  if (typeof p.start !== "string" || typeof p.end !== "string" || minute(p.start) >= minute(p.end)) throw new Error("Choose a valid work window");
  if (!Number.isInteger(p.dailyMinutes) || p.dailyMinutes < 30 || p.dailyMinutes > 480 || typeof p.weekends !== "boolean") throw new Error("Daily focus budget must be 30–480 minutes");
  if (p.deadlineEvenings !== undefined && typeof p.deadlineEvenings !== "boolean") throw new Error("Choose whether deadline work may use evenings");
  return { start: p.start, end: p.end, dailyMinutes: p.dailyMinutes, weekends: p.weekends, deadlineEvenings: p.deadlineEvenings ?? DEFAULT_PLANNER.deadlineEvenings };
}
export function validateSelections(input: unknown, todos: Todo[]): PlannerSelection[] {
  if (!Array.isArray(input) || !input.length || input.length > 50) throw new Error("Select 1–50 tasks");
  const seen = new Set<string>();
  return input.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid task selection");
    const { id, minutes, continuous, estimated } = item;
    const todo = todos.find((task) => task.id === id && !task.done && !task.archivedAt);
    if (!todo || seen.has(id)) throw new Error("Task is no longer available; refresh the planner");
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 720 || typeof continuous !== "boolean" || typeof estimated !== "boolean") throw new Error("Choose 5–720 minutes and a work style");
    const completed = (todo.workPlan?.blocks ?? []).filter((b) => b.done).reduce((sum, b) => sum + blockMinutes(b), 0);
    if (minutes < completed) throw new Error("Estimate cannot be less than the time already logged");
    seen.add(id);
    return { id, minutes, continuous, estimated };
  });
}
export function defaultSelection(todo: Todo): PlannerSelection {
  return { id: todo.id, minutes: todo.estimateMinutes ?? 120, continuous: todo.workPlan?.continuous ?? false, estimated: !todo.estimateMinutes || todo.estimateSource === "agent" };
}
export function blockIsFuture(block: Pick<FocusBlock, "date" | "start">, today: string, nowMinute: number): boolean {
  return block.date > today || (block.date === today && minute(block.start) >= nowMinute);
}
export function blockHasEnded(block: Pick<FocusBlock, "date" | "end">, today: string, nowMinute: number): boolean {
  return block.date < today || (block.date === today && minute(block.end) <= nowMinute);
}
/** A confirmed slot is derived from its task, not a second calendar record.
 * Completing/archiving/deleting the task therefore cannot leave ghost bookings. */
export function focusEvents(todos: Todo[], today: string): DashboardEvent[] {
  return todos.flatMap((todo) => (todo.workPlan?.blocks ?? [])
    .filter((block) => block.done || (!todo.done && !todo.archivedAt) || block.date < today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .map((block, index, blocks) => ({
      id: `focus:${todo.id}:${block.id}`, title: blocks.length > 1 ? `${index + 1}/${blocks.length} · ${todo.title}` : todo.title,
      date: block.date, start: block.start, end: block.end,
      source: "planner" as const, calendar: "Planner", todoId: todo.id, colorSeed: todo.id,
      createdAt: todo.createdAt,
    })));
}

/** Clip a fully specified interval to this day; never infer a missing endpoint. */
function eventInterval(event: DashboardEvent & { start: string; end: string }, date: string): [number, number] {
  return [event.date < date ? 0 : minute(event.start), (event.endDate ?? event.date) > date ? 1440 : minute(event.end)];
}
/** Only entries with both endpoints reserve time; incomplete ones remain visible. */
export function plannerEventBlocksTime(event: DashboardEvent): event is DashboardEvent & { start: string; end: string } {
  return Boolean(event.start && event.end);
}
export function focusConflicts(todos: Todo[], events: DashboardEvent[], today: string, nowMinute: number): string[] {
  const fixed = events.filter((e) => e.source !== "planner");
  return todos.filter((todo) => !todo.done && !todo.archivedAt && todo.workPlan?.blocks.some((block) => !block.done && !blockHasEnded(block, today, nowMinute)
    && (Boolean(todo.due && block.date > todo.due && !(todo.due < today && todo.reviewAfter && todo.reviewAfter > today)) || fixed.some((event) => {
      if (!occursOn(event, block.date) || !plannerEventBlocksTime(event)) return false;
      const [start, end] = eventInterval(event, block.date);
      return minute(block.start) < end + 15 && minute(block.end) > start - 15;
    })))).map((todo) => todo.id);
}

/** Earliest deadline first, bounded to the rest of this Monday–Sunday week.
 * ponytail: a deterministic greedy scheduler, not an optimal solver. Report all
 * unplaced effort; never shrink estimates or claim an impossible week fits. */
export function scheduleWeek(todos: Todo[], events: DashboardEvent[], selected: PlannerSelection[], options: PlannerOptions,
  today: string, nowMinute: number, replace: boolean): PlanResult {
  const to = addDays(startOfWeek(today), 6);
  const chosen = new Set(selected.map((item) => item.id));
  const retained = todos.flatMap((todo) => (todo.workPlan?.blocks ?? [])
    .filter((block) => block.done || (!todo.done && !todo.archivedAt && (!replace || !chosen.has(todo.id) || !blockIsFuture(block, today, nowMinute))))
    .map((block) => ({ ...block, todoId: todo.id })));
  const days: { date: string; busy: [number, number][]; minutes: number; eveningMinutes: number; tasks: Set<string>; enabled: boolean }[] = [];
  for (let date = today; date <= to; date = addDays(date, 1)) {
    const weekday = parseLocalDate(date).getDay();
    const busy: [number, number][] = [[720, 780]]; // Lunch stays free even on a packed week.
    for (const event of events.filter(plannerEventBlocksTime).filter((e) => e.source !== "planner" && occursOn(e, date))) {
      const [start, end] = eventInterval(event, date);
      busy.push([Math.max(0, start - 15), Math.min(1440, end + 15)]);
    }
    const booked = retained.filter((b) => b.date === date && (b.done || !blockHasEnded(b, today, nowMinute)));
    for (const block of booked) busy.push([minute(block.start) - 15, minute(block.end) + 15]);
    // A dated Kanban commitment without a slot still consumes time. Reserve
    // its estimate in a real gap rather than scheduling over invisible work.
    const dayPlans = todos.filter((t) => !t.done && !t.archivedAt && t.plannedOn === date && !t.workPlan?.blocks.length && !chosen.has(t.id));
    for (const task of dayPlans) {
      const length = task.estimateMinutes ?? 120;
      let placed = false;
      for (let start = Math.max(minute(options.start), date === today ? Math.ceil((nowMinute + 15) / 15) * 15 : 0); start + length <= minute(options.end); start += 15) {
        if (busy.every(([a, b]) => start + length <= a || start >= b)) {
          busy.push([start - 15, start + length + 15]); placed = true; break;
        }
      }
      // An existing commitment that cannot fit isn't permission to book over it.
      if (!placed) busy.push([0, 1440]);
    }
    days.push({ date, busy, eveningMinutes: booked.filter((b) => b.evening).reduce((sum, b) => sum + blockMinutes(b), 0), minutes: booked.reduce((sum, b) => sum + blockMinutes(b), 0) + dayPlans.reduce((sum, t) => sum + (t.estimateMinutes ?? 120), 0), tasks: new Set([...booked.map((b) => b.todoId), ...dayPlans.map((t) => t.id)]), enabled: options.weekends || (weekday !== 0 && weekday !== 6) });
  }
  const blocks: ProposedBlock[] = [], remaining: PlanResult["remaining"] = [], tight: string[] = [];
  const ordered = [...selected].sort((a, b) => {
    const x = todos.find((t) => t.id === a.id)!, y = todos.find((t) => t.id === b.id)!;
    return (x.due ?? "9999").localeCompare(y.due ?? "9999") || Number(Boolean(y.next)) - Number(Boolean(x.next)) || Number(y.status === "doing") - Number(x.status === "doing") || a.id.localeCompare(b.id);
  });
  // Exhaust normal hours for the whole selection before using deadline-only overflow.
  for (const evening of [false, true]) for (const item of ordered) {
    const todo = todos.find((t) => t.id === item.id)!;
    const committed = retained.filter((b) => b.todoId === item.id && (b.done || !blockHasEnded(b, today, nowMinute))).reduce((sum, b) => sum + blockMinutes(b), 0)
      + blocks.filter((b) => b.todoId === item.id).reduce((sum, b) => sum + blockMinutes(b), 0);
    if (item.minutes < committed) throw new Error("Estimate is below logged or reserved time. Replan future slots or release them first.");
    let left = item.minutes - committed;
    // Overdue is a decision for the user, never an implicit deadline extension.
    if (todo.due && todo.due < today && (!todo.reviewAfter || todo.reviewAfter <= today)) { if (evening && left) remaining.push({ id: item.id, minutes: left, reason: "deadline" }); continue; }
    const canUseEvening = options.deadlineEvenings && todo.due && todo.due >= today && todo.due <= to;
    for (const day of days) {
      if (evening && !canUseEvening) break;
      if (!left || !day.enabled || (todo.startDate && day.date < todo.startDate) || (todo.due && todo.due >= today && day.date > todo.due)
        || (todo.plannedOn && !todo.workPlan?.blocks.length && todo.plannedOn >= today && day.date < todo.plannedOn)) continue;
      if (day.tasks.size >= 3 && !day.tasks.has(item.id)) continue;
      const start = evening ? Math.max(minute(DEADLINE_EVENING.start), minute(options.end)) : minute(options.start);
      let cursor = Math.max(start, day.date === today ? Math.ceil((nowMinute + 15) / 15) * 15 : 0);
      const end = minute(evening ? DEADLINE_EVENING.end : options.end);
      const budgetLeft = () => evening
        ? Math.min(DEADLINE_EVENING.minutes - day.eveningMinutes, options.dailyMinutes + DEADLINE_EVENING.minutes - day.minutes)
        : options.dailyMinutes - (day.minutes - day.eveningMinutes);
      while (left > 0 && cursor < end && budgetLeft() > 0) {
        const busy = day.busy.sort((a, b) => a[0] - b[0]);
        const overlapping = busy.find(([a, b]) => a <= cursor && b > cursor);
        if (overlapping) { cursor = Math.ceil(overlapping[1] / 15) * 15; continue; }
        const next = busy.find(([a]) => a > cursor)?.[0] ?? end;
        const available = Math.floor(Math.min(next - cursor, end - cursor, budgetLeft()) / 5) * 5;
        const length = item.continuous ? left : Math.min(90, left, available);
        if (length > available || length < Math.min(left, 30)) { cursor = next < end ? Math.ceil(next / 15) * 15 : end; continue; }
        blocks.push({ todoId: item.id, date: day.date, start: clock(cursor), end: clock(cursor + length), ...(evening ? { evening: true } : {}) });
        if (todo.due === day.date && !tight.includes(item.id)) tight.push(item.id);
        day.busy.push([cursor - 15, cursor + length + 15]);
        day.minutes += length; if (evening) day.eveningMinutes += length;
        day.tasks.add(item.id); left -= length; cursor += length + 15;
      }
    }
    if (evening && left) remaining.push({ id: item.id, minutes: left, reason: item.continuous ? "continuous" : "capacity" });
  }
  return { blocks: blocks.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)), remaining, tight, days: days.map(({ date, minutes }) => ({ date, minutes })) };
}
