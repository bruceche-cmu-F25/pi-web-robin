"use client";

import { useEffect, useRef, useState } from "react";
import { dueStudySession, type StudySession } from "@/extension/robin/study-plan";
import styles from "./StudyReminder.module.css";

const KEY = "robin:study-reminders";
type Due = { session: StudySession; date: string; link: string; problem?: string };
function acknowledgements(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>; } catch { return {}; }
}
async function fetchSoon(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try { return await fetch(url, { cache: "no-store", signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
function remember(key: string, until: number) {
  const today = key.slice(0, 10);
  try { localStorage.setItem(KEY, JSON.stringify({ ...Object.fromEntries(Object.entries(acknowledgements()).filter(([item]) => item.startsWith(today))), [key]: until })); } catch { /* The dialog still closes when browser storage is unavailable. */ }
}
export function StudyReminder() {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [todayPracticed, setTodayPracticed] = useState(false);
  const [due, setDue] = useState<Due | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [zh, setZh] = useState(false);
  useEffect(() => {
    const load = () => { void fetch("/api/robin/learning/study", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((data) => { if (data?.sessions) { setSessions(data.sessions); setTodayPracticed(data.todayPracticed === true); } }).catch(() => {}); };
    load(); const timer = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    window.addEventListener("focus", load);
    return () => { clearInterval(timer); window.removeEventListener("focus", load); };
  }, []);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (document.hidden || due || window.location.pathname === "/" || window.location.pathname === "/login" || document.querySelector("dialog[open]")) return;
      const match = dueStudySession(sessions, new Date(), acknowledgements());
      if (!match || (match.session.id === "leetcode" && todayPracticed)) return;
      const key = `${match.date}:${match.session.id}:${match.session.start}`;
      if (match.session.id === "leetcode") {
        try {
          const response = await fetchSoon(`/api/robin/events?from=${match.date}&to=${match.date}`);
          if (response.ok) {
            const board = await response.json();
            const conflicts = (board.events as Array<{ source?: string; date: string; endDate?: string; start?: string; end?: string; title: string }>).some((event) =>
              event.source !== "study" && event.date <= match.date && (event.endDate ?? event.date) >= match.date
              && event.start && event.end && event.start < match.session.end && event.end > match.session.start
              && !/leetcode|刷题/i.test(event.title));
            if (conflicts) { remember(key, Number.MAX_SAFE_INTEGER); return; }
          }
        } catch { /* Calendar unavailable: use the explicit study schedule. */ }
      }
      let link = match.session.url, problem: string | undefined;
      if (match.session.id === "leetcode") {
        try {
          const response = await fetchSoon("/api/robin/learning");
          if (response.ok) {
            const snapshot = await response.json();
            const selected = snapshot.practice?.daily?.newProblems?.[0] ?? snapshot.practice?.daily?.reviews?.[0];
            if (selected && /^[a-z0-9-]+$/.test(selected.link)) {
              link = `https://leetcode.com/problems/${selected.link}/`; problem = selected.problem;
            }
          }
        } catch { /* The known-safe course link remains available offline. */ }
      }
      if (alive && !document.hidden && (acknowledgements()[key] ?? 0) <= Date.now() && !document.querySelector("dialog[open]")) {
        trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        remember(key, Date.now() + 45_000); // Short foreground lease; another tab can retry if this one closes.
        setZh(document.documentElement.lang.startsWith("zh")); setDue({ ...match, link, problem });
      }
    };
    void check(); const timer = setInterval(() => { void check(); }, 15_000);
    const visibility = () => { if (!document.hidden) void check(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("storage", visibility);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("storage", visibility); };
  }, [sessions, due, todayPracticed]);
  useEffect(() => { if (due && !dialog.current?.open) dialog.current?.showModal(); }, [due]);
  useEffect(() => {
    if (!due) return;
    const key = `${due.date}:${due.session.id}:${due.session.start}`;
    const timer = setInterval(() => {
      if (!document.hidden && (acknowledgements()[key] ?? 0) < Date.now() + 45_000) remember(key, Date.now() + 45_000);
    }, 15_000);
    return () => clearInterval(timer);
  }, [due]);
  function dismiss(minutes: number) {
    if (!due) return;
    remember(`${due.date}:${due.session.id}:${due.session.start}`, minutes === 0 ? Number.MAX_SAFE_INTEGER : Date.now() + minutes * 60_000);
    dialog.current?.close(); setDue(null); trigger.current?.focus({ preventScroll: true });
  }
  if (!due) return null;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="study-reminder-title"
    onCancel={(event) => { event.preventDefault(); dismiss(10); }}>
    <p className={styles.eyebrow}>{zh ? "学习时间到了" : "Time to study"} · {due.session.start}</p>
    <h2 id="study-reminder-title">{due.session.title}</h2>
    {due.problem && <p>{zh ? "今天的题目：" : "Today's problem: "}{due.problem}</p>}
    <p className={styles.hint}>{zh ? "打开资源不会自动标记完成；做完后回学习中心记录。" : "Opening the link does not mark this as done. Log your attempt afterward."}</p>
    <div className={styles.actions}>
      <a href={due.link} target="_blank" rel="noopener noreferrer" onClick={() => dismiss(0)}>{zh ? "去学习 ↗" : "Open study link ↗"}</a>
      <button type="button" onClick={() => dismiss(10)}>{zh ? "10 分钟后提醒" : "Remind in 10 min"}</button>
      <button type="button" onClick={() => dismiss(0)}>{zh ? "今天跳过" : "Skip today"}</button>
    </div>
  </dialog>;
}
