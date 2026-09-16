/**
 * The hiring-round model: every online assessment and interview that arrives
 * by email, kept in one list ordered by when it is due.
 *
 * A round is the unit a hiring process is made of — "the Salesforce OA", "the
 * Claude Corps first-round call". The mail review sees them one day at a time
 * and the todo list only keeps a completed task for a week, so neither can
 * answer "how many OAs do I still owe, and when is each due". This can.
 *
 * Client-safe: no `node:fs` here, so the page imports the types and the
 * grouping directly while the store stays server-only in ./round-domain.ts.
 */
import { localDate } from "./dates.ts";

export const ROUND_KINDS = ["oa", "interview"] as const;
export type RoundKind = (typeof ROUND_KINDS)[number];

/**
 * `open` until you say otherwise. An OA past its deadline stays open and
 * shows as overdue rather than closing itself: only you know whether you
 * sent it in at the last minute.
 */
export const ROUND_STATUSES = ["open", "done", "missed", "cancelled"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

export interface Round {
  id: string;
  kind: RoundKind;
  company: string;
  /** The position, when the email names one. */
  role?: string;
  /**
   * OA: the deadline. Interview: when it starts. A UTC ISO instant when the
   * email gives a time, a local YYYY-MM-DD when it gives only a day.
   */
  due?: string;
  /** Platform, length, conditions — "HackerRank · 90 min · camera on". */
  detail?: string;
  /** The Gmail thread it came from: the page links back to it, and repeat mail dedupes on it. */
  threadId?: string;
  /** The todo for the same round, so ticking either one closes both. */
  todoId?: string;
  status: RoundStatus;
  /** UTC instant, ISO 8601. */
  createdAt: string;
  /** UTC instant, ISO 8601. */
  updatedAt: string;
  /** UTC instant the round left `open`. */
  closedAt?: string;
}

/** What a caller may say about a round; everything but kind and company is optional. */
export interface RoundInput {
  kind: string;
  company: string;
  role?: string;
  due?: string;
  detail?: string;
  threadId?: string;
}

export function isRoundKind(value: unknown): value is RoundKind {
  return typeof value === "string" && (ROUND_KINDS as readonly string[]).includes(value);
}

export function isRoundStatus(value: unknown): value is RoundStatus {
  return typeof value === "string" && (ROUND_STATUSES as readonly string[]).includes(value);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A day stays a day; anything with a time becomes a UTC instant.
 *
 * A local "2026-09-21T08:28" is read in this process's timezone, which is the
 * user's — the same rule the todo store uses for due dates.
 */
export function normalizeWhen(value: string): string {
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      throw new Error(`Cannot read "${value}" as a date`);
    }
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Cannot read "${value}" as a date or time`);
  return parsed.toISOString();
}

export function hasTime(due: string | undefined): boolean {
  return Boolean(due && !DATE_ONLY.test(due));
}

/** The local calendar day a round falls on. */
export function roundDay(due: string | undefined): string | undefined {
  if (!due) return undefined;
  return DATE_ONLY.test(due) ? due : localDate(new Date(due));
}

/**
 * The moment a round is due, for ordering and countdowns. A deadline given
 * only as a day runs to the end of it; an interview given only as a day sorts
 * at its start.
 */
export function dueAt(round: Pick<Round, "kind" | "due">): number | null {
  if (!round.due) return null;
  if (!DATE_ONLY.test(round.due)) {
    const at = Date.parse(round.due);
    return Number.isNaN(at) ? null : at;
  }
  const [year, month, day] = round.due.split("-").map(Number);
  return round.kind === "oa"
    ? new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
    : new Date(year, month - 1, day).getTime();
}

/** "Salesforce, Inc." and "salesforce" are one company. */
export function companyKey(company: string): string {
  return company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company)\b\.?/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Whether new mail describes a round already on the list.
 *
 * The same thread is always the same round. Beyond that, one company's open
 * OA is one round however many reminder emails it sends, unless the two carry
 * different due days — a second interview is a second round.
 */
export function isSameRound(round: Round, input: { kind: RoundKind; company: string; due?: string; threadId?: string }): boolean {
  if (round.kind !== input.kind) return false;
  if (input.threadId && round.threadId === input.threadId) return true;
  if (round.status !== "open") return false;
  if (companyKey(round.company) !== companyKey(input.company)) return false;
  const a = roundDay(round.due);
  const b = roundDay(input.due);
  return !a || !b || a === b;
}

/** How long past its start an interview still counts as today's business. */
const INTERVIEW_GRACE_MS = 2 * 60 * 60 * 1_000;

export interface Docket {
  /** Open OAs, soonest deadline first; ones without a deadline last. */
  assessments: Round[];
  /** Open interviews that have not happened yet, soonest first. */
  interviews: Round[];
  /** Everything settled or past, most recent first. */
  history: Round[];
}

/** The page's three lists. */
export function docket(rounds: Round[], now: number = Date.now()): Docket {
  const assessments: Round[] = [];
  const interviews: Round[] = [];
  const history: Round[] = [];
  for (const round of rounds) {
    if (round.status !== "open") history.push(round);
    else if (round.kind === "oa") assessments.push(round);
    else {
      const at = dueAt(round);
      if (at !== null && at + INTERVIEW_GRACE_MS < now) history.push(round);
      else interviews.push(round);
    }
  }
  const soonest = (a: Round, b: Round) => (dueAt(a) ?? Infinity) - (dueAt(b) ?? Infinity);
  assessments.sort(soonest);
  interviews.sort(soonest);
  const recent = (round: Round) => Date.parse(round.closedAt ?? "") || dueAt(round) || Date.parse(round.createdAt) || 0;
  history.sort((a, b) => recent(b) - recent(a));
  return { assessments, interviews, history };
}

/** Open OAs due within `withinMs`, or already overdue — what the nav badge counts. */
export function pressingAssessments(rounds: Round[], now: number = Date.now(), withinMs = 48 * 60 * 60 * 1_000): number {
  return rounds.filter((round) => {
    if (round.kind !== "oa" || round.status !== "open") return false;
    const at = dueAt(round);
    return at !== null && at - now <= withinMs;
  }).length;
}
