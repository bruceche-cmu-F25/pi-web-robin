/** Browser-safe transcript contract. Text only; never a prompt or a tool request. */
export interface VoiceTranscript {
  id: string;
  role: "user" | "assistant";
  text: string;
  interrupted: boolean;
  /** Absent is the retained Boson Realtime caption contract. */
  source?: "robin";
}
export type VoiceTranscriptSink = (entry: VoiceTranscript) => Promise<void>;

export function parseVoiceTranscript(value: unknown): VoiceTranscript {
  const v = value as Partial<VoiceTranscript> | null;
  if (!v || typeof v.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(v.id)
    || (v.role !== "user" && v.role !== "assistant") || typeof v.text !== "string"
    || !v.text.trim() || v.text.length > 4000 || typeof v.interrupted !== "boolean"
    || (v.source !== undefined && v.source !== "robin")) {
    throw new Error("Invalid voice transcript");
  }
  return { id: v.id, role: v.role, text: v.text, interrupted: v.interrupted, ...(v.source ? { source: v.source } : {}) };
}
