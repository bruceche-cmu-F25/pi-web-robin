"use client";

import { useI18n } from "@/hooks/useI18n";
import { groupAgendaItems } from "@/extension/robin/agenda";
import { parseLocalDate, addDays, formatLocalDateRange } from "@/extension/robin/dates";
import { compareEvents, eventEndDate, formatEventTime, isAllDayBand, isReadOnlyEvent, type DashboardEvent } from "@/extension/robin/events";
import { layoutSpanBars } from "@/extension/robin/layout";
import { useEventSurface } from "./eventSurface";
import { TodoTitle } from "./TodoTitle";
import { TodoDragHandle } from "./TodoDragHandle";
import { ReadableText } from "./ReadableText";
import type { Todo } from "@/extension/robin/todo-domain";
import { useTodayInView } from "./useTodayInView";
import { eventDragProps } from "./CalendarInteractions";
import type { CalendarSlot } from "./calendar-edit";
import styles from "./CalendarPanel.module.css";
export type { CalendarView } from "./calendar-view";

interface ViewProps {
  events: DashboardEvent[];
  today: string;
  onSelectEvent: (event: DashboardEvent) => void;
}

export function AgendaView({ events, todos, today, start, onSelectEvent, onCompleteTodo }: ViewProps & {
  todos: Todo[]; start: string; onCompleteTodo: (todo: Todo) => void;
}) {
  const { t, locale } = useI18n();
  const surface = useEventSurface();
  const grouped = groupAgendaItems(events, todos, start);
  const withStart = grouped.some((group) => group.date === start) ? grouped
    : [{ date: start, events: [] as DashboardEvent[], todos: [] as Todo[] }, ...grouped];
  const dayLabel = (date: string) => date === today ? t("robin.calendar.relativeToday")
    : date === addDays(today, 1) ? t("robin.calendar.relativeTomorrow")
      : parseLocalDate(date).toLocaleDateString(locale, { weekday: "long", month: "short", day: "numeric" });
  const eventRow = (event: DashboardEvent) => <button key={event.id} type="button" onClick={() => onSelectEvent(event)}
    aria-haspopup="dialog" className="robin-agenda-event flex min-h-8 w-full items-center gap-3 px-2 py-1 text-left"
    style={isAllDayBand(event) ? surface.span(event) : surface.timed(event)}>
    <span className="robin-agenda-time shrink-0 tabular-nums" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", minWidth: "5.5rem" }}>
      {event.start ? formatEventTime(event) : t("robin.calendar.allDay")}
    </span>
    <span className="robin-agenda-event-title min-w-0 flex-1 [overflow-wrap:anywhere] desktop:truncate">
      {event.title}{event.location && <span style={{ color: "var(--text-dim)" }}> @ {event.location}</span>}
      {isReadOnlyEvent(event) && <span style={{ color: "var(--text-dim)" }}> · {event.calendar ?? "Google"}</span>}
    </span>
  </button>;
  const todoRow = (todo: Todo) => <div key={todo.id} className="robin-agenda-todo flex min-h-8 items-center gap-3 px-2 py-1"
    style={{ background: "var(--accent-amber-soft)", borderLeft: "2px solid var(--accent-amber-line)" }}>
    <span className="pi-eyebrow shrink-0" style={{ color: "var(--accent-amber)", minWidth: "5.5rem" }}>{t("robin.todos.title")}</span>
    <label className="robin-agenda-check flex shrink-0 cursor-pointer items-center justify-center">
      <input type="checkbox" checked={todo.done} onChange={() => onCompleteTodo(todo)} aria-label={t("robin.todos.complete", { title: todo.title })} />
    </label>
    <TodoDragHandle todo={todo} />
    <ReadableText className="flex-1"><TodoTitle todo={todo} t={t}
      className="block min-w-0 text-sm [overflow-wrap:anywhere] desktop:truncate" /></ReadableText>
    {todo.startDate && todo.due && todo.startDate < todo.due && <span className="shrink-0 text-xs" style={{ color: "var(--text-dim)" }}>
      {formatLocalDateRange(todo.startDate, todo.due, locale, today)}
    </span>}
  </div>;
  return <div className={`${styles.agenda} flex flex-col gap-3`} data-calendar-scroll>
    {withStart.filter((group) => group.date <= addDays(start, 2)).map((group) => <div key={group.date} data-calendar-date={group.date} className="flex flex-col gap-1">
      <h3 className="pi-eyebrow">{group.date === today && <span className="pi-today-badge mr-2">{parseLocalDate(today).getDate()}</span>}{dayLabel(group.date)}</h3>
      {!group.events.length && !group.todos.length && <p className="px-2 py-1 text-sm" style={{ color: "var(--text-dim)" }}>{t("robin.calendar.nothingScheduled")}</p>}
      {group.todos.map(todoRow)}{group.events.map(eventRow)}
    </div>)}
    {withStart.filter((group) => group.date > addDays(start, 2)).map((group) => <details key={group.date} data-calendar-date={group.date} className="robin-agenda-brief border-b" style={{ borderColor: "var(--border)" }}>
      <summary className="ui-action cursor-pointer py-3 text-xs"><span className="font-mono">{dayLabel(group.date)}</span><span className="ml-2">· {group.events.length + group.todos.length}</span></summary>
      <div className="flex min-w-0 flex-col gap-2 pb-2">{group.todos.map(todoRow)}{group.events.map(eventRow)}</div>
    </details>)}
  </div>;
}

const BAR_HEIGHT = 24;
const DATE_HEIGHT = 34;
const MAX_BARS = 2;
const CELL_ITEMS = 4;

export function MonthView({ events, todos, today, days, month, onSelectDay, onSelectEvent, onCompleteTodo, onCreate }: ViewProps & {
  todos: Todo[]; days: string[]; month: string;
  onSelectDay: (date: string) => void;
  onCompleteTodo: (todo: Todo) => void;
  onCreate: (slot: CalendarSlot) => void;
}) {
  const { t, locale } = useI18n();
  const surface = useEventSurface();
  const scroller = useTodayInView(month, today);
  const weeks = Array.from({ length: days.length / 7 }, (_, index) => days.slice(index * 7, index * 7 + 7));
  return <div ref={scroller} className={`${styles.monthScroll} overflow-x-auto`} data-calendar-scroll>
    <div className={styles.month}>
      <div className={styles.monthWeekdays}>{days.slice(0, 7).map((date) => <span key={date}>
        {parseLocalDate(date).toLocaleDateString(locale, { weekday: "short" })}
      </span>)}</div>
      {weeks.map((week) => {
        const { bars, lanes } = layoutSpanBars(events, week);
        const taskRanges = todos.flatMap((todo) => todo.startDate && todo.due && todo.startDate < todo.due
          ? [{ ...todo, date: todo.startDate, endDate: todo.due }] : []);
        const taskBars = layoutSpanBars(taskRanges, week);
        const visibleLanes = Math.min(MAX_BARS, lanes + taskBars.lanes);
        return <div key={week[0]} className={styles.monthWeek}>
          <div className={styles.monthCells}>
            {week.map((date) => {
              const dayEvents = events.filter((event) => !isAllDayBand(event) && event.date === date).sort(compareEvents);
              const dayTodos = todos.filter((todo) => todo.due === date && (!todo.startDate || todo.startDate === todo.due));
              const capacity = CELL_ITEMS - visibleLanes;
              const shownEvents = dayEvents.slice(0, capacity);
              const shownTodos = dayTodos.slice(0, Math.max(0, capacity - shownEvents.length));
              const hiddenBars = bars.filter((bar) => bar.lane >= MAX_BARS && date >= bar.event.date && date <= eventEndDate(bar.event)).length;
              const hiddenTasks = taskBars.bars.filter((bar) => bar.lane + lanes >= MAX_BARS && date >= bar.event.date && date <= bar.event.endDate).length;
              const hidden = hiddenBars + hiddenTasks + dayEvents.length - shownEvents.length + dayTodos.length - shownTodos.length;
              return <div key={date} className={styles.monthCell} data-date={date} data-calendar-date={date} data-outside={date.slice(0, 7) !== month.slice(0, 7) || undefined}>
                <button type="button" className={styles.monthBlank} data-calendar-create onClick={() => onCreate({ date })}
                  aria-label={t("robin.calendar.createAt", { date, time: t("robin.calendar.allDay") })} />
                <div className={styles.monthContent} style={{ paddingTop: DATE_HEIGHT + visibleLanes * BAR_HEIGHT }}>
                  {shownEvents.map((event) => <button key={event.id} type="button" {...eventDragProps(event)}
                    className={styles.monthChip} onClick={() => onSelectEvent(event)} aria-haspopup="dialog" title={`${formatEventTime(event)} ${event.title}`}>
                    <span className={styles.dot} style={{ background: surface.marker(event) }} aria-hidden />
                    <time>{event.start}</time><span className="min-w-0 truncate">{event.title}</span>
                  </button>)}
                  {shownTodos.map((todo) => <div key={todo.id} className={`${styles.monthChip} ${styles.todo}`} title={todo.title}>
                    <input type="checkbox" checked={todo.done} onChange={() => onCompleteTodo(todo)} aria-label={t("robin.todos.complete", { title: todo.title })} />
                    <TodoDragHandle todo={todo} />
                    <TodoTitle todo={todo} t={t} className="min-w-0 truncate" />
                  </div>)}
                  {hidden > 0 && <button type="button" className={styles.more} onClick={() => onSelectDay(date)}>{t("robin.calendar.more", { count: String(hidden) })}</button>}
                </div>
              </div>;
            })}
          </div>
          <div className={styles.monthNumbers}>{week.map((date) => <button key={date} type="button"
            className={date === today ? styles.today : date.slice(0, 7) !== month.slice(0, 7) ? styles.outside : undefined}
            aria-current={date === today ? "date" : undefined} aria-label={t("robin.calendar.openDay", { date })}
            onClick={() => onSelectDay(date)}>{parseLocalDate(date).getDate()}</button>)}</div>
          {bars.filter((bar) => bar.lane < MAX_BARS).map((bar) => <button key={bar.event.id} type="button"
            {...eventDragProps(bar.event)} className={styles.span} onClick={() => onSelectEvent(bar.event)} aria-haspopup="dialog" title={bar.event.title}
            style={{ ...surface.span(bar.event), left: `calc(${bar.startIndex / 7 * 100}% + 3px)`,
              width: `calc(${(bar.endIndex - bar.startIndex + 1) / 7 * 100}% - 6px)`,
              top: DATE_HEIGHT + bar.lane * BAR_HEIGHT, height: BAR_HEIGHT - 2 }}>
            {bar.continuesBefore && "‹ "}{bar.event.title}{bar.continuesAfter && " ›"}
          </button>)}
          {taskBars.bars.filter((bar) => bar.lane + lanes < MAX_BARS).map((bar) => <div key={bar.event.id}
            className={`${styles.span} ${styles.todo}`} title={bar.event.title}
            style={{ left: `calc(${bar.startIndex / 7 * 100}% + 3px)`, width: `calc(${(bar.endIndex - bar.startIndex + 1) / 7 * 100}% - 6px)`,
              top: DATE_HEIGHT + (bar.lane + lanes) * BAR_HEIGHT, height: BAR_HEIGHT - 2 }}>
            <input type="checkbox" checked={bar.event.done} onChange={() => onCompleteTodo(bar.event)} aria-label={t("robin.todos.complete", { title: bar.event.title })} />
            <TodoDragHandle todo={bar.event} />
            <TodoTitle todo={bar.event} t={t} className="min-w-0 truncate" />
          </div>)}
        </div>;
      })}
    </div>
  </div>;
}
