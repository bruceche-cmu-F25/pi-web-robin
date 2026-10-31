/** Independently implemented mind-map data and edit protocol; no third-party editor code. */
export const MAX_MAP_NODES = 300;
export const MAX_MAP_DEPTH = 16;
export const MAX_MAP_BODY = 256_000;
export interface MindNode { id: string; label: string; children: MindNode[] }
export type MindmapOperation =
  | { kind: "add"; parent: string; node: MindNode; index?: number }
  | { kind: "rename"; id: string; label: string }
  | { kind: "move"; id: string; parent: string; index?: number }
  | { kind: "remove"; id: string; keepChildren: boolean };
export interface MindmapMessage { role: "user" | "assistant"; text: string; revision: number }
export interface MindmapDocument {
  id: string; revision: number; root: MindNode; createdAt: string; updatedAt: string;
  messages: MindmapMessage[]; canUndo: boolean; canRedo: boolean;
}
export interface MindmapSummary { id: string; title: string; updatedAt: string }
export interface MindmapProposal { reply: string; operations: MindmapOperation[] }
export class MindmapError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function mapObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MindmapError("Expected a mind map object");
  return value as Record<string, unknown>;
}
export function mapText(value: unknown, max: number, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new MindmapError(`${name} must contain 1–${max} characters`);
  return value.trim();
}
export function nodeId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new MindmapError("Invalid node ID");
  return value;
}
export function mapRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new MindmapError("Invalid mind map revision");
  return value as number;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new MindmapError("Unsupported mind map field");
}
export function validateMindTree(value: unknown): MindNode {
  const ids = new Set<string>(); let chars = 0;
  function visit(input: unknown, depth: number): MindNode {
    if (depth > MAX_MAP_DEPTH) throw new MindmapError(`Mind maps support at most ${MAX_MAP_DEPTH} levels`);
    const raw = mapObject(input); keys(raw, ["id", "label", "children"]);
    const id = nodeId(raw.id), label = mapText(raw.label, 500, "Node label");
    if (ids.has(id)) throw new MindmapError("Duplicate node ID");
    ids.add(id); chars += label.length;
    if (ids.size > MAX_MAP_NODES || chars > 60_000) throw new MindmapError(`Mind map exceeds ${MAX_MAP_NODES} nodes or 60,000 label characters`, 413);
    if (!Array.isArray(raw.children)) throw new MindmapError("Node children must be an array");
    return { id, label, children: raw.children.map((child) => visit(child, depth + 1)) };
  }
  return visit(value, 1);
}
export function flattenMindTree(root: MindNode): MindNode[] {
  return [root, ...root.children.flatMap(flattenMindTree)];
}
export function findMindNode(root: MindNode, id: string): MindNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) { const found = findMindNode(child, id); if (found) return found; }
}
export function parseMapOperations(value: unknown): MindmapOperation[] {
  if (!Array.isArray(value) || value.length > 100) throw new MindmapError("Expected at most 100 mind map operations");
  return value.map((input) => {
    const op = mapObject(input);
    const index = op.index === undefined ? undefined : mapRevision(op.index);
    if (op.kind === "rename") { keys(op, ["kind", "id", "label"]); return { kind: "rename", id: nodeId(op.id), label: mapText(op.label, 500, "Node label") }; }
    if (op.kind === "remove") {
      keys(op, ["kind", "id", "keepChildren"]);
      if (op.keepChildren !== undefined && typeof op.keepChildren !== "boolean") throw new MindmapError("Invalid keepChildren flag");
      return { kind: "remove", id: nodeId(op.id), keepChildren: op.keepChildren === true };
    }
    if (op.kind === "move") { keys(op, ["kind", "id", "parent", "index"]); return { kind: "move", id: nodeId(op.id), parent: nodeId(op.parent), ...(index !== undefined ? { index } : {}) }; }
    if (op.kind === "add") { keys(op, ["kind", "parent", "node", "index"]); return { kind: "add", parent: nodeId(op.parent), node: validateMindTree(op.node), ...(index !== undefined ? { index } : {}) }; }
    throw new MindmapError("Unsupported mind map operation");
  });
}
/** Validate the entire batch on a copy. One bad operation commits nothing. */
export function applyMindmapOperations(original: MindNode, input: unknown): MindNode {
  const root = validateMindTree(original), operations = parseMapOperations(input);
  const get = (id: string) => { const node = findMindNode(root, id); if (!node) throw new MindmapError(`Node not found: ${id}`); return node; };
  const parentOf = (id: string): MindNode => {
    const parent = flattenMindTree(root).find((n) => n.children.some((c) => c.id === id));
    if (!parent) throw new MindmapError("The root cannot be moved or removed");
    return parent;
  };
  const insert = (parent: MindNode, node: MindNode, index = parent.children.length) => {
    if (index > parent.children.length) throw new MindmapError("Node position is outside its parent");
    parent.children.splice(index, 0, node);
  };
  for (const op of operations) {
    if (op.kind === "rename") { get(op.id).label = op.label; continue; }
    if (op.kind === "add") {
      for (const node of flattenMindTree(op.node)) if (findMindNode(root, node.id)) throw new MindmapError("Duplicate node ID");
      insert(get(op.parent), op.node, op.index);
    } else if (op.kind === "move") {
      const node = get(op.id), parent = get(op.parent), old = parentOf(op.id);
      if (findMindNode(node, parent.id)) throw new MindmapError("A branch cannot be moved into itself or a descendant");
      old.children.splice(old.children.indexOf(node), 1); insert(parent, node, op.index);
    } else {
      const node = get(op.id), parent = parentOf(op.id);
      parent.children.splice(parent.children.indexOf(node), 1, ...(op.keepChildren ? node.children : []));
    }
  }
  return validateMindTree(root);
}
export function parseMindmapProposal(reply: string, root: MindNode, discussion: boolean): MindmapProposal {
  if (reply.length > MAX_MAP_BODY) throw new MindmapError("Model response is too large", 502);
  let raw: Record<string, unknown>;
  try { raw = mapObject(JSON.parse(reply.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1"))); }
  catch { throw new MindmapError("The model did not return a complete mind map proposal. Nothing was changed.", 502); }
  keys(raw, ["reply", "operations"]);
  const result = { reply: mapText(raw.reply, 6000, "Reply"), operations: parseMapOperations(raw.operations) };
  if (discussion && result.operations.length) throw new MindmapError("Discussion mode cannot modify the mind map", 502);
  applyMindmapOperations(root, result.operations);
  return result;
}
export function mindmapMarkdown(root: MindNode): string {
  const escape = (text: string) => text.replace(/\r?\n/g, " ").replace(/[\\`*_{}\[\]<>#]/g, "\\$&");
  const lines = [`# ${escape(root.label)}`, ""];
  const visit = (node: MindNode, depth: number) => { lines.push(`${"  ".repeat(depth)}- ${escape(node.label)}`); node.children.forEach((child) => visit(child, depth + 1)); };
  root.children.forEach((child) => visit(child, 0));
  return lines.join("\n") + "\n";
}
