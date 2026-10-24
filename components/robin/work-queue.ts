import { localDate } from "../../extension/robin/dates.ts";
import { occursOn, type DashboardEvent } from "../../extension/robin/events.ts";
import type { Todo } from "../../extension/robin/todo-domain.ts";

export const WORK_QUEUE_KEY = "robin-work-queue:v1";
export interface QueueNote { step: string; skips: number; until: number }
export interface WorkQueueState {
  version: 1;
  day: string;
  confirmed: boolean;
  ids: string[];
  notes: Record<string, QueueNote>;
  active: { id: string; endsAt: number } | null;
  restUntil: number;
  start: string;
  end: string;
}
export function emptyQueue(day: string): WorkQueueState {
  return { version: 1, day, confirmed: false, ids: [], notes: {}, active: null, restUntil: 0, start: "09:00", end: "18:00" };
}
export function timeMinutes(time: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}
export function validWorkHours(start: string, end: string): boolean {
  return timeMinutes(start) < timeMinutes(end);
}

/** Local-only execution hints, not a second source of truth for todo completion. */
export function parseWorkQueue(raw: string | null, day: string): WorkQueueState {
  const fallback = emptyQueue(day);
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || value.version !== 1 || !Array.isArray(value.ids) || !value.notes || typeof value.notes !== "object") return fallback;
    const sameDay = value.day === day;
    const ids = [...new Set<string>(value.ids.filter((id: unknown) => typeof id === "string" && id.length > 0))].slice(0, 3);
    const notes: Record<string, QueueNote> = Object.create(null);
    for (const [id, rawNote] of Object.entries(value.notes).slice(-100)) {
      const note = rawNote as QueueNote | null;
      if (note && typeof note.step === "string" && Number.isSafeInteger(note.skips) && note.skips >= 0 && Number.isFinite(note.until) && note.until >= 0) {
        notes[id] = { step: note.step.slice(0, 500), skips: sameDay ? note.skips : 0, until: sameDay ? note.until : 0 };
      }
    }
    const active = sameDay && value.active && ids.includes(value.active.id) && Number.isFinite(value.active.endsAt) && value.active.endsAt > 0
      ? { id: value.active.id as string, endsAt: value.active.endsAt as number } : null;
    return {
      ...fallback, notes, active,
      ...(validWorkHours(value.start, value.end) ? { start: value.start, end: value.end } : {}),
      ...(sameDay ? { confirmed: value.confirmed === true, ids, restUntil: Number.isFinite(value.restUntil) && value.restUntil > 0 ? value.restUntil : 0 } : {}),
    };
  } catch { return fallback; }
}

export function queueCandidates<T extends Todo>(todos: T[], day: string): T[] {
  const rank = (todo: Todo) => todo.next ? 0 : todo.status === "doing" ? 1 : todo.plannedOn && todo.plannedOn <= day ? 2 : 3;
  return todos.filter((todo) => !todo.done && !todo.archivedAt && (!todo.startDate || todo.startDate <= day)
    && (!todo.plannedOn || todo.plannedOn <= day))
    .sort((a, b) => rank(a) - rank(b) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));
}

export type QueueWindow = { kind: "free" | "busy" | "outside" | "uncertain" | "short"; minutes: number };
/** Only complete time intervals block suggestions. Missing endpoints reserve no time. */
export function queueWindow(events: DashboardEvent[], now: Date, start: string, end: string, reliable = true): QueueWindow {
  if (!reliable || !validWorkHours(start, end)) return { kind: "uncertain", minutes: 0 };
  const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  if (minute < timeMinutes(start) || minute >= timeMinutes(end)) return { kind: "outside", minutes: 0 };
  let stop = timeMinutes(end);
  const today = localDate(now);
  for (const event of events.filter((item) => occursOn(item, today))) {
    if (!event.start || !event.end) continue;
    const begins = event.date < today ? 0 : timeMinutes(event.start);
    const ends = (event.endDate ?? event.date) > today ? 1440 : timeMinutes(event.end);
    if (!Number.isFinite(begins) || !Number.isFinite(ends) || ends < begins) return { kind: "uncertain", minutes: 0 };
    if (minute >= begins - 10 && minute < ends + 10) return { kind: "busy", minutes: 0 };
    if (begins > minute) stop = Math.min(stop, begins - 10);
  }
  const minutes = Math.max(0, Math.floor(stop - minute));
  return { kind: minutes >= 5 ? "free" : "short", minutes };
}

/** Honor queue order among tasks that fit. Unknown/large tasks get a kickoff,
 * never a claim that the entire task can be completed in five minutes. */
export function recommendTask<T extends Todo>(queue: T[], state: WorkQueueState, now: number, window: QueueWindow): { todo: T; kickoff: boolean } | null {
  if (!state.confirmed || state.restUntil > now || window.kind !== "free") return null;
  const today = localDate(new Date(now));
  const available = queue.filter((todo) => !todo.done && !todo.archivedAt && (!todo.startDate || todo.startDate <= today)
    && (!todo.plannedOn || todo.plannedOn <= today) && (state.notes[todo.id]?.until ?? 0) <= now);
  const fits = available.find((todo) => todo.estimateMinutes && todo.estimateSource !== "agent" && todo.estimateMinutes <= window.minutes);
  const todo = fits ?? available[0];
  return todo ? { todo, kickoff: !fits } : null;
}
