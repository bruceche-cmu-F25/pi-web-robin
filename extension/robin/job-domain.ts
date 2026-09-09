/** Job-pipeline behavior shared by the HTTP and Pi tool adapters. */
import { JOB_STATUSES, pendingJobs, type Job, type JobStatus } from "./jobs.ts";
import { readJobProfile, readJobs, updateJobs } from "./store.ts";
import { experienceProblem, reviewProblem, scoringContext, type JobReview } from "./job-evidence.ts";
import { enrichJob } from "./job-intake.ts";
import { hydrateDescriptions, makeFetchContext, type FetchContext } from "./job-providers.ts";

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
  const selected = new Set(ids);
  return updateJobs((jobs) => {
    let dropped = 0;
    for (const job of jobs) {
      if (selected.has(job.id) && job.status !== "dropped") {
        job.status = "dropped";
        dropped += 1;
      }
    }
    return { value: dropped, changed: dropped > 0 };
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
