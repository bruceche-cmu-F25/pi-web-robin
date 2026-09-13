// What the record form and the roadmap's tracker read out of practice history.
// Pure and browser-safe; every date is a local YYYY-MM-DD string.
import { addDays, parseLocalDate, startOfWeek } from "../../extension/robin/dates.ts";
import {
  applyAttempt, attemptDay, practiceProgress, emptyRecord,
  type Attempt, type AttemptOutcome, type PracticeRecord,
} from "../../extension/robin/practice.ts";

/** How one sitting went, in the four words the record form offers. */
export type AttemptResult = "independent" | "assisted" | "partial" | "stuck";

/** Matches `practiceProgress`: only a cold, confident solve is independent. */
export function attemptResult(attempt: Attempt): AttemptResult {
  if (attempt.outcome === "partial" || attempt.outcome === "stuck") return attempt.outcome;
  return attempt.hintLevel === 0 && (attempt.confidence ?? 4) >= 3 ? "independent" : "assisted";
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / 86_400_000);
}

export interface DayActivity { slug: string; result: AttemptResult }

/** Every recorded sitting, bucketed by the local day it happened. */
export function activityByDay(records: Iterable<PracticeRecord>): Map<string, DayActivity[]> {
  const days = new Map<string, DayActivity[]>();
  for (const record of records) {
    for (const attempt of record.attempts) {
      const day = attemptDay(attempt);
      const entry = { slug: record.slug, result: attemptResult(attempt) };
      const bucket = days.get(day);
      if (bucket) bucket.push(entry);
      else days.set(day, [entry]);
    }
  }
  return days;
}

/** Consecutive practice days ending today — or yesterday, so an unstarted today does not read as a broken streak. */
export function practiceStreak(days: ReadonlyMap<string, unknown>, today: string): number {
  let day = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

/** Monday-first weeks ending with the week of `today`, oldest first; days after today are null. */
export function activityWeeks(today: string, weekCount: number): (string | null)[][] {
  const first = addDays(startOfWeek(today), -7 * (weekCount - 1));
  return Array.from({ length: weekCount }, (_, week) => Array.from({ length: 7 }, (_, weekday) => {
    const day = addDays(first, week * 7 + weekday);
    return day > today ? null : day;
  }));
}

export interface ForecastDay { date: string; slugs: string[]; overdue: string[] }

/**
 * Reviews falling due over the next `days` days, today first.
 *
 * Anything already overdue is folded into today's column rather than dropped:
 * it is work for today, and hiding it would make the queue look lighter than it is.
 */
export function reviewForecast(
  records: Iterable<PracticeRecord>,
  inScope: (slug: string) => boolean,
  today: string,
  days = 14,
): ForecastDay[] {
  const forecast = Array.from({ length: days }, (_, index) => ({ date: addDays(today, index), slugs: [] as string[], overdue: [] as string[] }));
  const last = forecast.at(-1)!.date;
  for (const record of records) {
    if (record.status === "todo" || !record.nextReviewOn || !inScope(record.slug)) continue;
    if (record.nextReviewOn < today) forecast[0].overdue.push(record.slug);
    else if (record.nextReviewOn <= last) forecast[daysBetween(today, record.nextReviewOn)].slugs.push(record.slug);
  }
  return forecast;
}

export interface AttemptDraft { outcome: AttemptOutcome; hintLevel: number; confidence: number; minutes?: number }

/** What saving `draft` would do, computed by the same function the write path runs. */
export function previewAttempt(record: PracticeRecord | null, slug: string, draft: AttemptDraft, today: string) {
  const before = practiceProgress(record);
  const copy: PracticeRecord = structuredClone(record ?? emptyRecord(slug));
  applyAttempt(copy, { at: new Date().toISOString(), on: today, ...draft });
  return { nextReviewOn: copy.nextReviewOn!, roundsBefore: before.rounds, roundsAfter: practiceProgress(copy).rounds };
}
