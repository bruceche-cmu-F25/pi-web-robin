/** Offline, explicit SQLite cutover/upgrade and portable current-data export. */
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir, dataPath, withFileLock } from "./paths.ts";
import {
  openTaskDatabase, TASK_DATABASE_FILE, TASK_SCHEMA_VERSION,
  TASK_STORAGE_FILE, TASK_TABLES, taskStorageSelection, type TaskStorageSelection, type TaskTable,
} from "./task-store.ts";
import { TASK_COLLECTIONS, tablesAtVersion, taskSchemaSql, taskSourceFiles, taskTableName } from "./task-schema.ts";
import { isRuntimeStateFile, RUNTIME_STATE_FILES, validateRuntimeState } from "./runtime-state-schema.ts";

interface Document { id: string; [field: string]: unknown }
type Snapshot = Record<TaskTable, Document[]>;
type Sources = Record<string, string | null>;
export interface TaskMigrationReport {
  backend: "json" | "mixed" | "sqlite";
  schemaVersion: number;
  counts: Record<TaskTable, number>;
  linkedRounds: number;
  /** Historical links to deleted todos are preserved, not silently repaired. */
  orphanedRoundIds: string[];
  backupDirectory?: string;
  /** Omitted from export, not replaced by null or an invented empty object. */
  missingStateFiles: string[];
}

function validate(table: TaskTable, value: unknown): Document[] {
  const definition = TASK_COLLECTIONS[table];
  if (!Array.isArray(value)) throw new Error(`${definition.file} does not contain a JSON array`);
  const ids = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" || !row.id) {
      throw new Error(`${table}: every record must have a nonempty string id`);
    }
    if (ids.has(row.id)) throw new Error(`${table}: duplicate id ${row.id}`);
    ids.add(row.id);
    if (table === "runtime_state") {
      if (!isRuntimeStateFile(row.id)) throw new Error(`Unregistered runtime state: ${row.id}`);
      validateRuntimeState(row.id, row.value);
    }
    // Preserve legacy timestamp strings verbatim. Migration is not data cleanup.
    for (const field of definition.requiredStrings) {
      if (typeof row[field] !== "string") throw new Error(`${table}/${row.id}: ${field} must be a string`);
    }
    for (const field of definition.optionalStrings) {
      if (row[field] !== undefined && typeof row[field] !== "string") throw new Error(`${table}/${row.id}: ${field} must be a string`);
    }
    if (table === "todos") {
      if (typeof row.done !== "boolean") throw new Error(`todos/${row.id}: done must be a boolean`);
      if (row.status !== undefined && !["todo", "doing", "done"].includes(row.status)) throw new Error(`todos/${row.id}: invalid status`);
      if (row.next !== undefined && typeof row.next !== "boolean") throw new Error(`todos/${row.id}: next must be a boolean`);
      if (row.estimateMinutes !== undefined && (!Number.isInteger(row.estimateMinutes) || row.estimateMinutes < 5 || row.estimateMinutes > 720)) {
        throw new Error(`todos/${row.id}: invalid estimateMinutes`);
      }
    } else if (table === "rounds") {
      if (!["oa", "interview"].includes(row.kind) || !["open", "done", "missed", "cancelled"].includes(row.status)) {
        throw new Error(`rounds/${row.id}: invalid kind or status`);
      }
    } else if (table === "jobs" && !["new", "shortlist", "applied", "dropped"].includes(row.status)) {
      throw new Error(`jobs/${row.id}: invalid status`);
    }
    const booleans = table === "tech_events" ? ["online", "free", "soldOut", "requiresApproval", "saved", "hidden"] : table === "jobs" ? ["scoreStale"] : [];
    const numbers = table === "tech_events" ? ["score", "guests"] : table === "jobs" ? ["score", "yearsRequired"] : [];
    const stringArrays = table === "tech_events" ? ["topics", "matched"] : table === "jobs" ? ["flags", "alternateUrls"] : [];
    for (const field of booleans) if (row[field] !== undefined && typeof row[field] !== "boolean") throw new Error(`${table}/${row.id}: ${field} must be a boolean`);
    for (const field of numbers) if (row[field] !== undefined && !Number.isFinite(row[field])) throw new Error(`${table}/${row.id}: ${field} must be a finite number`);
    for (const field of stringArrays) {
      if (row[field] !== undefined && (!Array.isArray(row[field]) || row[field].some((item: unknown) => typeof item !== "string"))) {
        throw new Error(`${table}/${row.id}: ${field} must be a string array`);
      }
    }
  }
  return value as Document[];
}

function legacySnapshot(tables: readonly TaskTable[]): { snapshot: Partial<Snapshot>; sources: Sources } {
  const snapshot: Partial<Snapshot> = {};
  const sources: Sources = {};
  const read = (key: string, file: string): string | null => {
    try { return sources[key] = readFileSync(dataPath(file), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return sources[key] = null;
    }
  };
  for (const table of tables) {
    const file = TASK_COLLECTIONS[table].file;
    if (file) {
      const raw = read(table, file);
      snapshot[table] = validate(table, raw === null ? [] : JSON.parse(raw));
    } else {
      const rows: Document[] = [];
      for (const file of RUNTIME_STATE_FILES) {
        const raw = read(file, file);
        if (raw !== null) rows.push({ id: file, value: JSON.parse(raw) });
      }
      snapshot[table] = validate(table, rows);
    }
  }
  return { snapshot, sources };
}

function databaseSnapshot(db: DatabaseSync, tables: readonly TaskTable[]): Partial<Snapshot> {
  const snapshot: Partial<Snapshot> = {};
  for (const table of tables) {
    snapshot[table] = validate(table, db.prepare(`SELECT payload FROM ${table} ORDER BY position`).all()
      .map((row) => JSON.parse(row.payload as string)));
  }
  return snapshot;
}

function verifyDatabase(db: DatabaseSync): void {
  if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw new Error("SQLite integrity check failed");
}

function report(snapshot: Snapshot, schemaVersion: number, backupDirectory?: string): TaskMigrationReport {
  const todos = new Set(snapshot.todos.map((todo) => todo.id));
  const linked = snapshot.rounds.filter((round) => typeof round.todoId === "string");
  return {
    backend: schemaVersion === 0 ? "json" : schemaVersion === TASK_SCHEMA_VERSION ? "sqlite" : "mixed",
    schemaVersion,
    counts: Object.fromEntries(TASK_TABLES.map((table) => [table, snapshot[table].length])) as Record<TaskTable, number>,
    linkedRounds: linked.filter((round) => todos.has(round.todoId as string)).length,
    orphanedRoundIds: linked.filter((round) => !todos.has(round.todoId as string)).map((round) => round.id),
    ...(backupDirectory ? { backupDirectory } : {}),
    missingStateFiles: RUNTIME_STATE_FILES.filter((file) => !snapshot.runtime_state.some((row) => row.id === file)),
  };
}

function currentSnapshot(): { snapshot: Snapshot; report: TaskMigrationReport } {
  const selection = taskStorageSelection();
  const version = selection?.schemaVersion ?? 0;
  const jsonTables = TASK_TABLES.filter((table) => TASK_COLLECTIONS[table].since > version);
  // Never consult old JSON for an already migrated collection, even if corrupted.
  const { snapshot: json } = legacySnapshot(jsonTables);
  if (!selection) return { snapshot: json as Snapshot, report: report(json as Snapshot, 0) };
  const db = openTaskDatabase(true);
  try {
    db.exec("BEGIN");
    verifyDatabase(db);
    const snapshot = { ...json, ...databaseSnapshot(db, tablesAtVersion(version)) } as Snapshot;
    db.exec("COMMIT");
    return { snapshot, report: report(snapshot, version, selection.backupDirectory) };
  } finally {
    db.close();
  }
}

/** Read-only preflight: no domain writes or migration artifacts. SQLite may
 * acquire ordinary read locks / WAL sidecars for an already selected database.
 */
export function checkTaskStorage(): TaskMigrationReport {
  return currentSnapshot().report;
}

function writePrivate(path: string, contents: string): void {
  writeFileSync(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600, flush: true });
}

function syncDirectory(path: string): void {
  if (process.platform === "win32") return; // Node cannot fsync directory handles on Windows.
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function publishSelection(selection: TaskStorageSelection): void {
  const stage = mkdtempSync(dataPath(".storage-selection-"));
  try {
    const temporary = join(stage, TASK_STORAGE_FILE);
    writePrivate(temporary, JSON.stringify(selection, null, 2) + "\n");
    renameSync(temporary, dataPath(TASK_STORAGE_FILE));
    syncDirectory(dataDir());
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function withSourceLocks<T>(tables: TaskTable[], action: () => T): T {
  const files = taskSourceFiles(tables).sort();
  const acquire = (index: number): T => index === files.length ? action() : withFileLock(dataPath(files[index]), () => acquire(index + 1));
  return acquire(0);
}

function createBackup(snapshot: Snapshot, sources: Sources, previous: TaskStorageSelection | null, db?: DatabaseSync): TaskStorageSelection {
  const backupRoot = dataPath("backups");
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const backupDirectory = resolve(mkdtempSync(join(backupRoot, "tasks-pre-sqlite-")));
  const migratedAt = new Date().toISOString();
  for (const [key, raw] of Object.entries(sources)) {
    const file = isRuntimeStateFile(key) ? key : TASK_COLLECTIONS[taskTableName(key as TaskTable)].file;
    if (file && raw !== null) writePrivate(join(backupDirectory, file), raw);
  }
  if (db && previous) {
    // VACUUM INTO includes committed WAL pages. Never copy only the main file.
    const binary = join(backupDirectory, TASK_DATABASE_FILE);
    writePrivate(binary, "");
    db.prepare("VACUUM INTO ?").run(binary);
    const copied = new DatabaseSync(binary, { readOnly: true });
    try {
      verifyDatabase(copied);
      const tables = tablesAtVersion(previous.schemaVersion);
      if (!isDeepStrictEqual(databaseSnapshot(copied, tables), Object.fromEntries(tables.map((table) => [table, snapshot[table]])))) {
        throw new Error("Database changed during backup; stop every writer and retry");
      }
    } finally { copied.close(); }
    // SQLite's VACUUM INTO does not fsync its output on completion.
    const fd = openSync(binary, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    writePrivate(join(backupDirectory, TASK_STORAGE_FILE), readFileSync(dataPath(TASK_STORAGE_FILE), "utf8"));
  }
  writePrivate(join(backupDirectory, "manifest.json"), JSON.stringify({
    targetSchemaVersion: TASK_SCHEMA_VERSION, migratedAt,
    ...report(snapshot, previous?.schemaVersion ?? 0),
    sources: Object.fromEntries(Object.entries(sources).map(([table, raw]) => [table, {
      existed: raw !== null,
      sha256: raw === null ? null : createHash("sha256").update(raw).digest("hex"),
    }])),
  }, null, 2) + "\n");
  syncDirectory(backupDirectory);
  syncDirectory(backupRoot);
  return { backend: "sqlite", schemaVersion: TASK_SCHEMA_VERSION, migratedAt, backupDirectory };
}

function importTransaction(db: DatabaseSync, fromVersion: number, snapshot: Snapshot, sources: Sources, selection: TaskStorageSelection): void {
  const existing = tablesAtVersion(fromVersion);
  const pending = TASK_TABLES.filter((table) => TASK_COLLECTIONS[table].since > fromVersion);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!isDeepStrictEqual(databaseSnapshot(db, existing), Object.fromEntries(existing.map((table) => [table, snapshot[table]])))) {
      throw new Error("Database changed during migration; stop every writer and retry");
    }
    db.exec(taskSchemaSql(fromVersion));
    for (const table of pending) {
      const insert = db.prepare(`INSERT INTO ${table} (id, position, payload) VALUES (?, ?, ?)`);
      snapshot[table].forEach((row, position) => insert.run(row.id, position, JSON.stringify(row)));
    }
    if (!isDeepStrictEqual(databaseSnapshot(db, TASK_TABLES), snapshot)) throw new Error("Migration content verification failed");
    verifyDatabase(db);
    if (!isDeepStrictEqual(legacySnapshot(pending).sources, sources)) throw new Error("Legacy data changed during migration; stop every writer and retry");
    db.prepare("INSERT INTO storage_migrations (version, selection) VALUES (?, ?)").run(TASK_SCHEMA_VERSION, JSON.stringify(selection));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Finish ONLY a committed upgrade with matching in-database migration metadata.
 * New-domain reads/writes otherwise fail closed at the version mismatch.
 */
function recoverSelection(db: DatabaseSync, version: number): TaskStorageSelection {
  const row = db.prepare("SELECT selection FROM storage_migrations WHERE version = ?").get(version);
  const selection = row ? JSON.parse(row.selection as string) as TaskStorageSelection : null;
  if (!selection || selection.backend !== "sqlite" || selection.schemaVersion !== version || typeof selection.backupDirectory !== "string" || typeof selection.migratedAt !== "string") {
    throw new Error("Interrupted upgrade has no valid committed migration metadata; restore a verified backup");
  }
  verifyDatabase(db);
  databaseSnapshot(db, tablesAtVersion(version));
  publishSelection(selection);
  return selection;
}

/** All Web/Pi/Telegram/scheduled writers MUST be stopped, including old code.
 * New installs import all collections; upgrades import only newly introduced files.
 */
export function migrateTasksToSqlite(): TaskMigrationReport {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const lock = dataPath("task-migration.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Migration already running, or interrupted: ${lock}`);
    throw error;
  }
  let db: DatabaseSync | undefined;
  try {
    let previous = taskStorageSelection();
    if (previous) {
      db = openTaskDatabase(false, false);
      const actual = db.prepare("PRAGMA user_version").get()!.user_version as number;
      if (actual !== previous.schemaVersion) {
        if (actual <= previous.schemaVersion || actual > TASK_SCHEMA_VERSION) throw new Error("Unsupported database/selector version mismatch");
        previous = recoverSelection(db, actual);
        // An interrupted older upgrade (v1 -> v2) can be recovered before v3.
        // Recovery never consults its already-imported legacy sources.
      }
      if (actual === TASK_SCHEMA_VERSION) return checkTaskStorage(); // Never reimport stale JSON.
    } else {
      const target = dataPath(TASK_DATABASE_FILE);
      if (existsSync(target) || existsSync(`${target}-wal`) || existsSync(`${target}-shm`)) {
        throw new Error(`Unselected database already exists: ${target}. Inspect it before retrying; it will not be overwritten.`);
      }
    }
    const fromVersion = previous?.schemaVersion ?? 0;
    const pending = TASK_TABLES.filter((table) => TASK_COLLECTIONS[table].since > fromVersion);
    return withSourceLocks(pending, () => {
      const { snapshot: json, sources } = legacySnapshot(pending);
      const snapshot = { ...json, ...(db ? databaseSnapshot(db, tablesAtVersion(fromVersion)) : {}) } as Snapshot;
      const selection = createBackup(snapshot, sources, previous, db);
      if (db) {
        importTransaction(db, fromVersion, snapshot, sources, selection);
        // Metadata and data are committed together; a crash before publishing
        // the selector is recoverable without reading any legacy JSON again.
        publishSelection(selection);
      } else {
        const staging = mkdtempSync(dataPath(".tasks-import-"));
        const temporary = join(staging, TASK_DATABASE_FILE);
        try {
          writePrivate(temporary, "");
          const staged = new DatabaseSync(temporary);
          try {
            staged.exec("PRAGMA synchronous = FULL");
            importTransaction(staged, 0, snapshot, sources, selection);
          } finally { staged.close(); }
          // Staging uses a self-contained DELETE journal; never rename a live WAL.
          renameSync(temporary, dataPath(TASK_DATABASE_FILE));
          const live = openTaskDatabase();
          try {
            if (live.prepare("PRAGMA journal_mode = WAL").get()?.journal_mode !== "wal") throw new Error("Cannot enable WAL for database");
          } finally { live.close(); }
          syncDirectory(dataDir());
          publishSelection(selection);
        } finally { rmSync(staging, { recursive: true, force: true }); }
      }
      return report(snapshot, TASK_SCHEMA_VERSION, selection.backupDirectory);
    });
  } finally {
    db?.close();
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Current snapshot, including post-cutover writes. All-SQLite exports share a
 * read transaction. Mixed/JSON exports require stopped writers for consistency.
 */
export function exportTaskSnapshot(destination: string): TaskMigrationReport {
  const target = resolve(destination);
  if (existsSync(target)) throw new Error(`Export destination already exists: ${target}`);
  const { snapshot, report: result } = currentSnapshot();
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  mkdirSync(target, { mode: 0o700 });
  try {
    for (const table of TASK_TABLES) {
      const file = TASK_COLLECTIONS[table].file;
      if (file) writePrivate(join(target, file), JSON.stringify(snapshot[table], null, 2) + "\n");
      else for (const row of snapshot[table]) writePrivate(join(target, row.id), JSON.stringify(row.value, null, 2) + "\n");
    }
    writePrivate(join(target, "manifest.json"), JSON.stringify({ ...result, exportedAt: new Date().toISOString() }, null, 2) + "\n");
    syncDirectory(target);
    syncDirectory(dirname(target));
    return result;
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
}
