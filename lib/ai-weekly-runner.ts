import { generateWeekly, deliverWeeklyDay, weeklyPreferences, weeklyView, type WeeklyResearchDeps } from "../extension/robin/ai-weekly-domain.ts";
import { AI_WEEKLY_RESEARCH_TOOLS, WEEKLY_RESEARCH_PREAMBLE, WEEKLY_EDITOR_PREAMBLE } from "../extension/robin/ai-weekly-research.ts";
import { telegramSettings } from "../extension/robin/settings.ts";
import { telegram } from "../scripts/telegram/telegram-api.ts";

const research: WeeklyResearchDeps = {
  async harvest(message, signal, remember) {
    const { runScopedAssistantTurn } = await import("./robin-assistant");
    const result = await runScopedAssistantTurn({ remembered: null, remember, oneShot: true,
      toolNames: [...AI_WEEKLY_RESEARCH_TOOLS], preamble: WEEKLY_RESEARCH_PREAMBLE,
      message, signal, timeoutMs: 10 * 60_000 });
    return result.reply;
  },
  async brief(message, signal, remember) {
    const { runScopedAssistantTurn } = await import("./robin-assistant");
    const result = await runScopedAssistantTurn({ remembered: null, remember, oneShot: true,
      toolNames: [], preamble: WEEKLY_EDITOR_PREAMBLE, message, signal, timeoutMs: 180_000 });
    return result.reply;
  },
};

export function startWeeklyGeneration(): boolean {
  const view = weeklyView();
  if (view.running || view.edition) return false;
  void generateWeekly(research, true).catch((error) => {
    console.error("[ai-weekly] generation failed:", error instanceof Error ? error.message : "unknown error");
  });
  return true;
}
export async function tickWeekly(): Promise<void> {
  if (!weeklyPreferences().enabled) return;
  try { await generateWeekly(research); }
  catch { /* Persisted failure/backoff is visible in the workspace. Delivery still gets its turn. */ }
  const config = telegramSettings();
  if (!config.botToken) return;
  await deliverWeeklyDay({ audience: config.allowedChatIds, async send(chatId, text, signal) {
    // Consent and recipient configuration can change during a slow research turn.
    const latest = telegramSettings();
    if (!latest.botToken || !latest.allowedChatIds.includes(chatId)) return false;
    try {
      const result = await telegram({ token: latest.botToken, fetch: (url, init) => fetch(url, {
        ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
      }) }, "sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
      const response = result as { ok?: boolean; result?: { message_id?: number } } | null;
      if (response?.ok === false) return false;
      if (response?.ok !== true || typeof response.result?.message_id !== "number") throw new Error("Uncertain Telegram response");
      return true;
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status === 400 || status === 403 || status === 429) return false;
      throw error;
    }
  } });
}

const registry = globalThis as typeof globalThis & {
  __aiWeeklyScheduler?: { timer: ReturnType<typeof setInterval>; tick: typeof tickWeekly; busy: boolean };
};
/** Runs with Pi Web, not with an open browser. Restart catch-up selects only today's item. */
export function startWeeklyScheduler(): void {
  const previous = registry.__aiWeeklyScheduler;
  if (previous?.tick === tickWeekly) return;
  if (previous) clearInterval(previous.timer);
  const entry = { timer: undefined as unknown as ReturnType<typeof setInterval>, tick: tickWeekly, busy: false };
  const wake = () => {
    if (entry.busy) return;
    entry.busy = true;
    void entry.tick().catch(() => console.error("[ai-weekly] scheduler failed; check storage and configuration"))
      .finally(() => { entry.busy = false; });
  };
  entry.timer = setInterval(wake, 60_000);
  entry.timer.unref?.();
  registry.__aiWeeklyScheduler = entry;
  // Do not run during registration itself; let the server finish starting.
  const initial = setTimeout(wake, 5000);
  initial.unref?.();
}
