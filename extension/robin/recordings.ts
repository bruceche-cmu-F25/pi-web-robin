/** Client-safe recording contract. Audio and transcripts stay outside task storage. */
export const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 2 * 60 * 60;
export const RECORDING_CHUNK_SECONDS = 10 * 60;
export const RECORDING_EXTENSIONS = ["mp3", "mp4", "m4a", "wav", "webm", "ogg", "oga", "flac", "aac"];

export interface Recording {
  id: string;
  title: string;
  createdAt: string;
  revision: number;
  fileName: string;
  bytes: number;
  seconds: number;
  chunks: number;
  /** Completed chunks only, in order. Empty strings represent successfully processed silence. */
  parts: string[];
  text: string;
  busyUntil?: number;
}

export interface RecordingConfig {
  engine: "local";
  model: string;
  ready: boolean;
  reason?: "missing-engine" | "missing-model";
}

export function recordingTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
