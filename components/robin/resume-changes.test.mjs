import assert from "node:assert/strict";
import { test } from "node:test";
import { resumeChanges, resumeLineRange } from "./resume-changes.ts";

test("replacement highlights removed/added lines with both source coordinates", () => {
  const result = resumeChanges("Header\nOld bullet\nTail\n", "Header\nNew bullet\nTail\n");
  assert.equal(result.added, 1); assert.equal(result.removed, 1);
  assert.equal(result.hunks[0].targetLine, 2);
  assert.deepEqual(result.hunks[0].lines.filter(line => line.kind !== "context"), [
    { kind: "removed", oldLine: 2, newLine: null, text: "Old bullet" },
    { kind: "added", oldLine: null, newLine: 2, text: "New bullet" },
  ]);
});

test("distant edits stay compact and jump to the change, not to preceding context", () => {
  const old = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
  const updated = [...old]; updated[9] = "Updated ten"; updated[89] = "Updated ninety";
  const result = resumeChanges(old.join("\n"), updated.join("\n"));
  assert.equal(result.hunks.length, 2);
  assert.deepEqual(result.hunks.map(hunk => hunk.targetLine), [10, 90]);
  assert.ok(result.hunks.every(hunk => hunk.lines.length <= 7));
});

test("insertion, deletion and EOF markers do not shift target or line counts", () => {
  const added = resumeChanges("", "中文\nSecond line");
  assert.equal(added.added, 2); assert.equal(added.removed, 0);
  assert.equal(added.hunks[0].targetLine, 1);
  const removed = resumeChanges("Keep\nDelete", "Keep");
  assert.equal(removed.added, 1); // 'Keep' also changes its final newline.
  assert.equal(removed.hunks[0].targetLine, 1);
  const allRemoved = resumeChanges("Delete\n", "");
  assert.equal(allRemoved.hunks[0].targetLine, 1);
  assert.equal(allRemoved.removed, 1);
  assert.equal(allRemoved.added, 0);
  assert.deepEqual(resumeChanges("same\n", "same\n"), { hunks: [], added: 0, removed: 0 });
});

test("jump prefers changed text over its leading blank separator", () => {
  assert.equal(resumeChanges("Header\n", "Header\n\nNew content\n").hunks[0].targetLine, 3);
  assert.equal(resumeChanges("Header\n", "Header\n\n").hunks[0].targetLine, 2);
});

test("complex or oversized diffs fall back to complete source views", () => {
  assert.equal(resumeChanges("", "\n".repeat(10_001)), null);
  const many = Array.from({ length: 2500 }, (_, i) => `A${i}\n`).join("");
  assert.equal(resumeChanges(many, many.replaceAll("A", "B")), null);
});

test("CRLF diff rows retain correct coordinates without displaying carriage returns", () => {
  const result = resumeChanges("alpha\r\nbeta\r\n", "alpha\r\nbetter\r\n");
  assert.equal(result.hunks[0].targetLine, 2);
  assert.equal(result.hunks[0].lines.find(line => line.kind === "added").text, "better");
  assert.ok(result.hunks[0].lines.every(line => !line.text.includes("\r")));
});

test("jump selection is exact for Unicode, empty lines, long lines, CRLF and EOF", () => {
  const source = "Header\n\\textbf{中文 🙂}\n\nEnd";
  const target = resumeLineRange(source, 2);
  assert.equal(source.slice(target.start, target.end), "\\textbf{中文 🙂}");
  assert.equal(target.line, 2);
  assert.deepEqual(resumeLineRange("", 100), { line: 1, start: 0, end: 0 });
  assert.equal(resumeLineRange("a\n", 9).line, 2);
  assert.deepEqual(resumeLineRange("a\r\nb\r\n", 2), { line: 2, start: 3, end: 4 });
  assert.equal(resumeLineRange(source, NaN).line, 1);
  assert.equal(resumeLineRange(source, -1).line, 1);
  assert.equal(resumeLineRange("x".repeat(10000) + "\nTarget", 2).start, 10001);
});
