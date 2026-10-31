/** Client-safe projection of a user-owned .roadmap.md, not a bundled curriculum. */
export interface LearningGraphNode {
  id: string;
  type: "topic" | "subtopic" | "title" | "label" | "paragraph" | "section" | "horizontal" | "vertical" | "button" | "linksgroup";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  align?: "left" | "center" | "right";
  dashed?: boolean;
  href?: string;
  content?: string;
}
export interface LearningGraph {
  id: string;
  title: string;
  source: string;
  retrievedOn: string;
  nodes: LearningGraphNode[];
  edges: Array<{ id: string; source: string; target: string; sourceHandle: string; targetHandle: string; dashed?: boolean }>;
}
export const isKnowledgeNode = (node: LearningGraphNode) => node.type === "topic" || node.type === "subtopic";
export function graphBounds(graph: LearningGraph) {
  const left = Math.min(...graph.nodes.map((n) => n.x)) - 20;
  const top = Math.min(...graph.nodes.map((n) => n.y)) - 20;
  return { left, top, width: Math.max(...graph.nodes.map((n) => n.x + n.width)) - left + 20,
    height: Math.max(...graph.nodes.map((n) => n.y + n.height)) - top + 20 };
}
/** Snapshot paragraph rectangles can include sibling buttons, not just their text.
 * Reserve the unobstructed text band without moving any topic or changing the saved graph. */
export function graphTextLayout(graph: LearningGraph): LearningGraph {
  const obstacles = graph.nodes.filter((n) => isKnowledgeNode(n) || n.type === "button" || n.type === "label" || n.type === "title");
  return { ...graph, nodes: graph.nodes.map((n) => {
    if (n.type !== "paragraph" || !n.label.trim()) return n;
    let top = n.y, bottom = n.y + n.height;
    for (const other of obstacles) {
      if (other.x >= n.x + n.width || other.x + other.width <= n.x
        || other.y >= n.y + n.height || other.y + other.height <= n.y) continue;
      if (other.y <= n.y) top = Math.max(top, other.y + other.height + 8);
      else bottom = Math.min(bottom, other.y - 8);
    }
    // Malformed/fully occupied bands keep their source geometry rather than hiding text.
    return bottom > top ? { ...n, y: top, height: bottom - top } : n;
  }) };
}

/** Insert reading space after a complete row; never split another text box. */
export function graphCut(graph: LearningGraph, selected: LearningGraphNode) {
  let cut = selected.y + selected.height + 12;
  for (let i = 0; i < graph.nodes.length; i++) {
    const crossing = graph.nodes.filter((n) => !["section", "horizontal", "vertical"].includes(n.type) && n.y < cut && n.y + n.height > cut);
    if (!crossing.length) break;
    cut = Math.max(...crossing.map((n) => n.y + n.height)) + 12;
  }
  return cut;
}

export function graphEdgePath(a: LearningGraphNode, b: LearningGraphNode, sourceHandle: string, targetHandle: string) {
  const endpoint = (n: LearningGraphNode, handle: string) => {
    const side = handle[0];
    return side === "w" ? [n.x + n.width / 2, n.y, 0, -1] : side === "x" ? [n.x + n.width / 2, n.y + n.height, 0, 1]
      : side === "y" ? [n.x, n.y + n.height / 2, -1, 0] : [n.x + n.width, n.y + n.height / 2, 1, 0];
  };
  const [x, y, dx, dy] = endpoint(a, sourceHandle), [xx, yy, ddx, ddy] = endpoint(b, targetHandle);
  const distance = Math.max(30, Math.min(160, Math.hypot(xx - x, yy - y) / 2));
  return `M ${x} ${y} C ${x + dx * distance} ${y + dy * distance}, ${xx + ddx * distance} ${yy + ddy * distance}, ${xx} ${yy}`;
}
