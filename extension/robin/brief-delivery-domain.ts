/** Brief publication intent and conservative delivery receipts. Network stays outside transactions. */
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { BriefEdition, BriefScope } from "./brief.ts";
import { briefNotificationPreview } from "./brief-editor.ts";
import { localDate } from "./dates.ts";
import { createDeliveryLedger } from "./delivery-ledger.ts";
import { telegramSettings } from "./settings.ts";
import { hasBriefDeliveryStore, withBriefStore } from "./brief-store.ts";

export const briefDeliverySlot = (scope: BriefScope & { time?: string }) => {
  if (scope.time !== undefined && !["08:00", "18:00"].includes(scope.time)) throw new Error("Invalid mail delivery time");
  return `${scope.day}:${createHash("sha256").update(scope.timezone).digest("hex").slice(0, 16)}${scope.time ? `:mail:${scope.time}` : ""}`;
};
export interface BriefDeliveryReceipt {
  slot: string; edition_id: string; day: string; timezone: string; expires_at: number;
  state: "pending" | "sending" | "accepted" | "uncertain" | "expired" | "failed" | "cancelled";
  owner: string | null; lease_until: number; attempts: number; next_attempt_at: number; accepted: number;
}
/** Only called inside the edition's publication transaction. One automatic edition per local day. */
export function queueBriefDelivery(db: DatabaseSync, edition: BriefEdition, expiresAt: number, now: number): void {
  if (!edition.editorial || !Number.isSafeInteger(expiresAt)) throw new Error("Invalid Brief delivery intent");
  db.prepare("INSERT INTO brief_outbox(slot, edition_id, day, timezone, expires_at, state) VALUES(?, ?, ?, ?, ?, ?)")
    .run(briefDeliverySlot({ ...edition, time: edition.deliveryTime }), edition.id, edition.day, edition.timezone, expiresAt, expiresAt <= now ? "expired" : "pending");
}
/** A handoff owns this day's old agenda/mail slots even after disable or an uncertain receipt. */
export function briefOwnsDay(scope: BriefScope & { time?: string }): boolean {
  if (!hasBriefDeliveryStore()) return false;
  return withBriefStore(db => Boolean(db.prepare("SELECT 1 FROM brief_outbox WHERE slot = ?").get(briefDeliverySlot(scope))
    || (scope.time === undefined && db.prepare("SELECT 1 FROM brief_outbox o JOIN brief_editions e ON e.id = o.edition_id WHERE o.slot = ? AND json_extract(e.payload, '$.kind') = 'daily'").get(briefDeliverySlot({ ...scope, time: "08:00" })))));
}
export function briefOwnsMailDay(scope: BriefScope): boolean {
  return ["08:00", "18:00"].some(time => briefOwnsDay({ ...scope, time }));
}
/** Read original ledgers, including Telegram history, without migrating or marking them. */
export function legacyBriefSummaryConsumed(day: string, mailOnly = false): boolean {
  const settings = telegramSettings();
  const audience = [...new Set([0, ...settings.allowedChatIds, ...settings.gmailDigest.chatIds])];
  return (mailOnly ? ["gmail-digest-state.json"] : ["telegram-state.json", "gmail-digest-state.json"]).some(file => createDeliveryLedger(file).pending(day, audience).length < audience.length);
}
export function cancelPendingBriefDelivery(scope: BriefScope & { time?: string }): void {
  if (!hasBriefDeliveryStore()) return;
  withBriefStore(db => { db.prepare("UPDATE brief_outbox SET state = 'cancelled' WHERE slot = ? AND state = 'pending'").run(briefDeliverySlot(scope)); }, true);
}
export function briefDeliveryReceipts(now = Date.now()): Omit<BriefDeliveryReceipt, "owner">[] {
  if (!hasBriefDeliveryStore()) return [];
  return withBriefStore(db => (db.prepare("SELECT slot, edition_id, day, timezone, expires_at, state, lease_until, attempts, next_attempt_at, accepted FROM brief_outbox ORDER BY rowid DESC LIMIT 14").all() as unknown as Omit<BriefDeliveryReceipt, "owner">[]).map(row => ({ ...row,
    state: row.state === "sending" && row.lease_until <= now ? "uncertain" : row.state === "pending" && (row.expires_at <= now || row.day < localDate(new Date(now))) ? "expired" : row.state,
  })));
}
/** Operational status without source text, model errors or write-triggered recovery. */
export function briefLatestScheduledRun(now = Date.now()): { day: string; stage: string; interrupted: boolean } | null {
  if (!hasBriefDeliveryStore()) return null;
  return withBriefStore(db => {
    const row = db.prepare("SELECT day, stage, lease_until FROM brief_runs WHERE request_id LIKE 'daily-brief:%' AND input_profile IN ('editor-live-v1', 'mail-all-v2', 'mail-daily-v1') ORDER BY rowid DESC LIMIT 1").get();
    return row ? { day: String(row.day), stage: String(row.stage), interrupted: !["done", "failed", "waiting"].includes(String(row.stage)) && Number(row.lease_until) <= now } : null;
  });
}
export interface BriefDeliveryDeps {
  now?: () => number;
  allowed: () => boolean;
  subscriptionCount: () => Promise<number>;
  send: (notification: { id: string; title: string; body: string; url: string; ttl: number }) => Promise<{ accepted: number; failed: number; expired: number }>;
}
export async function deliverBrief(scope: BriefScope & { time?: string }, deps: BriefDeliveryDeps): Promise<string> {
  const now = deps.now ?? Date.now;
  if (!deps.allowed()) return "disabled";
  const subscribers = await deps.subscriptionCount();
  if (!deps.allowed()) return "disabled";
  const claim = withBriefStore(db => {
    const at = now();
    // A crash after dispatch is not evidence that nothing was sent. Never reclaim and resend it.
    db.prepare("UPDATE brief_outbox SET state = 'uncertain', owner = NULL WHERE state = 'sending' AND lease_until <= ?").run(at);
    db.prepare("UPDATE brief_outbox SET state = 'expired' WHERE state = 'pending' AND (expires_at <= ? OR day < ?)").run(at, scope.day);
    const row = db.prepare("SELECT * FROM brief_outbox WHERE slot = ?").get(briefDeliverySlot(scope)) as unknown as BriefDeliveryReceipt | undefined;
    if (!row || row.state !== "pending" || row.next_attempt_at > at || subscribers < 1) return null;
    const owner = randomUUID();
    db.prepare("UPDATE brief_outbox SET state = 'sending', owner = ?, lease_until = ?, attempts = attempts + 1 WHERE slot = ?")
      .run(owner, at + 120_000, row.slot);
    const saved = db.prepare("SELECT payload FROM brief_editions WHERE id = ?").get(row.edition_id);
    if (!saved) throw new Error("Brief delivery edition is missing");
    return { row, owner, edition: JSON.parse(String(saved.payload)) as BriefEdition };
  }, true);
  if (!claim) return "waiting-or-settled";
  const settle = (state: BriefDeliveryReceipt["state"], accepted = 0) => withBriefStore(db => {
    const result = db.prepare("UPDATE brief_outbox SET state = ?, owner = NULL, lease_until = 0, accepted = ?, next_attempt_at = ? WHERE slot = ? AND owner = ? AND state = 'sending' AND lease_until > ?")
      .run(state, accepted, now() + 300_000, claim.row.slot, claim.owner, now());
    if (result.changes === 1 && state === "accepted" && accepted > 0 && claim.edition.mailReport) {
      const report = claim.edition.mailReport, key = `mail:coverage-v2:${report.accountKey}`;
      const saved = db.prepare("SELECT payload FROM brief_source_state WHERE source_key = ?").get(key);
      const prior = saved ? JSON.parse(String(saved.payload)) : { from: report.from };
      if (!prior.to || prior.to < report.to) db.prepare("INSERT INTO brief_source_state VALUES(?, ?) ON CONFLICT(source_key) DO UPDATE SET payload = excluded.payload").run(key, JSON.stringify({ ...prior, to: report.to }));
    }
    return result.changes === 1 ? state : "ownership-lost";
  }, true);
  if (!deps.allowed()) return settle("cancelled");
  if (now() >= claim.row.expires_at) return settle("expired");
  const preview = briefNotificationPreview(claim.edition);
  if (!preview) return settle("failed");
  let result: Awaited<ReturnType<BriefDeliveryDeps["send"]>>;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    result = await Promise.race([
      deps.send({ ...preview, ttl: Math.max(1, Math.min(3600, Math.floor((claim.row.expires_at - now()) / 1000))) }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Brief delivery deadline")), 60_000); }),
    ]);
  } catch { return settle("uncertain"); }
  finally { if (timeout) clearTimeout(timeout); }
  // The transport's aggregate failures may include timeouts after acceptance. Do not guess.
  if (!Number.isSafeInteger(result.accepted) || result.accepted < 0 || !Number.isSafeInteger(result.failed) || result.failed < 0 || !Number.isSafeInteger(result.expired) || result.expired < 0) return settle("uncertain");
  if (result.accepted > 0) return settle("accepted", result.accepted);
  if (result.failed > 0) return settle("uncertain");
  return settle(claim.row.attempts + 1 >= 3 ? "failed" : "pending");
}
/** Resolve a receipt without sending. Never turns uncertainty back into an automatic retry. */
export function resolveBriefDelivery(slot: string, state: "accepted" | "cancelled"): void {
  if (state !== "accepted" && state !== "cancelled") throw new Error("Invalid Brief receipt resolution");
  withBriefStore(db => {
    const result = db.prepare("UPDATE brief_outbox SET state = ?, owner = NULL, lease_until = 0 WHERE slot = ? AND (state = 'uncertain' OR (state = 'sending' AND lease_until <= ?))").run(state, slot, Date.now());
    if (result.changes !== 1) throw new Error("Only an uncertain or abandoned Brief delivery can be resolved");
  }, true);
}
