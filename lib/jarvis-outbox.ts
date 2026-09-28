import { canSendGmail } from "../extension/robin/google-calendar.ts";
import { claimJarvisFollowUp, claimQueuedJarvisSend, finishJarvisFollowUp, finishJarvisSend, patchJarvisOutbox, readJarvis, readJarvisOutbox, recordJarvisThread } from "../extension/robin/jarvis-domain.ts";
import { readJarvisThread, sendJarvisEmail } from "../extension/robin/jarvis-mail.ts";
import { isJarvisFollowUpDue, jarvisSentToday, type JarvisLead, type JarvisState } from "../extension/robin/jarvis-shape.ts";

/**
 * The Jarvis outbox: sends contacts Bruce approved in a batch, one at a time,
 * and one follow-up per contact. Pacing keeps a personal Gmail account out of
 * spam filters: a randomized gap, weekday working hours in the recipient's time
 * zone, and an optional daily cap. Anything uncertain pauses the whole outbox.
 */
const TICK_MS = 60_000;
const SYNC_EVERY_MS = 15 * 60_000;
const GAP_MIN_MS = 6 * 60_000;
const GAP_SPREAD_MS = 6 * 60_000;
const BOUNCE_PAUSE = 3;
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

/** Weekdays 8:00–17:59 where the recipient works; the default zone when their location is unsourced. */
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

async function syncReplies(state: JarvisState, force = false): Promise<void> {
  const outbox = readJarvisOutbox(state);
  if (!force && outbox.lastSyncAt && Date.now() - Date.parse(outbox.lastSyncAt) < SYNC_EVERY_MS) return;
  patchJarvisOutbox({ lastSyncAt: new Date().toISOString() });
  for (const lead of state.leads) {
    if (lead.status !== "sent" || lead.sendAttempt?.state !== "sent" || !lead.sendAttempt.messageId) continue;
    try {
      const thread = await readJarvisThread(lead.sendAttempt.messageId, lead.sendAttempt.threadId);
      recordJarvisThread(lead.id, thread);
    } catch { /* One unreadable thread must not stop the others; it is retried next sync. */ }
  }
  const dayAgo = Date.now() - 24 * 60 * 60_000;
  const bounces = readJarvis().leads.filter((lead) => lead.history.some((h) => h.status === "bounced" && Date.parse(h.at) > dayAgo)).length;
  if (bounces >= BOUNCE_PAUSE) patchJarvisOutbox({ pausedReason: `${bounces} bounces in the last 24 hours. Check the addresses before resuming.` });
}

export async function tickJarvisOutbox(now: Date = new Date()): Promise<void> {
  const entry = registry.__jarvisOutbox;
  if (entry?.busy) return;
  if (entry) entry.busy = true;
  try {
    if (!canSendGmail()) return;
    const state = readJarvis();
    await syncReplies(state);
    const outbox = readJarvisOutbox();
    if (!outbox.enabled || outbox.pausedReason) return;
    if (outbox.startAt && now.getTime() < Date.parse(outbox.startAt)) return;
    if (now.getTime() < (entry?.nextSendAt ?? 0)) return;
    const fresh = readJarvis();
    if (outbox.dailyLimit && sentToday(fresh, now) >= outbox.dailyLimit) {
      patchJarvisOutbox({ message: `Daily limit of ${outbox.dailyLimit} reached; continuing tomorrow.` });
      return;
    }
    const sent = await sendFollowUp(fresh, now) || await sendQueued(now);
    if (sent && entry) entry.nextSendAt = now.getTime() + GAP_MIN_MS + Math.random() * GAP_SPREAD_MS;
  } catch (error) {
    patchJarvisOutbox({ message: `Outbox error: ${error instanceof Error ? error.message : String(error)}` });
  } finally {
    if (entry) entry.busy = false;
  }
}

async function sendFollowUp(state: JarvisState, now: Date): Promise<boolean> {
  const due = state.leads.find((lead) => isJarvisFollowUpDue(lead, now.getTime()) && lead.sendAttempt?.state === "sent" && lead.sendAttempt.messageId && inSendingWindow(lead, now));
  if (!due) return false;
  // Re-read the thread right before sending: a reply since the last sync ends it.
  const thread = await readJarvisThread(due.sendAttempt!.messageId!, due.sendAttempt!.threadId);
  recordJarvisThread(due.id, thread);
  if (thread.outcome !== "none" || !thread.rfcMessageId) return false;
  const claim = claimJarvisFollowUp(now.getTime());
  if (!claim) return false;
  try {
    const sent = await sendJarvisEmail(claim.email, claim.subject, claim.body, { threadId: claim.threadId, rfcMessageId: thread.rfcMessageId });
    finishJarvisFollowUp(claim.id, claim.attemptId, sent.id);
    patchJarvisOutbox({ lastSendAt: new Date().toISOString(), message: `Follow-up sent to ${claim.email}.` });
  } catch (error) {
    finishJarvisFollowUp(claim.id, claim.attemptId);
    patchJarvisOutbox({ pausedReason: `Follow-up to ${claim.email} is unconfirmed: ${error instanceof Error ? error.message : String(error)}. Check Gmail Sent, then resume.` });
  }
  return true;
}

async function sendQueued(now: Date): Promise<boolean> {
  const claim = claimQueuedJarvisSend((lead) => inSendingWindow(lead, now));
  if (!claim) return false;
  try {
    const sent = await sendJarvisEmail(claim.email, claim.subject, claim.body);
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
  if (!canSendGmail()) throw new Error("Connect Google first");
  await syncReplies(readJarvis(), true);
}
