import { addDays, parseLocalDate } from "../../extension/robin/dates.ts";
import { isAllDayBand, type CalendarEvent } from "../../extension/robin/events.ts";
import type { Todo } from "../../extension/robin/todo-domain.ts";
import { fromMinutes, toMinutes } from "../../extension/robin/layout.ts";

export interface CalendarSlot { date: string; minute?: number }

export function eventFields(event: Partial<CalendarEvent>) {
  return {
    title: event.title ?? "", date: event.date ?? "", endDate: event.endDate ?? "",
    start: event.start ?? "", end: event.end ?? "", location: event.location ?? "",
  };
}
export type EventFields = ReturnType<typeof eventFields>;

/** Calendar days, not elapsed local milliseconds (DST days aren't always 24 hours). */
function dayDifference(from: string, to: string): number {
  const ordinal = (value: string) => {
    const date = parseLocalDate(value);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
  };
  return ordinal(to) - ordinal(from);
}

/** Moving a bar from its middle (or a clipped week) keeps the grabbed day under the pointer. */
export function moveEvent(event: CalendarEvent, origin: CalendarSlot, target: CalendarSlot): EventFields {
  const shifted = eventFields(event);
  const days = dayDifference(origin.date, target.date);
  shifted.date = addDays(event.date, days);
  shifted.endDate = event.endDate ? addDays(event.endDate, days) : "";
  if (!isAllDayBand(event) && origin.minute !== undefined && target.minute !== undefined) {
    // Horizontal moves and returning to the grab point must not quantize an existing 09:07 to 09:00.
    if (Math.abs(target.minute - origin.minute) < 7.5) return shifted;
    const oldStart = toMinutes(event.start!);
    const start = Math.max(0, Math.min(1425, Math.round((oldStart + target.minute - origin.minute) / 15) * 15));
    shifted.start = fromMinutes(start);
    if (event.end) {
      const end = start + toMinutes(event.end) - oldStart;
      shifted.end = fromMinutes(end % 1440);
      shifted.endDate = end >= 1440 ? addDays(shifted.date, Math.floor(end / 1440)) : "";
    }
  }
  return shifted;
}

/** Calendar bars keep the grabbed-day offset; sidebar grips place the deadline on the target day. */
export function moveTodo(todo: Pick<Todo, "due" | "startDate">, origin: CalendarSlot | null, target: CalendarSlot): { due: string; startDate: string } {
  if (!todo.due) return { due: target.date, startDate: "" };
  const delta = dayDifference(origin?.date ?? todo.due, target.date);
  return { due: addDays(todo.due, delta), startDate: todo.startDate ? addDays(todo.startDate, delta) : "" };
}

/** Inclusive day selection; timed selection includes the quarter-hour under the pointer. */
export function selectEventRange(origin: CalendarSlot, target: CalendarSlot): EventFields {
  if (origin.minute === undefined) {
    const [date, last] = [origin.date, target.date].sort();
    return eventFields({ date, endDate: date === last ? undefined : last });
  }
  if (target.minute === undefined) return newEventAt(origin);
  const minutes = dayDifference(origin.date, target.date) * 1440 + target.minute;
  const first = Math.floor(Math.min(origin.minute, minutes) / 15) * 15;
  const last = Math.floor(Math.max(origin.minute, minutes) / 15) * 15 + 15;
  const date = addDays(origin.date, Math.floor(first / 1440));
  const endDate = addDays(origin.date, Math.floor(last / 1440));
  return eventFields({ date, endDate: endDate === date ? undefined : endDate,
    start: fromMinutes(((first % 1440) + 1440) % 1440), end: fromMinutes(((last % 1440) + 1440) % 1440) });
}

/** Resize the end only, keeping at least fifteen minutes and representing midnight as the next date. */
export function resizeEvent(event: CalendarEvent, target: CalendarSlot): EventFields {
  if (!event.start || target.minute === undefined) return eventFields(event);
  const end = Math.max(toMinutes(event.start) + 15,
    dayDifference(event.date, target.date) * 1440 + Math.round(target.minute / 15) * 15);
  return { ...eventFields(event), end: fromMinutes(end % 1440),
    endDate: end >= 1440 ? addDays(event.date, Math.floor(end / 1440)) : "" };
}

export function newEventAt(slot: CalendarSlot): EventFields {
  if (slot.minute === undefined) return eventFields({ date: slot.date });
  const start = Math.max(0, Math.min(1425, Math.floor(slot.minute / 15) * 15));
  const end = start + 60;
  return eventFields({ date: slot.date, start: fromMinutes(start), end: fromMinutes(end % 1440),
    ...(end >= 1440 ? { endDate: addDays(slot.date, 1) } : {}),
  });
}
