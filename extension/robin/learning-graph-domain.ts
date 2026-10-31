import { browseVault, readVaultNote } from "./obsidian-browser-domain.ts";
import { ObsidianError } from "./obsidian-domain.ts";
import type { LearningGraph, LearningGraphNode } from "./learning-graph.ts";

const types = new Set(["topic", "subtopic", "title", "label", "paragraph", "section", "horizontal", "vertical", "button", "linksgroup"]);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100_000;
const safeUrl = (value: unknown): value is string => typeof value === "string" && value.length <= 2048 && /^https?:\/\/[^\s]+$/i.test(value);
function invalid(): never { throw new ObsidianError("Invalid roadmap document; check its roadmap-graph block", 422); }

/** Only a small, validated schema leaves the server. Note content is never instructions, HTML or CSS. */
export function parseLearningGraph(markdown: string): LearningGraph {
  const blocks = [...markdown.matchAll(/^```roadmap-graph\s*\r?\n([\s\S]*?)^```\s*$/gm)];
  if (blocks.length !== 1) invalid();
  let raw;
  try { raw = JSON.parse(blocks[0][1]); } catch { invalid(); }
  if (!raw || raw.version !== 1 || !id(raw.id) || !text(raw.title, 200) || !raw.title.trim() || !safeUrl(raw.source)
    || !text(raw.retrievedOn, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.retrievedOn)
    || !Array.isArray(raw.nodes) || raw.nodes.length < 1 || raw.nodes.length > 1000
    || !Array.isArray(raw.edges) || raw.edges.length > 3000) invalid();
  const ids = new Set<string>();
  const nodes: LearningGraphNode[] = raw.nodes.map((n: LearningGraphNode) => {
    if (!n || !id(n.id) || ids.has(n.id) || !types.has(n.type) || !text(n.label, 4000)
      || ![n.x, n.y, n.width, n.height].every(number) || n.width <= 0 || n.height <= 0
      || (n.fontSize !== undefined && (!number(n.fontSize) || n.fontSize < 10 || n.fontSize > 64))
      || (n.align !== undefined && !["left", "center", "right"].includes(n.align))
      || (n.dashed !== undefined && typeof n.dashed !== "boolean")
      || (n.href !== undefined && !safeUrl(n.href))) invalid();
    ids.add(n.id);
    return { id: n.id, type: n.type, label: n.label, x: n.x, y: n.y, width: n.width, height: n.height,
      fontSize: n.fontSize, align: n.align, dashed: n.dashed, href: n.href };
  });
  const edgeIds = new Set<string>();
  const edges = raw.edges.map((e: LearningGraph["edges"][number]) => {
    if (!e || !id(e.id) || edgeIds.has(e.id) || !ids.has(e.source) || !ids.has(e.target)
      || !/^[wxyz][12]$/.test(e.sourceHandle) || !/^[wxyz][12]$/.test(e.targetHandle)
      || (e.dashed !== undefined && typeof e.dashed !== "boolean")) invalid();
    edgeIds.add(e.id);
    return { id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, dashed: e.dashed };
  });
  // Explicit IDs, not fuzzy title matches. Duplicate names remain distinct nodes.
  // Ignore markers inside code fences so examples cannot accidentally become lessons.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lines = markdown.replace(blocks[0][0], "").split(/\r?\n/);
  const seen = new Set<string>();
  let current: LearningGraphNode | undefined, fence = "", body: string[] = [];
  const finish = () => { if (current) current.content = body.join("\n").trim().replace(/^##[^\n]*\n+/, ""); body = []; };
  for (const line of lines) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = "";
      body.push(line); continue;
    }
    const marker = !fence && /^<!-- roadmap-node: ([A-Za-z0-9_-]+) -->$/.exec(line);
    if (marker) {
      finish(); current = byId.get(marker[1]);
      if (!current || seen.has(marker[1])) invalid();
      seen.add(marker[1]);
    } else body.push(line);
  }
  finish();
  return { id: raw.id, title: raw.title, source: raw.source, retrievedOn: raw.retrievedOn, nodes, edges };
}

export async function learningGraphCatalog(vaultId: string) {
  const index = await browseVault(vaultId);
  return { ...index, notes: index.notes.filter((n) => /\.roadmap\.md$/i.test(n.path)).map((n) => ({
    path: n.path, title: n.title.replace(/\.roadmap$/i, "").replace(/^\d+\s*-\s*/, ""), modified: n.modified,
  })) };
}
export async function learningGraphNote(vaultId: string, path: string) {
  if (!/\.roadmap\.md$/i.test(path)) throw new ObsidianError("Choose a .roadmap.md document", 400);
  const note = await readVaultNote(vaultId, path);
  return { graph: parseLearningGraph(note.content), note: { path: note.path, modified: note.modified, url: note.url } };
}
