import assert from "node:assert/strict";
import test from "node:test";

import {
  clearExpandedToolCalls,
  isToolCallExpanded,
  setToolCallExpanded,
} from "./tool-call-expansion.ts";

test("remembers expanded tool calls across remounts by toolCallId", () => {
  clearExpandedToolCalls();
  assert.equal(isToolCallExpanded("s1", "call_1"), false);

  setToolCallExpanded("s1", "call_1", true);
  assert.equal(isToolCallExpanded("s1", "call_1"), true);
  assert.equal(isToolCallExpanded("s1", "call_2"), false);

  setToolCallExpanded("s1", "call_1", false);
  assert.equal(isToolCallExpanded("s1", "call_1"), false);
});

test("does not leak expansion to a reused id in another session", () => {
  clearExpandedToolCalls();
  setToolCallExpanded("s1", "call_0", true);
  assert.equal(isToolCallExpanded("s2", "call_0"), false);
});

test("evicts the oldest expanded ids past the cap", () => {
  clearExpandedToolCalls();
  for (let i = 0; i <= 500; i++) setToolCallExpanded("s1", `call_${i}`, true);
  assert.equal(isToolCallExpanded("s1", "call_0"), false);
  assert.equal(isToolCallExpanded("s1", "call_1"), true);
  assert.equal(isToolCallExpanded("s1", "call_500"), true);
});

test("ignores tool calls without an id", () => {
  clearExpandedToolCalls();
  setToolCallExpanded("s1", undefined, true);
  assert.equal(isToolCallExpanded("s1", undefined), false);
});
