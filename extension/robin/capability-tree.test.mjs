import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITY_NODES } from "./capability-map.ts";
import { CAPABILITY_ACQUISITION } from "./capability-acquisition.ts";
import { CAPABILITY_WORLDVIEW } from "./capability-worldview.ts";
import { TECHNOLOGY_GLOSSARY } from "./technology-glossary.ts";
import {
  GRID,
  ancestorsOf,
  bracePath,
  buildCapabilityTree,
  columnX,
  flattenTree,
  layoutCapabilityTree,
} from "./capability-tree.ts";

const tree = buildCapabilityTree(false);
const all = flattenTree(tree);
const openAll = new Set(all.filter((node) => node.children.length).map((node) => node.id));

test("the industry tree carries every capability exactly once", () => {
  const capabilities = all.filter((node) => node.kind === "capability");
  assert.equal(capabilities.length, CAPABILITY_NODES.length);
  assert.equal(new Set(all.map((node) => node.id)).size, all.length, "tree ids must be unique");

  for (const capability of CAPABILITY_NODES) {
    const placed = capabilities.find((node) => node.refId === capability.id);
    assert.ok(placed, `${capability.id} is missing from the tree`);
    assert.equal(placed.children.length, 0, "technologies belong in the reader, not the map");
  }
});

test("depth maps to a fixed column so the map never reshuffles", () => {
  const { nodes } = layoutCapabilityTree(tree, openAll, "ai");
  for (const node of nodes) assert.equal(node.x, columnX(node.depth));
  const collapsed = layoutCapabilityTree(tree, new Set(["root"]), "ai");
  const rootOpen = nodes.find((node) => node.id === "root");
  const rootCollapsedView = collapsed.nodes.find((node) => node.id === "root");
  assert.equal(rootOpen.x, rootCollapsedView.x);
  // Continents keep their order in both views.
  const order = (layout) => layout.nodes.filter((node) => node.kind === "domain").map((node) => node.id);
  assert.deepEqual(order(collapsed), order({ nodes }));
});

test("siblings never overlap and parents stay centred on their brace", () => {
  const { nodes, braces } = layoutCapabilityTree(tree, openAll, "fullstack");
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const walk = (node) => {
    if (!node.children.length) return;
    const placed = node.children.map((child) => byId.get(child.id));
    for (let i = 1; i < placed.length; i += 1) {
      const previous = placed[i - 1];
      assert.ok(
        placed[i].y >= previous.y + previous.height,
        `${placed[i].id} overlaps ${previous.id}`,
      );
    }
    node.children.forEach(walk);
  };
  walk(tree);

  for (const brace of braces) {
    const parent = byId.get(brace.id.replace(/^brace:/, ""));
    assert.equal(brace.parentY, parent.y + parent.height / 2);
    assert.ok(brace.x > parent.x + parent.width, "the brace sits right of its parent");
    assert.ok(brace.bottom >= brace.top);
  }
});

test("every placed edge sits on the grid", () => {
  const { nodes, braces } = layoutCapabilityTree(tree, openAll, "ai");
  for (const node of nodes) {
    for (const [name, value] of Object.entries({ x: node.x, y: node.y, w: node.width, h: node.height })) {
      assert.equal(value % GRID, 0, `${node.id}.${name} is off the grid at ${value}`);
    }
  }
  for (const brace of braces) {
    assert.equal(Math.abs((brace.bottom - brace.top) % GRID), 0, `${brace.id} spans a ragged distance`);
  }
});

test("collapsing a branch shrinks the canvas instead of hiding the continent", () => {
  const openRoot = new Set(["root"]);
  const shallow = layoutCapabilityTree(tree, openRoot, "backend");
  const deep = layoutCapabilityTree(tree, openAll, "backend");
  assert.ok(deep.height > shallow.height);
  assert.ok(deep.width > shallow.width);
  assert.equal(shallow.nodes.filter((node) => node.kind === "domain").length, 8);
  assert.equal(shallow.braces.length, 1, "only the root brace is drawn when continents are shut");
});

test("a collapsed continent still shows the strongest demand underneath it", () => {
  const { nodes } = layoutCapabilityTree(tree, new Set(["root"]), "ai");
  const aiDomain = nodes.find((node) => node.id === "domain:ai-engineering");
  assert.equal(aiDomain.demand, "core");
  assert.ok(nodes.filter((node) => node.kind === "domain").every((node) => node.demand));
});

test("brace geometry is drawable and aims its tip at the parent", () => {
  const { braces } = layoutCapabilityTree(tree, openAll, "tpm");
  assert.ok(braces.length > 0);
  for (const brace of braces) {
    const path = bracePath(brace);
    assert.match(path, /^M /);
    assert.ok(!/NaN|Infinity/.test(path), `${brace.id} produced an undrawable path`);
    assert.ok(brace.x < columnX(brace.childDepth), "the brace stays left of the children it opens onto");
  }
});

test("ancestorsOf walks a search hit back to the root", () => {
  const trail = ancestorsOf(tree, "cap:rag");
  assert.deepEqual(trail.slice(0, 2), ["root", "domain:ai-engineering"]);
  assert.equal(trail[trail.length - 1], "cluster:context-retrieval");
  assert.deepEqual(ancestorsOf(tree, "nope"), []);
});

test("every capability says how it is acquired and how people stall", () => {
  const ids = new Set(CAPABILITY_NODES.map((node) => node.id));
  for (const id of Object.keys(CAPABILITY_ACQUISITION)) {
    assert.ok(ids.has(id), `${id} has an acquisition path but no capability`);
  }
  for (const node of CAPABILITY_NODES) {
    const entry = CAPABILITY_ACQUISITION[node.id];
    assert.ok(entry, `${node.id} has no acquisition path`);
    assert.ok(entry.path.length >= 20, `${node.id} needs a real practice loop`);
    assert.ok(entry.trap.length >= 15, `${node.id} needs a named failure mode`);
  }
});

test("every capability explains itself, its origin and its mechanism", () => {
  for (const node of CAPABILITY_NODES) {
    const entry = CAPABILITY_WORLDVIEW[node.id];
    assert.ok(entry, `${node.id} has no worldview entry`);
    assert.ok(entry.what.length >= 20, `${node.id} needs a plain-language definition`);
    assert.ok(entry.how.length >= 30, `${node.id} needs a mechanism`);
    for (const beat of ["before", "broke", "now", "cost"]) {
      assert.ok(entry.origin[beat]?.length >= 15, `${node.id} origin.${beat} is too thin`);
    }
  }
  const ids = new Set(CAPABILITY_NODES.map((node) => node.id));
  for (const id of Object.keys(CAPABILITY_WORLDVIEW)) {
    assert.ok(ids.has(id), `${id} has a worldview entry but no capability`);
  }
});

test("every glossary term is a label that actually appears on the map", () => {
  const labels = new Set(CAPABILITY_NODES.flatMap((node) => node.technologies));
  for (const [term, definition] of Object.entries(TECHNOLOGY_GLOSSARY)) {
    assert.ok(labels.has(term), `${term} is defined but no capability lists it`);
    assert.ok(definition.length >= 15, `${term} needs a real definition`);
  }
  assert.ok(Object.keys(TECHNOLOGY_GLOSSARY).length >= 100, "the glossary has thinned out");
});
