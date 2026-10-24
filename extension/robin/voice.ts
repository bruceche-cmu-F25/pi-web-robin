/** Client/server contract for short, ephemeral voice turns (not saved recordings). */
export const VOICE_SECONDS = 60;
export const VOICE_SAMPLE_RATE = 16_000;
export const VOICE_MAX_BYTES = 44 + VOICE_SECONDS * VOICE_SAMPLE_RATE * 2;
export const VOICE_TEXT_LIMIT = 600;
/** configured is microphone readiness; cloud speech is independent. */
export interface VoiceReadiness { configured: boolean; ttsConfigured: boolean; asrModel: string; ttsModel: string }
export class VoiceError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}

/** Extract, never invent, a short spoken excerpt. Full answer remains on screen. */
export function voiceExcerpt(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, "")
    .split("\n").filter(line => !/^\s*\|/.test(line)).join("\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[*_~]/g, "").replace(/\s+/g, " ").trim();
  const sentences = text.match(/[^。！？.!?]+[。！？.!?]+|[^。！？.!?]+$/g) ?? [];
  let result = "";
  for (const sentence of sentences.slice(0, 3)) {
    if ((result + sentence).length > VOICE_TEXT_LIMIT) break;
    result += sentence;
  }
  // Never cut a sentence halfway through a qualification/negation.
  return result.trim();
}
