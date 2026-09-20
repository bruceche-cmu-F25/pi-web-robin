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
import { readTechEventScanState, readTechEvents, writeTechEvents } from "./store.ts";

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
