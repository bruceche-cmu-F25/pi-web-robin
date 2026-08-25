/**
 * Telegram wire handling for the Robin bridge. Pure — no I/O, so the rules that
 * matter (who is allowed, what gets acknowledged) can be tested directly.
 */

export interface TelegramPhoto {
  /** `file_id` for getFile. */
  fileId: string;
  width?: number;
  height?: number;
}

/** A voice note or an audio file. Both arrive as one `file_id`. */
export interface TelegramVoice {
  fileId: string;
  /** Seconds, as Telegram reports it. */
  duration?: number;
  mimeType?: string;
}

export interface IncomingMessage {
  updateId: number;
  /** Telegram's id for the message itself, needed to edit or reply to it. */
  messageId: number;
  chatId: number;
  /** Display name for logs only; never used for authorization. */
  from: string;
  /**
   * The message text, or the photo caption. Empty for a bare photo or voice
   * note, which is why attachments must be checked before treating a message
   * as blank.
   */
  text: string;
  /**
   * The sender's Telegram client language, e.g. "en" or "zh-hans".
   *
   * The bridge runs outside the browser, so it cannot see the language chosen
   * in the dashboard — that lives in localStorage. Telegram reports the
   * sender's own client language, which is the closest true signal available.
   */
  languageCode?: string;
  /**
   * Photo attachments. Telegram sends one array per photo with several sizes;
   * the largest is last. Present only for photo messages.
   */
  photos?: TelegramPhoto[];
  /** A voice note, present only for voice messages. */
  voice?: TelegramVoice;
}

/**
 * A button press.
 *
 * Carries the message it came from because answering one means editing that
 * message's buttons — the press is only half the interaction; removing the
 * button that was pressed is the other half.
 */
export interface CallbackQuery {
  updateId: number;
  /** Answered with answerCallbackQuery, which stops the button spinning. */
  callbackId: string;
  chatId: number;
  messageId: number;
  from: string;
  /** The `callback_data` the button was built with. At most 64 bytes. */
  data: string;
  languageCode?: string;
}

export interface ParsedUpdates {
  messages: IncomingMessage[];
  /** Button presses, which are authorized and handled exactly like messages. */
  callbacks: CallbackQuery[];
  /**
   * Offset to request next. Acknowledges every update seen, including ones
   * skipped as unsupported — otherwise a single unhandled update type (a
   * sticker, a channel post) wedges the loop forever re-fetching it.
   */
  nextOffset: number | null;
}

/**
 * Normalize Telegram's `photo` array into `file_id`s. Telegram lists the same
 * photo at several sizes, smallest first; callers take the last for the full
 * resolution. An empty array means the update carried no usable photo.
 */
export function parsePhotos(photo: unknown): TelegramPhoto[] {
  if (!Array.isArray(photo)) return [];
  const photos: TelegramPhoto[] = [];
  for (const size of photo) {
    const item = size as { file_id?: unknown; width?: unknown; height?: unknown };
    if (typeof item.file_id !== "string" || !item.file_id) continue;
    photos.push({
      fileId: item.file_id,
      ...(typeof item.width === "number" ? { width: item.width } : {}),
      ...(typeof item.height === "number" ? { height: item.height } : {}),
    });
  }
  return photos;
}

/** Normalize Telegram's `voice` (or `audio`) object into a file reference. */
export function parseVoice(voice: unknown): TelegramVoice | null {
  if (typeof voice !== "object" || voice === null) return null;
  const item = voice as { file_id?: unknown; duration?: unknown; mime_type?: unknown };
  if (typeof item.file_id !== "string" || !item.file_id) return null;
  return {
    fileId: item.file_id,
    ...(typeof item.duration === "number" ? { duration: item.duration } : {}),
    ...(typeof item.mime_type === "string" ? { mimeType: item.mime_type } : {}),
  };
}

interface RawSender {
  first_name?: unknown;
  username?: unknown;
  language_code?: unknown;
}

function senderName(from: RawSender | undefined): string {
  return String(from?.username ?? from?.first_name ?? "unknown");
}

export function parseUpdates(payload: unknown): ParsedUpdates {
  const result = payload as { ok?: boolean; result?: unknown[] } | null;
  if (!result?.ok || !Array.isArray(result.result)) {
    return { messages: [], callbacks: [], nextOffset: null };
  }

  const messages: IncomingMessage[] = [];
  const callbacks: CallbackQuery[] = [];
  let highest: number | null = null;

  for (const raw of result.result) {
    const update = raw as {
      update_id?: unknown;
      message?: {
        message_id?: unknown;
        chat?: { id?: unknown };
        from?: RawSender;
        text?: unknown;
        caption?: unknown;
        photo?: unknown;
        voice?: unknown;
        audio?: unknown;
      };
      callback_query?: {
        id?: unknown;
        data?: unknown;
        from?: RawSender;
        message?: { message_id?: unknown; chat?: { id?: unknown } };
      };
    };
    if (typeof update.update_id !== "number") continue;
    // Advanced for EVERY update, including types this function does not
    // return — an un-acknowledged update is redelivered on the next poll,
    // forever.
    highest = highest === null ? update.update_id : Math.max(highest, update.update_id);

    const query = update.callback_query;
    if (query) {
      const queryChatId = query.message?.chat?.id;
      const queryMessageId = query.message?.message_id;
      // A callback whose message Telegram no longer has cannot be answered by
      // editing it, and its chat is what authorization keys off; drop it.
      if (typeof query.id !== "string" || typeof query.data !== "string") continue;
      if (typeof queryChatId !== "number" || typeof queryMessageId !== "number") continue;
      const queryLanguage = query.from?.language_code;
      callbacks.push({
        updateId: update.update_id,
        callbackId: query.id,
        chatId: queryChatId,
        messageId: queryMessageId,
        from: senderName(query.from),
        data: query.data,
        ...(typeof queryLanguage === "string" ? { languageCode: queryLanguage } : {}),
      });
      continue;
    }

    const chatId = update.message?.chat?.id;
    const messageId = update.message?.message_id;
    if (typeof chatId !== "number" || typeof messageId !== "number") continue;

    const rawText = update.message?.text;
    const rawCaption = update.message?.caption;
    const text = typeof rawText === "string" ? rawText.trim()
      : typeof rawCaption === "string" ? rawCaption.trim() : "";
    const photos = parsePhotos(update.message?.photo);
    // Telegram sends a voice note as `voice`; a forwarded recording or a file
    // picked from the music library arrives as `audio`. Both transcribe.
    const voice = parseVoice(update.message?.voice) ?? parseVoice(update.message?.audio);
    // A photo or voice message has no `text` field, so without this an
    // attachment-only message would be treated as blank and dropped.
    if (!text && photos.length === 0 && !voice) continue;

    const languageCode = update.message?.from?.language_code;
    messages.push({
      updateId: update.update_id,
      messageId,
      chatId,
      from: senderName(update.message?.from),
      text,
      ...(typeof languageCode === "string" ? { languageCode } : {}),
      ...(photos.length > 0 ? { photos } : {}),
      ...(voice ? { voice } : {}),
    });
  }

  return { messages, callbacks, nextOffset: highest === null ? null : highest + 1 };
}

/**
 * Parse the chat-id allowlist.
 *
 * An empty list is meaningful: it puts the bridge in discovery mode, where it
 * reports the ids it sees and refuses to act on anything. That gives a way to
 * learn your own chat id without ever leaving the bot open to strangers.
 */
export function parseAllowlist(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const parsed = Number(part);
      if (!Number.isInteger(parsed)) throw new Error(`Not a numeric chat id: "${part}"`);
      return parsed;
    });
}

export function isAllowed(chatId: number, allowlist: number[]): boolean {
  return allowlist.includes(chatId);
}

export type BridgeLocale = "en" | "zh";

/** Telegram reports tags like "zh-hans" or "zh-CN"; both mean Chinese here. */
export function resolveLocale(languageCode: string | undefined): BridgeLocale {
  return languageCode?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const TOOL_LABELS: Record<BridgeLocale, Record<string, string>> = {
  en: {
    todo_add: "added a todo",
    todo_update: "updated a todo",
    todo_delete: "deleted a todo",
    todo_complete: "completed a todo",
    todo_list: "read your todos",
    calendar_create_event: "added an event",
    calendar_list_events: "read your calendar",
    link_add: "saved a link",
    link_list: "read your links",
    gmail_list: "read your mail",
    gmail_get: "opened an email",
    gmail_review: "filed today's mail",
    provider_usage: "checked your quota",
    job_list: "read your job leads",
    job_profile: "read your job profile",
    job_pending: "read the unscored jobs",
    job_score: "scored a job",
    job_status: "moved a job",
    job_scan: "scanned the job boards",
  },
  zh: {
    todo_add: "记了待办",
    todo_update: "改了待办",
    todo_delete: "删了待办",
    todo_complete: "完成了待办",
    todo_list: "查了待办",
    calendar_create_event: "加了日程",
    calendar_list_events: "查了日历",
    link_add: "存了链接",
    link_list: "查了链接",
    gmail_list: "查了邮件",
    gmail_get: "读了一封邮件",
    gmail_review: "归档了今天的邮件",
    provider_usage: "查了额度",
    job_list: "查了职位",
    job_profile: "读了求职档案",
    job_pending: "查了待打分职位",
    job_score: "给职位打了分",
    job_status: "更新了职位状态",
    job_scan: "扫了招聘板",
  },
};

const STRINGS: Record<BridgeLocale, { emptyReply: string; error: (detail: string) => string; separator: string }> = {
  en: {
    emptyReply: "(no reply text)",
    error: (detail) => `Something went wrong: ${detail}`,
    separator: ", ",
  },
  zh: {
    emptyReply: "（没有回复内容）",
    error: (detail) => `出错了：${detail}`,
    separator: "、",
  },
};

export function errorMessage(detail: string, locale: BridgeLocale): string {
  return STRINGS[locale].error(detail);
}

/**
 * Append what the agent actually did.
 *
 * The tool list comes from executed tool calls, not from the model's prose, so
 * it is a factual record of side effects rather than a claim about them.
 */
export function formatReply(reply: string, usedTools: string[], locale: BridgeLocale = "en"): string {
  const strings = STRINGS[locale];
  const labels = TOOL_LABELS[locale];
  const body = reply.trim() || strings.emptyReply;
  const actions = [...new Set(usedTools)].map((name) => labels[name] ?? name);
  return actions.length > 0 ? `${body}\n\n— ${actions.join(strings.separator)}` : body;
}
