import { createHash, randomUUID } from "node:crypto";
import { notificationSettings } from "../extension/robin/settings.ts";
import { executeBackgroundRun } from "../extension/robin/background-run-domain.ts";
import {
  APPLICATION_RUN, applicationBoard, applicationCandidates, applicationJob,
  claimApplicationReport, settleApplicationReport, recordApplicationPreflight, recordDailyApplicationCheck,
  applicationPreferencesHash, applicationSettings, applicationSources, approvedResume, confirmApplicationReceipt,
  grantApplicationSubmission, reserveApplication, saveApplicationResult, uncertainApplicationSubmission, confirmApplicationRejection,
} from "../extension/robin/job-application-domain.ts";
import { JOBRIGHT_TRUSTED_SUBMISSION_POLICY, applicationClock, applicationAnswers, type ApplicationSnapshot, type ApplicationReview, type JobApplication } from "../extension/robin/job-applications.ts";
import { applicationReadBackProblems, loadApplicationCV, reviewApplication } from "./job-application-review.ts";
import { withBskApplicationBrowser } from "./job-application-bsk-browser.ts";
import { assertBskApplicationBrowserReady } from "./job-application-bsk-transport.ts";
import { reconcileApplicationEmailReceipts } from "./job-application-email.ts";
type Mode = "prepare" | "inspect" | "focus" | "receipt";

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
  reviewer = { loadCV: loadApplicationCV, review: reviewApplication }, withBrowser = withBskApplicationBrowser,
  checkBrowser = assertBskApplicationBrowserReady) {
  if ((options.mode ?? "prepare") === "prepare" && !options.validateOnly && process.env.ROBIN_BSK_APPLICATIONS_READY !== "1") {
    throw new Error("BSK applications are not enabled: a real form read-back and receipt pilot must pass first.");
  }
  const runId = randomUUID();
  const execution = await executeBackgroundRun(APPLICATION_RUN, async ({ signal, commit }) => {
    const owned = <T>(action: () => T): T => {
      signal.throwIfAborted(); const result = commit(action);
      if (!result.owned) throw new Error("Browser ownership expired"); return result.value;
    };
    const now = options.now ?? new Date(), settings = applicationSettings();
    if (options.scheduled && (!settings.enabled || settings.dailyLimit < 1 || applicationClock(now, settings.timeZone).time < settings.at)) return { processed: 0 };
    const mode = options.mode ?? "prepare";
    if (mode !== "prepare") {
      if (!options.id) throw new Error("Choose an application first");
      const job = applicationJob(options.id);
      if (!job.application) throw new Error("Run Jobright for this application first");
      if (mode === "inspect" && job.application.submission) throw new Error("Submission has already been attempted; use receipt inspection, not refilling");
      const result = await withBrowser(job, signal, (browser) => browser(mode));
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
    // Bound each automatic run, not the entire day. Distinct-job and receipt locks still apply.
    const batchSize = settings.dailyLimit || 5; // A paused schedule still allows an explicit five-role batch.
    const ids = options.id ? [options.id] : applicationCandidates(now).slice(0, batchSize).map((job) => job.id);
    // A broken CLI/Chrome must not reserve every role in a scheduled batch.
    // Mock browser lanes in tests never inspect or start the real browser.
    if (ids.length && withBrowser === withBskApplicationBrowser) {
      try {
        await checkBrowser(settings.bskBrowserInstanceId ?? "", signal);
        owned(() => recordApplicationPreflight());
      } catch (error) {
        const message = error instanceof Error && /^(?:BSK_|BSK )/.test(error.message)
          ? error.message : "Browser preflight failed before any application attempt";
        owned(() => recordApplicationPreflight(message));
        throw error;
      }
    }
    let processed = 0, cvPromise: Promise<string> | undefined;
    const queue = ids.map((id) => ({ id, retry: false }));
    while (queue.length) {
      const { id, retry } = queue.shift()!;
      signal.throwIfAborted();
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
        await withBrowser(job, signal, async (browser) => {
        // BSK actions can take effect even when their transport fails. Never re-click Autofill blindly.
        state = readSnapshot(await browser("autofill"));
        if (!state.fields.length) {
          publish("error", "Employer form not visible after Autofill", state.errors.length ? state.errors : ["No employer form fields were observed; no submission attempted."]);
          return;
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
            const repaired = await browser("repair", { expected: state, decisions: review.decisions });
            state = readSnapshot(repaired);
          } catch (error) {
            if (pass === 2 || (error as { code?: string }).code !== "FORM_CHANGED") throw error;
            state = readSnapshot(await browser("inspect"));
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
        } else if (options.validateOnly || settings.submissionPolicy !== JOBRIGHT_TRUSTED_SUBMISSION_POLICY) {
          publish("review", "Validation passed; submission not enabled for this run");
        } else {
          // A missing/ambiguous Submit control is a preparation error, not an attempted submission.
          await browser("preflight", { expected: state });
          // Recheck live sources and ownership, persist uncertainty BEFORE allowing any browser click.
          const grant = owned(() => grantApplicationSubmission(job.id, job.application!.attemptId, state, review!));
          crossingSubmission = true;
          const result = await browser("submit", { expected: state, grant });
          if (result.receipt) owned(() => confirmApplicationReceipt(job.id, job.application!.attemptId, receipt(result)));
          else if (result.rejection) {
            owned(() => confirmApplicationRejection(job.id, job.application!.attemptId, receipt(result, "rejection")));
            crossingSubmission = false;
            if (!retry) { rebuild = true; queue.unshift({ id, retry: true }); }
          }
          else owned(() => uncertainApplicationSubmission(job.id, job.application!.attemptId,
            typeof result.reason === "string" && /^No definitive receipt after Submit \((?:posting mismatch|posting matched; success heading=(?:true|false); confirmation text=(?:true|false); form visible=(?:true|false); correction heading=(?:true|false))\); do not resubmit automatically\.$/.test(result.reason) ? result.reason
              : "Submit was attempted but no definitive receipt was observed. Inspect the application/email; automatic resubmission is locked."));
        }
        });
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
      if (options.scheduled && processed >= batchSize) break;
    }
    return { processed };
  });
  if ((options.mode ?? "prepare") === "prepare" && execution.started && execution.value?.processed) {
    try { await tickApplicationReport(new Date(), { run: { id: runId, processed: execution.value.processed } }); }
    catch { console.error("[job-applications] run summary unavailable; inspect Jobs"); }
  }
  return execution;
}

type ReportSend = (notification: { id: string; title: string; body: string; url: string; ttl: number }) => Promise<{ accepted: number; failed: number; expired: number }>;
/** A separate, opt-in push. Freeze the day's counts before network I/O; ambiguous sends are never retried. */
export async function tickApplicationReport(now = new Date(), deps: {
  env?: NodeJS.ProcessEnv; allowed?: () => boolean; subscriptionCount?: () => Promise<number>; send?: ReportSend;
  run?: { id: string; processed: number };
} = {}): Promise<string> {
  const allowed = deps.allowed ?? (() => notificationSettings().channel === "push");
  if ((!deps.run && (deps.env ?? process.env).ROBIN_JOB_APPLICATION_REPORT_ENABLED !== "1") || !allowed()) return "disabled";
  const board = applicationBoard(now), report = board.report;
  if (!board.settings.enabled || (deps.run ? deps.run.processed < 1
    : applicationClock(now, report.timeZone).time < "18:30" || report.delivery !== "not-sent")) return "not-due";
  const subscriptionCount = deps.subscriptionCount ?? (async () => (await import("./web-push")).pushSubscriptionCount());
  if (!await subscriptionCount() || !allowed()) return "no-subscribers-or-disabled";
  // After a late wake, let the ordinary scheduled run reserve work first, but never hide a stalled day forever.
  let pending = -1;
  try { pending = applicationCandidates(now).length; } catch { /* Show incomplete candidate coverage, not a false all-clear. */ }
  if (!deps.run && !board.running && report.attempted === 0 && pending > 0 && applicationClock(now, report.timeZone).time < "19:30") return "work-pending";
  const owner = randomUUID();
  if (!claimApplicationReport(report, owner, deps.run?.id)) return "already-claimed";
  if (!allowed() || (!deps.run && (deps.env ?? process.env).ROBIN_JOB_APPLICATION_REPORT_ENABLED !== "1")) {
    settleApplicationReport(report, owner, "failed", 0, deps.run?.id); return "disabled";
  }
  const id = deps.run ? `job-applications:run:${deps.run.id}`
    : `job-applications:${report.day}:${createHash("sha256").update(report.timeZone).digest("hex").slice(0, 16)}`;
  const [hour, minute] = applicationClock(now, report.timeZone).time.split(":").map(Number);
  const notification = { id, title: `${deps.run ? "投递简报" : "投递日报"} · ${report.day}`,
    body: `${deps.run ? `本轮处理 ${deps.run.processed}；` : ""}${report.running ? "仍在运行 · " : pending > 0 ? `仍有${pending}个候选未处理 · ` : pending < 0 ? "候选检查不可用 · " : ""}今日尝试 ${report.attempted}，回执确认 ${report.confirmed}；需回答 ${report.attention}，结果不明 ${report.uncertain}，技术失败 ${report.errors}。`,
    url: "/dashboard/jobs#application-report", ttl: Math.min(3600, (1440 - hour * 60 - minute) * 60) };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const send = deps.send ?? (async (note) => (await import("./web-push")).sendPushNotification(note));
    const result = await Promise.race([send(notification), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Push timed out")), 60_000); timer.unref?.();
    })]);
    if (![result.accepted, result.failed, result.expired].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Invalid push response");
    const accepted = result.accepted;
    settleApplicationReport(report, owner, accepted ? "accepted" : result.failed > 0 ? "uncertain" : "failed", accepted, deps.run?.id);
    return accepted ? "accepted" : "not-accepted";
  } catch {
    settleApplicationReport(report, owner, "uncertain", 0, deps.run?.id); return "uncertain";
  } finally { if (timer) clearTimeout(timer); }
}

const registry = globalThis as typeof globalThis & { __jobApplicationsDaily?: { timer: ReturnType<typeof setInterval>; tick: typeof tickApplicationsDaily } };
export async function tickApplicationsDaily(now = new Date()): Promise<void> {
  const board = applicationBoard(now);
  // Zero pauses scheduling; each enabled run is bounded separately.
  if (!board.settings.enabled || board.settings.dailyLimit < 1 || board.running
    || applicationClock(now, board.settings.timeZone).time < board.settings.at) return;
  await runApplications({ scheduled: true, now });
}
export function startApplicationScheduler(): void {
  const old = registry.__jobApplicationsDaily;
  if (old?.tick === tickApplicationsDaily) return;
  if (old) clearInterval(old.timer);
  let lastMailCheck = 0;
  const timer = setInterval(() => {
    void tickApplicationsDaily().catch(() => console.error("[job-applications] workflow stopped; inspect Jobs"));
    if (Date.now() - lastMailCheck >= 300_000) {
      lastMailCheck = Date.now();
      void reconcileApplicationEmailReceipts().catch(() => console.error("[job-applications] email receipt check unavailable; inspect Jobs"));
    }
    try { recordDailyApplicationCheck(); }
    catch { console.error("[job-applications] daily pipeline check unavailable; inspect Jobs"); }
    void tickApplicationReport().catch(() => console.error("[job-applications] report unavailable; inspect Jobs"));
  }, 60000);
  timer.unref?.(); registry.__jobApplicationsDaily = { timer, tick: tickApplicationsDaily };
}
