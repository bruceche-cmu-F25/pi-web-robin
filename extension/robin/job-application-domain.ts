/** Jobright application workflow owns its evidence and submission boundary on the existing Job row. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute } from "node:path";
import { backgroundRunActive } from "./background-run-domain.ts";
import { dataPath, readJsonObject, updateJsonObject } from "./paths.ts";
import { readJobProfile, readJobs, updateJobs } from "./store.ts";
import { readTaskRecordsForView, readRuntimeState, updateRuntimeState } from "./task-store.ts";
import { standingAnswer } from "../../lib/job-application-review.ts";
import { buildLocationFilter, digestCandidates, jobKey, roleKey, type Job, type JobProfile } from "./jobs.ts";
import { pendingJobCount } from "./job-domain.ts";
import {
  applicationClock, applicationUrl, applicationPostingMatches, answerLabel, DEFAULT_APPLICATION_SETTINGS, APPLICATION_WORKFLOW_VERSION, APPLICATION_SUBMISSION_POLICY, JOBRIGHT_TRUSTED_SUBMISSION_POLICY,
  STANDING_ANSWER_KEYS, applicationAnswers, isRoleSpecificApplicationQuestion, type StandingAnswers, type ApplicationSettings, type JobApplication, type ApplicationSnapshot, type ApplicationReview,
} from "./job-applications.ts";

const SETTINGS_FILE = "job-application-settings.json"; // Configuration only; all runtime state is on Job rows.
export const APPLICATION_RUN = "job-applications";
export const applicationBrowserDirectory = () => dataPath("job-application-browser");
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
export const applicationPreferencesHash = () => hash(readJobProfile().notes);
export function applicationSources(settings = applicationSettings()) {
  return { preferences: readJobProfile().notes, confirmed: `${JSON.stringify({ approvedFormAnswers: settings.answers, standingPersonalAnswers: settings.standing }, null, 2)}\n${settings.confirmedFacts}` };
}
function approvalHash(settings: ApplicationSettings): string {
  const previous = ["jobright-fields-v3", settings.resumeHash, settings.preferencesHash, settings.answers, settings.confirmedFacts, settings.submissionPolicy];
  // Preserve old reservations when the new reusable profile has never been filled.
  return hash(JSON.stringify(Object.keys(settings.standing).length ? [...previous, settings.standing] : previous));
}
const currentWorkflow = (job: Job) => job.application?.workflowVersion === APPLICATION_WORKFLOW_VERSION;

export function applicationSettings(): ApplicationSettings {
  return { ...DEFAULT_APPLICATION_SETTINGS, ...readJsonObject<ApplicationSettings>(SETTINGS_FILE) };
}

function validateApplicationSettings(value: ApplicationSettings): void {
  if (typeof value.enabled !== "boolean" || !Number.isInteger(value.dailyLimit)
    || value.dailyLimit < 0 || value.dailyLimit > 20 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.at)
    || (value.bskBrowserInstanceId !== undefined && !/^[a-zA-Z0-9_-]{1,80}$/.test(value.bskBrowserInstanceId))) {
    throw new Error("Invalid application schedule");
  }
  applicationClock(new Date(), value.timeZone); // Reject unknown time zones.
  if (!value.answers || typeof value.answers !== "object" || Array.isArray(value.answers)
    || Object.keys(value.answers).length > 100
    || Object.entries(value.answers).some(([key, answer]) => !key.trim() || key.length > 1000 || typeof answer !== "string" || answer.length > 10000)) {
    throw new Error("Answers must be a bounded map of approved form labels to text");
  }
  if (!value.standing || typeof value.standing !== "object" || Array.isArray(value.standing)
    || Object.entries(value.standing).some(([key, answer]) => !STANDING_ANSWER_KEYS.includes(key as typeof STANDING_ANSWER_KEYS[number])
      || typeof answer !== "string" || answer.length > 1000
      || (["sponsorshipNow", "sponsorshipFuture", "usWorkAuthorization"].includes(key) && !["", "Yes", "No"].includes(answer)))) {
    throw new Error("Invalid reusable personal answers");
  }
  if (typeof value.confirmedFacts !== "string" || value.confirmedFacts.length > 30000
    || !["", APPLICATION_SUBMISSION_POLICY, JOBRIGHT_TRUSTED_SUBMISSION_POLICY].includes(value.submissionPolicy)) throw new Error("Invalid application authorization");
  if (value.enabled) {
    approvedResume(value);
    if (value.preferencesHash !== applicationPreferencesHash()) throw new Error("Jobs preferences changed; reconfirm the approved answers first");
  }
}

/** Called only with user-approved configuration, never with employer text. */
export function configureApplications(patch: Partial<ApplicationSettings>): ApplicationSettings {
  return updateJsonObject<ApplicationSettings, ApplicationSettings>(SETTINGS_FILE, (stored) => {
    const value = { ...DEFAULT_APPLICATION_SETTINGS, ...stored, ...patch };
    validateApplicationSettings(value);
    return { value, result: value, changed: true };
  });
}

/** Private editor readback; never part of the general Jobs board or agent-visible form text. */
export function applicationAnswerEditor() {
  const { confirmedFacts, answers, standing } = applicationSettings();
  return { confirmedFacts, answers, standing, revision: hash(JSON.stringify([confirmedFacts, standing, answers])) };
}

/** Save the reusable profile in one atomic edit; no employer question or submission policy is changed. */
export function saveApplicationProfile(confirmedFacts: string, standing: StandingAnswers,
  generalAnswers: Record<string, string>, expectedRevision: string): void {
  if (typeof expectedRevision !== "string" || !/^[0-9a-f]{64}$/.test(expectedRevision)
    || !generalAnswers || typeof generalAnswers !== "object" || Array.isArray(generalAnswers)
    || Object.keys(generalAnswers).some((key) => key.startsWith("[job:") || isRoleSpecificApplicationQuestion(key))) {
    throw new Error("Invalid reusable answer; pay choices and legal declarations need approval for each job");
  }
  updateJsonObject<ApplicationSettings, void>(SETTINGS_FILE, (stored) => {
    const value = { ...DEFAULT_APPLICATION_SETTINGS, ...stored };
    if (hash(JSON.stringify([value.confirmedFacts, value.standing, value.answers])) !== expectedRevision) {
      throw new Error("Profile changed elsewhere; reload before saving");
    }
    // Keep job-scoped and historical generic pay/legal answers; the latter never authorize a new job.
    const retained = Object.fromEntries(Object.entries(value.answers).filter(([key]) => key.startsWith("[job:") || isRoleSpecificApplicationQuestion(key)));
    const next = { ...value, confirmedFacts, standing, answers: { ...retained, ...generalAnswers } };
    validateApplicationSettings(next);
    return { value: next, result: undefined, changed: true };
  });
}

/** A lost or overlapping save must not overwrite facts edited in another tab. */
export function saveApplicationFacts(facts: string, expected: string): void {
  if (typeof facts !== "string" || facts.length > 30000 || typeof expected !== "string" || expected.length > 30000) throw new Error("Invalid confirmed facts");
  updateJsonObject<ApplicationSettings, void>(SETTINGS_FILE, (stored) => {
    const value = { ...DEFAULT_APPLICATION_SETTINGS, ...stored };
    if (value.confirmedFacts !== expected) throw new Error("Confirmed facts changed elsewhere; reload before saving");
    if (value.confirmedFacts === facts) return { value, result: undefined, changed: false };
    const next = { ...value, confirmedFacts: facts };
    validateApplicationSettings(next);
    return { value: next, result: undefined, changed: true };
  });
}

/** Each protected answer is approved for one exact question on one real posting. */
export function approveApplicationField(id: string, label: string, answer: string): void {
  if (typeof id !== "string" || !/^[a-z0-9]{1,32}$/i.test(id) || typeof label !== "string" || !label.trim()
    || label.length > 1000 || typeof answer !== "string" || answer.length > 10000) throw new Error("Invalid question approval");
  const job = readJobs([id])[0];
  if (!job?.application || job.application.dismissedAt || !["attention", "review", "error", "blocked"].includes(job.application.stage)
    || !["new", "shortlist"].includes(job.status) || job.application.submission) throw new Error("This application cannot accept new answers");
  const fields = job.application.fields.filter((field) => field.kind !== "file" && answerLabel(field.label) === answerLabel(label));
  if (fields.length !== 1 || (answer && fields[0]!.options?.length && !fields[0]!.options.includes(answer))) {
    throw new Error("Choose one exact form question and an available answer");
  }
  updateJsonObject<ApplicationSettings, void>(SETTINGS_FILE, (stored) => {
    const value = { ...DEFAULT_APPLICATION_SETTINGS, ...stored };
    const prefix = `[job:${id}] `;
    const answers = Object.fromEntries(Object.entries(value.answers).filter(([key]) =>
      !key.startsWith(prefix) || answerLabel(key.slice(prefix.length)) !== answerLabel(label)));
    if (answer.trim()) answers[`${prefix}${fields[0]!.label}`] = answer;
    const next = { ...value, answers };
    validateApplicationSettings(next);
    return { value: next, result: undefined, changed: true };
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

/** Do not mistake a US-only location or a region-restricted Remote for Bay Area/remote work. */
function applicationLocationAllowed(location: string, profile: JobProfile): boolean {
  if (!location.trim()) return false;
  const bayArea = buildLocationFilter({ always: ["Bay Area"], allow: ["Bay Area"], block: [] });
  if (bayArea(location)) return true;
  if (!buildLocationFilter({ always: [], allow: ["Remote"], block: profile.locationBlock })(location)) return false;
  const region = location.match(/\bremote\s*[-–,:]\s*([^·;|]+)/i)?.[1]?.trim();
  return !region || bayArea(region)
    || /^(?:US|USA|United States|CA|California|Global|Worldwide|Anywhere|North America)$/i.test(region);
}

function pendingApplicationQuestions(job: Job, settings: ApplicationSettings): string[] {
  if (!currentWorkflow(job) || job.application?.stage !== "attention" && job.application?.stage !== "blocked") return [];
  const approved = applicationAnswers(settings, job.id);
  return (job.application?.fields ?? []).filter((field) => {
    if (field.kind === "file" || field.check === "matches-approved" || !(field.required || field.value
      || job.application?.review?.decisions.some((decision) => decision.key === field.key && decision.action === "attention"))) return false;
    const label = answerLabel(field.label);
    const saved = approved[label] || (!/\b(experience|explain|describe|tell us|worked|projects|why|how did|how have)\b/i.test(label)
      ? standingAnswer(label, settings) : undefined);
    return !saved || Boolean(field.options?.length && field.options.filter((option) => option.trim().toLowerCase() === saved.trim().toLowerCase()).length !== 1);
  }).map((field) => field.key).filter((key): key is string => Boolean(key));
}

export function applicationCandidates(now = new Date()): Job[] {
  const jobs = readJobs();
  const profile = readJobProfile();
  const settings = applicationSettings();
  const approved = approvalHash(settings);
  const claimed = jobs.filter((job) => job.status === "applied" || job.appliedAt || (currentWorkflow(job) && job.application?.stage !== "unavailable") || job.application?.submission);
  // Notification is not application. Reuse eligibility/freshness gates without suppressing a delivered digest.
  return digestCandidates(jobs.map((job) => ({ ...job, notifiedAt: undefined,
    status: job.status === "shortlist" ? "new" : job.status })), profile, now.getTime(), { exploratoryApplications: true })
    .filter((job) => applicationTarget(job) && applicationLocationAllowed(job.location, profile) && !job.application?.dismissedAt
      && (!currentWorkflow(job) || job.application?.approvalHash !== approved)
      && !(job.application?.stage === "attention" && (!job.application.fields.length || pendingApplicationQuestions(job, settings).length))
      && !["unavailable", "uncertain"].includes(job.application?.stage ?? "") && !job.application?.submission && !job.appliedAt
      && !claimed.some((other) => duplicate(job, other)));
}

type ApplicationReport = {
  day: string; timeZone: string; asOf: string; running: boolean; enabled: boolean;
  attempted: number; confirmed: number; errors: number; shown: number; total: number; attention: number; uncertain: number;
  rows: { id: string; company: string; title: string; stage: JobApplication["stage"]; updatedAt: string; attemptedToday: boolean; receiptAt: string | null }[];
};
type ReportDelivery = { report: ApplicationReport; state: "sending" | "accepted" | "uncertain" | "failed"; owner: string; accepted: number };
export type ApplicationDailyCheck = {
  day: string; timeZone: string; at: string; discovered: number; unscored: number; pendingScoring: number;
  eligible: number; attempted: number; confirmed: number; unresolved: number;
  issues: Array<"scan-stale" | "scan-errors" | "scoring-error" | "scoring-pending" | "supply-empty" | "no-receipts" | "submission-uncertain" | "application-error" | "paused">;
  failures: Array<{ reason: string; count: number; ids: string[] }>;
};
type ReportState = { applicationReports?: Record<string, ReportDelivery>; applicationRunReports?: Record<string, ReportDelivery>;
  applicationChecks?: Record<string, ApplicationDailyCheck>;
  applicationPreflight?: { at: string; message: string }; [key: string]: unknown };
/** A failed read-only browser preflight has no job reservation to attach its reason to. */
export function recordApplicationPreflight(message?: string): void {
  updateRuntimeState<ReportState, void>("job-digest-state.json", stored => {
    const value = { ...stored };
    if (message) value.applicationPreflight = { at: new Date().toISOString(), message: message.slice(0, 250) };
    else delete value.applicationPreflight;
    return { value, result: undefined, changed: true };
  });
}
const reportKey = (report: Pick<ApplicationReport, "day" | "timeZone">, runId?: string) =>
  `${report.day}:${report.timeZone}${runId ? `:run:${runId}` : ""}`;
/** The job digest ledger already owns delivery state; preserve its other fields and never rewrite job records. */
export function claimApplicationReport(report: ApplicationReport, owner: string, runId?: string): boolean {
  return updateRuntimeState<ReportState, boolean>("job-digest-state.json", stored => {
    const key = reportKey(report, runId), state = stored ?? {};
    const field = runId ? "applicationRunReports" : "applicationReports";
    if (state[field]?.[key]) return { value: state, result: false, changed: false };
    const reports = { ...state[field], [key]: { report, state: "sending" as const, owner, accepted: 0 } };
    for (const old of Object.keys(reports).sort().slice(0, runId ? -80 : -20)) delete reports[old];
    return { value: { ...state, [field]: reports }, result: true, changed: true };
  });
}
export function settleApplicationReport(report: ApplicationReport, owner: string, state: ReportDelivery["state"], accepted = 0, runId?: string): void {
  updateRuntimeState<ReportState, void>("job-digest-state.json", stored => {
    const key = reportKey(report, runId), field = runId ? "applicationRunReports" : "applicationReports";
    const saved = stored?.[field]?.[key];
    if (!saved || saved.owner !== owner || saved.state !== "sending") return { value: stored ?? {}, result: undefined, changed: false };
    return { value: { ...stored, [field]: { ...stored![field], [key]: { ...saved, state, accepted } } }, result: undefined, changed: true };
  });
}
export function applicationBoard(now = new Date()) {
  const settings = applicationSettings();
  const day = applicationClock(now, settings.timeZone).day;
  // Readback needs application evidence, not posting text or scoring reviews.
  // Selection/reservation/submission below still use the full records.
  const jobs = readTaskRecordsForView<Job>("jobs", ["description", "review"], () => false);
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
  const attempted = jobs.filter((job) => currentWorkflow(job) && job.application?.days.includes(day)).length;
  const confirmed = jobs.filter((job) => job.application?.receipt && applicationClock(new Date(job.application.receipt.at), settings.timeZone).day === day).length;
  const todayRows = rows.filter(job => currentWorkflow(job) && (job.application!.days.includes(day)
    || (job.application!.receipt && applicationClock(new Date(job.application!.receipt!.at), settings.timeZone).day === day)));
  const pendingRows = rows.filter(job => currentWorkflow(job) && ["attention", "uncertain"].includes(job.application!.stage) && !todayRows.includes(job));
  const reportRows = [...todayRows, ...pendingRows].slice(0, 40).map(job => ({ id: job.id, company: job.company, title: job.title,
    stage: job.application!.stage, updatedAt: job.application!.updatedAt, attemptedToday: job.application!.days.includes(day),
    receiptAt: job.application!.receipt?.at ?? null }));
  const liveReport: ApplicationReport = { day, timeZone: settings.timeZone, asOf: now.toISOString(), running, enabled: settings.enabled,
    attempted, confirmed, errors: todayRows.filter(job => job.application!.stage === "error").length,
    shown: reportRows.length, total: todayRows.length + pendingRows.length,
    attention: rows.filter(job => currentWorkflow(job) && job.application!.stage === "attention").length,
    uncertain: rows.filter(job => currentWorkflow(job) && job.application!.stage === "uncertain").length,
    rows: reportRows };
  const reportState = readRuntimeState<ReportState>("job-digest-state.json");
  const saved = reportState?.applicationReports?.[reportKey(liveReport)];
  // Never age unresolved decisions or post-Submit uncertainty out of the workbench's 100-row history window.
  const followUp = (job: Job) => currentWorkflow(job) && (["attention", "uncertain", "error", "unavailable"].includes(job.application!.stage)
    || job.application!.stage === "blocked" && pendingApplicationQuestions(job, settings).length > 0);
  const visibleRows = rows.filter((job, index) => index < 100 || followUp(job));
  return {
    report: { ...liveReport, delivery: saved ? saved.state === "sending" ? "uncertain" as const : saved.state : "not-sent" as const,
      pushEnabled: process.env.ROBIN_JOB_APPLICATION_REPORT_ENABLED === "1" },
    settings: { enabled: settings.enabled, timeZone: settings.timeZone, at: settings.at,
      autoSubmit: settings.submissionPolicy === JOBRIGHT_TRUSTED_SUBMISSION_POLICY && process.env.ROBIN_BSK_APPLICATIONS_READY === "1",
      dailyLimit: settings.dailyLimit, resumeName: basename(settings.resumePath), resumeHash: settings.resumeHash,
      configured: Boolean(settings.resumeHash && settings.preferencesHash),
      preferencesChanged: Boolean(settings.preferencesHash && settings.preferencesHash !== preferencesHash) },
    running, day, preflightError: reportState?.applicationPreflight ?? null,
    dailyCheck: Object.entries(reportState?.applicationChecks ?? {}).sort(([a], [b]) => b.localeCompare(a))[0]?.[1] ?? null,
    today: attempted,
    todaySubmitted: confirmed,
    legacy: rows.filter((job) => !currentWorkflow(job)).length,
    counts: Object.fromEntries(["preparing", "review", "blocked", "attention", "error", "unavailable", "submitting", "uncertain", "submitted"].map((stage) => [stage, rows.filter((job) => currentWorkflow(job) && job.application!.stage === stage).length])),
    total: rows.length,
    rows: visibleRows.map((job) => ({ id: job.id, company: job.company, title: job.title, status: job.status,
      pendingQuestionKeys: pendingApplicationQuestions(job, settings), application: job.application! })),
  };
}

/** One read-only audit per local day. Preserve reason categories and job ids, never form text or raw browser output. */
export function recordDailyApplicationCheck(now = new Date()): ApplicationDailyCheck | null {
  const settings = applicationSettings();
  const clock = applicationClock(now, settings.timeZone);
  if (clock.time < "19:30") return null;
  const key = `${clock.day}:${settings.timeZone}`;
  const saved = readRuntimeState<ReportState>("job-digest-state.json")?.applicationChecks?.[key];
  if (saved) return saved;
  const board = applicationBoard(now);
  if (board.running) return null; // Do not freeze a partial run.
  const jobs = readTaskRecordsForView<Job>("jobs", ["description", "review"], () => false);
  const today = jobs.filter(job => job.application?.workflowVersion === APPLICATION_WORKFLOW_VERSION
    && job.application.days.includes(clock.day));
  const discovered = jobs.filter(job => job.discoveredAt && applicationClock(new Date(job.discoveredAt), settings.timeZone).day === clock.day);
  const scan = readRuntimeState<{ finishedAt?: string; history?: Array<{ errors?: number }> }>("job-scan.json");
  const scoring = readRuntimeState<{ error?: string | null }>("job-scoring.json");
  const pendingScoring = pendingJobCount();
  const eligible = applicationCandidates(now).length;
  const issues: ApplicationDailyCheck["issues"] = [];
  if (!scan?.finishedAt || now.getTime() - Date.parse(scan.finishedAt) > 36 * 60 * 60_000) issues.push("scan-stale");
  if ((scan?.history?.at(-1)?.errors ?? 0) > 0) issues.push("scan-errors");
  if (scoring?.error) issues.push("scoring-error");
  if (pendingScoring) issues.push("scoring-pending");
  if (!eligible) issues.push("supply-empty");
  if (board.today && !board.todaySubmitted) issues.push("no-receipts");
  if (today.some(job => ["uncertain", "submitting"].includes(job.application!.stage))) issues.push("submission-uncertain");
  if (today.some(job => job.application!.stage === "error")) issues.push("application-error");
  if (!settings.enabled) issues.push("paused");
  const failures = new Map<string, string[]>();
  for (const job of today) {
    const app = job.application!;
    const reason = app.stage === "uncertain" || app.stage === "submitting" ? "SUBMISSION_UNCERTAIN"
      : app.stage === "attention" ? "ANSWER_REQUIRED"
      : app.stage === "error" ? /^(JOBRIGHT_INCOMPLETE|APPLICATION_FORM_UNAVAILABLE|SUBMIT_CONTROL_UNAVAILABLE|BSK_[A-Z_]+)/.exec(app.blockers[0] ?? "")?.[1] ?? "UNCLASSIFIED_ERROR"
      : null;
    if (reason) failures.set(reason, [...(failures.get(reason) ?? []), job.id]);
  }
  const check: ApplicationDailyCheck = { day: clock.day, timeZone: settings.timeZone, at: now.toISOString(),
    discovered: discovered.length, unscored: discovered.filter(job => typeof job.score !== "number").length,
    pendingScoring, eligible, attempted: board.today, confirmed: board.todaySubmitted,
    unresolved: board.counts.uncertain, issues,
    failures: [...failures].map(([reason, ids]) => ({ reason, count: ids.length, ids: ids.slice(0, 20) })) };
  return updateRuntimeState<ReportState, ApplicationDailyCheck>("job-digest-state.json", stored => {
    if (stored?.applicationChecks?.[key]) return { value: stored, result: stored.applicationChecks[key], changed: false };
    const checks = { ...stored?.applicationChecks, [key]: check };
    for (const old of Object.keys(checks).sort().slice(0, -14)) delete checks[old];
    return { value: { ...stored, applicationChecks: checks }, result: check, changed: true };
  });
}

/** User declines a blocked/attention application: drop the Job and retire its question list atomically. */
export function dropApplication(id: string, now = new Date()): void {
  updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === id);
    if (!job?.application || !["new", "shortlist"].includes(job.status)
      || !["attention", "blocked"].includes(job.application.stage)
      || job.application.submission || job.application.receipt || job.application.dismissedAt) {
      throw new Error("Only an unresolved, unsubmitted application can be dropped");
    }
    job.status = "dropped";
    job.application.dismissedAt = now.toISOString();
    return { value: undefined, changed: true };
  }, [id]);
}

/** List cleanup only: keep attempts, receipts, submission locks and the user's job status. */
export function dismissApplication(id: string, now = new Date()): void {
  updateJobs((jobs) => {
    const application = jobs.find((job) => job.id === id)?.application;
    if (!application) throw new Error("Application record no longer exists");
    if (application.dismissedAt) return { value: undefined, changed: false };
    application.dismissedAt = now.toISOString();
    return { value: undefined, changed: true };
  }, [id]);
}

export function applicationJob(id: string): Job {
  const job = readJobs([id])[0];
  if (!job) throw new Error("Job no longer exists");
  return job;
}

/** Requires the full collection: reservation/submission check other roles' duplicate locks. */
function preparableJob(jobs: Job[], id: string): Job {
  const job = jobs.find((entry) => entry.id === id);
  if (!job || !["new", "shortlist"].includes(job.status) || job.appliedAt || job.application?.submission || ["submitted", "uncertain"].includes(job.application?.stage ?? "")) throw new Error("Job is no longer available for preparation");
  if (!applicationTarget(job)) throw new Error("Board adapter unavailable (currently Ashby/Greenhouse); no autofill or submission attempted.");
  if (jobs.some((other) => duplicate(job, other) && (other.appliedAt || other.status === "applied" || other.appliedAt || (currentWorkflow(other) && other.application?.stage !== "unavailable") || other.application?.submission))) throw new Error("This role already has an application or preparation record");
  return job;
}

/** Surface input errors before an HTTP adapter starts detached work; reservation rechecks under its lock. */
export function checkApplicationPreparation(id?: string): void {
  const settings = applicationSettings();
  approvedResume(settings);
  if (settings.preferencesHash !== applicationPreferencesHash()) throw new Error("Jobs preferences changed; reconfirm the approved answers first");
  if (id) preparableJob(readJobs(), id);
}

/** A reservation counts even when attach fails; owned callers serialize browser work around this mutation. */
export function reserveApplication(id: string, settings: ApplicationSettings, now = new Date()): Job {
  return updateJobs((jobs) => {
    const job = preparableJob(jobs, id);
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
  }, [id]);
}

/** Short durable gate before the browser click; no network calls occur under this mutation. */
export function grantApplicationSubmission(id: string, attemptId: string, snapshot: ApplicationSnapshot, review: ApplicationReview) {
  const settings = applicationSettings();
  if (![APPLICATION_SUBMISSION_POLICY, JOBRIGHT_TRUSTED_SUBMISSION_POLICY].includes(settings.submissionPolicy)) throw new Error("Submission has not been authorized");
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
    const job = preparableJob(jobs, id);
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
      || !applicationPostingMatches(rejection.url, app.url, job!.url)
      || Date.parse(rejection.at) < Date.parse(app.submission.grantedAt)) throw new Error("Rejection does not belong to this submission attempt");
    app.rejections = [...(app.rejections ?? []), { ...rejection, attemptId }].slice(-5);
    delete app.submission;
    Object.assign(app, { stage: "error", phase: "Server validation rejected; rebuild required", blockers: [rejection.text], updatedAt: rejection.at });
    return { value: undefined, changed: true };
  }, [id]);
}

export function uncertainApplicationSubmission(id: string, attemptId: string, reason: string): void {
  updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === id);
    if (!job?.application?.submission || job.application.attemptId !== attemptId || job.application.stage === "submitted") return { value: undefined, changed: false };
    Object.assign(job.application, { stage: "uncertain", blockers: [reason], updatedAt: new Date().toISOString() });
    return { value: undefined, changed: true };
  }, [id]);
}

/** Unverified external submission evidence is not a receipt. Lock against another attempt. */
export function holdUnverifiedApplication(id: string, reason: string, phase: string): void {
  updateJobs((jobs) => {
    const app = jobs.find((job) => job.id === id)?.application;
    if (!app || app.stage === "submitted") throw new Error("No unconfirmed application attempt to lock");
    Object.assign(app, { stage: "uncertain", phase, blockers: [reason], updatedAt: new Date().toISOString() });
    return { value: undefined, changed: true };
  }, [id]);
}

/** Only the receipt inspector calls this. No HTTP endpoint accepts a client-supplied receipt. */
export function pendingApplicationEmailReceipts(): Job[] {
  return readJobs().filter((job) => job.application?.submission && !job.application.receipt
    && ["submitting", "uncertain"].includes(job.application.stage));
}

/** An email can identify one submission only if no other pending job shares its employer. */
export function confirmApplicationEmailReceipt(id: string, attemptId: string, mail: {
  id: string; from: string; subject: string; bodyText: string; date: string; bodyIncomplete?: boolean;
}): boolean {
  const sender = mail.from.match(/<([^<>]+)>/)?.[1] ?? mail.from;
  if (sender.toLowerCase() !== "no-reply@us.greenhouse-mail.io" || !/^[a-zA-Z0-9_-]{8,128}$/.test(mail.id)
    || mail.bodyIncomplete || mail.bodyText.length > 30000
    || !/\b(?:your application has been received|we have received your application)\b/i.test(mail.bodyText)) return false;
  const companyInSubject = mail.subject.match(/^(?:thank you for applying to|(?:.+,\s*)?we.ve received your application to)\s+(.+)$/i)?.[1];
  if (!companyInSubject) return false;
  const companyKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === id), app = job?.application;
    const at = Date.parse(mail.date), submittedAt = Date.parse(app?.submission?.grantedAt ?? "");
    if (!app?.submission || app.attemptId !== attemptId || app.receipt || !["submitting", "uncertain"].includes(app.stage)
      || !Number.isFinite(at) || at < submittedAt || at - submittedAt > 24 * 60 * 60_000
      || companyKey(companyInSubject) !== companyKey(job!.company)
      || jobs.some((entry) => entry.application?.receipt?.mailId === mail.id)
      || jobs.filter((entry) => companyKey(entry.company) === companyKey(job!.company)
        && entry.application?.submission && !entry.application.receipt
        && ["submitting", "uncertain"].includes(entry.application.stage)).length !== 1) {
      return { value: false, changed: false };
    }
    app.receipt = { at: mail.date, url: app.url, text: "Employer confirmation email: application received; matched to the unique pending Robin submission.", source: "email", mailId: mail.id };
    Object.assign(app, { stage: "submitted", phase: "Employer email confirmed", updatedAt: mail.date, blockers: [] });
    job!.status = "applied"; job!.appliedAt ??= mail.date;
    return { value: true, changed: true };
  });
}

export function confirmApplicationReceipt(id: string, attemptId: string, receipt: NonNullable<JobApplication["receipt"]>): void {
  if (!receipt.text.trim() || !Number.isFinite(Date.parse(receipt.at))) throw new Error("Missing submission receipt");
  updateJobs((jobs) => {
    const job = jobs.find((entry) => entry.id === id);
    if (!job?.application || job.application.attemptId !== attemptId) throw new Error("Application changed; check its current state");
    if (!applicationPostingMatches(receipt.url, job.application.url, job.url, true)) throw new Error("Receipt belongs to a different posting");
    job.application = { ...job.application, stage: "submitted", phase: "Receipt confirmed", receipt, updatedAt: receipt.at, blockers: [] };
    job.status = "applied";
    job.appliedAt ??= receipt.at;
    return { value: undefined, changed: true };
  }, [id]);
}
