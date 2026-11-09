/** Client-safe contract. A spoken sentence is not an execution receipt. */
export interface VoiceTaskReceipt {
  requestId: string;
  action: "add" | "update" | "complete" | "archive" | "undo";
  taskId: string;
  title: string;
  due?: string;
  revision: string;
  undoable: boolean;
}
export interface VoiceInteractionReply {
  requestId: string;
  state: "pending" | "done" | "failed" | "uncertain";
  answer: string;
  spoken: string;
  sessionId?: string;
  receipt?: VoiceTaskReceipt;
}
export interface VoiceInteractionRequest {
  requestId: string;
  message: string;
  allowTasks: boolean;
  lastActionId?: string;
  undoOf?: string;
}
export const VOICE_REQUEST_TTL = 10 * 60_000;
export function validVoiceRequestId(value: unknown): value is string {
  return typeof value === "string" && /^\d{13}-[a-f0-9-]{36}$/.test(value);
}
export function parseVoiceInteraction(value: unknown): VoiceInteractionRequest {
  const v = value as Partial<VoiceInteractionRequest> | null;
  if (!v || !validVoiceRequestId(v.requestId) || typeof v.message !== "string" || !v.message.trim() || v.message.length > 4000
    || typeof v.allowTasks !== "boolean" || (v.lastActionId !== undefined && !validVoiceRequestId(v.lastActionId))
    || (v.undoOf !== undefined && (!validVoiceRequestId(v.undoOf) || !v.allowTasks))) throw new Error("request");
  return { requestId: v.requestId, message: v.message.trim(), allowTasks: v.allowTasks,
    ...(v.lastActionId ? { lastActionId: v.lastActionId } : {}), ...(v.undoOf ? { undoOf: v.undoOf } : {}) };
}
