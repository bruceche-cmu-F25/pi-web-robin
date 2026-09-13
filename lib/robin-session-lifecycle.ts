import { lstatSync, statSync, unlinkSync } from "node:fs";
import { addDays, localDate, startOfWeek } from "@/extension/robin/dates";
import { dataDir, readJsonObject, updateJsonObject } from "@/extension/robin/paths";
import {
  readAssistantSessionId, readCoachSessionId, readDailyAgendaSessionId,
  readJobScorerSessionId, readMailReviewSessionId, readMentorSessionId,
} from "@/extension/robin/store";
import { readProductAgentSessionIds } from "@/extension/robin/product-agent-state";
import { getRpcSession } from "@/lib/rpc-manager";
import {
  invalidateSessionListCache, invalidateSessionPathCache, readSessionHeader, resolveSessionPath,
} from "@/lib/session-reader";
import { samePath } from "@/lib/paths";

export const ROBIN_IDLE_MS = 30 * 60 * 1000;
export const ROBIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const FILE = "assistant-session-history.json";

interface TrackedSession {
  path: string;
  lastActivityAt: number;
}
interface SessionHistory {
  sessions: Record<string, TrackedSession>;
  lastCleanupMonth?: string;
}

/** The manifest is the deletion allow-list, not every session with a Robin cwd. */
function readHistory(): SessionHistory {
  return readJsonObject<SessionHistory>(FILE) ?? { sessions: {} };
}

export function robinSessionExpired(lastActivityAt: number, now = new Date()): boolean {
  return !Number.isFinite(lastActivityAt)
    || now.getTime() < lastActivityAt
    || now.getTime() - lastActivityAt >= ROBIN_IDLE_MS
    || localDate(new Date(lastActivityAt)) !== localDate(now);
}

function modifiedAt(path: string): number {
  try { return statSync(path).mtimeMs; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Number.NaN;
    throw error;
  }
}

export function recordRobinSessionActivity(sessionId: string, path: string, at = Date.now()): void {
  if (!path || !Number.isFinite(at)) return;
  updateJsonObject<SessionHistory, void>(FILE, (current) => {
    const state = current ?? { sessions: {} };
    state.sessions[sessionId] = { path, lastActivityAt: at };
    return { value: state, result: undefined, changed: true };
  });
}

/** Adopt a known legacy id before rotating it; never refresh its age by reading it. */
function robinSessionLastActivity(sessionId: string, path: string): number {
  const tracked = readHistory().sessions[sessionId];
  const mtime = modifiedAt(path);
  if (!tracked) {
    recordRobinSessionActivity(sessionId, path, mtime);
    return mtime;
  }
  // A research turn can finish after its HTTP request timed out. Its final disk
  // write still counts as activity, even though that request is no longer here.
  return Math.max(tracked.lastActivityAt, Number.isFinite(mtime) ? mtime : 0);
}

/** A reply finishing after midnight must not carry yesterday's conversation forward. */
export function robinSessionShouldRotate(sessionId: string, path: string, now = new Date()): boolean {
  if (robinSessionExpired(robinSessionLastActivity(sessionId, path), now)) return true;
  try {
    const header = readSessionHeader(path);
    const created = new Date(header?.timestamp ?? "");
    return !Number.isFinite(created.getTime()) || localDate(created) !== localDate(now);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

/** Captured at submission for date-aware turns, using the same local clock as Robin's tools. */
export function withRobinTimeContext(message: string, now = new Date()): string {
  const today = localDate(now);
  const week = startOfWeek(today);
  const time = now.toLocaleTimeString("en-GB", { hour12: false });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return [
    "[Robin clock — current for this message]",
    `Local date/time: ${today} ${time} (${weekday}); timezone: ${zone}.`,
    `This week (Monday–Sunday): ${week} through ${addDays(week, 6)}.`,
    `This weekend: ${addDays(week, 5)} through ${addDays(week, 6)} (including the current weekend on Saturday/Sunday).`,
    "Resolve today/tomorrow/this weekend from this clock, not dates in earlier messages or tool results. If the intended weekend is ambiguous, ask before writing. State the concrete dates when confirming a dated action.",
    "[/Robin clock]",
    "", message,
  ].join("\n");
}

function currentSessionIds(): Set<string> {
  return new Set([
    readAssistantSessionId(), readCoachSessionId(), readDailyAgendaSessionId(),
    readJobScorerSessionId(), readMailReviewSessionId(), readMentorSessionId(),
    ...readProductAgentSessionIds(),
  ].filter((id): id is string => Boolean(id)));
}

/** One sweep per local calendar month, persisted across restarts. Only registered files are eligible. */
export async function cleanupRobinSessions(now = new Date()): Promise<number> {
  const month = localDate(now).slice(0, 7);
  if (readHistory().lastCleanupMonth === month) return 0;

  // Only ids explicitly owned by Robin are adopted. Unidentified pre-upgrade
  // transcripts are intentionally left alone rather than guessed from a cwd.
  for (const id of currentSessionIds()) {
    if (readHistory().sessions[id]) continue;
    const path = await resolveSessionPath(id);
    if (path) robinSessionLastActivity(id, path);
  }

  return updateJsonObject<SessionHistory, number>(FILE, (current) => {
    const state = current ?? { sessions: {} };
    if (state.lastCleanupMonth === month) return { value: state, result: 0, changed: false };
    const protectedIds = currentSessionIds();
    const cutoff = now.getTime() - ROBIN_RETENTION_MS;
    let removed = 0;
    for (const [id, entry] of Object.entries(state.sessions)) {
      if (protectedIds.has(id) || getRpcSession(id)?.isAlive()) continue;
      if (!Number.isFinite(entry.lastActivityAt) || entry.lastActivityAt >= cutoff) continue;
      try {
        const stat = lstatSync(entry.path);
        if (!entry.path.endsWith(".jsonl") || !stat.isFile() || stat.mtimeMs >= cutoff) continue;
        const header = readSessionHeader(entry.path);
        if (!header || header.id !== id || !samePath(header.cwd, dataDir())) continue;
        unlinkSync(entry.path);
        delete state.sessions[id];
        invalidateSessionPathCache(id);
        removed++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          delete state.sessions[id];
          invalidateSessionPathCache(id);
        } else {
          console.error(`[robin] could not clean session ${id}:`, error);
        }
      }
    }
    if (removed) invalidateSessionListCache();
    state.lastCleanupMonth = month;
    return { value: state, result: removed, changed: true };
  });
}

declare global {
  var __robinCleanupTimer: ReturnType<typeof setTimeout> | undefined;
  var __robinTurnQueues: Map<string, Promise<void>> | undefined;
}

/** Server startup catches up a missed month; thereafter wake at the next month. */
export function startRobinSessionCleanup(): void {
  if (globalThis.__robinCleanupTimer) return;
  const tick = async () => {
    let retry = false;
    try { await cleanupRobinSessions(); }
    catch (error) {
      retry = true;
      console.error("[robin] session cleanup failed:", error);
    }
    finally {
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      // Node timers cannot wait longer than ~24.8 days. An early wake only
      // checks the persisted month; it does not run another sweep.
      const delay = Math.min(retry ? 60 * 60 * 1000 : 2_147_483_647,
        Math.max(1000, nextMonth.getTime() - now.getTime()));
      globalThis.__robinCleanupTimer = setTimeout(tick, delay);
      globalThis.__robinCleanupTimer.unref();
    }
  };
  globalThis.__robinCleanupTimer = setTimeout(tick, 0);
  globalThis.__robinCleanupTimer.unref();
}

/**
 * One turn per mode at a time, so dashboard and Telegram never acquire or
 * rotate the same persona concurrently.
 *
 * A conversation refuses a second message while one is in flight: it would
 * land in the same session behind a reply nobody has read yet. A one-shot job
 * (`queue`) waits its turn instead — each run has its own session, and the
 * scheduled email digest must not fail because someone pressed "check mail"
 * a minute earlier, nor the button because the digest was running.
 */
export async function withRobinTurnLock<T>(
  mode: string,
  turn: () => Promise<T>,
  options: { queue?: boolean } = {},
): Promise<T> {
  // Not the old `__robinTurnLocks` Set: a hot reload must not pick that up.
  const queues = globalThis.__robinTurnQueues ??= new Map();
  const previous = queues.get(mode);
  if (previous && !options.queue) {
    throw new Error("Robin is still working on the previous message. Please wait for it to finish.");
  }
  const run = (previous ?? Promise.resolve()).then(turn);
  const settled = run.then(() => undefined, () => undefined);
  queues.set(mode, settled);
  try { return await run; }
  finally { if (queues.get(mode) === settled) queues.delete(mode); }
}

