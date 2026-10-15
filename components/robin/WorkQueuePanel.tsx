"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { localDate } from "@/extension/robin/dates";
import type { DashboardEvent } from "@/extension/robin/events";
import type { EditableTodo } from "@/extension/robin/todo-domain";
import { formatFocusTime } from "@/lib/focus-timer";
import { TodoTitle } from "./TodoTitle";
import { requestRefresh } from "./refreshBus";
import { mutateResponse, usePolledResource } from "./usePolledResource";
import { WORK_QUEUE_KEY, parseWorkQueue, queueCandidates, queueWindow, recommendTask, validWorkHours, type WorkQueueState } from "./work-queue";
import styles from "./WorkQueuePanel.module.css";

type TodosResponse = { todos: EditableTodo[]; today: string };
type EventsResponse = { events: DashboardEvent[]; google?: { connected: boolean; error?: string } };

export function WorkQueuePanel() {
  const { t } = useI18n();
  const [now, setNow] = useState<Date | null>(null);
  const [state, setState] = useState<WorkQueueState | null>(null);
  const stateRef = useRef(state);
  const [storageError, setStorageError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const tasks = usePolledResource<TodosResponse>("/api/robin/todos");
  const day = now ? localDate(now) : "";
  const calendar = usePolledResource<EventsResponse>(day ? `/api/robin/events?from=${day}&to=${day}` : "/api/robin/events");

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);
  useEffect(() => {
    if (!day) return;
    const load = () => {
      let raw: string | null = null;
      try { raw = localStorage.getItem(WORK_QUEUE_KEY); setStorageError(false); }
      catch { setStorageError(true); }
      const next = parseWorkQueue(raw, day);
      stateRef.current = next;
      setState(next);
    };
    load();
    const sync = (event: StorageEvent) => { if (event.key === WORK_QUEUE_KEY || event.key === null) load(); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [day]);

  function change(update: (current: WorkQueueState) => WorkQueueState) {
    const current = stateRef.current;
    if (!current || current.day !== localDate()) return;
    const next = update(current);
    stateRef.current = next;
    setState(next);
    try { localStorage.setItem(WORK_QUEUE_KEY, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  }

  const ready = !!state && state.day === day && !!tasks.data && !!now;
  const candidates = queueCandidates(tasks.data?.todos ?? [], day);
  const proposedIds = state?.confirmed ? state.ids : state?.ids.length ? state.ids : candidates.slice(0, 3).map((todo) => todo.id);
  const ids = proposedIds.filter((id) => tasks.data?.todos.some((todo) => todo.id === id && !todo.archivedAt));
  const queue = ids.map((id) => tasks.data?.todos.find((todo) => todo.id === id)).filter((todo): todo is EditableTodo => !!todo && !todo.archivedAt);
  const open = queue.filter((todo) => !todo.done);
  const completed = queue.filter((todo) => todo.done).length;
  const availability = now && state ? queueWindow(calendar.data?.events ?? [], now, state.start, state.end,
    !!calendar.data && !calendar.loading && !calendar.error && !calendar.data.google?.error) : { kind: "uncertain" as const, minutes: 0 };
  const active = state?.active ? open.find((todo) => todo.id === state.active?.id) : undefined;
  const resting = !!state && !!now && state.restUntil > now.getTime();
  const recommendation = state && now ? recommendTask(open, state, now.getTime(), availability) : null;
  const featured = active ?? recommendation?.todo;
  const running = !!active && !!state?.active && !!now && state.active.endsAt > now.getTime();

  // Only confirmed writes update the shared task list. The revision also protects
  // against completing a task that was edited/deleted in another panel or tab.
  async function patch(todo: EditableTodo, fields: { done?: boolean; status?: "doing"; estimateMinutes?: number | null }, after?: () => void) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setActionError(null);
    try {
      if (!todo.revision) throw new Error(t("robin.calendar.reloadTodo"));
      const response = await mutateResponse("/api/robin/todos", "PATCH", { id: todo.id, revision: todo.revision, ...fields });
      const { todo: saved } = await response.json() as { todo: EditableTodo };
      tasks.updateData((current) => current && { ...current, todos: current.todos.map((item) => item.id === saved.id ? saved : item) });
      after?.();
      requestRefresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
      void tasks.refresh();
    } finally { saving.current = false; setBusy(false); }
  }
  function start(todo: EditableTodo) {
    void patch(todo, { status: "doing" }, () => change((current) => ({
      ...current, restUntil: 0, active: { id: todo.id, endsAt: Date.now() + 5 * 60_000 },
    })));
  }
  function note(id: string, step: string) {
    change((current) => ({ ...current, notes: { ...current.notes, [id]: { step, skips: current.notes[id]?.skips ?? 0, until: current.notes[id]?.until ?? 0 } } }));
  }
  function defer(todo: EditableTodo) {
    change((current) => {
      const previous = current.notes[todo.id] ?? { step: "", skips: 0, until: 0 };
      return { ...current, active: null, notes: { ...current.notes, [todo.id]: { ...previous, skips: previous.skips + 1, until: Date.now() + 30 * 60_000 } } };
    });
    if ((stateRef.current?.notes[todo.id]?.skips ?? 0) >= 2) setEditing(true);
  }
  function select(id: string, checked: boolean) {
    change((current) => ({ ...current, confirmed: true,
      ids: checked ? [...ids.filter((item) => item !== id), id].slice(0, 3) : ids.filter((item) => item !== id),
      active: !checked && current.active?.id === id ? null : current.active,
    }));
  }
  const button = `ui-action ${styles.button}`;
  const primary = `${button} pi-bracket ${styles.primary}`;
  const remaining = queue.filter((todo) => todo.id !== featured?.id);
  const estimate = (todo: EditableTodo) => todo.estimateMinutes
    ? t(todo.estimateSource === "agent" ? "robin.queue.agentEstimate" : "robin.queue.minutes", { count: String(todo.estimateMinutes) })
    : t("robin.queue.noEstimate");

  return <section id="dashboard-work-queue" className={`pi-card ${styles.panel}`} aria-labelledby="work-queue-title" tabIndex={-1}>
    <header className={styles.header}>
      <h2 id="work-queue-title" className="pi-section-title">{t("robin.queue.title")}</h2>
      <button type="button" className={button} disabled={!ready || busy} aria-expanded={editing} aria-controls="work-queue-editor" onClick={() => setEditing(!editing)}>
        {t(editing ? "robin.queue.closeEditor" : "robin.queue.edit")}
      </button>
    </header>
    {!ready ? <p role="status">{t("robin.common.loading")}</p> : <>
      <div className={styles.progress}>
        <span className={styles.tracks} aria-hidden="true">{queue.map((todo) => <span key={todo.id} data-done={todo.done || undefined} />)}</span>
        <span className={styles.meta}>{t("robin.queue.progress", { count: String(completed), total: String(queue.length) })}</span>
      </div>
      <p className={styles.availability} data-available={!resting && availability.kind === "free" || undefined} role="status">{resting ? t("robin.queue.resting") : t(`robin.queue.window.${availability.kind}`, { count: String(availability.minutes) })}</p>
      {!state.confirmed && <div className={styles.intro}>
        <p>{t("robin.queue.intro")}</p>
        <button type="button" className={primary} data-state="accent" disabled={!queue.length || busy || !!tasks.error}
          onClick={() => change((current) => ({ ...current, ids, confirmed: true }))}>{t("robin.queue.confirm")}</button>
      </div>}
      {state.confirmed && featured && <div className={styles.featured}>
        <div className={styles.featuredHeading}>
          <p className="pi-eyebrow">{t(active ? "robin.queue.inProgress" : "robin.queue.now")}</p>
          <span className={styles.meta}>{estimate(featured)}</span>
        </div>
        <h3><TodoTitle todo={featured} t={t} /></h3>
        {recommendation?.kickoff && !active && <p className={styles.meta}>{t("robin.queue.kickoff")}</p>}
        <label className={styles.field}>
          <span>{t("robin.queue.nextStep")}</span>
          <input maxLength={500} value={state.notes[featured.id]?.step ?? ""} placeholder={t("robin.queue.stepPlaceholder")}
            onChange={(event) => note(featured.id, event.target.value)} />
        </label>
        {active && <p className={styles.timer} role={running ? "timer" : "status"} aria-live={running ? "off" : "polite"}>
          {running ? formatFocusTime(Math.max(0, state.active!.endsAt - now.getTime())) : t("robin.queue.fiveDone")}
        </p>}
        <div className={styles.featuredActions} data-running={running || undefined}>
          {!active && <button type="button" className={primary} data-state="accent" disabled={busy || !!tasks.error} onClick={() => start(featured)}>{t("robin.queue.start")}</button>}
          {active && !running && <button type="button" className={primary} data-state="accent" onClick={() => change((current) => ({ ...current, active: { id: featured.id, endsAt: Date.now() + 5 * 60_000 } }))}>{t("robin.queue.continue")}</button>}
          <button type="button" className={`${button} ${styles.complete}`} disabled={busy || !!tasks.error} onClick={() => void patch(featured, { done: true }, () => change((current) => ({ ...current, active: null })))}>{t("robin.queue.complete")}</button>
          <button type="button" className={button} disabled={busy} onClick={() => defer(featured)}>{t("robin.queue.defer")}</button>
          <button type="button" className={button} disabled={busy} onClick={() => change((current) => ({ ...current, active: null, restUntil: Date.now() + 30 * 60_000 }))}>{t("robin.queue.rest")}</button>
        </div>
      </div>}
      {state.confirmed && !featured && <div className={styles.intro}>
        <p>{t(resting ? "robin.queue.restHint" : open.length ? "robin.queue.manualHint" : queue.length ? "robin.queue.finished" : "robin.queue.empty")}</p>
        {resting && <button type="button" className={button} onClick={() => change((current) => ({ ...current, restUntil: 0 }))}>{t("robin.queue.resume")}</button>}
      </div>}
      {remaining.length > 0 && <p className={`pi-eyebrow ${styles.listHeading}`}>{t(featured ? "robin.queue.upNext" : "robin.queue.yourQueue")}</p>}
      <ol className={styles.list} aria-label={t("robin.queue.title")}>
        {remaining.map((todo) => <li key={todo.id} data-done={todo.done || undefined}>
          <span className={styles.number}>{todo.done ? "✓" : String(ids.indexOf(todo.id) + 1).padStart(2, "0")}</span>
          <div className={styles.task}>
            <TodoTitle todo={todo} t={t} />
            <p className={styles.meta}>{estimate(todo)}{todo.due ? ` · ${t("robin.todos.deadline")} ${todo.due}` : ""}
              {(state.notes[todo.id]?.until ?? 0) > now.getTime() && ` · ${t("robin.queue.deferred")}`}</p>
            {(state.notes[todo.id]?.skips ?? 0) >= 2 && !todo.done && <p className={styles.nudge}>{t("robin.queue.smaller")}</p>}
          </div>
          {state.confirmed && !todo.done && !active && !resting && featured?.id !== todo.id && <button type="button" className={`${button} ${styles.rowStart}`} disabled={busy || !!tasks.error} aria-label={t("robin.queue.startTask", { title: todo.title })} title={t("robin.queue.startTask", { title: todo.title })} onClick={() => start(todo)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m9 5 10 7-10 7Z" /></svg></button>}
        </li>)}
      </ol>
      {!queue.length && !state.confirmed && <p>{t("robin.queue.empty")}</p>}
      {editing && <div id="work-queue-editor" className={styles.editor}>
        <p className={styles.meta}>{t("robin.queue.selectionHint")}</p>
        {queue.map((todo, index) => <div key={todo.id} className={styles.editTask}>
          <div className={styles.actions}><span className={styles.task}>{todo.title}</span>
            <button type="button" className={button} disabled={index === 0 || busy} aria-label={t("robin.queue.moveUp", { title: todo.title })} onClick={() => change((current) => {
              const next = [...ids]; [next[index - 1], next[index]] = [next[index], next[index - 1]];
              return { ...current, confirmed: true, ids: next };
            })}>↑</button>
            <button type="button" className={button} disabled={busy} aria-label={t("robin.queue.removeTask", { title: todo.title })} onClick={() => select(todo.id, false)}>{t("robin.queue.remove")}</button>
          </div>
          <label className={styles.field}><span>{t("robin.queue.nextStep")}</span><input maxLength={500} value={state.notes[todo.id]?.step ?? ""} onChange={(event) => note(todo.id, event.target.value)} placeholder={t("robin.queue.stepPlaceholder")} /></label>
          <EstimateEditor key={`${todo.id}:${todo.estimateMinutes}:${todo.estimateSource}`} value={todo.estimateMinutes} busy={busy} label={t("robin.queue.estimateLabel")} save={t("robin.common.save")} onSave={(value) => void patch(todo, { estimateMinutes: value })} />
        </div>)}
        <label className={styles.field}><span>{t("robin.queue.add")}</span>
          <select value="" disabled={ids.length >= 3 || busy} onChange={(event) => { if (event.target.value) select(event.target.value, true); }}>
            <option value="">{t("robin.queue.choose")}</option>
            {candidates.filter((todo) => !ids.includes(todo.id)).map((todo) => <option key={todo.id} value={todo.id}>{todo.title}</option>)}
          </select>
        </label>
        <HoursEditor key={`${state.start}:${state.end}`} start={state.start} end={state.end} onSave={(start, end) => change((current) => ({ ...current, start, end }))} />
      </div>}
    </>}
    {(tasks.error || calendar.error || calendar.data?.google?.error || actionError) && <p className={styles.error} role="alert">{actionError ?? tasks.error ?? t("robin.queue.calendarError")}</p>}
    {storageError && <p className={styles.error} role="alert">{t("robin.queue.storageError")}</p>}
    <details className={styles.info}>
      <summary>{t("robin.queue.about")}</summary>
      <p>{t("robin.queue.localHint")}</p>
      <p>{t("robin.queue.ordered")}</p>
      {calendar.data?.google?.connected === false && <p>{t("robin.queue.localCalendar")}</p>}
    </details>
  </section>;
}

function EstimateEditor({ value, busy, label, save, onSave }: { value?: number; busy: boolean; label: string; save: string; onSave: (value: number | null) => void }) {
  const [draft, setDraft] = useState(value?.toString() ?? "");
  return <form className={styles.actions} onSubmit={(event) => { event.preventDefault(); onSave(draft === "" ? null : Number(draft)); }}>
    <label className={styles.field}><span>{label}</span><input type="number" min={5} max={720} step={1} value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
    <button type="submit" className={`ui-action pi-bracket ${styles.button}`} disabled={busy}>{save}</button>
  </form>;
}
function HoursEditor({ start, end, onSave }: { start: string; end: string; onSave: (start: string, end: string) => void }) {
  const { t } = useI18n();
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  return <form className={styles.actions} onSubmit={(event) => { event.preventDefault(); if (validWorkHours(from, to)) onSave(from, to); }}>
    <label className={styles.field}><span>{t("robin.queue.workStart")}</span><input type="time" required value={from} onChange={(event) => setFrom(event.target.value)} /></label>
    <label className={styles.field}><span>{t("robin.queue.workEnd")}</span><input type="time" required value={to} onChange={(event) => setTo(event.target.value)} /></label>
    <button type="submit" className={`ui-action pi-bracket ${styles.button}`} disabled={!validWorkHours(from, to)}>{t("robin.common.save")}</button>
    <p className={styles.meta}>{t("robin.queue.hoursHint")}</p>
  </form>;
}
