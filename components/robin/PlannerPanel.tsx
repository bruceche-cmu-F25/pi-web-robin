"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { blockHasEnded, blockIsFuture, blockMinutes, DEFAULT_PLANNER, defaultSelection, ESTIMATE_CHOICES, validatePlannerOptions, type PlannerOptions, type PlannerSelection } from "@/extension/robin/planner";
import type { PlannerCapture, PlannerProposal, plannerBoard } from "@/extension/robin/planner-domain";
import { parseLocalDate } from "@/extension/robin/dates";
import { requestRefresh } from "./refreshBus";
import { TodoTitle } from "./TodoTitle";
import { PlannerTimeline } from "./PlannerTimeline";
import { timelineDays, timelineEntries } from "./planner-timeline";
import { mutateResponse, usePolledResource } from "./usePolledResource";
import styles from "./PlannerPanel.module.css";

type Board = ReturnType<typeof plannerBoard>;
const URL = "/api/robin/planner";
const PREFS = "robin-weekly-planner:preferences";
const NOTE = "robin-weekly-planner:note";
const hours = (minutes: number) => Number((minutes / 60).toFixed(1));
const captureId = () => crypto.randomUUID().replaceAll("-", "");

function Effort({ value, onChange }: { value: Omit<PlannerSelection, "id">; onChange: (patch: Partial<PlannerSelection>) => void }) {
  const { t } = useI18n();
  return <div className={styles.effort}>
    <div className={styles.row}><span className={styles.meta}>{t("planner.estimate")}</span>{value.estimated && <span className={styles.meta}>{t("planner.estimated")}</span>}</div>
    <div className={styles.chips} role="group" aria-label={t("planner.estimate")}>
      {ESTIMATE_CHOICES.map((minutes) => <button type="button" key={minutes} aria-pressed={value.minutes === minutes} className="ui-action" onClick={() => onChange({ minutes, estimated: false })}>{t("planner.hours", { hours: hours(minutes) })}</button>)}
      <label className={styles.custom}><span className="sr-only">{t("planner.custom")}</span><input type="number" min="5" max="720" step="5" value={value.minutes} onChange={(e) => onChange({ minutes: Number(e.target.value), estimated: false })} /><span>min</span></label>
    </div>
    <div className={styles.chips} role="group" aria-label={t("planner.split")}>
      {[false, true].map((continuous) => <button type="button" key={String(continuous)} className="ui-action" aria-pressed={value.continuous === continuous} onClick={() => onChange({ continuous })}>{t(continuous ? "planner.continuous" : "planner.split")}</button>)}
    </div>
  </div>;
}

export function PlannerPanel() {
  const { t, locale } = useI18n();
  const resource = usePolledResource<Board>(URL);
  const data = resource.data?.todos ? resource.data : null;
  const [options, setOptions] = useState<PlannerOptions>(DEFAULT_PLANNER);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState("");
  const [capture, setCapture] = useState<PlannerCapture | null>(null);
  const [requestId, setRequestId] = useState("");
  const [selected, setSelected] = useState<PlannerSelection[]>([]);
  const [listedIds, setListedIds] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [proposal, setProposal] = useState<PlannerProposal | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [allTodos, setAllTodos] = useState(false);
  const [showWeek, setShowWeek] = useState(false);
  const [tab, setTab] = useState<"setup" | "schedule">("setup");
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const schedulePane = useRef<HTMLElement>(null);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const initialized = useRef(false);
  useEffect(() => {
    try { const saved = localStorage.getItem(PREFS); if (saved) setOptions(validatePlannerOptions(JSON.parse(saved))); setNote(sessionStorage.getItem(NOTE) ?? ""); } catch { /* Optional storage, safe defaults. */ }
    setReady(true);
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(PREFS, JSON.stringify(options)); sessionStorage.setItem(NOTE, note); } catch { /* Draft remains in memory. */ }
  }, [ready, options, note]);
  useEffect(() => {
    if (!data) return;
    if (initialized.current) {
      // Polling must not overwrite effort edits, but a deleted/completed task
      // cannot leave an invisible, impossible-to-deselect item in the draft.
      setSelected((items) => {
        const active = items.filter((item) => data.todos.some((todo) => todo.id === item.id));
        return active.length === items.length ? items : active;
      });
      return;
    }
    const preferred = data.todos.filter((todo) => todo.next || todo.status === "doing" || (todo.due && todo.due >= data.today && todo.due <= data.to) || (todo.plannedOn && todo.plannedOn <= data.to) || todo.workPlan?.blocks.length);
    const initial = (preferred.length ? preferred : data.todos.slice(0, 3)).slice(0, 50);
    setSelected(initial.map(defaultSelection)); setListedIds(initial.map((todo) => todo.id));
    initialized.current = true;
  }, [data]);

  useEffect(() => {
    if (proposal) {
      if (schedulePane.current) schedulePane.current.scrollTop = 0;
      previewHeading.current?.focus({ preventScroll: true });
    }
  }, [proposal]);
  useEffect(() => {
    if (editingTask && tab === "setup") (document.getElementById(`planner-task-${editingTask}`) ?? document.getElementById(`planner-select-${editingTask}`))?.focus();
  }, [editingTask, tab]);

  async function run(kind: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(kind); setError(""); setMessage("");
    try { await action(); }
    catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { lock.current = false; setBusy(null); controller.current = null; }
  }
  function changeOptions(patch: Partial<PlannerOptions>) { setOptions((v) => ({ ...v, ...patch })); setProposal(null); }
  function changeTask(id: string, patch: Partial<PlannerSelection>) { setSelected((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item)); setProposal(null); }
  async function preview(items = selected) {
    const response = await mutateResponse(URL, "POST", { action: "preview", selected: items, options, replace });
    setProposal(await response.json()); setTab("schedule"); setMessage("");
  }
  function extract() {
    void run("extract", async () => {
      controller.current = new AbortController();
      const response = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "extract", note }), signal: controller.current.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setCapture(body.capture); setRequestId(captureId()); setProposal(null); setTab("setup");
    });
  }
  function saveCapture() {
    if (!capture) return;
    void run("capture", async () => {
      const response = await mutateResponse(URL, "POST", { action: "capture", capture, requestId });
      const { ids } = await response.json() as { ids: string[] };
      // Once capture is acknowledged, never resubmit it merely because the
      // subsequent read/preview failed. The new todos are already durable.
      setCapture(null); setNote(""); setMessage(t("planner.captureSaved")); requestRefresh();
      const next = await fetch(URL);
      const fresh = await next.json() as Board & { error?: string };
      if (!next.ok) throw new Error(fresh.error ?? "Could not refresh planner");
      resource.updateData(() => fresh);
      const items = [...selected.filter((s) => !ids.includes(s.id) && fresh.todos.some((todo) => todo.id === s.id)), ...ids.map((id, i) => ({ ...defaultSelection(fresh.todos.find((todo) => todo.id === id)!), ...capture.tasks[i], id }))];
      setSelected(items); setListedIds((current) => [...new Set([...current, ...ids])]);
      if (items.length) await preview(items);
    });
  }
  function accept() {
    if (!proposal) return;
    void run("accept", async () => {
      await mutateResponse(URL, "POST", { action: "accept", proposal });
      setProposal(null); setMessage(t("planner.accepted")); await resource.refresh(); requestRefresh();
    });
  }
  function settle(id: string, blockId: string, operation: string, revision: string) {
    void run("settle", async () => {
      await mutateResponse(URL, "POST", { action: "settle", id, blockId, operation, revision });
      setProposal(null); await resource.refresh(); requestRefresh();
    });
  }
  function finish(id: string, revision: string) {
    void run("finish", async () => {
      await mutateResponse("/api/robin/todos", "PATCH", { id, revision, done: true });
      setSelected((items) => items.filter((item) => item.id !== id)); setProposal(null); await resource.refresh(); requestRefresh();
    });
  }
  const formatDate = (date: string) => parseLocalDate(date).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  const saved = data?.todos.flatMap((todo) => (todo.workPlan?.blocks ?? []).filter((b) => b.date <= data.to && (b.date >= data.today || !b.done))
    .map((block) => ({ todo, block }))).sort((a, b) => `${a.block.date}${a.block.start}`.localeCompare(`${b.block.date}${b.block.start}`)) ?? [];
  const visibleSaved = showWeek ? saved : saved.filter(({ block }) => block.date <= data!.today);
  const title = (id: string) => data?.todos.find((todo) => todo.id === id)?.title ?? id;
  const unavailable = Boolean(!data || resource.error || data.google.error);
  const selectedIds = new Set(selected.map((item) => item.id));
  const candidates = data?.todos.filter((todo) => allTodos || selectedIds.has(todo.id) || listedIds.includes(todo.id)) ?? [];
  const timeline = data ? timelineEntries(data, proposal) : [];
  const proposedMinutes = proposal?.plan.blocks.reduce((sum, b) => sum + blockMinutes(b), 0) ?? 0;
  const eveningMinutes = proposal?.plan.blocks.filter((b) => b.evening).reduce((sum, b) => sum + blockMinutes(b), 0) ?? 0;
  const scheduledMinutes = proposal?.plan.days.reduce((sum, day) => sum + day.minutes, 0) ?? 0;
  const unplacedMinutes = proposal?.plan.remaining.reduce((sum, r) => sum + r.minutes, 0) ?? 0;
  const totalMinutes = selected.reduce((sum, item) => sum + item.minutes, 0);
  const adjustTask = (id: string) => { setAllTodos(true); setEditingTask(id); setTab("setup"); };
  const preferences = <details className={styles.preferences}>
    <summary>{t("planner.preferences")} <span className={styles.meta}>{t("planner.window", { start: options.start, end: options.end, hours: hours(options.dailyMinutes) })}</span></summary>
    <div className={styles.fields}>
      <label>{t("planner.start")}<input type="time" value={options.start} onChange={(e) => changeOptions({ start: e.target.value })} /></label>
      <label>{t("planner.end")}<input type="time" value={options.end} onChange={(e) => changeOptions({ end: e.target.value })} /></label>
      <label>{t("planner.budget")}<select value={options.dailyMinutes} onChange={(e) => changeOptions({ dailyMinutes: Number(e.target.value) })}>{[120, 180, 240, 360, 480].map((minutes) => <option key={minutes} value={minutes}>{t("planner.hours", { hours: hours(minutes) })}</option>)}</select></label>
    </div>
    <label className={styles.check}><input type="checkbox" checked={options.deadlineEvenings} onChange={(e) => changeOptions({ deadlineEvenings: e.target.checked })} />{t("planner.deadlineEvenings")}</label>
    <p className={styles.meta}>{t("planner.eveningHint")}</p>
    <label className={styles.check}><input type="checkbox" checked={options.weekends} onChange={(e) => changeOptions({ weekends: e.target.checked })} />{t("planner.weekends")}</label>
    <label className={styles.check}><input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); setProposal(null); }} />{t("planner.replace")}</label>
    <p className={styles.meta}>{t("planner.replaceHint")}</p>
    <p className={styles.meta}>{t("planner.rules")}</p>
  </details>;

  return <section id="dashboard-planner" className={`pi-card ${styles.panel}`} aria-label={t("planner.title")}>
    <header className={styles.header}><div><h2 className="pi-section-title">{t("planner.title")}</h2><p className={styles.meta}>{saved.length ? t("planner.savedSummary", { count: saved.length }) : t("planner.hint")}</p></div>
      <button type="button" className="ui-action pi-bracket" data-state="accent" onClick={() => { setTab(proposal || saved.length ? "schedule" : "setup"); dialog.current?.showModal(); closeButton.current?.focus(); }}>{t("planner.open")}</button>
    </header>
    {!saved.length && <p className={styles.intro}>{t("planner.empty")}</p>}
    {!!data?.conflicts.length && <p role="alert" className={styles.warning}>{t("planner.conflict", { count: data.conflicts.length })}</p>}
    {saved.length > 0 && <>
      <div className={styles.chips} role="group" aria-label={t("planner.week")}>{[false, true].map((week) => <button key={String(week)} className="ui-action" aria-pressed={showWeek === week} onClick={() => setShowWeek(week)}>{t(week ? "planner.week" : "planner.today")}</button>)}</div>
      {!visibleSaved.length && <p className={styles.meta}>{t("planner.noToday")}</p>}
      <ul className={styles.slots}>{visibleSaved.map(({ todo, block }) => <li key={`${todo.id}:${block.id}`} data-done={block.done}>
        <div className={styles.slotTime}><time dateTime={block.date}>{formatDate(block.date)}</time><span>{block.start}–{block.end}</span></div>
        <div className={styles.slotBody}><strong><TodoTitle todo={todo} t={t} /></strong><small>{t(block.done ? "planner.doneBlock" : blockHasEnded(block, data!.today, data!.minuteOfDay) ? "planner.missed" : "planner.confirmed")}{block.evening && ` · ${t("planner.eveningBlock")}`}</small>
          <div className={styles.row}>
            <button className="ui-action" disabled={Boolean(busy) || (!block.done && blockIsFuture(block, data!.today, data!.minuteOfDay))} onClick={() => settle(todo.id, block.id, block.done ? "undo" : "done", todo.revision)}>{t(block.done ? "planner.undo" : "planner.log")}</button>
            <details className={styles.slotActions}><summary>{t("planner.moreActions")}</summary>
              {!block.done && <button className="ui-action" disabled={Boolean(busy)} onClick={() => settle(todo.id, block.id, "release", todo.revision)}>{t("planner.release")}</button>}
              <button className="ui-action" disabled={Boolean(busy)} onClick={() => finish(todo.id, todo.revision)}>{t("planner.finish")}</button>
            </details>
          </div>
        </div>
      </li>)}</ul>
      <p className={styles.meta}>{t("planner.slotHint")}</p>
    </>}
    {(error || resource.error) && <p role="alert" className={styles.error}>{error || resource.error}</p>}
    <p role="status" className={styles.status}>{message}</p>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="weekly-planner-title" onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <header className={styles.header}><div><h2 id="weekly-planner-title" className="pi-section-title">{t("planner.title")}</h2>{data && <p className={styles.meta}>{formatDate(data.today)} – {formatDate(data.to)} · {data.timezone}</p>}</div><button ref={closeButton} className="ui-action" disabled={Boolean(busy)} aria-label={t("planner.close")} onClick={() => dialog.current?.close()}><span aria-hidden>×</span> <span className={styles.closeLabel}>{t("planner.closeShort")}</span></button></header>
      <nav className={styles.tabs} aria-label={t("planner.title")}>
        {(["setup", "schedule"] as const).map((value) => <button type="button" key={value} aria-pressed={tab === value} aria-controls={`planner-${value}`} onClick={() => setTab(value)}>{t(`planner.${value}`)}{value === "setup" ? ` · ${selected.length}` : ""}</button>)}
      </nav>
      <div className={`${styles.body} ${styles.workspace}`} data-tab={tab}>
        <section id="planner-setup" className={styles.setupPane} aria-label={t("planner.setup")}>
        {!data && <p role="status">{t("robin.common.loading")}</p>}
        <fieldset disabled={Boolean(busy)}>
          <label className={styles.note}><span>{t("planner.note")} <small className={styles.meta}>· {t("planner.optional")}</small></span><textarea rows={2} maxLength={5000} placeholder={t("planner.placeholder")} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <button className="ui-action pi-bracket" disabled={!note.trim() || !data} onClick={extract}>{t(busy === "extract" ? "planner.extracting" : "planner.extract")}</button>
          {capture && <section className={styles.capture} aria-label={t("planner.captureHint")}>
            <p>{t("planner.captureHint")}</p>
            {capture.questions.map((question, i) => <p key={i} className={styles.warning}>{question}</p>)}
            {capture.tasks.map((task, i) => <div key={i} className={styles.task}>
              <label>{t("planner.taskTitle")}<input value={task.title} disabled={Boolean(task.id)} onChange={(e) => setCapture({ ...capture, tasks: capture.tasks.map((v, j) => i === j ? { ...v, title: e.target.value } : v) })} /></label>
              {task.id ? <p className={styles.meta}>{t("planner.existing")}</p> : <label>{t("planner.due")}<input type="date" value={task.due ?? ""} onChange={(e) => setCapture({ ...capture, tasks: capture.tasks.map((v, j) => i === j ? { ...v, due: e.target.value } : v) })} /></label>}
              <Effort value={task} onChange={(patch) => setCapture({ ...capture, tasks: capture.tasks.map((v, j) => i === j ? { ...v, ...patch } : v) })} />
              <button className="ui-action" onClick={() => setCapture({ ...capture, tasks: capture.tasks.filter((_, j) => j !== i) })}>{t("planner.remove")}</button>
            </div>)}
            {capture.events.length > 0 && <h3>{t("planner.events")}</h3>}
            {capture.events.map((event, i) => {
              const patch = (value: Partial<typeof event>) => setCapture({ ...capture, events: capture.events.map((v, j) => i === j ? { ...v, ...value } : v) });
              return <div key={i} className={styles.task}><label>{t("planner.eventTitle")}<input value={event.title} onChange={(e) => patch({ title: e.target.value })} /></label><div className={styles.fields}><label>{t("planner.date")}<input type="date" value={event.date} onChange={(e) => patch({ date: e.target.value })} /></label><label>{t("planner.start")}<input type="time" value={event.start ?? ""} onChange={(e) => patch({ start: e.target.value })} /></label><label>{t("planner.end")}<input type="time" value={event.end ?? ""} onChange={(e) => patch({ end: e.target.value })} /></label></div>
                <details open={Boolean(event.endDate)}><summary>{t("robin.calendar.endDateHint")}</summary><label>{t("robin.calendar.endDateHint")}<input type="date" min={event.date} value={event.endDate ?? ""} onChange={(e) => patch({ endDate: e.target.value })} /></label></details>
                {(!event.start || !event.end) && <p className={styles.meta}>{t(event.start ? "planner.unknownEnd" : "planner.unknownTime")}</p>}
                <button className="ui-action" onClick={() => setCapture({ ...capture, events: capture.events.filter((_, j) => j !== i) })}>{t("planner.remove")}</button>
              </div>;
            })}
            <button className="ui-action" onClick={() => setCapture(null)}>{t("planner.discard")}</button>
          </section>}
          <div className={styles.sectionHead}><h3>{t("planner.tasks")}</h3><span className={styles.meta}>{t("planner.selection", { count: selected.length })}</span></div>
          <div className={styles.tasks}>{candidates.map((todo) => {
            const item = selected.find((v) => v.id === todo.id);
            return <div key={todo.id} className={styles.task}>
              <div className={styles.taskRow}>
                <label className={styles.check}><input id={`planner-select-${todo.id}`} type="checkbox" checked={Boolean(item)} onChange={(e) => { setSelected((items) => e.target.checked ? [...items, defaultSelection(todo)] : items.filter((v) => v.id !== todo.id)); setProposal(null); }} /><span><strong>{todo.title}</strong><small>{todo.due ? `${t("planner.due")} ${todo.due}` : t("planner.noDue")}{todo.loggedMinutes ? ` · ${t("planner.logged", { minutes: todo.loggedMinutes })}` : ""}</small></span></label>
                {item && <button id={`planner-task-${todo.id}`} type="button" className={styles.effortTrigger} aria-label={t("planner.editEffort", { title: todo.title })} aria-expanded={editingTask === todo.id} onClick={() => setEditingTask(editingTask === todo.id ? null : todo.id)}>{item.estimated ? "≈ " : ""}{t("planner.hours", { hours: hours(item.minutes) })}<span aria-hidden>⌄</span></button>}
              </div>
              {item && editingTask === todo.id && <Effort value={item} onChange={(patch) => changeTask(todo.id, patch)} />}
            </div>;
          })}</div>
          {!data?.todos.length && <p>{t("planner.noTasks")}</p>}
          <button className="ui-action" aria-expanded={allTodos} onClick={() => setAllTodos((v) => !v)}>{t("planner.more")} ({data?.todos.length ?? 0})</button>
          {preferences}
        </fieldset>
        </section>
        <section ref={schedulePane} id="planner-schedule" className={styles.schedulePane} aria-labelledby="weekly-preview-title">
          <div className={styles.previewHead}><div><h3 ref={previewHeading} id="weekly-preview-title" tabIndex={-1}>{t(proposal ? "planner.previewTitle" : "planner.schedule")}</h3><p className={styles.meta}>{t(proposal ? "planner.previewHint" : "planner.readyHint")}</p></div>
            {proposal && <button type="button" className="ui-action" disabled={Boolean(busy)} onClick={() => setProposal(null)}>{t("planner.discard")}</button>}
          </div>
          {proposal && <div className={styles.metrics}>
            <div><strong>{hours(scheduledMinutes)}<small>h</small></strong><span>{t("planner.arrangedHours")}</span></div>
            <div data-warning={unplacedMinutes > 0}><strong>{hours(unplacedMinutes)}<small>h</small></strong><span>{t("planner.unplacedHours")}</span></div>
            <div><strong>{selected.length}</strong><span>{t("planner.tasks")}</span></div>
          </div>}
          {eveningMinutes > 0 && <p className={styles.warning}>{t("planner.eveningSummary", { hours: hours(eveningMinutes) })}</p>}
          {proposal && proposal.plan.tight.length > 0 && <p className={styles.warning}>{t("planner.tight")}</p>}
          {proposal && proposal.plan.remaining.length > 0 && <details className={styles.shortfall}><summary>{t("planner.remaining")} · {t("planner.hours", { hours: hours(unplacedMinutes) })}</summary>{proposal.plan.remaining.map((item) => <p key={item.id}><strong>{title(item.id)} · {t("planner.hours", { hours: hours(item.minutes) })}</strong><small>{t(item.reason === "continuous" ? "planner.continuousReason" : `planner.${item.reason}`)}</small></p>)}</details>}
          {proposal && !proposal.plan.blocks.length && <p className={styles.meta}>{t(proposal.plan.remaining.length ? "planner.noSlots" : "planner.covered")}</p>}
          {data && <PlannerTimeline entries={timeline} days={timelineDays(data.today, data.to)} today={data.today} options={proposal?.options ?? options} onEditTask={adjustTask} />}
        </section>
      </div>
      <footer className={styles.footer}>
        {data && !data.google.connected && <p className={styles.meta}>{t("planner.localOnly")}</p>}
        {data?.google.error && <p role="alert" className={styles.error}>{t("planner.incomplete")} {data.google.error}</p>}
        {(error || resource.error) && <div role="alert" className={styles.error}><span>{error || resource.error}</span><button className="ui-action" disabled={Boolean(busy)} onClick={() => void resource.refresh()}>{t("planner.retry")}</button></div>}
        <p role="status" className={styles.status}>{busy ? t(busy === "extract" ? "planner.extracting" : "planner.working") : message}</p>
        <div className={styles.footerActions}>
          <p className={styles.meta}>{proposal ? t("planner.summary", { hours: hours(proposedMinutes), remaining: hours(unplacedMinutes) }) : `${t("planner.selection", { count: selected.length })} · ${t("planner.hours", { hours: hours(totalMinutes) })}`}</p>
          {busy === "extract" && <button type="button" className="ui-action" onClick={() => controller.current?.abort()}>{t("planner.cancel")}</button>}
          {tab === "schedule" && <button type="button" className="ui-action" onClick={() => setTab("setup")}>{t("planner.backSetup")}</button>}
          {proposal && proposedMinutes > 0 && <button type="button" className="ui-action" disabled={Boolean(busy) || unavailable || !selected.length} onClick={() => void run("preview", () => preview())}>{t("planner.preview")}</button>}
          <button type="button" className="ui-action pi-bracket" data-state="accent" disabled={Boolean(busy) || (capture ? !capture.tasks.length && !capture.events.length : unavailable || !selected.length)}
            onClick={() => capture ? saveCapture() : proposal && proposedMinutes > 0 ? accept() : void run("preview", () => preview())}>{t(capture ? "planner.capture" : proposal && proposedMinutes > 0 ? "planner.accept" : "planner.preview")}</button>
        </div>
      </footer>
    </dialog>
  </section>;
}
