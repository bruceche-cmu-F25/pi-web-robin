/** Shared deployment gate; no reads, writes, network, secrets or scheduler of its own. */
import { addDays, localDate } from "./dates.ts";
import { validBriefDay } from "./brief.ts";
export interface BriefSchedule { time: string; startDate: string; mailOnly?: boolean; morningDaily?: boolean; startAt?: number; timezone?: string }
export function briefSchedule(env: NodeJS.ProcessEnv = process.env): BriefSchedule | undefined {
  if (env.ROBIN_BRIEF_ENABLED !== "1") return undefined;
  if (env.ROBIN_BRIEF_ALLOW_PRIVATE_MODEL !== "1" || env.ROBIN_BRIEF_REPLACE_LEGACY !== "1") {
    throw new Error("Brief automation requires explicit private-model and legacy-handoff consent");
  }
  const time = env.ROBIN_BRIEF_TIME ?? "08:00", startDate = env.ROBIN_BRIEF_START ?? "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !validBriefDay(startDate)) throw new Error("Brief requires HH:MM and an explicit YYYY-MM-DD start date");
  if (env.ROBIN_BRIEF_MODE === "mail") {
    const startAt = Date.parse(env.ROBIN_BRIEF_START_AT ?? "");
    if (!Number.isFinite(startAt)) throw new Error("Twice-daily mail requires an explicit first boundary");
    const timezone = env.ROBIN_BRIEF_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone) throw new Error("Mail schedule timezone differs from server local timezone");
    return { time: "08:00", startDate, mailOnly: true, morningDaily: env.ROBIN_BRIEF_MORNING_DAILY === "1", startAt, timezone };
  }
  return { time, startDate };
}
export function briefScheduleActive(schedule: BriefSchedule | undefined, now = Date.now()): boolean {
  return Boolean(schedule && localDate(new Date(now)) >= schedule.startDate);
}
/** Local delivery boundaries with a rolling 48-hour lookback, including across DST. */
export function dueMailWindow(schedule: BriefSchedule, now = Date.now()) {
  if (!briefScheduleActive(schedule, now)) return null;
  const day = localDate(new Date(now));
  const time = ["18:00", "08:00"].find(t => new Date(`${day}T${t}:00`).getTime() <= now);
  if (!time) return null;
  const to = new Date(`${day}T${time}:00`).getTime();
  if (to < (schedule.startAt ?? 0)) return null;
  const from = to - 48 * 3600_000;
  const expiresAt = new Date(time === "08:00" ? `${day}T18:00:00` : `${addDays(day, 1)}T00:00:00`).getTime();
  return { day, time, from: new Date(from).toISOString(), to: new Date(to).toISOString(), expiresAt };
}
export function briefScheduleDue(schedule: BriefSchedule | undefined, now = Date.now()): boolean {
  if (schedule?.mailOnly) return Boolean(dueMailWindow(schedule, now));
  const date = new Date(now), clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return briefScheduleActive(schedule, now) && clock >= schedule!.time;
}
