import assert from "node:assert/strict";
import test from "node:test";
import { noteMindmap, layoutMindmap, MINDMAP_LIMIT, fitMindmap, zoomMindmap, positionMindmap, readMindmapOffsets, translateMindmapSelection, mindmapFolds, mindmapResources, mindmapPath, mindmapEdgePath } from "./note-mindmap.ts";

test("headings and nested lists retain hierarchy without treating code as nodes", () => {
  const { root } = noteMindmap("Root", "# One\n- First\n  - Child\n- Second\n```md\n# Not a node\n~~~\n- Neither\n```\n## Two\n1. Third\n# Last\nProse stays in the note.");
  assert.deepEqual(root.children.map((n) => n.label), ["One", "Last"]);
  assert.deepEqual(root.children[0].children.map((n) => n.label), ["First", "Second", "Two"]);
  assert.equal(root.children[0].children[0].children[0].label, "Child");
  assert.equal(root.children[0].children[2].children[0].label, "Third");
});
test("focus paths use original nodes, follow moves, and fall back after removal", () => {
  const { root } = noteMindmap("Root", "# A\n- Child\n  - Leaf\n# B");
  const [a, b] = root.children, child = a.children[0], leaf = child.children[0];
  assert.deepEqual(mindmapPath(root, leaf.id), [root, a, child, leaf]);
  assert.equal(mindmapPath(root, child.id).at(-1), child, "no content clone or replacement IDs");
  assert.deepEqual(layoutMindmap(child, new Set()).nodes.map((n) => n.id), [child.id, leaf.id]);
  a.children = []; b.children.push(child);
  assert.deepEqual(mindmapPath(root, leaf.id), [root, b, child, leaf]);
  b.children = [];
  for (const id of [null, root.id, leaf.id, "missing"]) assert.deepEqual(mindmapPath(root, id), [root]);
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
test("branch sides stay stable when a subtree grows or folds; topic widths follow content", () => {
  const { root } = noteMindmap("Root", "# A\n- short\n# B\n- Much longer node text\n# C\n- Third\n# D");
  const before = layoutMindmap(root, new Set());
  root.children[0].children.push(...Array.from({ length: 25 }, (_, i) => ({ id: `extra-${i}`, label: "长标题".repeat(12), children: [] })));
  for (const folded of [new Set(), new Set([root.children[0].id])]) {
    const after = layoutMindmap(root, folded);
    for (const child of root.children) assert.equal(after.nodes.find((n) => n.id === child.id).side, before.nodes.find((n) => n.id === child.id).side);
  }
  assert.ok(before.nodes.find((n) => n.label === "short").width < before.nodes.find((n) => n.label === "Much longer node text").width);
});
test("dense expanded branches use several columns in a compact, non-overlapping footprint", () => {
  const root = { id: "root", label: "Python developer 学习地图", children: Array.from({ length: 16 }, (_, i) => ({
    id: `branch-${i}`, label: `阶段 ${i + 1}：数据结构、测试与开发`, children: Array.from({ length: 11 }, (_, j) => ({
      id: `topic-${i}-${j}`, label: "知识点：理解原理、使用场景、边界条件与测试方法；保留完整说明。",
      ...(j === 0 ? { url: "https://example.com/docs" } : {}), children: [],
    })),
  })) };
  const original = structuredClone(root), layout = layoutMindmap(root, new Set());
  assert.equal(layout.nodes.length, 193);
  assert.deepEqual(layoutMindmap(root, new Set()), layout, "no randomness or drifting simulation");
  assert.deepEqual(root, original, "layout never changes content or sibling order");
  const sizes = new Map(layout.nodes.map((n) => [n.id, n]));
  const oldSpan = node => Math.max(sizes.get(node.id).height, node.children.reduce((sum, child) => sum + oldSpan(child) + 20, -20));
  const oldHeight = Math.max(...[0, 1].map(side => root.children.filter((_, i) => i % 2 === side).reduce((sum, child) => sum + oldSpan(child) + 20, 0)));
  assert.ok(layout.height < oldHeight * 0.65, `height ${layout.height} versus single-column ${oldHeight}`);
  assert.ok(layout.width / layout.height > 0.5 && layout.width / layout.height < 2, "not just a tall strip rotated into a wide strip");
  const children = layout.nodes.filter((n) => n.id.startsWith("topic-0-"));
  assert.ok(new Set(children.map((n) => n.x)).size > 1);
  for (const edge of layout.edges) {
    assert.equal(edge.side, Math.sign(edge.to.x - edge.from.x));
    const path = mindmapEdgePath(edge);
    assert.ok(!/NaN|Infinity/.test(path));
    if (edge.packed) assert.match(path, / H .* Q .* V /, "route long edges through the empty column gutters");
  }
  for (let i = 0; i < layout.nodes.length; i++) for (const b of layout.nodes.slice(i + 1)) {
    const a = layout.nodes[i];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${a.id} overlaps ${b.id}`);
  }
  assert.equal(layoutMindmap(root, new Set(["branch-0"])).nodes.length, 182);
  assert.equal(layoutMindmap(root, new Set(["root"])).nodes.length, 1);
  assert.deepEqual(layoutMindmap(root, new Set()), layout, "unfold restores the same layout");
});
test("main branches fan along an oval without moving across their saved sides", () => {
  const root = { id: "root", label: "Centre", children: Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, label: "Topic", children: [] })) };
  const layout = layoutMindmap(root, new Set()), byId = new Map(layout.nodes.map(n => [n.id, n]));
  assert.ok(byId.get("n2").x > byId.get("n0").x, "middle right branch fans farther out");
  assert.ok(byId.get("n3").x < byId.get("n1").x, "middle left branch fans farther out");
  for (const edge of layout.edges) {
    assert.equal(edge.side, Number(edge.to.id.slice(1)) % 2 ? -1 : 1);
    assert.equal(edge.packed, false);
    assert.ok(!/NaN|Infinity/.test(mindmapEdgePath(edge)));
  }
  assert.match(mindmapEdgePath(layout.edges.find(edge => edge.to.id === "n2")), / H .* Q .* V /, "root fan routes before the other branches");
});
test("a thousand direct children also pack without dropping nodes or links", () => {
  const root = { id: "root", label: "Many topics", children: Array.from({ length: 999 }, (_, i) => ({ id: `n${i}`, label: `Topic ${i}`, children: [] })) };
  const layout = positionMindmap(layoutMindmap(root, new Set()), {});
  assert.equal(layout.nodes.length, 1000); assert.equal(layout.edges.length, 999);
  assert.ok(layout.width / layout.height > 0.5 && layout.width / layout.height < 2);
  for (let i = 0; i < layout.nodes.length; i++) for (const b of layout.nodes.slice(i + 1)) {
    const a = layout.nodes[i];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  }
});
test("pointer zoom preserves its world anchor, clamps scale and fit respects the available area", () => {
  const camera = { x: -220, y: 80, zoom: 0.8 }, pointer = { x: 450, y: 310 };
  for (const zoom of [0, 0.3, 1.2, 99]) {
    const next = zoomMindmap(camera, zoom, pointer.x, pointer.y);
    assert.ok(next.zoom >= 0.08 && next.zoom <= 2.5);
    assert.ok(Math.abs((pointer.x - camera.x) / camera.zoom - (pointer.x - next.x) / next.zoom) < 1e-8);
    assert.ok(Math.abs((pointer.y - camera.y) / camera.zoom - (pointer.y - next.y) / next.zoom) < 1e-8);
  }
  const fit = fitMindmap(1200, 600, 900, 700);
  assert.ok(fit.x > 0 && fit.y > 0);
  assert.ok(fit.x + 1200 * fit.zoom < 900);
  assert.ok(fit.y + 600 * fit.zoom < 700);
});
test("view offsets move descendants and edge endpoints, preserve the tree, and bound negative positions", () => {
  const { root } = noteMindmap("Root", "# Parent\n- Child\n  - Grandchild\n# Other");
  const layout = layoutMindmap(root, new Set()), original = structuredClone(layout);
  const moved = positionMindmap(layout, { "line-0": { parent: "root", x: -900, y: 60 }, "line-1": { parent: "line-0", x: 10, y: 20 } });
  for (const node of moved.nodes) {
    const base = layout.nodes.find((n) => n.id === node.id);
    assert.equal(node.x - base.x, ["line-1", "line-2"].includes(node.id) ? -890 : node.id === "line-0" ? -900 : 0);
    assert.equal(node.y - base.y, ["line-1", "line-2"].includes(node.id) ? 80 : node.id === "line-0" ? 60 : 0);
    assert.ok(node.x >= moved.left && node.x + node.width <= moved.left + moved.width);
  }
  for (const edge of moved.edges) {
    assert.equal(edge.from, moved.nodes.find((n) => n.id === edge.from.id));
    assert.equal(edge.to, moved.nodes.find((n) => n.id === edge.to.id));
  }
  assert.deepEqual(layout, original, "layout and tree are never mutated");
  const folded = positionMindmap(layoutMindmap(root, new Set(["line-0"])), { "line-0": { parent: "root", x: -900, y: 60 } });
  assert.equal(folded.nodes.find((n) => n.id === "line-0").x - layoutMindmap(root, new Set(["line-0"])).nodes.find((n) => n.id === "line-0").x, -900);
});
test("crossing a parent switches connector anchors and node controls in either direction", () => {
  const { root } = noteMindmap("A wider central topic", "# Right\n- Right leaf\n# Left\n- Left leaf");
  const layout = layoutMindmap(root, new Set()), original = structuredClone(layout);
  for (const [id, x, expectedSide] of [["line-2", 1000, 1], ["line-0", -1000, -1]]) {
    const offsets = readMindmapOffsets({ [id]: { parent: "root", x, y: 180 } }, root);
    const moved = positionMindmap(layout, offsets);
    const incoming = moved.edges.find((edge) => edge.to.id === id);
    assert.equal(incoming.side, expectedSide, "attachment sides follow current positions, not automatic layout");
    assert.equal(incoming.to.side, expectedSide, "add/fold controls move to the outward side");
    for (const edge of moved.edges) {
      const dx = edge.to.x + edge.to.width / 2 - edge.from.x - edge.from.width / 2;
      assert.equal(edge.side, Math.sign(dx));
      assert.equal(edge.side, edge.to.side);
    }
    assert.deepEqual(positionMindmap(layout, JSON.parse(JSON.stringify(offsets))), moved, "restoring offsets recalculates sides");
  }
  assert.deepEqual(layout, original, "automatic layout and hierarchy remain unchanged");
  assert.deepEqual(positionMindmap(layout, {}).nodes, layout.nodes, "reset restores original directions");
});
test("restoring layout validates finite bounded offsets and parent identity", () => {
  const { root } = noteMindmap("Root", "# Parent\n- Child");
  assert.deepEqual(readMindmapOffsets({ root: { x: 20, y: 40, parent: null }, "line-0": { x: 2, y: 3, parent: "wrong-parent" }, "line-1": { x: Infinity, y: 0, parent: "line-0" }, missing: { x: 0, y: 0, parent: "root" } }, root), { root: { x: 20, y: 40, parent: null } });
  assert.deepEqual(readMindmapOffsets({ root: { x: 100_001, y: 0, parent: null } }, root), {});
  for (const invalid of [null, "garbage", []]) assert.deepEqual(readMindmapOffsets(invalid, root), {});
  const layout = layoutMindmap(root, new Set());
  const moved = positionMindmap(layout, { "line-1": { x: 200, y: 300, parent: "old-parent" } });
  assert.deepEqual(moved.nodes, layout.nodes, "reparenting ignores the old parent's offset");
});
test("bulk dragging translates selected ancestors once and keeps hidden descendants attached", () => {
  const { root } = noteMindmap("Root", "# A\n- A1\n  - A2\n# B\n- B1\n# C");
  const before = layoutMindmap(root, new Set());
  const offsets = translateMindmapSelection(root, ["line-0", "line-1", "line-3"], {}, 100, -60);
  assert.deepEqual(Object.keys(offsets), ["line-0", "line-3"]);
  const after = positionMindmap(before, offsets);
  after.nodes.forEach((node) => {
    const original = before.nodes.find((n) => n.id === node.id), moved = !["root", "line-5"].includes(node.id);
    assert.equal(node.x - original.x, moved ? 100 : 0); assert.equal(node.y - original.y, moved ? -60 : 0);
  });
  const all = translateMindmapSelection(root, before.nodes.map((n) => n.id), offsets, 16, 0);
  assert.equal(all.root.x, 16); assert.deepEqual(all["line-0"], offsets["line-0"], "select all moves only the root offset");
  const unfolded = positionMindmap(layoutMindmap(root, new Set()), all);
  const folded = positionMindmap(layoutMindmap(root, mindmapFolds(root, 1)), all);
  assert.equal(folded.nodes.length, 4); assert.equal(unfolded.nodes.length, 7);
  assert.deepEqual(mindmapFolds(root, 2), new Set(["line-1"]));
});
test("saved side assignments render left and right at every detail level", () => {
  const { root } = noteMindmap("Root", "# A\n- A1\n# B\n- B1\n# C");
  root.children[0].branchSide = "left"; root.children[1].branchSide = "right";
  for (const folds of [new Set(), mindmapFolds(root, 1), mindmapFolds(root, 2)]) {
    const map = layoutMindmap(root, folds);
    assert.equal(map.nodes.find((node) => node.id === "line-0").side, -1);
    assert.equal(map.nodes.find((node) => node.id === "line-2").side, 1);
    for (const edge of map.edges) assert.equal(Math.sign(edge.to.x - edge.from.x), edge.side);
  }
});
test("existing plain and Markdown source URLs become named resources without changing saved labels", () => {
  const node = { id: "source", label: "[Guide](https://example.com/guide_(one))，参考 https://example.org/docs。", children: [] };
  const original = structuredClone(node), result = mindmapResources(node);
  assert.deepEqual(result.links, [{ label: "Guide", url: "https://example.com/guide_(one)" }, { label: "example.org", url: "https://example.org/docs" }]);
  assert.equal(result.text, "Guide，参考 example.org。");
  assert.deepEqual(node, original);
  const map = layoutMindmap({ id: "root", label: "Root", children: [node] }, new Set());
  const topic = map.nodes.find((n) => n.id === node.id);
  assert.equal(topic.height, topic.topicHeight + 88);
  assert.equal(topic.label, original.label);
  assert.equal(mindmapResources({ ...node, url: result.links[0].url }).links.length, 2, "explicit and detected URLs deduplicate");
  assert.equal(mindmapResources({ ...node, label: "Starter Story" }).links.length, 0, "names alone never become guessed URLs");
  assert.equal(mindmapResources({ ...node, label: "[Bad](javascript:alert(1)) https://user:pass@example.com/" }).links.length, 0);
  assert.deepEqual(mindmapResources({ ...node, label: "<https://example.com/docs>" }).links, [{ label: "example.com", url: "https://example.com/docs" }]);
});
test("resource links have their own hit area without overlapping neighbouring topics", () => {
  const { root } = noteMindmap("Root", "# Resources\n- One\n- Two\n# Other");
  const plain = layoutMindmap(root, new Set());
  root.children[0].url = "https://example.com/";
  root.children[0].children[0].url = "https://example.com/guide";
  const linked = layoutMindmap(root, new Set());
  assert.equal(linked.nodes.find((n) => n.id === "line-0").height, plain.nodes.find((n) => n.id === "line-0").height + 44);
  for (let i = 0; i < linked.nodes.length; i++) for (const b of linked.nodes.slice(i + 1)) {
    const a = linked.nodes[i];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  }
});
test("large sources are bounded with an explicit truncation notice", () => {
  const text = Array.from({ length: 300 }, (_, i) => `- ${i}`).join("\n");
  const result = noteMindmap("Root", text);
  assert.equal(result.truncated, true);
  assert.equal(result.root.children.length, MINDMAP_LIMIT);
  assert.equal(noteMindmap("Root", "plain text").root.children.length, 0);
});
