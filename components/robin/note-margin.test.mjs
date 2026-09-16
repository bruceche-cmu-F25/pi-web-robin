import assert from "node:assert/strict";
import { test } from "node:test";
import { currentHeading, noteMarginItems, noteOutline, stackMarginCards } from "./note-margin.ts";

const note = [
  "# 14-848 · Lecture 5",
  "",
  "## 为什么需要",
  "- hash(key) mod N",
  "- question: 虚拟节点数量怎么选？",
  "```",
  "# not a heading",
  "why is this code?",
  "```",
  "## 环",
  "- [ ] 读 Dynamo paper 第 4 节",
  "- [x] 已经做完的",
  "- 为什么负载更均匀?",
  "Q: what about hot keys",
  "### Is this a heading question?",
].join("\n");

test("the outline lists headings outside code blocks with their lines", () => {
  assert.deepEqual(noteOutline(note), [
    { level: 1, text: "14-848 · Lecture 5", line: 0 },
    { level: 2, text: "为什么需要", line: 2 },
    { level: 2, text: "环", line: 9 },
    { level: 3, text: "Is this a heading question?", line: 14 },
  ]);
});

test("margin items are open to-dos and questions, never headings, done tasks or code", () => {
  assert.deepEqual(noteMarginItems(note), [
    { kind: "question", text: "虚拟节点数量怎么选？", line: 4 },
    { kind: "todo", text: "读 Dynamo paper 第 4 节", line: 10 },
    { kind: "question", text: "为什么负载更均匀?", line: 12 },
    { kind: "question", text: "what about hot keys", line: 13 },
  ]);
  assert.deepEqual(noteMarginItems("问题：为什么\n> 引用里的问题？"), [
    { kind: "question", text: "为什么", line: 0 },
    { kind: "question", text: "引用里的问题？", line: 1 },
  ]);
});

test("the current heading is the last one at or above a line", () => {
  const outline = noteOutline(note);
  assert.equal(currentHeading(outline, 0), 0);
  assert.equal(currentHeading(outline, 8), 1);
  assert.equal(currentHeading(outline, 12), 2);
  assert.equal(currentHeading([], 3), -1);
});

test("cards sit at their line unless the card above is in the way", () => {
  assert.deepEqual(stackMarginCards([{ y: 100, height: 60 }, { y: 300, height: 60 }]), [84, 284]);
  assert.deepEqual(stackMarginCards([{ y: 100, height: 60 }, { y: 120, height: 60 }]), [84, 152]);
});
