"use client";

import { useEffect, useState } from "react";
import { PYTHON_URL, sessionOccurrences, weekFor, type StudyMilestone, type StudySession, type StudyWeek, type PythonReviewCheck } from "@/extension/robin/study-plan";
import { addDays, localDate } from "@/extension/robin/dates";
import type { PlannerProposal } from "@/extension/robin/study-planner-reply";
import { AgentPanel } from "./AgentPanel";
import { PythonReview } from "./PythonReview";
import { useI18n } from "@/hooks/useI18n";
import styles from "./StudyPlan.module.css";

type Snapshot = { week: StudyWeek; sessions: StudySession[]; reviewChecks?: Record<string, PythonReviewCheck>; practiceDays: number; todayPracticed: boolean; attemptsThisWeek: number };
type Draft = { objective: string; milestones: StudyMilestone[] };
async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
}

/** The week is for reading and tracking; planning is a separate, deliberate decision. */
export function StudyPlan({ view }: { view: "week" | "planner" }) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [data, setData] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [mobilePane, setMobilePane] = useState<"plan" | "buddy">("plan");
  const [chatEngaged, setChatEngaged] = useState(false);
  useEffect(() => { void refresh(true);
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    setNow(new Date());
    return () => window.clearInterval(timer);
    // Initial read only; manual refresh checks for unsaved edits before replacing the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dirty = Boolean(data && (JSON.stringify(draft) !== JSON.stringify({ objective: data.week.objective, milestones: data.week.milestones }) || JSON.stringify(sessions) !== JSON.stringify(data.sessions)));
  async function refresh(initial = false) {
    if (!initial && dirty && !window.confirm(zh ? "放弃尚未保存的规划修改？" : "Discard unsaved planning changes?")) return;
    try {
      const result = await request<Snapshot>("/api/robin/learning/study");
      setData(result); setDraft({ objective: result.week.objective, milestones: result.week.milestones.map((item) => ({ ...item })) });
      setSessions(result.sessions); setError("");
    } catch { setError("read"); }
  }
  async function saveWeek(next = draft, completedIndex?: number) {
    if (!next || !data || busy) return;
    setBusy(true); setError("");
    try {
      const { week } = await request<{ week: StudyWeek }>("/api/robin/learning/study", "PATCH", { date: data.week.week, expected: data.week.updatedAt, week: next });
      setData((current) => current && { ...current, week });
      if (completedIndex === undefined) setDraft({ objective: week.objective, milestones: week.milestones });
      else setDraft((current) => current && { ...current, milestones: current.milestones.map((item, index) => index === completedIndex ? { ...item, done: week.milestones[index].done } : item) });
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  function toggleMilestone(index: number) {
    if (!data || busy) return;
    const next = { objective: data.week.objective, milestones: data.week.milestones.map((item, i) => i === index ? { ...item, done: !item.done } : item) };
    void saveWeek(next, index);
  }
  function showMobilePane(pane: "plan" | "buddy", target: string, focus = false) {
    setMobilePane(pane);
    if (pane === "plan") setChatEngaged(false);
    requestAnimationFrame(() => {
      const destination = document.getElementById(target);
      destination?.scrollIntoView({ block: "start", behavior: "instant" });
      if (focus) destination?.focus({ preventScroll: true });
    });
  }
  function adoptProposal(proposal?: PlannerProposal) {
    if (!proposal || typeof proposal.objective !== "string" || !proposal.objective.trim() || proposal.objective.length > 160 ||
      !Array.isArray(proposal.milestones) || proposal.milestones.length < 1 || proposal.milestones.length > 5 ||
      proposal.milestones.some((item) => typeof item?.title !== "string" || !item.title.trim() || item.title.length > 120)) return;
    setDraft({ objective: proposal.objective, milestones: proposal.milestones.map((item, index) => ({ title: item.title, done: false, id: `proposal-${index}` })) });
    showMobilePane("plan", "study-decision-title", true);
  }
  async function saveSessions() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await request<{ sessions: StudySession[] }>("/api/robin/learning/study", "PUT", { sessions });
      setSessions(result.sessions); setData((previous) => previous && { ...previous, sessions: result.sessions });
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  const updateSession = (id: string, patch: Partial<StudySession>) => setSessions((previous) => previous.map((item) => item.id === id ? { ...item, ...patch } : item));
  async function saveReviewCheck(date: string, checked: boolean, expected: string) {
    const { progress } = await request<{ progress: PythonReviewCheck }>("/api/robin/learning/study", "POST", { date, checked, expected });
    setData((current) => current && { ...current, reviewChecks: { ...current.reviewChecks, [date]: progress } });
  }
  async function reloadReviewChecks() {
    const result = await request<Snapshot>("/api/robin/learning/study");
    setData((current) => current && { ...current, reviewChecks: result.reviewChecks ?? {} });
  }
  const done = data?.week.milestones.filter((item) => item.done).length ?? 0;
  const progress = data?.week.milestones.length ? done / data.week.milestones.length * 100 : 0;
  const today = now && localDate(now);
  const currentTime = now && `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const nextSession = today && currentTime && data && sessionOccurrences(data.sessions, today, addDays(today, 7))
    .filter(({ date, session }) => `${date}T${session.start}` >= `${today}T${currentTime}`)
    .sort((a, b) => `${a.date}T${a.session.start}`.localeCompare(`${b.date}T${b.session.start}`))[0];
  const errorRow = error && <p role="alert" className={styles.error}>{error === "read" ? (zh ? "暂时无法同步本周计划，请重试。" : "Could not sync this week's plan. Please retry.") : error} <button type="button" onClick={() => void refresh()}>{zh ? "重新载入" : "Reload"}</button></p>;
  if (!data || !draft) return <section className={styles.summary} role="status">{errorRow || (zh ? "正在载入本周学习…" : "Loading this week…")}</section>;

  return <>
  <div hidden={view !== "week"}><PythonReview week={today ? weekFor(today) : data.week.week} today={today} zh={zh} checks={data.reviewChecks ?? {}} onSave={saveReviewCheck} onReload={reloadReviewChecks} /></div>
  <section id="learning-week-view" className={styles.summary} aria-labelledby="study-week-title" hidden={view !== "week"}>
    <div className={styles.heading}><div><p className={styles.eyebrow}>{zh ? "本周回顾" : "WEEKLY REVIEW"} · {data.week.week}</p>
      <h2 id="study-week-title">{data.week.objective}</h2></div></div>
    {errorRow}
    {!error && <>
      <p className={styles.meta}>{zh ? `本周刷题记录 ${data.practiceDays} 天${data.todayPracticed ? " · 今天已记录" : ""} · 手动里程碑 ${done}/${data.week.milestones.length}` : `Practice logged on ${data.practiceDays} days${data.todayPracticed ? " · Today logged" : ""} · Manual milestones ${done}/${data.week.milestones.length}`}</p>
      <details className={styles.milestoneDetails}>
        <summary>{zh ? `查看里程碑 ${done}/${data.week.milestones.length}` : `View milestones ${done}/${data.week.milestones.length}`}</summary>
        <div className={styles.progress} role="progressbar" aria-label={zh ? "手动里程碑进度" : "Manual milestone progress"} aria-valuemin={0} aria-valuemax={data.week.milestones.length} aria-valuenow={done}><span style={{ width: `${progress}%` }} /></div>
        <ul className={styles.checklist}>{data.week.milestones.map((item, index) => <li key={item.id}>
          <label><input type="checkbox" checked={item.done} disabled={busy} onChange={() => toggleMilestone(index)} /><span data-done={item.done || undefined}>{item.title}</span></label>
        </li>)}</ul>
      </details>
    </>}
  </section>

  <section id="learning-planner-view" className={styles.planner} aria-labelledby="study-planner-title" hidden={view !== "planner"}>
    <header className={styles.plannerHead}><div><p className={styles.eyebrow}>{zh ? "本周规划" : "WEEKLY PLANNER"} · {data.week.week}</p><h2 id="study-planner-title">{zh ? "安排这一周" : "Shape your week"}</h2>
      <p className={styles.hint}>{zh ? "和 Buddy 讨论这周该学什么，确定目标，再安排练习与提醒。" : "Discuss what to learn with Buddy, then set your goals, study times and reminders."}</p></div>
      <button type="button" onClick={() => void refresh()} disabled={busy}>{zh ? "重新载入" : "Reload"}</button></header>
    {errorRow}
    <nav className={styles.mobilePaneSwitch} aria-label={zh ? "规划区切换" : "Planner panels"}>
      <button type="button" aria-pressed={mobilePane === "plan"} aria-controls="study-plan-fields study-reminder-fields" onClick={() => showMobilePane("plan", "study-decision-title")}>{zh ? "计划与提醒" : "Plan & reminders"}</button>
      <button type="button" aria-pressed={mobilePane === "buddy"} aria-controls="study-buddy-pane" onClick={() => showMobilePane("buddy", "study-buddy-pane")}>Planner Buddy</button>
    </nav>
    <div className={styles.planningColumns} data-mobile-pane={mobilePane}>
      <section id="study-plan-fields" className={styles.decision} aria-labelledby="study-decision-title">
        <div><p className={styles.eyebrow}>01 / {zh ? "目标" : "FOCUS"}</p><h3 id="study-decision-title" tabIndex={-1}>{zh ? "本周重点" : "This week's focus"}</h3></div>
        <label className={styles.field}>{zh ? "Weekly Objective · 本周目标" : "Weekly objective"}<input value={draft.objective} maxLength={160} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} /></label>
        <div className={styles.milestoneHeading}><span>{zh ? "里程碑" : "Milestones"}</span><span>{draft.milestones.length} / 5</span></div>
        <ol className={styles.milestones}>{draft.milestones.map((item, index) => <li key={item.id || index}>
          <label className={styles.milestoneName}><input type="checkbox" checked={item.done} aria-label={zh ? `完成里程碑 ${index + 1}：${item.title}` : `Complete milestone ${index + 1}: ${item.title}`} disabled={busy} onChange={() => setDraft({ ...draft, milestones: draft.milestones.map((m, i) => i === index ? { ...m, done: !m.done } : m) })} />
            <span>{String(index + 1).padStart(2, "0")}</span></label>
          <input value={item.title} maxLength={120} aria-label={zh ? `里程碑 ${index + 1} 内容` : `Milestone ${index + 1} description`}
            onChange={(event) => setDraft({ ...draft, milestones: draft.milestones.map((m, i) => i === index ? { ...m, title: event.target.value } : m) })} />
          <button type="button" aria-label={zh ? `移除里程碑 ${index + 1}` : `Remove milestone ${index + 1}`} disabled={draft.milestones.length === 1}
            onClick={() => setDraft({ ...draft, milestones: draft.milestones.filter((_, i) => i !== index) })}>×</button>
        </li>)}</ol>
        <button type="button" className={styles.addMilestone} disabled={draft.milestones.length >= 5} onClick={() => setDraft({ ...draft, milestones: [...draft.milestones, { id: `new-${Date.now()}`, title: "", done: false }] })}>{zh ? "＋ 添加里程碑" : "+ Add milestone"}</button>
        <div className={styles.decisionFooter}><p className={styles.hint}>{zh ? "仅保存后生效；勾选里程碑不等于完成课程。" : "Changes take effect only when saved. Ticking a milestone does not complete a course."}</p>
          <button type="button" className={styles.primary} disabled={busy || !draft.objective.trim() || draft.milestones.some((item) => !item.title.trim())} onClick={() => void saveWeek()}>{busy ? (zh ? "保存中…" : "Saving…") : (zh ? "确认本周计划" : "Confirm weekly plan")}</button></div>
      </section>
      <aside id="study-buddy-pane" className={styles.buddy} aria-label="Planner Buddy" data-chat-engaged={chatEngaged || undefined}
        onFocusCapture={(event) => { if (event.target instanceof HTMLTextAreaElement) setChatEngaged(true); }}>
        <p className={styles.eyebrow}>{zh ? "与你一起规划 · 对话记录" : "PLAN TOGETHER · CONVERSATION"}</p>
        <div className={styles.buddyChat}>
          <AgentPanel mode="planner" endpoint="/api/robin/learning/study/chat" transcriptKey="learning-planner"
            titleKey="learn.planner.buddy.title" emptyHintKey="learn.planner.buddy.empty"
            placeholderKey="learn.planner.buddy.placeholder" restartHintKey="learn.planner.buddy.restart"
            toolKeys={{}} requestBody={{ week: data.week.week }}
            getRequestBody={() => ({ draft: JSON.stringify(draft), schedule: JSON.stringify(sessions) })}
            replyAction={{ labelKey: "learn.planner.buddy.apply", onlyWithProposal: true, onReply: (_text, proposed) => adoptProposal(proposed) }} />
        </div>
        <div className={styles.buddyReminder}>
          <p className={styles.eyebrow}>{zh ? "下一次已保存的学习时段" : "NEXT SAVED STUDY SESSION"}</p>
          {nextSession ? <p><strong>{nextSession.session.title}</strong><span>{nextSession.date} · {nextSession.session.start}–{nextSession.session.end}</span></p>
            : <p className={styles.hint}>{zh ? "暂未安排接下来的学习时段。" : "No upcoming study sessions saved."}</p>}
          <div className={styles.reminderLinks}>
            {nextSession && <a href={nextSession.session.url} target={nextSession.session.url.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer">{zh ? "打开学习资源 ↗" : "Open study resource ↗"}</a>}
            <a href="#study-schedule-title" onClick={(event) => { event.preventDefault(); showMobilePane("plan", "study-schedule-title", true); }}>{zh ? "设置或调整提醒 ↓" : "Set or adjust reminders ↓"}</a>
          </div>
          <small>{zh ? "到点弹窗需保持 Robin 打开；遇到会议或已记录刷题，默认刷题提醒会让路。" : "Keep Robin open for on-screen reminders. The default practice reminder yields to meetings or logged attempts."}</small>
        </div>
      </aside>
    <section id="study-reminder-fields" className={styles.schedule} aria-labelledby="study-schedule-title"><div className={styles.scheduleHead}><div><p className={styles.eyebrow}>02 / {zh ? "安排" : "SCHEDULE"}</p><h3 id="study-schedule-title" tabIndex={-1}>{zh ? "学习日程与到点提醒" : "Study sessions & reminders"}</h3></div><span className={styles.meta}>{zh ? `${sessions.length} 个学习时段` : `${sessions.length} sessions`}</span></div>
      <p className={styles.hint}>{zh ? "仅在 Robin 页面打开时弹窗；现有日程冲突会让默认刷题提醒让路。打开资源不等于完成。" : "On-screen reminders need Robin open. The default practice session yields to a calendar conflict; opening a link is not completion."}</p>
      <div className={styles.sessionList}>{sessions.map((session) => <div className={styles.session} key={session.id}>
        <div className={styles.sessionHead}><label className={styles.field}>{zh ? "学习任务" : "Session name"}<input maxLength={100} value={session.title} onChange={(event) => updateSession(session.id, { title: event.target.value })} /></label>
          <label className={styles.switch}><input type="checkbox" checked={session.enabled} onChange={(event) => updateSession(session.id, { enabled: event.target.checked })} />{zh ? "启用提醒" : "Reminder on"}</label></div>
        <fieldset className={styles.days}><legend>{zh ? "每周哪几天" : "Days of the week"}</legend><div>{[1, 2, 3, 4, 5, 6, 0].map((day) => <label key={day}><input type="checkbox" checked={session.days.includes(day)} onChange={(event) => updateSession(session.id, { days: event.target.checked ? [...session.days, day] : session.days.filter((d) => d !== day) })} />{(zh ? ["日", "一", "二", "三", "四", "五", "六"] : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"])[day]}</label>)}</div></fieldset>
        <div className={styles.scheduleFields}><label className={styles.field}>{zh ? "开始时间" : "Starts"}<input type="time" value={session.start} onChange={(event) => updateSession(session.id, { start: event.target.value })} /></label>
          <label className={styles.field}>{zh ? "结束时间" : "Ends"}<input type="time" value={session.end} onChange={(event) => updateSession(session.id, { end: event.target.value })} /></label>
          <label className={styles.field}>{zh ? "起始日期" : "From date"}<input type="date" value={session.since ?? ""} onChange={(event) => updateSession(session.id, { since: event.target.value || undefined })} /></label>
          <label className={styles.field}>{zh ? "截止日期" : "Until date"}<input type="date" value={session.until ?? ""} onChange={(event) => updateSession(session.id, { until: event.target.value || undefined })} /></label></div>
        <label className={styles.field}>{zh ? "学习链接（打开后不会自动标为完成）" : "Study URL (opening does not mark done)"}<input type="url" maxLength={500} value={session.url} onChange={(event) => updateSession(session.id, { url: event.target.value })} /></label>
        <button type="button" className={styles.remove} onClick={() => setSessions((previous) => previous.filter((item) => item.id !== session.id))}>{zh ? "移除此时段" : "Remove session"}</button>
      </div>)}</div>
      <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setSessions([...sessions, { id: `session-${Date.now()}`, title: zh ? "课程学习" : "Course study", days: [1, 2, 3, 4, 5], start: "19:00", end: "20:00", url: PYTHON_URL, enabled: false }])} disabled={sessions.length >= 12}>{zh ? "＋ 添加学习时段" : "+ Study session"}</button>
        <button type="button" className={styles.primary} onClick={() => void saveSessions()} disabled={busy}>{zh ? "保存学习日程" : "Save study sessions"}</button></div>
    </section>
    </div>
  </section>
  </>;
}
