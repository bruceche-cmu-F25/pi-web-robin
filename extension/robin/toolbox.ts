/** Shared limits/contracts: no server dependencies in the browser catalog. */
export const TOOLBOX_MAX_BYTES = 100 * 1024 * 1024;
export const TOOLBOX_TOOLS = ["audio", "video", "image", "pdf", "subtitles", "ocr", "text", "rename", "qr", "dev", "csv"] as const;
export type ToolboxTool = typeof TOOLBOX_TOOLS[number];
export interface ToolboxCapabilities { media: boolean; subtitles: boolean; ocr: boolean }
export interface LocalToolOptions {
  kind: "audio" | "video" | "subtitles" | "ocr";
  format: string;
  start: number;
  end?: number;
  bitrate: number;
}
export function parseLocalToolOptions(value: unknown): LocalToolOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid tool options");
  const v = value as Record<string, unknown>;
  const formats: Record<string, string[]> = { audio: ["mp3", "m4a", "wav", "flac"], video: ["720p", "1080p", "mute", "gif"], subtitles: ["srt", "vtt"], ocr: ["txt"] };
  if (typeof v.kind !== "string" || !Object.hasOwn(formats, v.kind) || typeof v.format !== "string" || !formats[v.kind].includes(v.format)) throw new Error("Unsupported tool or output format");
  const start = v.start === undefined ? 0 : v.start, end = v.end, bitrate = v.bitrate === undefined ? 192 : v.bitrate;
  if (typeof start !== "number" || !Number.isFinite(start) || start < 0 || start >= 7200 || (end !== undefined && (typeof end !== "number" || !Number.isFinite(end) || end <= start || end > 7200))) throw new Error("Invalid start/end time (seconds, up to 2 hours)");
  if (typeof bitrate !== "number" || ![128, 192, 256].includes(bitrate)) throw new Error("Invalid bitrate");
  return { kind: v.kind as LocalToolOptions["kind"], format: v.format, start, ...(end !== undefined ? { end: end as number } : {}), bitrate };
}
