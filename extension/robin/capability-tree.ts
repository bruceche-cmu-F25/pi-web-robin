/**
 * Deterministic layout for the capability atlas.
 *
 * The old atlas used a force-directed graph, which gave every redraw a
 * different shape — a map you cannot build spatial memory of is a picture, not
 * a map. This module lays the same data out as a strict four-level bracket
 * tree with stable coordinates: continent order never changes, depth always
 * maps to the same column, and expanding a branch only grows it downward.
 *
 * Pure and dependency-free so the geometry can be tested without a DOM.
 */
import {
  CAPABILITY_NODES,
  demandFor,
  type CapabilityDemand,
  type CapabilityRole,
} from "./capability-map.ts";
import { INDUSTRY_CLUSTERS, INDUSTRY_PILLARS } from "./industry-world.ts";

export const TREE_KINDS = ["root", "domain", "cluster", "capability"] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

export interface TreeNode {
  /** Unique across the whole tree; a technology label alone is not unique. */
  id: string;
  kind: TreeKind;
  /** Id of the underlying domain / cluster / capability, or the raw label. */
  refId: string;
  /** Continent this node belongs to; drives colour. Empty for the root. */
  domain: string;
  label: string;
  labelAlt: string;
  depth: number;
  children: TreeNode[];
}

export interface PlacedNode extends TreeNode {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Strongest demand this subtree carries for the active role, if any. */
  demand: CapabilityDemand | null;
  hasChildren: boolean;
  expanded: boolean;
  /** Ancestor ids, root first — used to draw the "you are here" path. */
  trail: string[];
}

/** One curly brace binding a parent to the sibling run it opens onto. */
export interface Brace {
  id: string;
  domain: string;
  /** Spine of the brace; the tip points left toward the parent. */
  x: number;
  top: number;
  bottom: number;
  /** Tip height — the parent's own centre, so the brace aims at it. */
  tip: number;
  parentX: number;
  parentY: number;
  childCount: number;
  /** Depth of the children — lets the renderer fade deep braces out first. */
  childDepth: number;
}

export interface TreeLayout {
  nodes: PlacedNode[];
  braces: Brace[];
  width: number;
  height: number;
}

/**
 * Every dimension is a multiple of GRID. Nodes carry one line of text now — the
 * second language and everything else moved to the detail panel — so heights no
 * longer flex with content and the whole map lands on one rhythm.
 */
export const GRID = 8;

const WIDTH: Record<TreeKind, number> = {
  root: 248,
  domain: 272,
  cluster: 224,
  capability: 256,
};

const HEIGHT: Record<TreeKind, number> = {
  root: 64,
  domain: 56,
  cluster: 48,
  capability: 48,
};

/** Vertical breathing room between siblings, by the siblings' own kind. */
const SIBLING_GAP: Record<TreeKind, number> = {
  root: 0,
  domain: 32,
  cluster: 24,
  capability: 16,
};

/** Horizontal room reserved between a column and the next, for the brace. */
export const BRACE_GAP = 80;
export const PADDING = 48;

const COLUMN_X: number[] = [];
{
  const order: TreeKind[] = ["root", "domain", "cluster", "capability"];
  let x = PADDING;
  for (const kind of order) {
    COLUMN_X.push(x);
    x += WIDTH[kind] + BRACE_GAP;
  }
}

export function columnX(depth: number): number {
  return COLUMN_X[Math.min(depth, COLUMN_X.length - 1)];
}

export function nodeWidth(kind: TreeKind): number {
  return WIDTH[kind];
}

/** Keep every placed edge on the grid; half-pixel rows read as ragged. */
function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/**
 * The full tree, independent of expansion state — expansion only decides what
 * gets laid out, never what exists, so search can always reach every node.
 */
export function buildCapabilityTree(zh: boolean): TreeNode {
  const nodeById = new Map(CAPABILITY_NODES.map((node) => [node.id, node]));

  const domains = INDUSTRY_PILLARS.map((pillar): TreeNode => {
    const clusters = INDUSTRY_CLUSTERS.filter((cluster) => cluster.pillar === pillar.id).map(
      (cluster): TreeNode => {
        const capabilities = cluster.nodeIds.flatMap((id) => {
          const capability = nodeById.get(id);
          if (!capability) return [];
          return [{
            id: `cap:${capability.id}`,
            kind: "capability" as const,
            refId: capability.id,
            domain: pillar.id,
            label: zh ? capability.titleZh : capability.title,
            labelAlt: zh ? capability.title : capability.titleZh,
            depth: 3,
            // Technologies are examples inside the reader, not another layer
            // of geography. Keeping them off the canvas preserves the world.
            children: [],
          }];
        });
        return {
          id: `cluster:${cluster.id}`,
          kind: "cluster",
          refId: cluster.id,
          domain: pillar.id,
          label: zh ? cluster.titleZh : cluster.title,
          labelAlt: zh ? cluster.title : cluster.titleZh,
          depth: 2,
          children: capabilities,
        };
      },
    );
    return {
      id: `domain:${pillar.id}`,
      kind: "domain",
      refId: pillar.id,
      domain: pillar.id,
      label: zh ? pillar.titleZh : pillar.title,
      labelAlt: zh ? pillar.title : pillar.titleZh,
      depth: 1,
      children: clusters,
    };
  });

  return {
    id: "root",
    kind: "root",
    refId: "root",
    domain: "",
    label: zh ? "工程世界" : "Engineering World",
    labelAlt: zh ? "Software & AI Engineering World" : "软件与 AI 工程世界",
    depth: 0,
    children: domains,
  };
}

/** Strongest demand in a subtree, so a collapsed continent still shows a colour. */
function subtreeDemand(node: TreeNode, role: CapabilityRole): CapabilityDemand | null {
  if (node.kind === "capability") {
    const capability = CAPABILITY_NODES.find((item) => item.id === node.refId);
    return capability ? demandFor(capability, role) : null;
  }
  let best: CapabilityDemand | null = null;
  for (const child of node.children) {
    const demand = subtreeDemand(child, role);
    if (demand === "core") return "core";
    if (demand === "recurring") best = "recurring";
    else if (demand === "adjacent" && !best) best = "adjacent";
  }
  return best;
}

/**
 * Places every visible node. Height of a branch is the greater of its own box
 * and the stack of its children, so a parent always sits centred on the run of
 * children its brace embraces.
 */
export function layoutCapabilityTree(
  root: TreeNode,
  expanded: ReadonlySet<string>,
  role: CapabilityRole,
): TreeLayout {
  const nodes: PlacedNode[] = [];
  const braces: Brace[] = [];

  const isOpen = (node: TreeNode) => node.children.length > 0 && expanded.has(node.id);

  const measure = (node: TreeNode): number => {
    const own = HEIGHT[node.kind];
    if (!isOpen(node)) return own;
    const gap = SIBLING_GAP[node.children[0].kind];
    const stack = node.children.reduce((total, child) => total + measure(child), 0)
      + gap * (node.children.length - 1);
    return Math.max(own, stack);
  };

  const place = (node: TreeNode, top: number, trail: string[]): PlacedNode => {
    const span = measure(node);
    const height = HEIGHT[node.kind];
    const placed: PlacedNode = {
      ...node,
      x: columnX(node.depth),
      y: snap(top + span / 2 - height / 2),
      width: WIDTH[node.kind],
      height,
      demand: subtreeDemand(node, role),
      hasChildren: node.children.length > 0,
      expanded: isOpen(node),
      trail,
    };
    nodes.push(placed);

    if (!isOpen(node)) return placed;

    const gap = SIBLING_GAP[node.children[0].kind];
    const stack = node.children.reduce((total, child) => total + measure(child), 0)
      + gap * (node.children.length - 1);
    // Centre a short run of children against a taller parent box.
    let cursor = snap(top + Math.max(0, (span - stack) / 2));
    const childTrail = [...trail, node.id];
    const placedChildren: PlacedNode[] = [];
    for (const child of node.children) {
      placedChildren.push(place(child, cursor, childTrail));
      cursor += measure(child) + gap;
    }

    const first = placedChildren[0];
    const last = placedChildren[placedChildren.length - 1];
    braces.push({
      id: `brace:${node.id}`,
      domain: node.domain || first.domain,
      x: columnX(node.depth + 1) - BRACE_GAP * 0.42,
      top: first.y + first.height / 2,
      bottom: last.y + last.height / 2,
      tip: placed.y + placed.height / 2,
      parentX: placed.x + placed.width,
      parentY: placed.y + placed.height / 2,
      childCount: placedChildren.length,
      childDepth: node.depth + 1,
    });
    return placed;
  };

  place(root, PADDING, []);

  const width = Math.max(...nodes.map((node) => node.x + node.width)) + PADDING;
  const height = Math.max(...nodes.map((node) => node.y + node.height)) + PADDING;
  return { nodes, braces, width, height };
}

/**
 * SVG path for a left-pointing curly brace: the tip aims at the parent, the
 * two arms wrap the run of children.
 */
export function bracePath(brace: Brace): string {
  const span = brace.bottom - brace.top;
  const arm = 14;
  const r = Math.max(4, Math.min(arm, span / 4));
  const x = brace.x;
  const { top, bottom } = brace;
  // The tip tracks the parent, but never leaves the span it is binding.
  const tipY = Math.max(top + r, Math.min(bottom - r, brace.tip));
  if (span < 6) return `M ${x + arm} ${top} L ${x - arm} ${tipY}`;
  return [
    `M ${x + arm} ${top}`,
    `q ${-arm} 0 ${-arm} ${r}`,
    `L ${x} ${tipY - r}`,
    `q 0 ${r} ${-arm} ${r}`,
    `q ${arm} 0 ${arm} ${r}`,
    `L ${x} ${bottom - r}`,
    `q 0 ${r} ${arm} ${r}`,
  ].join(" ");
}

/** Straight run from a parent's right edge into the tip of its brace. */
export function braceStem(brace: Brace): string {
  return `M ${brace.parentX} ${brace.parentY} L ${brace.x - 14} ${brace.parentY}`;
}

/** Every ancestor id of a node, root first — used to auto-open a search hit. */
export function ancestorsOf(root: TreeNode, id: string): string[] {
  const walk = (node: TreeNode, trail: string[]): string[] | null => {
    if (node.id === id) return trail;
    for (const child of node.children) {
      const found = walk(child, [...trail, node.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []) ?? [];
}

export function flattenTree(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (node: TreeNode) => {
    out.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return out;
}
