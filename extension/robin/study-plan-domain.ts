import { randomUUID } from "node:crypto";
import { addDays, localDate, parseLocalDate } from "./dates.ts";
import { attemptDay } from "./practice.ts";
import { readPracticeRecords } from "./store.ts";
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { DEFAULT_SESSIONS, defaultWeek, safeStudyLink, sessionOccurrences, weekFor, type StudyMilestone, type StudyPlan, type StudySession, type StudyWeek, type PythonReviewCheck } from "./study-plan.ts";

const FILE = "study-plan.json";
const empty = (): StudyPlan => ({ weeks: {}, sessions: DEFAULT_SESSIONS });
function checked(value: StudyPlan | null): StudyPlan {
  if (!value) return empty();
  if (!value.weeks || typeof value.weeks !== "object" || !Array.isArray(value.sessions) ||
    (value.reviews !== undefined && (!value.reviews || typeof value.reviews !== "object" || Array.isArray(value.reviews))) ||
    (value.reviewChecks !== undefined && (!value.reviewChecks || typeof value.reviewChecks !== "object" || Array.isArray(value.reviewChecks)))) throw new Error("Invalid study plan");
  return value;
}
export function readStudyPlan(date = localDate()) {
  parseLocalDate(date);
  const state = checked(readJsonObject<StudyPlan>(FILE));
  const week = weekFor(date);
  const attempts = readPracticeRecords().flatMap((record) => record.attempts.map((attempt) => ({ slug: record.slug, day: attemptDay(attempt) })));
  const days = [...new Set(attempts.filter((item) => item.day >= week && item.day <= addDays(week, 6)).map((item) => item.day))];
  return { week: state.weeks[week] ?? defaultWeek(date), sessions: state.sessions, reviewChecks: state.reviewChecks ?? {}, practiceDays: days.length, todayPracticed: days.includes(date), attemptsThisWeek: attempts.filter((item) => item.day >= week && item.day <= addDays(week, 6)).length };
}
function text(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${label} must be 1–${max} characters`);
  return value.trim();
}
function checkWeek(input: unknown, week: string): Pick<StudyWeek, "objective" | "milestones"> {
  if (!input || typeof input !== "object") throw new Error("Invalid week");
  const draft = input as { objective?: unknown; milestones?: unknown };
  const objective = text(draft.objective, 160, "objective");
  if (!Array.isArray(draft.milestones) || draft.milestones.length < 1 || draft.milestones.length > 5) throw new Error("Use 1–5 milestones");
  const milestones: StudyMilestone[] = draft.milestones.map((item, index) => ({
    id: `${week}:${index}`, title: text(item?.title, 120, "milestone"), done: item?.done === true,
  }));
  return { objective, milestones };
}
export function saveStudyWeek(date: string, input: unknown, expected: unknown): StudyWeek {
  parseLocalDate(date);
  if (typeof expected !== "string") throw new Error("Expected revision is required");
  const week = weekFor(date);
  const checkedInput = checkWeek(input, week);
  return updateJsonObject<StudyPlan, StudyWeek>(FILE, (value) => {
    const state = checked(value);
    const current = state.weeks[week] ?? defaultWeek(date);
    if (current.updatedAt !== expected) throw new Error("Study plan changed; reload and try again");
    const saved: StudyWeek = { week, ...checkedInput, updatedAt: new Date().toISOString() };
    return { value: { ...state, weeks: { ...state.weeks, [week]: saved } }, result: saved, changed: true };
  });
}
export function savePythonReviewCheck(date: unknown, isChecked: unknown, expected: unknown): PythonReviewCheck {
  if (typeof date !== "string") throw new Error("Review date is required");
  parseLocalDate(date);
  if (date < "2026-11-04" || date > "2026-11-22" || date > localDate()) throw new Error("Review is not available for this date");
  if (typeof isChecked !== "boolean") throw new Error("Checked must be a boolean");
  if (typeof expected !== "string") throw new Error("Expected revision is required");
  return updateJsonObject<StudyPlan, PythonReviewCheck>(FILE, (value) => {
    const state = checked(value);
    const previous = state.reviewChecks?.[date];
    if (previous && (typeof previous.revision !== "string" || typeof previous.checked !== "boolean")) throw new Error("Invalid review check");
    if ((previous?.revision ?? "") !== expected) throw new Error("Review changed; reload and try again");
    if (!previous && !isChecked) return { value: state, result: { checked: false, revision: "" }, changed: false };
    if (previous?.checked === isChecked) return { value: state, result: previous, changed: false };
    const progress: PythonReviewCheck = { checked: isChecked, revision: randomUUID(), ...(isChecked ? { checkedAt: new Date().toISOString() } : {}) };
    return { value: { ...state, reviewChecks: { ...state.reviewChecks, [date]: progress } }, result: progress, changed: true };
  });
}

export function saveStudySessions(input: unknown): StudySession[] {
  if (!Array.isArray(input) || input.length > 12) throw new Error("Use at most 12 study sessions");
  const seen = new Set<string>();
  const sessions = input.map((item): StudySession => {
    const id = text(item?.id, 40, "id");
    if (seen.has(id)) throw new Error("Duplicate study session");
    seen.add(id);
    const title = text(item.title, 100, "title"), url = text(item.url, 500, "url");
    if (!safeStudyLink(url)) throw new Error("Study link must be an HTTPS or in-app path");
    const start = text(item.start, 5, "start"), end = text(item.end, 5, "end");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) throw new Error("Invalid study time");
    if (!Array.isArray(item.days) || !item.days.length || item.days.length > 7 || item.days.some((day: unknown) => typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Invalid weekdays");
    for (const field of ["since", "until"] as const) if (item[field] !== undefined) {
      if (typeof item[field] !== "string") throw new Error(`${field} must be a date`);
      parseLocalDate(item[field]);
    }
    if (item.since && item.until && item.until < item.since) throw new Error("Study session end precedes start");
    return { id, title, url, start, end, days: [...new Set(item.days as number[])], enabled: item.enabled === true,
      ...(item.since ? { since: item.since as string } : {}), ...(item.until ? { until: item.until as string } : {}) };
  });
  return updateJsonObject<StudyPlan, StudySession[]>(FILE, (value) => ({ value: { ...checked(value), sessions }, result: sessions, changed: true }));
}
/** Study appointments are projections, not local event copies; they never imply attendance. */
export function studyEvents(from: string, to: string) {
  parseLocalDate(from); parseLocalDate(to);
  if (to < from || to > addDays(from, 366)) throw new Error("Invalid study range");
  return sessionOccurrences(checked(readJsonObject<StudyPlan>(FILE)).sessions, from, to).map(({ session, date }) => ({
    id: `study:${session.id}:${date}`, title: session.title, date, start: session.start, end: session.end,
    url: session.url, source: "study" as const, createdAt: "1970-01-01T00:00:00.000Z",
  }));
}
