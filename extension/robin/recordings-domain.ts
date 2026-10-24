import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { dataPath, readJsonObject, updateJsonObject, writeJsonObject } from "./paths.ts";
import { localTranscriptionConfig, transcribeLocalAudio, LOCAL_TRANSCRIPTION_TIMEOUT_MS } from "./local-transcription.ts";
import { MAX_RECORDING_BYTES, MAX_RECORDING_SECONDS, RECORDING_CHUNK_SECONDS, RECORDING_EXTENSIONS, type Recording, type RecordingConfig } from "./recordings.ts";

const exec = promisify(execFile);
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const LEASE_MS = LOCAL_TRANSCRIPTION_TIMEOUT_MS + 60_000;
interface StoredRecording extends Recording { owner?: string }
export class RecordingError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function directory(id: string): string {
  if (!ID.test(id)) throw new RecordingError("Recording not found", 404);
  return dataPath(`recordings/${id}`);
}
function meta(id: string): string { directory(id); return `recordings/${id}/recording.json`; }
function publicRecording(record: StoredRecording): Recording {
  const { owner: _owner, ...view } = record;
  void _owner;
  return view;
}
export function recordingConfig(): RecordingConfig {
  return localTranscriptionConfig();
}
export function readRecording(id: string): Recording {
  const record = readJsonObject<StoredRecording>(meta(id));
  if (!record) throw new RecordingError("Recording not found", 404);
  return publicRecording(record);
}
export function listRecordings(): Recording[] {
  let ids: string[];
  try { ids = readdirSync(dataPath("recordings")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return ids.filter((id) => ID.test(id)).flatMap((id) => {
    // Unpublished uploads have no metadata and are never shown as completed work.
    const record = readJsonObject<StoredRecording>(meta(id));
    return record ? [publicRecording(record)] : [];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Decode actual media, not its declared MIME. Never allow playlists or network protocols. */
export async function createRecording(file: File, title: unknown, signal?: AbortSignal): Promise<Recording> {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (!RECORDING_EXTENSIONS.includes(extension)) throw new RecordingError("Unsupported audio format");
  if (!file.size || file.size > MAX_RECORDING_BYTES) throw new RecordingError("Audio must be between 1 byte and 100 MB", 413);
  if (typeof title !== "string" || !title.trim() || title.length > 200) throw new RecordingError("A title of 1–200 characters is required");
  const id = randomUUID();
  const dir = directory(id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    // ponytail: one bounded upload is buffered (100 MB); stream to disk if larger files are needed.
    await writeFile(join(dir, `source.${extension}`), new Uint8Array(await file.arrayBuffer()), { mode: 0o600 });
    signal?.throwIfAborted();
    try {
      // Decode at most one extra minute to detect over-limit inputs without silently truncating.
      await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,mp3,wav,matroska,webm,ogg,flac,aac",
        "-i", join(dir, `source.${extension}`), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
        "-t", String(MAX_RECORDING_SECONDS + 60), "-c:a", "libmp3lame", "-b:a", "64k",
        "-f", "segment", "-segment_time", String(RECORDING_CHUNK_SECONDS), "-reset_timestamps", "1",
        join(dir, "chunk-%03d.mp3")], { timeout: 180_000, maxBuffer: 64 * 1024, signal });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new RecordingError("Install ffmpeg on the server to prepare long recordings", 503);
      throw new RecordingError("Audio could not be decoded, preparation timed out, or upload was cancelled");
    }
    const chunks = (await readdir(dir)).filter((name) => /^chunk-\d{3}\.mp3$/.test(name)).sort();
    if (!chunks.length) throw new RecordingError("No audio track found");
    // Only probe our own re-encoded MP3; user-controlled containers never reach ffprobe.
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(dir, chunks.at(-1)!)], { timeout: 15_000, maxBuffer: 4096, signal });
    const seconds = (chunks.length - 1) * RECORDING_CHUNK_SECONDS + Number(stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_RECORDING_SECONDS + 1) throw new RecordingError("Audio must be no longer than 2 hours");
    const record: StoredRecording = {
      id, title: title.trim(), createdAt: new Date().toISOString(), revision: 1,
      fileName: `source.${extension}`, bytes: file.size, seconds: Math.min(seconds, MAX_RECORDING_SECONDS),
      chunks: chunks.length, parts: [], text: "",
    };
    writeJsonObject(meta(id), record);
    return publicRecording(record);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

function mutate(id: string, action: (record: StoredRecording) => void | false): Recording {
  return updateJsonObject<StoredRecording, Recording>(meta(id), (record) => {
    if (!record) throw new RecordingError("Recording not found", 404);
    if (action(record) === false) return { result: publicRecording(record), value: record, changed: false };
    record.revision += 1;
    return { result: publicRecording(record), value: record, changed: true };
  });
}
function assertIdle(record: StoredRecording): void {
  if (record.busyUntil && record.busyUntil > Date.now()) throw new RecordingError("A transcription is already running; wait for the current segment to finish before retrying", 409);
}

/** One bounded, resumable LOCAL step per request. There is no cloud fallback. */
export async function transcribeRecording(id: string, deps: { transcribe?: (audioPath: string) => Promise<string> } = {}): Promise<Recording> {
  const owner = randomUUID();
  const current = readRecording(id);
  if (current.parts.length === current.chunks) return current;
  const claimed = mutate(id, (record) => {
    assertIdle(record);
    if (record.parts.length === record.chunks) throw new RecordingError("Transcription is already complete", 409);
    record.owner = owner;
    record.busyUntil = Date.now() + LEASE_MS;
  });
  try {
    const audioPath = join(directory(id), `chunk-${String(claimed.parts.length).padStart(3, "0")}.mp3`);
    const text = await (deps.transcribe ?? transcribeLocalAudio)(audioPath);
    return mutate(id, (record) => {
      if (record.owner !== owner) throw new RecordingError("Transcription ownership expired; reload before continuing", 409);
      record.parts.push(text);
      record.text = record.parts.join("\n\n");
      delete record.owner;
      delete record.busyUntil;
    });
  } catch (error) {
    mutate(id, (record) => {
      if (record.owner !== owner) return false;
      delete record.owner; delete record.busyUntil;
    });
    throw error;
  }
}

export function editRecording(id: string, body: { revision?: unknown; title?: unknown; text?: unknown }): Recording {
  if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 200
    || typeof body.text !== "string" || body.text.length > 2_000_000) throw new RecordingError("Invalid title or transcript");
  return mutate(id, (record) => {
    assertIdle(record);
    if (body.revision !== record.revision) throw new RecordingError("Recording changed in another tab; reload before saving", 409);
    if (record.parts.length !== record.chunks) throw new RecordingError("Finish transcription before editing the text", 409);
    record.title = (body.title as string).trim();
    record.text = body.text as string;
  });
}

export function deleteRecording(id: string, revision: unknown): void {
  // The same metadata lock fences delete against claim/publish. Inference never runs under a lock.
  updateJsonObject<StoredRecording, void>(meta(id), (record) => {
    if (!record) throw new RecordingError("Recording not found", 404);
    assertIdle(record);
    if (revision !== record.revision) throw new RecordingError("Recording changed; reload before deleting", 409);
    rmSync(directory(id), { recursive: true });
    return { result: undefined, value: record, changed: false };
  });
}

export function recordingAudio(id: string): { path: string; size: number; type: string } {
  const record = readRecording(id);
  // A modified metadata file must not become a file-serving escape hatch.
  if (!/^source\.(mp3|mp4|m4a|wav|webm|ogg|oga|flac|aac)$/.test(record.fileName)) throw new RecordingError("Invalid audio filename");
  const path = join(directory(id), record.fileName);
  const types: Record<string, string> = { mp3: "audio/mpeg", mp4: "audio/mp4", m4a: "audio/mp4", wav: "audio/wav", webm: "audio/webm", ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac", aac: "audio/aac" };
  return { path, size: statSync(path).size, type: types[record.fileName.split(".").at(-1)!] };
}
