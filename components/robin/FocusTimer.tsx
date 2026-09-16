"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useFocusTimer } from "@/hooks/useFocusTimer";
import { showBrowserNotification, shouldShowBrowserNotification } from "@/lib/browser-notifications";
import {
  focusRemaining, FOCUS_PRESETS, formatFocusTime, MAX_BREAK_MINUTES, MAX_FOCUS_MINUTES, todayFocus, validMinutes,
} from "@/lib/focus-timer";
import { applyTitlePrefix } from "@/lib/tab-title";
import styles from "./FocusTimer.module.css";

function MinutesInput({ label, value, max, onChange }: {
  label: string; value: number; max: number; onChange: (value: number) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const invalid = !validMinutes(Number(draft), max);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type="number" inputMode="numeric" min={1} max={max} step={1}
        value={draft} aria-invalid={invalid || undefined}
        title={t("focus.range", { max })}
        onFocus={() => setEditing(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (!invalid) onChange(Number(draft));
          else setDraft(String(value));
          setEditing(false);
        }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      />
      <span>{t("focus.minutes")}</span>
      {invalid && <small className={styles.error}>{t("focus.range", { max })}</small>}
    </label>
  );
}

/** A single timer per shell, outside workspace lifecycles and scroll containers. */
export function FocusTimer({ compact = false }: { compact?: boolean } = {}) {
  const { t } = useI18n();
  const timer = useFocusTimer((done) => {
    // The in-page reminder is invisible while you are in another tab or app.
    // Permission is asked for when a round starts; never prompt from here.
    try {
      if (!("Notification" in window) || Notification.permission !== "granted" || !shouldShowBrowserNotification()) return;
    } catch { return; }
    void showBrowserNotification({
      title: t(`focus.${done.phase}Complete`),
      body: done.phase === "focus" ? t("focus.doneBody", { minutes: done.breakMinutes }) : t("focus.restedBody"),
      sessionUrl: window.location.href,
      tag: "pi-focus-timer",
      onClick: () => window.focus(),
    });
  });
  const { state, now, act } = timer;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 52, left: 8 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const manualFocus = useRef(false);
  const visible = open || timer.notice;
  const complete = state.status === "complete";
  const active = state.status !== "idle";
  const phase = t(`focus.${state.phase}`);
  const remaining = focusRemaining(state, now);
  const progress = state.status === "idle" ? 1 : Math.max(0, Math.min(1, remaining / state.phaseMs));
  const time = formatFocusTime(remaining);
  const status = complete ? t(`focus.${state.phase}Complete`)
    : state.status === "paused" ? t("focus.paused") : phase;
  const today = todayFocus(state, now);
  const todayMinutes = Math.floor(today.focusMs / 60_000);
  // Minutes, not seconds: a hidden tab only repaints about once a minute.
  const tabLabel = !timer.ready || !active ? "" : complete ? status
    : t("focus.tabTitle", { status, minutes: Math.max(1, Math.ceil(remaining / 60_000)) });

  useEffect(() => { applyTitlePrefix(tabLabel ? `${tabLabel} · ` : ""); }, [tabLabel]);
  useEffect(() => () => applyTitlePrefix(""), []);

  const close = () => {
    if (panel.current?.contains(document.activeElement)) trigger.current?.focus();
    setOpen(false);
    timer.dismissNotice();
  };
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });

  useLayoutEffect(() => {
    if (!visible) return;
    const positionPanel = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(288, window.innerWidth - 16);
      const gap = 8;
      const height = panel.current?.offsetHeight ?? 0;
      let top = rect.bottom + gap;
      // Flip above the trigger when there is not enough room below it (drawer).
      if (top + height > window.innerHeight - gap) top = Math.max(gap, rect.top - gap - height);
      setPosition({ top, left: Math.max(gap, Math.min(rect.right - width, window.innerWidth - width - gap)) });
    };
    positionPanel();
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    if (manualFocus.current) {
      panel.current?.querySelector<HTMLButtonElement>("[data-primary]")?.focus();
      manualFocus.current = false;
    }
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) closeRef.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [visible]);

  const start = (next: "focus" | "break") => {
    act({ type: "start", phase: next });
    close();
  };

  return (
    <div className={styles.timer} data-compact={compact || undefined}>
      <button
        ref={trigger} type="button" className={styles.trigger} disabled={!timer.ready}
        data-focus-trigger data-active={active || undefined} data-complete={complete || undefined}
        aria-label={active ? t("focus.timerStatus", { status, time }) : t("focus.open")}
        title={active ? status : t("focus.open")}
        aria-expanded={visible} aria-controls={visible ? "focus-timer-panel" : undefined} aria-haspopup="dialog"
        onClick={() => {
          timer.unlock();
          if (visible) close();
          else { manualFocus.current = true; setOpen(true); }
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M9 2h6M12 2v3m6 1 2 2" /><circle cx="12" cy="14" r="8" /><path d="M12 9v5l3 2" />
        </svg>
        <span className={styles.status}>{status}</span>
        {active && !complete && <span className={styles.digits}>{time}</span>}
      </button>
      <span className={styles.srOnly} role="status">{complete ? status : ""}</span>
      {timer.ready && visible && createPortal(
        <div ref={panel} id="focus-timer-panel" role="dialog" aria-labelledby="focus-timer-title"
          className={styles.panel} style={{ top: position.top, left: position.left }}>
          <header className={styles.header}>
            <h2 id="focus-timer-title">{complete ? t("focus.title") : phase}</h2>
            <button type="button" className={styles.close} onClick={close} aria-label={t("chat.close")}>×</button>
          </header>
          {complete ? (
            <div className={styles.completion}>
              <div className={styles.completionMark} aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
                </svg>
              </div>
              <p className={styles.heading}>{t(state.phase === "focus" ? "focus.doneHeading" : "focus.restedHeading")}</p>
              <p className={styles.copy}>{state.phase === "focus"
                ? t("focus.doneBody", { minutes: state.breakMinutes }) : t("focus.restedBody")}</p>
              <div className={styles.actions}>
                <button type="button" className="ui-action pi-bracket" data-state="accent" data-primary
                  aria-label={t(state.phase === "focus" ? "focus.startBreak" : "focus.nextRound")}
                  onClick={() => start(state.phase === "focus" ? "break" : "focus")}>
                  {t(state.phase === "focus" ? "focus.startBreak" : "focus.nextRound")}
                </button>
                <button type="button" className={styles.secondary} onClick={() => {
                  if (state.phase === "break") act({ type: "end" });
                  close();
                }}>{t(state.phase === "focus" ? "focus.notNow" : "focus.end")}</button>
              </div>
              {state.phase === "focus" && <button type="button" className={styles.secondary} onClick={() => { act({ type: "end" }); close(); }}>{t("focus.end")}</button>}
            </div>
          ) : (
            <>
              <div className={styles.dial} data-paused={state.status === "paused" || undefined}
                style={{ "--timer-progress": `${progress * 100}%` } as CSSProperties}
                role="timer" aria-label={`${status} ${time}`} aria-live="off">
                <div className={styles.dialFace}>
                  <span className={styles.phase}>{status}</span>
                  <span className={styles.countdown}>{time}</span>
                </div>
              </div>
              <div className={styles.actions}>
                <button type="button" className="ui-action pi-bracket" data-state="accent" data-primary
                  aria-label={t(state.status === "idle" ? "focus.startFocus" : state.status === "running" ? "focus.pause" : "focus.resume")}
                  onClick={() => {
                    if (state.status === "idle") start("focus");
                    else act({ type: state.status === "running" ? "pause" : "resume" });
                  }}>
                  {t(state.status === "idle" ? "focus.startFocus" : state.status === "running" ? "focus.pause" : "focus.resume")}
                </button>
                {active && <button type="button" className={styles.secondary} onClick={() => act({ type: "end" })}>{t("focus.end")}</button>}
              </div>
            </>
          )}
          {(today.rounds > 0 || todayMinutes > 0) && (
            <p className={styles.today}>{t("focus.today", {
              rounds: today.rounds,
              duration: todayMinutes >= 60
                ? t("focus.durationHours", { hours: Math.floor(todayMinutes / 60), minutes: todayMinutes % 60 })
                : t("focus.durationMinutes", { minutes: todayMinutes }),
            })}</p>
          )}
          {!complete && <div className={styles.settings}>
            <div className={styles.presets} role="group" aria-label={t("focus.presets")}>
              {FOCUS_PRESETS.map(([focusMinutes, breakMinutes]) => (
                <button key={focusMinutes} type="button"
                  aria-pressed={state.focusMinutes === focusMinutes && state.breakMinutes === breakMinutes}
                  onClick={() => act({ type: "settings", focusMinutes, breakMinutes })}>
                  {focusMinutes}/{breakMinutes}
                </button>
              ))}
            </div>
            <MinutesInput label={t("focus.focus")} value={state.focusMinutes} max={MAX_FOCUS_MINUTES} onChange={(focusMinutes) => act({ type: "settings", focusMinutes })} />
            <MinutesInput label={t("focus.break")} value={state.breakMinutes} max={MAX_BREAK_MINUTES} onChange={(breakMinutes) => act({ type: "settings", breakMinutes })} />
            {(state.status === "running" || state.status === "paused") && <p className={styles.hint}>{t("focus.nextPhase")}</p>}
            <div className={styles.sound}>
              <label>
                <span>{t("focus.sound")}</span>
                <input type="checkbox" checked={state.sound} onChange={(event) => act({ type: "settings", sound: event.target.checked })} />
              </label>
              <button type="button" className={styles.preview} disabled={!state.sound} onClick={timer.previewSound}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M11 5 6 9H3v6h3l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12" />
                </svg>
                {t("focus.previewSound")}
              </button>
            </div>
            <p className={styles.hint}>{t(timer.storageAvailable ? "focus.localHint" : "focus.storageUnavailable")}</p>
          </div>}
        </div>, document.body,
      )}
    </div>
  );
}
