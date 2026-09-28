"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import styles from "./JobRow.module.css";
import type { Job, JobStatus } from "@/extension/robin/jobs";

/**
 * The score's place on the ladder. Not a red/amber/green traffic light: those
 * are reserved for alarm states, and a 3.2 is not a warning — it is a job that
 * scored 3.2. 4.5+ solid, 4.0+ filled, the push floor up to 4.0 in the accent
 * alone; below the floor the number is ordinary data. Drawn by JobRow.module.css.
 */
function scoreBand(score: number | undefined, minScore: number): "top" | "high" | "floor" | undefined {
  if (typeof score !== "number" || score < minScore) return undefined;
  if (score >= 4.5) return "top";
  if (score >= 4) return "high";
  return "floor";
}

/**
 * Provider ids as a person would say them. The ids are storage keys
 * ("bigtech-index", "builtinsf"); an unknown one falls through unchanged.
 */
const SOURCE_LABELS: Record<string, string> = {
  amazon: "Amazon Jobs",
  ashby: "Ashby",
  "bigtech-index": "SimplifyJobs",
  builtinsf: "Built In SF",
  eightfold: "Careers site",
  greenhouse: "Greenhouse",
  hackernews: "HN Who's Hiring",
  ibm: "IBM Careers",
  icims: "iCIMS",
  lever: "Lever",
  newgradlist: "New-Grad list",
  recruitee: "Recruitee",
  remoteok: "RemoteOK",
  remotive: "Remotive",
  simplify: "SimplifyJobs",
  smartrecruiters: "SmartRecruiters",
  speedyapply: "SpeedyApply",
  "speedyapply-ai": "SpeedyApply AI",
  workable: "Workable",
  workday: "Workday",
  workingnomads: "Working Nomads",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/**
 * Flags are written by the scorer and the intake rules, so they arrive as
 * storage slugs in a dozen spellings. The ones that mean "you cannot take this
 * job" stay in the danger colour; everything else is a caveat and reads as
 * one. Red on every card had stopped meaning anything.
 */
const BLOCKING_FLAG = /^(?:blocked-|security-clearance$|clearance$|export-control$|itar|us-citizenship$|defense$)/;

type Translate = ReturnType<typeof useI18n>["t"];

const FLAG_KEYS = new Set([
  "needs-review", "stretch-experience", "experience-stretch", "experience-gap", "unknown-experience",
  "unsupported-evidence", "score-stale", "blocked-experience", "security-clearance", "clearance",
  "export-control", "itar/export-control", "us-citizenship", "internship", "duplicate",
]);

function flagLabel(flag: string, t: Translate): string {
  if (FLAG_KEYS.has(flag)) return t(`robin.jobs.flag.${flag.replace("/", "-")}`);
  const years = flag.match(/^asks (\d+)\+ yrs$/);
  if (years) return t("robin.jobs.flag.asksYears", { years: years[1] ?? "" });
  const idle = flag.match(/^inactive-(\d+)d$/);
  if (idle) return t("robin.jobs.flag.inactive", { days: idle[1] ?? "" });
  if (flag.startsWith("blocked-")) return t("robin.jobs.flag.blocked", { what: flag.slice(8) });
  return flag.replace(/-/g, " ");
}

/**
 * `scoreJob` leads a capped reason with "Caveat (flag): " so the Telegram push
 * carries it. On the page the flag is already its own label, so the lead-in
 * is dropped when it names a flag the row shows.
 */
function displayReason(reason: string, flags: string[]): string {
  const lead = reason.match(/^[^:：()]{1,40} \(([a-z0-9/-]+)\): /);
  return lead && flags.includes(lead[1] ?? "") ? reason.slice(lead[0].length) : reason;
}

export function JobRow({
  job,
  also = [],
  active = false,
  minScore,
  onStatus,
  onNote,
  onDelete,
  busy = false,
}: {
  job: Job;
  /** Other listings of the same role, shown as links under this one. */
  also?: Job[];
  /** The keyboard cursor is on this card. */
  active?: boolean;
  minScore: number;
  onStatus?: (status: JobStatus) => void;
  onNote?: (note: string) => void;
  onDelete?: () => void;
  busy?: boolean;
}) {
  const { t, locale } = useI18n();
  const [editingNote, setEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const posted = job.postedAt
    ? t("robin.jobs.posted", { date: new Date(`${job.postedAt}T12:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric" }) })
    : "";
  const flagList = job.flags ?? [];
  const reason = job.reason ? displayReason(job.reason, flagList) : "";
  const alsoSources = [...new Map(also.map((copy) => [sourceLabel(copy.source), copy])).entries()];

  return (
    <div ref={rowRef} data-active={active || undefined} className={styles.row}>
      <span
        className={styles.score}
        data-band={scoreBand(job.score, minScore)}
        title={typeof job.score === "number" ? undefined : t("robin.jobs.unscored")}
      >
        {typeof job.score === "number" ? job.score.toFixed(1) : "—"}
      </span>

      <div className={styles.body}>
        {/* noreferrer matters: these URLs come from third-party job boards. */}
        <a href={job.url} target="_blank" rel="noopener noreferrer" className={styles.title} title={job.url}>
          <b>{job.company}</b>
          <span className={styles.dash}> — </span>
          {job.title}
        </a>

        {/* Actions share the dateline: a row without flags then ends with its
            reason, instead of a blank strip where hidden buttons wait. */}
        <div className={styles.metaRow}>
          <p className={styles.meta}>
            {job.status !== "new" && (
              <span className={styles.status}>
                {job.appliedAt && job.status === "applied"
                  ? t("robin.jobs.appliedOn", { date: new Date(job.appliedAt).toLocaleDateString(locale) })
                  : t(`robin.jobs.status.${job.status}`)}
                {" · "}
              </span>
            )}
            {[posted, job.location, sourceLabel(job.source)].filter(Boolean).join(" · ")}
            {alsoSources.length > 0 && (
              <>
                {" · "}{t("robin.jobs.alsoListed")}{" "}
                {alsoSources.map(([label, copy], index) => (
                  <span key={copy.id}>
                    {index > 0 && ", "}
                    <a href={copy.url} target="_blank" rel="noopener noreferrer" title={copy.url}>{label}</a>
                  </span>
                ))}
              </>
            )}
          </p>
          {onStatus && (
            <div className={styles.actions}>
              {job.status !== "shortlist" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onStatus("shortlist")}
                  className="ui-action pi-eyebrow disabled:opacity-40"
                  data-state="accent"
                >
                  {t("robin.jobs.action.shortlist")}
                </button>
              )}
              {job.status !== "applied" && (
                <button type="button" disabled={busy} onClick={() => onStatus("applied")} className="ui-action pi-eyebrow disabled:opacity-40">
                  {t("robin.jobs.action.applied")}
                </button>
              )}
              {job.status !== "dropped" && (
                <button type="button" disabled={busy} onClick={() => onStatus("dropped")} className="ui-action pi-eyebrow disabled:opacity-40">
                  {t("robin.jobs.action.drop")}
                </button>
              )}
              {job.status !== "new" && (
                <button type="button" disabled={busy} onClick={() => onStatus("new")} className="ui-action pi-eyebrow disabled:opacity-40">
                  {t("robin.jobs.action.reopen")}
                </button>
              )}
              {onNote && (editingNote ? (
                <input
                  value={draftNote}
                  onChange={(event) => setDraftNote(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { onNote(draftNote); setEditingNote(false); }
                    if (event.key === "Escape") setEditingNote(false);
                  }}
                  onBlur={() => { onNote(draftNote); setEditingNote(false); }}
                  placeholder={t("robin.jobs.notePlaceholder")}
                  aria-label={t("robin.jobs.note")}
                  autoFocus
                  className="min-w-0 flex-1 rounded px-1 py-0.5 text-xs outline-none"
                  style={{ background: "var(--bg)", border: "1px solid var(--accent)", color: "var(--text)" }}
                />
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setDraftNote(job.note ?? ""); setEditingNote(true); }}
                  className="ui-action pi-eyebrow disabled:opacity-40"
                >
                  {job.note ? t("robin.jobs.editNote") : t("robin.jobs.addNote")}
                </button>
              ))}
              {onDelete && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onDelete}
                  className="ui-action pi-eyebrow disabled:opacity-40"
                  data-hover="danger"
                >
                  {t("robin.jobs.action.delete")}
                </button>
              )}
            </div>
          )}
        </div>

        {reason && <p className={styles.reason}>{reason}</p>}
        {job.note && !editingNote && <p className={styles.note}>{job.note}</p>}

        {flagList.length > 0 && (
          <div className={styles.foot}>
            {flagList.map((flag) => (
              <span key={flag} className={styles.flag} data-blocking={BLOCKING_FLAG.test(flag) || undefined} title={flag}>
                {flagLabel(flag, t)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
