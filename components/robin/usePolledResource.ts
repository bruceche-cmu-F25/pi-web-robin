"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onRefreshRequest } from "./refreshBus";

export interface PolledResource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
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
 *
 * One request is in flight per mount: starting a new refresh aborts the old one
 * and a monotonically increasing sequence drops anything that still settles
 * later. Without both, a slow response can land after a faster newer one and
 * silently roll the panel back to stale data.
 */
export function usePolledResource<T>(url: string, intervalMs = 60_000): PolledResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sequenceRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const sequence = ++sequenceRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(url, { signal: controller.signal });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
      if (sequence !== sequenceRef.current) return;
      setData(body as T);
      setError(null);
    } catch (caught) {
      if (sequence !== sequenceRef.current || controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (sequence === sequenceRef.current && !controller.signal.aborted) setLoading(false);
    }
  }, [url]);

  // A different URL is a different resource: drop the previous payload and
  // any in-flight response so the old one cannot flash or overwrite the new.
  useEffect(() => {
    abortRef.current?.abort();
    sequenceRef.current += 1;
    setData(null);
    setError(null);
    setLoading(true);
  }, [url]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(() => void refresh(), intervalMs);
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
      abortRef.current?.abort();
    };
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh };
}

/** POST/PATCH/DELETE helper that surfaces the API's error message. */
export async function mutate(url: string, method: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const parsed = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(parsed?.error ?? `Request failed (${response.status})`);
  }
}
