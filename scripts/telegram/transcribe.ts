/**
 * Voice notes → text.
 *
 * On a phone, holding the button and saying "remind me to pay rent on Friday"
 * is the fastest input there is, and it was the one thing the bridge could not
 * take. A transcript is fed to the assistant exactly as if it had been typed,
 * so every tool, every guard, and every confirmation stays where it was.
 *
 * ## Why a separate API key
 *
 * pi's provider logins are OAuth subscriptions resolved through an extension's
 * tool context. The bridge is a separate process with no such context, and
 * borrowing those tokens out of pi's store would be reaching into someone
 * else's credential file. A plain key in Robin's own settings is the honest
 * arrangement: it is opt-in, it is visible on the settings page, and it says
 * out loud that this feature costs money per minute of audio.
 *
 * ## What a transcript is
 *
 * Untrusted input, exactly like a typed message — which is to say: it is the
 * user's own words, and it is handled with the same trust as text they typed,
 * no more. Nothing here interprets the transcript; it goes to the assistant
 * session whose tool allow-list is the actual boundary.
 */

export interface TranscriptionConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

/** Telegram caps bot downloads at 20MB; a voice note is far smaller. */
export const MAX_VOICE_BYTES = 20 * 1024 * 1024;

/** Long enough for a rambling note, short enough to bound the bill. */
const TRANSCRIBE_TIMEOUT_MS = 60_000;

/** Telegram sends voice notes as Ogg/Opus; `audio` messages vary. */
function fileNameFor(filePath: string): string {
  const extension = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(extension) ? `voice.${extension}` : "voice.ogg";
}

export class TranscriptionUnavailable extends Error {}

/**
 * Transcribe audio through an OpenAI-compatible endpoint.
 *
 * Throws `TranscriptionUnavailable` when the feature is simply not set up, so
 * the caller can say "turn this on in settings" rather than reporting an
 * outage. Every other failure is a real one and surfaces as itself.
 */
export async function transcribe(
  config: TranscriptionConfig,
  audio: { bytes: Uint8Array; filePath: string },
  deps: { fetch: typeof fetch },
): Promise<string> {
  if (!config.enabled) {
    throw new TranscriptionUnavailable("Voice transcription is off.");
  }
  if (!config.apiKey) {
    throw new TranscriptionUnavailable("Voice transcription has no API key.");
  }

  const form = new FormData();
  form.append("model", config.model);
  form.append(
    "file",
    new Blob([audio.bytes as unknown as BlobPart]),
    fileNameFor(audio.filePath),
  );
  // Plain text back: there is nothing here that wants segments or timestamps,
  // and JSON would only be unwrapped again.
  form.append("response_format", "text");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
  try {
    const response = await deps.fetch(`${config.baseUrl}/audio/transcriptions`, {
      method: "POST",
      signal: controller.signal,
      // No Content-Type: fetch has to set the multipart boundary itself.
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
    });
    const body = await response.text();
    if (!response.ok) {
      // The body may be JSON or plain text depending on the provider; report a
      // bounded slice either way rather than guessing at a shape.
      throw new Error(`Transcription failed (HTTP ${response.status}): ${body.slice(0, 200)}`);
    }
    const text = body.trim();
    if (!text) throw new Error("The recording came back empty.");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
