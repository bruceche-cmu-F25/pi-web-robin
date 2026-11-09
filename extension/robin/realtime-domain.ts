/** Boson realtime credential broker. No audio, history, agent dispatch or tool access. */
import { bosonApiKey } from "./settings.ts";

export class RealtimeError extends Error {
  constructor(public code: "setup" | "auth" | "quota" | "busy" | "provider" | "cancelled", public status = 502) { super(code); }
}
export function realtimeReadiness() { return { configured: !!bosonApiKey() }; }
const state = globalThis as typeof globalThis & { __robinRealtimeMints?: number[] };

export async function createRealtimeCredential(signal: AbortSignal, deps: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {}) {
  const key = bosonApiKey(deps.env);
  if (!key) throw new RealtimeError("setup", 503);
  const now = Date.now();
  const starts = state.__robinRealtimeMints = (state.__robinRealtimeMints ?? []).filter(at => at > now - 60_000);
  // A private single-owner app: bound accidental reconnect storms, not distributed quotas.
  if (starts.length >= 10) throw new RealtimeError("busy", 429);
  signal.throwIfAborted(); starts.push(now);
  const combined = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  try {
    const response = await (deps.fetch ?? fetch)("https://api.boson.ai/v1/realtime/client_secrets", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expires_after: { seconds: 60 } }), signal: combined, redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new RealtimeError(response.status === 429 ? "quota" : [401, 403].includes(response.status) ? "auth" : "provider");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new RealtimeError("provider");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 16_384) { await reader.cancel(); throw new RealtimeError("provider"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    combined.throwIfAborted();
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof body.value !== "string" || !/^bai-eph-[A-Za-z0-9._-]{1,2048}$/.test(body.value)
      || !Number.isInteger(body.expires_at) || body.expires_at <= Date.now() / 1000 || body.expires_at > Date.now() / 1000 + 120) {
      throw new RealtimeError("provider");
    }
    // The long-lived API key and all other upstream fields are never returned.
    return { secret: body.value as string, expiresAt: body.expires_at as number };
  } catch (error) {
    if (combined.aborted) throw new RealtimeError("cancelled", 408);
    if (error instanceof RealtimeError) throw error;
    throw new RealtimeError("provider");
  }
}
