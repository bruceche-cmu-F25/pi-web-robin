/** Opt-in Gmail acquisition. Provider data is evidence, never instructions or authorization. */
import { createHash, randomUUID } from "node:crypto";
import { getAccessToken, googleConnectionGuard, connectedGoogleEmail } from "./google-calendar.ts";
import { parseGmailMessageDetail } from "./gmail.ts";
import { BriefAcquisitionStorageError, BriefBudgetExhausted, BRIEF_RESPONSE_LIMIT, type BriefAcquisitionContext } from "./brief-acquisition.ts";
import type { BriefInput, BriefScope } from "./brief.ts";

interface MailCursor {
  version: 1;
  generation: string;
  after: number;
  phase: "bootstrap" | "history";
  historyId: string;
  pageToken?: string;
  pending?: { ids: string[]; nextPageToken?: string; nextHistoryId?: string };
}
interface MailDeps {
  fetch?: typeof fetch;
  token?: (signal: AbortSignal) => Promise<string>;
  connected?: () => boolean;
  email?: () => string | null;
  now?: () => number;
}
export class GmailBodyTooLarge extends Error {}
class GmailConsentChanged extends Error {}
export class GmailHttpError extends Error {
  status: number;
  constructor(status: number) { super(`Gmail HTTP ${status}`); this.status = status; }
}
const id = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{1,128}$/i.test(value)) throw new Error("Invalid Gmail message ID");
  return value;
};
const historyId = (value: unknown): string => {
  if (typeof value !== "string" || !/^\d{1,40}$/.test(value)) throw new Error("Invalid Gmail history ID");
  return value;
};
const pageToken = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || value.length > 4096) throw new Error("Invalid Gmail page token");
  return value;
};
function cursorFrom(value: unknown): MailCursor | null {
  if (value === null) return null;
  try {
    const c = value as MailCursor;
    if (!c || c.version !== 1 || typeof c.generation !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(c.generation) || !Number.isSafeInteger(c.after) || c.after < 0 || !["bootstrap", "history"].includes(c.phase)) throw new Error("Invalid saved Gmail cursor");
    historyId(c.historyId); pageToken(c.pageToken);
    if (c.pending) {
      if (!Array.isArray(c.pending.ids) || c.pending.ids.length > 2000) throw new Error("Invalid saved Gmail queue");
      c.pending.ids.forEach(id); pageToken(c.pending.nextPageToken);
      if (c.pending.nextHistoryId !== undefined) historyId(c.pending.nextHistoryId);
    }
    return c;
  } catch (error) { throw new BriefAcquisitionStorageError(error); }
}
export async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) { await response.body?.cancel(); throw new GmailHttpError(response.status); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty Gmail response");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BRIEF_RESPONSE_LIMIT) throw new GmailBodyTooLarge("Gmail response exceeds acquisition limit");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const json: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Invalid Gmail response");
  return json as Record<string, unknown>;
}
function changedIds(response: Record<string, unknown>, phase: MailCursor["phase"]): string[] {
  const ids = new Set<string>();
  if (phase === "bootstrap") {
    if (response.messages !== undefined && !Array.isArray(response.messages)) throw new Error("Invalid Gmail listing");
    for (const message of (response.messages ?? []) as { id: unknown }[]) ids.add(id(message.id));
  } else {
    if (response.history !== undefined && !Array.isArray(response.history)) throw new Error("Invalid Gmail history");
    for (const record of (response.history ?? []) as Record<string, unknown>[]) {
      // Gmail's generic `messages` repeats these fields. Use the typed changes, hydrate current state.
      if (Array.isArray(record.messages) && record.messages.length && !["messagesAdded", "messagesDeleted", "labelsAdded", "labelsRemoved"].some(k => Array.isArray(record[k]) && record[k].length)) throw new Error("Unsupported Gmail change; cursor retained");
      for (const kind of ["messagesAdded", "messagesDeleted", "labelsAdded", "labelsRemoved"]) {
        if (record[kind] !== undefined && !Array.isArray(record[kind])) throw new Error("Invalid Gmail change list");
        for (const entry of (record[kind] ?? []) as { message: { id: unknown } }[]) ids.add(id(entry.message.id));
      }
    }
  }
  if (ids.size > 2000) throw new Error("Gmail history page exceeds queue limit; checkpoint retained");
  return [...ids];
}

/** A bounded slice, not a scheduler: the next NEW run continues the saved provider queue. */
export async function collectGmailBrief(scope: BriefScope, signal: AbortSignal, acquisition: BriefAcquisitionContext, deps: MailDeps = {}): Promise<BriefInput> {
  const now = deps.now ?? Date.now;
  const connected = deps.connected ?? googleConnectionGuard();
  const connectedEmail = deps.email ?? connectedGoogleEmail;
  const base = () => ({ source: "mail" as const, observedAt: new Date(now()).toISOString() });
  if (!connected()) return { ...base(), coverage: "disconnected", detail: "Google is not connected; no inbox read", items: [] };
  // Conservatively reserve one request even when the shared OAuth token is cached.
  acquisition.reserveRequest();
  const token = await (deps.token ?? (s => getAccessToken("primary", s)))(signal);
  let account = "";
  const assertConnected = () => {
    const email = connectedEmail();
    if (!connected() || (account && email && email.toLowerCase() !== account)) throw new GmailConsentChanged("Google account changed or disconnected");
  };
  const request = async (path: string) => {
    signal.throwIfAborted();
    assertConnected();
    acquisition.reserveRequest();
    const response = await (deps.fetch ?? fetch)(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    const result = await boundedJson(response);
    assertConnected();
    return result;
  };
  const profile = await request("profile");
  if (typeof profile.emailAddress !== "string" || profile.emailAddress.length > 320 || !profile.emailAddress.includes("@")) throw new Error("Invalid Gmail account identity");
  account = profile.emailAddress.toLowerCase();
  const targetHistoryId = historyId(profile.historyId);
  if (connectedEmail() && connectedEmail()!.toLowerCase() !== account) throw new Error("Google account changed");
  const sourceKey = `mail:gmail-v1:${createHash("sha256").update(account).digest("hex")}`;
  const freshCursor = (h: unknown): MailCursor => ({ version: 1, generation: randomUUID(), after: Math.max(0, Date.parse(`${scope.day}T00:00:00Z`) / 1000 - 7 * 86400), phase: "bootstrap", historyId: historyId(h) });
  let cursor = cursorFrom(acquisition.state(sourceKey));
  if (!cursor) { cursor = freshCursor(profile.historyId); acquisition.checkpoint(sourceKey, cursor); }
  let complete = false, gap = "", resets = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      if (cursor.pending?.ids.length) {
        const messageId = cursor.pending.ids[0];
        let evidence = null;
        try {
          let raw: Record<string, unknown>;
          let oversizedBody = false;
          try { raw = await request(`messages/${encodeURIComponent(messageId)}?format=full`); }
          catch (error) {
            if (!(error instanceof GmailBodyTooLarge)) throw error;
            // Preserve a known body-coverage gap without letting a huge newsletter block all mail.
            oversizedBody = true;
            raw = await request(`messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
          }
          if (id(raw.id) !== messageId || !Array.isArray(raw.labelIds) || raw.labelIds.length > 100 || !raw.labelIds.every(l => typeof l === "string" && l.length <= 200)) throw new Error("Invalid Gmail message");
          const message = parseGmailMessageDetail(raw);
          if (!message || !Number.isFinite(Date.parse(message.date))) throw new Error("Invalid Gmail date");
          if (Date.parse(message.date) >= cursor.after * 1000 && !message.labelIds.some(l => ["SPAM", "TRASH", "SENT", "DRAFT", "CATEGORY_PROMOTIONS"].includes(l))) {
            const body = message.bodyText.slice(0, 20_000);
            const subject = message.subject.slice(0, 1000), from = message.from.slice(0, 2000), snippet = message.snippet.slice(0, 500);
            const href = `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${messageId}`;
            const text = `Subject: ${subject}\nFrom: ${from}\nDate: ${message.date}\nSnippet: ${snippet}\n\n${body}`;
            evidence = { observedAt: new Date(now()).toISOString(), text, metadata: {
              subject, from, snippet, date: message.date, unread: message.unread, href,
              bodyTruncated: message.bodyText.length > body.length, bodyAvailable: Boolean(body), oversizedBody,
              extraction: "best-effort-plain-text", summary: snippet || body.slice(0, 500),
            } };
          }
        } catch (error) {
          if (!(error instanceof GmailHttpError && error.status === 404)) throw error;
          // Message deleted after listing: a durable tombstone, not a fabricated empty body.
        }
        const next: MailCursor = { ...cursor, pending: { ...cursor.pending, ids: cursor.pending.ids.slice(1) } };
        acquisition.checkpoint(sourceKey, next, { itemId: messageId, generation: cursor.generation, evidence });
        cursor = next;
        continue;
      }
      if (cursor.pending) {
        const pending = cursor.pending;
        const next: MailCursor = { ...cursor, pending: undefined, pageToken: pending.nextPageToken };
        if (!pending.nextPageToken) {
          if (cursor.phase === "history") next.historyId = historyId(pending.nextHistoryId);
          next.phase = "history";
        }
        acquisition.checkpoint(sourceKey, next);
        const wasHistory = cursor.phase === "history";
        cursor = next;
        if (wasHistory && !pending.nextPageToken && BigInt(cursor.historyId) >= BigInt(targetHistoryId)) { complete = true; break; }
      }
      const params = new URLSearchParams({ maxResults: "10" });
      if (cursor.pageToken) params.set("pageToken", cursor.pageToken);
      if (cursor.phase === "bootstrap") params.set("q", `after:${cursor.after} -in:spam -in:trash -in:sent -in:drafts -category:promotions`);
      else params.set("startHistoryId", cursor.historyId);
      let page: Record<string, unknown>;
      try { page = await request(`${cursor.phase === "bootstrap" ? "messages" : "history"}?${params}`); }
      catch (error) {
        if (error instanceof GmailHttpError && error.status === 404 && cursor.phase === "history" && resets++ === 0) {
          // Expired history: a new bounded bootstrap generation; old evidence stays immutable.
          const profile = await request("profile");
          if (profile.emailAddress !== undefined && String(profile.emailAddress).toLowerCase() !== account) throw new Error("Google account changed");
          cursor = freshCursor(profile.historyId); acquisition.checkpoint(sourceKey, cursor); continue;
        }
        if (error instanceof GmailHttpError && error.status === 400 && cursor.pageToken && resets++ === 0) {
          // A stale page token is not an instruction to advance the high-water mark.
          cursor = cursor.phase === "bootstrap" ? freshCursor((await request("profile")).historyId) : { ...cursor, pageToken: undefined };
          acquisition.checkpoint(sourceKey, cursor); continue;
        }
        throw error;
      }
      const nextPageToken = pageToken(page.nextPageToken);
      if (nextPageToken && nextPageToken === cursor.pageToken) throw new Error("Repeated Gmail page token");
      const nextHistoryId = cursor.phase === "history" ? historyId(page.historyId) : undefined;
      if (nextHistoryId && BigInt(nextHistoryId) < BigInt(cursor.historyId)) throw new Error("Gmail history moved backwards");
      const next: MailCursor = { ...cursor, pending: { ids: changedIds(page, cursor.phase), nextPageToken, nextHistoryId } };
      // Persist page membership BEFORE hydration, so even a page larger than a run's budget progresses.
      acquisition.checkpoint(sourceKey, next); cursor = next;
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof BriefAcquisitionStorageError) throw error;
    if (error instanceof GmailConsentChanged) return { ...base(), coverage: "disconnected", detail: "Google account changed or disconnected during acquisition; no current mail published", items: [] };
    gap = error instanceof BriefBudgetExhausted ? "request budget reached; pending queue retained" : `provider read failed${error instanceof GmailHttpError ? ` (HTTP ${error.status})` : ""}; cursor retained`;
  }
  assertConnected();
  // This read is also fenced: a late response from an expired owner cannot become an input.
  const records = acquisition.evidence(sourceKey, cursor.generation);
  const lower = Date.parse(`${scope.day}T00:00:00Z`) - 7 * 86400_000;
  const eligible = records.filter(e => Date.parse(String(e.metadata.date)) >= lower);
  const selected = eligible.slice(0, 100);
  const limited = eligible.length > 100 || selected.some(e => e.metadata.bodyTruncated || !e.metadata.bodyAvailable);
  return { ...base(), coverage: complete && !limited ? "ready" : gap && !selected.length ? "unavailable" : "partial",
    detail: `${complete ? "History caught up" : `History incomplete (${cursor.phase}, ${cursor.pending?.ids.length ?? 0} queued)`}; 7-day mail view; excludes spam/trash/sent/drafts/promotions; not importance judgments. ${gap}${limited ? "; preview/body coverage limited" : ""}`,
    items: selected.map(e => ({ id: `mail:${e.id}`, source: "mail", section: "updates", title: String(e.metadata.subject),
      summary: String(e.metadata.summary), href: String(e.metadata.href), eventDate: String(e.metadata.date).slice(0, 10),
      evidence: { kind: "mail-message", reference: e.id, quote: e.text.slice(0, 1500), checkedAt: e.observedAt },
    })),
  };
}
