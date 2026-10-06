import {
  clearNoteFinal,
  readNoteFinals,
  writeNoteFinal,
  type NoteFinal,
} from "../extension/robin/notes-agent-state.ts";
import {
  backgroundRunActive,
  cancelBackgroundRun,
  claimBackgroundRun,
  heartbeatBackgroundRun,
  newBackgroundRunOwner,
  releaseBackgroundRun,
  withBackgroundRunOwnership,
} from "../extension/robin/background-run-domain.ts";
import { startRunHeartbeat } from "../extension/robin/run-lease.ts";

/**
 * "Prepare for Notion" runs as a server job rather than inside the request,
 * so leaving the Notes page (or closing the tab) does not lose a minute of
 * generation. The result lands in note-finals.json; the page reads it back.
 *
 * Live controllers sit on globalThis so a dev hot reload can cancel its work
 * immediately. Durable named leases are the source of truth across processes.
 */
interface LocalFinalizeJob {
  controller: AbortController;
  ownerId: string;
}

const registry = globalThis as typeof globalThis & { __robinNoteFinalizeJobs?: Map<string, LocalFinalizeJob> };
const jobs = registry.__robinNoteFinalizeJobs ??= new Map<string, LocalFinalizeJob>();

const INTERRUPTED = "Interrupted: the server restarted while this note was being prepared. Try again.";

export function noteFinalizeRunName(draftId: string): string {
  return `note-finalize:${draftId}`;
}

export function isNoteFinalizeRunning(draftId: string): boolean {
  return backgroundRunActive(noteFinalizeRunName(draftId));
}

/**
 * Finals as the page should see them. A "running" record with no live job
 * behind it was cut off by a restart; that is derived here rather than
 * written back, because this is read by polls and a GET must not write.
 */
export function readNoteFinalsView(): Record<string, NoteFinal> {
  return Object.fromEntries(Object.entries(readNoteFinals()).map(([draftId, final]) => [
    draftId,
    final.status === "running" && !isNoteFinalizeRunning(draftId)
      ? { ...final, status: "error" as const, error: INTERRUPTED }
      : final,
  ]));
}

export function startNoteFinalize(
  draftId: string,
  run: (signal: AbortSignal) => Promise<{ title: string; content: string }>,
): NoteFinal {
  if (jobs.has(draftId)) throw new Error("This note is already being prepared.");
  const runName = noteFinalizeRunName(draftId);
  const ownerId = newBackgroundRunOwner();
  if (!claimBackgroundRun(runName, ownerId)) throw new Error("This note is already being prepared.");

  const controller = new AbortController();
  jobs.set(draftId, { controller, ownerId });
  const heartbeat = startRunHeartbeat(
    () => heartbeatBackgroundRun(runName, ownerId),
    controller,
  );
  const started: NoteFinal = { status: "running", startedAt: new Date().toISOString() };
  let claimed: { owned: true; value: void } | { owned: false };
  try {
    claimed = withBackgroundRunOwnership(runName, ownerId, () => writeNoteFinal(draftId, started));
  } catch (error) {
    clearInterval(heartbeat);
    jobs.delete(draftId);
    releaseBackgroundRun(runName, ownerId);
    throw error;
  }
  if (!claimed.owned) {
    clearInterval(heartbeat);
    jobs.delete(draftId);
    releaseBackgroundRun(runName, ownerId);
    throw new Error("This note is already being prepared.");
  }

  const publish = (final: NoteFinal) => {
    withBackgroundRunOwnership(runName, ownerId, () => writeNoteFinal(draftId, final));
  };

  void run(controller.signal)
    .then((result) => {
      if (!controller.signal.aborted) {
        publish({ ...started, status: "ready", finishedAt: new Date().toISOString(), ...result });
      }
    }, (error: unknown) => {
      if (!controller.signal.aborted) {
        publish({
          ...started,
          status: "error",
          finishedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
    .finally(() => {
      clearInterval(heartbeat);
      releaseBackgroundRun(runName, ownerId);
      if (jobs.get(draftId)?.ownerId === ownerId) jobs.delete(draftId);
    })
    .catch((error: unknown) => {
      console.error("[robin] note finalization state write failed:", error instanceof Error ? error.message : error);
    });

  return started;
}

/** Stop a running job and forget its record — also how a draft's final is dropped on delete or archive. */
export function cancelNoteFinalize(draftId: string): boolean {
  const job = jobs.get(draftId);
  job?.controller.abort();
  jobs.delete(draftId);
  const cancelled = cancelBackgroundRun(noteFinalizeRunName(draftId));
  return clearNoteFinal(draftId) || Boolean(job) || cancelled;
}
