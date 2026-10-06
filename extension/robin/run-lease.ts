import { randomUUID } from "node:crypto";

export const RUN_LEASE_MS = 120_000;
export const RUN_HEARTBEAT_MS = 30_000;

export type RunOwnershipResult<T> = { owned: true; value: T } | { owned: false };

export interface RunOwnershipFence {
  <T>(action: () => T): RunOwnershipResult<T>;
}

const runtime = globalThis as typeof globalThis & { __robinRuntimeOwnerId?: string };
export const RUNTIME_OWNER_ID = runtime.__robinRuntimeOwnerId ??= `${process.pid}:${randomUUID()}`;

export function hasFreshRunLease(run: { ownerId?: string; heartbeatAt?: string }, nowMs = Date.now()): boolean {
  const heartbeatMs = run.heartbeatAt ? Date.parse(run.heartbeatAt) : Number.NaN;
  return Boolean(run.ownerId && Number.isFinite(heartbeatMs) && heartbeatMs > nowMs - RUN_LEASE_MS);
}

/** Abort local work as soon as its durable ownership record is lost. */
export function startRunHeartbeat(renew: () => boolean, controller: AbortController): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    if (!renew()) controller.abort();
  }, RUN_HEARTBEAT_MS);
  timer.unref?.();
  return timer;
}
