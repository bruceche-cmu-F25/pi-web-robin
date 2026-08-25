/**
 * Inline button presses.
 *
 * A press is the one path through this bridge that never reaches the model: the
 * payload was written by us when the message was sent, so acting on it is a
 * lookup, not an interpretation. That is the point — marking a job applied from
 * the phone should cost a REST call and 200ms, not a model turn and a minute.
 *
 * It also means the button vocabulary is a closed set. `parseCallback` accepts
 * exactly what `jobButtons` and `todoButtons` can produce and nothing else, so
 * a payload that did not come from us is refused rather than dispatched.
 */
import type { BridgeLocale } from "./protocol.ts";
import { piWeb, type PiWebContext } from "./pi-web.ts";
import type { InlineButton } from "./telegram-api.ts";

/** Job pipeline transitions a button may request. Mirrors JOB_STATUSES. */
const JOB_ACTIONS = ["shortlist", "applied", "dropped"] as const;
type JobAction = (typeof JOB_ACTIONS)[number];

export type Callback =
  | { kind: "job"; action: JobAction; id: string }
  | { kind: "todo"; action: "done"; id: string };

/**
 * Read a `callback_data` payload.
 *
 * Returns null for anything outside the closed set, including a well-formed
 * payload naming an action we do not offer. Ids are checked for shape, not
 * existence — that is the store's answer to give.
 */
export function parseCallback(data: string): Callback | null {
  const parts = data.split(":");
  if (parts.length !== 3) return null;
  const [kind, action, id] = parts;
  if (!id || !/^[A-Za-z0-9_-]{1,48}$/.test(id)) return null;

  if (kind === "job" && JOB_ACTIONS.includes(action as JobAction)) {
    return { kind: "job", action: action as JobAction, id };
  }
  if (kind === "todo" && action === "done") {
    return { kind: "todo", action: "done", id };
  }
  return null;
}

const TOASTS: Record<BridgeLocale, Record<string, string>> = {
  en: {
    shortlist: "Shortlisted",
    applied: "Marked applied",
    dropped: "Dropped",
    done: "Done",
    unknown: "That button is no longer valid",
    failed: "Could not do that",
  },
  zh: {
    shortlist: "已加入候选",
    applied: "已标记投递",
    dropped: "已丢弃",
    done: "已完成",
    unknown: "这个按钮已失效",
    failed: "没能完成",
  },
};

/** Labels on the buttons themselves. Short: three sit on one phone-width row. */
const LABELS: Record<BridgeLocale, Record<string, string>> = {
  en: {
    shortlist: "⭐ Shortlist",
    applied: "✅ Applied",
    dropped: "✕ Drop",
    done: "✓ Done",
    open: "↗ Open",
  },
  zh: {
    shortlist: "⭐ 候选",
    applied: "✅ 已投",
    dropped: "✕ 丢弃",
    done: "✓ 完成",
    open: "↗ 打开",
  },
};

/** The three-way row under a job in the digest, plus a link when there is one. */
export function jobButtons(id: string, locale: BridgeLocale, url?: string): InlineButton[][] {
  const labels = LABELS[locale];
  const row: InlineButton[] = [
    { text: labels.shortlist ?? "Shortlist", data: `job:shortlist:${id}` },
    { text: labels.applied ?? "Applied", data: `job:applied:${id}` },
    { text: labels.dropped ?? "Drop", data: `job:dropped:${id}` },
  ];
  // The link goes on its own row: it is the wide one, and mixing it in makes
  // the three actions too narrow to hit.
  return url ? [row, [{ text: labels.open ?? "Open", url }]] : [row];
}

/**
 * Action rows for a digest, numbered to match the list above them.
 *
 * The digest text is a numbered list, so the buttons carry the same number
 * rather than a truncated job title: "⭐ 3" against "3. 4.5 Acme — Engineer" is
 * unambiguous, and three of them fit a phone-width row. Attaching these to the
 * digest itself is what keeps a push to one notification instead of six.
 */
export function numberedJobButtons(
  ids: string[],
  locale: BridgeLocale,
  limit = 5,
): InlineButton[][] {
  const labels = LABELS[locale];
  return ids.slice(0, limit).map((id, index) => {
    const at = index + 1;
    return [
      { text: `${labels.shortlist ?? "⭐"} ${at}`, data: `job:shortlist:${id}` },
      { text: `${labels.applied ?? "✅"} ${at}`, data: `job:applied:${id}` },
      { text: `${labels.dropped ?? "✕"} ${at}`, data: `job:dropped:${id}` },
    ];
  });
}

/** One "done" button per open todo in the daily briefing. */
export function todoButtons(
  todos: Array<{ id: string; title: string }>,
  locale: BridgeLocale,
  limit = 8,
): InlineButton[][] {
  const label = LABELS[locale].done ?? "Done";
  // One button per row: a todo title is long, and a truncated one is unusable.
  return todos.slice(0, limit).map((todo) => [{
    text: `${label} ${todo.title.slice(0, 24)}`,
    data: `todo:done:${todo.id}`,
  }]);
}

export interface CallbackOutcome {
  /** Shown as a toast on the button that was pressed. */
  toast: string;
  /**
   * Callback payloads this press used up. The bridge drops those buttons from
   * the message, which is what stops a triaged job being triaged again.
   *
   * Naming payloads rather than "clear the keyboard" is what lets the job row
   * retire while the link to the posting stays — the moment you mark something
   * applied is exactly when you might want to open it.
   */
  retire: string[];
}

/** Every payload a job's action row can carry, spent together. */
function jobRow(id: string): string[] {
  return JOB_ACTIONS.map((action) => `job:${action}:${id}`);
}

/**
 * Carry out a press.
 *
 * Every failure comes back as a toast rather than an exception: a button that
 * cannot be honoured should say so on the button, not take down the poll cycle
 * that delivered it.
 */
export async function applyCallback(
  ctx: PiWebContext,
  data: string,
  locale: BridgeLocale,
): Promise<CallbackOutcome> {
  const toasts = TOASTS[locale];
  const parsed = parseCallback(data);
  if (!parsed) return { toast: toasts.unknown ?? "Unknown", retire: [] };

  try {
    if (parsed.kind === "job") {
      await piWeb(ctx, "/api/robin/jobs", { id: parsed.id, status: parsed.action }, 15_000, "PATCH");
      // The pipeline is one choice out of three, so all three are spent.
      return { toast: toasts[parsed.action] ?? "Done", retire: jobRow(parsed.id) };
    }
    await piWeb(ctx, "/api/robin/todos", { id: parsed.id, done: true }, 15_000, "PATCH");
    return { toast: toasts.done ?? "Done", retire: [data] };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Nothing is retired on a failure: the button has to stay pressable, or a
    // pi-web restart in the middle of a digest would silently eat the action.
    return { toast: `${toasts.failed ?? "Failed"}: ${detail}`.slice(0, 200), retire: [] };
  }
}

/**
 * A bounded memory of which buttons a sent message carries.
 *
 * Telegram hands back the message a button belongs to, but not its keyboard, so
 * retiring one button while keeping the rest needs the original. It is kept in
 * memory on purpose: a restart losing it costs a stale button that still works
 * (every action here is idempotent), which is not worth a file and a lock.
 */
export function createKeyboardMemory(capacity = 200) {
  const byMessage = new Map<string, InlineButton[][]>();

  return {
    remember(chatId: number, messageId: number, buttons: InlineButton[][]): void {
      if (buttons.length === 0) return;
      const key = `${chatId}:${messageId}`;
      // Map preserves insertion order, so deleting the first key evicts the
      // oldest — enough for a memory whose miss is merely a stale button.
      if (byMessage.size >= capacity) {
        const oldest = byMessage.keys().next().value;
        if (oldest !== undefined) byMessage.delete(oldest);
      }
      byMessage.set(key, buttons);
    },

    /**
     * The keyboard with `retire`d payloads removed, or null when the message is
     * not remembered — in which case the caller should leave it alone rather
     * than guess.
     */
    without(chatId: number, messageId: number, retire: string[]): InlineButton[][] | null {
      const key = `${chatId}:${messageId}`;
      const buttons = byMessage.get(key);
      if (!buttons) return null;
      const spent = new Set(retire);
      const remaining = buttons
        .map((row) => row.filter((button) => !button.data || !spent.has(button.data)))
        .filter((row) => row.length > 0);
      if (remaining.length === 0) byMessage.delete(key);
      else byMessage.set(key, remaining);
      return remaining;
    },
  };
}

export type KeyboardMemory = ReturnType<typeof createKeyboardMemory>;
