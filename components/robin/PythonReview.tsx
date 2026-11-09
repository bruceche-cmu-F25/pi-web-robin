"use client";

import { useEffect, useState } from "react";
import { parseLocalDate } from "@/extension/robin/dates";
import { PYTHON_URL, type PythonReviewCheck } from "@/extension/robin/study-plan";
import { PYTHON_REVIEW_CARDS } from "./python-review-cards";
import { pythonReviewForWeek } from "./python-review";
import styles from "./StudyPlan.module.css";

type Day = (typeof PYTHON_REVIEW_CARDS)[number];

export function PythonReview({ week, today, zh, checks, onSave, onReload }: {
  week: string; today: string | null; zh: boolean;
  checks: Record<string, PythonReviewCheck>;
  onSave: (date: string, checked: boolean, expected: string) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const days = pythonReviewForWeek(week);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [week]);
  if (!days.length && (week < "2026-11-23" || week > "2026-12-28")) return null;
  const otherDays = PYTHON_REVIEW_CARDS.filter((day) => !days.some((current) => current.date === day.date));
  const formatter = new Intl.DateTimeFormat(zh ? "zh-CN" : "en", { month: "numeric", day: "numeric", weekday: "short" });
  const active = selected ?? (today && days.find((day) => day.date === today)?.date) ?? days[0]?.date ?? "";
  const missed = today && [...PYTHON_REVIEW_CARDS].reverse().find((day) => day.date < today && !checks[day.date]?.checked);
  const completed = PYTHON_REVIEW_CARDS.filter((day) => checks[day.date]?.checked).length;
  const row = (day: Day) => <li key={day.date} className={styles.reviewItem} data-today={day.date === today || undefined}>
    <button type="button" className={styles.reviewDay} aria-expanded={active === day.date} onClick={() => setSelected(active === day.date ? "" : day.date)}>
      <time dateTime={day.date}>{formatter.format(parseLocalDate(day.date))}{day.date === today && <span> · {zh ? "今天" : "Today"}</span>}</time>
      <span className={styles.reviewDescription}><strong>{zh ? day.zh : day.en}</strong><span>{zh ? day.focusZh : day.focusEn}</span></span>
      {checks[day.date]?.checked && <small>{zh ? "已复习" : "Reviewed"}</small>}
    </button>
    <ReviewCard day={day} zh={zh} check={checks[day.date]} future={Boolean(today && day.date > today)} hidden={active !== day.date} onSave={onSave} onReload={onReload} />
  </li>;
  return <section className={styles.dailyReview} aria-labelledby="python-review-title">
    <header className={styles.reviewHeading}>
      <div><p className={styles.eyebrow}>PYTHON V9 · 11/04–11/22</p><h2 id="python-review-title">{days.length ? (zh ? "每天一张复习卡" : "One Python card a day") : (zh ? "Python 复习补漏" : "Python review catch-up")}</h2></div>
      <a href={PYTHON_URL} target="_blank" rel="noopener noreferrer">{zh ? "打开课程 ↗" : "Open course ↗"}</a>
    </header>
    <p className={styles.meta}>{zh ? `11 月 23 日转入后端；刷题另计。已复习 ${completed}/19，打开卡片不会自动勾选。` : `Backend begins Nov 23; problems are separate. Reviewed: ${completed}/19. Opening a card never checks it.`}</p>
    {missed && <button type="button" className={styles.reviewCatchup} onClick={() => {
      setSelected(missed.date);
      if (otherDays.some((day) => day.date === missed.date)) document.getElementById("python-review-other")?.setAttribute("open", "");
      requestAnimationFrame(() => document.getElementById(`review-${missed.date}`)?.scrollIntoView({ block: "nearest" }));
    }}>{zh ? `待补：${missed.date.slice(5)} · ${missed.zh} →` : `Catch up: ${missed.date.slice(5)} · ${missed.en} →`}</button>}
    {days.length > 0 && <ol className={styles.reviewDays}>{days.map((day) => row(PYTHON_REVIEW_CARDS.find((card) => card.date === day.date)!))}</ol>}
    <details id="python-review-other" className={styles.reviewMore}>
      <summary>{zh ? `查看其余 ${otherDays.length} 天安排` : `View the other ${otherDays.length} days`}</summary>
      <ol className={styles.reviewDays}>{otherDays.map(row)}</ol>
    </details>
  </section>;
}

function ReviewCard({ day, zh, check, future, hidden, onSave, onReload }: {
  day: Day; zh: boolean; check?: PythonReviewCheck; future: boolean; hidden: boolean;
  onSave: (date: string, checked: boolean, expected: string) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  async function toggle(checked: boolean) {
    if (busy || future) return;
    setOptimistic(checked); setBusy(true); setError("");
    try { await onSave(day.date, checked, check?.revision ?? ""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setOptimistic(null); setBusy(false); }
  }
  return <article id={`review-${day.date}`} hidden={hidden} className={styles.reviewCard} aria-label={zh ? `${day.zh}复习卡` : `${day.en} review card`}>
    <p>{zh ? day.lessonZh : day.lessonEn}</p>
    <pre><code>{day.code}</code></pre>
    <label className={styles.reviewCheck}><input type="checkbox" checked={optimistic ?? check?.checked ?? false} disabled={busy || future} onChange={(event) => void toggle(event.target.checked)} />{zh ? "已看过，标记为已复习" : "I read this — mark reviewed"}</label>
    {future && <p className={styles.meta}>{zh ? "可以提前预览，到这一天才能勾选。" : "Preview now; check this card on or after its date."}</p>}
    {error && <p role="alert" className={styles.error}>{error} <button type="button" disabled={busy} onClick={() => void onReload().then(() => setError(""), () => setError(zh ? "重新载入失败，请稍后重试。" : "Reload failed. Try again."))}>{zh ? "刷新记录" : "Reload record"}</button></p>}
  </article>;
}
