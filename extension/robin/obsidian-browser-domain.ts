import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { listObsidianVaults, resolveObsidianVault, ObsidianError } from "./obsidian-domain.ts";
import { vaultLinkResolver, vaultLinks } from "./obsidian-links.ts";

export interface VaultEntry {
  path: string;
  title: string;
  modified: string;
  links: string[];
  unresolved: string[];
  /** Bounded local text for the card view; never generated or sent to a model. */
  excerpt?: string;
}
export interface VaultIndex {
  notes: VaultEntry[];
  limited: boolean;
  skipped: number;
}
export interface VaultNote { path: string; content: string; modified: string; url: string }
const MAX_NOTE = 256 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
const MAX_NOTES = 1000;
const MAX_ENTRIES = 20_000;

export function discoverVaults() { return listObsidianVaults(); }

function noteExcerpt(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(/```[^]*?```|~~~[^]*?~~~|<!--[^]*?-->/g, " ").slice(0, 4000)
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias || target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, " ")
    .replace(/^[#>\s*-]+/gm, "").replace(/[`*_~]/g, "").replace(/\s+/g, " ").trim().slice(0, 240);
}

/** A registered root is the only authority. No hidden files, symlinks or arbitrary paths. */
async function safePath(root: string, path: string): Promise<string> {
  const parts = path.split("/");
  if (!path || path.length > 2048 || parts.some((part) => !part || part.startsWith(".") || /[\\:\p{Cc}]/u.test(part))) {
    throw new ObsidianError("Unsafe vault path", 400);
  }
  let current = root;
  for (const [i, part] of parts.entries()) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) throw new ObsidianError("Symlinks are not browsable", 403);
  }
  const resolved = await realpath(current);
  const inside = relative(root, resolved);
  if (inside.startsWith("..") || isAbsolute(inside)) throw new ObsidianError("Path is outside the vault", 403);
  return current;
}

async function readAt(root: string, path: string): Promise<{ content: string; modified: string; size: number }> {
  if (!/\.md$/i.test(path)) throw new ObsidianError("Only Markdown notes can be read", 400);
  const target = await safePath(root, path);
  const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new ObsidianError("Only regular Markdown files can be read", 400);
    if (stat.size > MAX_NOTE) throw new ObsidianError("Note exceeds the 256 KiB reading limit; open it in Obsidian", 413);
    // Bounded even if another application grows the file during this read.
    const buffer = Buffer.alloc(MAX_NOTE + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_NOTE) throw new ObsidianError("Note exceeds the 256 KiB reading limit; open it in Obsidian", 413);
    const after = await file.stat();
    const pathStat = await lstat(await safePath(root, path));
    if (after.mtimeMs !== stat.mtimeMs || after.size !== stat.size || pathStat.ino !== stat.ino || pathStat.dev !== stat.dev) {
      throw new ObsidianError("Note changed while reading; refresh and try again", 409);
    }
    return { content: buffer.subarray(0, size).toString("utf8"), modified: stat.mtime.toISOString(), size };
  } finally { await file.close(); }
}

export async function readVaultNote(vaultId: string, path: string): Promise<VaultNote> {
  const vault = resolveObsidianVault(vaultId);
  try {
    const note = await readAt(vault.path, path);
    return { path, content: note.content, modified: note.modified,
      url: `obsidian://open?${new URLSearchParams({ path: join(vault.path, path) })}` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ObsidianError("Note no longer exists; refresh the vault", 404);
    throw error;
  }
}

/** Browser and agent search share the same filesystem boundary and total read budget. */
async function scanVault(vaultId: string, visit: (note: Awaited<ReturnType<typeof readAt>> & { path: string }) => void, signal?: AbortSignal) {
  const vault = resolveObsidianVault(vaultId);
  const pending = [""];
  let visited = 0, scanned = 0, bytes = 0, skipped = 0, limited = false;
  scan: while (pending.length) {
    signal?.throwIfAborted();
    const directory = pending.shift()!;
    const full = directory ? await safePath(vault.path, directory) : vault.path;
    const handle = await opendir(full);
    for await (const item of handle) {
      signal?.throwIfAborted();
      if (++visited > MAX_ENTRIES || scanned >= MAX_NOTES || bytes >= MAX_TOTAL) { limited = true; break scan; }
      if (item.name.startsWith(".") || /[\\:\p{Cc}]/u.test(item.name) || item.isSymbolicLink()) continue;
      const path = directory ? `${directory}/${item.name}` : item.name;
      if (item.isDirectory()) {
        if (path.split("/").length < 32) pending.push(path); else limited = true;
      } else if (item.isFile() && /\.md$/i.test(item.name)) {
        try {
          const note = await readAt(vault.path, path);
          if (bytes + note.size > MAX_TOTAL) { limited = true; break scan; }
          bytes += note.size;
          scanned++;
          visit({ ...note, path });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (error instanceof ObsidianError || ["ENOENT", "EACCES", "EPERM", "ELOOP"].includes(code ?? "")) skipped++;
          else throw error;
        }
      }
    }
  }
  return { scanned, limited, skipped };
}

/** No persistent index or second copy of the vault. Explicit refresh rescans current Markdown. */
export async function browseVault(vaultId: string): Promise<VaultIndex> {
  const entries: Array<VaultEntry & { targets: ReturnType<typeof vaultLinks> }> = [];
  let linksLimited = false;
  const scan = await scanVault(vaultId, (note) => {
    const targets = vaultLinks(note.content);
    if (targets.length > 200) linksLimited = true;
    entries.push({ path: note.path, title: note.path.split("/").at(-1)!.replace(/\.md$/i, ""), modified: note.modified,
      links: [], unresolved: [], excerpt: noteExcerpt(note.content), targets: targets.slice(0, 200) });
  });
  const resolveLink = vaultLinkResolver(entries.map((entry) => entry.path));
  const notes = entries.map(({ targets, ...entry }) => {
    for (const link of targets) {
      // Attachments are not notes and must not appear as broken knowledge links.
      if (/\.(?:png|jpe?g|gif|webp|svg|pdf|mp[34]|wav|canvas)(?:#|$)/i.test(link.target)) continue;
      const target = resolveLink(entry.path, link.target, link.wiki);
      if (target && target !== entry.path) entry.links.push(target);
      else if (!target) entry.unresolved.push(link.target);
    }
    entry.links = [...new Set(entry.links)];
    entry.unresolved = [...new Set(entry.unresolved)];
    return entry;
  }).sort((a, b) => a.path.localeCompare(b.path));
  return { notes, limited: scan.limited || linksLimited, skipped: scan.skipped };
}

function citationUrl(vaultId: string, path: string): string {
  return `/obsidian?${new URLSearchParams({ vault: vaultId, note: path, view: "read" })}`;
}

interface SearchHit {
  path: string;
  title: string;
  modified: string;
  url: string;
  snippets: Array<{ line: number; column: number; text: string; truncated: boolean }>;
  score: number;
}

/** Literal, case-insensitive AND search. Only bounded matching passages leave the local scan. */
export async function searchVaultNotes(input: { query?: string; vaultId?: string; limit?: number }, signal?: AbortSignal) {
  const { query = "", vaultId, limit = 8 } = input;
  if (typeof query !== "string" || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new ObsidianError("Use a query up to 200 characters and a limit from 1 to 20");
  }
  const terms = [...new Set(query.trim().toLowerCase().split(/\s+/).filter(Boolean))];
  if (terms.length > 8) throw new ObsidianError("Use at most 8 keywords, not a whole question");
  const vaults = discoverVaults().map(({ id, name }) => ({ id, name }));
  const selected = vaultId ?? (vaults.length === 1 ? vaults[0].id : undefined);
  if (vaultId !== undefined && !vaults.some((vault) => vault.id === vaultId)) throw new ObsidianError("Choose a registered Obsidian vault", 404);
  if (!terms.length || !selected) {
    return { status: !vaults.length ? "no-vault" as const : !selected ? "choose-vault" as const : "ready" as const, vaults, results: [] };
  }
  const results: SearchHit[] = [];
  let matched = 0;
  // ponytail: scan up to the browser's 1,000-note/20 MiB ceiling; add an index only if measured latency warrants it.
  const scan = await scanVault(selected, (note) => {
    const path = note.path.toLowerCase();
    const body = note.content.toLowerCase();
    if (!terms.every((term) => path.includes(term) || body.includes(term))) return;
    matched++;
    const title = note.path.split("/").at(-1)!.replace(/\.md$/i, "");
    const snippets: SearchHit["snippets"] = [];
    for (const [index, line] of note.content.split("\n").entries()) {
      const lower = line.toLowerCase();
      const positions = terms.map((term) => lower.indexOf(term)).filter((position) => position >= 0);
      if (!positions.length) continue;
      const start = Math.max(0, Math.min(...positions) - 80);
      snippets.push({ line: index + 1, column: start + 1, text: line.slice(start, start + 320), truncated: start > 0 || line.length > start + 320 });
      if (snippets.length === 3) break;
    }
    results.push({ path: note.path, title, modified: note.modified, url: citationUrl(selected, note.path), snippets,
      score: terms.reduce((score, term) => score + (title.toLowerCase().includes(term) ? 10 : path.includes(term) ? 5 : 1), 0) });
    results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    if (results.length > limit) results.pop();
  }, signal);
  return { status: "searched" as const, vaultId: selected, query: query.trim(), ...scan, matched,
    moreResults: matched > results.length,
    results: results.map(({ path, title, modified, url, snippets }) => ({ path, title, modified, url, snippets })) };
}

/** Bounded source evidence; offset/nextOffset refer to characters in the current file, not bytes. */
export async function readVaultEvidence(input: { vaultId: string; path: string; offset?: number; limit?: number }) {
  const { vaultId, path, offset = 0, limit = 12_000 } = input;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 16_000) {
    throw new ObsidianError("Use a nonnegative character offset and a limit from 1 to 16000");
  }
  const note = await readVaultNote(vaultId, path);
  if (offset > note.content.length) throw new ObsidianError("Offset exceeds the current note length; read again from zero");
  const content = note.content.slice(offset, offset + limit);
  const end = offset + content.length;
  return { vaultId, path, modified: note.modified, url: citationUrl(vaultId, path), content, offset,
    totalChars: note.content.length, nextOffset: end < note.content.length ? end : null,
    startLine: note.content.slice(0, offset).split("\n").length,
    endLine: note.content.slice(0, end).split("\n").length };
}
