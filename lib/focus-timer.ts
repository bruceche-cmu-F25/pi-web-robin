export const FOCUS_TIMER_KEY = "pi-web:focus-timer:v1";
export const MAX_FOCUS_MINUTES = 180;
export const MAX_BREAK_MINUTES = 60;

export const FOCUS_PRESETS = [[25, 5], [50, 10], [90, 15]] as const;

/** Focus time actually spent on one local calendar day. */
export interface FocusDay {
  day: string;
  rounds: number;
  focusMs: number;
}

export interface FocusTimerState {
  version: 1;
  focusMinutes: number;
  breakMinutes: number;
  sound: boolean;
  phase: "focus" | "break";
  status: "idle" | "running" | "paused" | "complete";
  endsAt: number | null;
  remainingMs: number;
  /** Length the current phase started with; settings edits apply to the next one. */
  phaseMs: number;
  today: FocusDay;
}

const NO_FOCUS: FocusDay = { day: "", rounds: 0, focusMs: 0 };

export const DEFAULT_FOCUS_TIMER: FocusTimerState = {
  version: 1, focusMinutes: 25, breakMinutes: 5, sound: true,
  phase: "focus", status: "idle", endsAt: null, remainingMs: 25 * 60_000,
  phaseMs: 25 * 60_000, today: NO_FOCUS,
};

export function validMinutes(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

export function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDay(value: unknown): FocusDay {
  const d = value as Partial<FocusDay> | null;
  return d && typeof d.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.day)
    && Number.isSafeInteger(d.rounds) && d.rounds! >= 0
    && Number.isFinite(d.focusMs) && d.focusMs! >= 0
    ? { day: d.day, rounds: d.rounds!, focusMs: d.focusMs! } : NO_FOCUS;
}

/** What today's record says at `now`; yesterday's record reads as empty. */
export function todayFocus(s: FocusTimerState, now: number): FocusDay {
  const day = localDay(now);
  return s.today.day === day ? s.today : { ...NO_FOCUS, day };
}

function credit(s: FocusTimerState, now: number, rounds: number, focusMs: number): FocusDay {
  const today = todayFocus(s, now);
  return { day: today.day, rounds: today.rounds + rounds, focusMs: today.focusMs + Math.max(0, focusMs) };
}

/** Storage is user-controlled; malformed or old snapshots start safely at idle. */
export function parseFocusTimer(raw: string | null): FocusTimerState {
  try {
    const s = JSON.parse(raw ?? "null");
    if (!s || s.version !== 1
      || !validMinutes(s.focusMinutes, MAX_FOCUS_MINUTES)
      || !validMinutes(s.breakMinutes, MAX_BREAK_MINUTES)
      || typeof s.sound !== "boolean"
      || !["focus", "break"].includes(s.phase)
      || !["idle", "running", "paused", "complete"].includes(s.status)
      || !Number.isFinite(s.remainingMs) || s.remainingMs < 0 || s.remainingMs > MAX_FOCUS_MINUTES * 60_000
      || (s.status === "running"
        ? !Number.isSafeInteger(s.endsAt) || s.endsAt <= 0
        : s.endsAt !== null)) return DEFAULT_FOCUS_TIMER;
    // Snapshots written before phaseMs/today existed are still valid timers.
    const phaseMs = Number.isFinite(s.phaseMs) && s.phaseMs > 0 && s.phaseMs <= MAX_FOCUS_MINUTES * 60_000
      ? s.phaseMs : s.remainingMs;
    return { version: 1, focusMinutes: s.focusMinutes, breakMinutes: s.breakMinutes,
      sound: s.sound, phase: s.phase, status: s.status, endsAt: s.endsAt, remainingMs: s.remainingMs,
      phaseMs, today: parseDay(s.today) };
  } catch {
    return DEFAULT_FOCUS_TIMER;
  }
}

export function focusRemaining(s: FocusTimerState, now: number): number {
  if (s.status === "idle") return s.focusMinutes * 60_000;
  if (s.status === "complete") return 0;
  return s.status === "running" ? Math.max(0, s.endsAt! - now) : s.remainingMs;
}

export function formatFocusTime(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export type FocusTimerAction =
  | { type: "start"; phase: "focus" | "break" }
  | { type: "pause" | "resume" | "end" | "expire" }
  | { type: "settings"; focusMinutes?: number; breakMinutes?: number; sound?: boolean };

/**
 * Explicit transitions only: finishing a phase never starts another one.
 * A finished focus phase counts as a round; ending one early still records
 * the minutes actually spent, but not a round.
 */
export function changeFocusTimer(s: FocusTimerState, action: FocusTimerAction, now: number): FocusTimerState {
  if (action.type === "settings") {
    return { ...s,
      focusMinutes: action.focusMinutes !== undefined && validMinutes(action.focusMinutes, MAX_FOCUS_MINUTES) ? action.focusMinutes : s.focusMinutes,
      breakMinutes: action.breakMinutes !== undefined && validMinutes(action.breakMinutes, MAX_BREAK_MINUTES) ? action.breakMinutes : s.breakMinutes,
      sound: action.sound ?? s.sound,
    };
  }
  if (action.type === "end") {
    const spent = s.phase === "focus" && (s.status === "running" || s.status === "paused")
      ? s.phaseMs - focusRemaining(s, now) : 0;
    return { ...s, phase: "focus", status: "idle", endsAt: null, remainingMs: s.focusMinutes * 60_000,
      phaseMs: s.focusMinutes * 60_000, today: spent > 0 ? credit(s, now, 0, spent) : s.today };
  }
  if (action.type === "start" && (s.status === "idle" || s.status === "complete")) {
    const remainingMs = (action.phase === "focus" ? s.focusMinutes : s.breakMinutes) * 60_000;
    return { ...s, phase: action.phase, status: "running", remainingMs, phaseMs: remainingMs, endsAt: now + remainingMs };
  }
  const remainingMs = focusRemaining(s, now);
  if (s.status === "running" && remainingMs === 0) {
    return { ...s, status: "complete", endsAt: null, remainingMs: 0,
      // Credit the day the round ended on, even if a sleeping tab notices later.
      today: s.phase === "focus" ? credit(s, s.endsAt!, 1, s.phaseMs) : s.today };
  }
  if (action.type === "pause" && s.status === "running") return { ...s, status: "paused", remainingMs, endsAt: null };
  if (action.type === "resume" && s.status === "paused") return { ...s, status: "running", endsAt: now + remainingMs };
  return s;
}
