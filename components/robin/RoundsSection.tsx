"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import type { RoundScanState } from "@/extension/robin/round-domain";
import {
  docket,
  dueAt,
  hasTime,
  roundDay,
  type Round,
  type RoundKind,
  type RoundStatus,
} from "@/extension/robin/rounds";
import { mutate, usePolledResource } from "./usePolledResource";
import styles from "./RoundsSection.module.css";

interface RoundsResponse {
  rounds: Round[];
  scan: RoundScanState | null;
}

type Translate = ReturnType<typeof useI18n>["t"];
type Urgency = "overdue" | "soon" | "near" | "later" | "none";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The countdown is how the list reads at a glance, so it rounds down: "1d" means at least a day. */
function countdown(ms: number, t: Translate): string {
  if (ms < 0) return t("robin.rounds.overdue");
  if (ms < HOUR) return t("robin.rounds.minutes", { count: String(Math.max(1, Math.floor(ms / MINUTE))) });
  if (ms < DAY) return t("robin.rounds.hours", { count: String(Math.floor(ms / HOUR)) });
  return t("robin.rounds.days", { count: String(Math.floor(ms / DAY)) });
}

function urgency(ms: number | null): Urgency {
  if (ms === null) return "none";
  if (ms < 0) return "overdue";
  if (ms < DAY) return "soon";
  if (ms < 3 * DAY) return "near";
  return "later";
}

function formatWhen(due: string | undefined, locale: string): string {
  if (!due) return "";
  if (!hasTime(due)) {
    const [year, month, day] = due.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  }
  return new Date(due).toLocaleString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function gmailHref(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}

interface FormValues {
  kind: RoundKind;
  company: string;
  role: string;
  date: string;
  time: string;
  detail: string;
}

function formValues(round?: Round): FormValues {
  const day = roundDay(round?.due) ?? "";
  const time = round?.due && hasTime(round.due)
    ? new Date(round.due).toTimeString().slice(0, 5)
    : "";
  return {
    kind: round?.kind ?? "oa",
    company: round?.company ?? "",
    role: round?.role ?? "",
    date: day,
    time,
    detail: round?.detail ?? "",
  };
}

/** A day stays a day; a day with a time is sent as the instant the browser means by it. */
function dueFrom(values: FormValues): string {
  if (!values.date) return "";
  return values.time ? new Date(`${values.date}T${values.time}`).toISOString() : values.date;
}

function RoundForm({ round, onSubmit, onCancel }: {
  round?: Round;
  onSubmit: (values: FormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<FormValues>(() => formValues(round));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<FormValues>) => setValues((current) => ({ ...current, ...patch }));

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (!values.company.trim()) return;
        setBusy(true);
        void onSubmit(values).finally(() => setBusy(false));
      }}
    >
      {!round && (
        <div className={styles.kinds} role="group" aria-label={t("robin.rounds.kind")}>
          {(["oa", "interview"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className="ui-action ui-action--chip pi-eyebrow px-2 py-1"
              data-state={values.kind === kind ? "accent" : "muted"}
              aria-pressed={values.kind === kind}
              onClick={() => set({ kind })}
            >
              {t(`robin.rounds.kind.${kind}`)}
            </button>
          ))}
        </div>
      )}
      <label className={styles.wide}>
        <span className="pi-eyebrow">{t("robin.rounds.company")}</span>
        <input value={values.company} onChange={(event) => set({ company: event.target.value })} required autoFocus={!round} />
      </label>
      <label className={styles.wide}>
        <span className="pi-eyebrow">{t("robin.rounds.role")}</span>
        <input value={values.role} onChange={(event) => set({ role: event.target.value })} />
      </label>
      <label>
        <span className="pi-eyebrow">{t(values.kind === "oa" ? "robin.rounds.deadline" : "robin.rounds.date")}</span>
        <input type="date" value={values.date} onChange={(event) => set({ date: event.target.value })} />
      </label>
      <label>
        <span className="pi-eyebrow">{t("robin.rounds.time")}</span>
        <input type="time" value={values.time} onChange={(event) => set({ time: event.target.value })} disabled={!values.date} />
      </label>
      <label className={styles.wide}>
        <span className="pi-eyebrow">{t("robin.rounds.detail")}</span>
        <input value={values.detail} placeholder={t("robin.rounds.detailPlaceholder")} onChange={(event) => set({ detail: event.target.value })} />
      </label>
      <div className={`${styles.wide} ${styles.formActions}`}>
        <button type="submit" disabled={busy || !values.company.trim()} className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40" data-state="accent">
          {t("robin.common.save")}
        </button>
        <button type="button" onClick={onCancel} className="ui-action pi-chrome-label text-xs">
          {t("robin.common.cancel")}
        </button>
      </div>
    </form>
  );
}

/** One open OA or upcoming interview: the countdown on the left, what and when on the right. */
function OpenRow({ round, now, onStatus, onEdit, onDelete, busy }: {
  round: Round;
  now: number;
  onStatus: (status: RoundStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { t, locale } = useI18n();
  const at = dueAt(round);
  const left = at === null ? null : at - now;
  const when = formatWhen(round.due, locale);

  return (
    <li className={styles.row} data-urgency={urgency(left)}>
      <div className={styles.clock}>
        <strong>{left === null ? "—" : countdown(left, t)}</strong>
        <span>{left === null || left < 0 ? "" : t(round.kind === "oa" ? "robin.rounds.left" : "robin.rounds.toGo")}</span>
      </div>
      <div className={styles.body}>
        <h3>
          {round.company}
          {round.role && <span className={styles.role}> — {round.role}</span>}
        </h3>
        <p className={styles.when}>
          {when
            ? t(round.kind === "oa" ? "robin.rounds.dueOn" : "robin.rounds.startsOn", { when })
            : t(round.kind === "oa" ? "robin.rounds.noDeadline" : "robin.rounds.noTime")}
        </p>
        {round.detail && <p className={styles.detail}>{round.detail}</p>}
        <div className={styles.actions}>
          {round.kind === "oa" ? (
            <>
              <button type="button" disabled={busy} onClick={() => onStatus("done")} className="ui-action pi-eyebrow disabled:opacity-40" data-state="accent">
                {t("robin.rounds.action.done")}
              </button>
              <button type="button" disabled={busy} onClick={() => onStatus("missed")} className="ui-action pi-eyebrow disabled:opacity-40">
                {t("robin.rounds.action.missed")}
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => onStatus("cancelled")} className="ui-action pi-eyebrow disabled:opacity-40">
              {t("robin.rounds.action.cancelled")}
            </button>
          )}
          <button type="button" disabled={busy} onClick={onEdit} className="ui-action pi-eyebrow disabled:opacity-40">
            {t("robin.rounds.action.edit")}
          </button>
          {round.threadId && (
            <a href={gmailHref(round.threadId)} target="_blank" rel="noopener noreferrer" className="ui-action pi-eyebrow">
              {t("robin.rounds.action.email")} <span aria-hidden="true">↗</span>
            </a>
          )}
          <button type="button" disabled={busy} onClick={onDelete} className="ui-action pi-eyebrow ml-auto disabled:opacity-40" data-hover="danger">
            {t("robin.rounds.action.delete")}
          </button>
        </div>
      </div>
    </li>
  );
}


/**
 * Every OA and interview that came in by email, in the order they fall due.
 *
 * It sits at the top of the jobs page because it is the same hunt one step
 * along: the discoveries below are what you might apply to, these are what
 * applying turned into — and they are the half with deadlines, so they are
 * read first. Rounds arrive from the daily mail review on their own; the scan
 * is for mail that predates it.
 */
export function RoundsSection() {
  const { t, locale } = useI18n();
  const { data, error, loading, refresh } = usePolledResource<RoundsResponse>("/api/robin/rounds", 60_000);
  const [now, setNow] = useState(() => Date.now());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanInFlight = useRef(false);
  const [report, setReport] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Countdowns move on their own; a minute is as fine as they are drawn.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, []);

  const rounds = useMemo(() => data?.rounds ?? [], [data]);
  const { assessments, interviews, history } = useMemo(() => docket(rounds, now), [rounds, now]);

  const act = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (round: Round, status: RoundStatus) =>
    void act(round.id, () => mutate("/api/robin/rounds", "PATCH", { id: round.id, status }));
  const remove = (round: Round) =>
    void act(round.id, () => mutate("/api/robin/rounds", "DELETE", { id: round.id }));

  const add = async (values: FormValues) => {
    await act("new", async () => {
      await mutate("/api/robin/rounds", "POST", {
        kind: values.kind,
        company: values.company,
        role: values.role,
        due: dueFrom(values),
        detail: values.detail,
      });
      setAdding(false);
    });
  };

  const save = (round: Round) => async (values: FormValues) => {
    await act(round.id, async () => {
      await mutate("/api/robin/rounds", "PATCH", {
        id: round.id,
        company: values.company,
        role: values.role,
        due: dueFrom(values),
        detail: values.detail,
      });
      setEditing(null);
    });
  };

  const scan = async () => {
    if (scanInFlight.current) return;
    scanInFlight.current = true;
    setScanning(true);
    setActionError(null);
    setReport(null);
    try {
      const response = await fetch("/api/robin/rounds/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: locale.startsWith("zh") ? "zh" : "en" }),
      });
      const body = await response.json().catch(() => null) as { reply?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      setReport(body?.reply ?? null);
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      scanInFlight.current = false;
      setScanning(false);
    }
  };

  const renderOpen = (round: Round) => editing === round.id
    ? (
      <li key={round.id} className={styles.editing}>
        <RoundForm round={round} onSubmit={save(round)} onCancel={() => setEditing(null)} />
      </li>
    )
    : (
      <OpenRow
        key={round.id}
        round={round}
        now={now}
        busy={busy === round.id}
        onStatus={(status) => setStatus(round, status)}
        onEdit={() => setEditing(round.id)}
        onDelete={() => remove(round)}
      />
    );

  const group = (kind: RoundKind, open: Round[], title: string) => open.length > 0 && (
    <div className={styles.group} data-kind={kind}>
      <h3 className="pi-label">
        {t(title)} <span>{open.length}</span>
      </h3>
      <ul>{open.map(renderOpen)}</ul>
    </div>
  );

  const scannedAt = data?.scan
    ? new Date(data.scan.finishedAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <section className={`pi-card ${styles.card}`} aria-labelledby="jobs-rounds">
      <header className={styles.head}>
        <div>
          <h2 id="jobs-rounds" className="pi-label">{t("robin.rounds.title")}</h2>
          <p className={styles.meta}>
            {scannedAt ? t("robin.rounds.scannedAt", { when: scannedAt }) : t("robin.rounds.neverScanned")}
          </p>
        </div>
        <nav className="flex flex-wrap items-baseline gap-3">
          <button
            type="button"
            onClick={() => { setAdding((current) => !current); setEditing(null); }}
            className="ui-action pi-chrome-label pi-bracket text-xs"
          >
            {adding ? t("robin.common.cancel") : t("robin.rounds.add")}
          </button>
          <button
            type="button"
            onClick={() => void scan()}
            disabled={scanning}
            className="ui-action pi-chrome-label pi-bracket text-xs disabled:opacity-40"
            data-state={rounds.length === 0 ? "accent" : "muted"}
          >
            {scanning ? t("robin.rounds.scanning") : t("robin.rounds.scan")}
          </button>
        </nav>
      </header>

      {(actionError || error) && <p role="alert" className={styles.error}>{actionError ?? error}</p>}
      {scanning && <p role="status" className={styles.notice}>{t("robin.rounds.scanningHint")}</p>}

      {report && (
        <details className={styles.report} open>
          <summary>{t("robin.rounds.scanReport")}</summary>
          <div className={styles.reportBody}><MarkdownBody>{report}</MarkdownBody></div>
        </details>
      )}

      {adding && <div className={styles.editing}><RoundForm onSubmit={add} onCancel={() => setAdding(false)} /></div>}

      {loading && !data && <p role="status" className={styles.none}>{t("robin.rounds.loading")}</p>}

      {data && rounds.length === 0 && !adding && (
        <p className={styles.empty}>{t("robin.rounds.empty")} {t("robin.rounds.about", { days: String(data.scan?.days ?? 45) })}</p>
      )}

      {group("oa", assessments, "robin.rounds.assessments")}
      {group("interview", interviews, "robin.rounds.interviews")}

      {rounds.length > 0 && assessments.length === 0 && interviews.length === 0 && (
        <p className={styles.none}>{t("robin.rounds.noneOpen")}</p>
      )}

      {history.length > 0 && (
        <details className={styles.history}>
          <summary>{t("robin.rounds.history")} <span>{history.length}</span></summary>
          <ul>
            {history.map((round) => {
              const state = round.status === "open" ? "past" : round.status;
              return (
                <li key={round.id} data-status={state} data-kind={round.kind}>
                  <span className={styles.tag}>{t(`robin.rounds.status.${state}`)}</span>
                  <span className={styles.pastWhat}>
                    <span className={`pi-eyebrow ${styles.kindTag}`}>{t(`robin.rounds.kind.${round.kind}`)}</span>
                    <span>
                      {round.company}
                      {round.role && <span className={styles.role}> — {round.role}</span>}
                    </span>
                  </span>
                  <time className={styles.pastWhen} dateTime={round.due}>{formatWhen(round.due, locale)}</time>
                  <span className={styles.pastActions}>
                    {round.status !== "open" && (
                      <button type="button" disabled={busy === round.id} onClick={() => setStatus(round, "open")} className="ui-action pi-eyebrow disabled:opacity-40">
                        {t("robin.rounds.action.reopen")}
                      </button>
                    )}
                    <button type="button" disabled={busy === round.id} onClick={() => remove(round)} className="ui-action pi-eyebrow disabled:opacity-40" data-hover="danger">
                      {t("robin.rounds.action.delete")}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
