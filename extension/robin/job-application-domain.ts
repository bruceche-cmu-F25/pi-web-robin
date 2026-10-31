/** Jobright application workflow owns its evidence and submission boundary on the existing Job row. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute } from "node:path";
import { backgroundRunActive } from "./background-run-domain.ts";
import { dataPath, readJsonObject, updateJsonObject } from "./paths.ts";
import { readJobProfile, readJobs, updateJobs } from "./store.ts";
import { digestCandidates, jobKey, roleKey, type Job } from "./jobs.ts";
import {
  applicationClock, applicationUrl, applicationReceiptTarget, DEFAULT_APPLICATION_SETTINGS, APPLICATION_WORKFLOW_VERSION, APPLICATION_SUBMISSION_POLICY,
  type ApplicationSettings, type JobApplication, type ApplicationSnapshot, type ApplicationReview,
} from "./job-applications.ts";

const SETTINGS_FILE = "job-application-settings.json"; // Configuration only; all runtime state is on Job rows.
export const APPLICATION_RUN = "job-applications";
export const applicationBrowserDirectory = () => dataPath("job-application-browser");
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
export const applicationPreferencesHash = () => hash(readJobProfile().notes);
export function applicationSources(settings = applicationSettings()) {
  return { preferences: readJobProfile().notes, confirmed: `${JSON.stringify(settings.answers, null, 2)}\n${settings.confirmedFacts}` };
}
function approvalHash(settings: ApplicationSettings): string {
  return hash(JSON.stringify(["jobright-fields-v3", settings.resumeHash, settings.preferencesHash, settings.answers, settings.confirmedFacts, settings.submissionPolicy]));
}
const currentWorkflow = (job: Job) => job.application?.workflowVersion === APPLICATION_WORKFLOW_VERSION;

export function applicationSettings(): ApplicationSettings {
  return { ...DEFAULT_APPLICATION_SETTINGS, ...readJsonObject<ApplicationSettings>(SETTINGS_FILE) };
}

/** Called only with user-approved configuration, never with employer text. */
export function configureApplications(patch: Partial<ApplicationSettings>): ApplicationSettings {
  return updateJsonObject<ApplicationSettings, ApplicationSettings>(SETTINGS_FILE, (stored) => {
    const value = { ...DEFAULT_APPLICATION_SETTINGS, ...stored, ...patch };
    if (typeof value.enabled !== "boolean" || !Number.isInteger(value.dailyLimit)
      || value.dailyLimit < 1 || value.dailyLimit > 20 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.at)) {
      throw new Error("Invalid application schedule");
    }
    applicationClock(new Date(), value.timeZone); // Reject unknown time zones.
    if (!value.answers || typeof value.answers !== "object" || Array.isArray(value.answers)
      || Object.keys(value.answers).length > 100
      || Object.entries(value.answers).some(([key, answer]) => !key.trim() || key.length > 1000 || typeof answer !== "string" || answer.length > 10000)) {
      throw new Error("Answers must be a bounded map of approved form labels to text");
    }
    if (typeof value.confirmedFacts !== "string" || value.confirmedFacts.length > 30000
      || !["", APPLICATION_SUBMISSION_POLICY].includes(value.submissionPolicy)) throw new Error("Invalid application authorization");
    if (value.enabled) {
      approvedResume(value);
      if (value.preferencesHash !== applicationPreferencesHash()) throw new Error("Jobs preferences changed; reconfirm the approved answers first");
    }
    return { value, result: value, changed: true };
  });
}

/** Approved factual reference for answer audits only, never the browser upload. A changed source needs approval. */
export function approvedResume(settings = applicationSettings()): { name: string; base64: string; sha256: string } {
  if (!isAbsolute(settings.resumePath) || extname(settings.resumePath).toLowerCase() !== ".pdf") throw new Error("Choose an approved PDF resume first");
  const stat = statSync(settings.resumePath);
  if (!stat.isFile() || stat.size > 5_000_000) throw new Error("Resume must be a regular PDF under 5 MB");
  const bytes = readFileSync(settings.resumePath);
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || hash(bytes) !== settings.resumeHash) {
    throw new Error("Approved resume is missing or has changed; review the PDF before continuing");
  }
  return { name: basename(settings.resumePath), base64: bytes.toString("base64"), sha256: settings.resumeHash };
}

function duplicate(job: Job, other: Job): boolean {
  return job.id !== other.id && (roleKey(job) === roleKey(other)
    || [other.url, ...(other.alternateUrls ?? [])].some((url) => jobKey(url) === jobKey(job.url)));
}

function applicationTarget(job: Job): string | null {
  return [job.url, ...(job.alternateUrls ?? [])].map(applicationUrl).find(Boolean) ?? null;
}

export function applicationCandidates(now = new Date()): Job[] {
  const jobs = readJobs();
  const approved = approvalHash(applicationSettings());
  const claimed = jobs.filter((job) => job.status === "applied" || job.appliedAt || (currentWorkflow(job) && job.application?.stage !== "unavailable") || job.application?.submission);
  // Notification is not application. Reuse eligibility/freshness gates without suppressing a delivered digest.
  return digestCandidates(jobs.map((job) => ({ ...job, notifiedAt: undefined,
    status: job.status === "shortlist" ? "new" : job.status })), readJobProfile(), now.getTime())
    .filter((job) => !job.application?.dismissedAt && (!currentWorkflow(job) || job.application?.approvalHash !== approved) && job.application?.stage !== "unavailable" && !job.application?.submission && !job.appliedAt && !claimed.some((other) => duplicate(job, other)))
    .sort((a, b) => Number(Boolean(applicationTarget(b))) - Number(Boolean(applicationTarget(a))));
}

export function applicationBoard(now = new Date()) {
  const settings = applicationSettings();
  const day = applicationClock(now, settings.timeZone).day;
  const jobs = readJobs();
  const running = backgroundRunActive(APPLICATION_RUN);
  const preferencesHash = applicationPreferencesHash();
  const rows = jobs.filter((job) => job.application && !job.application.dismissedAt).sort((a, b) => b.application!.updatedAt.localeCompare(a.application!.updatedAt))
    .map((job) => job.application!.stage === "submitting" && !running
      ? { ...job, application: { ...job.application!, stage: "uncertain" as const, blockers: ["Submission was interrupted. Check the receipt; do not apply again."] } }
      : job.application!.stage === "preparing" && !running
      ? { ...job, application: { ...job.application!, stage: "error" as const,
        blockers: ["Workflow was interrupted before submission. It can be retried."] } }
      : !job.application!.submission && job.application!.stage !== "submitted" && job.application!.stage !== "unavailable" && (job.application!.resumeHash !== settings.resumeHash || job.application!.preferencesHash !== preferencesHash || (currentWorkflow(job) && job.application!.approvalHash !== approvalHash(settings)))
        ? { ...job, application: { ...job.application!, stage: "blocked" as const,
          blockers: ["Approved sources or workflow rules changed. This is historical read-back evidence; prepare again before relying on it.", ...job.application!.blockers] } }
        : job);
  return {
    settings: { enabled: settings.enabled, timeZone: settings.timeZone, at: settings.at,
      autoSubmit: settings.submissionPolicy === APPLICATION_SUBMISSION_POLICY,
      dailyLimit: settings.dailyLimit, resumeName: basename(settings.resumePath), resumeHash: settings.resumeHash,
      configured: Boolean(settings.resumeHash && settings.preferencesHash),
      preferencesChanged: Boolean(settings.preferencesHash && settings.preferencesHash !== preferencesHash) },
    running, day,
    today: jobs.filter((job) => currentWorkflow(job) && job.application?.days.includes(day)).length,
    todaySubmitted: jobs.filter((job) => job.application?.receipt && applicationClock(new Date(job.application.receipt.at), settings.timeZone).day === day).length,
    legacy: rows.filter((job) => !currentWorkflow(job)).length,
    counts: Object.fromEntries(["preparing", "review", "blocked", "attention", "error", "unavailable", "submitting", "uncertain", "submitted"].map((stage) => [stage, rows.filter((job) => currentWorkflow(job) && job.application!.stage === stage).length])),
    total: rows.length,
    rows: rows.slice(0, 100).map(({ id, company, title, status, application }) => ({ id, company, title, status,
      application: application! })),
  };
}

/** List cleanup only: keep attempts, receipts, submission locks and the user's job status. */
export function dismissApplication(id: string, now = new Date()): void {
  updateJobs((jobs) => {
    const application = jobs.find((job) => job.id === id)?.application;
    if (!application) throw new Error("Application record no longer exists");
    if (application.dismissedAt) return { value: undefined, changed: false };
    application.dismissedAt = now.toISOString();
    return { value: undefined, changed: true };
  });
}

export function applicationJob(id: string): Job {
  const job = readJobs().find((entry) => entry.id === id);
  if (!job) throw new Error("Job no longer exists");
  return job;
}

function preparableJob(jobs: Job[], id: string, settings: ApplicationSettings, now: Date): Job {
  const job = jobs.find((entry) => entry.id === id);
  if (!job || !["new", "shortlist"].includes(job.status) || job.appliedAt || job.application?.submission || job.application?.stage === "submitted") throw new Error("Job is no longer available for preparation");
  if (jobs.some((other) => duplicate(job, other) && (other.appliedAt || other.status === "applied" || other.appliedAt || (currentWorkflow(other) && other.application?.stage !== "unavailable") || other.application?.submission))) throw new Error("This role already has an application or preparation record");
  const day = applicationClock(now, settings.timeZone).day;
  if (!(currentWorkflow(job) && job.application?.days.includes(day)) && jobs.filter((row) => currentWorkflow(row) && row.application?.days.includes(day)).length >= settings.dailyLimit) throw new Error("Today's application limit has been reached");
  return job;
}

/** Surface input errors before an HTTP adapter starts detached work; reservation rechecks under its lock. */
export function checkApplicationPreparation(id?: string): void {
  const settings = applicationSettings();
  approvedResume(settings);
  if (settings.preferencesHash !== applicationPreferencesHash()) throw new Error("Jobs preferences changed; reconfirm the approved answers first");
  if (id) preparableJob(readJobs(), id, settings, new Date());
}

/** A reservation counts even when attach fails; owned callers serialize browser work around this mutation. */
export function reserveApplication(id: string, settings: ApplicationSettings, now = new Date()): Job {
  return updateJobs((jobs) => {
    const job = preparableJob(jobs, id, settings, now);
    const day = applicationClock(now, settings.timeZone).day;
    job.application = {
      attemptId: randomUUID(), workflowVersion: APPLICATION_WORKFLOW_VERSION, approvalHash: approvalHash(settings),
      phase: "Jobright Autofill", stage: "preparing", startedAt: now.toISOString(), updatedAt: now.toISOString(),
      rejections: job.application?.rejections,
      days: [...new Set([...(currentWorkflow(job) ? job.application?.days ?? [] : []), day])].slice(-90),
      url: applicationTarget(job) ?? job.url, resumeHash: settings.resumeHash, preferencesHash: settings.preferencesHash,
      fields: [], blockers: [], resumeVerified: false,
    };
    return { value: job, changed: true };
  });
}

export function saveApplicationResult(id: string, attemptId: string, result: Pick<JobApplication, "stage" | "fields" | "blockers" | "resumeVerified"> & Partial<Pick<JobApplication, "phase" | "autofill" | "review">>): void {
  if (!["preparing", "review", "blocked", "attention", "error", "unavailable"].includes(result.stage)) throw new Error("Preparation cannot mark a job submitted");
  updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === id);
    if (!job?.application || job.application.attemptId !== attemptId || job.application.submission || job.application.stage === "submitted") return { value: undefined, changed: false };
    Object.assign(job.application, result, { updatedAt: new Date().toISOString() });
    return { value: undefined, changed: true };
  });
}

/** Short durable gate before the browser click; no network calls occur under this mutation. */
export function grantApplicationSubmission(id: string, attemptId: string, snapshot: ApplicationSnapshot, review: ApplicationReview) {
  const settings = applicationSettings();
  if (settings.submissionPolicy !== APPLICATION_SUBMISSION_POLICY) throw new Error("Checked submission has not been authorized");
  approvedResume(settings);
  if (settings.preferencesHash !== applicationPreferencesHash()) throw new Error("Preferences changed during validation");
  if (!snapshot.fields.length || !snapshot.autofill?.completedAt || !snapshot.resumeVerified || snapshot.errors.length || review.issues.length
    || review.decisions.length !== snapshot.fields.length || new Set(review.decisions.map((decision) => decision.key)).size !== snapshot.fields.length
    || review.decisions.some((decision) => decision.action === "attention")
    || snapshot.fields.some((field) => field.pendingSelection || (field.required && !field.value))
    || snapshot.fields.some((field) => !review.decisions.some((decision) => decision.key === field.key && decision.action !== "attention" && decision.value === field.value))) {
    throw new Error("The full form has not passed read-back validation");
  }
  return updateJobs((jobs) => {
    const job = preparableJob(jobs, id, settings, new Date());
    if (job.application!.attemptId !== attemptId || job.application!.approvalHash !== approvalHash(settings)) throw new Error("Application or approved sources changed");
    const grant = { grantedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
      fingerprint: hash(JSON.stringify(snapshot)), nonce: randomUUID() };
    Object.assign(job.application!, { submission: grant, stage: "submitting", phase: "Submit", updatedAt: grant.grantedAt,
      fields: snapshot.fields.map((field) => ({ ...field, check: "matches-approved", source: review.decisions.find((decision) => decision.key === field.key)?.quote })),
      autofill: snapshot.autofill, resumeVerified: true, review, blockers: [] });
    return { value: grant, changed: true };
  });
}

/** A narrow, observed ATS validation rejection is different from a missing/ambiguous receipt. */
export function confirmApplicationRejection(id: string, attemptId: string, rejection: { at: string; url: string; text: string }): void {
  if (!/^Missing entry for required field: .+/.test(rejection.text) || rejection.text.length > 1000 || !Number.isFinite(Date.parse(rejection.at))) throw new Error("No definitive validation rejection");
  updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === id), app = job?.application;
    if (!app?.submission || app.attemptId !== attemptId || app.stage === "submitted"
      || applicationUrl(rejection.url) !== applicationUrl(app.url) || !applicationUrl(rejection.url)
      || Date.parse(rejection.at) < Date.parse(app.submission.grantedAt)) throw new Error("Rejection does not belong to this submission attempt");
    app.rejections = [...(app.rejections ?? []), { ...rejection, attemptId }].slice(-5);
    delete app.submission;
    Object.assign(app, { stage: "error", phase: "Server validation rejected; rebuild required", blockers: [rejection.text], updatedAt: rejection.at });
    return { value: undefined, changed: true };
  });
}

export function uncertainApplicationSubmission(id: string, attemptId: string, reason: string): void {
  updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === id);
    if (!job?.application?.submission || job.application.attemptId !== attemptId || job.application.stage === "submitted") return { value: undefined, changed: false };
    Object.assign(job.application, { stage: "uncertain", blockers: [reason], updatedAt: new Date().toISOString() });
    return { value: undefined, changed: true };
  });
}

/** Only the receipt inspector calls this. No HTTP endpoint accepts a client-supplied receipt. */
export function confirmApplicationReceipt(id: string, attemptId: string, receipt: NonNullable<JobApplication["receipt"]>): void {
  if (!receipt.text.trim() || !Number.isFinite(Date.parse(receipt.at))) throw new Error("Missing submission receipt");
  updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === id);
    if (!job?.application || job.application.attemptId !== attemptId) throw new Error("Application changed; check its current state");
    if (applicationReceiptTarget(receipt.url) !== applicationUrl(job.application.url) || !applicationReceiptTarget(receipt.url)) throw new Error("Receipt belongs to a different posting");
    job.application = { ...job.application, stage: "submitted", phase: "Receipt confirmed", receipt, updatedAt: receipt.at, blockers: [] };
    job.status = "applied";
    job.appliedAt ??= receipt.at;
    return { value: undefined, changed: true };
  });
}
