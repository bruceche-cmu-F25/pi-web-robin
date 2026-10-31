/** Private persistence for the new validation domain, never Jarvis/task storage. */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dataDir, dataPath } from "./paths.ts";

const FILE = "market-validation.sqlite";
const MARKER = "market-validation.initialized";
const VERSION = 1;

function markInitialized(): void {
  let fd: number;
  try { fd = openSync(dataPath(MARKER), "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return; throw error; }
  try { writeFileSync(fd, "1\n"); fsyncSync(fd); } finally { closeSync(fd); }
}

export function validationStorageExists(): boolean {
  if (existsSync(dataPath(FILE))) return true;
  if (existsSync(dataPath(MARKER))) throw new Error("Validation database is missing. Restore a verified backup; do not initialize an empty replacement.");
  return false;
}

export function openValidationDatabase(readOnly = false): DatabaseSync {
  if (!validationStorageExists()) throw new Error("Initialize the validation workspace first.");
  const db = new DatabaseSync(dataPath(FILE), { readOnly });
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA synchronous=FULL;");
    if (db.prepare("PRAGMA user_version").get()?.user_version !== VERSION) throw new Error("Unsupported or incomplete validation database. No automatic repair or fallback.");
    db.prepare("SELECT id, revision, payload FROM validation_projects LIMIT 0").all();
    db.prepare("SELECT id, fingerprint, project_id FROM validation_operations LIMIT 0").all();
    return db;
  } catch (error) { db.close(); throw error; }
}

/** Explicit only; a reserved but incomplete file is never overwritten after a crash. */
export function initializeValidationStorage(): void {
  if (validationStorageExists()) {
    const db = openValidationDatabase(true);
    db.close();
    markInitialized();
    return;
  }
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const fd = openSync(dataPath(FILE), "wx", 0o600);
  closeSync(fd);
  const db = new DatabaseSync(dataPath(FILE));
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      BEGIN IMMEDIATE;
      CREATE TABLE validation_projects (
        id TEXT PRIMARY KEY NOT NULL,
        revision INTEGER NOT NULL CHECK(revision > 0),
        payload TEXT NOT NULL CHECK(COALESCE(json_valid(payload)
          AND json_type(payload)='object' AND json_extract(payload,'$.id')=id
          AND json_extract(payload,'$.revision')=revision, 0))
      ) STRICT;
      CREATE TABLE validation_operations (
        id TEXT PRIMARY KEY NOT NULL,
        fingerprint TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('running', 'done', 'failed', 'cancelled')),
        project_id TEXT NOT NULL REFERENCES validation_projects(id)
      ) STRICT;
      PRAGMA user_version=1;
      COMMIT;`);
  } finally { db.close(); }
  markInitialized();
}

export function withValidationTransaction<T>(action: (db: DatabaseSync) => T): T {
  const db = openValidationDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action(db);
      if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("Validation transactions must be synchronous");
      db.exec("COMMIT");
      return result;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
}
