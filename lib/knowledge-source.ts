import { createHash } from "node:crypto";
import type { SessionEntry } from "./types.ts";

export type KnowledgeScope = "all" | "recent12" | "recent4";
export interface KnowledgeSource {
  sessionId: string;
  leafId: string;
  scope: KnowledgeScope;
  sessionName: string;
  project: string;
  url: string;
  capturedAt: string;
  fingerprint: string;
  messages: Array<{ id: string; role: "user" | "assistant"; text: string }>;
  totalMessages: number;
  chars: number;
}
export const KNOWLEDGE_SOURCE_LIMIT = 80_000;

/** Raw, visible conversation on exactly one branch; never reasoning, tools, system or injected custom messages. */
export function knowledgeSource(entries: SessionEntry[], input: {
  sessionId: string; leafId: string; scope: KnowledgeScope; sessionName: string; project: string; origin: string;
}): KnowledgeSource {
  if (!["all", "recent12", "recent4"].includes(input.scope)) throw new Error("Invalid conversation range");
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let entry = byId.get(input.leafId);
  if (!entry) throw new Error("The selected branch no longer exists");
  const visited = new Set<string>();
  const messages: KnowledgeSource["messages"] = [];
  while (entry) {
    if (visited.has(entry.id)) throw new Error("Invalid session tree");
    visited.add(entry.id);
    if (entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant")) {
      const message = entry.message;
      const text = typeof message.content === "string" ? message.content
        : message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
      if (text.trim()) messages.push({ id: entry.id, role: message.role, text });
    }
    if (!entry.parentId) break;
    entry = byId.get(entry.parentId);
    if (!entry) throw new Error("The session branch has a missing ancestor");
  }
  messages.reverse();
  const selected = input.scope === "all" ? messages : messages.slice(input.scope === "recent12" ? -12 : -4);
  const chars = selected.reduce((sum, message) => sum + message.text.length, 0);
  return {
    sessionId: input.sessionId, leafId: input.leafId, scope: input.scope,
    sessionName: input.sessionName, project: input.project,
    url: `${new URL(input.origin).origin}/?session=${encodeURIComponent(input.sessionId)}`,
    capturedAt: new Date().toISOString(), totalMessages: messages.length, chars,
    fingerprint: createHash("sha256").update(JSON.stringify({ sessionId: input.sessionId, leafId: input.leafId, scope: input.scope, messages: selected })).digest("hex"),
    // Do not silently summarize a clipped transcript. The UI must ask for a smaller range.
    messages: chars <= KNOWLEDGE_SOURCE_LIMIT ? selected : [],
  };
}

export function knowledgeSourceText(source: KnowledgeSource): string {
  if (source.chars > KNOWLEDGE_SOURCE_LIMIT) throw new Error("Conversation is too long. Choose a smaller range.");
  if (!source.messages.length) throw new Error("No user or assistant text in this range");
  return source.messages.map((message) => `[${message.role} · ${message.id}]\n${message.text}`).join("\n\n");
}
