import { addDays } from "../../extension/robin/dates.ts";
import { compareEvents, deduplicateCalendarEvents, eventEndDate, eventsInRange, type DashboardEvent } from "../../extension/robin/events.ts";
import type { Todo } from "../../extension/robin/todo-domain.ts";

export const DASHBOARD_VIEWS = ["daily", "calendar", "todos", "more"] as const;
export type DashboardView = typeof DASHBOARD_VIEWS[number];

/** Old bookmarks still arrive at the surface that owns the named content. */
export function dashboardView(params: Pick<URLSearchParams, "get">, hash = ""): DashboardView {
  if (params.get("todo")) return "todos";
  if (params.get("event")) return "calendar";
  const view = params.get("view");
  if (DASHBOARD_VIEWS.includes(view as DashboardView)) return view as DashboardView;
  if (hash === "#dashboard-todos") return "todos";
  if (["#dashboard-links", "#fullstack-open", "#dashboard-jobs", "#dashboard-planner", "#dashboard-work-queue"].includes(hash)) return "more";
  if (params.get("calendar")) return "calendar";
  return "daily";
}

export function upcomingEvents(events: DashboardEvent[], today: string, time: string): DashboardEvent[] {
  return deduplicateCalendarEvents(events).filter((event) => {
    const last = eventEndDate(event);
    if (last < today) return false;
    // Unknown ends are not invented. All-day and ongoing multi-day items remain visible.
    return last !== today || !event.end || event.end > time;
  }).sort(compareEvents);
}

/** Today's preview prioritizes timed appointments, without guessing missing ends.
 * Other dates retain calendar order; every non-featured entry stays in the disclosure. */
export function dailyEventPreview(events: DashboardEvent[], date: string, today: string, time?: string) {
  const entries = eventsInRange(deduplicateCalendarEvents(events), date, date);
  let featured: DashboardEvent | undefined = entries[0];
  let phase: "ongoing" | "next" | "started" | null = null;
  if (date === today && time) {
    const now = `${today}T${time}`;
    const ongoing = entries.find(event => event.start && event.end &&
      `${event.date}T${event.start}` <= now && `${eventEndDate(event)}T${event.end}` > now);
    const next = entries.find(event => event.start && `${event.date}T${event.start}` > now);
    // All-day and unknown-end entries are still relevant, but are not proof of
    // an ongoing appointment. Finished entries remain accessible below.
    featured = ongoing ?? next ?? entries.find(event => !event.start || !event.end);
    phase = ongoing ? "ongoing" : next ? "next" : featured?.start ? "started" : null;
  }
  return { featured, phase, others: entries.filter(event => event !== featured) };
}

export function nearbyTodos<T extends Todo>(todos: T[], today: string): T[] {
  return todos.filter((todo) => !todo.done && !todo.archivedAt && todo.due && todo.due <= addDays(today, 2))
    .sort((a, b) => a.due!.localeCompare(b.due!) || a.id.localeCompare(b.id));
}

export function todoRecordHref(id: string): string {
  return `/dashboard?view=todos&todo=${encodeURIComponent(id)}`;
}

export function eventRecordHref(event: Pick<DashboardEvent, "id" | "date">): string {
  // Open the record without replacing the user's calendar presentation.
  return `/dashboard?view=calendar&date=${encodeURIComponent(event.date)}&event=${encodeURIComponent(event.id)}`;
}
