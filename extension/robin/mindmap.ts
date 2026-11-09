import { normalizeUrl } from "./links.ts";
import type { MindmapExplanationSummary } from "./mindmap-explanation.ts";

/** Independently implemented mind-map data and edit protocol; no third-party editor code. */
export const MAX_MAP_NODES = 1000;
export const MAX_MAP_DEPTH = 16;
export const MAX_MAP_LABEL_CHARS = 60_000;
export const MAX_MAP_LINK_CHARS = 100_000;
// Includes UTF-8 labels, 1,000 IDs, operation envelopes and the saved conversation.
export const MAX_MAP_BODY = 512_000;
export interface MindNode { id: string; label: string; children: MindNode[]; branchSide?: "left" | "right"; url?: string }
export type MindmapOperation =
  | { kind: "add"; parent: string; node: MindNode; index?: number }
  | { kind: "rename"; id: string; label: string }
  | { kind: "link"; id: string; url: string | null }
  | { kind: "move"; id: string; parent: string; index?: number }
  | { kind: "remove"; id: string; keepChildren: boolean }
  | { kind: "arrange"; id?: string; side?: "left" | "right" };
export interface MindmapMessage { role: "user" | "assistant"; text: string; revision: number }
export interface MindmapDocument {
  id: string; revision: number; root: MindNode; createdAt: string; updatedAt: string;
  messages: MindmapMessage[]; canUndo: boolean; canRedo: boolean;
  explanations: MindmapExplanationSummary[];
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
/** Resource links are navigation data only: no fetching, executable schemes or credentials. */
export function mindmapUrl(value: unknown): string {
  const text = mapText(value, 2048, "Resource URL");
  if ([...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new MindmapError("Invalid resource URL");
  let url: URL;
  try { url = new URL(normalizeUrl(text)); } catch { throw new MindmapError("Use a valid http or https resource URL"); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > 2048) throw new MindmapError("Use an http or https URL without embedded credentials (at most 2,048 characters)");
  return url.href;
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
/** Only model proposals may omit leaf children; stored trees and manual edits stay strict. */
export function validateMindTree(value: unknown, allowOmittedChildren = false): MindNode {
  const ids = new Set<string>(); let chars = 0, linkChars = 0;
  function visit(input: unknown, depth: number): MindNode {
    if (depth > MAX_MAP_DEPTH) throw new MindmapError(`Mind maps support at most ${MAX_MAP_DEPTH} levels`);
    const raw = mapObject(input); keys(raw, ["id", "label", "children", "branchSide", "url"]);
    if (raw.branchSide !== undefined && raw.branchSide !== "left" && raw.branchSide !== "right") throw new MindmapError("Invalid branch side");
    const id = nodeId(raw.id), label = mapText(raw.label, 500, "Node label");
    if (ids.has(id)) throw new MindmapError("Duplicate node ID");
    ids.add(id); chars += label.length;
    if (ids.size > MAX_MAP_NODES) throw new MindmapError(`Mind map exceeds ${MAX_MAP_NODES} nodes`, 413);
    if (chars > MAX_MAP_LABEL_CHARS) throw new MindmapError(`Mind map exceeds ${MAX_MAP_LABEL_CHARS.toLocaleString("en-US")} total label characters`, 413);
    const url = raw.url === undefined ? undefined : mindmapUrl(raw.url);
    linkChars += url?.length ?? 0;
    if (linkChars > MAX_MAP_LINK_CHARS) throw new MindmapError("Mind map exceeds 100,000 resource URL characters", 413);
    const children = allowOmittedChildren && raw.children === undefined ? [] : raw.children;
    if (!Array.isArray(children)) throw new MindmapError("Node children must be an array");
    return { id, label, children: children.map((child) => visit(child, depth + 1)), ...(raw.branchSide ? { branchSide: raw.branchSide } : {}), ...(url ? { url } : {}) };
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
/** Selected ancestors already include their descendants; translate/reparent each branch once. */
export function mindmapSelectionRoots(root: MindNode, ids: readonly string[]): MindNode[] {
  const selected = new Set(ids), result: MindNode[] = [];
  const visit = (node: MindNode) => { if (selected.has(node.id)) result.push(node); else node.children.forEach(visit); };
  visit(root); return result;
}
export function parseMapOperations(value: unknown, allowOmittedChildren = false): MindmapOperation[] {
  if (!Array.isArray(value) || value.length > 100) throw new MindmapError("Expected at most 100 mind map operations");
  return value.map((input) => {
    const op = mapObject(input);
    const index = op.index === undefined ? undefined : mapRevision(op.index);
    if (op.kind === "arrange") {
      keys(op, ["kind", "id", "side"]);
      if (op.id === undefined && op.side === undefined) return { kind: "arrange" };
      if (op.side !== "left" && op.side !== "right") throw new MindmapError("Choose left or right for a branch");
      return { kind: "arrange", id: nodeId(op.id), side: op.side };
    }
    if (op.kind === "link") { keys(op, ["kind", "id", "url"]); return { kind: "link", id: nodeId(op.id), url: op.url === null ? null : mindmapUrl(op.url) }; }
    if (op.kind === "rename") { keys(op, ["kind", "id", "label"]); return { kind: "rename", id: nodeId(op.id), label: mapText(op.label, 500, "Node label") }; }
    if (op.kind === "remove") {
      keys(op, ["kind", "id", "keepChildren"]);
      if (op.keepChildren !== undefined && typeof op.keepChildren !== "boolean") throw new MindmapError("Invalid keepChildren flag");
      return { kind: "remove", id: nodeId(op.id), keepChildren: op.keepChildren === true };
    }
    if (op.kind === "move") { keys(op, ["kind", "id", "parent", "index"]); return { kind: "move", id: nodeId(op.id), parent: nodeId(op.parent), ...(index !== undefined ? { index } : {}) }; }
    if (op.kind === "add") { keys(op, ["kind", "parent", "node", "index"]); return { kind: "add", parent: nodeId(op.parent), node: validateMindTree(op.node, allowOmittedChildren), ...(index !== undefined ? { index } : {}) }; }
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
    if (op.kind === "arrange") {
      if (op.id && !root.children.some((node) => node.id === op.id)) throw new MindmapError("Arrange a main branch directly under the root");
      // Balance largest branches first, but never reorder topics or change their hierarchy.
      const weighted = root.children.map((node) => ({ node, weight: flattenMindTree(node).length })).sort((a, b) => b.weight - a.weight);
      const totals = { left: 0, right: 0 };
      if (op.id) { const pinned = weighted.find(({ node }) => node.id === op.id)!; pinned.node.branchSide = op.side; totals[op.side!] += pinned.weight; }
      for (const { node, weight } of weighted) {
        if (node.id === op.id) continue;
        const side = totals.right <= totals.left ? "right" : "left";
        node.branchSide = side; totals[side] += weight;
      }
      continue;
    }
    if (op.kind === "link") { const node = get(op.id); if (op.url === null) delete node.url; else node.url = op.url; continue; }
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
export function parseMindmapProposal(reply: string, root: MindNode, discussion: boolean, replyLimit = 6000): MindmapProposal {
  if (reply.length > MAX_MAP_BODY) throw new MindmapError("Model response is too large", 502);
  let raw: Record<string, unknown>;
  try { raw = mapObject(JSON.parse(reply.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1"))); }
  catch { throw new MindmapError("The model did not return a complete mind map proposal. Nothing was changed.", 502); }
  keys(raw, ["reply", "operations"]);
  const result = { reply: mapText(raw.reply, replyLimit, "Reply"), operations: parseMapOperations(raw.operations, true) };
  if (discussion && result.operations.length) throw new MindmapError("Discussion mode cannot modify the mind map", 502);
  applyMindmapOperations(root, result.operations);
  return result;
}
export function mindmapMarkdown(root: MindNode): string {
  const escape = (text: string) => text.replace(/\r?\n/g, " ").replace(/[\\`*_{}\[\]<>#]/g, "\\$&");
  const label = (node: MindNode) => node.url ? `[${escape(node.label)}](<${node.url.replace(/[<>\\]/g, encodeURIComponent)}>)` : escape(node.label);
  const lines = [`# ${label(root)}`, ""];
  const visit = (node: MindNode, depth: number) => { lines.push(`${"  ".repeat(depth)}- ${label(node)}`); node.children.forEach((child) => visit(child, depth + 1)); };
  root.children.forEach((child) => visit(child, 0));
  return lines.join("\n") + "\n";
}
