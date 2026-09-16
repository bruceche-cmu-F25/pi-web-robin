/** Calendar writes shared by the HTTP and Pi tool adapters. */
import { normalizeDue } from "./dates.ts";
import { normalizeTime, type CalendarEvent } from "./events.ts";
import { newId, updateEvents } from "./store.ts";

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
