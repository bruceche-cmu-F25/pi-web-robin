import { appliedJobs, roleKey, sortJobs, type Job } from "../../extension/robin/jobs.ts";

export type JobOrder = "priority" | "recent";
export type JobBand = "high" | "consider" | "unscored" | "below";
export interface JobGroup { job: Job; also: Job[] }

/** Display bands only; these never change scores or delivery eligibility. */
export function jobBand(job: Job, minScore: number): JobBand {
  if (typeof job.score !== "number") return "unscored";
  if (job.score < minScore) return "below";
  return job.score >= 4 ? "high" : "consider";
}

/** Count and act on the same cards. Copies in another pipeline stage stay separate. */
export function groupJobRoles(jobs: Job[], applied = false): JobGroup[] {
  const roles = new Map<string, JobGroup>();
  for (const job of applied ? appliedJobs(jobs) : sortJobs(jobs)) {
    const key = `${job.status}:${roleKey(job)}`;
    const group = roles.get(key);
    if (group) group.also.push(job);
    else roles.set(key, { job, also: [] });
  }
  return [...roles.values()];
}

/** Search after grouping so a location match never drops a card's other sources. */
export function searchJobGroups(groups: JobGroup[], query: string): JobGroup[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return groups.filter(({ job, also }) => [job, ...also].some((copy) => {
    const text = `${copy.company} ${copy.title} ${copy.location}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  }));
}

export function orderJobGroups(groups: JobGroup[], order: JobOrder, minScore: number): JobGroup[] {
  const rank: Record<JobBand, number> = { high: 0, consider: 1, unscored: 2, below: 3 };
  return [...groups].sort((a, b) => {
    if (order === "priority") {
      const priority = rank[jobBand(a.job, minScore)] - rank[jobBand(b.job, minScore)]
        || (b.job.score ?? -1) - (a.job.score ?? -1);
      if (priority) return priority;
    }
    return b.job.discoveredAt.localeCompare(a.job.discoveredAt);
  });
}
