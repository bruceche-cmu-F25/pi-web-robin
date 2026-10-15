/**
 * Durable ownership for background work that has no progress document of its
 * own. Long-running job tasks keep their lease beside their progress; short
 * scanners use this named registry instead.
 *
 * Server-only: reaches node:fs through ./paths.ts.
 */
import { randomUUID } from "node:crypto";
import { readRuntimeState, updateRuntimeState, withTaskTransaction } from "./task-store.ts";
import {
  hasFreshRunLease,
  RUN_LEASE_MS,
  RUNTIME_OWNER_ID,
  startRunHeartbeat,
  type RunOwnershipFence,
  type RunOwnershipResult,
} from "./run-lease.ts";

const STORE_FILE = "background-runs.json";

export interface BackgroundRunLease {
  ownerId: string;
  heartbeatAt: string;
}

type BackgroundRunRegistry = Record<string, BackgroundRunLease>;

export function newBackgroundRunOwner(): string {
  return `${RUNTIME_OWNER_ID}:${randomUUID()}`;
}

export function backgroundRunActive(name: string, nowMs = Date.now()): boolean {
  const lease = readRuntimeState<BackgroundRunRegistry>(STORE_FILE)?.[name];
  return Boolean(lease && hasFreshRunLease(lease, nowMs));
}

/** Fresh named slots, for status views that need to report remote work. */
export function activeBackgroundRunNames(prefix = "", nowMs = Date.now()): string[] {
  const registry = readRuntimeState<BackgroundRunRegistry>(STORE_FILE) ?? {};
  return Object.entries(registry)
    .filter(([name, lease]) => name.startsWith(prefix) && hasFreshRunLease(lease, nowMs))
    .map(([name]) => name);
}

/** Atomically take an empty or expired named slot. */
export function claimBackgroundRun(name: string, ownerId: string, nowMs = Date.now()): boolean {
  return updateRuntimeState<BackgroundRunRegistry, boolean>(STORE_FILE, (stored) => {
    const registry = stored ?? {};
    const current = registry[name];
    if (current && hasFreshRunLease(current, nowMs)) {
      return { result: false, value: registry, changed: false };
    }
    return {
      result: true,
      value: {
        ...registry,
        [name]: { ownerId, heartbeatAt: new Date(nowMs).toISOString() },
      },
      changed: true,
    };
  });
}

/** Renew only the exact run that claimed the slot. */
export function heartbeatBackgroundRun(
  name: string,
  ownerId: string,
  at = new Date().toISOString(),
): boolean {
  return updateRuntimeState<BackgroundRunRegistry, boolean>(STORE_FILE, (stored) => {
    const registry = stored ?? {};
    const current = registry[name];
    if (current?.ownerId !== ownerId) {
      return { result: false, value: registry, changed: false };
    }
    return {
      result: true,
      value: { ...registry, [name]: { ownerId, heartbeatAt: at } },
      changed: true,
    };
  });
}

/**
 * Run a final write while ownership is locked against a replacement claim.
 * An owner whose heartbeat already expired is not allowed to publish, even if
 * nobody has claimed the slot yet.
 */
export function withBackgroundRunOwnership<T>(
  name: string,
  ownerId: string,
  action: () => T,
  nowMs = Date.now(),
): RunOwnershipResult<T> {
  return updateRuntimeState<BackgroundRunRegistry, RunOwnershipResult<T>>(
    STORE_FILE,
    (stored) => {
      const registry = stored ?? {};
      const current = registry[name];
      if (current?.ownerId !== ownerId || !hasFreshRunLease(current, nowMs)) {
        return { result: { owned: false }, value: registry, changed: false };
      }
      return {
        result: { owned: true, value: withTaskTransaction(action) },
        value: registry,
        changed: false,
      };
    },
  );
}

export interface BackgroundRunContext {
  signal: AbortSignal;
  commit: RunOwnershipFence;
  /** Keep renewing after the caller returns until detached work really settles. */
  deferRelease: (until: Promise<unknown>) => void;
}

export type BackgroundRunExecution<T> =
  | { started: false }
  | { started: true; value: T };

/** Claim, renew, execute, and release one blocking background operation. */
export async function executeBackgroundRun<T>(
  name: string,
  run: (context: BackgroundRunContext) => Promise<T>,
): Promise<BackgroundRunExecution<T>> {
  const ownerId = newBackgroundRunOwner();
  if (!claimBackgroundRun(name, ownerId)) return { started: false };

  const controller = new AbortController();
  const heartbeat = startRunHeartbeat(
    () => heartbeatBackgroundRun(name, ownerId),
    controller,
  );
  const commit: RunOwnershipFence = (action) => withBackgroundRunOwnership(name, ownerId, action);
  const releaseState: { deferred?: Promise<unknown> } = {};
  const release = () => {
    clearInterval(heartbeat);
    releaseBackgroundRun(name, ownerId);
  };
  try {
    return {
      started: true,
      value: await run({
        signal: controller.signal,
        commit,
        deferRelease: (until) => { releaseState.deferred = until; },
      }),
    };
  } finally {
    if (releaseState.deferred) void releaseState.deferred.catch(() => {}).finally(release);
    else release();
  }
}

/** Release only this owner; a replacement is never cleared by an old finally. */
export function releaseBackgroundRun(name: string, ownerId: string): boolean {
  return updateRuntimeState<BackgroundRunRegistry, boolean>(STORE_FILE, (stored) => {
    const registry = stored ?? {};
    if (registry[name]?.ownerId !== ownerId) {
      return { result: false, value: registry, changed: false };
    }
    const next = { ...registry };
    delete next[name];
    return { result: true, value: next, changed: true };
  });
}

/**
 * Explicit user cancellation clears whichever owner currently holds the slot.
 * Its next heartbeat aborts remote work; an in-process caller can abort the
 * local controller immediately as well.
 */
export function cancelBackgroundRun(name: string): boolean {
  return updateRuntimeState<BackgroundRunRegistry, boolean>(STORE_FILE, (stored) => {
    const registry = stored ?? {};
    if (!registry[name]) return { result: false, value: registry, changed: false };
    const next = { ...registry };
    delete next[name];
    return { result: true, value: next, changed: true };
  });
}

export { RUN_LEASE_MS };
