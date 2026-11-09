/**
 * Read-only Gmail access.
 *
 * Server-only. Nothing here writes to Google: messages are listed and fetched
 * per request, the same way the calendar integration never writes events. The
 * OAuth grant is shared with google-calendar.ts, so there is one connect flow
 * and one disconnect for the whole Google surface. This inbox module remains
 * read-only; the separately guarded Jarvis sender uses gmail.send.
 */
import { getAccessToken } from "./google-calendar.ts";

const GMAIL_ENDPOINT = "https://gmail.googleapis.com/gmail/v1";
const REQUEST_TIMEOUT_MS = 10_000;
/** Cap metadata fetches at once so a page of mail does not fan out unbounded. */
const FETCH_CONCURRENCY = 8;

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  /** Arrival time as a UTC ISO instant (Gmail's internalDate). */
  date: string;
  unread: boolean;
  labelIds: string[];
}

interface GmailPayloadPart {
  mimeType?: string;
  filename?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPayloadPart[];
}

interface GmailPayload {
  headers?: { name?: string; value?: string }[];
  parts?: GmailPayloadPart[];
  body?: { data?: string };
}

interface GmailApiMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPayload;
}

async function gmailGet(token: string, path: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${GMAIL_ENDPOINT}${path}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    });
    const parsed = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const status = response.status;
      const detail = typeof parsed?.error === "object" && parsed?.error
        ? String((parsed.error as { message?: unknown }).message ?? JSON.stringify(parsed.error))
        : `HTTP ${status}`;
      if (status === 403) {
        throw new Error(
          "Gmail access was not granted. Reconnect Google so the read-only Gmail scope is "
          + "included: Settings → Google → Clear, then press Connect in the calendar panel.",
        );
      }
      throw new Error(`Gmail returned ${detail}`);
    }
    return parsed ?? {};
  } finally {
    clearTimeout(timer);
  }
}

function headerValue(payload: GmailPayload | undefined, name: string): string {
  const header = payload?.headers?.find(
    (entry) => (entry.name ?? "").toLowerCase() === name.toLowerCase(),
  );
  return header?.value?.trim() ?? "";
}

function mapMessage(raw: GmailApiMessage): GmailMessage | null {
  if (!raw.id) return null;
  const labelIds = raw.labelIds ?? [];
  return {
    id: raw.id,
    threadId: raw.threadId ?? raw.id,
    from: headerValue(raw.payload, "From"),
    subject: headerValue(raw.payload, "Subject") || "(no subject)",
    snippet: raw.snippet?.trim() ?? "",
    date: raw.internalDate ? new Date(Number(raw.internalDate)).toISOString() : "",
    unread: labelIds.includes("UNREAD"),
    labelIds,
  };
}

/** Run `fn` over `items` with a bounded number of in-flight promises. */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export interface ListOptions {
  /** Gmail search query, e.g. "newer_than:7d" or "is:unread". */
  query?: string;
  maxResults?: number;
}

/**
 * The most recent messages matching `query`, newest first.
 *
 * Two calls per page of mail: one list for the ids, then one metadata fetch
 * per id. Metadata is what a from/subject/snippet row needs; the full body is
 * fetched only on demand via {@link getEmail}.
 */
export async function listRecentEmails(options: ListOptions = {}): Promise<GmailMessage[]> {
  const token = await getAccessToken();
  const maxResults = Math.max(1, Math.min(options.maxResults ?? 50, 100));
  const query = options.query?.trim();

  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (query) params.set("q", query);

  const listing = await gmailGet(token, `/users/me/messages?${params.toString()}`);
  const ids = ((listing.messages as { id?: string }[] | undefined) ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string");

  const messages = await mapConcurrent(ids, FETCH_CONCURRENCY, async (id) => {
    const raw = await gmailGet(
      token,
      `/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    );
    return mapMessage(raw as GmailApiMessage);
  });

  return messages.filter((message): message is GmailMessage => message !== null);
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => `${label} (${href})`)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBody(root: GmailPayloadPart | undefined) {
  const attachments: string[] = []; let incomplete = !root, visited = 0;
  const walk = (part: GmailPayloadPart | undefined, depth = 0): { text: string; plain: boolean } => {
    if (!part) return { text: "", plain: false };
    if (++visited > 4096 || depth > 30) { incomplete = true; return { text: "", plain: false }; }
    const mime = (part.mimeType ?? "").toLowerCase();
    const disposition = part.headers?.find(h => h.name?.toLowerCase() === "content-disposition")?.value ?? "";
    if (part.filename || /^attachment\b/i.test(disposition) || (!mime.startsWith("text/") && !mime.startsWith("multipart/") && (part.body?.attachmentId || part.body?.data))) {
      attachments.push(part.filename?.trim().slice(0, 512) || "（未命名附件）");
      return { text: "", plain: false }; // Never decode named/attached text, images, PDFs or nested .eml files.
    }
    if (mime === "multipart/encrypted") incomplete = true;
    if (part.parts?.length) {
      if (mime === "multipart/alternative") {
        const previous = incomplete;
        const parts = part.parts.map(child => { incomplete = false; const result = walk(child, depth + 1); return { ...result, incomplete }; });
        const selected = parts.find(p => p.plain && p.text && !p.incomplete) ?? parts.find(p => p.text && !p.incomplete) ?? parts.find(p => p.text) ?? parts[0];
        incomplete = previous || selected.incomplete;
        return selected;
      }
      const parts = part.parts.map(child => walk(child, depth + 1));
      return { text: parts.map(p => p.text).filter(Boolean).join("\n\n"), plain: parts.some(p => p.plain) };
    }
    if (mime === "text/plain" || mime === "text/html") {
      if (!part.body?.data && (part.body?.attachmentId || (part.body?.size ?? 0) > 0)) incomplete = true;
      const text = part.body?.data ? decodeBase64Url(part.body.data) : "";
      return { text: mime === "text/html" ? stripHtml(text) : text, plain: mime === "text/plain" };
    }
    if (!mime || !mime.startsWith("multipart/")) incomplete = true;
    return { text: "", plain: false };
  };
  const bodyText = walk(root).text.trim();
  return { bodyText, attachments, bodyIncomplete: incomplete };
}

export interface GmailMessageDetail extends GmailMessage {
  /** Best-effort plain-text body: text/plain when present, else stripped HTML. */
  bodyText: string;
  /** Names only: attachment content is never extracted. */
  attachments?: string[];
  bodyIncomplete?: boolean;
}

/**
 * One message with its body, for the agent to actually read what matters.
 *
 * Returns null for a message that no longer exists. The body is a best-effort
 * plain-text extraction — HTML mail is stripped of markup, not rendered.
 */
export async function getEmail(id: string): Promise<GmailMessageDetail | null> {
  const token = await getAccessToken();
  return parseGmailMessageDetail(await gmailGet(token, `/users/me/messages/${encodeURIComponent(id)}?format=full`));
}

/** Shared extraction for read-only consumers; no request, token or persistence side effects. */
export function parseGmailMessageDetail(value: unknown): GmailMessageDetail | null {
  const raw = value as GmailApiMessage;
  const message = mapMessage(raw);
  if (!message) return null;

  return { ...message, ...extractBody(raw.payload as GmailPayloadPart | undefined) };
}
