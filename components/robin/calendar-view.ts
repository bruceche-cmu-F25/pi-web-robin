import { addDays, addMonths, monthGrid, startOfMonth, weekDays } from "../../extension/robin/dates.ts";

export type CalendarView = "agenda" | "day" | "week" | "month";
export function calendarView(value: string | null): CalendarView | null {
  return value === "agenda" || value === "day" || value === "week" || value === "month" ? value : null;
}
export function calendarDays(view: CalendarView, anchor: string): string[] {
  if (view === "month") return monthGrid(anchor);
  if (view === "week") return weekDays(anchor);
  return Array.from({ length: view === "day" ? 1 : 7 }, (_, i) => addDays(anchor, i));
}
export function stepCalendar(view: CalendarView, anchor: string, direction: -1 | 1): string {
  return view === "month" ? addMonths(startOfMonth(anchor), direction)
    : addDays(anchor, direction * (view === "day" ? 1 : 7));
}
