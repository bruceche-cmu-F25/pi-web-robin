/**
 * Telegram → Robin bridge.
 *
 * A standalone process, deliberately not a pi extension: extensions load per
 * session, so every `pi -p` invocation and every pi-web session would start its
 * own poller. Telegram's getUpdates acknowledges by offset, so concurrent
 * pollers on one token steal and drop each other's messages. Exactly one
 * consumer is required, and a separate process is the only way to guarantee it.
 *
 * It talks to pi-web over HTTP, reusing /api/robin/assistant — which already
 * carries the tool allow-list, so the bridge inherits the same boundary rather
 * than inventing a second one.
 *
 * Long polling, never webhooks: getUpdates is an outbound call, so nothing
 * needs to listen on a public port and no certificate or tunnel is involved.
 *
 * ## The two loops
 *
 * Polling and scheduling run side by side, not in sequence. They used to share
 * one loop, which meant a morning job digest — scan, then score, then wait for
 * the scorer, up to twenty-odd minutes — held the poller shut for the whole
 * time. Messages were not lost (Telegram keeps updates for a day) but they
 * arrived in a silent heap half an hour later, which is indistinguishable from
 * the bot being down. `runSchedules` is now fired from the poll loop and left
 * to run on its own, guarded so only one pass is ever in flight.
 *
 * Run with:  npm run telegram
 */
import { pathToFileURL } from "node:url";
import { MAX_ATTACHED_IMAGE_BYTES } from "../../lib/image-attachments.ts";
import {
  DEFAULT_DAILY_AGENDA,
  DEFAULT_GMAIL_DIGEST,
  DEFAULT_JOB_DIGEST,
  DEFAULT_REMINDERS,
  DEFAULT_TRANSCRIPTION,
  telegramSettings,
  type DailyAgendaSettings,
  type GmailDigestSettings,
  type JobDigestSettings,
  type ReminderSettings,
  type TranscriptionSettings,
} from "../../extension/robin/settings.ts";
import { isConnected as googleConnected } from "../../extension/robin/google-calendar.ts";
import {
  dailyAgendaLedger,
  gmailLedger,
  jobLedger,
  reminderLedger,
  type DeliveryLedger,
} from "../../extension/robin/store.ts";
import type { Todo } from "../../extension/robin/todo-domain.ts";
import {
  applyCallback,
  createKeyboardMemory,
  numberedJobButtons,
  todoButtons,
  type KeyboardMemory,
} from "./callbacks.ts";
import { mailPrompt, parseCommand, runCommand } from "./commands.ts";
import {
  SCORING_TIMEOUT_MS,
  piWeb as callPiWeb,
  runAssistant,
  type AssistantMode,
  type PiWebContext,
} from "./pi-web.ts";
import {
  errorMessage,
  formatReply,
  isAllowed,
  parseAllowlist,
  parseUpdates,
  resolveLocale,
  type BridgeLocale,
  type CallbackQuery,
  type IncomingMessage,
} from "./protocol.ts";
import { createRateLimit, DEFAULT_RATE_LIMIT, type RateLimit } from "./ratelimit.ts";
import { runReminders } from "./reminders.ts";
import { runIfDue, type Slot } from "./schedule.ts";
import {
  answerCallbackQuery,
  downloadFile,
  editMessageButtons,
  sendMessage as sendTelegramMessage,
  telegram,
  withTyping,
  type InlineButton,
  type TelegramContext,
} from "./telegram-api.ts";
import { MAX_VOICE_BYTES, transcribe, TranscriptionUnavailable } from "./transcribe.ts";

/** Long-poll window; Telegram holds the request open this long when idle. */
const POLL_TIMEOUT_SECONDS = 30;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export interface BridgeConfig {
  token: string;
  allowlist: number[];
  piWebUrl: string;
  /** Basic-auth password when PI_WEB_PASSWORD is set on pi-web. */
  password?: string;
  dailyAgenda: DailyAgendaSettings;
  jobDigest: JobDigestSettings;
  gmailDigest: GmailDigestSettings;
  reminders: ReminderSettings;
  transcription: TranscriptionSettings & { apiKey?: string };
}

export interface BridgeDeps {
  fetch: typeof fetch;
  log: (message: string) => void;
  now: () => number;
  /** Which chats have already received which run. */
  dailyAgendaLedger: DeliveryLedger;
  jobLedger: DeliveryLedger;
  gmailLedger: DeliveryLedger;
  reminderLedger: DeliveryLedger;
  /** Whether Google is connected — injectable so the email digest is testable. */
  googleConnected: () => boolean;
  /**
   * Re-read the settings file. Present in the real process, absent in tests
   * that pin a config. See the note on hot reloading in `run`.
   */
  reloadConfig?: () => BridgeConfig;
  /** Per-chat spend ceiling. Defaults to the standard bucket. */
  rateLimit?: RateLimit;
  /** Which buttons each sent message carries, for retiring them on a press. */
  keyboards?: KeyboardMemory;
  /** When the process started, for /status. */
  startedAt?: number;
}

/**
 * Resolve the token and allow-list.
 *
 * Reads the same store the dashboard's settings screen writes, so a value saved
 * there is what the bridge actually uses — falling back to the environment for
 * headless setups. `stored` is injectable so the tests do not touch the real
 * secrets file.
 */
export function readConfig(
  env: NodeJS.ProcessEnv,
  stored: {
    botToken?: string;
    allowedChatIds: number[];
    dailyAgenda?: DailyAgendaSettings;
    jobDigest?: JobDigestSettings;
    gmailDigest?: GmailDigestSettings;
    reminders?: ReminderSettings;
    transcription?: TranscriptionSettings & { apiKey?: string };
  } = telegramSettings(),
): BridgeConfig {
  const token = stored.botToken?.trim() || env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "No Telegram bot token. Set one on the dashboard settings page (/dashboard/settings), "
      + "or put TELEGRAM_BOT_TOKEN in .env.local.",
    );
  }
  const allowlist = stored.allowedChatIds.length > 0
    ? stored.allowedChatIds
    : parseAllowlist(env.TELEGRAM_ALLOWED_CHAT_IDS);

  return {
    token,
    allowlist,
    piWebUrl: (env.PI_WEB_URL?.trim() || "http://127.0.0.1:30141").replace(/\/$/, ""),
    ...(env.PI_WEB_PASSWORD?.trim() ? { password: env.PI_WEB_PASSWORD.trim() } : {}),
    dailyAgenda: stored.dailyAgenda ?? { ...DEFAULT_DAILY_AGENDA },
    jobDigest: stored.jobDigest ?? { ...DEFAULT_JOB_DIGEST },
    gmailDigest: stored.gmailDigest ?? { ...DEFAULT_GMAIL_DIGEST },
    reminders: stored.reminders ?? { ...DEFAULT_REMINDERS },
    transcription: stored.transcription ?? { ...DEFAULT_TRANSCRIPTION },
  };
}

/* ─────────────────────────── contexts ─────────────────────────── */

/** The Telegram client's view of the config. */
function tg(config: BridgeConfig, deps: BridgeDeps): TelegramContext {
  return { token: config.token, fetch: deps.fetch };
}

/** The pi-web client's view of the config. */
function pi(config: BridgeConfig, deps: BridgeDeps): PiWebContext {
  return {
    url: config.piWebUrl,
    ...(config.password ? { password: config.password } : {}),
    fetch: deps.fetch,
  };
}

/**
 * Send a message, remembering its buttons.
 *
 * Every outbound message goes through here rather than the transport directly,
 * because a button is only half-delivered until the bridge can find it again to
 * retire it.
 */
export async function sendMessage(
  config: BridgeConfig,
  deps: BridgeDeps,
  chatId: number,
  text: string,
  buttons?: InlineButton[][],
): Promise<void> {
  const { messageIds } = await sendTelegramMessage(
    tg(config, deps),
    chatId,
    text,
    buttons ? { buttons } : {},
  );
  // A long reply is sent as several messages and the buttons ride the last
  // one, so that is the id to remember.
  const carrier = messageIds.at(-1);
  if (buttons?.length && deps.keyboards && carrier !== undefined) {
    deps.keyboards.remember(chatId, carrier, buttons);
  }
}

/** Ask the assistant, formatted for Telegram. */
export async function askAssistant(
  config: BridgeConfig,
  deps: BridgeDeps,
  message: string,
  locale: BridgeLocale = "en",
  mode: AssistantMode = "default",
  images: Array<{ data: string; mimeType: string }> = [],
): Promise<string> {
  const { reply, usedTools } = await runAssistant(pi(config, deps), message, mode, images);
  return formatReply(reply, usedTools, locale);
}

/* ─────────────────────────── daily agenda ─────────────────────────── */

/**
 * The morning briefing, with a "done" button per open todo.
 *
 * The todos are fetched separately from the prose because the buttons need real
 * ids, and the ids in the model's summary are whatever it chose to write. What
 * you tap has to be what the store holds.
 */
export async function sendDailyAgenda(
  config: BridgeConfig,
  deps: BridgeDeps,
  date: string,
  chatIds = config.allowlist,
): Promise<void> {
  const prompt = config.dailyAgenda.locale === "zh"
    ? `生成 ${date} 的 Telegram 每日简报。必须调用 todo_list 和 calendar_list_events，简洁列出今天的日程和未完成待办。不要新增或修改任何内容，只返回可直接发送的简报。`
    : `Create my Telegram daily briefing for ${date}. You must call todo_list and calendar_list_events. Concisely list today's agenda and unfinished todos. Do not add or change anything; return only the ready-to-send briefing.`;
  const reply = await askAssistant(config, deps, prompt, config.dailyAgenda.locale, "readOnly");

  // A briefing that cannot offer buttons is still a briefing; a briefing that
  // fails because the todo list would not load is not.
  let buttons: InlineButton[][] | undefined;
  try {
    const list = await callPiWeb<{ todos?: Todo[] }>(
      pi(config, deps), "/api/robin/todos", undefined, 20_000, "GET");
    const open = (list.todos ?? []).filter((todo) => !todo.done);
    if (open.length > 0) buttons = todoButtons(open, config.dailyAgenda.locale);
  } catch (error) {
    deps.log(`[daily agenda] no todo buttons — ${error instanceof Error ? error.message : String(error)}`);
  }

  let delivered = 0;
  for (const chatId of chatIds) {
    try {
      await sendMessage(config, deps, chatId, reply, buttons);
      deps.dailyAgendaLedger.mark(date, chatId);
      delivered += 1;
    } catch (error) {
      // Per chat, like the job digest: one unreachable chat must not abort the
      // broadcast, nor leave the whole run to be retried on every poll cycle.
      deps.log(`[daily agenda] send to ${chatId} failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  deps.log(`[daily agenda] sent ${date} to ${delivered}/${chatIds.length} chat(s)`);
}

/* ─────────────────────────── job digest ─────────────────────────── */

/**
 * Who the job feed goes to.
 *
 * Its own list when one is set, the main allow-list otherwise — so an existing
 * setup keeps working untouched, and pointing the feed at a channel is one
 * field rather than a migration.
 */
export function jobAudience(config: BridgeConfig): number[] {
  return config.jobDigest.chatIds.length > 0 ? config.jobDigest.chatIds : config.allowlist;
}

/** Poll interval and ceiling while waiting for a scoring run to finish. */
const SCORING_POLL_MS = 10_000;
const SCORING_WAIT_MS = 20 * 60_000;

/**
 * Wait for the scoring run to finish before building the digest.
 *
 * Bounded: a run that never settles must not hold the digest for the rest of
 * the day. On timeout the push goes out with whatever has a score by then.
 * Since the schedules no longer share the poll loop, this waiting no longer
 * costs anyone their replies.
 */
export async function waitForScoring(config: BridgeConfig, deps: BridgeDeps): Promise<void> {
  const deadline = deps.now() + SCORING_WAIT_MS;
  for (;;) {
    const state = await callPiWeb<{ scoring?: { running?: boolean } | null }>(
      pi(config, deps),
      "/api/robin/jobs/score",
      {},
      30_000,
      "GET",
    );
    if (!state.scoring?.running) return;
    if (deps.now() >= deadline) {
      deps.log("[jobs] scoring still running after 20 min — sending what is scored so far");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SCORING_POLL_MS));
  }
}

/**
 * One push: find what is new, score it, send the best of it.
 *
 * Ordering is load-bearing. The batch is read with `preview` and only claimed
 * after Telegram accepted it, so a failed send costs nothing — the same jobs
 * are offered again at the next slot instead of being silently marked as
 * delivered. Scanning and scoring failures are logged and stepped over: a
 * board being down should still let yesterday's scored jobs go out.
 */
export async function sendJobDigest(
  config: BridgeConfig,
  deps: BridgeDeps,
  runKey: string,
  chatIds = jobAudience(config),
): Promise<void> {
  const { locale, count } = config.jobDigest;
  const ctx = pi(config, deps);

  try {
    const scan = await callPiWeb<{ scan?: { scanned: number; matched: number; added: number } }>(
      ctx,
      "/api/robin/jobs/scan",
      {},
      SCORING_TIMEOUT_MS,
    );
    if (scan.scan) {
      deps.log(
        `[jobs] scanned ${scan.scan.scanned}, matched ${scan.scan.matched}, ${scan.scan.added} new`,
      );
    }
  } catch (error) {
    deps.log(`[jobs] scan failed — ${error instanceof Error ? error.message : String(error)}`);
  }

  // Size the scoring loop from the real backlog. Scoring is what produces the
  // ranking; pushing only consumes it. Tying the two together is what made a
  // two-hundred-job sweep take ten days to become visible.
  let digest = await callPiWeb<{
    text: string;
    jobIds: string[];
    count: number;
    pending: number;
    scoreBatch: number;
  }>(ctx, "/api/robin/jobs/digest", { preview: true, limit: count, locale });

  // An older pi-web answers without these two fields; arithmetic on undefined
  // yields NaN, and `NaN > 0` is false — scoring would then be skipped in
  // silence rather than reported. Coerce, and say so.
  const pending = Number.isFinite(digest.pending) ? digest.pending : 0;
  if (!Number.isFinite(digest.pending)) {
    deps.log("[jobs] pi-web did not report a backlog — skipping scoring this round");
  }
  if (pending > 0) {
    // Hand the whole job to pi-web's scoring runner rather than looping here:
    // one implementation, one progress file, so a run started by the bridge at
    // eight in the morning draws the same bar as one started from the page.
    deps.log(`[jobs] ${pending} unscored — asking pi-web to score`);
    try {
      await callPiWeb(ctx, "/api/robin/jobs/score", {});
      await waitForScoring(config, deps);
    } catch (error) {
      deps.log(`[jobs] scoring failed — ${error instanceof Error ? error.message : String(error)}`);
    }
    // Re-read: the batch to send is chosen from what the scorer just produced.
    digest = await callPiWeb(ctx, "/api/robin/jobs/digest", { preview: true, limit: count, locale });
  }

  // Numbered action rows ride on the digest itself. One notification, and the
  // numbers line up with the list, so triage is a tap rather than a sentence.
  const buttons = digest.jobIds?.length ? numberedJobButtons(digest.jobIds, locale) : undefined;

  const delivered: number[] = [];
  for (const chatId of chatIds) {
    try {
      await sendMessage(config, deps, chatId, digest.text, buttons);
      delivered.push(chatId);
      deps.jobLedger.mark(runKey, chatId);
    } catch (error) {
      deps.log(`[jobs] send to ${chatId} failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Claim only what actually landed somewhere. Nothing delivered means nothing
  // consumed, and the next slot offers the same jobs again.
  if (delivered.length > 0 && digest.jobIds.length > 0) {
    await callPiWeb(ctx, "/api/robin/jobs/digest", { claim: digest.jobIds }).catch((error) => {
      deps.log(`[jobs] claim failed — ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  deps.log(`[jobs] ${runKey}: ${digest.count} job(s) to ${delivered.length} chat(s)`);
}

/* ─────────────────────────── gmail digest ─────────────────────────── */

/** Who the email digest goes to: its own list when set, else the allow-list. */
export function gmailAudience(config: BridgeConfig): number[] {
  return config.gmailDigest.chatIds.length > 0 ? config.gmailDigest.chatIds : config.allowlist;
}

/** Who gets event reminders: their own list when set, else the allow-list. */
export function reminderAudience(config: BridgeConfig): number[] {
  return config.reminders.chatIds.length > 0 ? config.reminders.chatIds : config.allowlist;
}

/**
 * One email check: the agent reads the configured window and reports what
 * needs attention. Runs in the mail-review mode, whose tool set can read mail
 * and write the todos and events it finds, and nothing else.
 *
 * The prompt is shared with `/mail` so the two cannot drift.
 */
export async function sendGmailDigest(
  config: BridgeConfig,
  deps: BridgeDeps,
  runKey: string,
  chatIds = gmailAudience(config),
): Promise<void> {
  // A missing connection is not an error to retry every thirty seconds — skip
  // the day, like a sweep that fails to start, and let tomorrow try again.
  if (!deps.googleConnected()) {
    deps.log("[gmail digest] skipped — Google is not connected");
    for (const chatId of chatIds) deps.gmailLedger.mark(runKey, chatId);
    return;
  }

  const { locale, query } = config.gmailDigest;
  const reply = await askAssistant(config, deps, mailPrompt(locale, query), locale, "mail");

  let delivered = 0;
  for (const chatId of chatIds) {
    try {
      await sendMessage(config, deps, chatId, reply);
      deps.gmailLedger.mark(runKey, chatId);
      delivered += 1;
    } catch (error) {
      deps.log(`[gmail digest] send to ${chatId} failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  deps.log(`[gmail digest] sent ${runKey} to ${delivered}/${chatIds.length} chat(s)`);
}

/**
 * The nightly directory sweep, at most once a day.
 *
 * Shares the job digest's delivery ledger with its own key, so a bridge that
 * restarts five times between three and four in the morning still sweeps once.
 * The request returns immediately — the sweep runs inside pi-web and takes
 * about a quarter of an hour — so this only has to fire it, not wait for it.
 */
export async function startNightlySweep(
  config: BridgeConfig,
  deps: BridgeDeps,
  runKey: string,
): Promise<void> {
  try {
    const result = await callPiWeb<{ started?: boolean; reason?: string }>(
      pi(config, deps),
      "/api/robin/jobs/sweep",
      { resume: true },
    );
    deps.log(result.started ? `[jobs] nightly sweep started (${runKey})` : `[jobs] sweep skipped — ${result.reason}`);
  } catch (error) {
    deps.log(`[jobs] nightly sweep failed — ${error instanceof Error ? error.message : String(error)}`);
  }
  // Marked whatever happened: a sweep that failed to start should be retried
  // tomorrow, not every sixty seconds for the rest of the night.
  for (const chatId of jobAudience(config)) deps.jobLedger.mark(runKey, chatId);
}

/* ─────────────────────────── incoming ─────────────────────────── */

/** What a voice note failed on, phrased for the person who sent it. */
const VOICE_STRINGS: Record<BridgeLocale, { off: string; failed: (detail: string) => string }> = {
  en: {
    off: "I cannot hear voice notes yet — turn on transcription in Settings → Telegram.",
    failed: (detail) => `I could not transcribe that: ${detail}`,
  },
  zh: {
    off: "我还听不了语音——在「设置 → Telegram」里打开语音转写。",
    failed: (detail) => `没能转写这条语音：${detail}`,
  },
};

/**
 * Turn a voice note into the text it would have been typed as.
 *
 * Returns null when the feature is off, so the caller can say so once rather
 * than treating a deliberate configuration as an outage.
 */
async function textFromVoice(
  config: BridgeConfig,
  deps: BridgeDeps,
  fileId: string,
): Promise<string | null> {
  const audio = await downloadFile(tg(config, deps), fileId, MAX_VOICE_BYTES);
  try {
    return await transcribe(config.transcription, audio, { fetch: deps.fetch });
  } catch (error) {
    if (error instanceof TranscriptionUnavailable) return null;
    throw error;
  }
}

/** Download a Telegram photo as a base64 image attachment for the assistant. */
async function downloadPhoto(
  config: BridgeConfig,
  deps: BridgeDeps,
  fileId: string,
): Promise<{ data: string; mimeType: string }> {
  const { bytes, filePath } = await downloadFile(
    tg(config, deps), fileId, MAX_ATTACHED_IMAGE_BYTES);
  const extension = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  const mimeType = extension === "png" ? "image/png"
    : extension === "webp" ? "image/webp"
    : extension === "gif" ? "image/gif"
    : extension === "bmp" ? "image/bmp"
    : "image/jpeg";
  return { data: Buffer.from(bytes).toString("base64"), mimeType };
}

/** How the rate limiter says no, in the sender's language. */
function throttled(seconds: number, locale: BridgeLocale): string {
  return locale === "zh"
    ? `太快了，${seconds} 秒后再试。`
    : `That is faster than I can think. Try again in ${seconds}s.`;
}

export async function handleMessage(
  config: BridgeConfig,
  deps: BridgeDeps,
  message: IncomingMessage,
): Promise<void> {
  // Authorization happens before anything costly, and before any reply. An
  // unknown chat gets silence, not an error: answering would confirm the bot
  // exists and invite probing.
  if (!isAllowed(message.chatId, config.allowlist)) {
    deps.log(
      config.allowlist.length === 0
        ? `[discovery] chat id ${message.chatId} (${message.from}) said: ${message.text.slice(0, 60)}\n`
          + `           Add it: TELEGRAM_ALLOWED_CHAT_IDS=${message.chatId}`
        : `[refused] chat id ${message.chatId} (${message.from}) is not on the allow-list`,
    );
    return;
  }

  // The bridge has no access to the dashboard's language setting, so replies
  // follow the sender's own Telegram client language.
  const locale = resolveLocale(message.languageCode);

  // After authorization, before any spend. The allow-list keeps strangers out;
  // this keeps a stuck client from running up a bill.
  const rateLimit = deps.rateLimit;
  if (rateLimit) {
    const wait = rateLimit.take(message.chatId, deps.now());
    if (wait !== null) {
      deps.log(`[throttled] chat ${message.chatId} — ${wait}s`);
      await sendMessage(config, deps, message.chatId, throttled(wait, locale)).catch(() => {});
      return;
    }
  }

  deps.log(
    `[${message.chatId}] ${message.text
      || (message.voice ? "(voice)" : message.photos?.length ? "(photo)" : "")}`,
  );

  try {
    // Commands first: they are the cheap, deterministic path, and a `/today`
    // that went to the model would be the slow answer to a fast question.
    const command = message.text ? parseCommand(message.text) : null;
    if (command) {
      const reply = await withTyping(
        tg(config, deps),
        message.chatId,
        () => runCommand(
          {
            piWeb: pi(config, deps),
            locale,
            startedAt: deps.startedAt ?? deps.now(),
            now: deps.now,
          },
          command.name,
          command.argument,
        ),
      );
      // An unrecognised command is more likely a typo than a demand for an
      // error, so it falls through to the model like any other sentence.
      if (reply) {
        await sendMessage(config, deps, message.chatId, reply.text, reply.buttons);
        return;
      }
    }

    let text = message.text;

    if (message.voice) {
      const transcript = await withTyping(
        tg(config, deps),
        message.chatId,
        () => textFromVoice(config, deps, message.voice!.fileId),
        "record_voice",
      );
      if (transcript === null) {
        await sendMessage(config, deps, message.chatId, VOICE_STRINGS[locale].off);
        return;
      }
      // Echoed back before acting on it: speech recognition is wrong often
      // enough that "what did it think I said" has to be answerable, and a
      // misheard instruction is worth catching before its tool call, not after.
      await sendMessage(config, deps, message.chatId, `🎤 ${transcript}`);
      text = [message.text, transcript].filter(Boolean).join("\n");
    }

    // Telegram sends each photo as several sizes, smallest first; the largest
    // (last) is the one to send on to the model.
    const largest = message.photos?.at(-1);
    const images = largest ? [await downloadPhoto(config, deps, largest.fileId)] : [];

    const reply = await withTyping(
      tg(config, deps),
      message.chatId,
      () => askAssistant(config, deps, text, locale, "default", images),
    );
    await sendMessage(config, deps, message.chatId, reply);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    deps.log(`[error] ${detail}`);
    // The sender is authorized, so an error is useful to them rather than a leak.
    await sendMessage(config, deps, message.chatId, errorMessage(detail, locale)).catch(() => {});
  }
}

/**
 * A button press.
 *
 * Authorized exactly like a message — the chat id is the same gate — and then
 * carried out without the model, because the payload is one we wrote. The
 * callback is answered first: Telegram spins the button until it is, and
 * fifteen seconds of spinner is a worse failure than a slow REST call.
 */
export async function handleCallback(
  config: BridgeConfig,
  deps: BridgeDeps,
  query: CallbackQuery,
): Promise<void> {
  if (!isAllowed(query.chatId, config.allowlist)) {
    deps.log(`[refused] callback from chat id ${query.chatId} (${query.from})`);
    return;
  }

  const locale = resolveLocale(query.languageCode);
  const context = tg(config, deps);
  deps.log(`[${query.chatId}] button ${query.data}`);

  const outcome = await applyCallback(pi(config, deps), query.data, locale);
  await answerCallbackQuery(context, query.callbackId, outcome.toast).catch(() => {});

  if (outcome.retire.length === 0 || !deps.keyboards) return;
  const remaining = deps.keyboards.without(query.chatId, query.messageId, outcome.retire);
  // Null means the message predates this process; leaving its buttons alone
  // beats clearing a keyboard we cannot reconstruct.
  if (remaining === null) return;
  await editMessageButtons(context, query.chatId, query.messageId, remaining)
    .catch((error) => deps.log(`[callback] could not update buttons — ${error instanceof Error ? error.message : String(error)}`));
}

/**
 * One long-poll cycle. Returns the next offset.
 *
 * Messages are handled strictly one at a time: they all land in the same pi
 * session, which cannot take a second prompt while the first is still running.
 * Button presses do not touch the model, so they are handled first — waiting
 * behind a two-minute turn to record "applied" would defeat the point of them.
 */
export async function pollOnce(
  config: BridgeConfig,
  deps: BridgeDeps,
  offset: number | null,
): Promise<number | null> {
  const payload = await telegram(
    tg(config, deps),
    "getUpdates",
    {
      timeout: POLL_TIMEOUT_SECONDS,
      ...(offset === null ? {} : { offset }),
      allowed_updates: ["message", "callback_query"],
    },
    (POLL_TIMEOUT_SECONDS + 15) * 1000,
  );

  const { messages, callbacks, nextOffset } = parseUpdates(payload);
  for (const callback of callbacks) {
    await handleCallback(config, deps, callback);
  }
  for (const message of messages) {
    await handleMessage(config, deps, message);
  }
  return nextOffset ?? offset;
}

/**
 * Everything that happens on a clock: the four digests and the reminders.
 *
 * Separated from `pollOnce` so it can take as long as it takes. A job digest
 * that scans, scores, and waits for the scorer can run for twenty minutes; the
 * poll loop keeps answering messages throughout.
 */
export async function runSchedules(config: BridgeConfig, deps: BridgeDeps): Promise<void> {
  const now = deps.now();

  const agendaSlots: Slot[] = config.dailyAgenda.enabled
    ? [{ key: "", at: config.dailyAgenda.time }]
    : [];
  await runIfDue(deps.dailyAgendaLedger, config.allowlist, agendaSlots, now,
    (key, chats) => sendDailyAgenda(config, deps, key, chats));

  const mailChats = gmailAudience(config);
  const mailSlots: Slot[] = config.gmailDigest.enabled
    ? [{ key: "", at: config.gmailDigest.time }]
    : [];
  await runIfDue(deps.gmailLedger, mailChats, mailSlots, now,
    (key, chats) => sendGmailDigest(config, deps, key, chats));

  const jobChats = jobAudience(config);
  const sweepSlots: Slot[] = config.jobDigest.enabled && config.jobDigest.sweepAt
    ? [{ key: "sweep", at: config.jobDigest.sweepAt }]
    : [];
  await runIfDue(deps.jobLedger, jobChats, sweepSlots, now,
    (key) => startNightlySweep(config, deps, key));

  const digestSlots: Slot[] = config.jobDigest.enabled
    ? [
        { key: "morning", at: config.jobDigest.morning },
        { key: "evening", at: config.jobDigest.evening },
      ]
    : [];
  await runIfDue(deps.jobLedger, jobChats, digestSlots, now,
    (key, chats) => sendJobDigest(config, deps, key, chats));

  if (config.reminders.enabled) {
    await runReminders({
      ctx: pi(config, deps),
      ledger: deps.reminderLedger,
      audience: reminderAudience(config),
      leadMinutes: config.reminders.lead,
      locale: config.reminders.locale,
      now: deps.now,
      log: deps.log,
      send: (chatId, text) => sendMessage(config, deps, chatId, text),
    });
  }
}

export async function run(config: BridgeConfig, deps: BridgeDeps): Promise<void> {
  deps.log(`Robin Telegram bridge → ${config.piWebUrl}`);
  announce(config, deps);

  let offset: number | null = null;
  let backoff = BACKOFF_START_MS;
  /** Guards the schedules: exactly one pass in flight, however long it takes. */
  let scheduling = false;

  for (;;) {
    try {
      // Settings are re-read every cycle, so a send time or an allow-list
      // edited on the dashboard takes effect within the poll window instead of
      // waiting for a restart nobody remembers to do. A token change is the one
      // thing that cannot be picked up live — it is the address we long-poll on.
      if (deps.reloadConfig) {
        try {
          const reloaded = deps.reloadConfig();
          config = { ...reloaded, token: config.token };
        } catch (error) {
          deps.log(`[settings] keeping the running config — ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      offset = await pollOnce(config, deps, offset);

      // Fired, not awaited. This is the fix for a digest holding the poller
      // shut: the schedules run alongside the next getUpdates, not in front
      // of it.
      if (!scheduling) {
        scheduling = true;
        const scheduled = config;
        void runSchedules(scheduled, deps)
          .catch((error) => deps.log(`[schedule error] ${error instanceof Error ? error.message : String(error)}`))
          .finally(() => { scheduling = false; });
      }

      backoff = BACKOFF_START_MS;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      deps.log(`[poll error] ${detail} — retrying in ${Math.round(backoff / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      // Exponential backoff keeps a dead network or a revoked token from
      // hammering Telegram and burning rate limit.
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
  }
}

/** What this bridge will and will not do, said once at startup. */
function announce(config: BridgeConfig, deps: BridgeDeps): void {
  deps.log(
    config.allowlist.length === 0
      ? "No allow-list set — running in discovery mode. Message the bot to learn your chat id; nothing will be acted on."
      : `Allowed chat ids: ${config.allowlist.join(", ")}`,
  );
  const jobChats = jobAudience(config);
  deps.log(
    config.jobDigest.chatIds.length > 0
      ? `Job feed goes to its own chat(s): ${jobChats.join(", ")}`
      : `Job feed shares the main allow-list: ${jobChats.join(", ") || "(none)"}`,
  );
  const mailChats = gmailAudience(config);
  deps.log(
    config.gmailDigest.chatIds.length > 0
      ? `Email digest goes to its own chat(s): ${mailChats.join(", ")}`
      : `Email digest shares the main allow-list: ${mailChats.join(", ") || "(none)"}`,
  );
  deps.log(
    config.reminders.enabled
      ? `Event reminders ${config.reminders.lead} min ahead → ${reminderAudience(config).join(", ") || "(none)"}`
      : "Event reminders are off",
  );
  deps.log(
    config.transcription.enabled && config.transcription.apiKey
      ? `Voice notes transcribed with ${config.transcription.model}`
      : "Voice notes are not transcribed (no key, or turned off)",
  );
}

// Compare resolved URLs rather than matching on the filename: a suffix match
// would also fire when this module is imported by a script of the same name.
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const startedAt = Date.now();
  const deps: BridgeDeps = {
    fetch: globalThis.fetch,
    log: (message) => console.log(`${new Date().toISOString()} ${message}`),
    now: () => Date.now(),
    dailyAgendaLedger,
    jobLedger,
    gmailLedger,
    reminderLedger,
    googleConnected,
    reloadConfig: () => readConfig(process.env),
    rateLimit: createRateLimit(DEFAULT_RATE_LIMIT),
    keyboards: createKeyboardMemory(),
    startedAt,
  };
  try {
    await run(readConfig(process.env), deps);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
