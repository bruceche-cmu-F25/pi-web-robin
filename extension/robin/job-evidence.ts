import { extractYearsRequired, hasDegreeExperienceAlternatives, type Job, type JobProfile } from "./jobs.ts";

export const JOB_SCORING_CONTRACT = "job-evidence-v3";

export const ELIGIBILITY_CHECKS = ["experience", "education", "startDate", "workAuthorization", "location"] as const;
export type EligibilityStatus = "met" | "blocked" | "unknown" | "not-stated";
export interface JobReview {
  /** Returned by job_pending(id); binds the review to this JD and profile. */
  context: string;
  roleEvidence: string;
  cvEvidence: string;
  checks: Record<typeof ELIGIBILITY_CHECKS[number], { status: EligibilityStatus; quote?: string }>;
}

/** A quality gate, not a claim that an employer published every requirement. */
export function hasSubstantiveDescription(description?: string): boolean {
  return !!description && description.trim().length >= 500 && !/(?:…|\.{3})\s*$/.test(description);
}

/** Stable change detection, not a security token. Pure so the UI can use it too. */
export function scoringContext(job: Job, profile: JobProfile): string {
  const text = JSON.stringify([
    JOB_SCORING_CONTRACT, job.company, job.title, job.location, job.description ?? "", job.yearsRequired,
    profile.cv, profile.notes, profile.titles, profile.excludeTitles,
    profile.locationAlways, profile.locationAllow, profile.locationBlock, profile.maxYears,
    profile.blacklist, profile.professionalExperienceMonths, profile.experienceStretchYears,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `v2-${(hash >>> 0).toString(16)}`;
}

function quotes(source: string, excerpt: unknown, minimum = 12): boolean {
  if (typeof excerpt !== "string") return false;
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  const needle = normalize(excerpt);
  return needle.length >= minimum && needle.length <= 1500 && normalize(source).includes(needle);
}

/** Enforce confirmed work history independently of the model's `met` claim. */
export function experienceProblem(job: Job, profile: JobProfile): string | null {
  const months = profile.professionalExperienceMonths;
  if (typeof months !== "number" || !Number.isFinite(months) || months < 0) return null;
  const description = job.description ?? "";
  // Branch eligibility is not yet structured; do not certify an unverified BS/MS substitution.
  if (hasDegreeExperienceAlternatives(description)) return "unknown-experience";
  const required = extractYearsRequired(description) ?? job.yearsRequired;
  if (required === undefined || required * 12 <= months) return null;
  if (required <= profile.experienceStretchYears) return "stretch-experience";
  return "blocked-experience";
}

/** Validate provenance and known numeric blockers; other eligibility remains judgement. */
export function reviewProblem(job: Job, profile: JobProfile, review?: JobReview): string | null {
  const experience = experienceProblem(job, profile);
  if (experience) return experience;
  if (!hasSubstantiveDescription(job.description)) return "incomplete-jd";
  if (!review || review.context !== scoringContext(job, profile)) return "needs-review";
  // A supported blocker wins even if another dimension is unresolved.
  const source = (field: typeof ELIGIBILITY_CHECKS[number]) => field === "location"
    ? `${job.location}\n${job.description}` : job.description!;
  for (const field of ELIGIBILITY_CHECKS) {
    const check = review.checks?.[field];
    if (check?.status === "blocked" && quotes(source(field), check.quote, field === "location" ? 3 : 12)) {
      return `blocked-${field}`;
    }
  }
  if (!quotes(job.description!, review.roleEvidence, 20) || !quotes(profile.cv, review.cvEvidence, 20)) {
    return "unsupported-evidence";
  }
  for (const field of ELIGIBILITY_CHECKS) {
    const check = review.checks?.[field];
    if (!check || !["met", "blocked", "unknown", "not-stated"].includes(check.status)) return `unchecked-${field}`;
    if (check.status === "not-stated" && ((field === "location" && job.location.trim())
      || (field === "experience" && job.yearsRequired !== undefined))) return `unchecked-${field}`;
    if ((check.status === "met" || check.status === "blocked") && !quotes(source(field), check.quote, field === "location" ? 3 : 12)) {
      return `unsupported-${field}`;
    }
    if (check.status === "blocked") return `blocked-${field}`;
    if (check.status === "unknown") return `unknown-${field}`;
  }
  return null;
}

/** Small list payload; verification warnings reuse the board's existing flag display. */
export function jobSummary(job: Job, profile: JobProfile): Job {
  const summary = { ...job };
  delete summary.description;
  delete summary.review;
  if (typeof job.score === "number" && (job.scoreStale || needsJobScoring(job, profile))) {
    summary.flags = [...new Set([...(job.flags ?? []), "needs-review"])];
  }
  return summary;
}

export function needsJobScoring(job: Job, profile?: JobProfile): boolean {
  if (job.status !== "new" && job.status !== "shortlist") return false;
  if (typeof job.score !== "number" || job.scoreStale) return true;
  if (!profile) return false;
  if (job.scoreContext && job.scoreContext !== scoringContext(job, profile)) return true;
  return job.score >= 4 && reviewProblem(job, profile, job.review) !== null;
}
