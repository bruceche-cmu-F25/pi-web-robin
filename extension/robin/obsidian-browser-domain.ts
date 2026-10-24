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

/** No persistent index or second copy of the vault. Explicit refresh rescans current Markdown. */
export async function browseVault(vaultId: string): Promise<VaultIndex> {
  const vault = resolveObsidianVault(vaultId);
  const pending = [""];
  const entries: Array<VaultEntry & { targets: ReturnType<typeof vaultLinks> }> = [];
  let visited = 0, bytes = 0, skipped = 0, limited = false;
  scan: while (pending.length) {
    const directory = pending.shift()!;
    const full = directory ? await safePath(vault.path, directory) : vault.path;
    const handle = await opendir(full);
    for await (const item of handle) {
      if (++visited > MAX_ENTRIES || entries.length >= MAX_NOTES || bytes >= MAX_TOTAL) { limited = true; break scan; }
      if (item.name.startsWith(".") || /[\\:\p{Cc}]/u.test(item.name) || item.isSymbolicLink()) continue;
      const path = directory ? `${directory}/${item.name}` : item.name;
      if (item.isDirectory()) {
        if (path.split("/").length < 32) pending.push(path); else limited = true;
      } else if (item.isFile() && /\.md$/i.test(item.name)) {
        try {
          const note = await readAt(vault.path, path);
          if (bytes + note.size > MAX_TOTAL) { limited = true; break scan; }
          bytes += note.size;
          const targets = vaultLinks(note.content);
          if (targets.length > 200) limited = true;
          entries.push({ path, title: item.name.replace(/\.md$/i, ""), modified: note.modified,
            links: [], unresolved: [], excerpt: noteExcerpt(note.content), targets: targets.slice(0, 200) });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (error instanceof ObsidianError || ["ENOENT", "EACCES", "EPERM", "ELOOP"].includes(code ?? "")) skipped++;
          else throw error;
        }
      }
    }
  }
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
  return { notes, limited, skipped };
}
