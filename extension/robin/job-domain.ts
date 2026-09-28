/** Job-pipeline behavior shared by the HTTP and Pi tool adapters. */
import {
  JOB_STATUSES,
  digestCandidates,
  formatJobDigest,
  pendingJobs,
  sortJobs,
  type Job,
  type JobStatus,
} from "./jobs.ts";
import {
  readJobProfile,
  readJobScanState,
  readJobScoringState,
  readJobSweepState,
  readJobs,
  updateJobs,
  writeJobScoringState,
  type JobScanState,
  type JobScoringState,
  type JobSweepState,
} from "./store.ts";
import { experienceProblem, jobSummary, reviewProblem, scoringContext, type JobReview } from "./job-evidence.ts";
import { enrichJob } from "./job-intake.ts";
import {
  findDeadPostings,
  hydrateDescriptions,
  makeFetchContext,
  type FetchContext,
} from "./job-providers.ts";

/** Fetch better evidence on demand, without running scan retention or changing statuses. */
export async function getJobDetails(id: string, ctx: FetchContext = makeFetchContext()): Promise<Job | null> {
  const original = readJobs().find((job) => job.id === id);
  if (!original) return null;
  const fetched = { ...original };
  await hydrateDescriptions([fetched], ctx, { readUnknownBoards: readJobProfile().readUnknownBoards });
  return updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === id);
    if (!job) return { value: null, changed: false };
    // Do not replace a description another request updated while fetching.
    const changed = job.description === original.description && enrichJob(job, fetched);
    return { value: job, changed };
  });
}

export function updateJob(
  id: string,
  patch: { status?: JobStatus; note?: string },
): Job | null {
  if (patch.status !== undefined && !JOB_STATUSES.includes(patch.status)) {
    throw new Error(`status must be one of: ${JOB_STATUSES.join(", ")}`);
  }
  return updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === id);
    if (!job) return { value: null, changed: false };

    if (patch.status !== undefined) {
      if (patch.status === "applied" && job.status !== "applied" && !job.appliedAt) {
        job.appliedAt = new Date().toISOString();
      }
      job.status = patch.status;
    }
    if (patch.note !== undefined) {
      const note = patch.note.trim().slice(0, 2000);
      if (note) job.note = note;
      else delete job.note;
    }
    return { value: job, changed: true };
  });
}

export function deleteJob(id: string): Job | null {
  return updateJobs((jobs) => {
    const index = jobs.findIndex((entry) => entry.id === id);
    if (index < 0) return { value: null, changed: false };
    const [job] = jobs.splice(index, 1);
    return { value: job ?? null, changed: true };
  });
}

export function dropJobs(ids: Iterable<string>): number {
  return setJobsStatus(ids, "dropped");
}

/**
 * One status for many rows, in one write: the page's "drop everything below
 * the floor" and the undo that puts them back. Same applied-timestamp rule as
 * `updateJob`. Returns how many rows actually changed.
 */
export function setJobsStatus(ids: Iterable<string>, status: JobStatus): number {
  if (!JOB_STATUSES.includes(status)) {
    throw new Error(`status must be one of: ${JOB_STATUSES.join(", ")}`);
  }
  const selected = new Set(ids);
  return updateJobs((jobs) => {
    const now = new Date().toISOString();
    let changed = 0;
    for (const job of jobs) {
      if (!selected.has(job.id) || job.status === status) continue;
      if (status === "applied" && !job.appliedAt) job.appliedAt = now;
      job.status = status;
      changed += 1;
    }
    return { value: changed, changed: changed > 0 };
  });
}

export function claimJobs(ids: Iterable<string>): number {
  const selected = new Set(ids);
  return updateJobs((jobs) => {
    const now = new Date().toISOString();
    let claimed = 0;
    for (const job of jobs) {
      if (selected.has(job.id) && !job.notifiedAt) {
        job.notifiedAt = now;
        claimed += 1;
      }
    }
    return { value: claimed, changed: claimed > 0 };
  });
}

export function scoreJob(input: {
  id: string;
  score: number;
  reason: string;
  flags?: string[];
  review?: JobReview;
}): { job: Job; pending: number } | null {
  if (!Number.isFinite(input.score)) throw new Error("score must be a number between 1 and 5");
  if (!input.reason.trim()) throw new Error("reason must not be empty");
  const profile = readJobProfile();
  const pinned = profile.scoreModel;
  const result = updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === input.id);
    if (!job) return { value: null, changed: false };

    enrichJob(job, job);
    let score = Math.min(Math.max(input.score, 1), 5);
    const flags = new Set((input.flags ?? []).map((flag) => flag.trim()).filter(Boolean));
    const problem = experienceProblem(job, profile)
      ?? (input.review || score >= 4 ? reviewProblem(job, profile, input.review) : null);
    if (problem) {
      flags.add(problem);
      score = Math.min(score, problem.startsWith("blocked-") ? 2 : 3.9);
    }
    if (profile.maxYears > 0 && job.yearsRequired !== undefined && job.yearsRequired > profile.maxYears) {
      score = Math.min(score, 2.5);
      flags.add(`asks ${job.yearsRequired}+ yrs`);
    }
    job.score = score;
    const caveat = problem === "stretch-experience"
      ? (profile.rubricLocale === "zh" ? "经验可尝试" : "Experience stretch")
      : problem?.startsWith("blocked-")
        ? (profile.rubricLocale === "zh" ? "硬性要求不符" : "Eligibility blocked")
        : (profile.rubricLocale === "zh" ? "待核实" : "Needs verification");
    job.reason = `${problem ? `${caveat} (${problem}): ` : ""}${input.reason.trim()}`;
    job.scoredAt = new Date().toISOString();
    job.scoreContext = scoringContext(job, profile);
    delete job.scoreStale;
    if (input.review) job.review = input.review;
    else delete job.review;
    if (flags.size) job.flags = [...flags];
    else delete job.flags;
    if (pinned) job.scoredBy = `${pinned.provider}/${pinned.modelId}`;
    else delete job.scoredBy;
    return { value: { job, pending: pendingJobs(jobs, profile).length }, changed: true };
  });
  return result;
}

/* ────────────────────────── reads ────────────────────────── */

/** The published progress shapes, re-exported so adapters never import the store. */
export type { JobScanState, JobScoringState, JobSweepState } from "./store.ts";

export interface JobBoard {
  /** Best-first, and summarised — `jobSummary` drops the stored posting text. */
  jobs: Job[];
  /** How the last discovery sweep went, or null before the first one. */
  scan: JobScanState | null;
  /** Where the push threshold sits, so the page can explain what it shows. */
  minScore: number;
  digestSize: number;
  /** False until at least one company or board is tracked. */
  configured: boolean;
}

/**
 * The list plus the two things the page needs to explain it.
 *
 * Sending them together keeps the page from firing three requests to render
 * one screen. The CV is deliberately absent — it can be long and only the
 * profile editor needs it, so it stays behind the profile read.
 */
export function jobBoard(): JobBoard {
  const profile = readJobProfile();
  return {
    jobs: sortJobs(readJobs()).map((job) => jobSummary(job, profile)),
    scan: readJobScanState(),
    minScore: profile.minScore,
    digestSize: profile.digestSize,
    configured: profile.companies.length > 0 || profile.boards.length > 0,
  };
}

/**
 * How many jobs are waiting on a score.
 *
 * Counted from the store on every call rather than tracked, so a run that
 * half-finished is reported honestly. Every caller that used to spell this
 * `pendingJobs(readJobs(), readJobProfile()).length` now asks here.
 */
export function pendingJobCount(): number {
  return pendingJobs(readJobs(), readJobProfile()).length;
}

/** Ids of the jobs waiting on a score, for a caller that must compare two rounds. */
export function pendingJobIds(): string[] {
  return pendingJobs(readJobs(), readJobProfile()).map((job) => job.id);
}

export interface JobScoringStatus {
  scoring: JobScoringState | null;
  /** Live backlog — the number that decides whether pressing Score does anything. */
  pending: number;
  /** The pinned scorer as `provider/modelId`, or null when none is pinned. */
  model: string | null;
}

export function scoringStatus(): JobScoringStatus {
  const profile = readJobProfile();
  return {
    scoring: readJobScoringState(),
    pending: pendingJobs(readJobs(), profile).length,
    model: scorerName(profile.scoreModel),
  };
}

/** `provider/modelId` for a pinned scorer, or null. */
export function scorerName(model: { provider: string; modelId: string } | null | undefined): string | null {
  return model ? `${model.provider}/${model.modelId}` : null;
}

/** The scoring run's published progress — the file the page polls. */
export function scoringState(): JobScoringState | null {
  return readJobScoringState();
}

/**
 * Publish a scoring run's progress.
 *
 * The run itself lives in the host, because it needs an assistant turn that
 * the extension has no way to start; this is the seam it writes through.
 */
export function saveScoringState(state: JobScoringState): void {
  writeJobScoringState(state);
}

/** The directory sweep's published progress. */
export function sweepState(): JobSweepState | null {
  return readJobSweepState();
}

/* ────────────────────────── the digest ────────────────────────── */

/**
 * Build the next push.
 *
 * The text is assembled here, from stored fields, by `formatJobDigest` — the
 * model never writes it. A digest whose entire value is a link the user will
 * click cannot afford a hallucinated URL, and a scorer that is only ever asked
 * for a number and one sentence has no way to produce one.
 *
 * Claiming is the other half: every job in the returned batch gets
 * `notifiedAt` stamped, so the evening push shows different jobs than the
 * morning one and a bridge restart cannot re-send the same ten.
 *
 * Two request shapes exist so a delivery can be claimed only once it landed:
 *
 *   { preview: true }        → read the next batch, write nothing
 *   { claim: [id, …] }       → stamp exactly those jobs as delivered
 *   { }                      → read and stamp in one step
 *
 * The bridge uses the first two. A send that fails then costs nothing: the
 * batch was never claimed, so the next slot offers the same jobs again rather
 * than silently skipping ten of them.
 */
/**
 * How many rounds of "drop the dead ones and pull in replacements".
 *
 * Two. If a third of a batch is dead the boards are having a bad day, and
 * grinding through the whole backlog looking for ten live links is a worse
 * outcome than sending eight.
 */
const REFILL_ROUNDS = 2;

/**
 * The next `limit` candidates, minus the ones whose postings have closed.
 *
 * Checked here rather than during the scan because this is the only moment it
 * matters: a stale row in the store costs nothing until it becomes a
 * notification someone taps and lands on a 404, and four of the first
 * sixty-five pushes this feature sent were already dead when they went out.
 *
 * A posting confirmed gone is marked `dropped`, so the next push does not
 * spend a slot rediscovering it. Only confirmed verdicts count — a board that
 * timed out leaves its posting exactly where it was.
 */
async function liveBatch(
  candidates: Job[],
  limit: number,
  checkDead: DeadPostingCheck,
): Promise<Job[]> {
  const ctx = makeFetchContext();
  const live: Job[] = [];
  const closed = new Set<string>();
  let cursor = 0;

  for (let round = 0; round < REFILL_ROUNDS && live.length < limit && cursor < candidates.length; round += 1) {
    const attempt = candidates.slice(cursor, cursor + (limit - live.length));
    cursor += attempt.length;
    const dead = await checkDead(attempt.map((job) => job.url), ctx).catch(() => new Set<string>());
    for (const job of attempt) {
      if (dead.has(job.url)) closed.add(job.id);
      else live.push(job);
    }
  }

  if (closed.size > 0) dropJobs(closed);
  return live;
}

export interface JobDigest {
  text: string;
  jobIds: string[];
  count: number;
  /** How much is still unscored, and how big a bite the scorer takes. */
  pending: number;
  scoreBatch: number;
}

/**
 * Asking the boards which of these postings are gone.
 *
 * Injected rather than imported at the call site so a test can hold the check
 * open and edit the profile underneath it — which is the only way to prove the
 * re-read below actually wins. Production passes `findDeadPostings`.
 */
export type DeadPostingCheck = (urls: string[], ctx: FetchContext) => Promise<Set<string>>;

export interface JobDigestOptions {
  limit?: number;
  locale?: "en" | "zh";
  /** Read the next batch without stamping it as delivered. */
  preview?: boolean;
  checkDead?: DeadPostingCheck;
}

export async function buildJobDigest(options: JobDigestOptions = {}): Promise<JobDigest> {
  const profile = readJobProfile();
  const limit = Number.isInteger(options.limit) && (options.limit as number) > 0
    ? Math.min(options.limit as number, 50)
    : profile.digestSize;
  const locale = options.locale === "zh" ? "zh" as const : "en" as const;

  const checked = await liveBatch(
    digestCandidates(readJobs(), profile),
    limit,
    options.checkDead ?? findDeadPostings,
  );
  // Network checks can take seconds; a blacklist/score/status edit during that
  // wait must win over the snapshot taken before it.
  const checkedIds = new Set(checked.map((job) => job.id));
  const batch = digestCandidates(readJobs(), readJobProfile()).filter((job) => checkedIds.has(job.id));

  if (!options.preview && batch.length > 0) claimJobs(batch.map((job) => job.id));

  return {
    text: formatJobDigest(batch, { locale, scanned: readJobScanState()?.scanned ?? 0 }),
    jobIds: batch.map((job) => job.id),
    count: batch.length,
    pending: pendingJobs(readJobs(), readJobProfile()).length,
    scoreBatch: profile.scoreBatch,
  };
}
