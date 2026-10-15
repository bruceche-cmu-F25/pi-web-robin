import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dataDir } from "./paths.ts";
import { migrateTasksToSqlite } from "./task-migration.ts";
import { TASK_COLLECTIONS, TASK_TABLES } from "./task-schema.ts";
import { RUNTIME_STATE_FILES } from "./runtime-state-schema.ts";

/** Existing domain/adapter contracts run against SQLite by default, JSON on demand. */
export function resetTaskStore(directory, todos = [], rounds = [], collections = {}) {
  if (resolve(directory) !== resolve(dataDir())) throw new Error("Test store must match ROBIN_DATA_DIR");
  for (const name of ["task-storage.json", "tasks.sqlite", "tasks.sqlite-wal", "tasks.sqlite-shm"]) {
    rmSync(join(directory, name), { force: true });
  }
  const records = { todos, rounds, ...collections };
  for (const table of TASK_TABLES) {
    const file = TASK_COLLECTIONS[table].file;
    if (file) writeFileSync(join(directory, file), `${JSON.stringify(records[table] ?? [])}\n`);
  }
  for (const file of RUNTIME_STATE_FILES) rmSync(join(directory, file), { force: true });
  for (const row of records.runtime_state ?? []) writeFileSync(join(directory, row.id), JSON.stringify(row.value));
  if (process.env.ROBIN_TEST_TASK_BACKEND !== "json") migrateTasksToSqlite();
}
