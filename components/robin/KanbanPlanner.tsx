"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Todo } from "@/extension/robin/todo-domain";
import { DEFAULT_PLANNING, validatePlanningOptions, type DayCapacity, type PlanningOptions, type PlanSuggestion } from "@/extension/robin/kanban";
import { mutate, usePolledResource } from "./usePolledResource";
import { requestRefresh } from "./refreshBus";
import styles from "./KanbanBoard.module.css";

interface CapacityResponse { today: string; capacity: DayCapacity[]; google: { connected: boolean; error?: string }; timezone: string }
interface Proposal { revision: string; suggestion: PlanSuggestion }
const PREF_KEY = "robin-kanban-planning";

export function KanbanPlanner({ todos, disabled }: { todos: Todo[]; disabled: boolean }) {
  const { t, locale } = useI18n();
  const [options, setOptions] = useState<PlanningOptions>(DEFAULT_PLANNING);
  const [hydrated, setHydrated] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const resource = usePolledResource<CapacityResponse>(`/api/robin/kanban?options=${encodeURIComponent(JSON.stringify(options))}`);

  useEffect(() => {
    try { const saved = localStorage.getItem(PREF_KEY); if (saved) setOptions(validatePlanningOptions(JSON.parse(saved))); } catch { /* Invalid preferences use safe defaults. */ }
    setHydrated(true);
    return () => controllerRef.current?.abort();
  }, []);
  useEffect(() => {
    if (hydrated) { try { localStorage.setItem(PREF_KEY, JSON.stringify(options)); } catch { /* Private mode. */ } }
  }, [hydrated, options]);

  function change(patch: Partial<PlanningOptions>) {
    setOptions((current) => ({ ...current, ...patch }));
    setProposal(null);
    setError(null);
    setMessage("");
  }

  async function generate() {
    if (busyRef.current) return;
    busyRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setWorking(true);
    setError(null);
    setMessage("");
    setProposal(null);
    try {
      const response = await fetch("/api/robin/kanban", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", options, locale }), signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      if (controller.signal.aborted) return;
      setProposal(body as Proposal);
      setSelected((body as Proposal).suggestion.items.map((item) => item.id));
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      busyRef.current = false;
      setWorking(false);
      controllerRef.current = null;
    }
  }

  async function accept() {
    if (!proposal || busyRef.current) return;
    busyRef.current = true;
    setApplying(true);
    setError(null);
    try {
      await mutate("/api/robin/kanban", "POST", {
        action: "apply", options, revision: proposal.revision,
        suggestion: { items: proposal.suggestion.items.filter((item) => selected.includes(item.id)) },
      });
      setProposal(null);
      setMessage(t("robin.kanban.planAccepted"));
      requestRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      busyRef.current = false;
      setApplying(false);
    }
  }

  const data = resource.data;
  return (
    <>
      <button type="button" className={`ui-action ${styles.plannerTrigger}`} aria-haspopup="dialog" disabled={disabled}
        onClick={() => dialogRef.current?.showModal()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 5h16v16H4zM8 2v6M16 2v6M4 11h16M8 15h3" /></svg>
        <span>{t(working ? "robin.kanban.generating" : proposal ? "robin.kanban.previewShort" : "robin.kanban.planWork")}</span>
        {data && !working && <span className={styles.capacitySummary} title={data.google.error || resource.error ? t("robin.kanban.incompleteCalendar") : undefined}>
          {data.google.error || resource.error || data.capacity.some((day) => day.overbooked) ? "!"
            : `${data.capacity.reduce((sum, day) => sum + day.remainingMinutes, 0)} ${t("robin.kanban.minutes")}`}
        </span>}
      </button>
      <dialog ref={dialogRef} className={`${styles.dialog} ${styles.planner}`} aria-labelledby="kanban-planner-title"
        onCancel={(event) => { if (applying) event.preventDefault(); }}>
        <header className={styles.editorHeader}>
          <div><p className="pi-eyebrow">{t("robin.kanban.planWork")}</p><h2 id="kanban-planner-title">{t("robin.kanban.plannerTitle")}</h2></div>
          <button type="button" className="ui-action" disabled={applying} aria-label={t("robin.kanban.closePlanner")} onClick={() => dialogRef.current?.close()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className={styles.drawerBody}>
      <p className={styles.subtitle}>{t("robin.kanban.plannerHint")}</p>
      <details className={styles.preferences}>
        <summary>{t("robin.kanban.preferences")}<span>{options.start}–{options.end} · {options.dailyMinutes} {t("robin.kanban.minutes")}</span></summary>
      <fieldset disabled={working || applying || disabled} className={styles.plannerControls}>
        <label>{t("robin.kanban.windowStart")}<input type="time" value={options.start} onChange={(event) => change({ start: event.target.value })} /></label>
        <label>{t("robin.kanban.windowEnd")}<input type="time" value={options.end} onChange={(event) => change({ end: event.target.value })} /></label>
        <label>{t("robin.kanban.budget")}<input type="number" min="15" max="720" step="15" value={options.dailyMinutes} onChange={(event) => change({ dailyMinutes: Number(event.target.value) })} /></label>
        <label className={styles.checkLabel}><input type="checkbox" checked={options.allDayBusy} onChange={(event) => change({ allDayBusy: event.target.checked })} />{t("robin.kanban.allDayBusy")}</label>
      </fieldset>
      <p className={styles.hint}>{t("robin.kanban.capacityAssumptions")}{data ? ` · ${data.timezone}` : ""}</p>
      </details>
      <fieldset className={styles.horizon} disabled={working || applying || disabled} aria-label={t("robin.kanban.horizon")}>
        {(["today", "week"] as const).map((value) => <button type="button" key={value} className="ui-action" aria-pressed={options.horizon === value}
          onClick={() => change({ horizon: value })}>{t(`robin.kanban.view.${value}`)}</button>)}
      </fieldset>
      {data && !data.google.connected && <p className={styles.notice}>{t("robin.kanban.localCalendarOnly")}</p>}
      {data?.google.error && <p role="alert" className={styles.error}>{t("robin.kanban.incompleteCalendar")} {data.google.error}</p>}
      {resource.error && <p role="alert" className={styles.error}>{resource.error}</p>}
      {resource.loading && <p role="status">{t("robin.common.loading")}</p>}
      <p className={styles.hint}>{t("robin.kanban.planningScope")}</p>
      {data && <div className={styles.capacityGrid}>
        {data.capacity.map((day) => <div key={day.date} className={styles.capacityDay}>
          <time dateTime={day.date}>{new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day.date}T12:00:00`))}</time>
          <span>{t("robin.kanban.capacityMinutes", { count: day.remainingMinutes })}</span>
          <span>{t("robin.kanban.capacityTasks", { count: day.plannedCount })}</span>
          <small>{t("robin.kanban.freeMinutes", { count: day.freeMinutes })}</small>
          {day.overbooked && <strong className={styles.overdue}>{t("robin.kanban.overbooked")}</strong>}
          {day.allDayCount > 0 && !options.allDayBusy && <small>{t("robin.kanban.allDayNotice", { count: day.allDayCount })}</small>}
        </div>)}
      </div>}
      <div className={styles.planActions}>
        <button type="button" className="ui-action pi-bracket" data-state="accent" disabled={working || applying || disabled || !data || Boolean(resource.error || data.google.error)} onClick={() => void generate()}>
          {t(working ? "robin.kanban.generating" : "robin.kanban.generate")}
        </button>
        {working && <button type="button" className="ui-action pi-bracket" onClick={() => controllerRef.current?.abort()}>{t("robin.common.cancel")}</button>}
      </div>
      {proposal && <section className={styles.proposal} aria-label={t("robin.kanban.preview")}>
        <h3>{t("robin.kanban.preview")}</h3>
        <p className={styles.hint}>{t("robin.kanban.previewHint")}</p>
        {proposal.suggestion.items.length === 0 && <p>{t("robin.kanban.noPlan")}</p>}
        {proposal.suggestion.items.map((item) => {
          const todo = todos.find((entry) => entry.id === item.id);
          return <label key={item.id} className={styles.proposalRow}>
            <input type="checkbox" disabled={applying} checked={selected.includes(item.id)}
              onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
            <span><strong>{todo?.title ?? item.id}</strong>
              <small>{item.plannedOn} · {item.estimateMinutes} {t("robin.kanban.minutes")} · {t(!todo?.estimateMinutes || todo.estimateSource === "agent" ? "robin.kanban.agentEstimate" : "robin.kanban.yourEstimate")}</small>
              <span>{item.reason}</span>
            </span>
          </label>;
        })}
        <div className={styles.planActions}>
          <button type="button" className="ui-action pi-bracket" disabled={applying || disabled || !selected.length} onClick={() => void accept()}>{t(applying ? "robin.kanban.saving" : "robin.kanban.acceptPlan")}</button>
          <button type="button" className="ui-action pi-bracket" disabled={applying} onClick={() => setProposal(null)}>{t("robin.kanban.discardPlan")}</button>
        </div>
      </section>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <p role="status" className={styles.feedback} data-visible={Boolean(message)}>{message}</p>
        </div>
        <footer className={styles.drawerFooter}>{t("robin.kanban.planSafety")}</footer>
      </dialog>
    </>
  );
}
