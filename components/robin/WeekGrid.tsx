"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { parseLocalDate, weekDays } from "@/extension/robin/dates";
import {
  eventsInRange,
  formatEventTime,
  occursOn,
  type DashboardEvent,
} from "@/extension/robin/events";
import {
  layoutDayEvents,
  layoutSpanBars,
  visibleHourRange,
} from "@/extension/robin/layout";
import type { Todo } from "@/extension/robin/todo-domain";
import { useEventSurface } from "./eventSurface";
import { TodoTitle } from "./TodoTitle";
import { useTodayInView } from "./useTodayInView";

/** Give dense cards enough vertical room for title, time, and useful details. */
const HOUR_HEIGHT = 56;
/**
 * The block's type scale. Three sizes and no more: the title, the machinery
 * under it, and one step down for a title in a four-way overlap. What was here
 * before was nine sizes between 9 and 18 with nothing relating them, and 9px
 * for a location is below what this app sets anything else at.
 */
const TITLE_SIZE = 13.5;
const TITLE_SIZE_TIGHT = 12;
const META_SIZE = 10.5;
const PX_PER_MINUTE = HOUR_HEIGHT / 60;
const TIME_GUTTER = "4rem";

function weekdayLabel(date: string, locale: string): string {
  return parseLocalDate(date).toLocaleDateString(locale, { weekday: "short" });
}

function useNowMinutes(): number {
  const [minutes, setMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => clearInterval(timer);
  }, []);
  return minutes;
}

export function WeekGrid({
  events,
  todos,
  today,
  anchor,
  onSelectEvent,
  onCompleteTodo,
}: {
  events: DashboardEvent[];
  todos: Todo[];
  today: string;
  anchor: string;
  onSelectEvent: (event: DashboardEvent) => void;
  onCompleteTodo: (todo: Todo) => void;
}) {
  const { t, locale } = useI18n();
  const surface = useEventSurface();
  const days = weekDays(anchor);
  const scrollerRef = useTodayInView(anchor, today);
  const { bars, lanes } = layoutSpanBars(events, days);
  const nowMinutes = useNowMinutes();

  const weekEvents = eventsInRange(events, days[0] as string, days[days.length - 1] as string);
  const { first: firstHour, last: lastHour } = visibleHourRange(weekEvents);
  const hours = Array.from({ length: lastHour - firstHour }, (_, index) => firstHour + index);
  /** Minutes are measured from the top of the grid, not from midnight. */
  const gridOffsetMinutes = firstHour * 60;
  const gridEndMinutes = lastHour * 60;
  const gridHeight = hours.length * HOUR_HEIGHT;

  return (
    <div className="overflow-x-auto" ref={scrollerRef}>
      <div className="min-w-[44rem]">
        {/* Day headings */}
        <div
          className="grid gap-px border-b"
          style={{
            gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))`,
            borderColor: "var(--border)",
          }}
        >
          <div />
          {days.map((date) => {
            const isToday = date === today;
            return (
              // Weekday and number stay adjacent; spread apart they read as
              // belonging to the neighbouring column.
              <div
                key={date}
                className="flex items-baseline gap-1.5 px-1 pb-1.5"
                // Today is marked by the rule under its heading as well as by
                // the solid date, so it survives a glance and a greyscale screen.
                style={isToday ? { boxShadow: "inset 0 -2px 0 var(--today-mark)" } : undefined}
              >
                <span
                  className="pi-eyebrow"
                  style={isToday ? { color: "var(--text)" } : undefined}
                >
                  {weekdayLabel(date, locale)}
                </span>
                {isToday ? (
                  // Set at the size of the plain numbers beside it. At 16 against
                  // their 18 today's date came out the smallest on the row, which
                  // is the opposite of what the badge is for.
                  <span className="pi-today-badge" style={{ minWidth: "2em", fontSize: 18 }}>
                    {parseLocalDate(date).getDate()}
                  </span>
                ) : (
                  <span
                    className="font-mono tabular-nums"
                    style={{ color: "var(--text)", fontSize: 18, lineHeight: 1.1 }}
                  >
                    {parseLocalDate(date).getDate()}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* All-day / multi-day band */}
        {lanes > 0 && (
          <div
            className="grid gap-px border-y py-1 font-mono"
            style={{
              gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))`,
              borderColor: "var(--border)",
            }}
          >
            <div className="pi-meta pr-1 text-right" style={{ color: "var(--text-dim)" }}>{t("robin.calendar.allDay")}</div>
            <div className="relative col-span-7" style={{ height: lanes * 22 }}>
              {/* No today wash in here. The column below carries one, and the
                  day is already named by its badge and the rule under its
                  heading; repeating the tint in every band was what made the
                  other six days look faulty rather than making today clear. */}
              {bars.map((bar) => (
                <button
                  key={bar.event.id}
                  type="button"
                  onClick={() => onSelectEvent(bar.event)}
                  aria-haspopup="dialog"
                  title={`${bar.event.title}${bar.event.calendar ? ` — ${bar.event.calendar}` : ""}`}
                  className="absolute truncate px-1.5 text-left leading-5"
                  style={{
                    left: `calc(${(bar.startIndex / 7) * 100}% + 1px)`,
                    width: `calc(${((bar.endIndex - bar.startIndex + 1) / 7) * 100}% - 2px)`,
                    top: bar.lane * 22,
                    height: 20,
                    ...surface.span(bar.event),
                    borderRadius: 0,
                    fontSize: 12,
                  }}
                >
                  {bar.continuesBefore && "‹ "}
                  {bar.event.title}
                  {bar.continuesAfter && " ›"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Deadlines use their own labelled band, checkbox, dashed edge, and
            amber wash so they never rely on colour alone to differ from events. */}
        {todos.length > 0 && (
          <div
            className="grid gap-px border-b py-1 font-mono"
            style={{
              gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))`,
              borderColor: "var(--border)",
            }}
          >
            <div className="pi-meta pr-1 text-right" style={{ color: "var(--accent-amber)" }}>
              {t("robin.todos.deadlines")}
            </div>
            {days.map((date) => (
              <div key={date} className="flex min-w-0 flex-col gap-1 px-0.5">
                {todos.filter((todo) => todo.due === date).map((todo) => (
                  <div
                    key={todo.id}
                    className="flex min-h-7 items-center gap-1.5 overflow-hidden px-1.5"
                    style={{
                      background: "var(--accent-amber-soft)",
                      border: "1px dashed var(--accent-amber-line)",
                      color: todo.color ? `var(--todo-${todo.color})` : "var(--text)",
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
                    <TodoTitle todo={todo} t={t} className="min-w-0 truncate" style={{ fontSize: 11.5 }} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Time grid — sized to its content, so the page keeps the only scrollbar. */}
        <div className="relative">
          <div
            className="grid gap-px"
            style={{ gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))` }}
          >
            {/* Hour gutter */}
            <div className="font-mono">
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="relative pr-1 text-right tabular-nums"
                  style={{ height: HOUR_HEIGHT, color: "var(--text-muted)", fontSize: 12 }}
                >
                  {/* Under the rule rather than straddling it: the label then
                      reads as naming the band below it, and the first hour is
                      no longer the one row without a time on it. */}
                  <span className="absolute right-1 top-0.5">
                    {`${String(hour).padStart(2, "0")}:00`}
                  </span>
                </div>
              ))}
            </div>

            {days.map((date) => {
              const dayEvents = events.filter((event) => occursOn(event, date));
              const placed = layoutDayEvents(dayEvents);
              const isToday = date === today;
              return (
                <div
                  key={date}
                  data-date={date}
                  className="relative"
                  style={{
                    height: gridHeight,
                    // A hue of its own, so it separates from the event-tinted
                    // blocks laid on top of it — and the one today mark that
                    // covers area rather than a line, so it stays the quiet
                    // one. The badge, the heading rule and the now-line are
                    // what actually identify the day.
                    background: isToday ? "var(--today-wash-quiet)" : "transparent",
                  }}
                >
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      className="absolute inset-x-0 border-t"
                      style={{
                        top: (hour - firstHour) * HOUR_HEIGHT,
                        borderColor: "var(--border)",
                        opacity: 0.5,
                      }}
                    />
                  ))}

                  {isToday && nowMinutes >= gridOffsetMinutes && nowMinutes < gridEndMinutes && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10"
                      style={{
                        top: (nowMinutes - gridOffsetMinutes) * PX_PER_MINUTE,
                        borderTop: "2px solid var(--today-mark)",
                      }}
                      aria-hidden
                    />
                  )}

                  {placed.map(({ event, startMinutes, endMinutes, column, columns }) => {
                    const height = Math.max((endMinutes - startMinutes) * PX_PER_MINUTE - 2, 16);
                    // A half-hour block is 22px: two lines do not fit in it, and
                    // the clipped second line is what made short events unreadable.
                    // Below two lines' worth the time is dropped — the block's own
                    // position and the tooltip both still carry it.
                    const showTime = height >= 36;
                    const showLocation = height >= 68 && Boolean(event.location);
                    const titleLines = height >= 52 ? 2 : 1;
                    // The serif holds its size a column longer than the mono
                    // did — it is the narrower face, which is the whole reason
                    // the title is set in it — so only a four-way overlap
                    // needs a step down.
                    const titleSize = columns >= 4 ? TITLE_SIZE_TIGHT : TITLE_SIZE;
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => onSelectEvent(event)}
                        aria-haspopup="dialog"
                        title={`${formatEventTime(event)} ${event.title}${event.location ? ` @ ${event.location}` : ""}`}
                        // A button centres its content vertically, so a long
                        // block floated its title in the middle of itself
                        // rather than putting it at the time it starts.
                        className="calendar-event-block absolute flex flex-col items-start overflow-hidden px-1.5 py-1 text-left"
                        style={{
                          top: (startMinutes - gridOffsetMinutes) * PX_PER_MINUTE,
                          height,
                          left: `calc(${(column / columns) * 100}% + 1px)`,
                          width: `calc(${(1 / columns) * 100}% - 2px)`,
                          ...surface.timed(event),
                        }}
                      >
                        <span
                          style={{
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: titleLines,
                            overflow: "hidden",
                            // `anywhere` breaks inside a word whenever it helps
                            // the line, which in a narrow column turned
                            // "Anthropic" into "Anthropi / c". `break-word`
                            // only splits a word that cannot fit a line of its
                            // own, which here is the genuine last resort.
                            overflowWrap: "break-word",
                            // When a word genuinely cannot fit — a 55px column
                            // in a four-way overlap — break it at a syllable
                            // with a hyphen rather than mid-letter.
                            hyphens: "auto",
                            fontSize: titleSize,
                            lineHeight: 1.22,
                          }}
                        >
                          {event.title}
                        </span>
                        {showTime && (
                          <span
                            className="block max-w-full truncate tabular-nums"
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: META_SIZE,
                              lineHeight: 1.3,
                              color: "var(--text-muted)",
                            }}
                          >
                            {formatEventTime(event)}
                          </span>
                        )}
                        {showLocation && (
                          <span
                            className="block max-w-full truncate"
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: META_SIZE,
                              lineHeight: 1.3,
                              color: "var(--text-dim)",
                            }}
                          >
                            {event.location}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
