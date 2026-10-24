import assert from "node:assert/strict";
import { test } from "node:test";
import { forceSimulation, forceLink, forceManyBody, forceCollide } from "d3-force";
import { fitGraph, folderOf, folderTone, graphData, hitNode, neighborhood, noteNeighbors, toScreen, toWorld, zoomAt } from "./obsidian-graph.ts";
const entry = (path, links = []) => ({ path, title: path.replace(/\.md$/, ""), links, modified: "2026-01-01", unresolved: [] });
const notes = [entry("A.md", ["B.md", "B.md", "missing.md", "A.md"]), entry("B.md", ["A.md", "folder/C.md"]), entry("folder/C.md", ["D.md"]), entry("D.md"), entry("Solo.md")];

test("builds a deduplicated graph without mutating the vault index; reciprocal links count once", () => {
  const before = structuredClone(notes);
  const data = graphData(notes);
  assert.equal(data.nodes.length, 5);
  assert.equal(data.edges.length, 3);
  assert.equal(data.nodes.find((n) => n.id === "B.md").degree, 2);
  assert.equal(data.nodes.find((n) => n.id === "Solo.md").degree, 0);
  assert.deepEqual(notes, before);
  assert.deepEqual([...neighborhood(data.neighbors, "A.md", 1)], ["A.md", "B.md"]);
  assert.deepEqual([...neighborhood(data.neighbors, "A.md", 2)], ["A.md", "B.md", "folder/C.md"]);
  assert.equal(neighborhood(data.neighbors, "absent", 2).size, 0);
  assert.equal(folderOf("folder/C.md"), "folder");
  assert.equal(folderOf("A.md"), "");
  assert.equal(folderTone("folder"), folderTone("folder"));
});

test("camera round trips, zoom stays under the pointer, fitting and hit testing survive scaling", () => {
  const camera = { x: 27, y: -52, k: .8 }, anchor = { x: 240, y: 320 };
  const world = toWorld(camera, anchor);
  const zoom = zoomAt(camera, 2.5, anchor);
  assert.deepEqual(toScreen(zoom, world), anchor);
  assert.equal(zoomAt(camera, 500, anchor).k, 5);
  assert.equal(zoomAt(camera, .001, anchor).k, .12);
  const nodes = graphData(notes).nodes;
  for (const [w, h] of [[375, 480], [1200, 700]]) {
    const fit = fitGraph(nodes, w, h);
    for (const node of nodes) {
      const point = toScreen(fit, node);
      assert.ok(point.x > 0 && point.x < w && point.y > 0 && point.y < h);
      assert.equal(hitNode(nodes, fit, point)?.id, node.id);
    }
  }
  assert.equal(hitNode(nodes, camera, { x: -10000, y: -10000 }), undefined);
  assert.deepEqual(fitGraph([], 400, 300), { x: 200, y: 150, k: 1 });
});

test("supports all 1,000 indexed notes and bounds dense edges, while adjacency remains complete", () => {
  const large = Array.from({ length: 1000 }, (_, i) => entry(`${i}.md`, Array.from({ length: 25 }, (_, j) => `${(i + j + 1) % 1000}.md`)));
  const data = graphData(large);
  assert.equal(data.nodes.length, 1000);
  assert.equal(data.edges.length, 10000);
  assert.ok(data.totalEdges > data.edges.length);
  assert.equal(data.neighbors.get("0.md").size, 50);
  const sim = forceSimulation(data.nodes).stop().force("charge", forceManyBody().strength(-50))
    .force("links", forceLink(data.edges)).force("collide", forceCollide(12));
  sim.tick(8); sim.stop();
  assert.ok(data.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.deepEqual([...noteNeighbors([entry("New.md")]).keys()], ["New.md"]);
});
