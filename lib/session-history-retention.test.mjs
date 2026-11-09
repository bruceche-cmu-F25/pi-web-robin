import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  SESSION_PAYLOAD_RETENTION_MS,
  pruneExpiredSessionPayloadsFromJsonl,
  maybePruneExpiredSessionPayloads,
} = await jiti.import("./session-history-retention.ts");

const nowMs = Date.parse("2026-08-26T12:00:00.000Z");
const entry = (id, role, content, ageMs) => JSON.stringify({
  type: "message",
  id,
  parentId: null,
  timestamp: new Date(nowMs - ageMs).toISOString(),
  message: { role, toolCallId: role === "toolResult" ? `call-${id}` : undefined, content },
});

const flatImage = { type: "image", data: "QUJDRA==", mimeType: "image/png" };
const nestedImage = {
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: "QUJDRA==" },
};
const urlImage = {
  type: "image",
  source: { type: "url", media_type: "image/png", url: "https://example.com/image.png" },
};
const toolResultPlaceholder = {
  type: "text",
  text: "[Tool result removed after 7 days; rerun the tool if needed]",
};

test("removes expired inline user images and tool-result payloads", () => {
  const source = [
    JSON.stringify({ type: "session", id: "s1", timestamp: "2026-08-01T00:00:00.000Z", cwd: "/tmp" }),
    entry("old-user", "user", [{ type: "text", text: "inspect" }, flatImage, nestedImage, urlImage], SESSION_PAYLOAD_RETENTION_MS + 1),
    entry("new-user", "user", [flatImage], SESSION_PAYLOAD_RETENTION_MS - 1),
    entry("old-tool", "toolResult", [{ type: "text", text: "large historical output" }, flatImage], SESSION_PAYLOAD_RETENTION_MS + 1),
    entry("new-tool", "toolResult", [{ type: "text", text: "fresh output" }], SESSION_PAYLOAD_RETENTION_MS - 1),
    "",
  ].join("\n");

  const result = pruneExpiredSessionPayloadsFromJsonl(source, nowMs);
  const lines = result.content.trimEnd().split("\n").map(JSON.parse);

  assert.equal(result.filesChanged, 1);
  assert.equal(result.userImagesRemoved, 2);
  assert.equal(result.toolResultsRemoved, 1);
  assert.ok(result.bytesRemoved > 0);
  assert.deepEqual(lines[1].message.content, [
    { type: "text", text: "inspect" },
    urlImage,
    { type: "text", text: "[2 image inputs removed after 7 days]" },
  ]);
  assert.deepEqual(lines[2].message.content, [flatImage]);
  assert.deepEqual(lines[3].message.content, [toolResultPlaceholder]);
  assert.equal(lines[3].message.toolCallId, "call-old-tool");
  assert.deepEqual(lines[4].message.content, [{ type: "text", text: "fresh output" }]);
  assert.equal(result.content.endsWith("\n"), true);
});

test("retention rewrite is idempotent", () => {
  const source = [
    entry("old-user", "user", [flatImage], SESSION_PAYLOAD_RETENTION_MS + 1),
    entry("old-tool", "toolResult", [{ type: "text", text: "output" }], SESSION_PAYLOAD_RETENTION_MS + 1),
    "",
  ].join("\n");
  const first = pruneExpiredSessionPayloadsFromJsonl(source, nowMs);
  const second = pruneExpiredSessionPayloadsFromJsonl(first.content, nowMs);

  assert.equal(first.userImagesRemoved, 1);
  assert.equal(first.toolResultsRemoved, 1);
  assert.equal(second.userImagesRemoved, 0);
  assert.equal(second.toolResultsRemoved, 0);
  assert.equal(second.content, first.content);
});

beforeEach(() => {
  globalThis.__piSessionHistoryRetentionLastSweepMs = undefined;
  globalThis.__piSessionHistoryRetentionPromise = undefined;
  globalThis.__piSessionHistoryRetentionFiles = new Map();
});

function fixtures(t, sources) {
  const dir = fs.mkdtempSync(join(tmpdir(), "pi-retention-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sessions = sources.map((source, i) => {
    const path = join(dir, `${i}.jsonl`);
    fs.writeFileSync(path, source);
    fs.utimesSync(path, new Date(nowMs - 86400000), new Date(nowMs - 86400000));
    return { id: String(i), path, created: new Date(nowMs - 20 * 86400000).toISOString() };
  });
  return sessions;
}

test("sweeps yield before file work, recheck live sessions, and notify only the initiating caller", async (t) => {
  const source = entry("old", "toolResult", [{ type: "text", text: "old output" }], SESSION_PAYLOAD_RETENTION_MS + 1);
  const sessions = fixtures(t, [source, source]);
  const live = new Set();
  let yielded = false, notifications = 0;
  setImmediate(() => { yielded = true; live.add("1"); });
  const sweep = maybePruneExpiredSessionPayloads(sessions, id => live.has(id), nowMs, () => { notifications++; });
  assert.equal(maybePruneExpiredSessionPayloads(sessions, () => false, nowMs, () => { notifications += 100; }), sweep);
  const result = await sweep;
  assert.equal(yielded, true, "a promise microtask alone does not yield to other requests");
  assert.equal(result.filesChanged, 1);
  assert.equal(notifications, 1);
  assert.equal(fs.readFileSync(sessions[1].path, "utf8"), source, "a session opened while queued must not be rewritten");
  assert.equal(fs.statSync(sessions[0].path).mtimeMs, nowMs - 86400000);
  await maybePruneExpiredSessionPayloads(sessions, () => false, nowMs + 1, () => { notifications++; });
  assert.equal(notifications, 1, "the hourly throttle does not notify again");
});

test("unchanged fingerprints skip payload reads, but the next expiry and file edits trigger a rescan", async (t) => {
  const future = entry("recent", "toolResult", [{ type: "text", text: "recent output" }], 86400000);
  const sessions = fixtures(t, [future, entry("empty", "toolResult", [toolResultPlaceholder], SESSION_PAYLOAD_RETENTION_MS + 1)]);
  const sweep = maybePruneExpiredSessionPayloads;
  const cached = () => sessions.map(s => globalThis.__piSessionHistoryRetentionFiles.get(s.path));
  const first = await sweep(sessions, () => false, nowMs);
  assert.equal(first.filesChanged, 0);
  const initial = cached();
  assert.ok(initial.every(Boolean));
  await sweep(sessions, () => false, nowMs + 3600000);
  cached().forEach((value, i) => assert.equal(value, initial[i], "unchanged, not-yet-due files retain their scan results"));
  const expiresAt = nowMs + SESSION_PAYLOAD_RETENTION_MS - 86400000;
  const expired = await sweep(sessions, () => false, expiresAt);
  assert.equal(expired.toolResultsRemoved, 1);
  const afterExpiry = cached();
  assert.notEqual(afterExpiry[0], initial[0], "the expiring payload was rescanned");
  assert.equal(afterExpiry[1], initial[1], "already-pruned history is not rescanned");
  await sweep(sessions, () => false, expiresAt + 3600000);
  cached().forEach((value, i) => assert.equal(value, afterExpiry[i], "cache the post-rewrite fingerprint"));
  fs.appendFileSync(sessions[1].path, "\n" + entry("added", "toolResult", [{ type: "text", text: "new old output" }], SESSION_PAYLOAD_RETENTION_MS + 1));
  fs.utimesSync(sessions[1].path, new Date(nowMs), new Date(nowMs));
  const changed = await sweep(sessions, () => false, expiresAt + 7200000);
  assert.equal(changed.toolResultsRemoved, 1);
  assert.notEqual(cached()[1], initial[1], "external changes invalidate the fingerprint");
  await sweep([], () => false, expiresAt + 10800000);
  assert.equal(globalThis.__piSessionHistoryRetentionFiles.size, 0, "removed files do not accumulate in the cache");
});

test("file-sized slices recheck liveness after yielding, not only at sweep startup", async (t) => {
  const source = entry("old", "toolResult", [{ type: "text", text: "old output" }], SESSION_PAYLOAD_RETENTION_MS + 1);
  const sessions = fixtures(t, [source, source]);
  let ticks = 0;
  t.mock.method(performance, "now", () => ticks += 5);
  const live = new Set();
  const result = await maybePruneExpiredSessionPayloads(sessions, id => {
    if (id === "0") setImmediate(() => live.add("1"));
    return live.has(id);
  }, nowMs);
  assert.equal(result.filesChanged, 1);
  assert.equal(fs.readFileSync(sessions[1].path, "utf8"), source);
});

test("a replacement with the same size and mtime invalidates the cached result", async (t) => {
  const source = entry("old", "toolResult", [toolResultPlaceholder], SESSION_PAYLOAD_RETENTION_MS + 1);
  const [session] = fixtures(t, [source]);
  await maybePruneExpiredSessionPayloads([session], () => false, nowMs);
  const before = fs.statSync(session.path);
  const replacement = entry("old", "toolResult", [{ type: "text", text: "x".repeat(toolResultPlaceholder.text.length) }], SESSION_PAYLOAD_RETENTION_MS + 1);
  fs.writeFileSync(session.path + ".new", replacement);
  fs.renameSync(session.path + ".new", session.path);
  fs.utimesSync(session.path, before.atime, before.mtime);
  assert.equal(fs.statSync(session.path).size, before.size);
  const result = await maybePruneExpiredSessionPayloads([session], () => false, nowMs + 3600000);
  assert.equal(result.toolResultsRemoved, 1);
});

test("recent, transient, live and missing files are left alone", async (t) => {
  const source = entry("old", "toolResult", [{ type: "text", text: "old output" }], SESSION_PAYLOAD_RETENTION_MS + 1);
  const sessions = fixtures(t, [source, source, source, source, source]);
  sessions[0].transient = true;
  sessions[1].created = new Date(nowMs).toISOString();
  fs.utimesSync(sessions[2].path, new Date(nowMs), new Date(nowMs));
  fs.unlinkSync(sessions[4].path);
  const result = await maybePruneExpiredSessionPayloads(sessions, id => id === "3", nowMs);
  assert.equal(result.filesChanged, 0);
  for (const session of sessions.slice(0, 4)) assert.equal(fs.readFileSync(session.path, "utf8"), source);
});
