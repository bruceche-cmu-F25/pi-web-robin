/**
 * One weekly pass over the event feeds.
 *
 * Costs no model tokens — HTTP, string matching and a merge — which is why it
 * is safe to let a page load trigger it (see the due check in
 * ./tech-events.ts). The whole run is a handful of requests to one host, so
 * unlike the job sweep there is no cursor to resume from and no budget to
 * spend: it either finishes in a few seconds or the week's scan failed and
 * next week's will try again.
 *
 * Server-only: reaches node:fs through ./store.ts.
 */
import {
  backgroundRunActive,
  claimBackgroundRun,
  heartbeatBackgroundRun,
  newBackgroundRunOwner,
  releaseBackgroundRun,
  withBackgroundRunOwnership,
} from "./background-run-domain.ts";
import { makeFetchContext } from "./job-providers.ts";
import { startRunHeartbeat } from "./run-lease.ts";
import {
  DEFAULT_SOURCES,
  harvestSource,
  type TechEventSource,
} from "./tech-event-sources.ts";
import {
  mergeTechEvents,
  type TechEvent,
  type TechEventScanState,
  type TechEventSourceResult,
} from "./tech-events.ts";
import { readTechEvents, writeTechEventScanState, writeTechEvents } from "./store.ts";

/**
 * Two at a time. Every source here is the same hostname, so a higher number is
 * not more parallelism — it is more load on one server, and a throttled scan
 * loses feeds quietly rather than failing loudly.
 */
const CONCURRENCY = 2;

/** Run `worker` over `items`, at most `limit` in flight. */
async function pooled<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

export interface TechEventScanOptions {
  sources?: TechEventSource[];
  fetchImpl?: typeof fetch;
  /** Injected by the tests; production reads and writes the real store. */
  stored?: TechEvent[];
  persist?: boolean;
  now?: number;
  /** Cancels outbound reads when a durable owner is replaced. */
  signal?: AbortSignal;
  /** Transaction seam used by the durable runner to fence the final write. */
  commit?: (events: TechEvent[], state: TechEventScanState) => boolean;
}

/**
 * Ask every feed what it has, keep what is local and technical, and fold the
 * result into the stored list.
 *
 * A feed that fails is recorded by name and skipped. That matters more here
 * than it does for jobs: these endpoints are undocumented, so a Luma redesign
 * is a question of when, and one broken feed must not take the page down with
 * it — the events already stored are still true.
 */
export async function runTechEventScan(
  options: TechEventScanOptions = {},
): Promise<TechEventScanState & { events: TechEvent[] }> {
  const now = options.now ?? Date.now();
  const startedAt = new Date(now).toISOString();
  const sources = options.sources ?? DEFAULT_SOURCES;
  const persist = options.persist ?? true;
  const ctx = makeFetchContext(options.fetchImpl ?? fetch, options.signal);

  const harvested = await pooled(sources, CONCURRENCY, async (source): Promise<{
    result: TechEventSourceResult;
    events: TechEvent[];
  }> => {
    try {
      const { seen, events, name } = await harvestSource(source, ctx, startedAt);
      return {
        result: { id: source.id, name: name ?? source.label, seen, kept: events.length },
        events,
      };
    } catch (error) {
      return {
        result: {
          id: source.id,
          name: source.label,
          seen: 0,
          kept: 0,
          error: error instanceof Error ? error.message : String(error),
        },
        events: [],
      };
    }
  });

  const scanned = harvested.flatMap((entry) => entry.events);
  const stored = options.stored ?? (persist ? readTechEvents() : []);
  const { events, added, expired } = mergeTechEvents(stored, scanned, now);

  const state: TechEventScanState = {
    startedAt,
    finishedAt: new Date().toISOString(),
    seen: harvested.reduce((total, entry) => total + entry.result.seen, 0),
    kept: scanned.length,
    added,
    expired,
    sources: harvested.map((entry) => entry.result),
  };

  if (persist) {
    const commit = options.commit ?? ((nextEvents: TechEvent[], nextState: TechEventScanState) => {
      writeTechEvents(nextEvents);
      writeTechEventScanState(nextState);
      return true;
    });
    commit(events, state);
  }
  return { ...state, events };
}

/**
 * At most one scan at a time across every server process.
 *
 * The guard lives here rather than in a route because two routes reach it: the
 * page's own GET starts a scan when the week is up, and the refresh button
 * starts one on demand. A guard in either route file would be a different
 * module instance from the other, so opening the page on a due week and then
 * pressing refresh would put two scans on the same host, interleaving their
 * writes to one file.
 */
export const TECH_EVENT_SCAN_RUN = "tech-event-scan";

let running: Promise<unknown> | null = null;

export function techEventScanRunning(): boolean {
  return backgroundRunActive(TECH_EVENT_SCAN_RUN);
}

/**
 * Start a scan unless one is already going; never throws, never awaited.
 *
 * Returns whether this call is the one that started it, which is what lets the
 * refresh button say "already running" instead of silently doing nothing.
 */
export function startTechEventScan(options: TechEventScanOptions = {}): boolean {
  if (running) return false;
  const ownerId = newBackgroundRunOwner();
  if (!claimBackgroundRun(TECH_EVENT_SCAN_RUN, ownerId)) return false;

  const controller = new AbortController();
  const heartbeat = startRunHeartbeat(
    () => heartbeatBackgroundRun(TECH_EVENT_SCAN_RUN, ownerId),
    controller,
  );
  const task = runTechEventScan({
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal,
    commit: (events, state) => {
      const result = withBackgroundRunOwnership(TECH_EVENT_SCAN_RUN, ownerId, () => {
        writeTechEvents(events);
        writeTechEventScanState(state);
      });
      return result.owned;
    },
  }).finally(() => {
    clearInterval(heartbeat);
    releaseBackgroundRun(TECH_EVENT_SCAN_RUN, ownerId);
    running = null;
  });
  running = task;
  // Nothing awaits this, so an unhandled rejection would take down the server.
  // The failure is already recorded per source in the scan state.
  task.catch(() => {});
  return true;
}
