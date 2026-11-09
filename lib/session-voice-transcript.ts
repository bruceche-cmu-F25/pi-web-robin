import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { parseVoiceTranscript, type VoiceTranscript } from "./voice-transcript";

/** Append through the owning manager, never a second file writer. Caller must be idle. */
export function appendVoiceTranscript(manager: SessionManager, value: unknown, expectedLeaf: unknown) {
  const transcript = parseVoiceTranscript(value);
  if (expectedLeaf !== undefined && expectedLeaf !== null && typeof expectedLeaf !== "string") {
    throw new Error("Invalid transcript branch");
  }
  // Idempotency lives in the message itself, including after reopening the file.
  const previous = manager.getBranch().find(entry => entry.type === "message"
    && (entry.message as { voiceTranscript?: VoiceTranscript }).voiceTranscript?.id === transcript.id);
  if (previous?.type === "message") {
    const saved = (previous.message as { voiceTranscript?: VoiceTranscript }).voiceTranscript;
    if (JSON.stringify(saved) !== JSON.stringify(transcript)) throw new Error("Transcript id conflict");
    return { entryId: previous.id, duplicate: true, message: null };
  }
  if (expectedLeaf !== undefined && manager.getLeafId() !== expectedLeaf) {
    throw new Error("Chat branch changed; voice transcript was not appended");
  }
  const timestamp = Date.now();
  const robin = transcript.source === "robin";
  const notice = robin
    ? "Copied Robin reply; task actions belong to Robin's execution record. Saving this text did not run tools in this Chat. / Robin 回复副本；任务操作以 Robin 执行记录为准。保存文字不会在此 Chat 中执行工具。"
    : "Generated speech transcript; may include unplayed audio. No tools executed. / 生成的语音文字，可能包含未播放内容；未执行工具。";
  const content = `[${transcript.role === "user" ? "Voice transcript / 语音转写" : robin ? "Robin voice / 语音回复" : "Boson voice / 语音回复"}${transcript.interrupted ? " · interrupted / 已打断" : ""}]\n${transcript.text}`;
  const message = transcript.role === "user"
    ? { role: "user" as const, content, timestamp, voiceTranscript: transcript }
    : { role: "assistant" as const, content: [{ type: "text" as const, text: `${content}\n\n[${notice}]` }],
      api: robin ? "robin-voice-transcript" : "boson-realtime", provider: robin ? "robin" : "boson", model: robin ? "voice-transcript" : "higgs-realtime", timestamp,
      // Transcripts carry no billing usage (Robin's usage belongs to its real run).
      // Zero placeholders satisfy Pi's schema, not a claim that the run was free.
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: transcript.interrupted ? "aborted" as const : "stop" as const,
      voiceTranscript: transcript };
  const entryId = manager.appendMessage(message);
  return { entryId, duplicate: false, message };
}
