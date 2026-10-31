"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/** Hidden workspace panes retain drafts without polling their resources. */
export const ResourceActivity = createContext(true);
import { onRefreshRequest } from "./refreshBus";

export interface PolledResource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Apply a confirmed server write and invalidate any reads started before it. */
  updateData: (update: (current: T | null) => T | null) => void;
}

/**
 * Fetch a Robin endpoint and re-fetch on an interval.
 *
 * Polling is how agent-side writes reach the dashboard: the pi extension
 * mutates the JSON store directly, with no channel back to the browser. An SSE
 * feed driven by `tool_execution_end` would be tighter, but for a personal
 * dashboard the poll is not worth replacing yet.
 *
 * A minute is enough for passive dashboard updates. Local actions and returning
 * to a visible tab still refresh immediately; hidden tabs do not poll.
 * Set enabled=false for an inactive panel: keep data, but suspend automatic reads.
 * intervalMs may select a cadence from the latest data (fast while running,
 * slow while idle). Changing the cadence refreshes once and replaces the timer.
 *
 * One request is in flight per mount: starting a new refresh aborts the old one
 * and a monotonically increasing sequence drops anything that still settles
 * later. Without both, a slow response can land after a faster newer one and
 * silently roll the panel back to stale data.
 */
export function usePolledResource<T>(url: string, intervalMs: number | ((data: T | null) => number) = 60_000, enabled = true): PolledResource<T> {
  enabled = useContext(ResourceActivity) && enabled;
  const { t } = useI18n();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sequenceRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastTextRef = useRef<string | null>(null);
  // Derive a number, not an effect dependency on a caller's inline function.
  const pollMs = typeof intervalMs === "function" ? intervalMs(data) : intervalMs;

  const refresh = useCallback(async () => {
    const sequence = ++sequenceRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // loading is the initial-load state: background reads must not hide rows.
    // Bound the body too, not just response headers. A stalled/aborted transport
    // may still resolve later; both the sequence and signal fence its result.
    const timeout = setTimeout(() => {
      if (sequence === sequenceRef.current) {
        setError(t("robin.common.readTimeout"));
        setLoading(false);
      }
      controller.abort();
    }, 30_000);
    const clearDeadline = () => clearTimeout(timeout);
    controller.signal.addEventListener("abort", clearDeadline, { once: true });
    try {
      const response = await fetch(url, { signal: controller.signal });
      const text = await response.text();
      if (sequence !== sequenceRef.current || controller.signal.aborted) return;
      if (response.ok && text === lastTextRef.current) {
        // An unchanged poll keeps the same object: no parse and no re-render of
        // every row below it.
        if (sequence === sequenceRef.current) setError(null);
        return;
      }
      let body: { error?: string } | null = null;
      try { body = JSON.parse(text) as { error?: string } | null; } catch { /* non-JSON error page */ }
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      if (sequence !== sequenceRef.current) return;
      lastTextRef.current = text;
      setData(body as T);
      setError(null);
    } catch (caught) {
      if (sequence !== sequenceRef.current || controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      clearDeadline();
      controller.signal.removeEventListener("abort", clearDeadline);
      if (sequence === sequenceRef.current && !controller.signal.aborted) setLoading(false);
    }
  }, [url, t]);

  const updateData = useCallback((update: (current: T | null) => T | null) => {
    sequenceRef.current += 1;
    abortRef.current?.abort();
    lastTextRef.current = null;
    setData(update);
    setLoading(false);
  }, []);

  // A different URL is a different resource: drop the previous payload and
  // any in-flight response so the old one cannot flash or overwrite the new.
  useEffect(() => {
    abortRef.current?.abort();
    sequenceRef.current += 1;
    lastTextRef.current = null;
    setData(null);
    setError(null);
    setLoading(true);
  }, [url]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(() => void refresh(), pollMs);
    };
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    };

    void refresh();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    const unsubscribe = onRefreshRequest(() => void refresh());
    return () => {
      stop();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sequenceRef.current += 1;
      abortRef.current?.abort();
    };
  }, [refresh, pollMs, enabled]);

  return { data, error, loading, refresh, updateData };
}

/** POST/PATCH/DELETE helper that surfaces the API's error message. */
export async function mutate(url: string, method: string, body: unknown): Promise<void> {
  await mutateResponse(url, method, body);
}

/** For callers that need the server's saved values, not an optimistic approximation. */
export async function mutateResponse(url: string, method: string, body: unknown): Promise<Response> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const parsed = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(parsed?.error ?? `Request failed (${response.status})`);
  }
  return response;
}
