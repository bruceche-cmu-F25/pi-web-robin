/** Offline Whisper CLI adapter. Model installation is an explicit, separate operation. */
import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, isAbsolute, join, parse } from "node:path";
import { promisify } from "node:util";
import { dataPath } from "./paths.ts";
import type { RecordingConfig } from "./recordings.ts";

const exec = promisify(execFile);
export const LOCAL_TRANSCRIPTION_TIMEOUT_MS = 30 * 60_000;
export const LOCAL_WHISPER_MODEL = "small";
export function localWhisperModelPath(): string { return dataPath("models/whisper-small.pt"); }

function executable(): string | null {
  const command = process.env.ROBIN_WHISPER_BIN || (process.platform === "win32" ? "whisper.exe" : "whisper");
  const candidates = isAbsolute(command) ? [command] : (process.env.PATH || "").split(delimiter).filter(Boolean).map((dir) => join(dir, command));
  for (const path of candidates) {
    try {
      if (!statSync(path).isFile()) continue;
      accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return path;
    } catch { /* Try the next PATH entry. */ }
  }
  return null;
}
export function localTranscriptionConfig(): RecordingConfig {
  const engine = executable();
  let modelPresent = false;
  try { const file = statSync(localWhisperModelPath()); modelPresent = file.isFile() && file.size > 0; } catch { /* Not installed yet. */ }
  return { engine: "local", model: LOCAL_WHISPER_MODEL, ready: !!engine && modelPresent,
    ...(!engine ? { reason: "missing-engine" as const } : !modelPresent ? { reason: "missing-model" as const } : {}) };
}

export async function transcribeLocalAudio(
  audioPath: string,
  deps: { execute?: (command: string, args: string[], options: Parameters<typeof exec>[2]) => Promise<unknown>; format?: "txt" | "srt" | "vtt"; signal?: AbortSignal } = {},
): Promise<string> {
  const format = deps.format ?? "txt";
  if (!["txt", "srt", "vtt"].includes(format)) throw new Error("Unsupported transcript format");
  const command = executable();
  if (!command) throw new Error("Local Whisper is not installed. Install openai-whisper on the server, then refresh.");
  if (!localTranscriptionConfig().ready) throw new Error("Local Whisper model is missing. Run: node --experimental-strip-types scripts/setup-local-transcription.ts");
  const outputDir = await mkdtemp(join(tmpdir(), "robin-whisper-"));
  try {
    // Pass a local checkpoint PATH, not a model name: Whisper must never auto-download or use a cloud fallback.
    const args = [audioPath, "--model", localWhisperModelPath(), "--device", "cpu", "--fp16", "False",
      "--threads", "4", "--task", "transcribe", "--output_format", format, "--output_dir", outputDir,
      "--verbose", "False", "--beam_size", "1", "--best_of", "1", "--condition_on_previous_text", "False"];
    // No provider credentials are needed by the child process. Do not pass them along.
    const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
    for (const key of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME"]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    try {
      await (deps.execute ?? exec)(command, args, {
        timeout: LOCAL_TRANSCRIPTION_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, env, signal: deps.signal,
      });
    } catch {
      throw new Error("Local transcription failed or exceeded 30 minutes. The original audio and completed segments are kept; check the local Whisper installation before retrying.");
    }
    // The CLI can catch a Python exception and still exit zero. A fresh output file is mandatory.
    const output = join(outputDir, `${parse(basename(audioPath)).name}.${format}`);
    let text: string;
    try {
      if ((await stat(output)).size > 2 * 1024 * 1024) throw new Error("Oversized transcript");
      text = (await readFile(output, "utf8")).trim();
    } catch {
      throw new Error("Local Whisper produced no readable transcript. Check the model and audio, then retry; completed segments are kept.");
    }
    // An empty successful output is valid silence, not a reason to rerun a segment forever.
    return text;
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}
