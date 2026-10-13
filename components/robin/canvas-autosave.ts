import type { CanvasContent, CanvasSummary } from "../../extension/robin/canvas.ts";

export type CanvasSaveState = "saved" | "dirty" | "saving" | "error";

/** Coalesce edits, but never overlap writes or lose edits made during a request. */
export function createCanvasAutosave<Content extends object = CanvasContent, Summary extends { revision: number } = CanvasSummary>(options: {
  revision: number;
  persist: (content: Content, revision: number) => Promise<Summary>;
  onState: (state: CanvasSaveState, error?: Error) => void;
  onSaved: (summary: Summary) => void;
  delay?: number;
}) {
  let revision = options.revision;
  let pending: Content | null = null;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failure: Error | null = null;

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    if (running) return running;
    if (!pending) return Promise.resolve();
    running = (async () => {
      while (pending) {
        const content: Content = pending;
        options.onState("saving");
        try {
          const saved = await options.persist(content, revision);
          revision = saved.revision;
          if (pending === content) pending = null;
          failure = null;
          options.onSaved(saved);
        } catch (caught) {
          failure = caught instanceof Error ? caught : new Error(String(caught));
          options.onState("error", failure);
          throw failure;
        }
      }
      options.onState("saved");
    })().finally(() => { running = null; });
    return running;
  };
  return {
    change(content: Content) {
      pending = content;
      clearTimeout(timer);
      // A conflict/failed write stays explicit until Retry, rather than looping.
      if (failure) return;
      options.onState("dirty");
      timer = setTimeout(() => { void flush().catch(() => {}); }, options.delay ?? 650);
    },
    flush,
    isDirty: () => pending !== null,
    getRevision: () => revision,
    dispose() { clearTimeout(timer); },
    discard() { clearTimeout(timer); pending = null; },
  };
}
