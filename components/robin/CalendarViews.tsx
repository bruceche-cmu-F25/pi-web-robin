"use client";

import { useI18n } from "@/hooks/useI18n";
import { groupAgendaItems } from "@/extension/robin/agenda";
import { parseLocalDate, addDays } from "@/extension/robin/dates";
import {
  compareEvents,
  eventEndDate,
  formatEventTime,
  isAllDayBand,
  isReadOnlyEvent,
  type DashboardEvent,
} from "@/extension/robin/events";
import { layoutSpanBars } from "@/extension/robin/layout";
import { useEventSurface } from "./eventSurface";
import { TodoTitle } from "./TodoTitle";
import type { Todo } from "@/extension/robin/todo-domain";
import { useTodayInView } from "./useTodayInView";

export type CalendarView = "agenda" | "week" | "month";

interface ViewProps {
  events: DashboardEvent[];
  today: string;
  onSelectEvent: (event: DashboardEvent) => void;
}

interface AgendaViewProps extends ViewProps {
  todos: Todo[];
  onCompleteTodo: (todo: Todo) => void;
}

/** Grids are laid out for a wide viewport; narrow screens scroll rather than crush. */
const GRID_SCROLL = "overflow-x-auto";
const GRID_MIN_WIDTH = "min-w-[42rem]";

/**
 * The same three sizes the week grid sets its blocks in — see WeekGrid.tsx.
 * A month chip and an agenda row are the same object at a different density,
 * so they are set from the same scale rather than from a size picked per view.
 */
const TITLE_SIZE = 13.5;
const TITLE_SIZE_TIGHT = 12;
const META_SIZE = 10.5;

/** Relative day headings, translated here rather than in the shared module
 *  that the English-only agent tools also use. */
function dayHeading(date: string, today: string, locale: string, t: (key: string) => string): string {
  if (date === today) return t("robin.calendar.relativeToday");
  if (date === addDays(today, 1)) return t("robin.calendar.relativeTomorrow");
  // Anything further out reads better as a weekday than as an ISO string.
  return parseLocalDate(date).toLocaleDateString(locale, { weekday: "long", month: "short", day: "numeric" });
}

function dayNumber(date: string): string {
  return String(parseLocalDate(date).getDate());
}

function weekdayLabel(date: string, locale: string): string {
  return parseLocalDate(date).toLocaleDateString(locale, { weekday: "short" });
}

/** A timed event in a month cell. */
function EventChip({ event, onSelect, t }: {
  event: DashboardEvent;
  onSelect: (event: DashboardEvent) => void;
  t: (key: string) => string;
}) {
  const surface = useEventSurface();
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      aria-haspopup="dialog"
      className="pointer-events-auto flex w-full items-baseline gap-1.5 py-0.5 pl-1 pr-1.5 text-left"
      style={{ ...surface.timed(event), fontSize: TITLE_SIZE }}
      title={`${formatEventTime(event)} ${event.title}${event.calendar ? ` — ${event.calendar}` : ""}`}
    >
      {/* The clock stays quieter than the title: same hue would make the row
          two equal halves, and the thing you scan for is the name. It also
          names the mono, because the surface sets the serif for the title and
          a time in a proportional face stops lining up column to column. */}
      <span
        className="shrink-0 tabular-nums"
        style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: META_SIZE }}
      >
        {event.start ?? t("robin.calendar.allDay")}
      </span>
      <span className="min-w-0 flex-1 truncate">{event.title}</span>
    </button>
  );
}

/** Days shown in full; the rest of the window collapses to one line each. */
const AGENDA_DETAIL_DAYS = 3;

export function AgendaView({
  events,
  todos,
  today,
  onSelectEvent,
  onCompleteTodo,
}: AgendaViewProps) {
  const { t, locale } = useI18n();
  const surface = useEventSurface();
  const grouped = groupAgendaItems(events, todos);
  // Today always gets a row, even when empty: on a daily dashboard "nothing on
  // today" is itself the answer, and omitting the day reads as a load failure.
  const withToday = grouped.some((group) => group.date === today)
    ? grouped
    : [{ date: today, events: [] as DashboardEvent[], todos: [] as Todo[] }, ...grouped];

  // Detail only covers the days you can still act on. Everything further out
  // becomes a one-line-per-day brief: enough to notice a busy Thursday without
  // reading the whole week.
  const detailUntil = addDays(today, AGENDA_DETAIL_DAYS - 1);
  const days = withToday.filter((group) => group.date <= detailUntil);
  const rest = withToday.filter((group) => group.date > detailUntil
    && group.events.length + group.todos.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {days.map(({ date, events: dayEvents, todos: dayTodos }) => (
        <div key={date} className="flex flex-col gap-1">
          <h3
            className="pi-eyebrow"
            style={date === today
              ? { color: "var(--text)", fontWeight: 500 }
              : { color: "var(--text-dim)" }}
          >
            {date === today && (
              <span className="pi-today-badge mr-2">{dayNumber(date)}</span>
            )}
            {dayHeading(date, today, locale, t)}
          </h3>
          {dayEvents.length + dayTodos.length === 0 && (
            <p className="px-2 py-1 text-sm" style={{ color: "var(--text-dim)" }}>{t("robin.calendar.nothingScheduled")}</p>
          )}
          {dayTodos.map((todo) => (
            <div
              key={`todo:${todo.id}`}
              className="flex min-h-8 items-center gap-3 px-2 py-1"
              style={{
                background: "var(--accent-amber-soft)",
                borderLeft: "2px solid var(--accent-amber-line)",
              }}
            >
              <span
                className="pi-eyebrow shrink-0"
                style={{ color: "var(--accent-amber)", minWidth: "5.5rem" }}
              >
                {t("robin.todos.deadline")}
              </span>
              <input
                type="checkbox"
                checked={todo.done}
                onChange={() => onCompleteTodo(todo)}
                aria-label={t("robin.todos.complete", { title: todo.title })}
                className="shrink-0 cursor-pointer"
              />
              <TodoTitle
                todo={todo}
                t={t}
                className="min-w-0 flex-1 truncate text-sm"
                style={{ color: todo.color ? `var(--todo-${todo.color})` : "var(--text)" }}
              />
            </div>
          ))}
          {dayEvents.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => onSelectEvent(event)}
              aria-haspopup="dialog"
              className="flex min-h-8 w-full items-center gap-3 px-2 py-1 text-left"
              // Same two-axis colouring as the grids: hue for the kind of
              // thing, weight for whether it is yours. Which day it is under
              // is the heading's job, not the row's.
              style={isAllDayBand(event) ? surface.span(event) : surface.timed(event)}
            >
              <span
                className="shrink-0 tabular-nums"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: META_SIZE,
                  minWidth: "5.5rem",
                }}
              >
                {formatEventTime(event)}
              </span>
              <span className="min-w-0 flex-1 truncate" style={{ fontSize: TITLE_SIZE }}>
                {event.title}
                {event.location && <span style={{ color: "var(--text-dim)" }}> @ {event.location}</span>}
                {isReadOnlyEvent(event) && (
                  <span style={{ color: "var(--text-dim)" }}> · {event.calendar ?? "Google"}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      ))}

      {rest.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: "var(--border)" }}>
          <h3 className="font-mono text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>
            {t("robin.calendar.restOfWeek")}
          </h3>
          {rest.map(({ date, events: dayEvents, todos: dayTodos }) => (
            <div key={date} className="flex items-baseline gap-2 px-2 py-0.5 text-xs">
              <span className="shrink-0 font-mono" style={{ color: "var(--text-muted)", minWidth: "4.5rem" }}>
                {parseLocalDate(date).toLocaleDateString(locale, { weekday: "short", day: "numeric" })}
              </span>
              <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden" style={{ color: "var(--text-dim)" }}>
                {dayEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onSelectEvent(event)}
                    aria-haspopup="dialog"
                    className="min-w-0 truncate underline-offset-2 hover:underline"
                  >
                    {event.title}
                  </button>
                ))}
                {dayTodos.map((todo) => (
                  <span key={todo.id} className="flex min-w-0 items-baseline gap-1 truncate">
                    {t("robin.todos.title")}:
                    <TodoTitle todo={todo} t={t} className="min-w-0 truncate" />
                  </span>
                ))}
              </span>
              <span className="shrink-0 font-mono tabular-nums" style={{ color: "var(--text-dim)" }}>
                {dayEvents.length + dayTodos.length}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const MONTH_CHIP_LIMIT = 4;
const BAR_HEIGHT = 18;
const DAY_NUMBER_HEIGHT = 18;

/**
 * One week of the month grid.
 *
 * Multi-day and all-day events are drawn as bars spanning the row, so a trip
 * reads as one continuous thing rather than as a copy sitting in each day.
 * Timed single-day events stay as chips inside their own cell. The cells
 * reserve `lanes` worth of vertical space so the bars never cover them.
 */
function MonthWeekRow({
  days,
  events,
  todos,
  today,
  onSelectDay,
  onSelectEvent,
  onCompleteTodo,
  t,
}: {
  days: string[];
  events: DashboardEvent[];
  todos: Todo[];
  today: string;
  onSelectDay: (date: string) => void;
  onSelectEvent: (event: DashboardEvent) => void;
  onCompleteTodo: (todo: Todo) => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const surface = useEventSurface();
  const { bars, lanes } = layoutSpanBars(events, days);
  const barsHeight = lanes * BAR_HEIGHT;
  // The window always opens on today's week, but when today falls late in it
  // most of the row is already past — marking the row is what makes "this is
  // your current week" readable at a glance.
  const isCurrentWeek = days.length > 0 && (days[0] as string) <= today
    && today <= (days[days.length - 1] as string);

  return (
    <div
      className="relative"
      style={isCurrentWeek
        ? { borderLeft: "2px solid var(--today-mark)", paddingLeft: 4, marginLeft: -6 }
        : { paddingLeft: 4, marginLeft: -6 }}
    >
      <div className="grid grid-cols-7 gap-px">
        {days.map((date) => {
          const chips = events
            .filter((event) => !isAllDayBand(event) && event.date === date)
            .sort(compareEvents);
          const spanning = events.filter((event) => isAllDayBand(event)
            && date >= event.date && date <= eventEndDate(event)).length;
          const dayTodos = todos.filter((todo) => todo.due === date);
          const shownTodos = dayTodos.slice(0, MONTH_CHIP_LIMIT);
          const shownEvents = chips.slice(0, Math.max(0, MONTH_CHIP_LIMIT - shownTodos.length));
          const hidden = dayTodos.length + chips.length - shownTodos.length - shownEvents.length;
          const isToday = date === today;
          // A rolling window has no "outside the month"; what is worth dimming
          // is the part of the week already behind you.
          const past = date < today;
          return (
            <div key={date} data-date={date} className="relative min-h-32">
              <button
                type="button"
                onClick={() => onSelectDay(date)}
                aria-label={t("robin.calendar.dayTooltip", { date, count: String(chips.length + spanning + dayTodos.length) })}
                className="absolute inset-0 w-full text-left"
                style={{
                  // The one cell in another hue, ringed twice over: the inset
                  // shadow doubles the border without moving the cell, which a
                  // 2px border in a hairline grid would.
                  background: isToday ? "var(--today-wash)" : "transparent",
                  border: `1px solid ${isToday ? "var(--today-mark)" : "var(--border)"}`,
                  boxShadow: isToday ? "inset 0 0 0 1px var(--today-mark)" : undefined,
                  opacity: past ? 0.5 : 1,
                }}
              />
              <div
                className="pointer-events-none relative flex min-h-32 flex-col gap-0.5 p-1"
                style={{ paddingTop: DAY_NUMBER_HEIGHT + barsHeight + 2, opacity: past ? 0.5 : 1 }}
              >
                {shownTodos.map((todo) => (
                  <div
                    key={todo.id}
                    className="pointer-events-auto flex min-h-6 items-center gap-1 overflow-hidden px-1"
                    style={{
                      background: "var(--accent-amber-soft)",
                      border: "1px dashed var(--accent-amber-line)",
                      color: todo.color ? `var(--todo-${todo.color})` : "var(--text)",
                      fontSize: 11.5,
                    }}
                    title={`${t("robin.todos.deadline")}: ${todo.title}`}
                  >
                    <input
                      type="checkbox"
                      checked={todo.done}
                      onChange={() => onCompleteTodo(todo)}
                      aria-label={t("robin.todos.complete", { title: todo.title })}
                      className="shrink-0 cursor-pointer"
                    />
                    <TodoTitle todo={todo} t={t} className="min-w-0 truncate" />
                  </div>
                ))}
                {shownEvents.map((event) => (
                  <EventChip key={event.id} event={event} onSelect={onSelectEvent} t={t} />
                ))}
                {hidden > 0 && (
                  <span className="px-1 text-xs" style={{ color: "var(--text-dim)" }}>
                    {t("robin.calendar.more", { count: String(hidden) })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Day numbers sit above the bars, inside each cell's reserved space. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 grid grid-cols-7 gap-px">
        {days.map((date) => (
          <span
            key={date}
            className="px-1.5 pt-1 font-mono text-xs tabular-nums"
            style={{
              color: "var(--text-muted)",
              opacity: date < today ? 0.5 : 1,
            }}
          >
            {date === today
              ? <span className="pi-today-badge">{dayNumber(date)}</span>
              : dayNumber(date)}
          </span>
        ))}
      </div>

      {bars.map((bar) => (
        <button
          key={bar.event.id}
          type="button"
          onClick={() => onSelectEvent(bar.event)}
          aria-haspopup="dialog"
          title={`${bar.event.title}${bar.event.calendar ? ` — ${bar.event.calendar}` : ""}`}
          className="absolute truncate px-1.5 text-left leading-4"
          style={{
            left: `calc(${(bar.startIndex / 7) * 100}% + 2px)`,
            width: `calc(${((bar.endIndex - bar.startIndex + 1) / 7) * 100}% - 4px)`,
            top: DAY_NUMBER_HEIGHT + bar.lane * BAR_HEIGHT + 2,
            height: BAR_HEIGHT - 2,
            ...surface.span(bar.event),
            borderRadius: 0,
            fontSize: TITLE_SIZE_TIGHT,
          }}
        >
          {bar.continuesBefore && "‹ "}
          {bar.event.title}
          {bar.continuesAfter && " ›"}
        </button>
      ))}
    </div>
  );
}

export function MonthView({
  events,
  todos,
  today,
  days: grid,
  onSelectDay,
  onSelectEvent,
  onCompleteTodo,
}: ViewProps & {
  todos: Todo[];
  days: string[];
  onSelectDay: (date: string) => void;
  onCompleteTodo: (todo: Todo) => void;
}) {
  const { t, locale } = useI18n();
  const scrollerRef = useTodayInView(grid[0] ?? "", today);
  const weeks = Array.from(
    { length: Math.ceil(grid.length / 7) },
    (_, index) => grid.slice(index * 7, index * 7 + 7),
  );

  return (
    <div className={GRID_SCROLL} ref={scrollerRef}>
      <div className={`flex flex-col gap-px ${GRID_MIN_WIDTH}`}>
        <div className="grid grid-cols-7 gap-px">
          {(weeks[0] ?? []).map((date) => {
            // The window opens on today's week, so today's weekday names its
            // column — but only while today is still somewhere in the window;
            // paged forward, no column is today's.
            const isTodayColumn = grid.includes(today)
              && parseLocalDate(date).getDay() === parseLocalDate(today).getDay();
            return (
              <div
                key={date}
                className="px-1 font-mono text-xs"
                style={isTodayColumn
                  ? { color: "var(--today-mark)", fontWeight: 500 }
                  : { color: "var(--text-dim)" }}
              >
                {weekdayLabel(date, locale)}
              </div>
            );
          })}
        </div>
        {weeks.map((days) => (
          <MonthWeekRow
            key={days[0]}
            days={days}
            events={events}
            todos={todos}
            today={today}
            onSelectDay={onSelectDay}
            onSelectEvent={onSelectEvent}
            onCompleteTodo={onCompleteTodo}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}
