import assert from "node:assert/strict";
import { test } from "node:test";
import { continueMarkdownBlock, countWords, indentMarkdownList } from "./markdown-editing.ts";

function apply(value, edit) {
  return { value: value.slice(0, edit.start) + edit.text + value.slice(edit.end), caret: edit.selectionStart };
}

test("Enter carries bullets, tasks, numbers and quotes onto the next line", () => {
  for (const [line, expected] of [
    ["- idea", "- idea\n- "],
    ["  * nested", "  * nested\n  * "],
    ["- [x] done", "- [x] done\n- [ ] "],
    ["9. ninth", "9. ninth\n10. "],
    ["3) third", "3) third\n4) "],
    ["> quoted", "> quoted\n> "],
  ]) {
    const result = apply(line, continueMarkdownBlock(line, line.length));
    assert.equal(result.value, expected);
    assert.equal(result.caret, expected.length);
  }
});

test("Enter on an empty item ends the list instead of adding another marker", () => {
  const value = "- first\n- ";
  const result = apply(value, continueMarkdownBlock(value, value.length));
  assert.equal(result.value, "- first\n");
  assert.equal(result.caret, "- first\n".length);
});

test("Enter mid-item splits the text after the caret onto the new item", () => {
  const value = "- alpha beta";
  const result = apply(value, continueMarkdownBlock(value, "- alpha".length));
  assert.equal(result.value, "- alpha\n-  beta");
});

test("plain lines, code fences and a caret inside the marker keep a plain newline", () => {
  assert.equal(continueMarkdownBlock("plain text", 10), null);
  assert.equal(continueMarkdownBlock("```\n- not a list", 16), null);
  assert.equal(continueMarkdownBlock("- item", 1), null);
  assert.equal(continueMarkdownBlock("-item", 5), null);
});

test("Tab nests list lines and Shift+Tab un-nests them, keeping the selection on the text", () => {
  const value = "- a\n- b\ntext";
  const nested = indentMarkdownList(value, 4, 7, false);
  assert.equal(apply(value, nested).value, "- a\n  - b\ntext");
  assert.deepEqual([nested.selectionStart, nested.selectionEnd], [6, 9]);

  const both = indentMarkdownList(value, 0, 7, false);
  assert.equal(apply(value, both).value, "  - a\n  - b\ntext");

  const back = indentMarkdownList("  - b", 5, 5, true);
  assert.equal(apply("  - b", back).value, "- b");
  assert.equal(back.selectionStart, 3);
});

test("Tab leaves non-list lines and un-nestable lines to the browser", () => {
  assert.equal(indentMarkdownList("plain", 2, 2, false), null);
  assert.equal(indentMarkdownList("- top", 3, 3, true), null);
});

test("word counts treat each CJK character as a word", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("# React state — don't mutate"), 4);
  assert.equal(countWords("状态更新是批量的 batched"), 9);
});
