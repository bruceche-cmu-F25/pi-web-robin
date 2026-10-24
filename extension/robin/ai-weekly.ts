/** Client-safe vocabulary and calendar rules for the seven-day AI briefing. */
export type WeeklyLane = "practical" | "world";
export const WEEKLY_LANES: WeeklyLane[] = ["practical", "world", "practical", "world", "practical", "world", "practical"];
export interface WeeklyPreferences {
  enabled: boolean;
  timezone: string;
  at: string;
  telegram: boolean;
  interests: string;
}
export interface WeeklySource {
  url: string;
  title: string;
  publishedOn: string;
  quote: string;
  dateQuote: string;
  checkedAt: string;
}
export interface WeeklyCandidate {
  key: string;
  lane: WeeklyLane;
  title: string;
  eventDate: string;
  status: "available" | "announced" | "research" | "reported";
  source: WeeklySource;
}
export interface WeeklyStory extends WeeklyCandidate {
  what: string;
  why: string;
  action: string;
  caveat: string;
}
export interface WeeklySlot { date: string; lane: WeeklyLane; story: WeeklyStory | null }
export interface WeeklyEdition {
  week: string;
  from: string;
  through: string;
  createdAt: string;
  headline: string;
  slots: WeeklySlot[];
  gaps: string[];
  ignored: string[];
}
export interface WeeklyRun {
  id: string;
  week: string;
  startedAt: string;
  finishedAt?: string;
  stage: "harvest" | "verify" | "brief" | "done" | "failed";
  error?: string;
  retryAt?: string;
  sessions: string[];
  candidates?: number;
  verified?: number;
}
export interface WeeklyDelivery {
  key: string;
  date: string;
  status: "pending" | "sent" | "failed" | "uncertain";
  at: string;
  attempts: number;
  retryAt?: string;
  error?: string;
}
export interface WeeklyView {
  preferences: WeeklyPreferences;
  today: string;
  week: string;
  edition: WeeklyEdition | null;
  archive: { week: string; headline: string }[];
  run: WeeklyRun | null;
  running: boolean;
  interrupted: boolean;
  read: string[];
  deliveries: WeeklyDelivery[];
  telegramReady: boolean;
}
export function calendarDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function shiftDay(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
/** Calendar arithmetic, not elapsed 24-hour windows: DST does not shift a slot. */
export function weeklyClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const week = shiftDay(today, -((weekday + 6) % 7));
  return { today, week, time: `${part("hour")}:${part("minute")}`, from: shiftDay(week, -7), through: shiftDay(week, -1) };
}
export function weeklyStoryId(edition: WeeklyEdition, slot: WeeklySlot): string {
  return `${edition.week}:${slot.date}`;
}
