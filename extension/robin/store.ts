/**
 * File-backed stores for the Robin dashboard.
 *
 * Server-only: this module reaches `node:fs` through ./paths.ts, so it must
 * never be imported for its *values* by a client component. Pure logic the
 * browser also needs lives in ./dates.ts and ./links.ts; importing a `type`
 * from here is fine, since type imports are erased.
 *
 * Deliberately dependency-free: extensions are loaded by jiti with a fixed
 * alias map (pi SDK packages + typebox only), so anything else would have to be
 * installed separately.
 */
import { localDate } from "./dates.ts";
import type { CalendarEvent } from "./events.ts";
import type { MailReview } from "./mail.ts";
import { DEFAULT_JOB_PROFILE, type Job, type JobProfile } from "./jobs.ts";
import type { Link } from "./links.ts";
import type { PracticeList, PracticeRecord } from "./practice.ts";
import type { TechEvent, TechEventScanState } from "./tech-events.ts";
import { createDeliveryLedger } from "./delivery-ledger.ts";
import {
  dataPath,
  readJsonArray,
  readJsonObject,
  updateJsonArray,
  updateJsonObject,
  writeJsonArray,
  writeJsonObject,
} from "./paths.ts";

export type { DeliveryLedger } from "./delivery-ledger.ts";

export { addDays, dueBucket, localDate, normalizeDue, parseLocalDate, type DueBucket } from "./dates.ts";
export {
  compareEvents,
  eventsInRange,
  formatEventTime,
  groupEventsByDate,
  normalizeTime,
  type CalendarEvent,
} from "./events.ts";
export { groupLinks, iconFallback, normalizeUrl, reorderLinkGroups, type Link } from "./links.ts";
export {
  TECH_EVENT_TOPICS,
  hasPassed,
  isScanDue,
  mergeTechEvents,
  sortTechEvents,
  type TechEvent,
  type TechEventScanState,
  type TechEventTopic,
} from "./tech-events.ts";
export { inferTodoUrl, todoUrl } from "./todo-links.ts";
export {
  NEETCODE_CATALOG,
  PATTERN_ORDER,
  dueForReview,
  emptyRecord,
  findProblem,
  problemsInList,
  recordMap,
  reviewDateFor,
  statsFor,
  suggestNext,
  type Attempt,
  type AttemptOutcome,
  type CatalogProblem,
  type PracticeList,
  type PracticeRecord,
  type PracticeStatus,
} from "./practice.ts";
export {
  DEFAULT_JOB_PROFILE,
  EXCLUDE_PRESETS,
  JOB_STATUSES,
  LOCATION_PRESETS,
  STARTER_COMPANIES,
  TITLE_PRESETS,
  digestCandidates,
  formatJob,
  formatJobDigest,
  jobKey,
  pendingJobs,
  sortJobs,
  type Job,
  type JobProfile,
  type JobStatus,
  type TrackedCompany,
} from "./jobs.ts";
export { dataDir, newId } from "./paths.ts";

const LINKS_FILE = "links.json";
const EVENTS_FILE = "events.json";
const TECH_EVENTS_FILE = "tech-events.json";
const TECH_EVENT_SCAN_FILE = "tech-event-scan.json";
const ASSISTANT_FILE = "assistant.json";
const TELEGRAM_STATE_FILE = "telegram-state.json";
const JOBS_FILE = "jobs.json";
const JOB_PROFILE_FILE = "job-profile.json";
const JOB_SCAN_FILE = "job-scan.json";
const JOB_DIGEST_STATE_FILE = "job-digest-state.json";
const GMAIL_DIGEST_STATE_FILE = "gmail-digest-state.json";
const MAIL_REVIEW_FILE = "mail-review.json";
const REMINDER_STATE_FILE = "reminder-state.json";
const PRACTICE_FILE = "practice.json";
const PRACTICE_STATE_FILE = "practice-state.json";
const STUDY_STATE_FILE = "study-state.json";

/**
 * Which chats have already received which run, per feed.
 *
 * One shape for all four: the daily agenda, the job digest (morning/evening/
 * sweep share one ledger), the email digest, and event reminders. The bridge
 * and its tests build in-memory adapters of the same `DeliveryLedger`
 * interface.
 *
 * The reminder ledger is keyed by event rather than by time of day, so its
 * history turns over much faster than the others — see the trimming in
 * delivery-ledger.ts, which keeps only the most recent keys.
 */
export const dailyAgendaLedger = createDeliveryLedger(TELEGRAM_STATE_FILE);
export const jobLedger = createDeliveryLedger(JOB_DIGEST_STATE_FILE);
export const gmailLedger = createDeliveryLedger(GMAIL_DIGEST_STATE_FILE);
export const reminderLedger = createDeliveryLedger(REMINDER_STATE_FILE);
const JOB_SWEEP_FILE = "job-sweep.json";
const JOB_SCORING_FILE = "job-scoring.json";

export function linksPath(): string {
  return dataPath(LINKS_FILE);
}

export function readLinks(): Link[] {
  return readJsonArray<Link>(LINKS_FILE);
}

export function writeLinks(links: Link[]): void {
  writeJsonArray(LINKS_FILE, links);
}

export function updateLinks<R>(updater: (links: Link[]) => { value: R; changed: boolean }): R {
  return updateJsonArray(LINKS_FILE, updater);
}

export function eventsPath(): string {
  return dataPath(EVENTS_FILE);
}

export function readEvents(): CalendarEvent[] {
  return readJsonArray<CalendarEvent>(EVENTS_FILE);
}

export function writeEvents(events: CalendarEvent[]): void {
  writeJsonArray(EVENTS_FILE, events);
}

/**
 * Bay Area AI and software-engineering events, scraped weekly.
 *
 * A separate file from the calendar above, and deliberately so: these are
 * public events nobody has committed to, written by a scanner and pruned by
 * it. The calendar is the user's own agenda. Mixing them would mean a weekly
 * scrape could delete something they put there themselves.
 */
export function techEventsPath(): string {
  return dataPath(TECH_EVENTS_FILE);
}

export function readTechEvents(): TechEvent[] {
  return readJsonArray<TechEvent>(TECH_EVENTS_FILE);
}

export function writeTechEvents(events: TechEvent[]): void {
  writeJsonArray(TECH_EVENTS_FILE, events);
}

export function readTechEventScanState(): TechEventScanState | null {
  return readJsonObject<TechEventScanState>(TECH_EVENT_SCAN_FILE);
}

export function writeTechEventScanState(state: TechEventScanState): void {
  writeJsonObject(TECH_EVENT_SCAN_FILE, state);
}

/**
 * The pi session the dashboard assistant talks to, remembered across server
 * restarts so the conversation keeps its context ("move it to Thursday").
 */
interface AssistantState {
  sessionId?: string;
  dailyAgendaSessionId?: string;
  /**
   * Kept apart from the conversational session on purpose: the scoring turn
   * reads employer-authored job descriptions, and anything a posting tries to
   * talk the model into must not survive into the session you chat with later.
   */
  jobScorerSessionId?: string;
  /**
   * Same isolation for the mail review: email is untrusted third-party text,
   * so the turn that reads it and writes todos/events runs in its own session.
   */
  mailReviewSessionId?: string;
  /**
   * The coding coach's own conversation, kept apart from the dashboard
   * assistant for the plain reason that it is a different conversation: weeks
   * of "why is this O(n log n)" should not dilute the context you ask about
   * rent and calendars in, and either one must be restartable without taking
   * the other with it.
   */
  coachSessionId?: string;
  /**
   * The curriculum mentor's conversation.
   *
   * Apart from the coach for the same reason the coach is apart from the
   * assistant, and one more: the two are asked opposite questions. The coach
   * must withhold answers to keep a problem worth solving; the mentor is being
   * asked to explain, and explaining fully is the whole job. Sharing a session
   * would leave one persona reading the other's instructions.
   */
  mentorSessionId?: string;
  updatedAt?: string;
}

function readAssistantState(): AssistantState {
  return readJsonObject<AssistantState>(ASSISTANT_FILE) ?? {};
}

function writeAssistantState(patch: Partial<AssistantState>): void {
  writeJsonObject(ASSISTANT_FILE, {
    ...readAssistantState(),
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

export function readAssistantSessionId(): string | null {
  return readAssistantState().sessionId ?? null;
}

export function writeAssistantSessionId(sessionId: string): void {
  writeAssistantState({ sessionId });
}

export function readDailyAgendaSessionId(): string | null {
  return readAssistantState().dailyAgendaSessionId ?? null;
}

export function writeDailyAgendaSessionId(dailyAgendaSessionId: string): void {
  writeAssistantState({ dailyAgendaSessionId });
}

export function readJobScorerSessionId(): string | null {
  return readAssistantState().jobScorerSessionId ?? null;
}

export function writeJobScorerSessionId(jobScorerSessionId: string): void {
  writeAssistantState({ jobScorerSessionId });
}

export function readMailReviewSessionId(): string | null {
  return readAssistantState().mailReviewSessionId ?? null;
}

export function writeMailReviewSessionId(mailReviewSessionId: string): void {
  writeAssistantState({ mailReviewSessionId });
}

export function readCoachSessionId(): string | null {
  return readAssistantState().coachSessionId ?? null;
}

export function writeCoachSessionId(coachSessionId: string): void {
  writeAssistantState({ coachSessionId });
}

export function readMentorSessionId(): string | null {
  return readAssistantState().mentorSessionId ?? null;
}

export function writeMentorSessionId(mentorSessionId: string): void {
  writeAssistantState({ mentorSessionId });
}

/** The assistant sessions a caller may ask to start over. */
export const ASSISTANT_SESSION_KINDS = ["default", "readOnly", "scoring", "mail", "coach", "mentor"] as const;

export type AssistantSessionKind = (typeof ASSISTANT_SESSION_KINDS)[number];

const SESSION_FIELDS: Record<AssistantSessionKind, keyof AssistantState> = {
  default: "sessionId",
  readOnly: "dailyAgendaSessionId",
  scoring: "jobScorerSessionId",
  mail: "mailReviewSessionId",
  coach: "coachSessionId",
  mentor: "mentorSessionId",
};

/**
 * Forget a remembered session id, so the next turn of that mode starts fresh.
 *
 * The session file itself is left alone: this is "start a new conversation",
 * not "delete the old one", and the transcript is still worth having. What it
 * buys is a way out of a context that has drifted or grown expensive without
 * reaching for the filesystem from a chat message.
 */
export function clearAssistantSession(kind: AssistantSessionKind): boolean {
  const field = SESSION_FIELDS[kind];
  const state = readAssistantState();
  if (state[field] === undefined) return false;
  const { [field]: _dropped, ...rest } = state;
  void _dropped;
  writeJsonObject(ASSISTANT_FILE, { ...rest, updatedAt: new Date().toISOString() });
  return true;
}

/* ──────────────────────────── jobs ──────────────────────────── */

export function jobsPath(): string {
  return dataPath(JOBS_FILE);
}

export function readJobs(): Job[] {
  return readJsonArray<Job>(JOBS_FILE);
}

export function writeJobs(jobs: Job[]): void {
  writeJsonArray(JOBS_FILE, jobs);
}

export function updateJobs<R>(updater: (jobs: Job[]) => { value: R; changed: boolean }): R {
  return updateJsonArray(JOBS_FILE, updater);
}

export function jobProfilePath(): string {
  return dataPath(JOB_PROFILE_FILE);
}

/**
 * Always merged over the defaults rather than returned raw. The profile grows
 * new keys as the feature does, and a file written by an older version must
 * keep working — an absent `digestSize` has to mean "the default", not
 * `undefined` reaching a `.slice()`.
 */
export function readJobProfile(): JobProfile {
  const stored = readJsonObject<Partial<JobProfile>>(JOB_PROFILE_FILE);
  return { ...DEFAULT_JOB_PROFILE, ...(stored ?? {}) };
}

export function writeJobProfile(profile: JobProfile): void {
  writeJsonObject(JOB_PROFILE_FILE, { ...profile, updatedAt: new Date().toISOString() });
}

/** What the last scan did, so the page can say when it last ran and what broke. */
export interface JobScanState {
  startedAt: string;
  finishedAt: string;
  scanned: number;
  matched: number;
  added: number;
  /** Rows retired because the board no longer lists them. Absent on old state files. */
  closed?: number;
  sources: { id: string; name: string; count: number; error?: string }[];
}

export function readJobScanState(): JobScanState | null {
  return readJsonObject<JobScanState>(JOB_SCAN_FILE);
}

export function writeJobScanState(state: JobScanState): void {
  writeJsonObject(JOB_SCAN_FILE, state);
}

/**
 * Progress of a scoring run.
 *
 * Scoring is the one step that costs money and the one step with nothing to
 * watch: the model works inside an agent session and the only outward sign is
 * rows quietly gaining a number. Without this the honest answer to "is it
 * running" is "look at the list again in a minute".
 *
 * `remaining` is re-read from the job store on each publish rather than
 * counted down, so it stays true even when something else scores in parallel.
 */
export interface JobScoringState {
  startedAt: string;
  finishedAt: string | null;
  running: boolean;
  round: number;
  totalRounds: number;
  /** Unscored count when the run began — the denominator of the bar. */
  startedWith: number;
  remaining: number;
  /** Which model did the work, so a bad batch can be traced to it. */
  model: string | null;
  error: string | null;
}

export function readJobScoringState(): JobScoringState | null {
  return readJsonObject<JobScoringState>(JOB_SCORING_FILE);
}

export function writeJobScoringState(state: JobScoringState): void {
  writeJsonObject(JOB_SCORING_FILE, state);
}

/**
 * Progress of a directory sweep.
 *
 * Written to disk rather than held in memory because the sweep outlives the
 * request that started it: the page polls this file to draw a progress bar,
 * and a server restart mid-sweep leaves a readable record of where it got to
 * instead of a spinner that never resolves.
 */
export interface JobSweepState {
  startedAt: string;
  finishedAt: string | null;
  running: boolean;
  boardsTotal: number;
  boardsDone: number;
  /** Dead slugs and failed boards. About a third of the dataset is expected. */
  unreachable: number;
  scanned: number;
  matched: number;
  added: number;
  directories: {
    id: string;
    label: string;
    status: "ok" | "stale" | "empty";
    boards: number;
    matched: number;
  }[];
  /** How far each directory got, so a killed sweep can resume. */
  cursors: Record<string, number>;
  error: string | null;
}

export function readJobSweepState(): JobSweepState | null {
  return readJsonObject<JobSweepState>(JOB_SWEEP_FILE);
}

export function writeJobSweepState(state: JobSweepState): void {
  writeJsonObject(JOB_SWEEP_FILE, state);
}

/**
 * The latest categorised email review.
 *
 * One file, keyed by day: the review is "what came in today and what it means",
 * so a second check the same day replaces the first rather than appending. The
 * items carry their own Gmail metadata, so the dashboard renders the review
 * without another Gmail call.
 */
export function readMailReview(): MailReview | null {
  return readJsonObject<MailReview>(MAIL_REVIEW_FILE);
}

export function writeMailReview(review: MailReview): void {
  writeJsonObject(MAIL_REVIEW_FILE, review);
}

/**
 * Attach the assistant's report to today's review.
 *
 * The report is the turn's final text, produced after gmail_review already
 * wrote the items — so it has to be merged in a second step. An empty inbox is
 * still a review ("no mail" is information), so a turn with no items still
 * creates a shell review rather than dropping the report.
 */
export function attachMailReport(reply: string): void {
  const report = reply.trim();
  if (!report) return;
  const review = readMailReview();
  writeMailReview(review
    ? { ...review, report }
    : { day: localDate(), reviewedAt: new Date().toISOString(), items: [], report });
}

/* ──────────────────────────── practice ──────────────────────────── */

export function practicePath(): string {
  return dataPath(PRACTICE_FILE);
}

export function readPracticeRecords(): PracticeRecord[] {
  return readJsonArray<PracticeRecord>(PRACTICE_FILE);
}

export function writePracticeRecords(records: PracticeRecord[]): void {
  writeJsonArray(PRACTICE_FILE, records);
}

export function updatePracticeRecords<R>(
  updater: (records: PracticeRecord[]) => { value: R; changed: boolean },
): R {
  return updateJsonArray(PRACTICE_FILE, updater);
}

/**
 * What the workspace currently has open.
 *
 * A cross-origin iframe tells us nothing about itself, so the coach can only
 * know which problem you are looking at because the click that opened it came
 * from our side and was written down here. This file is that record.
 */
export interface PracticeState {
  /** LeetCode slug of the problem the workspace currently has open. */
  currentSlug?: string;
  list?: PracticeList;
  /** UTC instant, ISO 8601. */
  updatedAt?: string;
}

export function readPracticeState(): PracticeState {
  return readJsonObject<PracticeState>(PRACTICE_STATE_FILE) ?? {};
}

export function writePracticeState(patch: Partial<PracticeState>): void {
  updatePracticeState(patch);
}

export function updatePracticeState(patch: Partial<PracticeState>): void {
  updateJsonObject<PracticeState, void>(PRACTICE_STATE_FILE, (current) => ({
    result: undefined,
    value: { ...(current ?? {}), ...patch, updatedAt: new Date().toISOString() },
    changed: true,
  }));
}

/* ──────────────────────────── study ──────────────────────────── */

/**
 * What the curriculum track currently has open — and the only thing it stores.
 *
 * Same reason the practice state exists: the frame is cross-origin and reports
 * nothing about itself, so the mentor can only answer "what am I reading" if
 * the click that opened it was written down on the way past. Note what is
 * absent: no records file, because nothing on this side is scored, counted, or
 * marked read.
 */
export interface StudyState {
  /** Curriculum item id the workspace currently has open. */
  currentItemId?: string;
  /** Which track the syllabus is showing. */
  track?: string;
  /** UTC instant, ISO 8601. */
  updatedAt?: string;
}

export function readStudyState(): StudyState {
  return readJsonObject<StudyState>(STUDY_STATE_FILE) ?? {};
}

export function writeStudyState(patch: Partial<StudyState>): void {
  writeJsonObject(STUDY_STATE_FILE, {
    ...readStudyState(),
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}
