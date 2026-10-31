/** Client-safe application preparation records. A review is never a submission. */
export type ApplicationStage = "preparing" | "review" | "blocked" | "attention" | "error" | "unavailable" | "submitting" | "uncertain" | "submitted";
export const APPLICATION_WORKFLOW_VERSION = 2;
export const APPLICATION_SUBMISSION_POLICY = "jobright-checked-v1";

export interface ApplicationField {
  label: string;
  value: string;
  required: boolean;
  /** Source-backed answer and exact read-back match; DOM state is not a server receipt. */
  check: "matches-approved" | "needs-review" | "empty";
  key?: string;
  kind?: string;
  options?: string[];
  /** Search text/open suggestions are not a committed dropdown selection. */
  pendingSelection?: boolean;
  /** Native selected radio groups offer no unselected state via ordinary activation. */
  canClear?: boolean;
  source?: string;
}

export interface ApplicationSnapshot {
  fields: ApplicationField[];
  /** Resume attachment observed on the employer form; Jobright chooses the file. Not a PDF hash check. */
  resumeVerified: boolean;
  errors: string[];
  autofill: { clickedAt: string; completedAt: string; summary: string } | null;
}

export interface ApplicationDecision {
  key: string;
  action: "keep" | "set" | "clear" | "attention";
  value: string;
  source: "cv" | "confirmed" | "preferences" | "job" | "workflow" | "none";
  quote: string;
  reason: string;
}

export interface ApplicationReview {
  decisions: ApplicationDecision[];
  issues: string[];
}

export interface JobApplication {
  attemptId: string;
  workflowVersion?: number;
  approvalHash?: string;
  stage: ApplicationStage;
  phase?: string;
  autofill?: ApplicationSnapshot["autofill"];
  review?: ApplicationReview;
  /** Persisted BEFORE a click. An interrupted/ambiguous submission is never automatically retried. */
  submission?: { grantedAt: string; expiresAt: string; fingerprint: string; nonce: string };
  /** Only an explicit server validation rejection releases the submission lock; keep its evidence across retries. */
  rejections?: Array<{ attemptId: string; at: string; url: string; text: string }>;
  startedAt: string;
  updatedAt: string;
  /** Removed from the automation board, not from attempt history or duplicate protection. */
  dismissedAt?: string;
  /** Count reservations, including failures, so a broken browser cannot retry all day. */
  days: string[];
  url: string;
  resumeHash: string;
  preferencesHash: string;
  fields: ApplicationField[];
  blockers: string[];
  /** Attachment presence for current runs; older records checked exact uploaded PDF bytes. */
  resumeVerified: boolean;
  receipt?: { at: string; url: string; text: string };
}

export interface ApplicationSettings {
  enabled: boolean;
  timeZone: string;
  at: string;
  dailyLimit: number;
  resumePath: string;
  resumeHash: string;
  /** Explicit answers only. Exact labels; `[job:<id>] <label>` limits approval to one posting. */
  answers: Record<string, string>;
  preferencesHash: string;
  /** Only explicit user authorization enables checked submission; upgrades never opt in. */
  submissionPolicy: string;
  confirmedFacts: string;
}

export const DEFAULT_APPLICATION_SETTINGS: ApplicationSettings = {
  enabled: false, timeZone: "America/Los_Angeles", at: "09:00", dailyLimit: 5,
  resumePath: "", resumeHash: "", answers: {}, preferencesHash: "",
  submissionPolicy: "", confirmedFacts: "",
};

export function applicationClock(now: Date, timeZone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  return { day: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

/** Only direct ATS URLs; no redirects to employer logins or arbitrary file/network hosts. */
export function applicationUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.hostname === "jobs.ashbyhq.com" && /^\/[^/]+\/[0-9a-f-]{36}(\/application)?\/?$/i.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/application\/?$/, "").replace(/\/$/, "")}/application`;
    } else if (!["job-boards.greenhouse.io", "boards.greenhouse.io"].includes(url.hostname)
      || !/^\/[^/]+\/jobs\/\d+\/?$/.test(url.pathname)) return null;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return null; }
}

/** A Greenhouse confirmation is evidence for that exact requisition, never a new navigation target. */
export function applicationReceiptTarget(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (["job-boards.greenhouse.io", "boards.greenhouse.io"].includes(url.hostname)
      && /^\/[^/]+\/jobs\/\d+\/confirmation\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/confirmation\/?$/, "");
    return applicationUrl(url.href);
  } catch { return null; }
}

/** Project before both model evidence and deterministic approval checks; never expose other jobs' answers. */
export function applicationAnswers(settings: ApplicationSettings, jobId: string): Record<string, string> {
  const entries = Object.entries(settings.answers), prefix = `[job:${jobId}] `;
  const answers = Object.fromEntries(entries.filter(([label]) => !label.startsWith("[job:"))
    .map(([label, value]) => [answerLabel(label), value]));
  for (const [label, value] of entries) if (label.startsWith(prefix)) answers[answerLabel(label.slice(prefix.length))] = value;
  return answers;
}

export function answerLabel(label: string): string {
  return label.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
