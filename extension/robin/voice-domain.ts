/** Local dictation and optional cloud TTS. No agent dispatch or Qwen Gateway. */
import { VOICE_MAX_BYTES, VOICE_TEXT_LIMIT, VoiceError, type VoiceReadiness } from "./voice.ts";
import { localVoiceConfig, transcribeLocalVoice } from "./local-voice.ts";
export { VoiceError } from "./voice.ts";
const ASR_MODEL = "whisper.cpp (local)";
const TTS_MODEL = "qwen3-tts-flash";
const RESULT_HOST = "dashscope-result-bj.oss-cn-beijing.aliyuncs.com";

function configuration(env = process.env) {
  const key = (env.ROBIN_VOICE_API_KEY || env.DASHSCOPE_API_KEY || "").trim();
  let origin: URL;
  try { origin = new URL(env.ROBIN_VOICE_ORIGIN || "https://dashscope.aliyuncs.com"); }
  catch { throw new VoiceError("setup", 503); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.port
    || origin.pathname !== "/" || origin.search || origin.hash
    || !(origin.hostname === "dashscope.aliyuncs.com" || /^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(origin.hostname))) {
    throw new VoiceError("setup", 503);
  }
  return { key, origin: origin.origin };
}
export function voiceReadiness(): VoiceReadiness {
  let ttsConfigured = false;
  try { ttsConfigured = !!configuration().key; } catch { /* Presence is not a live credential test. */ }
  return { configured: localVoiceConfig().ready, ttsConfigured, asrModel: ASR_MODEL, ttsModel: TTS_MODEL };
}

/** Only the exact 16 kHz mono PCM WAV produced by our recorder is accepted. */
export function validateVoiceWav(bytes: Uint8Array): void {
  if (bytes.length < 46 || bytes.length > VOICE_MAX_BYTES) throw new VoiceError("audio", 413);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data"
    || view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16
    || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1
    || view.getUint32(24, true) !== 16_000 || view.getUint32(28, true) !== 32_000
    || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16
    || view.getUint32(40, true) !== bytes.length - 44 || (bytes.length - 44) % 2) throw new VoiceError("audio");
}

async function bounded(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new VoiceError("provider", 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new VoiceError("provider", 502); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

type Dependencies = { fetch?: typeof fetch; env?: NodeJS.ProcessEnv };
// Per-process ceiling, not a distributed rate limiter; all routes retain Pi Web authentication.
const state = globalThis as typeof globalThis & { __robinVoiceActive?: number };
async function operation<T>(signal: AbortSignal, deps: Dependencies, run: (request: (path: string, body: unknown) => Promise<unknown>, signal: AbortSignal, fetcher: typeof fetch) => Promise<T>): Promise<T> {
  const config = configuration(deps.env);
  if (!config.key) throw new VoiceError("setup", 503);
  if ((state.__robinVoiceActive ?? 0) >= 2) throw new VoiceError("busy", 429);
  state.__robinVoiceActive = (state.__robinVoiceActive ?? 0) + 1;
  const combined = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const fetcher = deps.fetch ?? fetch;
  try {
    combined.throwIfAborted();
    const request = async (path: string, body: unknown) => {
      const response = await fetcher(config.origin + path, {
        method: "POST", headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: combined, redirect: "error",
      });
      if (!response.ok) { await response.body?.cancel(); throw new VoiceError("provider", 502); }
      return JSON.parse(new TextDecoder().decode(await bounded(response, 256 * 1024))) as unknown;
    };
    const result = await run(request, combined, fetcher);
    combined.throwIfAborted();
    return result;
  } catch (error) {
    if (combined.aborted) throw new VoiceError("cancelled", 408);
    if (error instanceof VoiceError) throw error;
    // Never echo upstream errors, signed URLs, credentials, audio or transcripts.
    throw new VoiceError("provider", 502);
  } finally { state.__robinVoiceActive = (state.__robinVoiceActive ?? 1) - 1; }
}

export async function transcribeVoice(bytes: Uint8Array, signal: AbortSignal, deps: Dependencies = {}): Promise<string> {
  validateVoiceWav(bytes);
  return transcribeLocalVoice(bytes, signal, deps.env);
}

export async function synthesizeVoice(text: unknown, signal: AbortSignal, deps: Dependencies = {}): Promise<Uint8Array> {
  if (typeof text !== "string" || !text.trim() || text.length > VOICE_TEXT_LIMIT) throw new VoiceError("text");
  return operation(signal, deps, async (request, combined, fetcher) => {
    const result = await request("/api/v1/services/aigc/multimodal-generation/generation", {
      model: TTS_MODEL, input: { text, voice: "Cherry", language_type: "Auto" },
    }) as { output?: { audio?: { url?: unknown } } };
    if (typeof result?.output?.audio?.url !== "string") throw new VoiceError("provider", 502);
    const url = new URL(result.output.audio.url);
    if (!["http:", "https:"].includes(url.protocol) || url.hostname !== RESULT_HOST
      || url.username || url.password || url.port || !url.pathname.endsWith(".wav")) throw new VoiceError("provider", 502);
    // Official responses may use http. Fetch the same signed object over TLS only.
    url.protocol = "https:";
    const audio = await fetcher(url, { signal: combined, redirect: "error" }); // No API authorization on OSS requests.
    if (!audio.ok) { await audio.body?.cancel(); throw new VoiceError("provider", 502); }
    const bytes = await bounded(audio, 8 * 1024 * 1024);
    if (bytes.length < 44 || Buffer.from(bytes.subarray(0, 4)).toString() !== "RIFF"
      || Buffer.from(bytes.subarray(8, 12)).toString() !== "WAVE") throw new VoiceError("provider", 502);
    return bytes;
  });
}
