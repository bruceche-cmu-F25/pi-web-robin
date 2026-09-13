import type { EventColorKey } from "../../extension/robin/eventColors.ts";

/**
 * Topic families, each drawn in one of the calendar's hues — the same way the
 * Learning Hub colours its tracks — so related branches read as one colour
 * across the tree. Clay is left out: it is the light theme's accent, which
 * still marks the problem currently open.
 */
export const TOPIC_FAMILIES = [
  { id: "linear", hue: "honey" },
  { id: "search", hue: "slate" },
  { id: "trees", hue: "fern" },
  { id: "graphs", hue: "teal" },
  { id: "dp", hue: "rose" },
  { id: "greedy", hue: "sage" },
  { id: "math", hue: "plum" },
  { id: "language", hue: "iris" },
] as const satisfies readonly { id: string; hue: EventColorKey }[];
export type TopicFamily = (typeof TOPIC_FAMILIES)[number]["id"];

export function familyHue(family: TopicFamily): EventColorKey {
  return TOPIC_FAMILIES.find((candidate) => candidate.id === family)!.hue;
}

// Topic layout inspired by https://neetcode.io/roadmap (NeetCode 150).
// Edges describe a suggested learning order, never prerequisites or unlocks.
// `x` is on a 0–1000 scale so the tree stretches with its column; `label` is
// the chip text, short enough to fit one line at the narrowest tree width.
export const PRACTICE_TREE = [
  { pattern: "Arrays & Hashing", family: "linear", label: "Arrays & Hashing", x: 500, row: 0, from: [] },
  { pattern: "Two Pointers", family: "linear", label: "Two Pointers", x: 340, row: 1, from: ["Arrays & Hashing"] },
  { pattern: "Stack", family: "linear", label: "Stack", x: 660, row: 1, from: ["Arrays & Hashing"] },
  { pattern: "Binary Search", family: "search", label: "Binary Search", x: 140, row: 2, from: ["Two Pointers"] },
  { pattern: "Sliding Window", family: "linear", label: "Sliding Window", x: 340, row: 2, from: ["Two Pointers"] },
  { pattern: "Linked List", family: "search", label: "Linked List", x: 540, row: 2, from: ["Two Pointers"] },
  { pattern: "Trees", family: "trees", label: "Trees", x: 340, row: 3, from: ["Binary Search", "Linked List"] },
  { pattern: "Tries", family: "trees", label: "Tries", x: 130, row: 4, from: ["Trees"] },
  { pattern: "Heap / Priority Queue", family: "trees", label: "Heap / PQ", x: 340, row: 4, from: ["Trees"] },
  { pattern: "Backtracking", family: "graphs", label: "Backtracking", x: 700, row: 4, from: ["Trees"] },
  { pattern: "Graphs", family: "graphs", label: "Graphs", x: 600, row: 5, from: ["Backtracking"] },
  { pattern: "1-D Dynamic Programming", family: "dp", label: "1-D DP", x: 820, row: 5, from: ["Backtracking"] },
  { pattern: "Intervals", family: "greedy", label: "Intervals", x: 100, row: 6, from: ["Heap / Priority Queue"] },
  { pattern: "Greedy", family: "greedy", label: "Greedy", x: 300, row: 6, from: ["Heap / Priority Queue"] },
  { pattern: "Advanced Graphs", family: "graphs", label: "Advanced Graphs", x: 500, row: 6, from: ["Heap / Priority Queue", "Graphs"] },
  { pattern: "2-D Dynamic Programming", family: "dp", label: "2-D DP", x: 700, row: 6, from: ["Graphs", "1-D Dynamic Programming"] },
  { pattern: "Bit Manipulation", family: "math", label: "Bit Manipulation", x: 900, row: 6, from: ["1-D Dynamic Programming"] },
  { pattern: "Math & Geometry", family: "math", label: "Math & Geometry", x: 800, row: 7, from: ["2-D Dynamic Programming", "Bit Manipulation"] },
  // Only the All catalog includes this separate topic; do not invent a dependency.
  { pattern: "JavaScript", family: "language", label: "JavaScript", x: 150, row: 7, from: [] },
] as const;

export type PracticeTreeNode = (typeof PRACTICE_TREE)[number];

export const TREE_WIDTH = 1000;
export const NODE_HEIGHT = 44;
const ROW_PITCH = 76;
const PADDING = 12;
export const nodeTop = (row: number) => PADDING + row * ROW_PITCH;
export const TREE_HEIGHT = nodeTop(Math.max(...PRACTICE_TREE.map((node) => node.row))) + NODE_HEIGHT + PADDING;

/** Every topic the suggested order passes through on the way to `pattern`. */
export function ancestorsOf(pattern: string, nodes: readonly PracticeTreeNode[] = PRACTICE_TREE): Set<string> {
  const byName = new Map(nodes.map((node) => [node.pattern as string, node]));
  const seen = new Set<string>();
  const walk = (name: string) => {
    for (const parent of byName.get(name)?.from ?? []) {
      if (seen.has(parent) || !byName.has(parent)) continue;
      seen.add(parent);
      walk(parent);
    }
  };
  walk(pattern);
  return seen;
}

export type Direction = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** Spatial arrow-key movement: same row for left/right, nearest column for up/down. */
export function neighbourOf(pattern: string, direction: Direction, nodes: readonly PracticeTreeNode[]): string | null {
  const from = nodes.find((node) => node.pattern === pattern);
  if (!from) return null;
  if (direction === "ArrowLeft" || direction === "ArrowRight") {
    const row = nodes.filter((node) => node.row === from.row).sort((a, b) => a.x - b.x);
    const index = row.indexOf(from) + (direction === "ArrowRight" ? 1 : -1);
    return row[index]?.pattern ?? null;
  }
  const step = direction === "ArrowDown" ? 1 : -1;
  const rows = [...new Set(nodes.map((node) => node.row))].sort((a, b) => step * (a - b));
  const next = rows.find((row) => step * (row - from.row) > 0);
  if (next === undefined) return null;
  const candidates = nodes.filter((node) => node.row === next);
  return candidates.reduce((best, node) => Math.abs(node.x - from.x) < Math.abs(best.x - from.x) ? node : best).pattern;
}
