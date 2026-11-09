import { readFileSync, statSync, utimesSync, type Stats } from "fs";
import { setImmediate as yieldToIo } from "node:timers/promises";
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
  /** Earliest timestamp that can make an unchanged file need another pass. */
  nextCheckAt: number;
}

interface FileRetention {
  fingerprint: string;
  nextCheckAt: number;
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
  let nextCheckAt = Infinity;

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
    if (!Number.isFinite(timestampMs)) continue;
    if (timestampMs > cutoffMs) {
      nextCheckAt = Math.min(nextCheckAt, timestampMs + SESSION_PAYLOAD_RETENTION_MS);
      continue;
    }

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
    return { content: source, ...emptyResult(), nextCheckAt };
  }

  const content = lines.join("\n");
  return {
    content,
    nextCheckAt,
    filesChanged: 1,
    userImagesRemoved,
    toolResultsRemoved,
    bytesRemoved: Math.max(0, Buffer.byteLength(source) - Buffer.byteLength(content)),
  };
}

function fingerprint(stat: Stats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function pruneSessionFile(path: string, nowMs: number, files: Map<string, FileRetention>): RetentionResult {
  const stat = statSync(path);
  if (nowMs - stat.mtimeMs < ACTIVE_FILE_GRACE_MS) return emptyResult();
  const stamp = fingerprint(stat);
  const cached = files.get(path);
  if (cached?.fingerprint === stamp && cached.nextCheckAt > nowMs) return emptyResult();

  const result = pruneExpiredSessionPayloadsFromJsonl(readFileSync(path, "utf8"), nowMs);
  if (result.filesChanged > 0) {
    writePrivateFileAtomicSync(path, result.content);
    utimesSync(path, stat.atime, stat.mtime);
  }
  files.set(path, {
    fingerprint: result.filesChanged > 0 ? fingerprint(statSync(path)) : stamp,
    nextCheckAt: result.nextCheckAt,
  });
  return result;
}

declare global {
  var __piSessionHistoryRetentionLastSweepMs: number | undefined;
  var __piSessionHistoryRetentionPromise: Promise<RetentionResult> | undefined;
  var __piSessionHistoryRetentionFiles: Map<string, FileRetention> | undefined;
}

/** Hourly maintenance, not a prerequisite for serving the session list.
 * Yield between files, never between checking liveness and rewriting a file.
 * Only the initiating caller's callback runs, once, if any file changed.
 */
export function maybePruneExpiredSessionPayloads(
  sessions: readonly SessionInfo[],
  isSessionLive: (id: string) => boolean,
  nowMs = Date.now(),
  onChanged?: () => void,
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
  const sweep = (async () => {
    // A microtask would still run before the response and starve other requests.
    await yieldToIo();
    const files = globalThis.__piSessionHistoryRetentionFiles ??= new Map();
    const paths = new Set(sessions.map(session => session.path));
    for (const path of files.keys()) if (!paths.has(path)) files.delete(path);
    const total = emptyResult();
    let yieldAt = performance.now() + 4;
    for (const session of sessions) {
      if (performance.now() >= yieldAt) {
        await yieldToIo();
        yieldAt = performance.now() + 4;
      }
      if (!session.path || session.transient || isSessionLive(session.id)) continue;
      const createdMs = Date.parse(session.created);
      if (!Number.isFinite(createdMs) || createdMs > cutoffMs) continue;
      try {
        const result = pruneSessionFile(session.path, nowMs, files);
        total.filesChanged += result.filesChanged;
        total.userImagesRemoved += result.userImagesRemoved;
        total.toolResultsRemoved += result.toolResultsRemoved;
        total.bytesRemoved += result.bytesRemoved;
      } catch {
        // A concurrently removed or malformed session must not break the list.
      }
    }
    if (total.filesChanged > 0) onChanged?.();
    return total;
  })().finally(() => {
    if (globalThis.__piSessionHistoryRetentionPromise === sweep) {
      globalThis.__piSessionHistoryRetentionPromise = undefined;
    }
  });

  globalThis.__piSessionHistoryRetentionPromise = sweep;
  return sweep;
}
