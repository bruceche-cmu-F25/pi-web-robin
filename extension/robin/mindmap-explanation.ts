import { findMindNode, flattenMindTree, MindmapError, type MindNode } from "./mindmap.ts";

export const MAX_EXPLANATION_CHARS = 12_000;
export interface MindmapExplanation {
  nodeId: string; title: string; markdown: string; sourceHash: string;
  sourceRevision: number; generatedAt: string;
}
export interface MindmapExplanationSummary extends Omit<MindmapExplanation, "markdown" | "sourceHash"> {
  stale: boolean; missing: boolean;
}
export interface MindmapExplanationView {
  explanation: (MindmapExplanation & { stale: boolean; missing: boolean }) | null;
  node: { id: string; label: string } | null;
  revision: number;
  explanations: MindmapExplanationSummary[];
}

/** Exactly the context used for generation and freshness: no layout or unrelated deep branches. */
export function mindmapExplanationSource(root: MindNode, id: string) {
  const node = findMindNode(root, id);
  if (!node) throw new MindmapError("Explanation node no longer exists", 404);
  const topic = (item: MindNode) => ({ id: item.id, label: item.label, url: item.url ?? null });
  type Branch = ReturnType<typeof topic> & { children: Branch[] };
  const branch = (item: MindNode): Branch => ({ ...topic(item), children: item.children.map(branch) });
  const parent = flattenMindTree(root).find((item) => item.children.some((child) => child.id === id));
  return { branch: branch(node), parent: parent ? topic(parent) : null, siblings: parent ? parent.children.filter((child) => child.id !== id).map(topic) : [] };
}
