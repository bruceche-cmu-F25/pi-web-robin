import assert from "node:assert/strict";
import test from "node:test";
import { noteMindmap, layoutMindmap, MINDMAP_LIMIT } from "./note-mindmap.ts";

test("headings and nested lists retain hierarchy without treating code as nodes", () => {
  const { root } = noteMindmap("Root", "# One\n- First\n  - Child\n- Second\n```md\n# Not a node\n~~~\n- Neither\n```\n## Two\n1. Third\n# Last\nProse stays in the note.");
  assert.deepEqual(root.children.map((n) => n.label), ["One", "Last"]);
  assert.deepEqual(root.children[0].children.map((n) => n.label), ["First", "Second", "Two"]);
  assert.equal(root.children[0].children[0].children[0].label, "Child");
  assert.equal(root.children[0].children[2].children[0].label, "Third");
});
test("layout has two sides, no overlapping labels and reversible folds", () => {
  const { root } = noteMindmap("Root", "# One\n- " + "很长的中文标题".repeat(30) + "\n  - Child\n# Two\n- Leaf\n# Three\n- Third");
  const layout = layoutMindmap(root, new Set());
  const centre = layout.nodes[0];
  assert.ok(layout.nodes.some((n) => n.x < centre.x));
  assert.ok(layout.nodes.some((n) => n.x > centre.x));
  for (let i = 0; i < layout.nodes.length; i++) for (const b of layout.nodes.slice(i + 1)) {
    const a = layout.nodes[i];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  }
  assert.equal(layout.edges.length, layout.nodes.length - 1);
  const folded = layoutMindmap(root, new Set([root.children[0].id]));
  assert.equal(folded.nodes.length, layout.nodes.length - 2);
  assert.equal(layoutMindmap(root, new Set()).nodes.length, layout.nodes.length);
});
test("large sources are bounded with an explicit truncation notice", () => {
  const text = Array.from({ length: 300 }, (_, i) => `- ${i}`).join("\n");
  const result = noteMindmap("Root", text);
  assert.equal(result.truncated, true);
  assert.equal(result.root.children.length, MINDMAP_LIMIT);
  assert.equal(noteMindmap("Root", "plain text").root.children.length, 0);
});
