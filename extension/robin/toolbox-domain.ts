import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { dataPath } from "./paths.ts";
import { localTranscriptionConfig, transcribeLocalAudio } from "./local-transcription.ts";
import { TOOLBOX_MAX_BYTES, parseLocalToolOptions, type ToolboxCapabilities } from "./toolbox.ts";

const exec = promisify(execFile);
const MAX_OUTPUT = 200 * 1024 * 1024;
const INPUT_FORMATS = "mov,matroska,webm,avi,mp3,wav,ogg,flac,aac";
const INPUT_GUARD = ["-protocol_whitelist", "file,pipe", "-format_whitelist", INPUT_FORMATS];
const state = globalThis as typeof globalThis & { robinToolboxBusy?: boolean };
export class ToolboxError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function command(name: string): string | null {
  for (const dir of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    const path = join(dir, process.platform === "win32" ? `${name}.exe` : name);
    try { if (statSync(path).isFile()) { accessSync(path, constants.X_OK); return path; } } catch { /* Not installed. */ }
  }
  return null;
}
export function toolboxCapabilities(): ToolboxCapabilities {
  const media = !!command("ffmpeg") && !!command("ffprobe");
  return { media, subtitles: media && localTranscriptionConfig().ready, ocr: process.platform === "darwin" && !!command("osascript") };
}
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const key of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TMPDIR", "TEMP", "TMP", "LANG"]) if (process.env[key]) env[key] = process.env[key];
  return env;
}
// JXA calls the OS Vision framework directly; no Swift SDK/compiler or downloaded model.
const OCR_SCRIPT = `ObjC.import('Foundation');
ObjC.import('Vision');
function run(args) {
  var url = $.NSURL.fileURLWithPath(args[0]);
  var request = $.VNRecognizeTextRequest.alloc.init;
  request.recognitionLevel = 0;
  request.recognitionLanguages = ['zh-Hans', 'en-US'];
  request.usesLanguageCorrection = true;
  var handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary);
  var error = Ref();
  if (!handler.performRequestsError($.NSArray.arrayWithObject(request), error)) throw new Error('OCR failed');
  var observations = request.results, lines = [];
  for (var i = 0; i < observations.count; i++) {
    var candidates = observations.objectAtIndex(i).topCandidates(1);
    if (candidates.count) lines.push(ObjC.unwrap(candidates.objectAtIndex(0).string));
  }
  if (!$(lines.join('\\n')).writeToFileAtomicallyEncodingError(args[1], true, $.NSUTF8StringEncoding, error)) throw new Error('Write failed');
}
`;

/** One ephemeral job; uploaded bytes never become persistent recordings or command arguments. */
export async function runLocalTool(file: File, rawOptions: unknown, signal?: AbortSignal): Promise<{ bytes: Uint8Array; name: string; type: string }> {
  const options = parseLocalToolOptions(rawOptions);
  if (!file.size || file.size > TOOLBOX_MAX_BYTES) throw new ToolboxError("Choose a file between 1 byte and 100 MB", 413);
  const capabilities = toolboxCapabilities();
  if (!(options.kind === "ocr" ? capabilities.ocr : options.kind === "subtitles" ? capabilities.subtitles : capabilities.media)) throw new ToolboxError("Local engine unavailable. Media needs ffmpeg/ffprobe; subtitles need the installed Whisper model; OCR needs macOS Vision.", 503);
  // ponytail: one local tool process per Web server; use an OS-wide lease for multi-process hosting.
  if (state.robinToolboxBusy) throw new ToolboxError("Another local tool is running. Wait for it to finish, then retry.", 409);
  state.robinToolboxBusy = true;
  let dir: string | undefined;
  try {
    signal?.throwIfAborted();
    const root = dataPath("toolbox-tmp");
    await mkdir(root, { recursive: true, mode: 0o700 });
    // Normal requests clean up immediately; recover abandoned jobs after a crash on the next run.
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && /^job-[A-Za-z0-9]+$/.test(entry.name)) {
        const path = join(root, entry.name);
        if ((await stat(path)).mtimeMs < Date.now() - 24 * 60 * 60_000) await rm(path, { recursive: true, force: true });
      }
    }
    dir = await mkdtemp(join(root, "job-"));
    const input = join(dir, "input");
    await writeFile(input, new Uint8Array(await file.arrayBuffer()), { mode: 0o600 });
    const execute = async (name: string, args: string[], timeout = 600_000) => {
      try { return await exec(command(name) ?? name, args, { timeout, signal, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024, env: childEnv() }); }
      catch { throw new ToolboxError("Local processing failed, was cancelled or timed out. Check the file and local engine; the original is unchanged."); }
    };
    let ext: string, type: string;
    if (options.kind === "ocr") {
      if (file.size > 20 * 1024 * 1024) throw new ToolboxError("OCR image must be no larger than 20 MB", 413);
      const header = (await readFile(input)).subarray(0, 24);
      if (header.length < 24 || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || header.toString("ascii", 12, 16) !== "IHDR") throw new ToolboxError("OCR requires a normalized PNG image");
      const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
      if (!width || !height || width > 8192 || height > 8192 || width * height > 24_000_000) throw new ToolboxError("OCR image limit: 24 megapixels, 8192px per side");
      const script = join(dir, "ocr.js");
      await writeFile(script, OCR_SCRIPT, { mode: 0o600 });
      await execute("osascript", ["-l", "JavaScript", script, input, join(dir, "output.txt")], 120_000);
      ext = "txt"; type = "text/plain; charset=utf-8";
    } else {
      const extension = file.name.split(".").at(-1)?.toLowerCase();
      if (!extension || !["mp3", "wav", "m4a", "mp4", "mov", "mkv", "webm", "avi", "ogg", "flac", "aac"].includes(extension)) throw new ToolboxError("Unsupported media container");
      const probe = await execute("ffprobe", ["-v", "error", "-max_alloc", "67108864", ...INPUT_GUARD, "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", input], 20_000);
      const info = JSON.parse(probe.stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number }[] };
      const duration = Number(info.format?.duration), end = options.end ?? duration;
      if (!Number.isFinite(duration) || duration <= 0 || duration > 7201 || end > duration + .1 || options.start >= duration) throw new ToolboxError("Media needs a known duration up to 2 hours; check start/end times");
      const length = end - options.start;
      const max = options.kind === "subtitles" ? 1200 : options.kind === "video" ? (options.format === "gif" ? 30 : 1800) : 7200;
      if (length > max) throw new ToolboxError(`Selected range exceeds ${max} seconds. Choose an explicit shorter start/end range.`);
      if (info.streams?.some((s) => (s.width ?? 0) > 8192 || (s.height ?? 0) > 8192 || (s.width ?? 0) * (s.height ?? 0) > 33_600_000)) throw new ToolboxError("Media resolution is too large");
      const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-max_alloc", "67108864", "-threads", "2", "-filter_threads", "2", ...INPUT_GUARD,
        "-ss", String(options.start), "-i", input, "-t", String(length), "-map_metadata", "-1", "-map_chapters", "-1"];
      if (options.kind === "video") {
        ext = options.format === "gif" ? "gif" : "mp4"; type = ext === "gif" ? "image/gif" : "video/mp4";
        args.push("-map", "0:v:0");
        if (ext === "gif") args.push("-an", "-vf", "fps=12,scale=480:-2:flags=lanczos");
        else {
          const width = options.format === "1080p" ? 1920 : 1280, height = options.format === "1080p" ? 1080 : 720;
          args.push("-vf", `scale=w='min(${width},iw)':h='min(${height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-threads", "2", "-movflags", "+faststart");
          if (options.format === "mute") args.push("-an"); else args.push("-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k");
        }
      } else {
        ext = options.kind === "subtitles" ? "mp3" : options.format;
        type = ({ mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", flac: "audio/flac" } as Record<string, string>)[ext];
        args.push("-map", "0:a:0", "-vn");
        if (options.kind === "subtitles") args.push("-ac", "1", "-ar", "16000");
        args.push("-c:a", ({ mp3: "libmp3lame", m4a: "aac", wav: "pcm_s16le", flac: "flac" } as Record<string, string>)[ext]);
        if (ext === "mp3" || ext === "m4a") args.push("-b:a", `${options.kind === "subtitles" ? 64 : options.bitrate}k`);
      }
      const output = join(dir, `output.${ext}`);
      args.push("-fs", String(MAX_OUTPUT), output);
      await execute("ffmpeg", args);
      if ((await stat(output)).size >= MAX_OUTPUT - 65536) throw new ToolboxError("Output would exceed 200 MB; choose a smaller range or compressed format", 413);
      if (options.kind === "subtitles") {
        const text = await transcribeLocalAudio(output, { format: options.format as "srt" | "vtt", signal });
        return { bytes: new TextEncoder().encode(text), name: `subtitles.${options.format}`, type: "text/plain; charset=utf-8" };
      }
    }
    const output = join(dir, `output.${ext}`), size = (await stat(output)).size;
    if (size > (options.kind === "ocr" ? 2 * 1024 * 1024 : MAX_OUTPUT) || (options.kind !== "ocr" && size === 0)) throw new ToolboxError("No usable output or output too large");
    return { bytes: new Uint8Array(await readFile(output)), name: `converted.${ext}`, type };
  } finally {
    try { if (dir) await rm(dir, { recursive: true, force: true }); }
    finally { state.robinToolboxBusy = false; }
  }
}
