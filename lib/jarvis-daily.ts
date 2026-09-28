import { readJarvisDaily, setJarvisDaily } from "../extension/robin/jarvis-domain.ts";
import { isReachableTierExec } from "../extension/robin/jarvis-shape.ts";
import { readJarvisView, startJarvisDiscovery } from "./jarvis-discovery.ts";

/**
 * Daily research: once a day after the configured hour, start a wide-net run for
 * `count` more reachable A/B executives (a published work email is required, so
 * each one can go through the outbox). New people land in Needs review; nothing
 * is queued or sent without Bruce's batch approval.
 */
const CHECK_MS = 5 * 60_000;

const registry = globalThis as typeof globalThis & { __jarvisDaily?: { timer: ReturnType<typeof setInterval>; tick: typeof tickJarvisDaily } };

export function startJarvisDaily(): void {
  const existing = registry.__jarvisDaily;
  // Same reload rule as the outbox: the timer must run the current tick.
  if (existing?.tick === tickJarvisDaily) return;
  if (existing) clearInterval(existing.timer);
  const timer = setInterval(() => tickJarvisDaily(), CHECK_MS);
  timer.unref?.();
  registry.__jarvisDaily = { timer, tick: tickJarvisDaily };
}

const localDay = (at: Date) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

/** Returns what it did, for tests and the log. */
export function tickJarvisDaily(now: Date = new Date()): "off" | "done-today" | "too-early" | "busy" | "started" | "failed" {
  const daily = readJarvisDaily();
  if (!daily.enabled) return "off";
  const today = localDay(now);
  if (daily.lastRunOn === today) return "done-today";
  if (now.getHours() < daily.hour) return "too-early";
  // The view marks runs orphaned by a restart as errors, so they cannot block this forever.
  const state = readJarvisView();
  if (state.run?.status === "running" || state.rescore?.status === "running") return "busy";
  const target = state.leads.filter(isReachableTierExec).length + daily.count;
  try {
    startJarvisDiscovery(target, "info_exec", true);
    setJarvisDaily({ lastRunOn: today });
    return "started";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A run started from the page since the store was read: try again at the next check.
    if (/already running/.test(message)) return "busy";
    // Anything else would fail the same way every five minutes; wait for tomorrow.
    setJarvisDaily({ lastRunOn: today });
    console.error("[jarvis-daily] could not start:", message);
    return "failed";
  }
}
