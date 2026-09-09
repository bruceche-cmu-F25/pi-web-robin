"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PRACTICE_STATUSES, PRACTICE_ROUND_TARGET, attemptDay, practiceProgress, type AttemptOutcome, type PracticeRecord } from "@/extension/robin/practice";

export interface PracticeAttemptInput {
  outcome: AttemptOutcome;
  hintLevel?: number;
  confidence: number;
}

const RESULTS = [
  { key: "independent", outcome: "solved", hintLevel: 0, confidence: 4 },
  { key: "assisted", outcome: "solved", confidence: 2 },
  { key: "stuck", outcome: "stuck", confidence: 1 },
] as const;

interface Props {
  record: PracticeRecord | null;
  onStatus: (status: (typeof PRACTICE_STATUSES)[number]) => Promise<void>;
  onNote: (note: string) => Promise<void>;
  onRecord: (attempt: PracticeAttemptInput) => Promise<void>;
}

/**
 * The record for the open problem, and the two ways to change it by hand.
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
export function PracticeRecordBar({ record, onStatus, onNote, onRecord }: Props) {
  const { t } = useI18n();
  const [note, setNote] = useState(record?.note ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const progress = practiceProgress(record);

  const status = record?.status ?? "todo";

  /**
   * Run one write, and say so when it fails.
   *
   * Returns whether it worked, so a failed save leaves the editor open with
   * the text still in it rather than closing over a change that never landed.
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

  return (
    <div id="practice-record" tabIndex={-1} className="flex flex-col gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
      <p className="text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
        {t("coding.record.attempts", { count: progress.attempts })} · {t("coding.record.rounds", { count: progress.rounds, target: PRACTICE_ROUND_TARGET })}
      </p>
      <fieldset disabled={busy || saved} className="flex flex-wrap gap-x-3 gap-y-1">
        <legend className="text-xs" style={{ color: "var(--text-muted)" }}>{t("coding.record.log")}</legend>
        {RESULTS.map(({ key, ...attempt }) => (
          <button key={key} type="button" className="ui-action pi-bracket min-h-11 text-xs disabled:opacity-40"
            onClick={() => {
              setSaved(false);
              void run(() => onRecord(attempt)).then(setSaved);
            }}>
            {t(`coding.record.${key}`)}
          </button>
        ))}
      </fieldset>
      {saved && <div className="flex flex-wrap items-center gap-2 text-xs">
        <p role="status" style={{ color: "var(--success)" }}>{t("coding.record.saved")}</p>
        <button type="button" className="ui-action min-h-11" onClick={() => setSaved(false)}>{t("coding.record.another")}</button>
      </div>}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {PRACTICE_STATUSES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            disabled={busy}
            onClick={() => void run(() => onStatus(candidate))}
            className="ui-action pi-chrome-label pi-bracket"
            data-state={candidate === status ? "accent" : undefined}
            style={{ fontSize: 10 }}
          >
            {t(`coding.status.${candidate}`)}
          </button>
        ))}
        {record?.nextReviewOn ? (
          <span
            className="pi-eyebrow ml-auto"
            style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
          >
            {t("coding.record.review", { date: record.nextReviewOn })}
          </span>
        ) : null}
      </div>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("coding.record.countRule")}</p>
      {record && record.attempts.length > 0 && (
        <details>
          <summary className="ui-action flex min-h-11 cursor-pointer items-center text-xs">{t("coding.record.history")}</summary>
          <ul className="text-xs" style={{ color: "var(--text-muted)" }}>
            {record.attempts.slice(-6).reverse().map((attempt, index) => (
              <li key={`${attempt.at}-${index}`} className="py-1">
                {attemptDay(attempt)} · {t(`coding.outcome.${attempt.outcome}`)}
                {attempt.hintLevel !== undefined ? ` · ${t("coding.record.hint", { level: attempt.hintLevel })}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error ? (
        <p role="alert" style={{ fontSize: 11, color: "var(--danger)" }}>{error}</p>
      ) : null}

      {editing ? (
        <div className="flex flex-col gap-1">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder={t("coding.record.notePlaceholder")}
            className="pi-panel w-full resize-y p-2"
            style={{ fontSize: 12.5, background: "var(--bg-deep)", color: "var(--text)" }}
          />
          <div className="flex flex-wrap items-baseline gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => onNote(note)).then((ok) => {
                if (ok) setEditing(false);
              })}
              className="ui-action pi-chrome-label pi-bracket"
              data-state="accent"
              style={{ fontSize: 10 }}
            >
              {t("robin.common.save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setNote(record?.note ?? "");
                setEditing(false);
              }}
              className="ui-action pi-chrome-label pi-bracket"
              style={{ fontSize: 10 }}
            >
              {t("robin.common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setNote(record?.note ?? "");
            setEditing(true);
          }}
          className="ui-action text-left"
          style={{ fontSize: 12.5, color: record?.note ? "var(--text-muted)" : "var(--text-dim)" }}
        >
          {record?.note || t("coding.record.addNote")}
        </button>
      )}
    </div>
  );
}
