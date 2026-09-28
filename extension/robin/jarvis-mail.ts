import { canSendGmail, getAccessToken } from "./google-calendar.ts";

/**
 * The sole write to Gmail: a stored, reviewed Jarvis draft, sent either on an
 * explicit request or by the paced outbox after batch approval.
 */
export function encodeJarvisMessage(email: string, subject: string, body: string, inReplyTo?: string): string {
  if (!/^[^\s<>@\r\n]+@[^\s<>@\r\n]+\.[^\s<>@\r\n]+$/.test(email) || !subject.trim() || /[\r\n]/.test(subject) || !body.trim()) {
    throw new Error("Invalid mail headers or empty draft");
  }
  const chunks: string[] = [];
  let chunk = "";
  for (const character of subject) {
    if (Buffer.byteLength(chunk + character) > 39) { chunks.push(chunk); chunk = ""; }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  const encodedSubject = chunks.map((part) => `=?UTF-8?B?${Buffer.from(part).toString("base64")}?=`).join("\r\n ");
  const encodedBody = Buffer.from(body.replace(/\r\n|\r|\n/g, "\r\n"), "utf8").toString("base64").match(/.{1,76}/g)!.join("\r\n");
  if (inReplyTo !== undefined && !/^<[^\s<>\r\n]+>$/.test(inReplyTo)) throw new Error("Invalid In-Reply-To");
  const threading = inReplyTo ? `In-Reply-To: ${inReplyTo}\r\nReferences: ${inReplyTo}\r\n` : "";
  const mime = `To: ${email}\r\nSubject: ${encodedSubject}\r\n${threading}MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}`;
  return Buffer.from(mime, "utf8").toString("base64url");
}

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

/** A follow-up passes the original thread and its RFC Message-ID so it lands as a reply. */
export async function sendJarvisEmail(email: string, subject: string, body: string, reply?: { threadId: string; rfcMessageId: string }): Promise<{ id: string; threadId?: string }> {
  if (!canSendGmail()) throw new Error("Reconnect Google and grant Gmail send access before sending.");
  const raw = encodeJarvisMessage(email, subject, body, reply?.rfcMessageId);
  const token = await getAccessToken();
  const response = await fetch(`${GMAIL}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw, ...(reply ? { threadId: reply.threadId } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null) as { id?: unknown; threadId?: unknown; error?: { message?: string } } | null;
  if (!response.ok || typeof result?.id !== "string") throw new Error(`Gmail send failed (${response.status}): ${result?.error?.message ?? "No message id returned"}`);
  return { id: result.id, ...(typeof result.threadId === "string" ? { threadId: result.threadId } : {}) };
}

interface ThreadMessage { id?: string; labelIds?: string[]; internalDate?: string; payload?: { headers?: Array<{ name?: string; value?: string }> } }
const header = (message: ThreadMessage, name: string) => message.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
const BOUNCE = /mailer-daemon|postmaster|mail delivery (subsystem|system)/i;

/**
 * Reads (never modifies) the thread of a sent Jarvis message. Any message in it
 * that Bruce did not send is a reply, unless it is a delivery-failure notice.
 */
export async function readJarvisThread(messageId: string, knownThreadId?: string): Promise<{ threadId: string; rfcMessageId: string; outcome: "none" | "replied" | "bounced"; at?: string }> {
  const token = await getAccessToken();
  const get = async (path: string) => {
    const response = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw new Error(`Gmail read failed (${response.status})`);
    return result ?? {};
  };
  const threadId = knownThreadId ?? String((await get(`/messages/${encodeURIComponent(messageId)}?format=minimal`)).threadId ?? "");
  if (!threadId) throw new Error("Gmail did not return a thread for the sent message");
  const thread = await get(`/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`);
  const messages = (thread.messages as ThreadMessage[] | undefined) ?? [];
  const original = messages.find((message) => message.id === messageId);
  // Out-of-office replies are not answers: they neither count as a reply nor stop the follow-up.
  const incoming = messages.filter((message) => !message.labelIds?.includes("SENT") && !/^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|auto:)/i.test(header(message, "Subject")));
  const bounce = incoming.find((message) => BOUNCE.test(header(message, "From")) || /delivery status notification|undeliverable|delivery has failed/i.test(header(message, "Subject")));
  const first = bounce ?? incoming[0];
  const at = first?.internalDate ? new Date(Number(first.internalDate)).toISOString() : undefined;
  return { threadId, rfcMessageId: original ? header(original, "Message-ID") : "", outcome: bounce ? "bounced" : incoming.length ? "replied" : "none", ...(at ? { at } : {}) };
}
