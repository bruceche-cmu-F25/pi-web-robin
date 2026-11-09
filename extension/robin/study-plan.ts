import { addDays, startOfWeek } from "./dates.ts";

export interface StudyMilestone { id: string; title: string; done: boolean }
export interface StudyWeek { week: string; objective: string; milestones: StudyMilestone[]; updatedAt: string }
export interface StudySession { id: string; title: string; days: number[]; start: string; end: string; url: string; enabled: boolean; since?: string; until?: string }
export interface PythonReviewCheck { checked: boolean; revision: string; checkedAt?: string }
export interface StudyPlan { weeks: Record<string, StudyWeek>; sessions: StudySession[]; reviewChecks?: Record<string, PythonReviewCheck>; reviews?: Record<string, unknown> }

export const LEETCODE_URL = "https://leetcode.com/problem-list/xi4ci4ig/";
export const BACKEND_URL = "https://www.freecodecamp.org/learn/back-end-development-and-apis-v9/";
export const PYTHON_URL = "https://www.freecodecamp.org/learn/python-v9/";
export const DEFAULT_SESSIONS: StudySession[] = [{ id: "leetcode", title: "每天一道 LeetCode", days: [0, 1, 2, 3, 4, 5, 6], start: "10:00", end: "11:00", url: LEETCODE_URL, enabled: true, since: "2026-11-03", until: "2026-12-31" }];

export function weekFor(date: string): string { return startOfWeek(date); }
export function defaultWeek(date: string): StudyWeek {
  const week = weekFor(date);
  const python = week < "2026-11-23";
  const transition = week === "2026-11-23";
  const afterGoal = week > "2026-12-28";
  const objective = afterGoal ? "回顾上一阶段，为本周设定新的学习目标" : python ? "复习 Python 核心知识，每天练一道题" : transition ? "完成 Python 复习，开始后端 V9" : "推进 freeCodeCamp 后端 V9，每天练一道题";
  return { week, objective, updatedAt: "", milestones: [
    { id: "learn", title: afterGoal ? "确定本周的学习主题" : python ? "完成本周 Python 练习" : transition ? "完成 Python 复习并启动后端 V9" : "完成本周后端课程练习", done: false },
    { id: "practice", title: afterGoal ? "安排适合自己的刷题频率" : "每天记录一道 LeetCode 的尝试", done: false },
    { id: "review", title: "周末复盘卡点并调整下周计划", done: false },
  ] };
}
export function sessionOccurrences(sessions: readonly StudySession[], from: string, to: string) {
  const result: Array<{ session: StudySession; date: string }> = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = new Date(`${date}T12:00:00`).getDay();
    for (const session of sessions) if (session.enabled && (!session.since || date >= session.since) && (!session.until || date <= session.until) && session.days.includes(day)) result.push({ session, date });
  }
  return result;
}

/** The event's start is a local wall-clock value, like the dashboard calendar. */
export function dueStudySession(sessions: readonly StudySession[], now: Date, acknowledgements: Record<string, number>) {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const minute = now.getHours() * 60 + now.getMinutes();
  return sessionOccurrences(sessions, date, date).find(({ session }) => {
    const start = Number(session.start.slice(0, 2)) * 60 + Number(session.start.slice(3));
    const key = `${date}:${session.id}:${session.start}`;
    // A sleeping tab can catch up briefly; never interrupt hours after the block.
    return minute >= start && minute < start + 30 && (!acknowledgements[key] || acknowledgements[key] <= now.getTime());
  }) ?? null;
}

export function safeStudyLink(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
