import {
  clearNoteFinal,
  readNoteFinals,
  writeNoteFinal,
  type NoteFinal,
} from "../extension/robin/notes-agent-state.ts";

/**
 * "Prepare for Notion" runs as a server job rather than inside the request,
 * so leaving the Notes page (or closing the tab) does not lose a minute of
 * generation. The result lands in note-finals.json; the page reads it back.
 *
 * Live jobs sit on globalThis so a dev hot reload of this module does not
 * orphan one that is still running.
 */
const registry = globalThis as typeof globalThis & { __robinNoteFinalizeJobs?: Map<string, AbortController> };
const jobs = registry.__robinNoteFinalizeJobs ??= new Map<string, AbortController>();

const INTERRUPTED = "Interrupted: the server restarted while this note was being prepared. Try again.";

export function isNoteFinalizeRunning(draftId: string): boolean {
  return jobs.has(draftId);
}

/**
 * Finals as the page should see them. A "running" record with no live job
 * behind it was cut off by a restart; that is derived here rather than
 * written back, because this is read by polls and a GET must not write.
 */
export function readNoteFinalsView(): Record<string, NoteFinal> {
  return Object.fromEntries(Object.entries(readNoteFinals()).map(([draftId, final]) => [
    draftId,
    final.status === "running" && !jobs.has(draftId)
      ? { ...final, status: "error" as const, error: INTERRUPTED }
      : final,
  ]));
}

export function startNoteFinalize(
  draftId: string,
  run: (signal: AbortSignal) => Promise<{ title: string; content: string }>,
): NoteFinal {
  if (jobs.has(draftId)) throw new Error("This note is already being prepared.");
  const controller = new AbortController();
  jobs.set(draftId, controller);
  const started: NoteFinal = { status: "running", startedAt: new Date().toISOString() };
  writeNoteFinal(draftId, started);

  void run(controller.signal)
    .then((result) => {
      if (!controller.signal.aborted) {
        writeNoteFinal(draftId, { ...started, status: "ready", finishedAt: new Date().toISOString(), ...result });
      }
    }, (error: unknown) => {
      if (!controller.signal.aborted) {
        writeNoteFinal(draftId, {
          ...started,
          status: "error",
          finishedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
    .finally(() => {
      if (jobs.get(draftId) === controller) jobs.delete(draftId);
    });

  return started;
}

/** Stop a running job and forget its record — also how a draft's final is dropped on delete or archive. */
export function cancelNoteFinalize(draftId: string): boolean {
  const controller = jobs.get(draftId);
  controller?.abort();
  jobs.delete(draftId);
  return clearNoteFinal(draftId) || Boolean(controller);
}
