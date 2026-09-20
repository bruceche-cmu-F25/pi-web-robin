/** Calendar behavior shared by the HTTP and Pi tool adapters. */
import { addDays, localDate, normalizeDue } from "./dates.ts";
import { normalizeTime, type CalendarEvent, type DashboardEvent } from "./events.ts";
import { fetchEventsWithWarnings, isConnected } from "./google-calendar.ts";
import { newId, readEvents, updateEvents } from "./store.ts";

export interface CalendarBoard {
  /** Local events plus any read-only ones pulled from Google, unsorted. */
  events: DashboardEvent[];
  /** Server-resolved, matching the local dates the agent wrote. */
  today: string;
  google: {
    connected: boolean;
    /** Present when Google was connected but could not be read in full. */
    error?: string;
  };
}

export interface CalendarBoardOptions {
  /**
   * How far either side of today to pull Google events, in days. Expressed as
   * a width rather than two dates so that `today` is read once, here: a caller
   * that resolved its own dates first could straddle midnight and ask about a
   * different day than the one it reports.
   *
   * The defaults cover the month grid either side of today.
   */
  before?: number;
  after?: number;
}

/**
 * The schedule as the user sees it: their own events merged with a connected
 * Google calendar.
 *
 * Both adapters read through here because reading only the local store is a
 * bug with a face — it made the agent answer "nothing scheduled" to someone
 * whose day was full, which is worse than having no tool at all.
 *
 * A Google failure degrades to local-only rather than throwing: the dashboard
 * staying up with the user's own events beats an error page, and the caller
 * still learns what happened from `google.error`.
 */
export async function calendarBoard(options: CalendarBoardOptions = {}): Promise<CalendarBoard> {
  const today = localDate();
  const events: DashboardEvent[] = readEvents();
  if (!isConnected()) return { events, today, google: { connected: false } };

  const from = addDays(today, -(options.before ?? 45));
  const to = addDays(today, options.after ?? 75);
  try {
    const pulled = await fetchEventsWithWarnings(from, to);
    return {
      events: [...events, ...pulled.events],
      today,
      google: {
        connected: true,
        ...(pulled.warnings.length > 0 ? { error: pulled.warnings.join("; ") } : {}),
      },
    };
  } catch (error) {
    return {
      events,
      today,
      google: {
        connected: true,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export interface CalendarEventInput {
  title?: unknown;
  date?: unknown;
  endDate?: unknown;
  start?: unknown;
  end?: unknown;
  location?: unknown;
}

export function createCalendarEvent(input: CalendarEventInput): CalendarEvent {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) throw new Error("title is required");
  if (typeof input.date !== "string" || !input.date.trim()) throw new Error("date is required");
  const date = normalizeDue(input.date);
  const endDate = typeof input.endDate === "string" && input.endDate.trim()
    ? normalizeDue(input.endDate) : undefined;
  if (endDate && endDate < date) throw new Error(`endDate ${endDate} is before ${date}`);
  const start = typeof input.start === "string" && input.start.trim() ? normalizeTime(input.start) : undefined;
  const end = typeof input.end === "string" && input.end.trim() ? normalizeTime(input.end) : undefined;
  if (end && !start) throw new Error("An end time needs a start time too");
  // An explicit endDate equal to date is still a single-day event.
  if (start && end && (!endDate || endDate === date) && end < start) {
    throw new Error(`End ${end} is before start ${start}`);
  }
  const location = typeof input.location === "string" ? input.location.trim() : "";
  const event: CalendarEvent = {
    id: newId(), title, date,
    ...(endDate && endDate > date ? { endDate } : {}),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(location ? { location } : {}),
    createdAt: new Date().toISOString(),
  };
  return updateEvents((events) => {
    events.push(event);
    return { value: event, changed: true };
  });
}

export function deleteCalendarEvent(id: string): boolean {
  return updateEvents((events) => {
    const index = events.findIndex((event) => event.id === id);
    if (index < 0) return { value: false, changed: false };
    events.splice(index, 1);
    return { value: true, changed: true };
  });
}
