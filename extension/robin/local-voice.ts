/** Short dictation on the Robin host. No HTTP, Python Whisper or model auto-downloads. */
import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { dataPath } from "./paths.ts";
import { VoiceError } from "./voice.ts";

export function localVoiceConfig(env = process.env) {
  const name = env.ROBIN_VOICE_WHISPER_BIN || "whisper-cli";
  const candidates = isAbsolute(name) ? [name] : [
    ...(env.PATH || "").split(delimiter).filter(Boolean).map(dir => join(dir, name)),
    ...(!env.ROBIN_VOICE_WHISPER_BIN ? ["/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli"] : []),
  ];
  const command = candidates.find(path => {
    try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; }
  });
  const model = env.ROBIN_VOICE_WHISPER_MODEL || dataPath("models/ggml-small-q5_1.bin");
  let modelPresent = false;
  try { const file = statSync(model); modelPresent = isAbsolute(model) && file.isFile() && file.size > 0; } catch { /* Missing model. */ }
  return { command, model, ready: !!command && modelPresent };
}

// ponytail: one inference per Web process, no queue; use a shared worker only if multiple Web servers are needed.
const state = globalThis as typeof globalThis & { __robinLocalVoiceActive?: boolean };
export async function transcribeLocalVoice(bytes: Uint8Array, signal: AbortSignal, env = process.env): Promise<string> {
  const config = localVoiceConfig(env);
  if (!config.ready || !config.command) throw new VoiceError("setup", 503);
  if (state.__robinLocalVoiceActive) throw new VoiceError("busy", 429);
  state.__robinLocalVoiceActive = true;
  const combined = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  let dir: string | undefined;
  try {
    combined.throwIfAborted();
    dir = await mkdtemp(join(tmpdir(), "robin-voice-")); // mode 0700
    const input = join(dir, "input.wav"), output = join(dir, "transcript");
    await writeFile(input, bytes, { mode: 0o600 });
    combined.throwIfAborted();
    // Pass model PATH explicitly: never download weights or fall back to a cloud API.
    // No prompt/context from the conversation. Automatic language detection, not translation.
    const args = ["--model", config.model, "--file", input, "--language", "auto", "--max-context", "0",
      "--threads", "4", "--no-prints", "--no-timestamps", "--output-txt", "--output-file", output];
    const childEnv: NodeJS.ProcessEnv = { NODE_ENV: env.NODE_ENV };
    for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT", "WINDIR"]) {
      if (env[key]) childEnv[key] = env[key];
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(config.command!, args, { env: childEnv, stdio: "ignore", shell: false });
      let failed = false;
      // SIGKILL stops native work, not just HTTP delivery. Hold the slot/files until close.
      const cancel = () => { child.kill("SIGKILL"); };
      combined.addEventListener("abort", cancel, { once: true });
      if (combined.aborted) cancel();
      child.on("error", () => { failed = true; });
      child.on("close", code => {
        combined.removeEventListener("abort", cancel);
        if (combined.aborted) reject(new VoiceError("cancelled", 408));
        else if (failed || code !== 0) reject(new VoiceError("local", 502));
        else resolve();
      });
    });
    combined.throwIfAborted();
    const file = `${output}.txt`;
    if ((await stat(file)).size > 64_000) throw new VoiceError("local", 502);
    const text = (await readFile(file, "utf8")).trim();
    combined.throwIfAborted();
    if (text.length > 16_000) throw new VoiceError("local", 502);
    if (!text) throw new VoiceError("empty");
    return text;
  } catch (error) {
    if (combined.aborted) throw new VoiceError("cancelled", 408);
    if (error instanceof VoiceError) throw error;
    // Never leak stderr, transcript, host paths or environment values.
    throw new VoiceError("local", 502);
  } finally {
    try { if (dir) await rm(dir, { recursive: true, force: true }); }
    finally { state.__robinLocalVoiceActive = false; }
  }
}
