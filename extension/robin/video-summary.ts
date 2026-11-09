/** Client-safe contract for the URL → captions → summary tool. */
import { formatClock, isVideoId, watchUrl, type EpisodeSummary, type VideoDetails } from "./podcasts.ts";

export const VIDEO_SUMMARY_EXAMPLE = "https://www.youtube.com/watch?v=67BmkptgTms";
export const VIDEO_SUMMARY_STAGES = ["details", "captions", "summarizing", "saving"] as const;
export type VideoSummaryStage = typeof VIDEO_SUMMARY_STAGES[number];
export interface VideoSummaryResult { summary: EpisodeSummary; details: VideoDetails | null }
export type VideoSummaryEvent = { stage: VideoSummaryStage } | { result: VideoSummaryResult } | { error: string };

/** Only an id is retained; supplied hosts, query parameters and paths are never fetched. */
export function videoIdFromUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Enter a YouTube video URL / 请输入 YouTube 视频链接");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Invalid video URL / 视频链接无效"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Use an HTTPS YouTube URL / 请使用 HTTPS YouTube 链接");
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be" && /^\/[\w-]{11}\/?$/.test(url.pathname)) id = url.pathname.split("/")[1];
  else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else if (/^\/(shorts|live|embed)\/[\w-]{11}\/?$/.test(url.pathname)) id = url.pathname.split("/")[2];
  }
  if (!isVideoId(id)) throw new Error("Only YouTube video links are supported / 目前仅支持 YouTube 视频链接");
  return id;
}

export function videoSummaryMarkdown(result: VideoSummaryResult, language: "zh" | "en"): string {
  const { summary, details } = result;
  return [`# ${details?.title ?? summary.videoId}`, details?.author ?? "", watchUrl(summary.videoId),
    language === "zh" ? "来源：YouTube 字幕（可能为自动字幕），未分析画面；时间戳定位到字幕段落。" : "Source: YouTube captions (possibly automatic), not visual analysis; timestamps locate transcript paragraphs.",
    summary.truncated ? (language === "zh" ? "注意：仅覆盖开头部分。" : "Warning: covers the beginning only.") : "",
    summary.tldr[language], ...summary.points.map(point => `- ${point.at === null ? "" : `[${formatClock(point.at)}](${watchUrl(summary.videoId, point.at)}) `}${point[language]}`),
    `\n${summary.generatedAt}`].filter(Boolean).join("\n\n");
}
