import type { MindNode } from "../../extension/robin/mindmap.ts";
export type { MindNode } from "../../extension/robin/mindmap.ts";
/** Markdown import creates a copy; no existing note is changed or kept in sync. */
export interface PositionedMindNode extends MindNode { x: number; y: number; width: number; height: number; tone: number; lines: string[] }
export const MINDMAP_LIMIT = 250;

export function noteMindmap(title: string, text: string) {
  const root: MindNode = { id: "root", label: title, children: [] };
  const headings: { level: number; node: MindNode }[] = [];
  const lists: { indent: number; node: MindNode }[] = [];
  let fence: { char: string; length: number } | null = null;
  let count = 0;
  let truncated = false;
  for (const [id, raw] of text.split("\n").entries()) {
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    const list = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(raw);
    if (!heading && !list) { if (raw.trim()) lists.length = 0; continue; }
    if (count++ >= MINDMAP_LIMIT) { truncated = true; break; }
    const node: MindNode = { id: `line-${id}`, label: heading ? heading[2] : list![2], children: [] };
    if (heading) {
      lists.length = 0;
      const level = heading[1].length;
      while (headings.length && headings.at(-1)!.level >= level) headings.pop();
      (headings.at(-1)?.node ?? root).children.push(node);
      headings.push({ level, node });
    } else {
      const indent = list![1].replace(/\t/g, "    ").length;
      while (lists.length && lists.at(-1)!.indent >= indent) lists.pop();
      (lists.at(-1)?.node ?? headings.at(-1)?.node ?? root).children.push(node);
      lists.push({ indent, node });
    }
  }
  return { root, truncated };
}

function labelLines(label: string) {
  const chars = Array.from(label.replace(/\s+/g, " "));
  const display = chars.length > 120 ? [...chars.slice(0, 119), "…"] : chars;
  const lines: string[] = [];
  let line = "", width = 0;
  for (const char of display) {
    const size = /[MW@%]/.test(char) ? 1 : /[\u0020-\u007e]/.test(char) ? 0.7 : 1;
    if (width + size > 12) { lines.push(line); line = ""; width = 0; }
    line += char; width += size;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function layoutMindmap(root: MindNode, collapsed: ReadonlySet<string>) {
  const nodes: PositionedMindNode[] = [];
  const edges: { from: PositionedMindNode; to: PositionedMindNode; side: number }[] = [];
  const heights = new Map<string, number>();
  const visible = (node: MindNode) => collapsed.has(node.id) ? [] : node.children;
  const ownHeight = (node: MindNode) => Math.max(48, labelLines(node.label).length * 20 + 24);
  const measure = (node: MindNode): number => {
    const children = visible(node);
    const height = Math.max(ownHeight(node), children.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, children.length - 1) * 20);
    heights.set(node.id, height);
    return height;
  };
  measure(root);
  const centre: PositionedMindNode = { ...root, x: -110, y: -ownHeight(root) / 2, width: 220, height: ownHeight(root), lines: labelLines(root.label), tone: -1 };
  nodes.push(centre);
  const sides: { node: MindNode; tone: number }[][] = [[], []];
  const totals = [0, 0];
  root.children.forEach((node, tone) => {
    const side = totals[0] <= totals[1] ? 0 : 1;
    sides[side].push({ node, tone }); totals[side] += heights.get(node.id)! + 20;
  });
  const place = (node: MindNode, parent: PositionedMindNode, depth: number, top: number, side: number, tone: number) => {
    const height = ownHeight(node), span = heights.get(node.id)!;
    const positioned: PositionedMindNode = { ...node, x: side > 0 ? 160 + (depth - 1) * 250 : -360 - (depth - 1) * 250, y: top + (span - height) / 2, width: 200, height, tone, lines: labelLines(node.label) };
    nodes.push(positioned); edges.push({ from: parent, to: positioned, side });
    const children = visible(node);
    const childHeight = children.reduce((sum, child) => sum + heights.get(child.id)!, 0) + Math.max(0, children.length - 1) * 20;
    let y = top + (span - childHeight) / 2;
    for (const child of children) { place(child, positioned, depth + 1, y, side, tone); y += heights.get(child.id)! + 20; }
  };
  sides.forEach((items, index) => {
    let y = -(totals[index] - 20) / 2;
    for (const { node, tone } of items) { place(node, centre, 1, y, index === 0 ? 1 : -1, tone); y += heights.get(node.id)! + 20; }
  });
  const left = Math.min(...nodes.map((n) => n.x)) - 48, top = Math.min(...nodes.map((n) => n.y)) - 48;
  for (const node of nodes) { node.x -= left; node.y -= top; }
  return { nodes, edges, width: Math.max(...nodes.map((n) => n.x + n.width)) + 48, height: Math.max(...nodes.map((n) => n.y + n.height)) + 48 };
}
