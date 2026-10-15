import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { dataPath, readJsonObject, updateJsonArray, updateJsonObject, withFileLock } from "./paths.ts";
import { listNoteAttachments, readNoteAttachmentFile } from "./note-attachments.ts";
import type { NoteDraft } from "./notes-domain.ts";

export interface ObsidianVault { id: string; name: string; path: string }
export interface ObsidianArchive {
  draftId: string;
  title: string;
  vaultId: string;
  vaultPath: string;
  relativePath: string;
  url: string;
  savedAt: string;
}
interface ArchiveReceipt extends ObsidianArchive { fingerprint: string }
const ARCHIVES = "obsidian-archives.json";
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class ObsidianError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function registryPath(): string {
  // Override is operator configuration, never a path accepted from an HTTP request.
  if (process.env.ROBIN_OBSIDIAN_CONFIG) return process.env.ROBIN_OBSIDIAN_CONFIG;
  const config = process.platform === "darwin" ? join(homedir(), "Library", "Application Support")
    : process.platform === "win32" ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(config, "obsidian", "obsidian.json");
}

/** Only vaults already registered by Obsidian are eligible destinations. GET never writes. */
export function listObsidianVaults(): ObsidianVault[] {
  let raw: string;
  try { raw = readFileSync(registryPath(), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const config = JSON.parse(raw) as { vaults?: Record<string, { path?: unknown }> };
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid Obsidian registry");
  return Object.entries(config.vaults ?? {}).flatMap(([id, vault]) =>
    SAFE_ID.test(id) && typeof vault?.path === "string" && isAbsolute(vault.path)
      ? [{ id, name: basename(vault.path), path: vault.path }] : []);
}

export function listObsidianArchives(): ObsidianArchive[] {
  return Object.values(readJsonObject<Record<string, ArchiveReceipt>>(ARCHIVES) ?? {})
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .map(publicArchive);
}

function publicArchive(receipt: ArchiveReceipt): ObsidianArchive {
  return { draftId: receipt.draftId, title: receipt.title, vaultId: receipt.vaultId, vaultPath: receipt.vaultPath,
    relativePath: receipt.relativePath, url: receipt.url, savedAt: receipt.savedAt };
}

export function resolveObsidianVault(id: string): ObsidianVault {
  const vault = listObsidianVaults().find((item) => item.id === id);
  if (!vault) throw new ObsidianError("Choose a registered Obsidian vault", 404);
  const path = realpathSync(vault.path);
  if (!statSync(join(path, ".obsidian")).isDirectory()) throw new ObsidianError("This folder is not an Obsidian vault");
  return { ...vault, path };
}

/** Confirmed knowledge captures share Notes' archive listing; the Markdown remains authoritative. */
export function recordKnowledgeArchive(archive: ObsidianArchive): void {
  updateJsonObject<Record<string, ArchiveReceipt>, void>(ARCHIVES, (current) => ({
    value: { ...current, [archive.draftId]: { ...archive, fingerprint: "knowledge" } }, result: undefined, changed: true,
  }));
}

export function safeObsidianName(value: string): string {
  // Keep Unicode titles, but no path separators, Markdown delimiters or Windows-reserved punctuation.
  const clean = value.replace(/[\p{Cc}<>:"/\\|?*#\[\]^]/gu, "-").replace(/^[.\s]+|[.\s]+$/g, "");
  const short = Array.from(clean).slice(0, 48).join("") || "Note";
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(short) ? `_${short}` : short;
}

function ordinaryDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ObsidianError("Archive directories must not be symlinks", 409);
}

interface ArchiveInput {
  confirmed: true;
  vaultId: string;
  draftId: string;
  title: string;
  content: string;
  expectedDraft: { title: string; text: string };
  attachmentIds: string[];
}

function validateInput(value: unknown): ArchiveInput {
  const input = value as Partial<ArchiveInput> | null;
  if (!input || input.confirmed !== true) throw new ObsidianError("Confirm the destination and note before archiving");
  if (typeof input.vaultId !== "string" || !SAFE_ID.test(input.vaultId)
    || typeof input.draftId !== "string" || !SAFE_ID.test(input.draftId)
    || typeof input.title !== "string" || !input.title.trim() || input.title.length > 200
    || typeof input.content !== "string" || input.content.length > 100_000
    || !input.expectedDraft || typeof input.expectedDraft.title !== "string" || typeof input.expectedDraft.text !== "string"
    || input.expectedDraft.title.length > 200 || input.expectedDraft.text.length > 100_000
    || !Array.isArray(input.attachmentIds) || input.attachmentIds.length > 10
    || input.attachmentIds.some((id) => typeof id !== "string" || !SAFE_ID.test(id))) {
    throw new ObsidianError("Invalid Obsidian archive request");
  }
  if (!input.content.trim() && input.attachmentIds.length === 0) throw new ObsidianError("The note is empty");
  return input as ArchiveInput;
}

/**
 * One-way archive: stage a complete note bundle, then atomically publish its directory.
 * The bundle receipt recovers a published archive if the Robin index write failed.
 * Retrying never rewrites a file that the user may already have edited in Obsidian.
 */
export function archiveNoteToObsidian(value: unknown): ObsidianArchive {
  const input = validateInput(value);
  const vault = resolveObsidianVault(input.vaultId);
  const root = vault.path;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    title: input.title, content: input.content, vault: root, ids: [...input.attachmentIds].sort(),
    expectedDraft: input.expectedDraft,
  })).digest("hex");

  // Serialize against autosaves/deletes, and against attachment changes during publication.
  return updateJsonArray<NoteDraft, ObsidianArchive>("note-drafts.json", (drafts) => {
    const receipt = updateJsonObject<Record<string, ArchiveReceipt>, ArchiveReceipt>(ARCHIVES, (archives) => {
      const draft = drafts.find((item) => item.id === input.draftId);
      if (draft && (draft.title !== input.expectedDraft.title || draft.text !== input.expectedDraft.text)) {
        throw new ObsidianError("This draft changed elsewhere. Reload it before archiving.", 409);
      }
      const previous = archives?.[input.draftId];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ObsidianError("This draft was already archived; open its Markdown file instead", 409);
        return { value: archives!, result: previous, changed: false };
      }
      if (!draft) throw new ObsidianError("Draft not found", 404);
      return withFileLock(dataPath("note-attachments.json"), () => {
        const attachments = listNoteAttachments(input.draftId);
        if (JSON.stringify(attachments.map((file) => file.id).sort()) !== JSON.stringify([...input.attachmentIds].sort())) {
          throw new ObsidianError("Attachments changed. Reload the note before archiving.", 409);
        }
        const notes = join(root, "Notes");
        if (!existsSync(notes)) mkdirSync(notes);
        ordinaryDirectory(notes);
        // Stable per-draft directory makes retries independent of the title and keeps attachments together.
        const bundle = join(notes, `Robin-${input.draftId}`);
        const marker = ".robin-archive.json";
        const title = safeObsidianName(input.title);
        const relativePath = `Notes/Robin-${input.draftId}/${title}.md`;
        let result: ArchiveReceipt = {
          draftId: input.draftId, title: input.title, vaultId: vault.id, vaultPath: root, relativePath,
          url: `obsidian://open?${new URLSearchParams({ path: join(root, relativePath) })}`,
          savedAt: new Date().toISOString(), fingerprint,
        };
        if (existsSync(bundle)) {
          ordinaryDirectory(bundle);
          const markerPath = join(bundle, marker);
          if (!existsSync(markerPath) || lstatSync(markerPath).isSymbolicLink()) throw new ObsidianError("Archive folder already exists; nothing was overwritten", 409);
          const markerReceipt = JSON.parse(readFileSync(markerPath, "utf8")) as ArchiveReceipt;
          if (markerReceipt.draftId !== input.draftId || markerReceipt.fingerprint !== fingerprint
            || markerReceipt.relativePath !== relativePath || !Number.isFinite(Date.parse(markerReceipt.savedAt))) {
            throw new ObsidianError("Archive folder already exists; nothing was overwritten", 409);
          }
          const published = lstatSync(join(root, relativePath));
          if (!published.isFile() || published.isSymbolicLink()) throw new ObsidianError("Published note is missing or unsafe; draft kept", 409);
          result = { ...result, savedAt: markerReceipt.savedAt };
        } else {
          const staging = join(notes, `.robin-${randomUUID()}`);
          mkdirSync(staging);
          try {
            const files = new Map<string, string>();
            if (attachments.length) mkdirSync(join(staging, "Attachments"));
            for (const attachment of attachments) {
              const file = readNoteAttachmentFile(input.draftId, attachment.id);
              if (!file) throw new ObsidianError(`Attachment is missing: ${attachment.name}. Draft kept.`, 409);
              const knownExtensions: Record<string, string> = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/avif": ".avif" };
              const extension = knownExtensions[attachment.mimeType] ?? extname(attachment.name).replace(/[^.a-zA-Z0-9]/g, "").slice(0, 12);
              const filename = `${attachment.id}-${safeObsidianName(basename(attachment.name, extname(attachment.name)))}${extension}`;
              writeFileSync(join(staging, "Attachments", filename), file.bytes, { flag: "wx" });
              files.set(attachment.id, `Attachments/${encodeURIComponent(filename)}`);
            }
            const referenced = new Set<string>();
            let content = input.content.replace(/(!?)\[([^\]\n]*)\]\(attachment:([A-Za-z0-9_-]+)\)/g, (_match, image: string, label: string, id: string) => {
              const path = files.get(id);
              if (!path) throw new ObsidianError(`Unknown attachment: ${id}`, 409);
              referenced.add(id);
              return `${image}[${label}](${path})`;
            });
            const remaining = attachments.filter((file) => !referenced.has(file.id));
            if (remaining.length) content += `\n\n## Attachments\n\n${remaining.map((file) => `${file.kind === "image" ? "!" : ""}[${file.name.replace(/[\[\]\\\r\n]/g, " ")}](${files.get(file.id)})`).join("\n\n")}`;
            writeFileSync(join(staging, `${title}.md`), content.trimEnd() + "\n", { flag: "wx" });
            writeFileSync(join(staging, marker), JSON.stringify(result), { flag: "wx" });
            renameSync(staging, bundle);
          } finally { rmSync(staging, { recursive: true, force: true }); }
        }
        return { value: { ...archives, [input.draftId]: result }, result, changed: true };
      });
    });
    const index = drafts.findIndex((item) => item.id === input.draftId);
    if (index >= 0) drafts.splice(index, 1);
    return { value: publicArchive(receipt), changed: index >= 0 };
  });
}
