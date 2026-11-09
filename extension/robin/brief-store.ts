/** Private implementation of the new Brief domain. Never imports legacy task JSON. */
import { DatabaseSync } from "node:sqlite";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dataDir, dataPath, withFileLock } from "./paths.ts";

const VERSION = 4;
const DELIVERY_SCHEMA = `
CREATE TABLE brief_outbox (
 slot TEXT PRIMARY KEY, edition_id TEXT NOT NULL UNIQUE REFERENCES brief_editions(id),
 day TEXT NOT NULL, timezone TEXT NOT NULL, expires_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','sending','accepted','uncertain','expired','failed','cancelled')),
 owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0
) STRICT;
PRAGMA user_version = 4;
`;
const EDITOR_SCHEMA = `
CREATE TABLE brief_edits (
 run_id TEXT PRIMARY KEY REFERENCES brief_runs(id), input_hash TEXT NOT NULL,
 reserved_at TEXT NOT NULL, output TEXT
) STRICT;
PRAGMA user_version = 3;
`;
const ACQUISITION_SCHEMA = `
ALTER TABLE brief_runs ADD COLUMN input_profile TEXT NOT NULL DEFAULT 'stored-v1';
CREATE TABLE brief_source_state (source_key TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
CREATE TABLE brief_evidence (
 id TEXT PRIMARY KEY, source_key TEXT NOT NULL, item_id TEXT NOT NULL,
 observed_at TEXT NOT NULL, text TEXT NOT NULL, digest TEXT NOT NULL, metadata TEXT NOT NULL
) STRICT;
CREATE TABLE brief_source_items (
 source_key TEXT NOT NULL, item_id TEXT NOT NULL, generation TEXT NOT NULL,
 evidence_id TEXT REFERENCES brief_evidence(id), PRIMARY KEY(source_key, item_id)
) STRICT;
CREATE TABLE brief_budgets (
 run_id TEXT PRIMARY KEY REFERENCES brief_runs(id), requests INTEGER NOT NULL
) STRICT;
PRAGMA user_version = 2;
`;
export const briefStorePath = () => dataPath("brief.sqlite");
const SCHEMA = `
CREATE TABLE brief_runs (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, day TEXT NOT NULL, timezone TEXT NOT NULL,
 owner TEXT NOT NULL, lease_until INTEGER NOT NULL, stage TEXT NOT NULL,
 started_at TEXT NOT NULL, finished_at TEXT, failure TEXT
) STRICT;
CREATE TABLE brief_inputs (
 run_id TEXT NOT NULL REFERENCES brief_runs(id), source TEXT NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(run_id, source)
) STRICT;
CREATE TABLE brief_steps (
 id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES brief_runs(id), stage TEXT NOT NULL,
 at TEXT NOT NULL, outcome TEXT NOT NULL
) STRICT;
CREATE TABLE brief_editions (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES brief_runs(id),
 day TEXT NOT NULL, timezone TEXT NOT NULL, revision INTEGER NOT NULL,
 mode TEXT NOT NULL CHECK(mode = 'shadow'), payload TEXT NOT NULL,
 UNIQUE(day, timezone, revision)
) STRICT;
${ACQUISITION_SCHEMA}
${EDITOR_SCHEMA}
${DELIVERY_SCHEMA}
`;
function verify(db: DatabaseSync) {
  const version = db.prepare("PRAGMA user_version").get()?.user_version;
  if (version !== VERSION) throw new Error("Unsupported Brief database version; an older Brief store requires explicit offline upgrade");
  for (const table of ["brief_runs", "brief_inputs", "brief_steps", "brief_editions", "brief_source_state", "brief_evidence", "brief_source_items", "brief_budgets", "brief_edits", "brief_outbox"]) db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
}
function fsync(path: string) { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }

/** Explicit creation only. Publish a complete private database, not an empty live file. */
export function initializeBriefStore(): void {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  withFileLock(briefStorePath(), () => {
    if (existsSync(briefStorePath())) { withBriefStore(() => undefined); return; }
    const staging = mkdtempSync(join(dataDir(), ".brief-init-"));
    const file = join(staging, "brief.sqlite");
    try {
      const db = new DatabaseSync(file);
      try {
        chmodSync(file, 0o600);
        db.exec("PRAGMA synchronous = FULL; BEGIN IMMEDIATE;");
        db.exec(SCHEMA);
        db.exec("COMMIT");
        verify(db);
      } finally { db.close(); }
      fsync(file); renameSync(file, briefStorePath());
      if (process.platform !== "win32") fsync(dataDir());
    } finally { rmSync(staging, { recursive: true, force: true }); }
  });
}

/** Offline and opt-in: never upgrade from init, a read, or a running collection. */
export function upgradeBriefStore(writersStopped: boolean): string | null {
  if (!writersStopped) throw new Error("Stop all Brief writers and pass --writers-stopped before upgrading");
  if (!existsSync(briefStorePath())) throw new Error("Brief storage is not initialized");
  return withFileLock(briefStorePath(), () => {
    const db = new DatabaseSync(briefStorePath());
    try {
      db.exec("PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;");
      const version = db.prepare("PRAGMA user_version").get()?.user_version;
      if (version === VERSION) { verify(db); return null; }
      if (version !== 1 && version !== 2 && version !== 3) throw new Error("Unsupported Brief database version");
      const dataVersion = db.prepare("PRAGMA data_version").get()?.data_version;
      if (db.prepare("SELECT 1 FROM brief_runs WHERE stage NOT IN ('done','failed') AND lease_until > ?").get(Date.now())) throw new Error("A Brief writer still owns a live lease");
      const backup = mkdtempSync(join(dataDir(), `.brief-v${version}-backup-`));
      const file = join(backup, "brief.sqlite");
      db.prepare("VACUUM INTO ?").run(file);
      chmodSync(file, 0o600);
      const check = new DatabaseSync(file, { readOnly: true });
      try {
        if (check.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" || check.prepare("PRAGMA user_version").get()?.user_version !== version) throw new Error("Brief backup verification failed");
      } finally { check.close(); }
      fsync(file);
      if (process.platform !== "win32") { fsync(backup); fsync(dataDir()); }
      db.exec("BEGIN IMMEDIATE");
      try {
        if (db.prepare("PRAGMA data_version").get()?.data_version !== dataVersion
          || db.prepare("PRAGMA user_version").get()?.user_version !== version
          || db.prepare("SELECT 1 FROM brief_runs WHERE stage NOT IN ('done','failed') AND lease_until > ?").get(Date.now())) throw new Error("Brief changed during backup; stop every writer and retry");
        if (version === 1) db.exec(ACQUISITION_SCHEMA);
        if (version < 3) db.exec(EDITOR_SCHEMA);
        db.exec(DELIVERY_SCHEMA); verify(db); db.exec("COMMIT");
      }
      catch (error) { db.exec("ROLLBACK"); throw error; }
      return backup;
    } finally { db.close(); }
  });
}

/** Compatibility gate for the old bridge: older schemas cannot have a Brief outbox. No upgrade. */
export function hasBriefDeliveryStore(): boolean {
  if (!existsSync(briefStorePath())) return false;
  const db = new DatabaseSync(briefStorePath(), { readOnly: true });
  try {
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
    if ([1, 2, 3].includes(version)) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'brief_outbox'").get()) throw new Error("Brief schema and delivery history disagree; refusing legacy fallback");
      return false;
    }
    verify(db); return true;
  } finally { db.close(); }
}

/** Synchronous short transactions only; do not return a Promise or hold a connection across awaits. */
export function withBriefStore<T>(action: (db: DatabaseSync) => T, write = false): T {
  if (!existsSync(briefStorePath())) throw new Error("Brief storage is not initialized; run robin-brief init explicitly");
  const db = new DatabaseSync(briefStorePath(), { readOnly: !write });
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    verify(db);
    if (write) db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; BEGIN IMMEDIATE;");
    else db.exec("BEGIN");
    try {
      const result = action(db);
      if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("Brief transactions must be synchronous");
      db.exec("COMMIT"); return result;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
}
