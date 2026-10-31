"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsSplitLayout } from "@/hooks/useIsMobile";
import { formatLocalDateRange } from "@/extension/robin/dates";
import type { Todo } from "@/extension/robin/todo-domain";
import { CalendarTodoTitle } from "./CalendarTodoTitle";
import { TodoDragHandle } from "./TodoDragHandle";
import { TodoTitle } from "./TodoTitle";
import { calendarTaskPreview } from "./calendar-task-layout";
import styles from "./CalendarPanel.module.css";

type Props = {
  todos: Todo[]; days: string[]; today: string;
  pending: ReadonlySet<string>; error: string | null;
  onComplete: (todo: Todo) => void; onEdit: (todo: Todo) => void;
};

export function CalendarTasks(props: Props) {
  const { t } = useI18n();
  const id = useId();
  const [collapsed, setCollapsed] = useState(false);
  const [opened, setOpened] = useState<{ date: string; task?: string } | null>(null);
  const preview = calendarTaskPreview(props.todos, props.days);
  const desktop = useIsSplitLayout();
  const summaryOnly = !desktop || props.days.length > 1;
  const check = (todo: Todo) => <label className={styles.todoCheck}>
    <input type="checkbox" checked={todo.done} disabled={props.pending.has(todo.id)} onChange={() => props.onComplete(todo)}
      aria-label={t("robin.todos.complete", { title: todo.title })} />
  </label>;
  return <>
    {preview.total > 0 && <div className={styles.weekRow} data-calendar-tasks>
      <div className={`${styles.bandLabel} ${styles.taskLabel}`}>
        <button type="button" data-calendar-task-toggle aria-expanded={!collapsed} aria-controls={id}
          aria-label={t(collapsed ? "robin.calendar.showTasks" : "robin.calendar.hideTasks")}
          onClick={() => setCollapsed(!collapsed)}><span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>{t("robin.todos.title")}</button>
      </div>
      <div id={id} className={`${styles.band} ${styles.taskBand}`} data-summary={summaryOnly || undefined} hidden={collapsed}>
        <div className={styles.bandTargets} aria-hidden="true">
          {props.days.map((date) => <div key={date} data-calendar-date={date} />)}
        </div>
        {summaryOnly ? preview.days.map((day) => {
          const first = day.todos.find((todo) => todo.due === day.date) ?? day.todos[0];
          return first ? <button type="button" key={day.date}
            className={styles.taskSummary} data-calendar-task-summary={day.date} aria-haspopup="dialog"
            aria-label={`${t("robin.calendar.taskCountOn", { date: day.date, count: String(day.todos.length) })}: ${first.title}`}
            onClick={() => setOpened({ date: day.date })}>
            <span className={styles.taskSummaryTitle}>{first.title}</span>
            {day.todos.length > 1 && <span className={styles.taskSummaryMore} aria-hidden="true">+{day.todos.length - 1}</span>}
          </button> : <span key={day.date} data-calendar-task-empty={day.date} />;
        }) : <>{preview.visible.map((bar) => <div key={bar.event.id} className={styles.weekTodo}
          style={{ gridColumn: `${bar.startIndex + 1} / ${bar.endIndex + 2}`, gridRow: bar.lane + 1 }}
          data-calendar-task={bar.event.id} aria-busy={props.pending.has(bar.event.id)}
          data-deadline={bar.event.due! < props.today ? "overdue" : bar.event.due === props.today ? "today" : undefined}>
          <CalendarTodoTitle todo={bar.event} check={check(bar.event)}
            onOpen={() => setOpened({ date: props.days[bar.startIndex]!, task: bar.event.id })}>
            <TodoDragHandle todo={bar.event} disabled={props.pending.has(bar.event.id)} />
          </CalendarTodoTitle>
          {bar.event.color && <span className={styles.taskColor} style={{ background: `var(--event-${bar.event.color})` }} aria-hidden="true" />}
          {bar.event.startDate && bar.event.startDate < bar.event.due! && <span className={styles.taskRange}>
            {bar.continuesBefore && "‹ "}{bar.event.startDate} – {bar.event.due}{bar.continuesAfter && " ›"}
          </span>}
          {props.pending.has(bar.event.id) && <span role="status" className={styles.taskRange}>{t("robin.calendar.saving")}</span>}
        </div>)}
        {preview.days.map((day, index) => day.hidden > 0 && <button type="button" key={day.date}
          className={styles.taskMore} style={{ gridColumn: index + 1, gridRow: 4 }} aria-haspopup="dialog"
          aria-label={t("robin.calendar.moreTasksOn", { date: day.date, count: String(day.hidden) })}
          onClick={() => setOpened({ date: day.date })}>{t("robin.calendar.moreTasks", { count: String(day.hidden) })}</button>)}</>}
      </div>
    </div>}
    {opened && <TaskDayDialog key={opened.date} {...props} date={opened.date} initialTask={opened.task}
      todos={preview.days.find((day) => day.date === opened.date)?.todos ?? []} onClose={() => setOpened(null)} />}
  </>;
}

function TaskDayDialog({ date, initialTask, todos, today, pending, error, onComplete, onEdit, onClose }: Props & {
  date: string; initialTask?: string; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const calendar = trigger?.closest(".robin-calendar");
    node.showModal();
    const target = [...node.querySelectorAll<HTMLElement>("[data-task-detail]")].find((row) => row.dataset.taskDetail === initialTask);
    (target ?? heading.current)?.focus();
    return () => {
      node.close();
      const fallback = calendar?.querySelector<HTMLElement>("[data-calendar-task-toggle]") ?? calendar?.querySelector<HTMLElement>(".robin-calendar-add");
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else if (fallback?.isConnected) fallback.focus({ preventScroll: true });
    };
  }, [initialTask]);
  useEffect(() => {
    if (document.hasFocus() && dialog.current?.open && !dialog.current.contains(document.activeElement)) heading.current?.focus({ preventScroll: true });
  }, [todos]);
  return <dialog ref={dialog} className={`calendar-event-dialog ${styles.taskDialog}`} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className={styles.taskDialogHeader}>
      <h2 ref={heading} tabIndex={-1} id={titleId}>{t("robin.calendar.tasksOn", { date })} <small>{todos.length}</small></h2>
      <button type="button" className={styles.iconButton} aria-label={t("i18n.close")} onClick={onClose}>×</button>
    </header>
    <div className={styles.taskDialogBody}>
      {error && <p role="alert" className={styles.feedback}>{error}</p>}
      {!todos.length && <p role="status">{t("robin.calendar.noTasks")}</p>}
      {todos.map((todo) => <div key={todo.id} data-task-detail={todo.id} tabIndex={-1} className={styles.taskDetailRow} aria-busy={pending.has(todo.id)}>
        <label className={styles.todoCheck}><input type="checkbox" checked={todo.done} disabled={pending.has(todo.id)}
          aria-label={t("robin.todos.complete", { title: todo.title })} onChange={() => onComplete(todo)} /></label>
        <div className={styles.taskDetailCopy}>
          <TodoTitle todo={todo} t={t} nativeTooltip={false} />
          <span className={styles.taskRange}>{formatLocalDateRange(todo.startDate ?? todo.due!, todo.due!, locale, today)}</span>
          {todo.due! <= today && <span className={styles.taskStatus} data-overdue={todo.due! < today || undefined}>
            {t(todo.due! < today ? "robin.calendar.taskOverdue" : "robin.calendar.taskDueToday")}
          </span>}
          {pending.has(todo.id) && <span role="status">{t("robin.calendar.saving")}</span>}
        </div>
        <button type="button" className={styles.control} disabled={pending.has(todo.id)}
          aria-label={t("robin.calendar.moveTodo", { title: todo.title })} onClick={() => { onClose(); onEdit(todo); }}>{t("robin.calendar.taskEditDate")}</button>
      </div>)}
    </div>
  </dialog>;
}
