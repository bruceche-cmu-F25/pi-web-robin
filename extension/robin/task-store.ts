/**
 * SQLite persistence for Robin collections. The domain interfaces stay unchanged.
 * Cutover is explicit: without task-storage.json, existing installations keep
 * using JSON. Once selected, a broken/missing database NEVER falls back to JSON.
 * Node builtins only, for both Next.js and the jiti-loaded Robin extension.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataPath, readJsonArray, readJsonObject, updateJsonArray, updateJsonObject } from "./paths.ts";
import { TASK_COLLECTIONS, TASK_SCHEMA_VERSION, taskTableName, type TaskTable } from "./task-schema.ts";
import { isRuntimeStateFile, RUNTIME_STATE_VERSION, validateRuntimeState, type RuntimeStateFile } from "./runtime-state-schema.ts";

export const TASK_DATABASE_FILE = "tasks.sqlite";
export const TASK_STORAGE_FILE = "task-storage.json";
export { TASK_SCHEMA_VERSION, TASK_TABLES, type TaskTable } from "./task-schema.ts";
export interface TaskRecord { id: string }
export interface TaskStorageSelection {
  backend: "sqlite";
  schemaVersion: number;
  migratedAt: string;
  backupDirectory: string;
}

export function taskStorageSelection(): TaskStorageSelection | null {
  const selection = readJsonObject<TaskStorageSelection>(TASK_STORAGE_FILE);
  if (selection && (selection.backend !== "sqlite" || !Number.isInteger(selection.schemaVersion) || selection.schemaVersion < 1 || selection.schemaVersion > TASK_SCHEMA_VERSION)) {
    throw new Error("Unsupported task storage version; do not fall back to legacy JSON");
  }
  return selection;
}

export function taskStoragePath(table: TaskTable = "todos"): string {
  const definition = TASK_COLLECTIONS[taskTableName(table)];
  return dataPath((taskStorageSelection()?.schemaVersion ?? 0) >= definition.since ? TASK_DATABASE_FILE : legacyArrayFile(table));
}

/** verifySelection=false is only for the offline migrator recovering a committed
 * upgrade whose external selector was not published. Domains always verify it.
 */
export function openTaskDatabase(readOnly = false, verifySelection = true): DatabaseSync {
  const path = dataPath(TASK_DATABASE_FILE);
  if (!existsSync(path)) throw new Error(`Task database missing: ${path}. Restore a backup; legacy JSON is not current.`);
  const db = new DatabaseSync(path, { readOnly });
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;");
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > TASK_SCHEMA_VERSION) throw new Error(`Unsupported task database schema: ${version}`);
    if (verifySelection && version !== (taskStorageSelection()?.schemaVersion ?? TASK_SCHEMA_VERSION)) {
      throw new Error("Task database/selector version mismatch; stop writers and rerun the migration. Do not fall back to JSON.");
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

interface Transaction { db: DatabaseSync; savepoint: number; schemaVersion: number }
// HMR and jiti can load separate copies; a round and its todo must still share
// one connection. No long-lived connections: outer operations close in finally.
// This key versions the context shape, not the database schema; v3 shares it.
const key = Symbol.for("robin:task-transactions:v2");
const globals = globalThis as typeof globalThis & { [key]?: Map<string, Transaction> };
const transactions = globals[key] ??= new Map<string, Transaction>();
const transactionKey = () => resolve(dataPath(TASK_DATABASE_FILE));

function synchronous<T>(value: T): T {
  if (value && typeof (value as { then?: unknown }).then === "function") {
    throw new Error("Task transactions must be synchronous; do network work before opening one");
  }
  return value;
}

/** SQLite: nested domain calls share a transaction, with savepoints on errors.
 * JSON mode is transitional and retains its existing per-file guarantees only.
 */
export function withTaskTransaction<T>(action: () => T): T {
  const path = transactionKey();
  const active = transactions.get(path);
  if (active) {
    const savepoint = `task_${++active.savepoint}`;
    active.db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = synchronous(action());
      active.db.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      active.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw error;
    }
  }
  if (!taskStorageSelection()) return synchronous(action());
  const db = openTaskDatabase();
  try {
    // Acquire the write reservation BEFORE reading; avoids stale snapshots and
    // SQLITE_BUSY_SNAPSHOT when another process commits between read and write.
    db.exec("BEGIN IMMEDIATE");
    transactions.set(path, { db, savepoint: 0, schemaVersion: db.prepare("PRAGMA user_version").get()!.user_version as number });
    try {
      const result = synchronous(action());
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      transactions.delete(path);
    }
  } finally {
    db.close();
  }
}

/** Validate the selected database even when this document is still JSON. A
 * committed upgrade with an old selector must not send state writes to JSON.
 */
function runtimeStateUsesSqlite(file: RuntimeStateFile): boolean {
  if (!isRuntimeStateFile(file)) throw new Error(`Unregistered runtime state: ${file}`);
  const active = transactions.get(transactionKey());
  if (active) return active.schemaVersion >= RUNTIME_STATE_VERSION;
  const selection = taskStorageSelection();
  if (!selection) return false;
  if (selection.schemaVersion >= RUNTIME_STATE_VERSION) return true;
  const db = openTaskDatabase(true);
  db.close();
  return false;
}

function runtimeValue<T extends object>(db: DatabaseSync, file: RuntimeStateFile): T | null {
  const row = db.prepare("SELECT payload FROM runtime_state WHERE id = ?").get(file);
  if (!row) return null;
  const value: unknown = JSON.parse(row.payload as string).value;
  validateRuntimeState(file, value);
  return value as T;
}

export function readRuntimeState<T extends object>(file: RuntimeStateFile): T | null {
  if (!runtimeStateUsesSqlite(file)) {
    const value = readJsonObject<T>(file);
    if (value !== null) validateRuntimeState(file, value);
    return value;
  }
  const active = transactions.get(transactionKey());
  if (active) return runtimeValue<T>(active.db, file);
  const db = openTaskDatabase(true);
  try { return runtimeValue<T>(db, file); } finally { db.close(); }
}

export function updateRuntimeState<T extends object, R>(
  file: RuntimeStateFile,
  updater: (current: T | null) => { result: R; value: T; changed: boolean },
): R {
  if (!runtimeStateUsesSqlite(file)) {
    // Keep the pre-v3 lock order: JSON ownership first, then any SQLite domain
    // writes inside its fence. Do not hold a SQLite writer while waiting here.
    return updateJsonObject<T, R>(file, (current) => {
      if (runtimeStateUsesSqlite(file)) throw new Error("Runtime state migrated; retry this operation");
      if (current !== null) validateRuntimeState(file, current);
      const result = synchronous(updater(current));
      if (result.changed) validateRuntimeState(file, result.value);
      return result;
    });
  }
  return withTaskTransaction(() => {
    const db = transactions.get(transactionKey())!.db;
    const result = synchronous(updater(runtimeValue<T>(db, file)));
    if (result.changed) {
      validateRuntimeState(file, result.value);
      // Update one document by its primary key, never rewrite a stale snapshot
      // of other runtime documents written by nested domain calls.
      db.prepare(`INSERT INTO runtime_state (id, position, payload)
        VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM runtime_state), ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
        WHERE runtime_state.payload != excluded.payload`)
        .run(file, JSON.stringify({ id: file, value: result.value }));
    }
    return result.result;
  });
}

export function writeRuntimeState<T extends object>(file: RuntimeStateFile, value: T): void {
  updateRuntimeState<T, void>(file, () => ({ result: undefined, value, changed: true }));
}

/** Explicit replacement for import/test seeds, not read-modify-write callers. */
export function writeTaskRecords<T extends TaskRecord>(table: TaskTable, records: T[]): void {
  updateTaskRecords<T, void>(table, (items) => {
    items.length = 0;
    for (const record of records) items.push(record);
    return { value: undefined, changed: true };
  });
}

function legacyArrayFile(table: TaskTable): string {
  const file = TASK_COLLECTIONS[table].file;
  if (!file) throw new Error("Use runtime-state helpers for legacy object files");
  return file;
}

function selectRows(db: DatabaseSync, table: TaskTable): Array<{ id: string; position: number; payload: string }> {
  return db.prepare(`SELECT id, position, payload FROM ${taskTableName(table)} ORDER BY position`).all() as Array<{ id: string; position: number; payload: string }>;
}

export function readTaskRecords<T extends TaskRecord>(table: TaskTable): T[] {
  const definition = TASK_COLLECTIONS[taskTableName(table)];
  const active = transactions.get(transactionKey());
  if (active) return active.schemaVersion >= definition.since
    ? selectRows(active.db, table).map((row) => JSON.parse(row.payload) as T)
    : readJsonArray<T>(legacyArrayFile(table));
  const selection = taskStorageSelection();
  if (!selection) return readJsonArray<T>(legacyArrayFile(table));
  // Validate DB/selector agreement even for a not-yet-migrated collection. A
  // crash between upgrade COMMIT and selector publication must never send it to JSON.
  const db = openTaskDatabase(true);
  try {
    return selection.schemaVersion >= definition.since
      ? selectRows(db, table).map((row) => JSON.parse(row.payload) as T)
      : readJsonArray<T>(legacyArrayFile(table));
  } finally {
    db.close();
  }
}

export function updateTaskRecords<T extends TaskRecord, R>(
  table: TaskTable,
  updater: (items: T[]) => { value: R; changed: boolean },
): R {
  const definition = TASK_COLLECTIONS[taskTableName(table)];
  return withTaskTransaction(() => {
    const active = transactions.get(transactionKey());
    if (!active || active.schemaVersion < definition.since) {
      return updateJsonArray<T, R>(legacyArrayFile(table), (items) => {
        // A request may have waited on a legacy file lock during cutover.
        if ((taskStorageSelection()?.schemaVersion ?? 0) >= definition.since) throw new Error("Task storage migrated; retry this operation");
        return updater(items);
      });
    }
    const before = selectRows(active.db, table);
    const items = before.map((row) => JSON.parse(row.payload) as T);
    const result = synchronous(updater(items));
    if (!result.changed) return result.value;
    const previous = new Map(before.map((row) => [row.id, row]));
    const ids = new Set<string>();
    const upsert = active.db.prepare(`INSERT INTO ${table} (id, position, payload) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET position = excluded.position, payload = excluded.payload`);
    items.forEach((item, position) => {
      if (typeof item.id !== "string" || !item.id || ids.has(item.id)) throw new Error(`Invalid or duplicate ${table} id`);
      ids.add(item.id);
      const payload = JSON.stringify(item);
      const old = previous.get(item.id);
      if (old?.payload !== payload || old.position !== position) upsert.run(item.id, position, payload);
    });
    const remove = active.db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    for (const row of before) if (!ids.has(row.id)) remove.run(row.id);
    return result.value;
  });
}
