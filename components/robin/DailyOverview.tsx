"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { addDays, localDate, parseLocalDate, weekDays } from "@/extension/robin/dates";
import { deduplicateCalendarEvents, eventsInRange, type DashboardEvent } from "@/extension/robin/events";
import { writeUrlState } from "@/lib/url-state";
import type { EditableTodo } from "@/extension/robin/todo-domain";
import type { Link as SavedLink } from "@/extension/robin/links";
import { dailyEventPreview, eventRecordHref, nearbyTodos, todoRecordHref } from "./dashboard-view";
import { AttentionPanel } from "./AttentionPanel";
import { BriefBoard } from "./BriefBoard";
import { useLinkIconBackfill } from "./SavedLinkIcon";
import { SavedLinkLaunch } from "./SavedLinkLaunch";
import { requestRefresh } from "./refreshBus";
import { mutateResponse, usePolledResource } from "./usePolledResource";
import styles from "./DailyOverview.module.css";

function Chevron() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>;
}

export function DailyOverview() {
  const { t, locale } = useI18n();
  const search = useSearchParams();
  const [now, setNow] = useState<Date | null>(null);
  const [allLinks, setAllLinks] = useState(false);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [receipts, setReceipts] = useState<EditableTodo[]>([]);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const saving = useRef(new Set<string>());
  const taskPanel = useRef<HTMLElement>(null);
  useEffect(() => { const update = () => setNow(new Date()); update(); const timer = setInterval(update, 60_000); return () => clearInterval(timer); }, []);
  const tasks = usePolledResource<{ todos: EditableTodo[]; today: string }>("/api/robin/todos");
  const today = tasks.data?.today ?? (now ? localDate(now) : "");
  let selectedDate = today;
  try { const date = search.get("dailyDate"); if (date) { parseLocalDate(date); selectedDate = date; } } catch { /* Invalid bookmarks fall back to today. */ }
  const days = selectedDate ? weekDays(selectedDate) : [];
  const calendar = usePolledResource<{ events: DashboardEvent[]; google?: { connected: boolean; error?: string } }>(days.length ? `/api/robin/events?from=${days[0]}&to=${days.at(-1)}` : "/api/robin/events", 60_000, Boolean(selectedDate));
  const links = usePolledResource<{ links: SavedLink[] }>("/api/robin/links");
  const weekEvents = deduplicateCalendarEvents(calendar.data?.events ?? []);
  const time = now && localDate(now) === today ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` : undefined;
  const allDay = eventsInRange(weekEvents, selectedDate, selectedDate).filter(event => !event.start);
  const { featured: first, phase, others } = dailyEventPreview(weekEvents.filter(event => event.start), selectedDate, today, time);
  const selectDate = (date: string) => writeUrlState({ view: "daily", dailyDate: date === today ? null : date });
  const due = today ? nearbyTodos(tasks.data?.todos ?? [], today) : [];
  const savedDailyLinks = (links.data?.links ?? []).filter((link) => link.group === "日常入口");
  const dailyLinks = allLinks ? savedDailyLinks : savedDailyLinks.slice(0, 6);
  useLinkIconBackfill(dailyLinks, links.refresh);
  const dateLabel = (date: string) => date === today ? t("robin.calendar.relativeToday") : today && date === addDays(today, 1) ? t("daily.tomorrow") : parseLocalDate(date).toLocaleDateString(locale, { month: "short", day: "numeric", weekday: "short" });
  const eventDate = (event: DashboardEvent) => event.endDate && event.endDate > event.date ? `${dateLabel(event.date)} – ${dateLabel(event.endDate)}` : dateLabel(event.date);
  const href = (path: string) => {
    const url = new URL(path, "https://robin.invalid");
    for (const key of ["session", "cwd"]) { const value = search.get(key); if (value) url.searchParams.set(key, value); }
    return url.pathname + url.search + url.hash;
  };
  const retry = (error: string | null, refresh: () => Promise<void>) => error && <p role="alert" className={styles.error}>{error} <button type="button" className="ui-action" onClick={() => void refresh()}>{t("daily.retry")}</button></p>;
  async function complete(todo: EditableTodo, done: boolean) {
    if (saving.current.has(todo.id)) return;
    const trigger = document.activeElement;
    saving.current.add(todo.id); setPending(new Set(saving.current));
    setActionErrors(current => { const next = { ...current }; delete next[todo.id]; return next; });
    try {
      if (!todo.revision) throw new Error(t("robin.calendar.reloadTodo"));
      const response = await mutateResponse("/api/robin/todos", "PATCH", { id: todo.id, revision: todo.revision, done });
      const body = await response.json() as { todo: EditableTodo };
      tasks.updateData(current => current && { ...current, todos: current.todos.map(item => item.id === body.todo.id ? body.todo : item) });
      setReceipts(current => done ? [...current.filter(item => item.id !== todo.id), body.todo] : current.filter(item => item.id !== todo.id));
      // A late acknowledgement must not steal focus from another task or pane.
      if ((document.activeElement === trigger || document.activeElement === document.body) && taskPanel.current?.getClientRects().length) taskPanel.current.focus({ preventScroll: true });
      requestRefresh();
    } catch (caught) {
      setActionErrors(current => ({ ...current, [todo.id]: `${todo.title}: ${caught instanceof Error ? caught.message : String(caught)}` }));
    } finally { saving.current.delete(todo.id); setPending(new Set(saving.current)); }
  }
  return <div className={styles.daily}>
    <section className={styles.section} data-tone="calendar" aria-labelledby="daily-upcoming">
      <h2 id="daily-upcoming" className="sr-only">{t("daily.upcoming")}</h2>
      <div className={styles.schedule}>
        <details className={styles.datePicker}>
          <summary className="ui-action"><span>{t("daily.changeDate")}{selectedDate && selectedDate !== today && ` · ${dateLabel(selectedDate)}`}</span><Chevron /></summary>
        <div className={styles.dateToolbar}>
          <strong>{selectedDate && parseLocalDate(selectedDate).toLocaleDateString(locale, { year: "numeric", month: "long" })}</strong>
          <div>
            <button type="button" className="ui-action" disabled={!selectedDate} aria-label={t("robin.calendar.previous")} onClick={() => selectDate(addDays(selectedDate, -7))}>‹</button>
            <button type="button" className="ui-action" disabled={!today} onClick={() => selectDate(today)}>{t("robin.calendar.today")}</button>
            <button type="button" className="ui-action" disabled={!selectedDate} aria-label={t("robin.calendar.next")} onClick={() => selectDate(addDays(selectedDate, 7))}>›</button>
          </div>
        </div>
        <nav className={styles.dayStrip} aria-label={t("robin.calendar.date")}>
          {days.map(date => {
            const count = eventsInRange(weekEvents, date, date).length;
            const known = calendar.data && !calendar.error && !calendar.data.google?.error;
            return <button type="button" key={date} className="ui-action" data-day={date} aria-current={date === today ? "date" : undefined} aria-pressed={date === selectedDate} aria-label={`${t("robin.calendar.openDay", { date })}${known ? ` · ${t("daily.eventCount", { count: String(count) })}` : ""}`} onClick={() => selectDate(date)}>
              <span>{parseLocalDate(date).toLocaleDateString(locale, { weekday: "narrow" })}</span><strong>{parseLocalDate(date).getDate()}</strong><i data-events={known && count > 0 || undefined} aria-hidden="true" />
            </button>;
          })}
        </nav>
        </details>
        {calendar.loading && !calendar.data && <div className={styles.calendarStatus} role="status">{t("robin.common.loading")}</div>}
        {retry(calendar.error, calendar.refresh)}
        {calendar.data?.google?.error && <p role="alert" className={styles.warning}>{t("daily.incomplete")}</p>}
        {calendar.data?.google?.connected === false && <p className={styles.meta}>{t("daily.localOnly")}</p>}
        {allDay.length > 0 && <div className={styles.allDayEvents} data-daily-allday>
          <span>{t("robin.calendar.allDay")}</span>
          <ul>{allDay.map(event => <li key={event.id}><Link href={href(eventRecordHref(event))} prefetch={false} scroll={false}><span>{event.title}</span><Chevron /></Link></li>)}</ul>
        </div>}
        {first && <Link data-daily-featured href={href(eventRecordHref(first))} prefetch={false} scroll={false} className={styles.leadEvent}>
          <span className={styles.leadDate}><span>{phase ? t(`daily.event.${phase}`) : eventDate(first)}{phase && first.endDate && first.endDate > first.date && ` · ${eventDate(first)}`}</span><Chevron /></span>
          <span className={styles.leadTime}>{first.start || t("robin.calendar.allDay")}{first.end && (!first.endDate || first.endDate === first.date) && <span>– {first.end}</span>}</span>
          <strong className={styles.leadTitle}>{first.title}</strong>
          {first.location && <span className={styles.location}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2" /></svg>{first.location}</span>}
        </Link>}
        {!first && others.length > 0 && <p className={styles.calendarStatus}>{t("daily.finishedSchedule")}</p>}
        {others.length > 0 && <details className={styles.otherEvents}>
          <summary className="ui-action">{t("daily.otherEvents", { count: String(others.length) })}<Chevron /></summary>
        <ul className={styles.agenda}>{others.slice(0, 3).map(event => <li key={event.id}>
          <Link href={href(eventRecordHref(event))} prefetch={false} scroll={false} className={styles.eventRow}>
            <span className={styles.when}><strong>{event.start || t("robin.calendar.allDay")}</strong><span>{eventDate(event)}</span></span>
            <span className={styles.entryCopy}><strong>{event.title}</strong>{event.location && <span>{event.location}</span>}</span><Chevron />
          </Link>
        </li>)}</ul>
        {others.length > 3 && <Link className={styles.moreEvents} prefetch={false} scroll={false} href={href(`/dashboard?view=calendar&calendar=agenda&date=${selectedDate}`)}>{t("robin.calendar.more", { count: String(others.length - 3) })}<Chevron /></Link>}
        </details>}
        {selectedDate && !calendar.loading && !calendar.error && !calendar.data?.google?.error && !first && !others.length && !allDay.length && <p className={styles.calendarStatus}>{t("daily.noSchedule")}</p>}
      </div>
    </section>
    <section ref={taskPanel} tabIndex={-1} className={styles.section} data-tone="tasks" aria-labelledby="daily-attention">
      <header className={styles.sectionHeader}><h2 id="daily-attention" className="pi-section-title">{t("daily.attention")}{tasks.data && !tasks.error && due.length > 0 && <span className={styles.count}>{due.length}</span>}</h2><Link prefetch={false} scroll={false} href={href("/dashboard?view=todos&tasks=near")}>{t("daily.allTasks")}<Chevron /></Link></header>
      <p className={styles.sectionHint}>{t("daily.deadlineScope")}</p>
      {tasks.loading && !tasks.data && <p role="status" className={styles.meta}>{t("robin.common.loading")}</p>}{retry(tasks.error, tasks.refresh)}
      <ul className={styles.tasks}>{due.slice(0, 3).map(todo => <li key={todo.id} data-overdue={todo.due! < today || undefined} aria-busy={pending.has(todo.id)}>
        <label className={styles.check}>
          <input type="checkbox" checked={false} disabled={pending.has(todo.id)} aria-label={t("daily.completeTask", { title: todo.title })} onChange={() => void complete(todo, true)} />
          <span aria-hidden="true">{pending.has(todo.id) ? "…" : ""}</span>
        </label>
        <Link className={styles.taskLink} href={href(todoRecordHref(todo.id))} prefetch={false} scroll={false}>
          <span className={styles.entryCopy}><strong>{todo.title}</strong><span className={styles.taskMeta}><span data-overdue={todo.due! < today || undefined} style={{ visibility: pending.has(todo.id) ? "hidden" : undefined }}>{t("daily.deadline", { date: dateLabel(todo.due!) })}{todo.due! < today && ` · ${t("robin.todos.overdue")}`}</span><span role="status">{pending.has(todo.id) ? t("robin.common.saving") : ""}</span></span></span><Chevron />
        </Link>
      </li>)}</ul>
      {Object.entries(actionErrors).map(([id, error]) => <div key={id} role="alert" className={styles.error}><p>{error}</p><button type="button" className="ui-action" onClick={() => void tasks.refresh()}>{t("daily.reload")}</button></div>)}
      {receipts.map(receipt => <div key={receipt.id} className={styles.receipt}><span role="status">{t("daily.completedTask", { title: receipt.title })}</span><button type="button" className="ui-action" disabled={pending.has(receipt.id)} onClick={() => void complete(receipt, false)}>{t(pending.has(receipt.id) ? "robin.common.saving" : "daily.reopenTask")}</button></div>)}
      {!tasks.loading && !tasks.error && !due.length && <p className={styles.emptyTasks}>{t("daily.noDeadlines")}</p>}
    </section>
    <AttentionPanel />
    <BriefBoard compact today={selectedDate === today ? today : ""} />
    <section className={styles.section} data-tone="links" aria-labelledby="daily-links">
      <header className={styles.sectionHeader}><h2 id="daily-links" className="pi-section-title">{t("daily.shortcuts")}</h2><Link prefetch={false} scroll={false} href={href("/dashboard?view=more#dashboard-links")}>{t("daily.linksAll")}<Chevron /></Link></header>
      {retry(links.error, links.refresh)}
      {links.loading && !links.data && <p role="status" className={styles.meta}>{t("robin.common.loading")}</p>}
      {!links.loading && !links.error && !dailyLinks.length && <p className={styles.meta}>{t("daily.noLinks")}</p>}
      <div id="daily-shortcuts" className={styles.shortcuts}>{dailyLinks.map(link => <SavedLinkLaunch key={link.id} link={link} mobile />)}</div>
      {savedDailyLinks.length > 6 && <button type="button" className={`ui-action ${styles.showLinks}`} aria-expanded={allLinks} aria-controls="daily-shortcuts" onClick={() => setAllLinks(value => !value)}>{allLinks ? t("robin.common.showLess") : t("robin.common.showMoreCount", { count: String(savedDailyLinks.length - 6) })}</button>}
    </section>
    <Link className={styles.planPrompt} prefetch={false} scroll={false} href={href("/dashboard?view=more&plan=1")}><span><strong>{t("daily.plan")}</strong><span>{t("daily.planHint")}</span></span><Chevron /></Link>
  </div>;
}
