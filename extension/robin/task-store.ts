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
  return withDatabaseTransaction(action, false);
}

/** Consistent SQLite reads without reserving its single writer. Never mutate here;
 * if a read discovers work, finish the snapshot then re-read under a write transaction.
 * Inside an existing transaction this shares its view; JSON keeps its legacy guarantees.
 */
export function withTaskSnapshot<T>(action: () => T): T {
  return withDatabaseTransaction(action, true);
}

function withDatabaseTransaction<T>(action: () => T, readOnly: boolean): T {
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
  const db = openTaskDatabase(readOnly);
  try {
    // Writers reserve BEFORE reading; snapshots never upgrade to writers.
    db.exec(readOnly ? "BEGIN" : "BEGIN IMMEDIATE");
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

function taskFieldPath(field: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) throw new Error("Invalid task field");
  return `$.${field}`;
}

function selectRows(db: DatabaseSync, table: TaskTable, ids?: ReadonlySet<string>, omitted: readonly string[] = []): Array<{ id: string; position: number; payload: string }> {
  // One bound JSON array avoids SQLite's parameter limit for large selections.
  const params = omitted.map(taskFieldPath);
  const payload = omitted.length ? `json_remove(payload, ${omitted.map(() => "?").join(", ")})` : "payload";
  const statement = db.prepare(`SELECT id, position, ${payload} AS payload FROM ${taskTableName(table)}${ids ? " WHERE id IN (SELECT value FROM json_each(?))" : " ORDER BY position"}`);
  if (ids) params.push(JSON.stringify([...ids]));
  const rows = statement.all(...params) as Array<{ id: string; position: number; payload: string }>;
  // Sort selected row references in JS, not their large payloads in a SQLite
  // temp B-tree. Full reads already use the position index and need no sort.
  return ids ? rows.sort((a, b) => a.position - b.position) : rows;
}

function readCollection<R>(table: TaskTable, sqlite: (db: DatabaseSync) => R, json: () => R): R {
  const definition = TASK_COLLECTIONS[taskTableName(table)];
  const active = transactions.get(transactionKey());
  if (active) return active.schemaVersion >= definition.since ? sqlite(active.db) : json();
  const selection = taskStorageSelection();
  if (!selection) return json();
  // Validate even an empty selection or a not-yet-migrated collection. Never
  // revive JSON after a committed upgrade with an unpublished selector.
  const db = openTaskDatabase(true);
  try { return selection.schemaVersion >= definition.since ? sqlite(db) : json(); }
  finally { db.close(); }
}

/** An optional ID selection uses SQLite's existing primary key, in stored order. */
export function readTaskRecords<T extends TaskRecord>(table: TaskTable, ids?: Iterable<string>): T[] {
  const selected = ids === undefined ? undefined : new Set(ids);
  return readCollection(table,
    (db) => selectRows(db, table, selected).map((row) => JSON.parse(row.payload) as T),
    () => {
      const records = readJsonArray<T>(legacyArrayFile(table));
      return selected ? records.filter((record) => selected.has(record.id)) : records;
    });
}

type OptionalField<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T] & string;

/** Read-only view: omit heavy optional fields, then hydrate rows whose metadata
 * needs them. Both phases share a snapshot; JSON reads/parses its file only once.
 * The predicate is synchronous and must decide from the projected metadata.
 * Never pass these partial historical records into persistence/merge operations.
 */
export function readTaskRecordsForView<T extends TaskRecord>(
  table: TaskTable, omitted: readonly OptionalField<T>[], needsDetails: (record: T) => boolean,
): T[] {
  for (const field of omitted) {
    taskFieldPath(field);
    if (field === "id") throw new Error("A view cannot omit its id");
  }
  return withTaskSnapshot(() => readCollection(table, (db) => {
    const rows = selectRows(db, table, undefined, omitted).map((row) => JSON.parse(row.payload) as T);
    const ids = new Set(rows.filter((row) => synchronous(needsDetails(row))).map((row) => row.id));
    const details = new Map((ids.size ? selectRows(db, table, ids) : []).map((row) => [row.id, JSON.parse(row.payload) as T]));
    return rows.map((row) => details.get(row.id) ?? row);
  }, () => readJsonArray<T>(legacyArrayFile(table)).map((record) => {
    const summary = { ...record };
    for (const field of omitted) delete summary[field];
    return synchronous(needsDetails(summary)) ? record : summary;
  })));
}

/** Fresh string-field counts, without transferring/parsing every payload in JS.
 * This still scans SQLite JSON; it is not an index or a cached projection.
 */
export function countTaskRecordsByField(table: TaskTable, field: string): Map<string, number> {
  const path = taskFieldPath(field);
  return readCollection(table, (db) => {
    // Materialize only the small field values: a direct GROUP BY expression can
    // sort/copy whole payloads into SQLite's temporary B-tree (42 MB for jobs).
    const rows = db.prepare(`WITH fields AS MATERIALIZED (
      SELECT json_extract(payload, ?) AS value FROM ${taskTableName(table)} WHERE json_type(payload, ?) = 'text'
    ) SELECT value, COUNT(*) AS count FROM fields GROUP BY value`).all(path, path);
    return new Map(rows.map((row) => [row.value as string, row.count as number]));
  }, () => {
    const counts = new Map<string, number>();
    for (const record of readJsonArray<TaskRecord & Record<string, unknown>>(legacyArrayFile(table))) {
      const value = record[field];
      if (typeof value === "string") counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  });
}

function checkedRecordIds(table: TaskTable, items: TaskRecord[], allowed?: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (typeof item.id !== "string" || !item.id || ids.has(item.id)) throw new Error(`Invalid or duplicate ${table} id`);
    if (allowed && !allowed.has(item.id)) throw new Error("Cannot insert or rename records in a selected update");
    ids.add(item.id);
  }
  return ids;
}

/** With IDs, mutate/delete only existing selected rows, preserving their positions.
 * Inserts and renames require a full collection operation. Reads happen under
 * the write lock, never from a stale pre-fetched selection.
 */
export function updateTaskRecords<T extends TaskRecord, R>(
  table: TaskTable,
  updater: (items: T[]) => { value: R; changed: boolean },
  ids?: Iterable<string>,
): R {
  const definition = TASK_COLLECTIONS[taskTableName(table)];
  const selected = ids === undefined ? undefined : new Set(ids);
  return withTaskTransaction(() => {
    const active = transactions.get(transactionKey());
    if (!active || active.schemaVersion < definition.since) {
      return updateJsonArray<T, R>(legacyArrayFile(table), (items) => {
        // A request may have waited on a legacy file lock during cutover.
        if ((taskStorageSelection()?.schemaVersion ?? 0) >= definition.since) throw new Error("Task storage migrated; retry this operation");
        if (!selected) return synchronous(updater(items));
        const originalIds = items.map((item) => item.id);
        const subset = items.filter((item) => selected.has(item.id));
        const allowed = new Set(subset.map((item) => item.id));
        const result = synchronous(updater(subset));
        if (!result.changed) return result;
        checkedRecordIds(table, subset, allowed);
        const replacements = new Map(subset.map((item) => [item.id, item]));
        for (let i = items.length - 1; i >= 0; i--) {
          if (!selected.has(originalIds[i])) continue;
          const replacement = replacements.get(originalIds[i]);
          if (replacement) items[i] = replacement;
          else items.splice(i, 1);
        }
        return result;
      });
    }
    const before = selectRows(active.db, table, selected);
    const items = before.map((row) => JSON.parse(row.payload) as T);
    const result = synchronous(updater(items));
    if (!result.changed) return result.value;
    const previous = new Map(before.map((row) => [row.id, row]));
    const retained = checkedRecordIds(table, items, selected ? new Set(previous.keys()) : undefined);
    const upsert = active.db.prepare(`INSERT INTO ${table} (id, position, payload) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET position = excluded.position, payload = excluded.payload`);
    items.forEach((item, position) => {
      const payload = JSON.stringify(item);
      const old = previous.get(item.id);
      const nextPosition = selected ? old!.position : position;
      if (old?.payload !== payload || old.position !== nextPosition) upsert.run(item.id, nextPosition, payload);
    });
    const remove = active.db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    for (const row of before) if (!retained.has(row.id)) remove.run(row.id);
    return result.value;
  });
}
