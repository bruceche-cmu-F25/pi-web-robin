"use client";

import { useEffect, useState } from "react";
import { addMonths, monthGrid, parseLocalDate } from "@/extension/robin/dates";
import { useI18n } from "@/hooks/useI18n";
import styles from "./CalendarPanel.module.css";

export type CalendarSources = { local: boolean; google: boolean; todos: boolean };
export function CalendarSidebar({ anchor, today, open, sources, onSources, onDate }: {
  anchor: string; today: string; open: boolean; sources: CalendarSources;
  onSources: (sources: CalendarSources) => void;
  onDate: (date: string) => void;
}) {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(anchor);
  useEffect(() => setMonth(anchor), [anchor]);
  const days = monthGrid(month);
  return <aside id="calendar-sidebar" className={styles.sidebar} data-open={open || undefined}>
    <div className={styles.miniHeading}>
      <span>{parseLocalDate(month).toLocaleDateString(locale, { year: "numeric", month: "long" })}</span>
      <span>
        <button type="button" className={styles.iconButton} aria-label={t("robin.calendar.previousMonth")} onClick={() => setMonth(addMonths(month, -1))}>‹</button>
        <button type="button" className={styles.iconButton} aria-label={t("robin.calendar.nextMonth")} onClick={() => setMonth(addMonths(month, 1))}>›</button>
      </span>
    </div>
    <div className={styles.miniGrid}>
      {days.slice(0, 7).map((date) => <span key={`label:${date}`}>{parseLocalDate(date).toLocaleDateString(locale, { weekday: "narrow" })}</span>)}
      {days.map((date) => <button type="button" key={date} className={date.slice(0, 7) !== month.slice(0, 7) ? styles.outside : undefined}
        aria-label={t("robin.calendar.jumpTo", { date })} aria-current={date === today ? "date" : undefined} aria-pressed={date === anchor}
        onClick={() => onDate(date)}>{parseLocalDate(date).getDate()}</button>)}
    </div>
    <fieldset className={styles.sources}>
      <legend>{t("robin.calendar.visibleCalendars")}</legend>
      {(["local", "google", "todos"] as const).map((source) => <label key={source}>
        <input type="checkbox" checked={sources[source]} onChange={(event) => onSources({ ...sources, [source]: event.target.checked })} />
        {t(source === "local" ? "robin.calendar.localCalendar" : source === "google" ? "robin.calendar.googleCalendar" : "robin.todos.title")}
      </label>)}
    </fieldset>
    <p className={styles.note}>{t("robin.calendar.googleReadOnlyHint")}</p>
  </aside>;
}
