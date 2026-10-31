"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { parseLocalDate, weekDays } from "@/extension/robin/dates";
import { formatEventTime, isReadOnlyEvent, occursOn, type DashboardEvent } from "@/extension/robin/events";
import { layoutDayEvents, layoutSpanBars } from "@/extension/robin/layout";
import type { Todo } from "@/extension/robin/todo-domain";
import { useEventSurface } from "./eventSurface";
import { CalendarTasks } from "./CalendarTasks";
import { useTodayInView } from "./useTodayInView";
import { eventDragProps } from "./CalendarInteractions";
import type { CalendarSlot } from "./calendar-edit";
import styles from "./CalendarPanel.module.css";

const HOUR_HEIGHT = 56;
const SCALE = HOUR_HEIGHT / 60;
const START_HOUR = 6;
const END_HOUR = 21;
const START_MINUTE = START_HOUR * 60;
const END_MINUTE = END_HOUR * 60;
const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, hour) => hour + START_HOUR);

export function WeekGrid({ events, todos, today, anchor, singleDay = false, onSelectEvent, onCompleteTodo, onCreate, onSelectDay, pendingTodos, todoError, onEditTodo }: {
  events: DashboardEvent[];
  todos: Todo[];
  today: string;
  anchor: string;
  singleDay?: boolean;
  onSelectEvent: (event: DashboardEvent) => void;
  onCompleteTodo: (todo: Todo) => void;
  pendingTodos: ReadonlySet<string>;
  todoError: string | null;
  onEditTodo: (todo: Todo) => void;
  onCreate: (slot: CalendarSlot) => void;
  onSelectDay: (date: string) => void;
}) {
  const { t, locale } = useI18n();
  const surface = useEventSurface();
  const days = singleDay ? [anchor] : weekDays(anchor);
  const scroller = useTodayInView(`${anchor}:${singleDay}`, today);
  const { bars, lanes } = layoutSpanBars(events, days);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const nowMinutes = now ? now.getHours() * 60 + now.getMinutes() : -1;
  const spanPosition = (bar: { startIndex: number; endIndex: number; lane: number }): CSSProperties => ({
    left: `calc(${bar.startIndex / days.length * 100}% + 2px)`,
    width: `calc(${(bar.endIndex - bar.startIndex + 1) / days.length * 100}% - 4px)`,
    top: `calc(${bar.lane} * var(--all-day-step, 26px) + 2px)`, height: "var(--all-day-height, 24px)",
  });

  return <div className={`${styles.weekScroller} overflow-x-auto`} data-calendar-scroll ref={scroller}>
    <div className={styles.weekCanvas} data-single={singleDay || undefined} style={{ "--days": days.length } as CSSProperties}>
      <div className={styles.weekHeader} data-calendar-sticky>
        <div className={`${styles.weekRow} ${styles.weekDates}`}>
          <div className={styles.bandLabel}>{t("robin.calendar.localTime")}</div>
          {days.map((date) => <div key={date} className={styles.weekDay}>
            <span className={styles.weekday}>{parseLocalDate(date).toLocaleDateString(locale, { weekday: "short" })}</span>
            <button type="button" className={`${styles.dateNumber} ${date === today ? styles.today : ""}`}
              aria-current={date === today ? "date" : undefined} aria-label={t("robin.calendar.openDay", { date })}
              onClick={() => onSelectDay(date)}>{parseLocalDate(date).getDate()}</button>
          </div>)}
        </div>
        <div className={styles.weekRow}>
          <div className={styles.bandLabel}>{t("robin.calendar.allDay")}</div>
          <div className={styles.band} style={{ height: `max(36px, calc(${lanes} * var(--all-day-step, 26px) + 14px))` }}>
            <div className={styles.bandTargets}>
              {days.map((date) => <button key={date} type="button" data-calendar-date={date} data-calendar-create
                aria-label={t("robin.calendar.createAt", { date, time: t("robin.calendar.allDay") })}
                onClick={() => onCreate({ date })} />)}
            </div>
            {bars.map((bar) => <button key={bar.event.id} type="button" {...eventDragProps(bar.event)}
              onClick={() => onSelectEvent(bar.event)} aria-haspopup="dialog" title={bar.event.title}
              className={styles.span} style={{ ...spanPosition(bar), ...surface.span(bar.event) }}>
              {bar.continuesBefore && "‹ "}{bar.event.title}{bar.continuesAfter && " ›"}
            </button>)}
          </div>
        </div>
      </div>
      <CalendarTasks todos={todos} days={days} today={today} pending={pendingTodos} error={todoError}
        onComplete={onCompleteTodo} onEdit={onEditTodo} />
      <div className={styles.weekRow}>
        <div>{HOURS.map((hour) => <div key={hour} className={styles.hour}>{String(hour).padStart(2, "0")}:00</div>)}
          <div className={`${styles.hour} ${styles.endHour}`}>{END_HOUR}:00</div>
        </div>
        {days.map((date) => <div key={date} className={styles.timeColumn} data-date={date}
          data-calendar-date={date} data-calendar-minute={START_MINUTE} data-calendar-scale={SCALE} data-today={date === today || undefined} style={{ height: GRID_HEIGHT }}>
          {HOURS.map((hour) => <button key={hour} type="button" className={styles.hourSlot} data-calendar-create
            style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }}
            aria-label={t("robin.calendar.createAt", { date, time: `${String(hour).padStart(2, "0")}:00` })}
            onClick={(event) => {
              const offset = event.detail === 0 ? 0 : (event.clientY - event.currentTarget.getBoundingClientRect().top) / SCALE;
              onCreate({ date, minute: hour * 60 + Math.max(0, Math.min(59, offset)) });
            }} />)}
          {date === today && nowMinutes >= START_MINUTE && nowMinutes < END_MINUTE && <div className={styles.now} style={{ top: (nowMinutes - START_MINUTE) * SCALE }} aria-hidden />}
          {layoutDayEvents(events.filter((event) => occursOn(event, date)))
            .filter(({ startMinutes, endMinutes }) => startMinutes < END_MINUTE && endMinutes > START_MINUTE)
            .map(({ event, startMinutes, endMinutes, column, columns }) => {
            const visibleStart = Math.max(START_MINUTE, startMinutes);
            const visibleEnd = Math.min(END_MINUTE, endMinutes);
            const top = Math.min((visibleStart - START_MINUTE) * SCALE, GRID_HEIGHT - 20);
            const height = Math.min(GRID_HEIGHT - top, Math.max(20, (visibleEnd - visibleStart) * SCALE - 2));
            const colors = surface.timed(event);
            return <button key={event.id} type="button" {...eventDragProps(event)} onClick={() => onSelectEvent(event)}
              aria-haspopup="dialog" title={`${formatEventTime(event)} ${event.title}`}
              className={`${styles.event} calendar-event-block`}
              style={{ ...colors, top, height,
                left: `calc(${column / columns * 100}% + 2px)`, width: `calc(${100 / columns}% - 4px)` }}>
              <span className={styles.eventTitle} style={{ WebkitLineClamp: height < 50 ? 1 : 2 }}>{event.title}</span>
              {height >= 38 && <span className={styles.eventMeta}>{formatEventTime(event)}</span>}
              {height >= 76 && event.location && <span className={styles.eventMeta}>{event.location}</span>}
              {!isReadOnlyEvent(event) && endMinutes <= END_MINUTE && <span data-calendar-resize className={styles.resize} aria-hidden />}
            </button>;
          })}
        </div>)}
      </div>
    </div>
  </div>;
}
