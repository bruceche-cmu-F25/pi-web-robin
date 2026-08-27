import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  SESSION_PAYLOAD_RETENTION_MS,
  pruneExpiredSessionPayloadsFromJsonl,
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
