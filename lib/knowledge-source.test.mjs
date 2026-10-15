import assert from "node:assert/strict";
import { test } from "node:test";
import { knowledgeSource, knowledgeSourceText } from "./knowledge-source.ts";
const message = (id, parentId, role, content) => ({ type: "message", id, parentId, timestamp: "2026-10-01T00:00:00Z", message: { role, content } });
const input = { sessionId: "session", leafId: "answer", scope: "all", sessionName: "Architecture", project: "Robin", origin: "http://localhost:30141" };

test("captures only visible text from the selected ancestor chain, without system, reasoning, tools, custom messages or sibling branches", () => {
  const entries = [
    message("system", null, "system", "SECRET SYSTEM"),
    message("user", "system", "user", "Why use Markdown?"),
    message("tools", "user", "toolResult", [{ type: "text", text: "SECRET FILE" }]),
    message("injected", "tools", "custom", "DO SOMETHING"),
    message("answer", "injected", "assistant", [{ type: "thinking", thinking: "SECRET THOUGHT" }, { type: "toolCall", input: { key: "SECRET KEY" } }, { type: "text", text: "Portable text." }]),
    message("sibling", "user", "assistant", [{ type: "text", text: "OTHER BRANCH" }]),
  ];
  const source = knowledgeSource(entries, input);
  assert.deepEqual(source.messages.map((item) => item.id), ["user", "answer"]);
  assert.equal(knowledgeSourceText(source), "[user · user]\nWhy use Markdown?\n\n[assistant · answer]\nPortable text.");
  assert.equal(source.url, "http://localhost:30141/?session=session");
  assert.equal(source.fingerprint, knowledgeSource(entries, input).fingerprint);
});

test("recent range is explicit and huge sources are rejected instead of clipped", () => {
  const entries = Array.from({ length: 20 }, (_, index) => message(`e${index}`, index ? `e${index - 1}` : null, "user", `text ${index}`));
  const source = knowledgeSource(entries, { ...input, leafId: "e19", scope: "recent4" });
  assert.equal(source.totalMessages, 20);
  assert.deepEqual(source.messages.map((item) => item.id), ["e16", "e17", "e18", "e19"]);
  const huge = knowledgeSource([message("answer", null, "user", "x".repeat(80_001))], input);
  assert.deepEqual(huge.messages, []);
  assert.equal(huge.chars, 80_001);
  assert.throws(() => knowledgeSourceText(huge), /too long/);
});

test("missing and cyclic branches fail closed", () => {
  assert.throws(() => knowledgeSource([], input), /no longer exists/);
  assert.throws(() => knowledgeSource([message("answer", "answer", "user", "loop")], input), /Invalid session tree/);
  assert.throws(() => knowledgeSource([message("answer", "gone", "user", "orphan")], input), /missing ancestor/);
});
