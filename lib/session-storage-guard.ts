import { SessionManager } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { writePrivateFileAtomicSync } from "./atomic-file";

interface EntryLink { id: string; parentId: string | null }

/** A null parent is a legitimate root; a missing parent is not. Never guess a replacement. */
export function sessionBranchWarning(entries: readonly EntryLink[], leafId: string | null): string | undefined {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  let id = leafId;
  while (id !== null) {
    if (seen.has(id)) return `Session history contains a cycle at ${id}. Earlier messages have not been deleted. Back up the session and restore an intact branch before continuing.`;
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) return `Session history is disconnected: entry ${id} is missing. Earlier messages have not been deleted. Back up the session and restore an intact branch before continuing.`;
    id = entry.parentId;
  }
  return undefined;
}

// Pi 1.2 mutates the index/leaf before _persist. Keep this compatibility guard at
// that single seam (messages, context edits, compactions and extension entries).
// Symbols survive Next hot reload; SDK regression tests pin these private fields.
const stateKey = Symbol.for("pi-web.session-storage-state");
const installedKey = Symbol.for("pi-web.session-storage-guard");
interface StorageState {
  failure?: Error;
  checkedFile?: string;
  checkedEntries?: unknown[];
  checkedLeaf?: string | null;
  onFailure?: (error: Error) => void;
}
interface ManagerInternals {
  [stateKey]?: StorageState;
  [installedKey]?: boolean;
  persist: boolean;
  flushed: boolean;
  sessionFile?: string;
  fileEntries: unknown[];
  byId: Map<string, EntryLink>;
  leafId: string | null;
  getEntries(): EntryLink[];
  _appendEntry(entry: EntryLink): void;
  _persist(entry: EntryLink): void;
  _hasConversation(): boolean;
  _rewriteFile(): void;
}

function state(manager: ManagerInternals): StorageState {
  return manager[stateKey] ??= {};
}

/** Check bytes once per manager/file, before any new writes. SDK reads skip torn lines. */
function checkFile(manager: ManagerInternals): void {
  const s = state(manager);
  const path = manager.sessionFile;
  if (!manager.persist || !path || s.checkedFile === path) return;
  let source: string;
  try {
    source = fs.readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !manager.flushed) {
      s.checkedFile = path;
      return;
    }
    throw error;
  }
  let lineNumber = 0;
  for (const line of source.split("\n")) {
    lineNumber++;
    if (!line.trim()) continue;
    try { JSON.parse(line); } catch {
      throw new Error(`Session file has an incomplete or invalid JSON record at line ${lineNumber}. No new messages will be saved. Back up and repair the file before continuing.`);
    }
  }
  if (source.length > 0 && !source.endsWith("\n")) {
    throw new Error("Session file has an unterminated final record. No new messages will be appended. Back up and repair the file before continuing.");
  }
  s.checkedFile = path;
}

export function assertSessionWritable(manager: SessionManager): void {
  const internal = manager as unknown as ManagerInternals;
  const s = state(internal);
  if (s.failure) throw s.failure;
  checkFile(internal);
  if (s.checkedEntries !== internal.fileEntries || s.checkedLeaf !== internal.leafId) {
    const warning = sessionBranchWarning(internal.getEntries(), internal.leafId);
    if (warning) throw new Error(warning);
    s.checkedEntries = internal.fileEntries;
    s.checkedLeaf = internal.leafId;
  }
}

export function sessionStorageFailure(manager: unknown): Error | undefined {
  return (manager as ManagerInternals | undefined)?.[stateKey]?.failure;
}

export function onSessionStorageFailure(manager: SessionManager, callback: (error: Error) => void): void {
  state(manager as unknown as ManagerInternals).onFailure = callback;
}

function fail(manager: ManagerInternals, cause: unknown): Error {
  const s = state(manager);
  if (!s.failure) {
    const code = (cause as NodeJS.ErrnoException)?.code;
    s.failure = new Error(`Session save failed${code ? ` (${code})` : ""}. Further writes are blocked to protect the history. The latest output may not be saved; back up the session and check disk space/permissions before reopening.`, { cause });
    // Abort synchronously through the owner, but never let a UI listener mask the write error.
    try { s.onFailure?.(s.failure); } catch { /* the original storage error wins */ }
  }
  return s.failure;
}

function installGuard(): void {
  const prototype = SessionManager.prototype as unknown as ManagerInternals;
  if (prototype[installedKey]) return;
  if ([prototype._appendEntry, prototype._persist, prototype._hasConversation, prototype._rewriteFile]
    .some((method) => typeof method !== "function")) {
    throw new Error("Unsupported Pi SessionManager: session storage guard needs updating");
  }
  const append = prototype._appendEntry;
  const persist = prototype._persist;
  prototype._persist = function (entry) {
    if (!this.persist || !this.sessionFile || this.flushed || !this._hasConversation()) {
      return persist.call(this, entry);
    }
    // Publish the first flush only when every staged entry is written. linkSync
    // preserves SDK's exclusive-create rule (rename would overwrite a collision).
    const temp = `${this.sessionFile}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, this.fileEntries.map((item) => JSON.stringify(item)).join("\n") + "\n", {
        flag: "wx", mode: 0o600, flush: true,
      });
      fs.linkSync(temp, this.sessionFile);
      this.flushed = true;
    } finally {
      try { fs.unlinkSync(temp); } catch { /* best effort; never mask a failed write */ }
    }
  };
  prototype._appendEntry = function (entry) {
    assertSessionWritable(this as unknown as SessionManager);
    const length = this.fileEntries.length;
    const leaf = this.leafId;
    try {
      append.call(this, entry);
      state(this).checkedLeaf = this.leafId;
    } catch (error) {
      // _appendEntry's only mutations precede _persist; label indexes are updated
      // by callers only after it returns. Never write a synthetic error child.
      this.fileEntries.length = length;
      this.byId.delete(entry.id);
      this.leafId = leaf;
      throw fail(this, error);
    }
  };
  prototype._rewriteFile = function () {
    const s = state(this);
    if (s.failure) throw s.failure;
    if (!this.persist || !this.sessionFile) return;
    // A migration/fork rewrite must not truncate the old file before it succeeds.
    // No parent-chain changes or recovery guesses are made here.
    try {
      writePrivateFileAtomicSync(this.sessionFile, this.fileEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      s.checkedFile = this.sessionFile;
      s.checkedEntries = undefined;
    } catch (error) {
      throw fail(this, error);
    }
  };
  Object.defineProperty(prototype, installedKey, { value: true });
}

installGuard();
