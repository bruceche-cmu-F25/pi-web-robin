import { randomUUID } from "node:crypto";
import { scoringPrompt } from "@/extension/robin/job-rubric";
import {
  claimJobScoringRun,
  heartbeatJobScoringRun,
  pendingJobCount,
  pendingJobIds,
  saveScoringState,
  scoringState,
  scorerName,
  type JobScoringState,
} from "@/extension/robin/job-domain";
import { jobProfile } from "@/extension/robin/job-profile";
import { RUN_LEASE_MS, RUNTIME_OWNER_ID, startRunHeartbeat } from "@/extension/robin/run-lease";
import { runAssistantTurn } from "@/lib/robin-assistant";

/** A cap, not a target: never loop against a paid model that cannot drain the queue. */
const MAX_ROUNDS = 8;

function isOutOfScope(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Model is not available in the enabled scope");
}

/** Local fast path; the store-backed lease owns cross-process exclusion. */
let running: Promise<void> | null = null;

type ScoringStart =
  | { started: true; scoring: JobScoringState }
  | { started: false; reason: "already-running" | "nothing-pending"; scoring: JobScoringState | null };

/**
 * Claim and start detached scoring; returns acceptance, not completion.
 * The host owns paid turns and their lifetime; the Job domain owns the backlog,
 * durable lease and fenced progress read by scoringStatus(). No HTTP self-call.
 */
export function startJobScoring(): ScoringStart {
  if (running) {
    return { started: false, reason: "already-running", scoring: scoringState() };
  }

  const profile = jobProfile();
  const startedWith = pendingJobCount();
  if (startedWith === 0) {
    return { started: false, reason: "nothing-pending", scoring: scoringState() };
  }

  const batch = Math.max(1, profile.scoreBatch);
  const state: JobScoringState = {
    id: randomUUID(),
    ownerId: RUNTIME_OWNER_ID,
    heartbeatAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    running: true,
    round: 0,
    totalRounds: Math.min(Math.ceil(startedWith / batch), MAX_ROUNDS),
    startedWith,
    remaining: startedWith,
    model: scorerName(profile.scoreModel),
    error: null,
  };
  if (!claimJobScoringRun(state, Date.now() - RUN_LEASE_MS)) {
    return { started: false, reason: "already-running", scoring: scoringState() };
  }

  const controller = new AbortController();
  const heartbeatTimer = startRunHeartbeat(() => heartbeatJobScoringRun(state.id!, state.ownerId!), controller);
  const publish = (): boolean => {
    const owned = saveScoringState(state);
    if (!owned) controller.abort();
    return owned;
  };
  const task = (async () => {
    // Undefined means "the profile's pin"; null means pi's default model.
    let model: null | undefined;
    for (let round = 1; round <= state.totalRounds; round += 1) {
      if (controller.signal.aborted) return;
      state.round = round;
      if (!publish()) return;
      const beforeIds = pendingJobIds();
      try {
        await runAssistantTurn("scoring", scoringPrompt(batch, profile.rubricLocale), [], model, controller.signal);
      } catch (error) {
        // A renamed/disabled pin may fall back once. Report it, but never edit
        // the user's pin or silently retry arbitrary provider failures.
        if (model === undefined && state.model && isOutOfScope(error)) {
          model = null;
          state.fallbackFrom = state.model;
          state.model = null;
          round -= 1;
          continue;
        }
        // Keep whatever earlier rounds scored; a failed round is not a failed run.
        state.error = error instanceof Error ? error.message : String(error);
        break;
      }
      // Recount even partial work; new arrivals cannot hide progress on old ids.
      const remainingIds = new Set(pendingJobIds());
      if (controller.signal.aborted) return;
      state.remaining = remainingIds.size;
      if (beforeIds.length > 0 && beforeIds.every(id => remainingIds.has(id))) {
        state.error = "Scoring made no progress; stopped rather than spending another model round on the same jobs.";
      }
      if (!publish()) return;
      if (state.remaining === 0 || state.error) break;
    }
    state.remaining = pendingJobCount();
    state.running = false;
    state.finishedAt = new Date().toISOString();
    publish();
  })().catch((error) => {
    // Queue reads/progress writes can fail outside the paid-call catch. Publish
    // a terminal state while still owned, rather than waiting for lease expiry.
    state.error = error instanceof Error ? error.message : String(error);
    state.running = false;
    state.finishedAt = new Date().toISOString();
    publish();
  }).finally(() => {
    clearInterval(heartbeatTimer);
    running = null;
  });
  running = task;
  // The request does not await this task; persistence failure must not be unhandled.
  task.catch(() => console.error("[job-scoring] could not persist the failed run; check local storage"));

  return { started: true, scoring: state };
}
