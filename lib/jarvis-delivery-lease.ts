import { randomUUID } from "node:crypto";
import { claimJarvisDeliveryLease, heartbeatJarvisDeliveryLease, releaseJarvisDeliveryLease } from "../extension/robin/jarvis-domain.ts";
import { JARVIS_RUN_LEASE_MS, JARVIS_RUNTIME_OWNER_ID, startJarvisRunHeartbeat } from "./jarvis-run-lease.ts";

export interface JarvisDeliveryLease {
  signal: AbortSignal;
  release: () => void;
}

/** One shared transmission boundary for manual sends and every outbox process. */
export function acquireJarvisDeliveryLease(source: "manual" | "outbox"): JarvisDeliveryLease | null {
  const ownerId = `${JARVIS_RUNTIME_OWNER_ID}:${source}:${randomUUID()}`;
  if (!claimJarvisDeliveryLease(ownerId, Date.now() - JARVIS_RUN_LEASE_MS)) return null;
  const controller = new AbortController();
  let released = false;
  let heartbeatTimer: ReturnType<typeof setInterval>;
  try {
    heartbeatTimer = startJarvisRunHeartbeat(() => heartbeatJarvisDeliveryLease(ownerId), controller);
  } catch (error) {
    releaseJarvisDeliveryLease(ownerId);
    throw error;
  }
  return {
    signal: controller.signal,
    release: () => {
      if (released) return;
      released = true;
      clearInterval(heartbeatTimer);
      try { releaseJarvisDeliveryLease(ownerId); }
      catch (error) { console.error("[jarvis-delivery] could not release delivery lease:", error); }
    },
  };
}
