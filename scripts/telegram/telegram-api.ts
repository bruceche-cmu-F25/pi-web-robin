/**
 * The bridge's Telegram client.
 *
 * Split out of bridge.ts for the same reason as pi-web.ts: the command and
 * callback handlers must answer Telegram without importing the bridge that
 * imports them. Everything here needs a bot token and a fetch, and nothing here
 * needs to know what a digest is.
 */
import { chunkHtml, stripTelegramHtml, toTelegramHtml } from "./format.ts";

const TELEGRAM_API = "https://api.telegram.org";
const TELEGRAM_FILE_API = "https://api.telegram.org/file";
const CALL_TIMEOUT_MS = 30_000;

export interface TelegramContext {
  token: string;
  fetch: typeof fetch;
}

/**
 * One inline button: either it calls back, or it opens a link.
 *
 * Telegram requires exactly one of the two, and rejects the whole keyboard when
 * a button carries neither — so `keyboard` drops malformed ones rather than
 * letting a single bad entry cost the message its buttons.
 */
export interface InlineButton {
  text: string;
  /** Comes back as a callback query. At most 64 bytes, which Telegram enforces. */
  data?: string;
  /** Opened in the client instead. Mutually exclusive with `data`. */
  url?: string;
}

/** Telegram's hard cap on callback payloads. */
export const MAX_CALLBACK_DATA_BYTES = 64;

export async function telegram(
  ctx: TelegramContext,
  method: string,
  body: Record<string, unknown>,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await ctx.fetch(`${TELEGRAM_API}/bot${ctx.token}/${method}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = (parsed as { description?: string } | null)?.description ?? `HTTP ${response.status}`;
      const error = new Error(`Telegram ${method} failed: ${detail}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether a failure is Telegram refusing to parse our HTML.
 *
 * Worth distinguishing from a network failure: one is retryable as plain text,
 * the other is not retryable at all.
 */
function isParseFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /can't parse entities|unsupported start tag|can't find end tag|unclosed/i.test(message);
}

/** Telegram's own button shape: one action key, never both. */
type TelegramButton =
  | { text: string; url: string }
  | { text: string; callback_data: string };

/**
 * Telegram's own shape for an inline keyboard: an array of button rows.
 *
 * A button Telegram would reject — no action, or a payload over the 64-byte
 * cap — is dropped here. The alternative is a 400 that costs the message its
 * text as well as its buttons.
 */
function keyboard(buttons: InlineButton[][] | undefined) {
  const rows = (buttons ?? [])
    .map((row) => row.flatMap((button): TelegramButton[] => {
      if (button.url) return [{ text: button.text, url: button.url }];
      if (!button.data) return [];
      if (Buffer.byteLength(button.data, "utf8") > MAX_CALLBACK_DATA_BYTES) return [];
      return [{ text: button.text, callback_data: button.data }];
    }))
    .filter((row) => row.length > 0);
  if (rows.length === 0) return {};
  return { reply_markup: { inline_keyboard: rows } };
}

/**
 * What a send produced. The ids matter because a message carrying buttons has
 * to be findable again to retire them once one is pressed.
 */
export interface SentMessages {
  messageIds: number[];
}

export interface SendOptions {
  /** Inline button rows, attached to the last chunk so they sit under the whole reply. */
  buttons?: InlineButton[][];
  /** Already HTML; skip the Markdown conversion. */
  html?: boolean;
}

/**
 * Send a reply, rendered.
 *
 * Markdown goes in and Telegram HTML goes out, chunked to fit. A message the
 * API refuses to parse is re-sent as plain text rather than dropped: a reply
 * that arrives unformatted is a cosmetic loss, one that never arrives is the
 * user thinking the bot is down.
 */
export async function sendMessage(
  ctx: TelegramContext,
  chatId: number,
  text: string,
  options: SendOptions = {},
): Promise<SentMessages> {
  const html = options.html ? text : toTelegramHtml(text);
  const chunks = chunkHtml(html);
  const messageIds: number[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const last = index === chunks.length - 1;
    // Buttons ride the last chunk so they sit under the whole reply.
    const extras = last ? keyboard(options.buttons) : {};
    let sent: unknown;
    try {
      sent = await telegram(ctx, "sendMessage", {
        chat_id: chatId,
        text: chunk,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...extras,
      });
    } catch (error) {
      if (!isParseFailure(error)) throw error;
      sent = await telegram(ctx, "sendMessage", {
        chat_id: chatId,
        text: stripTelegramHtml(chunk),
        link_preview_options: { is_disabled: true },
        ...extras,
      });
    }
    const id = (sent as { result?: { message_id?: unknown } } | null)?.result?.message_id;
    if (typeof id === "number") messageIds.push(id);
  }

  return { messageIds };
}

/**
 * Show "typing…" in the chat.
 *
 * Telegram clears the indicator after five seconds, so a turn that takes two
 * minutes needs this on a timer — see `withTyping`.
 */
export async function sendChatAction(
  ctx: TelegramContext,
  chatId: number,
  action = "typing",
): Promise<void> {
  await telegram(ctx, "sendChatAction", { chat_id: chatId, action });
}

/** Telegram's indicator lasts five seconds; refresh inside that. */
const TYPING_REFRESH_MS = 4_000;

/**
 * Run `work` while the chat shows a typing indicator.
 *
 * The indicator is decoration, so every failure it can produce is swallowed: a
 * chat action that does not go through must never be the reason an answer does
 * not either.
 */
export async function withTyping<T>(
  ctx: TelegramContext,
  chatId: number,
  work: () => Promise<T>,
  action = "typing",
): Promise<T> {
  const beat = () => { void sendChatAction(ctx, chatId, action).catch(() => {}); };
  beat();
  const timer = setInterval(beat, TYPING_REFRESH_MS);
  // Nothing should be kept alive purely to say "typing".
  timer.unref?.();
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

/**
 * Acknowledge a button press.
 *
 * Telegram spins the button until this arrives — up to fifteen seconds — so it
 * is sent before any of the work the press asked for. `text` shows as a toast.
 */
export async function answerCallbackQuery(
  ctx: TelegramContext,
  callbackId: string,
  text?: string,
): Promise<void> {
  await telegram(ctx, "answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

/**
 * Replace a message's buttons with whatever is left after a press.
 *
 * Telegram answers "message is not modified" when the markup already matches —
 * which happens whenever the same button is pressed twice. That is success, not
 * an error, so it is swallowed here.
 */
export async function editMessageButtons(
  ctx: TelegramContext,
  chatId: number,
  messageId: number,
  buttons: InlineButton[][],
): Promise<void> {
  try {
    await telegram(ctx, "editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      ...(buttons.length
        ? keyboard(buttons)
        : { reply_markup: { inline_keyboard: [] } }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/message is not modified/i.test(message)) throw error;
  }
}

/** Resolve a `file_id` to bytes. Used for photos and voice notes. */
export async function downloadFile(
  ctx: TelegramContext,
  fileId: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; filePath: string }> {
  const info = await telegram(ctx, "getFile", { file_id: fileId }) as
    { ok?: boolean; result?: { file_path?: string; file_size?: number } };
  const filePath = info?.result?.file_path;
  if (!filePath) throw new Error("Telegram getFile returned no file path");

  // Telegram reports the size before the transfer; refusing here avoids
  // pulling megabytes only to throw them away.
  const declared = info.result?.file_size;
  if (typeof declared === "number" && declared > maxBytes) {
    throw new Error(`The file is ${declared} bytes; the limit is ${maxBytes}`);
  }

  const response = await ctx.fetch(`${TELEGRAM_FILE_API}/bot${ctx.token}/${filePath}`);
  if (!response.ok) throw new Error(`Downloading the file failed: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error(`The file is ${bytes.byteLength} bytes; the limit is ${maxBytes}`);
  }
  return { bytes, filePath };
}
