/** Explicit editorial entry point. Only the trusted scheduler may add an atomic delivery intent; never sends here. */
import { localDate } from "../extension/robin/dates.ts";
import { runShadowBrief } from "../extension/robin/brief-domain.ts";
import { collectStoredBriefSource } from "../extension/robin/brief-sources.ts";
import { collectGmailBrief } from "../extension/robin/brief-mail.ts";
import { collectCalendarBrief } from "../extension/robin/brief-calendar.ts";
import { collectPublicBrief } from "../extension/robin/brief-public.ts";
import type { BriefScope } from "../extension/robin/brief.ts";
import { BRIEF_EDITOR_PREAMBLE } from "../extension/robin/brief-editor.ts";
import type { runScopedAssistantTurn } from "./robin-assistant";

export async function composeBrief(requestId: string,
  options: { allowPrivateModel: boolean; input?: "stored" | "gmail" | "live"; signal: AbortSignal; scope?: BriefScope; delivery?: { expiresAt: number } }, turn?: typeof runScopedAssistantTurn) {
  const { allowPrivateModel, signal, input = "stored" } = options;
  if (input !== "stored" && input !== "gmail" && input !== "live") throw new Error("Invalid Brief input mode");
  if (allowPrivateModel !== true) throw new Error("Explicit consent to send bounded private inputs to the configured model is required");
  return runShadowBrief(requestId, {
    scope: options.scope ?? { day: localDate(new Date()), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    inputProfile: input === "live" ? "editor-live-v1" : input === "gmail" ? "editor-gmail-v1" : "editor-stored-v1", signal, delivery: options.delivery,
    ...(input === "live" ? { sourceOrder: ["calendar", "world", "mail", "todos"] as const } : {}),
    collect: (source, scope, signal, acquisition) => input !== "stored" && source === "mail"
      ? collectGmailBrief(scope, signal, acquisition) : input === "live" && source === "calendar"
        ? collectCalendarBrief(scope, signal, acquisition) : input === "live" && source === "world"
          ? collectPublicBrief(scope, signal, acquisition) : collectStoredBriefSource(source, scope, signal),
    editor: async (message, signal) => {
      const run = turn ?? (await import("./robin-assistant")).runScopedAssistantTurn;
      const result = await run({ remembered: null, remember: () => {}, oneShot: true, silenceCompletionNotifications: true, toolNames: [],
        preamble: BRIEF_EDITOR_PREAMBLE, message, signal, timeoutMs: 90_000 }).catch(() => {
        signal.throwIfAborted();
        throw new Error("Brief model turn failed; its allowance remains reserved. Check the model configuration before starting another paid request");
      });
      if (result.usedTools.length) throw new Error("Brief editor violated its tool-free scope");
      return result.reply;
    },
  });
}
