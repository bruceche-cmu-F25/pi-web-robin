"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { addDays, parseLocalDate } from "@/extension/robin/dates";
import { findProblem, type CatalogProblem, type PracticeRecord } from "@/extension/robin/practice";
import { activityByDay, activityWeeks, practiceStreak, reviewForecast, type AttemptResult } from "./practice-tracking";
import styles from "./PracticeTracker.module.css";

const WEEKS = 16;
const FORECAST_DAYS = 14;

interface Props {
  records: ReadonlyMap<string, PracticeRecord>;
  problems: readonly CatalogProblem[];
  today: string;
  onSelect: (problem: CatalogProblem) => void;
}

type Selection = { kind: "practised" | "due"; date: string };
type Entry = { slug: string; result: AttemptResult | "overdue" | "due" };

/**
 * Across every problem: when you practised, and what is coming back.
 *
 * Activity counts every record — it is about you, not about the list on
 * screen — while the forecast follows the chosen list, like the daily plan.
 */
export function PracticeTracker({ records, problems, today, onSelect }: Props) {
  const { t, locale } = useI18n();
  const [selection, setSelection] = useState<Selection | null>(null);
  const activity = useMemo(() => activityByDay(records.values()), [records]);
  const weeks = useMemo(() => today ? activityWeeks(today, WEEKS) : [], [today]);
  const inList = useMemo(() => new Set(problems.map((problem) => problem.link)), [problems]);
  const forecast = useMemo(
    () => today ? reviewForecast(records.values(), (slug) => inList.has(slug), today, FORECAST_DAYS) : [],
    [records, inList, today],
  );
  if (!today) return null;

  const lastWeek = Array.from({ length: 7 }, (_, index) => activity.get(addDays(today, -index)) ?? []).flat();
  const independent = lastWeek.filter((entry) => entry.result === "independent").length;
  const streak = practiceStreak(activity, today);
  const peak = Math.max(1, ...forecast.map((day) => day.slugs.length + day.overdue.length));
  const month = new Intl.DateTimeFormat(locale, { month: "short" });
  const dueTotal = forecast.reduce((sum, day) => sum + day.slugs.length + day.overdue.length, 0);

  const dueDay = selection?.kind === "due" ? forecast.find((day) => day.date === selection.date) : undefined;
  const selected: Entry[] = !selection ? [] : selection.kind === "practised" ? activity.get(selection.date) ?? [] : [
    ...(dueDay?.overdue ?? []).map((slug) => ({ slug, result: "overdue" as const })),
    ...(dueDay?.slugs ?? []).map((slug) => ({ slug, result: "due" as const })),
  ];
  const toggle = (next: Selection) => setSelection((current) =>
    current?.kind === next.kind && current.date === next.date ? null : next);

  return (
    <section className={styles.tracker} aria-labelledby="practice-tracker-title">
      <header className={styles.header}>
        <h2 id="practice-tracker-title" className="pi-eyebrow">{t("coding.tracker.title")}</h2>
        {activity.size > 0 && (
          <p className={styles.stats}>
            <span>{t("coding.tracker.week", { count: lastWeek.length })}</span>
            <span data-live={streak > 0}>{t("coding.tracker.streak", { count: streak })}</span>
            {lastWeek.length > 0 && <span>{t("coding.tracker.independentShare", { percent: Math.round(independent / lastWeek.length * 100) })}</span>}
          </p>
        )}
      </header>

      {activity.size === 0 ? <p className={styles.empty}>{t("coding.tracker.empty")}</p> : (
        <div className={styles.panels}>
          <figure className={styles.heatmap}>
            <figcaption>{t("coding.tracker.activity")}</figcaption>
            <div className={styles.months} aria-hidden="true">
              {weeks.map((week, index) => {
                const first = week[0]!;
                // Label the first week of each month; the partial month the grid opens on stays unlabelled.
                const changed = index > 0 && first.slice(5, 7) !== weeks[index - 1][0]!.slice(5, 7);
                return <span key={first}>{changed ? month.format(parseLocalDate(first)) : ""}</span>;
              })}
            </div>
            <div className={styles.grid}>
              {weeks.map((week) => (
                <div key={week[0]} className={styles.week}>
                  {week.map((day, weekday) => {
                    if (!day) return <span key={weekday} className={styles.cell} data-future />;
                    const entries = activity.get(day) ?? [];
                    const level = Math.min(entries.length, 4);
                    const label = t("coding.tracker.cell", { date: day, count: entries.length });
                    return entries.length === 0
                      ? <span key={day} className={styles.cell} data-level={0} data-today={day === today || undefined} title={label} />
                      : <button key={day} type="button" className={styles.cell} data-level={level} data-today={day === today || undefined}
                        title={label} aria-label={label}
                        aria-pressed={selection?.kind === "practised" && selection.date === day}
                        onClick={() => toggle({ kind: "practised", date: day })} />;
                  })}
                </div>
              ))}
            </div>
            <p className={styles.scale} aria-hidden="true">
              {t("coding.tracker.less")}
              {[0, 1, 2, 3, 4].map((level) => <span key={level} className={styles.cell} data-level={level} />)}
              {t("coding.tracker.more")}
            </p>
          </figure>

          <figure className={styles.forecast}>
            <figcaption>{t("coding.tracker.forecast")}</figcaption>
            {dueTotal === 0 ? <p className={styles.empty}>{t("coding.tracker.noDue")}</p> : (
              <div className={styles.bars}>
                {forecast.map((day, index) => {
                  const count = day.slugs.length + day.overdue.length;
                  const weekend = [0, 6].includes(parseLocalDate(day.date).getDay());
                  const label = t("coding.tracker.bar", { date: day.date, count })
                    + (day.overdue.length ? ` · ${t("coding.tracker.overdue", { count: day.overdue.length })}` : "");
                  const body = (
                    <>
                      <span className={styles.barCount}>{count || ""}</span>
                      <span className={styles.barStack} style={{ height: `${count / peak * 100}%` }}>
                        {day.overdue.length > 0 && <span data-overdue style={{ flexGrow: day.overdue.length }} />}
                        {day.slugs.length > 0 && <span style={{ flexGrow: day.slugs.length }} />}
                      </span>
                      <span className={styles.barDay} data-weekend={weekend}>
                        {index === 0 ? t("coding.relative.today") : Number(day.date.slice(8))}
                      </span>
                    </>
                  );
                  return count === 0
                    ? <span key={day.date} className={styles.bar} title={label}>{body}</span>
                    : <button key={day.date} type="button" className={styles.bar} title={label} aria-label={label}
                      aria-pressed={selection?.kind === "due" && selection.date === day.date}
                      onClick={() => toggle({ kind: "due", date: day.date })}>{body}</button>;
                })}
              </div>
            )}
          </figure>
        </div>
      )}

      {selection && selected.length > 0 && (
        <div className={styles.dayList}>
          <header>
            <h3>{t(selection.kind === "practised" ? "coding.tracker.dayPracticed" : "coding.tracker.dayDue", { date: selection.date })}</h3>
            <button type="button" className="ui-action text-xs" onClick={() => setSelection(null)}>{t("coding.tracker.close")}</button>
          </header>
          <ul>
            {selected.map(({ slug, result }, index) => {
              const problem = findProblem(slug);
              if (!problem) return null;
              return (
                <li key={`${slug}-${index}`}>
                  <button type="button" data-result={result} onClick={() => onSelect(problem)}>
                    <span aria-hidden="true" />
                    {problem.problem}
                    <small>{result === "overdue" ? t("coding.tracker.overdueMark")
                      : result === "due" ? problem.pattern : t(`coding.record.${result}`)}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
