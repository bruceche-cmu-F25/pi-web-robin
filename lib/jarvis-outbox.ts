import { canSendGmail, connectedGoogleEmail } from "../extension/robin/google-calendar.ts";
import { claimJarvisFollowUp, claimQueuedJarvisSend, finishJarvisFollowUp, finishJarvisSend, patchJarvisOutbox, readJarvis, readJarvisOutbox, recordJarvisThread } from "../extension/robin/jarvis-domain.ts";
import { coldReachSenderEmail, readJarvisThread, sendJarvisEmail } from "../extension/robin/jarvis-mail.ts";
import { isCurrentValidationProspect, isJarvisFollowUpDue, jarvisSentToday, JARVIS_DELIVERY_POLICY, type JarvisLead, type JarvisState } from "../extension/robin/jarvis-shape.ts";
import { acquireJarvisDeliveryLease, type JarvisDeliveryLease } from "./jarvis-delivery-lease.ts";

/**
 * The Jarvis outbox: sends contacts Bruce approved in a batch, one at a time,
 * and one follow-up per contact. Pacing keeps a personal Gmail account out of
 * spam filters with a randomized gap and an optional daily cap. Bruce has
 * explicitly allowed reviewed mail outside recipient business hours. Anything
 * uncertain pauses the whole outbox.
 */
const TICK_MS = 60_000;
const SYNC_EVERY_MS = JARVIS_DELIVERY_POLICY.replySyncMinutes * 60_000;
const GAP_MIN_MS = JARVIS_DELIVERY_POLICY.minimumGapMinutes * 60_000;
const GAP_SPREAD_MS = (JARVIS_DELIVERY_POLICY.maximumGapMinutes - JARVIS_DELIVERY_POLICY.minimumGapMinutes) * 60_000;
const BOUNCE_PAUSE = JARVIS_DELIVERY_POLICY.bouncePauseThreshold;
const DEFAULT_ZONE = "America/New_York";

const registry = globalThis as typeof globalThis & { __jarvisOutbox?: { timer: ReturnType<typeof setInterval>; busy: boolean; nextSendAt: number; tick?: typeof tickJarvisOutbox } };

export function startJarvisOutbox(): void {
  const existing = registry.__jarvisOutbox;
  // A dev reload evaluates this module again; the old timer would keep running the old tick.
  if (existing?.tick === tickJarvisOutbox) return;
  if (existing) {
    clearInterval(existing.timer);
    console.info("[jarvis-outbox] reloaded: the timer now runs the current tick");
  }
  const entry = { timer: setInterval(() => void tickJarvisOutbox(), TICK_MS), busy: false, nextSendAt: existing?.nextSendAt ?? 0, tick: tickJarvisOutbox };
  entry.timer.unref?.();
  registry.__jarvisOutbox = entry;
}

/** Informational recipient-local window; the outbox no longer blocks sends on it. */
export function inSendingWindow(lead: Pick<JarvisLead, "timeZone">, at: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: lead.timeZone || DEFAULT_ZONE, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return !["Sat", "Sun"].includes(weekday) && hour >= 8 && hour < 18;
}

/** Manual sends count against the cap too: they left the same Gmail account. */
export function sentToday(state: JarvisState, at: Date = new Date()): number {
  return jarvisSentToday(state.leads, at);
}

/** Follow-ups stay inside the active Cold Reach ICP; legacy cohorts are never revived automatically. */
export function isCurrentFollowUpIcp(lead: JarvisLead): boolean {
  return isCurrentValidationProspect(lead);
}

async function syncReplies(state: JarvisState, force = false): Promise<void> {
  const senderEmail = coldReachSenderEmail();
  const outbox = readJarvisOutbox(state);
  if (!force && outbox.lastSyncAt && Date.now() - Date.parse(outbox.lastSyncAt) < SYNC_EVERY_MS) return;
  patchJarvisOutbox({ lastSyncAt: new Date().toISOString() });
  for (const lead of state.leads) {
    if (lead.sendAttempt?.senderEmail !== senderEmail || lead.status !== "sent" || lead.sendAttempt?.state !== "sent" || !lead.sendAttempt.messageId) continue;
    try {
      const thread = await readJarvisThread(lead.sendAttempt.messageId, lead.sendAttempt.threadId, senderEmail);
      recordJarvisThread(lead.id, thread);
    } catch { /* One unreadable thread must not stop the others; it is retried next sync. */ }
  }
  const dayAgo = Date.now() - 24 * 60 * 60_000;
  const bounces = readJarvis().leads.filter((lead) => lead.history.some((h) => h.status === "bounced" && Date.parse(h.at) > dayAgo)).length;
  if (bounces >= BOUNCE_PAUSE) patchJarvisOutbox({ pausedReason: `${bounces} bounces in the last 24 hours. Check the addresses before resuming.` });
}

export async function tickJarvisOutbox(now: Date = new Date(), deliveryNow: () => Date = () => new Date()): Promise<void> {
  const entry = registry.__jarvisOutbox;
  if (entry?.busy) return;
  if (entry) entry.busy = true;
  let deliveryLease: JarvisDeliveryLease | null = null;
  try {
    deliveryLease = acquireJarvisDeliveryLease("outbox");
    if (!deliveryLease) return;
    if (!canSendGmail("outreach") || !connectedGoogleEmail("outreach")) return;
    const state = readJarvis();
    await syncReplies(state);
    if (deliveryLease.signal.aborted) return;
    const outbox = readJarvisOutbox();
    if (!outbox.enabled || outbox.pausedReason) return;
    if (outbox.startAt && now.getTime() < Date.parse(outbox.startAt)) return;
    if (now.getTime() < (entry?.nextSendAt ?? 0)) return;
    // A separate process or dev reload may have sent the previous message.
    // Persisted time preserves the minimum gap across those runtime boundaries.
    if (outbox.lastSendAt && now.getTime() < Date.parse(outbox.lastSendAt) + GAP_MIN_MS) return;
    const fresh = readJarvis();
    if (outbox.dailyLimit && sentToday(fresh, now) >= outbox.dailyLimit) {
      patchJarvisOutbox({ message: `Daily limit of ${outbox.dailyLimit} reached; continuing tomorrow.` });
      return;
    }
    const sent = await sendFollowUp(fresh, now, deliveryLease.signal, deliveryNow) || await sendQueued(deliveryLease.signal, deliveryNow);
    if (sent && entry) entry.nextSendAt = now.getTime() + GAP_MIN_MS + Math.random() * GAP_SPREAD_MS;
  } catch (error) {
    patchJarvisOutbox({ message: `Outbox error: ${error instanceof Error ? error.message : String(error)}` });
  } finally {
    deliveryLease?.release();
    if (entry) entry.busy = false;
  }
}

async function sendFollowUp(state: JarvisState, now: Date, signal: AbortSignal, deliveryNow: () => Date): Promise<boolean> {
  const senderEmail = coldReachSenderEmail();
  const due = state.leads.find((lead) => isCurrentFollowUpIcp(lead) && lead.sendAttempt?.senderEmail === senderEmail && isJarvisFollowUpDue(lead, now.getTime()) && lead.sendAttempt?.state === "sent" && lead.sendAttempt.messageId);
  if (!due) return false;
  // Re-read the thread right before sending: a reply since the last sync ends it.
  const thread = await readJarvisThread(due.sendAttempt!.messageId!, due.sendAttempt!.threadId, senderEmail);
  recordJarvisThread(due.id, thread);
  if (signal.aborted || thread.outcome !== "none" || !thread.rfcMessageId) return false;
  const claim = claimJarvisFollowUp(deliveryNow().getTime(), (lead) => lead.id === due.id && isCurrentFollowUpIcp(lead) && lead.sendAttempt?.senderEmail === senderEmail);
  if (!claim) return false;
  try {
    const sent = await sendJarvisEmail(claim.email, claim.subject, claim.body, { threadId: claim.threadId, rfcMessageId: thread.rfcMessageId }, senderEmail, signal);
    finishJarvisFollowUp(claim.id, claim.attemptId, sent.id);
    patchJarvisOutbox({ lastSendAt: new Date().toISOString(), message: `Follow-up sent to ${claim.email}.` });
  } catch (error) {
    finishJarvisFollowUp(claim.id, claim.attemptId);
    patchJarvisOutbox({ pausedReason: `Follow-up to ${claim.email} is unconfirmed: ${error instanceof Error ? error.message : String(error)}. Check Gmail Sent, then resume.` });
  }
  return true;
}

async function sendQueued(signal: AbortSignal, deliveryNow: () => Date): Promise<boolean> {
  if (signal.aborted) return false;
  const senderEmail = coldReachSenderEmail();
  const claim = claimQueuedJarvisSend(() => true, senderEmail, deliveryNow().toISOString());
  if (!claim) return false;
  try {
    const sent = await sendJarvisEmail(claim.email, claim.subject, claim.body, undefined, senderEmail, signal);
    finishJarvisSend(claim.id, claim.attemptId, sent.id, sent.threadId);
    patchJarvisOutbox({ lastSendAt: new Date().toISOString(), message: `Sent to ${claim.email}.` });
  } catch (error) {
    finishJarvisSend(claim.id, claim.attemptId);
    patchJarvisOutbox({ pausedReason: `Send to ${claim.email} is unconfirmed: ${error instanceof Error ? error.message : String(error)}. Check Gmail Sent, then resume.` });
  }
  return true;
}

/** Explicit "check replies now" from the page. */
export async function syncJarvisReplies(): Promise<void> {
  if (!canSendGmail("outreach")) throw new Error("Connect your personal Gmail in Cold Reach first");
  await syncReplies(readJarvis(), true);
}
