/** Called by the existing supervised bridge, never a web-process timer. */
import { briefSchedule, briefScheduleDue } from "../extension/robin/brief-schedule.ts";
import { briefDeliverySlot, briefOwnsDay, deliverBrief, legacyBriefSummaryConsumed, cancelPendingBriefDelivery } from "../extension/robin/brief-delivery-domain.ts";
import { addDays, localDate } from "../extension/robin/dates.ts";
import { notificationSettings } from "../extension/robin/settings.ts";
import { composeBrief } from "./brief-runner.ts";
import type { BriefDeliveryDeps } from "../extension/robin/brief-delivery-domain.ts";
interface TickDeps {
  now?: () => number; allowed?: () => boolean; env?: NodeJS.ProcessEnv;
  compose?: typeof composeBrief;
  subscriptionCount?: BriefDeliveryDeps["subscriptionCount"];
  send?: BriefDeliveryDeps["send"];
  legacyConsumed?: (day: string) => boolean;
}
export async function runBriefDeliveryTick(day: string, signal: AbortSignal, deps: TickDeps = {}) {
  const now = deps.now ?? Date.now;
  const env = deps.env ?? process.env;
  if (briefSchedule(env)?.mailOnly) return (await import("./brief-mail-runner.ts")).runMailBriefTick(day, signal, deps);
  const allowed = () => briefScheduleDue(briefSchedule(env), now()) && (deps.allowed ?? (() => notificationSettings().channel === "push"))();
  if (!allowed()) return { status: "disabled-or-not-due" };
  if (day !== localDate(new Date(now()))) throw new Error("Brief tick must target the current local day");
  const scope = { day, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const legacyConsumed = deps.legacyConsumed ?? legacyBriefSummaryConsumed;
  if (legacyConsumed(day)) { cancelPendingBriefDelivery(scope); return { status: "legacy-consumed" }; }
  const subscriptionCount = deps.subscriptionCount ?? (async () => (await import("./web-push")).pushSubscriptionCount());
  if (!await subscriptionCount()) return { status: "no-subscribers" };
  signal.throwIfAborted();
  if (!allowed()) return { status: "disabled" };
  if (!briefOwnsDay(scope)) {
    const expiresAt = Math.min(now() + 6 * 3600_000, new Date(`${addDays(day, 1)}T00:00:00`).getTime());
    await (deps.compose ?? composeBrief)(`daily-brief:${briefDeliverySlot(scope)}`, { allowPrivateModel: true, input: "live", scope, signal, delivery: { expiresAt } });
  }
  signal.throwIfAborted();
  // A date change during generation must not dispatch yesterday's material.
  if (localDate(new Date(now())) !== day) return { status: "past-day" };
  if (legacyConsumed(day)) { cancelPendingBriefDelivery(scope); return { status: "legacy-consumed" }; }
  const status = await deliverBrief(scope, { now, allowed: () => allowed() && !legacyConsumed(day), subscriptionCount,
    send: deps.send ?? (async notification => (await import("./web-push")).sendPushNotification(notification)) });
  return { status };
}
