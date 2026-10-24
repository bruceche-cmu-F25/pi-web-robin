/** Calendar behavior shared by the HTTP and Pi tool adapters. */
import { addDays, localDate, normalizeDue, parseLocalDate } from "./dates.ts";
import { calendarEventKey, normalizeTime, type CalendarEvent, type DashboardEvent } from "./events.ts";
import { fetchEventsWithWarnings, isConnected } from "./google-calendar.ts";
import { newId, readEvents, updateEvents } from "./store.ts";
import { listTodos } from "./todo-domain.ts";
import { focusEvents } from "./planner.ts";

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
  /** Explicit visible window for calendar navigation, both inclusive. */
  from?: string;
  to?: string;
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
  if (options.from !== undefined || options.to !== undefined) {
    if (!options.from || !options.to) throw new Error("Both from and to dates are required");
    parseLocalDate(options.from); parseLocalDate(options.to);
    if (options.to < options.from || options.to > addDays(options.from, 366)) throw new Error("Calendar range must be between 1 and 367 days");
  }
  const events: DashboardEvent[] = [...readEvents(), ...focusEvents(listTodos({ includeDone: true, includeArchived: true }).todos, today)];
  if (!isConnected()) return { events, today, google: { connected: false } };

  const from = options.from ?? addDays(today, -(options.before ?? 45));
  const to = options.to ?? addDays(today, options.after ?? 75);
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

function normalizeEventInput(input: CalendarEventInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected an event object");
  for (const key of ["title", "date", "endDate", "start", "end", "location"] as const) {
    if (input[key] !== undefined && typeof input[key] !== "string") throw new Error(`${key} must be a string`);
  }
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
  return {
    title, date,
    ...(endDate && endDate > date ? { endDate } : {}),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(location ? { location } : {}),
  };
}

/** A UI draft keeps one request id across retries, including a lost HTTP response. */
export function createCalendarEvent(input: CalendarEventInput, requestId?: unknown): CalendarEvent {
  if (requestId !== undefined && (typeof requestId !== "string" || !/^[a-f0-9]{32}$/.test(requestId))) {
    throw new Error("requestId must be 32 lowercase hexadecimal characters");
  }
  const normalized = normalizeEventInput(input);
  const event: CalendarEvent = { ...normalized, id: requestId ? `calendar:${requestId}` : newId(), createdAt: new Date().toISOString() };
  return updateEvents((events) => {
    const key = calendarEventKey(event);
    const existing = requestId ? events.find((item) => item.id === event.id || item.creationRequestIds?.includes(event.id)) : undefined;
    if (existing) {
      // Never silently overwrite a saved event if the draft was edited after an uncertain response.
      if (calendarEventKey(existing) !== key) {
        throw new Error("This draft was already saved. Close it and reopen the saved event to edit.");
      }
      return { value: existing, changed: false };
    }
    // The check and write share the storage lock: tools and fresh UI/capture requests
    // cannot create separate copies of the same occurrence, even concurrently.
    const duplicate = events.find((item) => calendarEventKey(item) === key);
    if (duplicate) {
      if (requestId) duplicate.creationRequestIds = [...(duplicate.creationRequestIds ?? []), event.id];
      return { value: duplicate, changed: Boolean(requestId) };
    }
    events.push(event);
    return { value: event, changed: true };
  });
}

/** Compare and patch under the same storage lock/transaction; never upsert a missing or Google event. */
export function updateCalendarEvent(id: string, input: CalendarEventInput, expected: CalendarEventInput):
  { status: "updated"; event: CalendarEvent } | { status: "missing" | "conflict" } {
  const keys = ["title", "date", "endDate", "start", "end", "location"] as const;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected an event patch");
  if (!expected || typeof expected !== "object" || keys.some((key) => typeof expected[key] !== "string")) {
    throw new Error("Expected the original event fields");
  }
  return updateEvents<ReturnType<typeof updateCalendarEvent>>((events) => {
    const index = events.findIndex((event) => event.id === id);
    if (index < 0) return { value: { status: "missing" as const }, changed: false };
    const current = events[index]!;
    if (keys.some((key) => (current[key] ?? "") !== expected[key])) {
      return { value: { status: "conflict" as const }, changed: false };
    }
    const merged: CalendarEventInput = { ...current };
    for (const key of keys) if (Object.hasOwn(input, key)) merged[key] = input[key];
    const normalized = normalizeEventInput(merged);
    // Clear optional fields explicitly, while retaining metadata not owned by the editor.
    const event: CalendarEvent = { ...current, endDate: undefined, start: undefined, end: undefined, location: undefined, ...normalized };
    events[index] = event;
    return { value: { status: "updated" as const, event }, changed: true };
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
