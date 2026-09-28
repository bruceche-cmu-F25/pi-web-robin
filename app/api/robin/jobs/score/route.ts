import { NextResponse } from "next/server";
import { scoringPrompt } from "@/extension/robin/job-rubric";
import {
  pendingJobCount,
  pendingJobIds,
  saveScoringState,
  scoringState,
  scoringStatus,
  scorerName,
} from "@/extension/robin/job-domain";
import { jobProfile } from "@/extension/robin/job-profile";
import type { JobScoringState } from "@/extension/robin/job-domain";
import { runAssistantTurn } from "@/lib/robin-assistant";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * A cap, not a target. Without it a scorer that keeps failing to write scores
 * would loop against a paid model until someone noticed.
 */
const MAX_ROUNDS = 8;

function isOutOfScope(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Model is not available in the enabled scope");
}

/** One run at a time per process — two would bill twice for the same queue. */
let running: Promise<unknown> | null = null;

export const GET = apiRoute(async () => NextResponse.json(scoringStatus()));

/**
 * Score the backlog, in the background.
 *
 * Runs rounds sized to the real queue rather than to the push size, and
 * publishes progress to a file the page polls — the same shape as the sweep,
 * for the same reason: the work outlives any sane request timeout and its only
 * other outward sign is rows quietly gaining a number.
 */
export const POST = apiRoute(async () => {
  if (running) {
    return NextResponse.json({ started: false, reason: "already-running", scoring: scoringState() });
  }

  const profile = jobProfile();
  const startedWith = pendingJobCount();
  if (startedWith === 0) {
    return NextResponse.json({ started: false, reason: "nothing-pending", scoring: scoringState() });
  }

  const batch = Math.max(1, profile.scoreBatch);
  const state: JobScoringState = {
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
  saveScoringState(state);

  const task = (async () => {
    // Undefined means "the profile's pin"; null means pi's default model.
    let model: null | undefined;
    for (let round = 1; round <= state.totalRounds; round += 1) {
      state.round = round;
      saveScoringState(state);
      const beforeIds = pendingJobIds();
      try {
        await runAssistantTurn("scoring", scoringPrompt(batch, profile.rubricLocale), [], model);
      } catch (error) {
        // A pinned model goes out of scope when pi renames it (deepseek-v4-flash
        // became deepseek-flash) and every run then failed on its first turn
        // until someone noticed the queue had stopped moving. Fall back to the
        // default once, say so on the page, and leave the pin for the user.
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
      // Counted from the store, not decremented, so a round the model half
      // finished is reflected honestly.
      const remainingIds = new Set(pendingJobIds());
      state.remaining = remainingIds.size;
      if (beforeIds.length > 0 && beforeIds.every(id => remainingIds.has(id))) {
        state.error = "Scoring made no progress; stopped rather than spending another model round on the same jobs.";
      }
      saveScoringState(state);
      if (state.remaining === 0 || state.error) break;
    }
    state.remaining = pendingJobCount();
    state.running = false;
    state.finishedAt = new Date().toISOString();
    saveScoringState(state);
  })().finally(() => {
    running = null;
  });
  running = task;
  // Nothing awaits this, so an unhandled rejection would take the process down.
  task.catch(() => {});

  return NextResponse.json({ started: true, scoring: state });
});
