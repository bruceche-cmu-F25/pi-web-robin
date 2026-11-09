import { mindmapSelectionRoots, mindmapUrl, type MindNode } from "../../extension/robin/mindmap.ts";
import { splitReplyLinks } from "./reply-links.ts";
export type { MindNode } from "../../extension/robin/mindmap.ts";
/** Markdown import creates a copy; no existing note is changed or kept in sync. */
export interface PositionedMindNode extends MindNode { x: number; y: number; width: number; height: number; tone: number; depth: number; side: number; lines: string[]; topicHeight: number; links: { label: string; url: string }[] }
export interface MindmapCamera { x: number; y: number; zoom: number }
/** Original nodes from document root to the focus; missing/deleted targets return the whole map. */
export function mindmapPath(root: MindNode, id: string | null): MindNode[] {
  if (!id || root.id === id) return [root];
  for (const child of root.children) {
    const path = mindmapPath(child, id);
    if (path.at(-1)?.id === id) return [root, ...path];
  }
  return [root];
}
/** View-only offsets, relative to the automatic layout and inherited by descendants. */
export type MindmapOffsets = Record<string, { x: number; y: number; parent: string | null }>;
export function readMindmapOffsets(value: unknown, root: MindNode): MindmapOffsets {
  const result: MindmapOffsets = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const visit = (node: MindNode, parent: string | null) => {
    const point = Object.hasOwn(value, node.id) ? (value as Record<string, unknown>)[node.id] : null;
    if (point && typeof point === "object" && "x" in point && "y" in point && "parent" in point
      && typeof point.x === "number" && typeof point.y === "number" && Number.isFinite(point.x) && Number.isFinite(point.y)
      && Math.abs(point.x) <= 100_000 && Math.abs(point.y) <= 100_000 && point.parent === parent) {
      Object.defineProperty(result, node.id, { value: { x: point.x, y: point.y, parent }, enumerable: true, configurable: true, writable: true });
    }
    node.children.forEach((child) => visit(child, node.id));
  };
  visit(root, null); return result;
}
export function translateMindmapSelection(root: MindNode, ids: readonly string[], offsets: MindmapOffsets, dx: number, dy: number): MindmapOffsets {
  const next = readMindmapOffsets(offsets, root), parents = new Map<string, string | null>();
  const visit = (node: MindNode, parent: string | null) => { parents.set(node.id, parent); node.children.forEach((child) => visit(child, node.id)); };
  visit(root, null);
  for (const node of mindmapSelectionRoots(root, ids)) {
    const before = Object.hasOwn(next, node.id) ? next[node.id] : { x: 0, y: 0, parent: parents.get(node.id)! };
    Object.defineProperty(next, node.id, { value: { ...before, x: Math.max(-100_000, Math.min(100_000, before.x + dx)), y: Math.max(-100_000, Math.min(100_000, before.y + dy)) }, enumerable: true, configurable: true, writable: true });
  }
  return next;
}
export function positionMindmap(layout: ReturnType<typeof layoutMindmap>, offsets: MindmapOffsets) {
  const inherited = new Map<string, { x: number; y: number }>();
  const parents = new Map(layout.edges.map((edge) => [edge.to.id, edge.from.id]));
  const nodes = layout.nodes.map((node) => {
    const parent = parents.get(node.id) ?? null, ancestor = parent ? inherited.get(parent) : undefined;
    const own = Object.hasOwn(offsets, node.id) && offsets[node.id].parent === parent ? offsets[node.id] : undefined;
    const point = { x: (ancestor?.x ?? 0) + (own?.x ?? 0), y: (ancestor?.y ?? 0) + (own?.y ?? 0) };
    inherited.set(node.id, point);
    return { ...node, x: node.x + point.x, y: node.y + point.y };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = layout.edges.map((edge) => {
    const from = byId.get(edge.from.id)!, to = byId.get(edge.to.id)!;
    // Both connector anchors and outward controls follow the positioned geometry.
    const side = Math.sign((to.x + to.width / 2) - (from.x + from.width / 2)) || edge.side;
    to.side = side;
    return { ...edge, from, to, side };
  });
  const left = Math.min(...nodes.map((n) => n.x)) - 48, top = Math.min(...nodes.map((n) => n.y)) - 48;
  return { nodes, edges,
    left, top, width: Math.max(...nodes.map((n) => n.x + n.width)) + 48 - left, height: Math.max(...nodes.map((n) => n.y + n.height)) + 48 - top };
}
/** Packed siblings share a clear centre corridor, then turn in the target column's gutter. */
export function mindmapEdgePath({ from, to, side, packed }: ReturnType<typeof layoutMindmap>["edges"][number]) {
  const x1 = from.x + (side > 0 ? from.width : 0), y1 = from.y + from.topicHeight / 2;
  const x2 = to.x + (side > 0 ? 0 : to.width), y2 = to.y + to.topicHeight / 2;
  const distance = (x2 - x1) * side;
  if ((!packed && (from.depth !== 0 || distance <= 72)) || distance < 72) return `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
  const gutter = from.depth === 0 && !packed ? x1 + side * 36 : x2 - side * 36;
  const direction = Math.sign(y2 - y1), radius = Math.min(12, Math.abs(y2 - y1) / 2);
  return `M ${x1} ${y1} H ${gutter - side * radius} Q ${gutter} ${y1}, ${gutter} ${y1 + direction * radius} V ${y2 - direction * radius} Q ${gutter} ${y2}, ${gutter + side * radius} ${y2} H ${x2}`;
}
/** Keep the canvas point under the pointer fixed while zooming. */
export function zoomMindmap(camera: MindmapCamera, zoom: number, x: number, y: number): MindmapCamera {
  const next = Math.max(0.08, Math.min(2.5, zoom));
  return { x: x - (x - camera.x) * next / camera.zoom, y: y - (y - camera.y) * next / camera.zoom, zoom: next };
}
export function fitMindmap(width: number, height: number, availableWidth: number, availableHeight: number): MindmapCamera {
  const zoom = Math.max(0.08, Math.min(1, Math.max(1, availableWidth - 96) / width, Math.max(1, availableHeight - 180) / height));
  return { x: (availableWidth - width * zoom) / 2, y: (availableHeight - height * zoom) / 2, zoom };
}
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

/** Recognize existing text URLs without rewriting saved labels or adding permissions. */
export function mindmapResources(node: MindNode) {
  const links = new Map<string, { label: string; url: string }>();
  if (node.url) { try { const url = mindmapUrl(node.url); links.set(url, { label: new URL(url).hostname, url }); } catch { /* Never render an unsafe href. */ } }
  const segments = splitReplyLinks(node.label);
  let text = "";
  for (const [index, segment] of segments.entries()) {
    if (segment.type === "text") { text += segment.value; continue; }
    let url: string;
    try { url = mindmapUrl(segment.href); } catch { text += segment.value; continue; }
    let label = new URL(url).hostname;
    const markdown = /\[([^\]\n]+)\]\($/.exec(text), next = segments[index + 1];
    if (markdown && next?.type === "text" && next.value.startsWith(")")) {
      label = markdown[1]; text = text.slice(0, -markdown[0].length) + label; next.value = next.value.slice(1);
    } else if (text.endsWith("<") && next?.type === "text" && next.value.startsWith(">")) {
      text = text.slice(0, -1) + label; next.value = next.value.slice(1);
    } else text += label;
    if (!links.has(url)) links.set(url, { label, url });
  }
  return { text, links: [...links.values()] };
}

function labelLines(label: string) {
  const chars = Array.from(label.replace(/\s+/g, " "));
  const display = chars.length > 120 ? [...chars.slice(0, 119), "…"] : chars;
  const lines: string[] = [];
  let line = "", width = 0;
  for (const char of display) {
    const size = /[MW@%]/.test(char) ? 1 : /[\u0020-\u007e]/.test(char) ? 0.7 : 1;
    if (width + size > 18) { lines.push(line); line = ""; width = 0; }
    line += char; width += size;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** A view-only outline level; descendants are hidden, never removed from the document. */
export function mindmapFolds(root: MindNode, depth: number): ReadonlySet<string> {
  const folded = new Set<string>();
  const visit = (node: MindNode, level: number) => {
    if (level >= depth && node.children.length) folded.add(node.id);
    node.children.forEach((child) => visit(child, level + 1));
  };
  visit(root, 0); return folded;
}
export function layoutMindmap(root: MindNode, collapsed: ReadonlySet<string>) {
  const nodes: PositionedMindNode[] = [];
  const edges: { from: PositionedMindNode; to: PositionedMindNode; side: number; packed: boolean }[] = [];
  const visible = (node: MindNode) => collapsed.has(node.id) ? [] : node.children;
  const contents = new Map<string, { lines: string[]; topicHeight: number; links: { label: string; url: string }[] }>();
  const content = (node: MindNode) => {
    if (!contents.has(node.id)) {
      const { text, links } = mindmapResources(node), lines = labelLines(text);
      contents.set(node.id, { lines, topicHeight: Math.max(48, lines.length * 22 + 20), links });
    }
    return contents.get(node.id)!;
  };
  const ownHeight = (node: MindNode) => content(node).topicHeight + content(node).links.length * 44;
  const ownWidth = (node: MindNode) => Math.max(node.id === root.id || content(node).links.length ? 180 : 100, Math.min(346, Math.max(...content(node).lines.map((line) => Array.from(line).reduce((sum, c) => sum + (/[\u0020-\u007e]/.test(c) ? 9 : 17), 0))) + 40));
  // Allocate a roughly square canvas by visible content, not by leaf count alone.
  // Long labels and resource rows participate in both packing and collision bounds.
  const areas = new Map<string, number>();
  const measure = (node: MindNode): number => {
    const area = (ownWidth(node) + 72) * (ownHeight(node) + 20) + visible(node).reduce((sum, child) => sum + measure(child), 0);
    areas.set(node.id, area); return area;
  };
  const targetHeight = Math.sqrt(measure(root) * 1.5);
  type Box = { node: MindNode; width: number; height: number; rootY: number; children: Placement[] };
  type Placement = { box: Box; x: number; y: number; packed: boolean };
  const pack = (boxes: Box[], budget: number, columnCount?: number): Placement[] => {
    if (!boxes.length) return [];
    const total = boxes.reduce((sum, box) => sum + box.height + 20, 0);
    const columns = columnCount ?? Math.min(Math.ceil(Math.sqrt(boxes.length)), Math.max(1, Math.ceil(total / budget)));
    const groups: Box[][] = [[]];
    let height = 0;
    for (const box of boxes) {
      if (height && height + box.height / 2 > total / columns && groups.length < columns) { groups.push([]); height = 0; }
      groups.at(-1)!.push(box); height += box.height + 20;
    }
    const result: Placement[] = [];
    let x = 0;
    for (const group of groups) {
      const span = group.reduce((sum, box) => sum + box.height + 20, -20);
      // Multiple columns share an empty horizontal corridor through the parent.
      // Keep whole subtrees above/below it, so distant connectors never cross labels.
      let split = 0, upper = 0;
      if (groups.length > 1) {
        while (split < group.length && upper < span / 2) { upper += group[split++].height + 20; }
      }
      let y = groups.length > 1 ? -upper - 20 : -span / 2;
      group.forEach((box, index) => {
        if (groups.length > 1 && index === split) y = 40;
        result.push({ box, x, y, packed: groups.length > 1 }); y += box.height + 20;
      });
      x += Math.max(...group.map((box) => box.width)) + 72;
    }
    return result;
  };
  const build = (node: MindNode, budget: number): Box => {
    const children = pack(visible(node).map((child) => build(child, budget)), budget);
    const top = Math.min(-content(node).topicHeight / 2, ...children.map((child) => child.y));
    const bottom = Math.max(ownHeight(node) - content(node).topicHeight / 2, ...children.map((child) => child.y + child.box.height));
    return { node, rootY: -top - content(node).topicHeight / 2, height: bottom - top,
      width: ownWidth(node) + (children.length ? 72 + Math.max(...children.map((child) => child.x + child.box.width)) : 0),
      children: children.map((child) => ({ ...child, x: child.x + ownWidth(node) + 72, y: child.y - top })) };
  };
  const centre: PositionedMindNode = { ...root, x: -ownWidth(root) / 2, y: -content(root).topicHeight / 2, width: ownWidth(root), height: ownHeight(root), ...content(root), tone: -1, depth: 0, side: 1 };
  nodes.push(centre);
  const sides: { node: MindNode; tone: number }[][] = [[], []];
  visible(root).forEach((node, tone) => {
    // Stable sides: typing or folding a branch must not reshuffle its neighbours.
    const side = node.branchSide ? (node.branchSide === "right" ? 0 : 1) : tone % 2;
    sides[side].push({ node, tone });
  });
  const place = (box: Box, parent: PositionedMindNode, depth: number, x: number, y: number, side: number, tone: number, packed: boolean) => {
    const { node } = box, width = ownWidth(node), height = ownHeight(node);
    const positioned: PositionedMindNode = { ...node, x: side > 0 ? x : -x - width, y: y + box.rootY, width, height, tone, depth, side, ...content(node) };
    nodes.push(positioned); edges.push({ from: parent, to: positioned, side, packed });
    for (const child of box.children) place(child.box, positioned, depth + 1, x + child.x, y + child.y, side, tone, child.packed);
  };
  sides.forEach((items, index) => {
    const area = items.reduce((sum, { node }) => sum + areas.get(node.id)!, 0);
    const tones = new Map(items.map(({ node, tone }) => [node.id, tone]));
    const boxes = items.map(({ node }) => build(node, Math.max(240, targetHeight * 1.4 * areas.get(node.id)! / area)));
    // Choose root columns using the actual subtree footprints; packing already-wide
    // branches again would trade one tall strip for an equally unreadable wide strip.
    let placements: Placement[] = [], best = Infinity;
    for (let columns = 1; columns <= Math.ceil(Math.sqrt(boxes.length)); columns++) {
      const candidate = pack(boxes, targetHeight, columns);
      const width = centre.width / 2 + 72 + Math.max(...candidate.map((child) => child.x + child.box.width));
      const height = Math.max(...candidate.map((child) => child.y + child.box.height)) - Math.min(...candidate.map((child) => child.y));
      const score = Math.max(width * 2, height);
      if (score < best) { best = score; placements = candidate; }
    }
    // A single ring of main branches follows a soft oval envelope: the middle
    // fans farther out, the top/bottom sit closer in. Keep small maps unchanged.
    if (placements.length >= 4 && placements.every((child) => !child.packed)) {
      const radiusX = Math.max(...boxes.map((box) => box.width)) * 1.18;
      const radiusY = Math.max(...placements.flatMap((child) => [Math.abs(child.y), Math.abs(child.y + child.box.height)]));
      for (const child of placements) {
        const y = (child.y + child.box.height / 2) / radiusY;
        child.x += Math.max(0, radiusX * Math.sqrt(Math.max(0, 1 - y * y)) - child.box.width);
      }
    }
    for (const child of placements) place(child.box, centre, 1, centre.width / 2 + 72 + child.x, child.y, index === 0 ? 1 : -1, tones.get(child.box.node.id)!, child.packed);
  });
  const left = Math.min(...nodes.map((n) => n.x)) - 48, top = Math.min(...nodes.map((n) => n.y)) - 48;
  for (const node of nodes) { node.x -= left; node.y -= top; }
  return { nodes, edges, width: Math.max(...nodes.map((n) => n.x + n.width)) + 48, height: Math.max(...nodes.map((n) => n.y + n.height)) + 48 };
}
