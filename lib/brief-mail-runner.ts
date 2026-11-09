/** The existing bridge's full-mail lane. No timer, attachment download or task mutation. */
import { createHash } from "node:crypto";
import { connectedGoogleEmail, getAccessToken, googleConnectionGuard } from "../extension/robin/google-calendar.ts";
import { boundedJson } from "../extension/robin/brief-mail.ts";
import { withBriefStore } from "../extension/robin/brief-store.ts";
import { briefSchedule, dueMailWindow } from "../extension/robin/brief-schedule.ts";
import { briefDeliverySlot, briefOwnsDay, deliverBrief, legacyBriefSummaryConsumed, cancelPendingBriefDelivery } from "../extension/robin/brief-delivery-domain.ts";
import { runShadowBrief } from "../extension/robin/brief-domain.ts";
import { BriefAcquisitionStorageError, BriefWorkPending } from "../extension/robin/brief-acquisition.ts";
import { collectMailReview, MAIL_REVIEW_PREAMBLE } from "../extension/robin/brief-mail-review.ts";
import { collectCalendarBrief } from "../extension/robin/brief-calendar.ts";
import { collectPublicBrief } from "../extension/robin/brief-public.ts";
import { BRIEF_SEARCH_TOOLS } from "../extension/robin/brief-search.ts";
import { collectStoredBriefSource } from "../extension/robin/brief-sources.ts";
import { localDate } from "../extension/robin/dates.ts";
import { notificationSettings } from "../extension/robin/settings.ts";
import type { BriefDeliveryDeps } from "../extension/robin/brief-delivery-domain.ts";
import type { ShadowBriefDeps } from "../extension/robin/brief-domain.ts";
interface Deps {
  now?: () => number; env?: NodeJS.ProcessEnv; allowed?: () => boolean;
  collect?: ShadowBriefDeps["collect"]; legacyConsumed?: (day: string) => boolean;
  subscriptionCount?: BriefDeliveryDeps["subscriptionCount"]; send?: BriefDeliveryDeps["send"];
}
export async function runMailBriefTick(day: string, signal: AbortSignal, deps: Deps = {}) {
  const now = deps.now ?? Date.now, env = deps.env ?? process.env, schedule = briefSchedule(env);
  if (!schedule?.mailOnly) return { status: "disabled-or-not-due" };
  const window = dueMailWindow(schedule, now());
  if (!window) return { status: "disabled-or-not-due" };
  if (day !== localDate(new Date(now()))) throw new Error("Brief tick must target the current local day");
  const scope = { day, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, time: window.time };
  const connected = googleConnectionGuard(), email = connectedGoogleEmail();
  const allowed = () => {
    const active = briefSchedule(env);
    return Boolean(active?.mailOnly && active.morningDaily === schedule.morningDaily && dueMailWindow(active, now())?.to === window.to && (deps.allowed ??  (() => notificationSettings().channel === "push" && connected() && connectedGoogleEmail() === email))());
  };
  if (!allowed()) return { status: "disabled" };
  const legacy = deps.legacyConsumed ?? (d => legacyBriefSummaryConsumed(d, !schedule.morningDaily || window.time === "18:00"));
  if (legacy(day)) { cancelPendingBriefDelivery(scope); return { status: "legacy-consumed" }; }
  const subscriptionCount = deps.subscriptionCount ?? (async () => (await import("./web-push")).pushSubscriptionCount());
  if (!await subscriptionCount()) return { status: "no-subscribers" };
  if (!briefOwnsDay(scope)) {
    try {
      const morning = window.time === "08:00" && schedule.morningDaily === true;
      await runShadowBrief(`daily-brief:${briefDeliverySlot(scope)}`, { scope, inputProfile: morning ? "mail-daily-v1" : "mail-all-v2", signal, now,
        ...(morning ? { sourceOrder: ["calendar", "world", "todos", "mail"] as const } : {}),
        delivery: { time: window.time, expiresAt: window.expiresAt },
        collect: deps.collect ?? (async (source, scope, signal, acquisition) => {
          if (source !== "mail") {
            if (!morning) return { source, coverage: "ready", observedAt: new Date(now()).toISOString(), detail: "Not requested in this mail-only edition", items: [] };
            if (source === "calendar") return collectCalendarBrief(scope, signal, acquisition);
            if (source === "world") return collectPublicBrief(scope, signal, acquisition, {
              ...(env.ROBIN_BRIEF_PUBLIC_SEARCH === "1" ? { search: { research: async (preamble, message, searchSignal) => {
                if (!allowed()) throw new Error("Morning search no longer authorized");
                const { runScopedAssistantTurn } = await import("./robin-assistant");
                return runScopedAssistantTurn({ remembered: null, remember: () => {}, oneShot: true, silenceCompletionNotifications: true,
                  toolNames: [...BRIEF_SEARCH_TOOLS], preamble, message, signal: searchSignal, timeoutMs: 35_000 });
              } } } : {}),
            });
            return collectStoredBriefSource(source, scope, signal);
          }
          try {
            return await collectMailReview(scope, window, signal, acquisition, { now,
              ...(window.time === "18:00" ? { focusAfter: new Date(`${day}T08:00:00`).toISOString() } : {}),
              turn: async (message, signal) => {
              if (!allowed()) throw new BriefAcquisitionStorageError("Mail schedule disabled or interval expired");
              const { runScopedAssistantTurn } = await import("./robin-assistant");
              const result = await runScopedAssistantTurn({ remembered: null, remember: () => {}, oneShot: true,
                silenceCompletionNotifications: true, toolNames: [], preamble: MAIL_REVIEW_PREAMBLE, message, signal, timeoutMs: 90_000 });
              if (result.usedTools.length) throw new Error("Mail review violated its tool-free scope");
              return result.reply;
            } });
          } catch (error) { if (error instanceof BriefWorkPending) throw error; throw new BriefAcquisitionStorageError(error); }
        }),
      });
    } catch (error) { if (error instanceof BriefWorkPending) return { status: "working" }; throw error; }
  }
  if (!allowed()) return { status: "past-slot-or-disabled" };
  if (!deps.allowed) {
    const queued = withBriefStore(db => db.prepare("SELECT o.state, o.next_attempt_at, json_extract(e.payload, '$.mailReport.accountKey') AS account FROM brief_outbox o JOIN brief_editions e ON e.id = o.edition_id WHERE o.slot = ?").get(briefDeliverySlot(scope)));
    if (queued?.state === "pending" && Number(queued.next_attempt_at) <= now()) {
      // Older valid OAuth grants may not cache an email address. Verify via read-only profile,
      // only when dispatch is actually pending, never on every settled-slot poll.
      let currentEmail = email;
      if (!currentEmail) {
        const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
        const token = await getAccessToken("primary", bounded);
        const profile = await boundedJson(await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: bounded,
        }));
        currentEmail = typeof profile.emailAddress === "string" ? profile.emailAddress : null;
      }
      if (!allowed() || !currentEmail || queued.account !== createHash("sha256").update(currentEmail.toLowerCase()).digest("hex")) {
        cancelPendingBriefDelivery(scope); return { status: "account-changed" };
      }
    }
  }
  if (legacy(day)) { cancelPendingBriefDelivery(scope); return { status: "legacy-consumed" }; }
  return { status: await deliverBrief(scope, { now, allowed: () => allowed() && !legacy(day), subscriptionCount,
    send: deps.send ?? (async notification => (await import("./web-push")).sendPushNotification(notification)) }) };
}
