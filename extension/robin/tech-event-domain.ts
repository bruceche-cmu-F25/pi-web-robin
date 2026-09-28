/**
 * Tech Event behavior shared by the HTTP adapter and the scan.
 *
 * The page is the only adapter today, but the rules below are the feature —
 * retention on read, who owns which field, and when the weekly scan fires —
 * and none of them were testable while they lived inside a route handler.
 */
import { startTechEventScan, techEventScanRunning } from "./tech-event-scan.ts";
import {
  hasPassed,
  isScanDue,
  sortTechEvents,
  type TechEvent,
  type TechEventScanState,
} from "./tech-events.ts";
import { localDate } from "./dates.ts";
import { isDetailFresh, type TechEventDetail } from "./tech-event-detail.ts";
import { fetchTechEventDetail } from "./tech-event-sources.ts";
import type { FetchContext } from "./job-providers.ts";
import {
  readTechEventDetails,
  readTechEventScanState,
  readTechEvents,
  updateTechEventDetails,
  writeTechEvents,
} from "./store.ts";

export interface TechEventBoard {
  /** Upcoming events, soonest first; past ones are already gone. */
  events: TechEvent[];
  /** When the list was last swept, or null if it never has been. */
  scan: TechEventScanState | null;
  /** Whether a sweep is running right now, so the page can say so. */
  scanning: boolean;
  today: string;
}

export interface TechEventBoardOptions {
  /**
   * Start a sweep when the week is up. The read answers from storage either
   * way — this only decides whether looking at the page is allowed to kick
   * one off. Pass false to read without side effects.
   */
  autoScan?: boolean;
  now?: number;
}

/**
 * The upcoming list, plus the two things the page needs to explain it.
 *
 * This is also what makes "once a week" happen. There is no cron and no daemon
 * behind this feature — the read checks whether the week is up and starts a
 * sweep if it is, then answers immediately with what is already stored. So the
 * page is never blocked on the network, and the freshness guarantee is the
 * honest one: what you see was swept within a week of the last time anyone
 * looked.
 *
 * Events that have already happened are dropped on read rather than only at
 * sweep time. Otherwise a list swept on Monday would still be offering you
 * Tuesday's meetup on Friday. The file is rewritten only when something
 * actually expired — a read that wrote on every poll would rewrite this file
 * every few seconds for no reason.
 */
export function techEventBoard(options: TechEventBoardOptions = {}): TechEventBoard {
  const now = options.now ?? Date.now();
  const scan = readTechEventScanState();
  if (options.autoScan !== false && isScanDue(scan, now)) startTechEventScan();

  const stored = readTechEvents();
  const live = stored.filter((event) => !hasPassed(event, now));
  if (live.length !== stored.length) writeTechEvents(live);

  return {
    events: sortTechEvents(live),
    scan,
    scanning: techEventScanRunning(),
    today: localDate(),
  };
}

export interface TechEventScanStatus {
  scan: TechEventScanState | null;
  scanning: boolean;
}

/** What the last sweep did and whether one is running — without reading the list. */
export function techEventScanStatus(): TechEventScanStatus {
  return { scan: readTechEventScanState(), scanning: techEventScanRunning() };
}

export interface TechEventFlags {
  saved?: boolean;
  hidden?: boolean;
}

export type TechEventResult<T> = T | { error: string };

/**
 * Save an event, or hide it.
 *
 * These are the only two fields a reader owns. Everything else on an event is
 * a fact the host published and the sweep refreshes, so letting the page edit
 * one would mean the next sweep silently reverted it. Both flags are stored by
 * presence, never as `false`, which is what keeps `mergeTechEvents` able to
 * tell "decided against" from "never seen".
 */
export function setTechEventFlags(id: string, flags: TechEventFlags): TechEventResult<TechEvent> {
  if (!id) return { error: "id is required" };

  const events = readTechEvents();
  const index = events.findIndex((event) => event.id === id);
  if (index < 0) return { error: `No event with id "${id}"` };

  const { saved, hidden, ...rest } = events[index]!;
  const nextSaved = flags.saved ?? saved;
  const nextHidden = flags.hidden ?? hidden;
  const updated: TechEvent = {
    ...rest,
    ...(nextSaved ? { saved: true } : {}),
    ...(nextHidden ? { hidden: true } : {}),
  };
  events[index] = updated;
  writeTechEvents(events);
  return updated;
}

export interface TechEventPage {
  event: TechEvent;
  /** Null only when the page has never been read successfully. */
  detail: TechEventDetail | null;
  /** Why the latest read failed; a stale `detail` may still be present. */
  detailError?: string;
  today: string;
}

export interface TechEventPageOptions {
  /** Skip the day-long cache and read Luma again. */
  refresh?: boolean;
  now?: number;
  ctx?: FetchContext;
}

/** Two tabs opening the same event share one request. */
const inflight = ((globalThis as { __robinTechEventDetail?: Map<string, Promise<TechEventDetail>> })
  .__robinTechEventDetail ??= new Map());

/**
 * One event plus its introduction, read from its own page.
 *
 * Only events already on the board can be opened: the id is looked up in the
 * stored list and the request goes to the URL the scan stored, so this can
 * never be turned into a fetch of an arbitrary page. A failed read falls back
 * to the last good copy — a description does not stop being true because
 * Luma timed out once.
 */
export async function techEventPage(id: string, options: TechEventPageOptions = {}): Promise<TechEventResult<TechEventPage>> {
  const now = options.now ?? Date.now();
  const event = readTechEvents().find((candidate) => candidate.id === id);
  if (!event) return { error: `No event with id "${id}"` };

  const cached = readTechEventDetails()[id];
  if (!options.refresh && cached && isDetailFresh(cached, now)) {
    return { event, detail: cached, today: localDate() };
  }

  let pending = inflight.get(id);
  if (!pending) {
    pending = fetchTechEventDetail(event, options.ctx, new Date(now).toISOString());
    inflight.set(id, pending);
    void pending.catch(() => {}).finally(() => inflight.delete(id));
  }

  try {
    const detail = await pending;
    // Prune to what is still on the board while holding the lock anyway, so
    // the cache can never outgrow the list it describes.
    const live = new Set(readTechEvents().map((candidate) => candidate.id));
    updateTechEventDetails((details) => {
      const next: Record<string, TechEventDetail> = {};
      for (const [key, value] of Object.entries(details)) if (live.has(key)) next[key] = value;
      next[id] = detail;
      return next;
    });
    return { event, detail, today: localDate() };
  } catch (error) {
    return {
      event,
      detail: cached ?? null,
      detailError: error instanceof Error ? error.message : String(error),
      today: localDate(),
    };
  }
}
