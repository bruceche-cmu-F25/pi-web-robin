/**
 * Practice logic the browser also needs.
 *
 * Like ./dates.ts and ./links.ts, this file stays free of `node:fs` so the
 * roadmap rail can import its values directly. The record store itself lives
 * in ./store.ts.
 *
 * A Practice Problem is keyed by its LeetCode slug (`link`) throughout. That
 * slug is the one identifier both sources agree on and the one least likely to
 * be renamed — NeetCode's own `ncSlug` is a display route, and problem titles
 * change.
 */
import { addDays, localDate } from "./dates.ts";
import { NEETCODE_CATALOG, type CatalogProblem } from "./neetcode-catalog.ts";

export type { CatalogProblem } from "./neetcode-catalog.ts";
export { NEETCODE_CATALOG } from "./neetcode-catalog.ts";

/**
 * The roadmap's own teaching order.
 *
 * The catalog is a flat list; this is the order NeetCode's roadmap graph walks
 * its topics in, which is what the rail renders. Kept here rather than
 * generated so a source change surfaces as a failing test instead of silently
 * reordering the page.
 */
export const PATTERN_ORDER = [
  "Arrays & Hashing",
  "Two Pointers",
  "Sliding Window",
  "Stack",
  "Binary Search",
  "Linked List",
  "Trees",
  "Tries",
  "Heap / Priority Queue",
  "Backtracking",
  "Graphs",
  "Advanced Graphs",
  "1-D Dynamic Programming",
  "2-D Dynamic Programming",
  "Greedy",
  "Intervals",
  "Math & Geometry",
  "Bit Manipulation",
  "JavaScript",
] as const;

export const PRACTICE_LISTS = ["neetcode150", "blind75", "all"] as const;
export type PracticeList = (typeof PRACTICE_LISTS)[number];

export const PRACTICE_STATUSES = ["todo", "attempted", "solved"] as const;
export type PracticeStatus = (typeof PRACTICE_STATUSES)[number];

export const ATTEMPT_OUTCOMES = ["solved", "partial", "stuck"] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/** One sitting with one problem. */
export interface Attempt {
  /** UTC instant, ISO 8601. */
  at: string;
  outcome: AttemptOutcome;
  /** Local day at recording time; old entries fall back to the timestamp. */
  on?: string;
  /** Distinguishes a first sitting from a review of a status-only legacy record. */
  kind?: "new" | "review";
  confidence?: number;
  minutes?: number;
  /**
   * How far up the coach's hint ladder this attempt went, 0–4.
   *
   * Recorded because "I solved it" and "I solved it after four hints" are
   * different facts, and only the second one predicts needing to see it again.
   */
  hintLevel?: number;
}

/** Everything the user's own history says about one problem. */
export interface PracticeRecord {
  /** LeetCode slug — the catalog key. */
  slug: string;
  status: PracticeStatus;
  attempts: Attempt[];
  /** Self-rated 1 (lost) – 5 (could teach it). Drives the review interval. */
  confidence?: number;
  note?: string;
  /** Local calendar date, YYYY-MM-DD. Never a timestamp. */
  nextReviewOn?: string;
  /** Version of the interval policy; legacy dates are adapted on read. */
  scheduleVersion?: 2;
  /** UTC instant, ISO 8601. */
  updatedAt: string;
}

/** Practical expanding spacing, not a fitted Ebbinghaus memory model. */
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60] as const;
export const PRACTICE_ROUND_TARGET = 6;
export const DAILY_NEW_TARGET = 1;
export const DAILY_REVIEW_TARGET = 3;

export function attemptDay(attempt: Attempt): string {
  return attempt.on ?? localDate(new Date(attempt.at));
}

/** No hints (explicitly recorded), successful recall, and no low self-rating. */
function independent(attempt: Attempt): boolean {
  return attempt.outcome === "solved" && attempt.hintLevel === 0
    && (attempt.confidence ?? 4) >= 3;
}

export function practiceProgress(record: PracticeRecord | null | undefined) {
  const days = new Map<string, Attempt[]>();
  for (const attempt of record?.attempts ?? []) {
    const day = attemptDay(attempt);
    const bucket = days.get(day);
    if (bucket) bucket.push(attempt);
    else days.set(day, [attempt]);
  }
  let stage = 0;
  let rounds = 0;
  for (const [, attempts] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    // Looking at a hint then immediately reproducing it isn't cold recall.
    if (attempts.every(independent)) {
      rounds += 1;
      stage = Math.min(stage + 1, REVIEW_INTERVAL_DAYS.length);
    } else {
      stage = 0;
    }
  }
  return { attempts: record?.attempts.length ?? 0, rounds, stage };
}

export function reviewDateFor(confidence: number, from: string = localDate(), stage = 1): string {
  const index = confidence < 3 ? 0 : Math.min(Math.max(stage - 1, 0), REVIEW_INTERVAL_DAYS.length - 1);
  return addDays(from, REVIEW_INTERVAL_DAYS[index]);
}

/** Adapt old long/absent schedules without inventing attempts or writing on GET. */
export function normalizePracticeRecord(record: PracticeRecord): PracticeRecord {
  if (record.scheduleVersion === 2 || record.status === "todo") return record;
  const last = record.attempts.at(-1);
  const from = last ? attemptDay(last) : localDate(new Date(record.updatedAt));
  const recommended = reviewDateFor(record.confidence ?? 3, from, practiceProgress(record).stage);
  return {
    ...record,
    scheduleVersion: 2,
    nextReviewOn: record.nextReviewOn && record.nextReviewOn < recommended ? record.nextReviewOn : recommended,
  };
}

export function emptyRecord(slug: string): PracticeRecord {
  return { slug, status: "todo", attempts: [], updatedAt: new Date().toISOString() };
}

export function inList(problem: CatalogProblem, list: PracticeList): boolean {
  if (list === "all") return true;
  return problem[list] === true;
}

export function problemsInList(list: PracticeList): CatalogProblem[] {
  return NEETCODE_CATALOG.filter((problem) => inList(problem, list));
}

export function findProblemMatches(slugOrName: string): CatalogProblem[] {
  const needle = slugOrName.trim().toLowerCase();
  if (!needle) return [];

  const exact = NEETCODE_CATALOG.find((problem) =>
    problem.link === needle
    || problem.problem.toLowerCase() === needle
    || problem.ncSlug === needle);
  if (exact) return [exact];
  return NEETCODE_CATALOG.filter((problem) => problem.problem.toLowerCase().includes(needle));
}

/** Resolve only when the reference identifies one problem. */
export function findProblem(slugOrName: string): CatalogProblem | null {
  const matches = findProblemMatches(slugOrName);
  return matches.length === 1 ? matches[0] as CatalogProblem : null;
}

/* ─────────────────────────── the links ─────────────────────────── */

/**
 * The page that can actually be embedded.
 *
 * Only problems NeetCode has its own route for; LeetCode sends
 * `X-Frame-Options: SAMEORIGIN`, so its pages can never appear in the frame.
 */
export function embedUrl(problem: CatalogProblem): string | null {
  return problem.ncSlug ? `https://neetcode.io/problems/${problem.ncSlug}` : null;
}

export function leetcodeUrl(problem: CatalogProblem): string {
  return `https://leetcode.com/problems/${problem.link}/`;
}

export function videoUrl(problem: CatalogProblem): string | null {
  return problem.video ? `https://www.youtube.com/watch?v=${problem.video}` : null;
}

/** NeetCode's own reference solutions, in the MIT-licensed repo. */
export function solutionsUrl(problem: CatalogProblem, language = "python"): string | null {
  return problem.code
    ? `https://github.com/neetcode-gh/leetcode/blob/main/${language}/${problem.code}.py`
    : null;
}

/* ─────────────────────────── grouping ─────────────────────────── */

export interface PatternGroup {
  pattern: string;
  problems: CatalogProblem[];
  solved: number;
  attempted: number;
}

/**
 * The rail's shape: one section per pattern, in roadmap order.
 *
 * A pattern the catalog no longer has any problems for is dropped rather than
 * rendered empty; a pattern the catalog has but `PATTERN_ORDER` does not is
 * appended, so a new NeetCode topic shows up at the bottom instead of
 * vanishing.
 */
export function groupByPattern(
  problems: readonly CatalogProblem[],
  records: ReadonlyMap<string, PracticeRecord>,
): PatternGroup[] {
  const byPattern = new Map<string, CatalogProblem[]>();
  for (const problem of problems) {
    const bucket = byPattern.get(problem.pattern);
    if (bucket) bucket.push(problem);
    else byPattern.set(problem.pattern, [problem]);
  }

  const ordered = [
    ...PATTERN_ORDER.filter((pattern) => byPattern.has(pattern)),
    ...[...byPattern.keys()].filter((pattern) => !(PATTERN_ORDER as readonly string[]).includes(pattern)),
  ];

  return ordered.map((pattern) => {
    const group = byPattern.get(pattern) ?? [];
    return {
      pattern,
      problems: group,
      solved: group.filter((problem) => records.get(problem.link)?.status === "solved").length,
      attempted: group.filter((problem) => records.get(problem.link)?.status === "attempted").length,
    };
  });
}

export function recordMap(records: readonly PracticeRecord[]): Map<string, PracticeRecord> {
  return new Map(records.map((record) => [record.slug, record]));
}

export interface PracticeStats {
  total: number;
  solved: number;
  attempted: number;
  due: number;
  byDifficulty: Record<"Easy" | "Medium" | "Hard", { total: number; solved: number }>;
}

export function statsFor(
  problems: readonly CatalogProblem[],
  records: ReadonlyMap<string, PracticeRecord>,
  today: string,
): PracticeStats {
  const stats: PracticeStats = {
    total: problems.length,
    solved: 0,
    attempted: 0,
    due: 0,
    byDifficulty: {
      Easy: { total: 0, solved: 0 },
      Medium: { total: 0, solved: 0 },
      Hard: { total: 0, solved: 0 },
    },
  };

  for (const problem of problems) {
    const record = records.get(problem.link);
    const difficulty = stats.byDifficulty[problem.difficulty];
    if (difficulty) difficulty.total += 1;
    if (record?.status === "solved") {
      stats.solved += 1;
      if (difficulty) difficulty.solved += 1;
    } else if (record?.status === "attempted") {
      stats.attempted += 1;
    }
    if (isDue(record, today)) stats.due += 1;
  }
  return stats;
}

export function isDue(record: PracticeRecord | undefined, today: string): boolean {
  if (!record?.nextReviewOn) return false;
  return record.status !== "todo" && record.nextReviewOn <= today;
}

/** Previously studied problems, including failures, oldest due date first. */
export function dueForReview(
  records: readonly PracticeRecord[],
  today: string,
): PracticeRecord[] {
  return records
    .filter((record) => isDue(record, today))
    .sort((a, b) => (a.nextReviewOn ?? "").localeCompare(b.nextReviewOn ?? "")
      || (a.confidence ?? 0) - (b.confidence ?? 0)
      || a.slug.localeCompare(b.slug));
}

/**
 * What to work on next, when the user has no opinion.
 *
 * Reviews first — a problem sliding out of memory is worth more than a new
 * one — then the earliest unsolved problem in roadmap order, which is the
 * order the patterns build on each other in.
 */
export function suggestNext(
  problems: readonly CatalogProblem[],
  records: ReadonlyMap<string, PracticeRecord>,
  today: string,
): CatalogProblem | null {
  const plan = dailyPracticePlan(problems, records, today);
  return plan.reviews[0] ?? plan.newProblems[0] ?? null;
}

/** Daily budgets count distinct problems, not clicks; completed work never refills. */
export function dailyPracticePlan(
  problems: readonly CatalogProblem[],
  records: ReadonlyMap<string, PracticeRecord>,
  today: string,
) {
  const ordered = groupByPattern(problems, records).flatMap((group) => group.problems);
  const studiedToday = ordered.filter((problem) =>
    records.get(problem.link)?.attempts.some((attempt) => attemptDay(attempt) === today));
  const newDone = studiedToday.filter((problem) => {
    const record = records.get(problem.link)!;
    const first = record.attempts[0];
    return first.kind ? first.kind === "new" && attemptDay(first) === today
      : record.attempts.every((attempt) => attemptDay(attempt) >= today);
  }).length;
  const reviewDone = studiedToday.length - newDone;
  const done = new Set(studiedToday.map((problem) => problem.link));
  const bySlug = new Map(ordered.map((problem) => [problem.link, problem]));
  const due = dueForReview([...records.values()], today)
    .filter((record) => bySlug.has(record.slug) && !done.has(record.slug));
  const fresh = ordered.filter((problem) => {
    const record = records.get(problem.link);
    return (!record || (record.status === "todo" && !record.attempts.length)) && !done.has(problem.link);
  });
  const upcoming = [...records.values()]
    .filter((record) => bySlug.has(record.slug) && record.status !== "todo"
      && record.nextReviewOn && record.nextReviewOn > today)
    .sort((a, b) => a.nextReviewOn!.localeCompare(b.nextReviewOn!))[0];
  return {
    today,
    newTarget: DAILY_NEW_TARGET,
    reviewTarget: DAILY_REVIEW_TARGET,
    newDone,
    reviewDone,
    newProblems: fresh.slice(0, Math.max(0, DAILY_NEW_TARGET - newDone)),
    reviews: due.slice(0, Math.max(0, DAILY_REVIEW_TARGET - reviewDone)).map((record) => bySlug.get(record.slug)!),
    dueCount: due.length,
    nextReviewOn: upcoming?.nextReviewOn ?? null,
    rounds: ordered.reduce((sum, problem) => sum + Math.min(PRACTICE_ROUND_TARGET, practiceProgress(records.get(problem.link)).rounds), 0),
    roundTarget: problems.length * PRACTICE_ROUND_TARGET,
  };
}
