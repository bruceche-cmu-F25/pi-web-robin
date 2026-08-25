/**
 * The bridge's pi-web client.
 *
 * Split out of bridge.ts so the command, callback, and reminder handlers can
 * reach pi-web without importing the bridge — which imports them. The context
 * is deliberately narrower than BridgeConfig: everything here needs a URL, a
 * password and a fetch, and nothing here needs to know about chat ids.
 */

export interface PiWebContext {
  /** Base URL, no trailing slash. */
  url: string;
  /** Basic-auth password when PI_WEB_PASSWORD is set on pi-web. */
  password?: string;
  fetch: typeof fetch;
}

/** A dashboard command is a sentence, not a coding task; well under a minute. */
export const AGENT_TIMEOUT_MS = 120_000;
/** Must outlast the assistant route's own scoring budget so the route reports first. */
export const SCORING_TIMEOUT_MS = 330_000;
/** A mail-review turn reads a day of mail and writes todos/events. */
export const MAIL_TIMEOUT_MS = 180_000;

function authHeaders(ctx: PiWebContext): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(ctx.password
      ? { Authorization: `Basic ${Buffer.from(`pi:${ctx.password}`).toString("base64")}` }
      : {}),
  };
}

/** Call a pi-web route with the bridge's own auth, returning the parsed body. */
export async function piWeb<T>(
  ctx: PiWebContext,
  path: string,
  body?: unknown,
  timeoutMs = AGENT_TIMEOUT_MS,
  method: "POST" | "GET" | "PATCH" | "DELETE" = "POST",
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await ctx.fetch(`${ctx.url}${path}`, {
      method,
      signal: controller.signal,
      headers: authHeaders(ctx),
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
    });
    const parsed = await response.json().catch(() => null) as (T & { error?: string }) | null;
    if (!response.ok) throw new Error(parsed?.error ?? `pi-web returned HTTP ${response.status}`);
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

export type AssistantMode = "default" | "readOnly" | "scoring" | "mail";

export interface AssistantResult {
  reply: string;
  usedTools: string[];
}

/**
 * Run one assistant turn.
 *
 * Returns the raw reply and the tools that actually executed; presentation —
 * the "— added a todo" footer, the Markdown conversion — belongs to the caller,
 * because the command handlers want the facts without the prose decoration.
 */
export async function runAssistant(
  ctx: PiWebContext,
  message: string,
  mode: AssistantMode = "default",
  images: Array<{ data: string; mimeType: string }> = [],
): Promise<AssistantResult> {
  // Scoring walks a batch of postings in one turn and nobody is waiting on it;
  // the conversational modes are a sentence and should fail fast.
  const timeoutMs = mode === "scoring"
    ? SCORING_TIMEOUT_MS
    : mode === "mail" ? MAIL_TIMEOUT_MS : AGENT_TIMEOUT_MS;

  const parsed = await piWeb<AssistantResult>(
    ctx,
    "/api/robin/assistant",
    {
      message,
      // `readOnly` predates the named modes and is what the route still keys
      // the daily-agenda session off, so it stays on the wire for that one.
      ...(mode === "readOnly" ? { readOnly: true } : {}),
      ...(mode === "scoring" ? { mode: "scoring" } : {}),
      ...(mode === "mail" ? { mode: "mail" } : {}),
      ...(images.length > 0 ? { images: images.map((image) => ({ type: "image", ...image })) } : {}),
    },
    timeoutMs,
  );
  return { reply: parsed?.reply ?? "", usedTools: parsed?.usedTools ?? [] };
}
