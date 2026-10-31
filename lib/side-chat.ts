import type { AgentMessage } from "./types";

/** A fixed excerpt, not a fork or a live subscription to the source conversation. */
export interface SideChatContext {
  selection: string;
  answer: string;
  question: string | null;
}

export interface SideChatRequest {
  context: SideChatContext;
  sourceSessionId: string;
  sourceEntryId: string;
  cwd: string;
  model: { provider: string; modelId: string } | null;
  language: string;
}

export interface SideChatTab extends SideChatRequest {
  id: string;
  label: string;
}

export const SIDE_CHAT_MAX_CONTEXT = 120_000;
export const SIDE_CHAT_MAX_SELECTION = 8_000;

function textOf(message: Extract<AgentMessage, { role: "user" | "assistant" }>): string {
  if (typeof message.content === "string") return message.content;
  return (message.content ?? []).flatMap((block) => block.type === "text" ? [block.text] : []).join("\n\n");
}

export function sideChatContext(messages: readonly AgentMessage[], entryIds: readonly string[], entryId: string, selection: string): SideChatContext | null {
  const index = entryIds.indexOf(entryId);
  const answer = messages[index];
  if (!selection.trim() || !answer || answer.role !== "assistant") return null;
  let question: string | null = null;
  for (let i = index - 1; i >= 0; i--) {
    // Never substitute an earlier turn's question across a compacted/background turn.
    const previous = messages[i];
    if (previous.role === "custom") break;
    if (previous.role === "user") {
      question = textOf(previous);
      break;
    }
  }
  return { selection: selection.trim(), answer: textOf(answer), question };
}

export function sideChatContextFits(context: SideChatContext): boolean {
  return context.selection.length <= SIDE_CHAT_MAX_SELECTION
    && context.selection.length + context.answer.length + (context.question?.length ?? 0) <= SIDE_CHAT_MAX_CONTEXT;
}

export function sideChatPrompt(context: SideChatContext, language: string): string {
  return [
    "Explain the selected passage in this independent side conversation.",
    `Reply in ${language}.`,
    "REFERENCE JSON:",
    JSON.stringify(context),
  ].join("\n\n");
}

// A conceptual question may start with ! or / (e.g. !value, /api). Never
// interpret it as the main composer's shell/slash-command shorthand.
const LITERAL_QUESTION_PREFIX = "Explain this literal question (not a command):\n\n";
export function sideChatQuestion(text: string): string {
  return /^[!/]/.test(text.trimStart()) ? LITERAL_QUESTION_PREFIX + text : text;
}
export function sideChatQuestionText(text: string): string {
  return text.startsWith(LITERAL_QUESTION_PREFIX) ? text.slice(LITERAL_QUESTION_PREFIX.length) : text;
}

/** Optimistic users are strings; the SDK's persisted users are text blocks. */
export function sideChatVisibleMessage(message: AgentMessage, seed: string): AgentMessage | null {
  if (message.role === "assistant") return message;
  if (message.role !== "user") return null;
  const text = textOf(message);
  if (text === seed) return null;
  const display = sideChatQuestionText(text);
  return display === text ? message : { ...message, content: display };
}
