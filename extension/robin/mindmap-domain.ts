import { createHash } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { dataPath, readJsonObject, updateJsonObject, withFileLock } from "./paths.ts";
import { applyMindmapOperations, findMindNode, mapObject, mapRevision, mapText, MAX_MAP_NODES, MindmapError, nodeId, validateMindTree, type MindNode, type MindmapDocument, type MindmapMessage, type MindmapSummary } from "./mindmap.ts";
import { MAX_EXPLANATION_CHARS, mindmapExplanationSource, type MindmapExplanation, type MindmapExplanationSummary, type MindmapExplanationView } from "./mindmap-explanation.ts";

interface StoredMap {
  version: 1; id: string; revision: number; root: MindNode; createdAt: string; updatedAt: string;
  messages: MindmapMessage[]; undo: MindNode[]; redo: MindNode[];
  initialHash: string; receipts: { id: string; hash: string }[];
  // Optional for existing v1 files. Separate from tree undo and the bounded chat history.
  explanations?: MindmapExplanation[];
}
const HISTORY = 20;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new MindmapError("Invalid mind map/request ID");
  return value;
}
const filename = (id: unknown) => `mindmaps/${uuid(id)}.json`;
function stored(value: StoredMap | null): StoredMap {
  if (!value) throw new MindmapError("Mind map not found", 404);
  if (value.version !== 1 || !Array.isArray(value.undo) || !Array.isArray(value.redo) || !Array.isArray(value.messages) || !Array.isArray(value.receipts)) throw new MindmapError("Unsupported or damaged mind map file", 500);
  validateMindTree(value.root); mapRevision(value.revision);
  if (value.explanations !== undefined) {
    try {
      if (!Array.isArray(value.explanations) || value.explanations.length > MAX_MAP_NODES) throw new Error();
      const ids = new Set<string>();
      for (const item of value.explanations) {
        const id = nodeId(item.nodeId);
        if (ids.has(id) || typeof item.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(item.sourceHash) || typeof item.generatedAt !== "string" || !Number.isFinite(Date.parse(item.generatedAt))) throw new Error();
        ids.add(id); mapRevision(item.sourceRevision); mapText(item.title, 500, "Explanation title"); mapText(item.markdown, MAX_EXPLANATION_CHARS, "Explanation");
      }
    } catch { throw new MindmapError("Damaged mind map explanations; saved content was not changed", 500); }
  }
  return value;
}
export function mindmapExplanationHash(root: MindNode, id: string): string { return hash(mindmapExplanationSource(root, id)); }
function explanations(value: StoredMap): MindmapExplanationSummary[] {
  return (value.explanations ?? []).map((item) => {
    const node = findMindNode(value.root, item.nodeId);
    return { nodeId: item.nodeId, title: node?.label ?? item.title, sourceRevision: item.sourceRevision, generatedAt: item.generatedAt, missing: !node, stale: !node || item.sourceHash !== mindmapExplanationHash(value.root, item.nodeId) };
  }).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}
function view(value: StoredMap): MindmapDocument {
  return { id: value.id, revision: value.revision, root: value.root, createdAt: value.createdAt, updatedAt: value.updatedAt, messages: value.messages, canUndo: !!value.undo.length, canRedo: !!value.redo.length, explanations: explanations(value) };
}
/** Bodies load on demand; ordinary canvas reads only transfer the saved-document index. */
export function readMindmapExplanation(id: unknown, target: unknown): MindmapExplanationView {
  const current = stored(readJsonObject<StoredMap>(filename(id))), targetId = nodeId(target);
  const items = explanations(current), summary = items.find((item) => item.nodeId === targetId);
  const item = current.explanations?.find((item) => item.nodeId === targetId), node = findMindNode(current.root, targetId);
  return { explanation: item && summary ? { ...item, stale: summary.stale, missing: summary.missing } : null, node: node ? { id: node.id, label: node.label } : null, revision: current.revision, explanations: items };
}
export function readMindmap(id: unknown): MindmapDocument { return view(stored(readJsonObject<StoredMap>(filename(id)))); }
export function listMindmaps(): MindmapSummary[] {
  let names: string[];
  try { names = readdirSync(dataPath("mindmaps")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return names.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name)).map((name) => {
    const doc = stored(readJsonObject<StoredMap>(filename(name.slice(0, -5))));
    return { id: doc.id, title: doc.root.label, updatedAt: doc.updatedAt };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
/** Client-generated document ID makes retrying an uncertain create safe. */
export function createMindmap(id: unknown, input: unknown): MindmapDocument {
  const file = filename(id), root = validateMindTree(input), initialHash = hash(root);
  return updateJsonObject<StoredMap, MindmapDocument>(file, (previous) => {
    if (previous) {
      const current = stored(previous);
      if (current.initialHash !== initialHash) throw new MindmapError("This ID already belongs to another mind map", 409);
      return { value: current, result: view(current), changed: false };
    }
    const now = new Date().toISOString();
    const value: StoredMap = { version: 1, id: uuid(id), root, revision: 0, createdAt: now, updatedAt: now, messages: [], undo: [], redo: [], initialHash, receipts: [] };
    return { value, result: view(value), changed: true };
  });
}
/** One compare-and-swap publishes the complete batch, history and conversation together. */
export function mutateMindmap(input: unknown): MindmapDocument {
  const body = mapObject(input), file = filename(body.id), revision = mapRevision(body.revision), requestId = uuid(body.requestId);
  if (!["edit", "undo", "redo", "explain"].includes(String(body.action))) throw new MindmapError("Unsupported mind map action");
  const signature = hash({ revision, action: body.action, operations: body.operations, conversation: body.conversation, nodeId: body.nodeId, sourceHash: body.sourceHash, markdown: body.markdown });
  return updateJsonObject<StoredMap, MindmapDocument>(file, (previous) => {
    const current = stored(previous), receipt = current.receipts.find((item) => item.id === requestId);
    if (receipt) {
      if (receipt.hash !== signature) throw new MindmapError("Request ID was reused for a different edit", 409);
      return { value: current, result: view(current), changed: false };
    }
    if (current.revision !== revision) throw new MindmapError("This map changed since the request began. Reload the saved map before trying again; newer edits were not overwritten.", 409);
    let root = current.root, undo = current.undo, redo = current.redo, saved = current.explanations;
    if (body.action === "explain") {
      if (body.operations !== undefined || body.conversation !== undefined) throw new MindmapError("Saving an explanation cannot edit the map or conversation");
      const target = nodeId(body.nodeId), node = findMindNode(root, target);
      if (!node) throw new MindmapError("Explanation node no longer exists", 409);
      const sourceHash = mindmapExplanationHash(root, target);
      if (body.sourceHash !== sourceHash) throw new MindmapError("Explanation source changed; generate again from the current branch", 409);
      const item: MindmapExplanation = { nodeId: target, title: node.label, markdown: mapText(body.markdown, MAX_EXPLANATION_CHARS, "Explanation"), sourceHash, sourceRevision: revision, generatedAt: new Date().toISOString() };
      saved = [...(saved ?? []).filter((entry) => entry.nodeId !== target), item];
      if (saved.length > MAX_MAP_NODES) throw new MindmapError(`A map can save at most ${MAX_MAP_NODES} node explanations`, 413);
    } else if (body.action === "edit") {
      root = applyMindmapOperations(current.root, body.operations);
      if (JSON.stringify(root) !== JSON.stringify(current.root)) { undo = [...undo, current.root].slice(-HISTORY); redo = []; }
    } else {
      if (body.operations !== undefined || body.conversation !== undefined) throw new MindmapError("History actions cannot also edit content");
      const stack = body.action === "undo" ? undo : redo;
      if (!stack.length) throw new MindmapError("No history to restore");
      root = validateMindTree(stack.at(-1));
      if (body.action === "undo") { undo = undo.slice(0, -1); redo = [...redo, current.root].slice(-HISTORY); }
      else { redo = redo.slice(0, -1); undo = [...undo, current.root].slice(-HISTORY); }
    }
    const nextRevision = current.revision + 1;
    let messages = current.messages;
    if (body.conversation !== undefined) {
      const conversation = mapObject(body.conversation);
      const user = mapText(conversation.user, 8000, "Message"), reply = mapText(conversation.reply, 6000, "Reply");
      messages = [...messages, { role: "user" as const, text: user, revision: nextRevision }, { role: "assistant" as const, text: reply, revision: nextRevision }].slice(-24);
    }
    const value: StoredMap = { ...current, ...(saved ? { explanations: saved } : {}), root, undo, redo, messages, revision: nextRevision, updatedAt: new Date().toISOString(), receipts: [...current.receipts, { id: requestId, hash: signature }].slice(-50) };
    return { value, result: view(value), changed: true };
  });
}
export function deleteMindmap(id: unknown, revision: unknown) {
  const file = filename(id), expected = mapRevision(revision);
  withFileLock(dataPath(file), () => {
    if (readMindmap(id).revision !== expected) throw new MindmapError("Mind map changed; reload before deleting", 409);
    rmSync(dataPath(file));
  });
}
