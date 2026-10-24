"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsSplitLayout } from "@/hooks/useIsMobile";
import { parseLocalDate } from "@/extension/robin/dates";
import { clock, type PlannerOptions } from "@/extension/robin/planner";
import { timelineDay, timelineRange, type TimelineEntry } from "./planner-timeline";
import { TodoTitle } from "./TodoTitle";
import styles from "./PlannerTimeline.module.css";

export function PlannerTimeline({ entries, days, today, options, onEditTask }: {
  entries: TimelineEntry[]; days: string[]; today: string; options: PlannerOptions; onEditTask: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const desktop = useIsSplitLayout();
  const [view, setView] = useState<"week" | "day">("week");
  const [selectedDay, setSelectedDay] = useState(today);
  const [selected, setSelected] = useState<TimelineEntry | null>(null);
  const detail = useRef<HTMLDialogElement>(null);
  const closeDetail = useRef<HTMLButtonElement>(null);
  const day = days.includes(selectedDay) ? selectedDay : days[0];
  const single = !desktop || view === "day";
  const visibleDays = single ? [day] : days;
  const { first, last } = timelineRange(options, entries);
  const hours = Array.from({ length: Math.ceil((last - first) / 60) + 1 }, (_, index) => first + index * 60);
  const scale = single ? 1.5 : 1.1;
  const height = (last - first) * scale;
  const dateLabel = (date: string) => parseLocalDate(date).toLocaleDateString(locale, { month: "short", day: "numeric", weekday: "short" });
  const kindLabel = (kind: TimelineEntry["kind"]) => t(kind === "logged" ? "planner.doneBlock" : `planner.${kind}`);
  const entryLabel = (entry: TimelineEntry) => `${kindLabel(entry.kind)}${entry.evening ? ` · ${t("planner.eveningBlock")}` : ""}`;
  const timeLabel = (entry: TimelineEntry) => entry.start ? `${entry.start}${entry.end ? `–${entry.end}` : "–?"}` : t("robin.calendar.allDay");
  useEffect(() => {
    if (!selected) return;
    const modal = detail.current;
    modal?.showModal(); closeDetail.current?.focus();
    return () => { if (modal?.open) modal.close(); };
  }, [selected]);
  if (!days.length) return null;
  const close = () => { detail.current?.close(); setSelected(null); };
  const entryButton = (entry: TimelineEntry, compact = false) => <button key={entry.id} type="button" className={styles.bandEntry} data-kind={entry.kind}
    title={`${timeLabel(entry)} ${entry.title}`} onClick={() => setSelected(entry)} aria-haspopup="dialog">
    {(!compact || entry.start) && <span>{timeLabel(entry)} · </span>}{entry.title}{entry.kind === "reminder" && <span> · {t("planner.reminder")}</span>}
  </button>;
  return <div className={styles.timeline} data-planner-timeline data-view={single ? "day" : "week"}>
    <div className={styles.legend} aria-label={t("planner.legend")}>
      {(["fixed", "confirmed", "proposed"] as const).map((kind) => <span key={kind}><i data-kind={kind} aria-hidden />{t(`planner.${kind}`)}</span>)}
      <span><i data-kind="lunch" aria-hidden />{t("planner.lunch")}</span>
    </div>
    <div className={styles.toolbar}>
      {single ? <div className={styles.dayPicker} role="group" aria-label={t("planner.chooseDay")}>
        {days.map((date) => <button type="button" key={date} aria-pressed={day === date} aria-label={dateLabel(date)} aria-current={date === today ? "date" : undefined}
          onClick={() => setSelectedDay(date)}><span>{parseLocalDate(date).toLocaleDateString(locale, { weekday: "short" })}</span><strong>{parseLocalDate(date).getDate()}</strong></button>)}
      </div> : <p>{t("planner.timelineHint")}</p>}
      {desktop && <div className={styles.viewPicker} role="group" aria-label={t("planner.timelineView")}>
        {(["week", "day"] as const).map((mode) => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}>{t(`planner.${mode}`)}</button>)}
      </div>}
    </div>
    <div className={styles.scroll} tabIndex={0} role="region" aria-label={t("planner.timelineLabel")}>
      <div className={styles.canvas} style={{ "--days": visibleDays.length } as CSSProperties}>
        <div className={styles.dates}>
          <span className={styles.gutterLabel}>{t("robin.calendar.localTime")}</span>
          {visibleDays.map((date) => <button type="button" key={date} onClick={() => { setSelectedDay(date); setView("day"); }} aria-label={dateLabel(date)} aria-current={date === today ? "date" : undefined}>
            <span>{parseLocalDate(date).toLocaleDateString(locale, { weekday: "short" })}</span><strong>{parseLocalDate(date).getDate()}</strong>
          </button>)}
        </div>
        {visibleDays.some((date) => timelineDay(entries, date, first, last).allDay.length) && <div className={styles.band}>
          <span className={styles.gutterLabel}>{t("planner.reminderBand")}</span>
          {visibleDays.map((date) => <div key={date}>{timelineDay(entries, date, first, last).allDay.map((entry) => entryButton(entry, true))}</div>)}
        </div>}
        <div className={styles.grid} style={{ height }}>
          <div className={styles.ruler} aria-hidden>{hours.map((value) => <span key={value} style={{ top: (value - first) * scale }}>{clock(value)}</span>)}</div>
          {visibleDays.map((date) => {
            const { timed } = timelineDay(entries, date, first, last);
            const weekday = parseLocalDate(date).getDay();
            const lunchStart = Math.max(first, 720), lunchEnd = Math.min(last, 780);
            return <div key={date} className={styles.column} data-date={date} data-unavailable={!options.weekends && [0, 6].includes(weekday)}>
              {hours.map((value) => <div key={value} className={styles.hourRule} style={{ top: (value - first) * scale }} aria-hidden />)}
              {lunchEnd > lunchStart && <div className={styles.lunch} style={{ top: (lunchStart - first) * scale, height: (lunchEnd - lunchStart) * scale }} aria-hidden>{single && t("planner.lunch")}</div>}
              {timed.map(({ event, startMinutes, endMinutes, column, columns }) => {
                const duration = endMinutes - startMinutes;
                return <button type="button" key={event.id} className={styles.block} data-kind={event.kind} data-short={duration * scale < 40}
                  data-start={startMinutes} data-end={endMinutes} data-planner-entry={event.id} aria-haspopup="dialog"
                  aria-label={`${dateLabel(date)} · ${timeLabel(event)} · ${event.title} · ${entryLabel(event)}`} title={`${timeLabel(event)} · ${event.title} · ${entryLabel(event)}`}
                  onClick={() => setSelected(event)} style={{ top: (startMinutes - first) * scale, height: Math.max(3, duration * scale - 2), left: `calc(${column / columns * 100}% + 2px)`, width: `calc(${100 / columns}% - 4px)` }}>
                  <strong>{event.evening && `${t("planner.eveningBlock")} · `}{event.title}</strong>{duration * scale >= 64 && <span>{timeLabel(event)}</span>}
                  {duration * scale >= 88 && <small>{entryLabel(event)}</small>}
                </button>;
              })}
            </div>;
          })}
        </div>
      </div>
    </div>
    {visibleDays.some((date) => timelineDay(entries, date, first, last).outside.length) && <details className={styles.outside}>
      <summary>{t("planner.outsideHours")}</summary>
      {visibleDays.flatMap((date) => timelineDay(entries, date, first, last).outside.map((entry) => <div key={`${date}:${entry.id}`}><span>{dateLabel(date)}</span>{entryButton(entry)}</div>))}
    </details>}
    {/* Exact-height short slots remain readable and touch-accessible through an
        optional 44px target list, without visually stretching five minutes. */}
    <details className={styles.accessibleList}><summary>{t("planner.slotDetails")}</summary>
      {visibleDays.flatMap((date) => timelineDay(entries, date, first, last).timed.map(({ event }) => <div key={`${date}:${event.id}`}><span>{dateLabel(date)}</span>{entryButton(event)}</div>))}
    </details>
    <dialog ref={detail} className={styles.detail} aria-labelledby="planner-slot-title" onCancel={(e) => { e.preventDefault(); close(); }}>
      {selected && <><header><span>{entryLabel(selected)}</span><button ref={closeDetail} type="button" aria-label={t("i18n.close")} onClick={close}>×</button></header>
        <h3 id="planner-slot-title">{selected.todo ? <TodoTitle todo={selected.todo} t={t} /> : selected.title}</h3>
        <p>{dateLabel(selected.date)}{selected.endDate && selected.endDate !== selected.date ? ` – ${dateLabel(selected.endDate)}` : ""}</p><p className={styles.detailTime}>{timeLabel(selected)}</p>
        {!selected.start && selected.kind !== "reminder" && <p>{t("planner.unknownTime")}</p>}{selected.start && !selected.end && <p>{t("planner.unknownEnd")}</p>}
        {selected.todo?.due && <p>{t("planner.due")} · {selected.todo.due}</p>}
        {selected.todo && <button type="button" className="ui-action pi-bracket" onClick={() => { const id = selected.todo!.id; close(); onEditTask(id); }}>{t("planner.adjustTask")}</button>}
      </>}
    </dialog>
  </div>;
}
