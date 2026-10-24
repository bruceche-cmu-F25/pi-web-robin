/** Shared OpenAI-compatible speech-to-text transport; credentials never leave the server. */
export interface TranscriptionConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

/** Telegram's download limit, independent of the recordings workspace limit. */
export const MAX_VOICE_BYTES = 20 * 1024 * 1024;
export class TranscriptionUnavailable extends Error {}

export async function transcribe(
  config: TranscriptionConfig,
  audio: { bytes: Uint8Array; filePath: string },
  deps: { fetch: typeof fetch; timeoutMs?: number; signal?: AbortSignal },
): Promise<string> {
  if (!config.enabled) throw new TranscriptionUnavailable("Voice transcription is off.");
  if (!config.apiKey) throw new TranscriptionUnavailable("Voice transcription has no API key.");
  const extension = audio.filePath.split(".").at(-1)?.toLowerCase() ?? "ogg";
  const form = new FormData();
  form.append("model", config.model);
  form.append("file", new Blob([audio.bytes as unknown as BlobPart]),
    `voice.${/^[a-z0-9]{1,5}$/.test(extension) ? extension : "ogg"}`);
  form.append("response_format", "text");
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? 60_000);
  const signal = deps.signal ? AbortSignal.any([timeout, deps.signal]) : timeout;
  const response = await deps.fetch(`${config.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST", signal, redirect: "error",
    headers: { Authorization: `Bearer ${config.apiKey}` }, body: form,
  });
  // Provider bodies can echo credentials, uploaded data, or HTML. Never persist/display them.
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Transcription failed (HTTP ${response.status}). Check the API key, model and provider quota.`);
  }
  const text = (await response.text()).trim();
  if (!text) throw new Error("The recording came back empty.");
  if (text.length > 500_000) throw new Error("Transcription response is too large.");
  return text;
}
