/** Job-pipeline behavior shared by the HTTP and Pi tool adapters. */
import { JOB_STATUSES, pendingJobs, type Job, type JobStatus } from "./jobs.ts";
import { readJobProfile, updateJobs } from "./store.ts";

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
}): { job: Job; pending: number } | null {
  if (!Number.isFinite(input.score)) throw new Error("score must be a number between 1 and 5");
  const pinned = readJobProfile().scoreModel;
  const result = updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === input.id);
    if (!job) return { value: null, changed: false };

    job.score = Math.min(Math.max(input.score, 1), 5);
    job.reason = input.reason.trim();
    job.scoredAt = new Date().toISOString();
    if (input.flags && input.flags.length > 0) {
      job.flags = input.flags.map((flag) => flag.trim()).filter(Boolean);
    }
    if (pinned) job.scoredBy = `${pinned.provider}/${pinned.modelId}`;
    return { value: { job, pending: pendingJobs(jobs).length }, changed: true };
  });
  return result;
}
