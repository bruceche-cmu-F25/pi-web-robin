import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { KnowledgeSource } from "../../lib/knowledge-source.ts";
import { dataPath, readJsonObject, updateJsonObject, withFileLock } from "./paths.ts";
import { recordKnowledgeArchive, resolveObsidianVault, safeObsidianName } from "./obsidian-domain.ts";

const FILE = "knowledge-proposals.json";
const MAX_FILE = 100_000;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export interface KnowledgeCandidate { id: string; title: string; path: string }
export interface KnowledgeNote {
  id: string;
  title: string;
  kind: "idea" | "decision" | "architecture" | "progress" | "summary";
  action: "create" | "append";
  path: string;
  before?: string;
  expectedHash?: string;
  markdown: string;
  saved?: boolean;
  url: string;
}
export interface KnowledgeProposal {
  id: string;
  source: Omit<KnowledgeSource, "messages"> & { entryIds: string[] };
  project: string;
  vaultId: string;
  vaultPath: string;
  hubPath: string;
  hubMarkdown: string;
  notes: KnowledgeNote[];
  createdAt: string;
  error?: string;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid knowledge note text");
  return value.trim();
}

/** Every path component stays in the chosen vault; neither scans nor writes follow symlinks. */
function vaultPath(root: string, relative: string, createParents = false): string {
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\\\p{Cc}]/u.test(part) || part.startsWith("."))) throw new Error("Unsafe vault path");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    if (!existsSync(current) && createParents) mkdirSync(current);
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Vault directories must not be symlinks");
  }
  return join(current, parts.at(-1)!);
}

function readNote(root: string, relative: string): string {
  const path = vaultPath(root, relative);
  if (!relative.endsWith(".md") || lstatSync(path).isSymbolicLink()) throw new Error("Only ordinary Markdown files can be read");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE) throw new Error("Note is too large to review safely");
    return readFileSync(fd, "utf8");
  } finally { closeSync(fd); }
}

/** A bounded title index only. No existing vault body is sent to a model. */
export function knowledgeCandidates(vaultId: string): { notes: KnowledgeCandidate[]; limited: boolean } {
  const root = resolveObsidianVault(vaultId).path;
  const notes: KnowledgeCandidate[] = [];
  const directories = [""];
  let visited = 0;
  let limited = false;
  while (directories.length && notes.length < 200 && visited < 5000) {
    const relative = directories.shift()!;
    const path = relative ? vaultPath(root, `${relative}/unused`) : root;
    for (const item of readdirSync(relative ? dirname(path) : path, { withFileTypes: true })) {
      if (++visited > 5000) { limited = true; break; }
      if (item.name.startsWith(".") || /[\\#\[\]|^\p{Cc}]/u.test(item.name) || item.isSymbolicLink()) continue;
      const child = relative ? `${relative}/${item.name}` : item.name;
      if (item.isDirectory() && item.name !== "Attachments") directories.push(child);
      else if (item.isFile() && item.name.endsWith(".md")) {
        notes.push({ id: `e-${hash(child).slice(0, 16)}`, title: basename(item.name, ".md"), path: child });
        if (notes.length === 200) { limited = true; break; }
      }
    }
  }
  return { notes, limited: limited || directories.length > 0 };
}

export function listKnowledgeProposals(sessionId: string): KnowledgeProposal[] {
  return Object.values(readJsonObject<Record<string, KnowledgeProposal>>(FILE) ?? {})
    .filter((proposal) => proposal.source.sessionId === sessionId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function findKnowledgeProposal(sessionId: string, fingerprint: string, vaultId: string, project: string): KnowledgeProposal | undefined {
  return listKnowledgeProposals(sessionId).find((proposal) => proposal.source.fingerprint === fingerprint && proposal.vaultId === vaultId && proposal.project === project.trim());
}

function wiki(path: string, title: string): string {
  return `[[${path.replace(/\.md$/, "")}|${title.replace(/[\[\]|\r\n]/g, " ")}]]`;
}

/** Model output is a bounded proposal, never a write instruction or a filesystem path. */
export function createKnowledgeProposal(input: {
  source: KnowledgeSource; project: string; vaultId: string; candidates: KnowledgeCandidate[]; reply: string; regenerate?: boolean;
}): KnowledgeProposal {
  const project = text(input.project, 120);
  const vault = resolveObsidianVault(input.vaultId);
  const raw = input.reply.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(raw) as { notes?: unknown };
  if (!Array.isArray(parsed?.notes) || parsed.notes.length < 1 || parsed.notes.length > 5) throw new Error("Expected one to five proposed notes");
  const id = randomUUID();
  const folder = `Knowledge/${safeObsidianName(project)}-${hash(project.toLowerCase()).slice(0, 8)}`;
  const hubPath = `${folder}/Project.md`;
  const candidates = new Map(input.candidates.map((note) => [note.id, note]));
  const sourceIds = new Set(input.source.messages.map((message) => message.id));
  const ids = new Set<string>();
  const appendTargets = new Set<string>();
  const proposed = parsed.notes.map((value: unknown) => {
    const note = value as Record<string, unknown> | null;
    if (!note || typeof note.id !== "string" || !/^n[1-5]$/.test(note.id) || ids.has(note.id)) throw new Error("Invalid proposal note id");
    ids.add(note.id);
    const title = text(note.title, 120);
    const content = text(note.content, 15_000);
    if (content.includes("robin-knowledge:") || content.includes("[[")) throw new Error("Use structured links, not inline wiki links, in generated notes");
    if (!["idea", "decision", "architecture", "progress", "summary"].includes(String(note.kind))) throw new Error("Invalid knowledge note kind");
    if (!Array.isArray(note.links) || note.links.length > 10 || note.links.some((link) => typeof link !== "string")) throw new Error("Invalid note links");
    if (!Array.isArray(note.sourceIds) || !note.sourceIds.length || note.sourceIds.some((entryId) => !sourceIds.has(entryId))) throw new Error("Every note needs valid conversation sources");
    const target = note.targetId === null || note.targetId === undefined ? undefined : candidates.get(String(note.targetId));
    if (note.targetId != null && !target) throw new Error("Unknown existing note target");
    if (target && appendTargets.has(target.path)) throw new Error("Combine additions to the same existing note");
    if (target) appendTargets.add(target.path);
    return { id: note.id, title, content, kind: note.kind as KnowledgeNote["kind"], links: note.links as string[], sourceIds: note.sourceIds as string[], target,
      path: target?.path ?? `${folder}/${id}/${note.id}-${safeObsidianName(title)}.md` };
  });
  const links = new Map([...input.candidates.map((note) => [note.id, note] as const), ...proposed.map((note) => [note.id, note] as const)]);
  const notes: KnowledgeNote[] = proposed.map((note) => {
    const related = note.links.map((id) => {
      const target = links.get(id);
      if (!target || id === note.id) throw new Error("Unknown or self-referential relationship");
      return wiki(target.path, target.title);
    });
    const sourceLabel = input.source.sessionName.replace(/[\[\]\\\r\n]/g, " ");
    const before = note.target ? readNote(vault.path, note.path) : undefined;
    const markdown = [
      `<!-- robin-knowledge:${id}:${note.id} -->`,
      `${note.target ? "##" : "#"} ${note.title.replace(/[\r\n]/g, " ")}`,
      `Project: ${wiki(hubPath, project)} · #knowledge/${note.kind}`,
      note.content,
      ...(related.length ? [`## Related\n${related.map((link) => `- ${link}`).join("\n")}`] : []),
      `## Source\n[${sourceLabel || "Conversation"}](${input.source.url})\n\nCaptured: ${input.source.capturedAt} · Scope: ${input.source.scope}\n\nBranch: \`${input.source.leafId}\` · Entries: ${note.sourceIds.map((id) => `\`${id}\``).join(", ")}`,
      `<!-- /robin-knowledge:${id}:${note.id} -->`,
    ].join("\n\n") + "\n";
    return { id: note.id, title: note.title, kind: note.kind, action: note.target ? "append" : "create", path: note.path,
      ...(before !== undefined ? { before, expectedHash: hash(before) } : {}), markdown,
      url: `obsidian://open?${new URLSearchParams({ path: join(vault.path, note.path) })}` };
  });
  const { messages, ...source } = input.source;
  const proposal: KnowledgeProposal = {
    id, source: { ...source, entryIds: messages.map((message) => message.id) }, project, vaultId: input.vaultId, vaultPath: vault.path,
    hubPath, hubMarkdown: `# ${project.replace(/[\r\n]/g, " ")}\n\n#knowledge/project\n\nProject knowledge index. Related notes link here; use backlinks or Graph View to explore.\n`,
    notes, createdAt: new Date().toISOString(),
  };
  return updateJsonObject<Record<string, KnowledgeProposal>, KnowledgeProposal>(FILE, (current) => {
    const existing = !input.regenerate && Object.values(current ?? {}).find((item) => item.source.fingerprint === proposal.source.fingerprint && item.vaultId === proposal.vaultId && item.project === project);
    return existing ? { result: existing, value: current!, changed: false }
      : { result: proposal, value: { ...current, [id]: proposal }, changed: true };
  });
}

function createFile(root: string, path: string, content: string): void {
  const target = vaultPath(root, path, true);
  const temporary = join(dirname(target), `.robin-${randomUUID()}`);
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
    // Unlike rename, link cannot replace an existing file. Publish complete bytes in one operation.
    linkSync(temporary, target);
  } finally { rmSync(temporary, { force: true }); }
}

function publishNote(root: string, note: KnowledgeNote, proposalId: string): void {
  const target = vaultPath(root, note.path, true);
  const complete = (body: string) => body.includes(`<!-- robin-knowledge:${proposalId}:${note.id} -->`) && body.includes(`<!-- /robin-knowledge:${proposalId}:${note.id} -->`);
  if (note.action === "create") {
    if (existsSync(target) && complete(readNote(root, note.path))) return;
    createFile(root, note.path, note.markdown);
    return;
  }
  if (lstatSync(target).isSymbolicLink()) throw new Error("Refusing to append to a symlink");
  const fd = openSync(target, constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE) throw new Error("Existing note is too large");
    const current = readFileSync(fd, "utf8");
    if (complete(current)) return;
    if (hash(current) !== note.expectedHash) throw new Error(`“${note.title}” changed in Obsidian. Nothing was overwritten; generate a fresh preview.`);
    const named = lstatSync(target);
    if (named.ino !== stat.ino || named.dev !== stat.dev) throw new Error("Note moved during review; retry with a fresh preview");
    const addition = `\n\n${note.markdown}`;
    if (stat.size + Buffer.byteLength(addition) > MAX_FILE) throw new Error("The combined note is too large to append safely");
    writeFileSync(fd, addition);
    fsyncSync(fd);
    const after = lstatSync(target);
    if (after.ino !== stat.ino || after.dev !== stat.dev) throw new Error("Note moved during save; check Obsidian before retrying");
  } finally { closeSync(fd); }
}

/** Saves only a stored, reviewed proposal. Partial success is explicit and retry-safe. */
export function saveKnowledgeProposal(sessionId: string, id: string, confirmed: unknown): KnowledgeProposal {
  if (confirmed !== true) throw new Error("Confirm the proposed notes and destination first");
  return updateJsonObject<Record<string, KnowledgeProposal>, KnowledgeProposal>(FILE, (current) => {
    const proposal = current?.[id];
    if (!proposal || proposal.source.sessionId !== sessionId) throw new Error("Proposal not found");
    const vault = resolveObsidianVault(proposal.vaultId);
    if (vault.path !== proposal.vaultPath) throw new Error("The vault location changed. Generate a fresh preview.");
    delete proposal.error;
    try {
      const hub = vaultPath(vault.path, proposal.hubPath, true);
      if (!existsSync(hub)) createFile(vault.path, proposal.hubPath, proposal.hubMarkdown);
      else readNote(vault.path, proposal.hubPath); // Reject symlinks, never replace the user's project page.
      for (const note of proposal.notes) {
        if (note.saved) continue;
        withFileLock(dataPath(`knowledge-target-${hash(`${vault.path}/${note.path}`)}`), () => publishNote(vault.path, note, proposal.id));
        recordKnowledgeArchive({ draftId: `knowledge-${proposal.id}-${note.id}`, title: note.title, vaultId: vault.id, vaultPath: vault.path,
          relativePath: note.path, url: note.url, savedAt: new Date().toISOString() });
        note.saved = true;
      }
    } catch (error) { proposal.error = error instanceof Error ? error.message : String(error); }
    return { value: { ...current, [id]: proposal }, result: proposal, changed: true };
  });
}
