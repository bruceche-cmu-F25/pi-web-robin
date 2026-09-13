"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PRACTICE_STATUSES, PRACTICE_ROUND_TARGET, attemptDay, practiceProgress, type AttemptOutcome, type PracticeRecord } from "@/extension/robin/practice";
import { attemptResult, daysBetween, previewAttempt, type AttemptResult } from "./practice-tracking";
import styles from "./PracticeRecordBar.module.css";

export interface PracticeAttemptInput {
  outcome: AttemptOutcome;
  hintLevel: number;
  confidence: number;
  minutes?: number;
}

/** Each result fixes the outcome and suggests a starting confidence; hints and confidence stay adjustable. */
const RESULTS: readonly { key: AttemptResult; outcome: AttemptOutcome; glyph: string; hint: number; confidence: number }[] = [
  { key: "independent", outcome: "solved", glyph: "✓", hint: 0, confidence: 4 },
  { key: "assisted", outcome: "solved", glyph: "◐", hint: 1, confidence: 3 },
  { key: "partial", outcome: "partial", glyph: "◔", hint: 0, confidence: 2 },
  { key: "stuck", outcome: "stuck", glyph: "✕", hint: 0, confidence: 1 },
];
const MINUTE_PRESETS = [15, 30, 45, 60];
const TRAIL_LENGTH = 8;

interface Props {
  slug: string;
  today: string;
  record: PracticeRecord | null;
  onStatus: (status: (typeof PRACTICE_STATUSES)[number]) => Promise<void>;
  onNote: (note: string) => Promise<void>;
  onRecord: (attempt: PracticeAttemptInput) => Promise<void>;
  onClose: () => void;
}

/** "tomorrow", "in 6 days", "3 days ago" — dates alone make you do the arithmetic. */
function useRelative() {
  const { t } = useI18n();
  return (date: string, today: string, overdue = false) => {
    if (!today) return "";
    const days = daysBetween(today, date);
    if (days === 0) return t("coding.relative.today");
    if (days === 1) return t("coding.relative.tomorrow");
    if (days > 1) return t("coding.relative.inDays", { count: days });
    if (overdue) return t("coding.relative.overdue", { count: -days });
    return days === -1 ? t("coding.relative.yesterday") : t("coding.relative.daysAgo", { count: -days });
  };
}

/**
 * The record for the open problem: log a sitting on the left, see its trail on the right.
 *
 * The caller keys this on the problem, so switching problems remounts it and
 * no draft, open editor, or error survives the move. Resetting that in an
 * effect instead would also have to fire on every change to the note itself,
 * which is how a poll landing mid-sentence — or the coach saving its own note —
 * would wipe what you were typing.
 *
 * The coach can write this too, through its tools. Having both is the point:
 * the agent records the sittings it took part in, and this is here for the
 * ones it did not — a problem solved on the train still has to be able to
 * enter the history, or the review queue quietly describes the wrong person.
 */
export function PracticeRecordBar({ slug, today, record, onStatus, onNote, onRecord, onClose }: Props) {
  const { t } = useI18n();
  const relative = useRelative();
  const [result, setResult] = useState<(typeof RESULTS)[number] | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [confidence, setConfidence] = useState(3);
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState(record?.note ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const progress = practiceProgress(record);
  const completedRounds = Math.min(progress.rounds, PRACTICE_ROUND_TARGET);
  const status = record?.status ?? "todo";
  const parsedMinutes = Number.parseInt(minutes, 10);
  const draft = result && {
    outcome: result.outcome,
    hintLevel,
    confidence,
    ...(parsedMinutes > 0 ? { minutes: parsedMinutes } : {}),
  };
  const preview = draft && today ? previewAttempt(record, slug, draft, today) : null;
  const trail = [...(record?.attempts ?? [])].reverse();

  /**
   * Run one write, and say so when it fails.
   *
   * Returns whether it worked, so a failed save leaves the form filled in
   * rather than clearing a choice that never landed.
   */
  const run = async (action: () => Promise<void>): Promise<boolean> => {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const choose = (next: (typeof RESULTS)[number]) => {
    if (next.key === result?.key) return;
    setResult(next);
    setHintLevel(next.hint);
    setConfidence(next.confidence);
  };

  const reset = () => {
    setSaved(false);
    setResult(null);
    setMinutes("");
  };

  return (
    <div id="practice-record" tabIndex={-1} className={styles.recordBar}>
      <section className={styles.log} aria-labelledby="practice-record-title">
        <header className={styles.logHeader}>
          <h2 id="practice-record-title">{t("coding.record.log")}</h2>
          <button type="button" className="ui-action min-h-11 text-xs" onClick={onClose}>{t("coding.record.close")}</button>
        </header>

        <div className={styles.rounds}>
          <p>
            <span>{t("coding.record.rounds", { count: progress.rounds, target: PRACTICE_ROUND_TARGET })}</span>
            <span>{t("coding.record.attempts", { count: progress.attempts })}</span>
          </p>
          <div className={styles.roundTrack} role="progressbar"
            aria-label={t("coding.record.rounds", { count: progress.rounds, target: PRACTICE_ROUND_TARGET })}
            aria-valuemin={0} aria-valuemax={PRACTICE_ROUND_TARGET} aria-valuenow={completedRounds}>
            {Array.from({ length: PRACTICE_ROUND_TARGET }, (_, index) => (
              <span key={index} aria-hidden data-complete={index < completedRounds}
                data-preview={preview && !saved
                  ? preview.roundsAfter > preview.roundsBefore && index === completedRounds ? "gain"
                    : preview.roundsAfter < preview.roundsBefore && index >= Math.min(preview.roundsAfter, PRACTICE_ROUND_TARGET) && index < completedRounds ? "loss" : undefined
                  : undefined} />
            ))}
          </div>
        </div>

        <fieldset disabled={busy || saved} className={styles.form}>
          <legend className={styles.question}>{t("coding.record.howWent")}</legend>
          <div className={styles.results}>
            {RESULTS.map((candidate) => (
              <button key={candidate.key} type="button" className={styles.result} data-result={candidate.key}
                aria-pressed={candidate.key === result?.key} aria-label={t(`coding.record.${candidate.key}`)}
                aria-describedby={`practice-result-${candidate.key}`} onClick={() => choose(candidate)}>
                <span className={styles.resultGlyph} aria-hidden="true">{candidate.glyph}</span>
                <span className={styles.resultLabel} aria-hidden="true">{t(`coding.record.${candidate.key}`)}</span>
                <span id={`practice-result-${candidate.key}`} className={styles.resultHint}>{t(`coding.record.resultHint.${candidate.key}`)}</span>
              </button>
            ))}
          </div>

          {result && result.key !== "independent" && (
            <div className={styles.field}>
              <p className={styles.question} id="practice-hints">{t("coding.record.hintsUsed")}</p>
              <div className={styles.chips} role="group" aria-labelledby="practice-hints">
                {(result.key === "assisted" ? [1, 2, 3, 4] : [0, 1, 2, 3, 4]).map((level) => (
                  <button key={level} type="button" aria-pressed={level === hintLevel} onClick={() => setHintLevel(level)}>
                    {level > 0 && <small>{level}</small>}{t(`coding.record.hintLevel.${level}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {result && (
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <p className={styles.question} id="practice-confidence">{t("coding.record.confidenceLabel")}</p>
                <div className={styles.confidence} role="group" aria-labelledby="practice-confidence">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button key={value} type="button" aria-pressed={value === confidence} data-filled={value <= confidence}
                      aria-label={`${value} · ${t(`coding.record.confidenceLevel.${value}`)}`} onClick={() => setConfidence(value)}>
                      {value}
                    </button>
                  ))}
                  <span aria-hidden="true">{t(`coding.record.confidenceLevel.${confidence}`)}</span>
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.question} htmlFor="practice-minutes">{t("coding.record.minutes")}</label>
                <div className={styles.minutes}>
                  <input id="practice-minutes" type="number" inputMode="numeric" min={1} max={600} step={5} value={minutes}
                    onChange={(event) => setMinutes(event.target.value)} />
                  {MINUTE_PRESETS.map((value) => (
                    <button key={value} type="button" aria-pressed={parsedMinutes === value} onClick={() => setMinutes(String(value))}>{value}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className={styles.submit}>
            <p className={styles.preview} aria-live="polite">
              {preview ? t("coding.record.preview", {
                date: preview.nextReviewOn, relative: relative(preview.nextReviewOn, today),
                from: preview.roundsBefore, to: preview.roundsAfter,
              }) : t("coding.record.previewPick")}
            </p>
            <button type="button" className={styles.save} disabled={!draft}
              onClick={() => { if (draft) void run(() => onRecord(draft)).then(setSaved); }}>
              {t("coding.record.save")}
            </button>
          </div>
        </fieldset>

        {saved && (
          <div className={styles.saved}>
            <p role="status">{t("coding.record.saved")}</p>
            <button type="button" className="ui-action min-h-11 text-xs" onClick={reset}>{t("coding.record.another")}</button>
          </div>
        )}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </section>

      <section className={styles.track} aria-label={t("coding.record.history")}>
        <div className={styles.nextReview} data-due={!!record?.nextReviewOn && !!today && record.nextReviewOn <= today}>
          <p className="pi-eyebrow">{t("coding.record.nextReview")}</p>
          {record?.nextReviewOn ? (
            <p>
              <strong>{record.nextReviewOn}</strong>
              <span>{relative(record.nextReviewOn, today, true)}</span>
            </p>
          ) : <p className={styles.muted}>{t("coding.record.noReview")}</p>}
        </div>

        <div className={styles.status}>
          <p className="pi-eyebrow" id="practice-status-label">{t("coding.record.statusLabel")}</p>
          <div role="group" aria-labelledby="practice-status-label">
            {PRACTICE_STATUSES.map((candidate) => (
              <button key={candidate} type="button" disabled={busy} aria-pressed={candidate === status} data-status={candidate}
                onClick={() => { if (candidate !== status) void run(() => onStatus(candidate)); }}>
                {t(`coding.status.${candidate}`)}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.trail}>
          <p className="pi-eyebrow">{t("coding.record.history")}</p>
          {trail.length === 0 ? <p className={styles.muted}>{t("coding.record.noHistory")}</p> : (
            <ol>
              {trail.slice(0, TRAIL_LENGTH).map((attempt, index) => {
                const kind = attemptResult(attempt);
                const day = attemptDay(attempt);
                return (
                  <li key={`${attempt.at}-${index}`} data-attempt-result={kind}>
                    <span className={styles.trailDate}>{day}<small>{relative(day, today)}</small></span>
                    <span className={styles.trailResult}>{t(`coding.record.${kind}`)}</span>
                    <span className={styles.trailMeta}>
                      {attempt.hintLevel !== undefined && attempt.hintLevel > 0 && <span>{t(`coding.record.hintLevel.${attempt.hintLevel}`)}</span>}
                      {attempt.confidence !== undefined && <span>{t("coding.record.confidence", { value: attempt.confidence })}</span>}
                      {attempt.minutes !== undefined && <span>{t("coding.record.minutesValue", { count: attempt.minutes })}</span>}
                    </span>
                  </li>
                );
              })}
              {trail.length > TRAIL_LENGTH && <li className={styles.older}>{t("coding.record.older", { count: trail.length - TRAIL_LENGTH })}</li>}
            </ol>
          )}
        </div>

        <div className={styles.note}>
          <p className="pi-eyebrow">{t("coding.record.note")}</p>
          {editing ? (
            <>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3}
                aria-label={t("coding.record.addNote")} placeholder={t("coding.record.notePlaceholder")} />
              <div className={styles.noteActions}>
                <button type="button" disabled={busy} className="ui-action pi-chrome-label pi-bracket text-xs" data-state="accent"
                  onClick={() => void run(() => onNote(note)).then((ok) => { if (ok) setEditing(false); })}>
                  {t("robin.common.save")}
                </button>
                <button type="button" className="ui-action pi-chrome-label pi-bracket text-xs"
                  onClick={() => { setNote(record?.note ?? ""); setEditing(false); }}>
                  {t("robin.common.cancel")}
                </button>
              </div>
            </>
          ) : (
            <button type="button" className={styles.noteButton} data-empty={!record?.note}
              onClick={() => { setNote(record?.note ?? ""); setEditing(true); }}>
              {record?.note || t("coding.record.addNote")}
            </button>
          )}
        </div>

        <details className={styles.rules}>
          <summary>{t("coding.record.help")}</summary>
          <p>{t("coding.record.countRule")}</p>
        </details>
      </section>
    </div>
  );
}
