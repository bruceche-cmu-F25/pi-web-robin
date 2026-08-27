import { readFileSync, statSync, utimesSync } from "fs";
import type { SessionInfo } from "./types";
import { writePrivateFileAtomicSync } from "./atomic-file";

export const SESSION_PAYLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const ACTIVE_FILE_GRACE_MS = 10 * 60 * 1000;
const TOOL_RESULT_PLACEHOLDER = "[Tool result removed after 7 days; rerun the tool if needed]";

interface RetentionResult {
  filesChanged: number;
  userImagesRemoved: number;
  toolResultsRemoved: number;
  bytesRemoved: number;
}

interface JsonlRetentionResult extends RetentionResult {
  content: string;
}

interface ImageBlock {
  type?: unknown;
  data?: unknown;
  source?: { type?: unknown; data?: unknown };
}

function emptyResult(): RetentionResult {
  return { filesChanged: 0, userImagesRemoved: 0, toolResultsRemoved: 0, bytesRemoved: 0 };
}

function isInlineImage(block: unknown): boolean {
  if (!block || typeof block !== "object") return false;
  const image = block as ImageBlock;
  return image.type === "image" && (
    typeof image.data === "string"
    || (image.source?.type === "base64" && typeof image.source.data === "string")
  );
}

function isPrunedToolResult(content: unknown): boolean {
  return Array.isArray(content)
    && content.length === 1
    && content[0]?.type === "text"
    && content[0]?.text === TOOL_RESULT_PLACEHOLDER;
}

export function pruneExpiredSessionPayloadsFromJsonl(
  source: string,
  nowMs = Date.now(),
): JsonlRetentionResult {
  const cutoffMs = nowMs - SESSION_PAYLOAD_RETENTION_MS;
  const lines = source.split("\n");
  let userImagesRemoved = 0;
  let toolResultsRemoved = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes('"user"') && !line.includes('"toolResult"')) continue;

    let entry: {
      type?: unknown;
      timestamp?: unknown;
      message?: { role?: unknown; content?: unknown };
    };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }

    if (entry.type !== "message" || !entry.message) continue;
    const timestampMs = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
    if (!Number.isFinite(timestampMs) || timestampMs > cutoffMs) continue;

    if (entry.message.role === "user" && Array.isArray(entry.message.content)) {
      const kept = entry.message.content.filter((block) => !isInlineImage(block));
      const removed = entry.message.content.length - kept.length;
      if (removed === 0) continue;

      kept.push({
        type: "text",
        text: `[${removed} image input${removed === 1 ? "" : "s"} removed after 7 days]`,
      });
      entry.message.content = kept;
      userImagesRemoved += removed;
    } else if (
      entry.message.role === "toolResult"
      && entry.message.content !== undefined
      && entry.message.content !== ""
      && (!Array.isArray(entry.message.content) || entry.message.content.length > 0)
      && !isPrunedToolResult(entry.message.content)
    ) {
      entry.message.content = [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }];
      toolResultsRemoved += 1;
    } else {
      continue;
    }

    lines[index] = JSON.stringify(entry);
  }

  if (userImagesRemoved === 0 && toolResultsRemoved === 0) {
    return { content: source, ...emptyResult() };
  }

  const content = lines.join("\n");
  return {
    content,
    filesChanged: 1,
    userImagesRemoved,
    toolResultsRemoved,
    bytesRemoved: Math.max(0, Buffer.byteLength(source) - Buffer.byteLength(content)),
  };
}

function pruneSessionFile(path: string, nowMs: number): RetentionResult {
  const stat = statSync(path);
  if (nowMs - stat.mtimeMs < ACTIVE_FILE_GRACE_MS) return emptyResult();

  const result = pruneExpiredSessionPayloadsFromJsonl(readFileSync(path, "utf8"), nowMs);
  if (result.filesChanged === 0) return result;

  writePrivateFileAtomicSync(path, result.content);
  utimesSync(path, stat.atime, stat.mtime);
  return result;
}

declare global {
  var __piSessionHistoryRetentionLastSweepMs: number | undefined;
  var __piSessionHistoryRetentionPromise: Promise<RetentionResult> | undefined;
}

/** Opportunistic hourly sweep, triggered by session-list requests. */
export function maybePruneExpiredSessionPayloads(
  sessions: readonly SessionInfo[],
  isSessionLive: (id: string) => boolean,
  nowMs = Date.now(),
): Promise<RetentionResult> {
  if (globalThis.__piSessionHistoryRetentionPromise) return globalThis.__piSessionHistoryRetentionPromise;
  if (
    globalThis.__piSessionHistoryRetentionLastSweepMs !== undefined
    && nowMs - globalThis.__piSessionHistoryRetentionLastSweepMs < SWEEP_INTERVAL_MS
  ) {
    return Promise.resolve(emptyResult());
  }

  globalThis.__piSessionHistoryRetentionLastSweepMs = nowMs;
  const cutoffMs = nowMs - SESSION_PAYLOAD_RETENTION_MS;
  const sweep = Promise.resolve().then(() => {
    const total = emptyResult();
    for (const session of sessions) {
      if (!session.path || session.transient || isSessionLive(session.id)) continue;
      const createdMs = Date.parse(session.created);
      if (!Number.isFinite(createdMs) || createdMs > cutoffMs) continue;
      try {
        const result = pruneSessionFile(session.path, nowMs);
        total.filesChanged += result.filesChanged;
        total.userImagesRemoved += result.userImagesRemoved;
        total.toolResultsRemoved += result.toolResultsRemoved;
        total.bytesRemoved += result.bytesRemoved;
      } catch {
        // A concurrently removed or malformed session must not break the list.
      }
    }
    return total;
  }).finally(() => {
    if (globalThis.__piSessionHistoryRetentionPromise === sweep) {
      globalThis.__piSessionHistoryRetentionPromise = undefined;
    }
  });

  globalThis.__piSessionHistoryRetentionPromise = sweep;
  return sweep;
}
