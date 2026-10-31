import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { applicationPage } from "../scripts/job-application-page.mjs";
import { playwrightExtensionToken } from "../extension/robin/settings.ts";
import { executeBackgroundRun } from "../extension/robin/background-run-domain.ts";
import {
  APPLICATION_RUN, applicationBoard, applicationBrowserDirectory, applicationCandidates, applicationJob,
  applicationPreferencesHash, applicationSettings, applicationSources, approvedResume, confirmApplicationReceipt,
  grantApplicationSubmission, reserveApplication, saveApplicationResult, uncertainApplicationSubmission, confirmApplicationRejection,
} from "../extension/robin/job-application-domain.ts";
import { APPLICATION_SUBMISSION_POLICY, applicationClock, applicationUrl, applicationAnswers, type ApplicationSnapshot, type ApplicationReview, type JobApplication } from "../extension/robin/job-applications.ts";
import { applicationReadBackProblems, loadApplicationCV, reviewApplication } from "./job-application-review.ts";
import type { Job } from "../extension/robin/jobs.ts";

const exec = promisify(execFile);
type Mode = "prepare" | "inspect" | "focus" | "receipt";
type BrowserMode = "autofill" | "repair" | "submit" | "inspect" | "focus" | "receipt";
const messages: Record<string, string> = {
  DRAFT_MISSING: "Draft tab is unavailable. Retry only if no submission has been attempted.",
  POSTING_CHANGED: "The page left the expected posting; no further form changes were made.",
  POSTING_UNAVAILABLE: "The employer displays a missing/unavailable posting. No autofill or submission was attempted; do not retry it as a form error.",
  POSTING_TITLE_MISMATCH: "Posting title differs from the saved role; identity needs investigation.",
  POSTING_COMPANY_MISMATCH: "Employer identity could not be verified from the ATS tenant, page or logo.",
  JOBRIGHT_MISSING: "Jobright extension did not appear; check the extension on this site.",
  JOBRIGHT_SIGNIN: "Jobright needs you to sign in or finish account setup.",
  JOBRIGHT_NOT_READY: "Jobright's Autofill control did not become ready; this is not evidence that you need to sign in.",
  JOBRIGHT_INCOMPLETE: "Jobright Autofill did not reach its completion report.",
  FORM_CHANGED: "The form changed after review; it must be read and validated again.",
  FORM_CONTROL_UNAVAILABLE: "A form control is hidden, disabled or unavailable; no click was made.",
  NO_RECEIPT: "No unambiguous receipt found. Do not submit again to retry this check.",
  WORKFLOW_TIMEOUT: "Browser operation timed out.",
  SUBMISSION_GRANT_EXPIRED: "Submission authorization expired before the browser click.",
  SUBMISSION_ALREADY_ATTEMPTED: "This attempt already reached the submission boundary; automatic retry is prohibited.",
  SUBMIT_CONTROL_UNAVAILABLE: "The final submit control is missing, ambiguous or disabled.",
};

/** Fixed program, bounded JSON input, token-redacted errors. The model never receives a browser execution tool. */
async function browser(job: Job, mode: BrowserMode, signal: AbortSignal, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const token = playwrightExtensionToken();
  if (!token) throw new Error("Save the Playwright Extension token in Robin Settings first.");
  const url = applicationUrl(job.application!.url);
  if (!url) throw new Error("Board adapter unavailable (currently Ashby/Greenhouse); no autofill or submission attempted.");
  const cwd = applicationBrowserDirectory(); mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV, PLAYWRIGHT_MCP_EXTENSION_TOKEN: token };
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR", "DISPLAY", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "LOCALAPPDATA", "APPDATA", "PLAYWRIGHT_BROWSERS_PATH"]) if (process.env[key]) env[key] = process.env[key];
  const cli = async (args: string[], timeout = 185000) => {
    signal.throwIfAborted();
    try {
      const { stdout } = await exec("playwright-cli", ["-s=robin-job-applications", "--raw", ...args], { cwd, env, signal, timeout, maxBuffer: 2000000 });
      if (/^### Error/m.test(stdout)) throw new Error("CLI error");
      return stdout.trim();
    } catch { throw new Error("Browser transport failed. This is an automation error, not a request to refill the form manually."); }
  };
  try {
    const probe = JSON.parse(await cli(["run-code", "async page => ({ connected: true })"], 8000));
    if (!probe.connected) throw new Error("Not connected");
  } catch { await cli(["attach", "--extension=chrome"]); }
  const payload = { id: job.id, attemptId: job.application!.attemptId, url, title: job.title, company: job.company, mode, ...extra };
  const file = join(cwd, `run-${randomUUID()}.js`);
  writeFileSync(file, `async page => { try { return await (${applicationPage.toString()})(page, ${JSON.stringify(payload)}); } catch (error) { return { failure: Object.keys(${JSON.stringify(messages)}).find(key => String(error).includes(key)) || "BROWSER_FAILED", diagnostic: String(error).match(/(?:locator|page)\\.\\w+: Timeout \\d+ms exceeded/)?.[0] || (["Error", "TimeoutError", "TypeError", "ReferenceError"].includes(error.name) ? error.name : "Unknown error") }; } }`, { mode: 0o600 });
  try {
    let result: Record<string, unknown>;
    try { result = JSON.parse(await cli(["run-code", `--filename=${file}`])); } catch { throw new Error("Browser operation did not return a usable result"); }
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid browser result");
    if (typeof result.failure === "string") throw Object.assign(new Error(messages[result.failure] ?? `Browser ${mode} failed (${result.diagnostic}); technical investigation needed`), { code: result.failure });
    return result;
  } finally { rmSync(file, { force: true }); }
}

function readSnapshot(result: Record<string, unknown>): ApplicationSnapshot {
  const state = result.snapshot as ApplicationSnapshot;
  if (!state || !Array.isArray(state.fields) || state.fields.length > 150 || !state.fields.every((field) => field
    && typeof field.key === "string" && typeof field.label === "string" && field.label.length <= 1000
    && typeof field.value === "string" && field.value.length <= 10000 && typeof field.kind === "string"
    && typeof field.required === "boolean" && (field.pendingSelection === undefined || typeof field.pendingSelection === "boolean") && (field.canClear === undefined || typeof field.canClear === "boolean") && Array.isArray(field.options) && field.options.length <= 200
    && field.options.every((option) => typeof option === "string" && option.length <= 10000))
    || new Set(state.fields.map((field) => field.key)).size !== state.fields.length
    || typeof state.resumeVerified !== "boolean" || !Array.isArray(state.errors) || state.errors.length > 30
    || !state.errors.every((error) => typeof error === "string" && error.length <= 3000)
    || (state.autofill !== null && (!state.autofill || !Number.isFinite(Date.parse(state.autofill.clickedAt)) || !Number.isFinite(Date.parse(state.autofill.completedAt)) || typeof state.autofill.summary !== "string"))) throw new Error("Invalid browser evidence");
  return state;
}
function receipt(result: Record<string, unknown>, key: "receipt" | "rejection" = "receipt"): NonNullable<JobApplication["receipt"]> {
  const value = result[key] as JobApplication["receipt"];
  if (!value || typeof value.url !== "string" || typeof value.text !== "string" || value.text.length > 1000 || typeof value.at !== "string") throw new Error("Invalid submission receipt");
  return value;
}

/** Jobright fills; the isolated reviewer audits; fixed browser actions repair; a durable one-shot gate permits Submit. */
export async function runApplications(options: { id?: string; mode?: Mode; scheduled?: boolean; now?: Date; validateOnly?: boolean } = {},
  reviewer = { loadCV: loadApplicationCV, review: reviewApplication }) {
  return executeBackgroundRun(APPLICATION_RUN, async ({ signal, commit }) => {
    const owned = <T>(action: () => T): T => {
      signal.throwIfAborted(); const result = commit(action);
      if (!result.owned) throw new Error("Browser ownership expired"); return result.value;
    };
    const now = options.now ?? new Date(), settings = applicationSettings();
    if (options.scheduled && (!settings.enabled || applicationClock(now, settings.timeZone).time < settings.at)) return { processed: 0 };
    const mode = options.mode ?? "prepare";
    if (mode !== "prepare") {
      if (!options.id) throw new Error("Choose an application first");
      const job = applicationJob(options.id);
      if (!job.application) throw new Error("Run Jobright for this application first");
      if (mode === "inspect" && job.application.submission) throw new Error("Submission has already been attempted; use receipt inspection, not refilling");
      const result = await browser(job, mode, signal);
      if (mode === "receipt") owned(() => result.rejection
        ? confirmApplicationRejection(job.id, job.application!.attemptId, receipt(result, "rejection"))
        : confirmApplicationReceipt(job.id, job.application!.attemptId, receipt(result)));
      if (mode === "inspect") {
        const state = readSnapshot(result);
        owned(() => saveApplicationResult(job.id, job.application!.attemptId, { stage: "review", phase: "Read-back only; not submission-approved", fields: state.fields,
          resumeVerified: state.resumeVerified, autofill: state.autofill, blockers: state.errors }));
      }
      return { processed: 1 };
    }
    const ids = options.id ? [options.id] : applicationCandidates(now).map((job) => job.id);
    let processed = 0, cvPromise: Promise<string> | undefined;
    const queue = ids.map((id) => ({ id, retry: false }));
    while (queue.length) {
      const { id, retry } = queue.shift()!;
      signal.throwIfAborted();
      if (!options.id && !retry && applicationBoard(now).today >= settings.dailyLimit) break;
      if (options.scheduled && !applicationSettings().enabled) break;
      const job = owned(() => reserveApplication(id, settings, now));
      let state: ApplicationSnapshot = { fields: [], resumeVerified: false, errors: [], autofill: null };
      let review: ApplicationReview | undefined;
      let crossingSubmission = false, rebuild = false;
      const publish = (stage: JobApplication["stage"], phase: string, blockers: string[] = []) => owned(() => saveApplicationResult(job.id, job.application!.attemptId, {
        stage, phase, fields: state.fields.map((field) => { const decision = review?.decisions.find((d) => d.key === field.key);
          return { ...field, check: decision && decision.action !== "attention" && decision.value === field.value && !field.pendingSelection ? "matches-approved" as const : field.check, source: decision?.quote }; }),
        blockers: blockers.slice(0, 150), resumeVerified: state.resumeVerified, autofill: state.autofill, review,
      }));
      try {
        if (settings.preferencesHash !== applicationPreferencesHash()) throw new Error("Jobs preferences changed; reconfirm approved facts first");
        // One bounded retry for a transient extension/page failure, never a retry of submission.
        let continueAutofill = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          try { state = readSnapshot(await browser(job, "autofill", signal, { continueAutofill })); break; }
          catch (error) {
            const code = (error as { code?: string }).code;
            if (attempt || ["JOBRIGHT_SIGNIN", "POSTING_UNAVAILABLE", "POSTING_TITLE_MISMATCH", "POSTING_COMPANY_MISMATCH"].includes(code ?? "")) throw error;
            continueAutofill = code === "JOBRIGHT_INCOMPLETE"; // Wait for the same run, never reset a slow autofill.
          }
        }
        publish("preparing", "Jobright completed; checking answers and attached resume");
        cvPromise ??= reviewer.loadCV(approvedResume(settings).base64);
        const reviewSettings = { ...settings, answers: applicationAnswers(settings, job.id) };
        const evidence = { cv: await cvPromise, ...applicationSources(reviewSettings), job: [job.company, job.title, job.location, job.description ?? ""].join("\n"),
          workflow: `This application was initiated from Robin Jobs. Recorded discovery source: ${job.source}. Posting URL: ${job.url}. This record establishes no personal referral or prior employment.` };
        let problems: string[] = [], questions: string[] = [];
        for (let pass = 0; pass < 3; pass++) {
          publish("preparing", `Auditing autofill and repairing gaps (${pass + 1}/3)`);
          review = await reviewer.review(state, evidence, reviewSettings, signal, problems);
          try {
            const repaired = await browser(job, "repair", signal, { expected: state, decisions: review.decisions });
            state = readSnapshot(repaired);
          } catch (error) {
            if (pass === 2 || (error as { code?: string }).code !== "FORM_CHANGED") throw error;
            state = readSnapshot(await browser(job, "inspect", signal));
            problems = ["The form changed during review; audit the fresh snapshot, including any newly visible options."];
            continue;
          }
          problems = applicationReadBackProblems(review, state);
          questions = [...review.issues, ...review.decisions.filter((decision) => decision.action === "attention").map((decision) => `${state.fields.find((field) => field.key === decision.key)?.label}: ${decision.reason}`)];
          if (problems.every((problem) => questions.includes(problem))) break; // Still repair technical gaps when a separate personal answer is missing.
        }
        if (!review) throw new Error("No review was produced");
        if (problems.length) {
          // Do not disguise a broken browser/adapter as a personal decision.
          const technical = problems.filter((problem) => !questions.includes(problem));
          publish(technical.length ? "error" : "attention", technical.length ? "Repair could not be verified" : "Only unresolved personal questions remain", problems);
        } else if (options.validateOnly || settings.submissionPolicy !== APPLICATION_SUBMISSION_POLICY) {
          publish("review", "Validation passed; submission not enabled for this run");
        } else {
          // Recheck live sources and ownership, persist uncertainty BEFORE allowing any browser click.
          const grant = owned(() => grantApplicationSubmission(job.id, job.application!.attemptId, state, review!));
          crossingSubmission = true;
          const result = await browser(job, "submit", signal, { expected: state, grant });
          if (result.receipt) owned(() => confirmApplicationReceipt(job.id, job.application!.attemptId, receipt(result)));
          else if (result.rejection) {
            owned(() => confirmApplicationRejection(job.id, job.application!.attemptId, receipt(result, "rejection")));
            crossingSubmission = false;
            if (!retry) { rebuild = true; queue.unshift({ id, retry: true }); }
          }
          else owned(() => uncertainApplicationSubmission(job.id, job.application!.attemptId, "Submit was attempted but no definitive receipt was observed. Inspect the application/email; automatic resubmission is locked."));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Application workflow failed";
        if (crossingSubmission) owned(() => uncertainApplicationSubmission(job.id, job.application!.attemptId, message));
        else {
          const code = (error as { code?: string }).code;
          publish(code === "POSTING_UNAVAILABLE" ? "unavailable" : code === "JOBRIGHT_SIGNIN" ? "attention" : "error",
            code === "POSTING_UNAVAILABLE" ? "Posting unavailable at last check" : "Stopped before submission", [message]);
        }
      }
      if (!rebuild) processed++;
      if (processed >= settings.dailyLimit) break;
    }
    return { processed };
  });
}

const registry = globalThis as typeof globalThis & { __jobApplicationsDaily?: { timer: ReturnType<typeof setInterval>; tick: typeof tickApplicationsDaily } };
export async function tickApplicationsDaily(now = new Date()): Promise<void> {
  const board = applicationBoard(now);
  if (!board.settings.enabled || board.running || board.today >= board.settings.dailyLimit || applicationClock(now, board.settings.timeZone).time < board.settings.at) return;
  await runApplications({ scheduled: true, now });
}
export function startApplicationScheduler(): void {
  const old = registry.__jobApplicationsDaily;
  if (old?.tick === tickApplicationsDaily) return;
  if (old) clearInterval(old.timer);
  const timer = setInterval(() => { void tickApplicationsDaily().catch(() => console.error("[job-applications] workflow stopped; inspect Jobs")); }, 60000);
  timer.unref?.(); registry.__jobApplicationsDaily = { timer, tick: tickApplicationsDaily };
}
