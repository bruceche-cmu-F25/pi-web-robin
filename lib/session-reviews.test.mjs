import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { completedReplyId, pendingSessionReviews } = await jiti.import("./session-reviews.ts");
const { recordSessionReview, acceptSessionReview, readSessionReviews, updateSessionUiState, forgetSessionUiState, resetSessionUiStateCacheForTests } = await jiti.import("./session-ui-state.ts");
const answer = (id = "reply-1", stopReason = "stop", content = [{ type: "text", text: "Ready for review" }]) => ({ type: "message", id, message: { role: "assistant", stopReason, content } });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "chat-reviews-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, "ui-state.json");
}

test("only a complete visible answer qualifies, including replies followed by metadata", () => {
  assert.equal(completedReplyId([answer(), { type: "session_info", id: "rename" }]), "reply-1");
  for (const reason of ["error", "aborted", "length", "toolUse", undefined]) {
    const reply = answer(); reply.message.stopReason = reason;
    assert.equal(completedReplyId([reply]), null);
  }
  for (const content of [[], [{ type: "text", text: "  " }], [{ type: "thinking", thinking: "hmm" }]]) assert.equal(completedReplyId([answer("x", "stop", content)]), null);
  assert.equal(completedReplyId([answer("image", "stop", [{ type: "image" }])]), "image");
  for (const role of ["user", "toolResult"]) assert.equal(completedReplyId([answer(), { type: "message", id: "later", message: { role } }]), null);
});

test("reviews persist across reads/restarts, accept explicitly, and cannot resurrect on replay", async t => {
  const path = fixture(t);
  await recordSessionReview("chat-1", "reply-1", path);
  resetSessionUiStateCacheForTests();
  assert.equal(readSessionReviews(path)["chat-1"].entryId, "reply-1");
  assert.equal(readSessionReviews(path)["chat-1"].reviewed, undefined, "reads do not accept");
  assert.equal(await acceptSessionReview("chat-1", "reply-1", path), true);
  await recordSessionReview("chat-1", "reply-1", path);
  assert.equal(readSessionReviews(path)["chat-1"].reviewed, true);
  await recordSessionReview("chat-1", "reply-2", path);
  assert.equal(await acceptSessionReview("chat-1", "reply-1", path), false, "old acceptance cannot clear new completion");
  assert.equal(readSessionReviews(path)["chat-1"].entryId, "reply-2");
  assert.equal(readSessionReviews(path)["chat-1"].reviewed, undefined);
});

test("review writes share the UI-state lock and preserve pins, archive, and concurrent completions", async t => {
  const path = fixture(t);
  await Promise.all([
    recordSessionReview("chat-1", "reply-1", path),
    recordSessionReview("chat-2", "reply-2", path),
    updateSessionUiState({ action: "set", ids: ["chat-1"], pinned: true }, path),
  ]);
  assert.equal(Object.keys(readSessionReviews(path)).length, 2);
  assert.ok(JSON.parse(readFileSync(path, "utf8")).sessions["chat-1"].pinnedAt);
  await updateSessionUiState({ action: "set", ids: ["chat-1"], archived: true }, path);
  assert.equal(Object.keys(readSessionReviews(path)).length, 2, "archive is not acceptance");
  await forgetSessionUiState(["chat-1"], path);
  assert.deepEqual(Object.keys(readSessionReviews(path)), ["chat-2"]);
  await forgetSessionUiState(["chat-2"], path);
  assert.deepEqual(readSessionReviews(path), {});
});

test("queue excludes running, accepted, deleted and subagent chats and sorts newest first", () => {
  const reviews = Object.fromEntries(["a", "b", "running", "accepted", "deleted", "subagent"].map((id, i) => [id, { entryId: `reply-${i}`, completedAt: i, ...(id === "accepted" ? { reviewed: true } : {}) }]));
  const sessions = Object.keys(reviews).filter(id => id !== "deleted").map(id => ({ id, cwd: "/work", name: id === "a" ? "Named chat" : undefined, firstMessage: `Prompt ${id}`, ...(id === "subagent" ? { relation: { kind: "subagent" } } : {}) }));
  const result = pendingSessionReviews(reviews, sessions, new Set(["running"]));
  assert.deepEqual(result.map(item => item.id), ["b", "a"]);
  assert.deepEqual(result.map(item => item.title), ["Prompt b", "Named chat"]);
});
