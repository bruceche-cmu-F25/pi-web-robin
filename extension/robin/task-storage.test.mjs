import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import { checkTaskStorage, exportTaskSnapshot, migrateTasksToSqlite } from "./task-migration.ts";
import { openTaskDatabase, readTaskRecords, taskStoragePath, updateTaskRecords, withTaskTransaction } from "./task-store.ts";
import { addTodo, completeTodo, deleteTodo, listTodos, updateTodo } from "./todo-domain.ts";
import { listRounds, recordRound, updateRound } from "./round-domain.ts";
import { RUNTIME_STATE_FILES } from "./runtime-state-schema.ts";

const previous = process.env.ROBIN_DATA_DIR;
let directory;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "robin-task-sqlite-"));
  process.env.ROBIN_DATA_DIR = directory;
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});

const counts = (todos = 0, rounds = 0) => ({ todos, rounds, events: 0, links: 0, jobs: 0, tech_events: 0, runtime_state: 0 });
const todo = (id, extra = {}) => ({ id, title: `Task ${id}`, done: false, createdAt: "2026-08-01T00:00:00Z", ...extra });
const round = (id, extra = {}) => ({ id, kind: "oa", company: `Company ${id}`, status: "open", createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z", ...extra });
const seed = (todos, rounds = []) => {
  writeFileSync(join(directory, "todos.json"), `\n${JSON.stringify(todos, null, 2)}\n`);
  writeFileSync(join(directory, "rounds.json"), `${JSON.stringify(rounds)}\n`);
};
const read = (name) => JSON.parse(readFileSync(join(directory, name), "utf8"));

function execSql(sql) {
  const db = openTaskDatabase();
  try { db.exec(sql); } finally { db.close(); }
}

function child(code) {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code], {
      env: { ...globalThis.process.env, ROBIN_DATA_DIR: directory }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    process.stderr.on("data", (chunk) => { stderr += chunk; });
    process.on("error", reject);
    process.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Child ${code}: ${stderr}`)));
  });
}
const todoModule = new URL("./todo-domain.ts", import.meta.url).href;
const roundModule = new URL("./round-domain.ts", import.meta.url).href;
const storeModule = new URL("./task-store.ts", import.meta.url).href;

test("preflight is read-only; pre-cutover domain calls keep working with JSON", () => {
  assert.deepEqual(checkTaskStorage(), { backend: "json", schemaVersion: 0, counts: counts(), linkedRounds: 0, orphanedRoundIds: [], missingStateFiles: [...RUNTIME_STATE_FILES] });
  assert.deepEqual(readdirSync(directory), []);
  const created = addTodo({ title: "Before migration" }).todo;
  assert.deepEqual(read("todos.json"), [created]);
  assert.equal(taskStoragePath(), join(directory, "todos.json"));
});

test("migration backs up exact sources, preserves order/unknown fields/history/links, and selects private WAL SQLite", () => {
  const todos = [todo("z", { archivedAt: "2020-01-01", custom: { keep: [1, 2] } }), todo("a", { done: true, createdAt: "legacy-date" })];
  const rounds = [round("linked", { todoId: "a", status: "done" }), round("orphan", { todoId: "deleted" })];
  seed(todos, rounds);
  const original = readFileSync(join(directory, "todos.json"), "utf8");
  const result = migrateTasksToSqlite();
  assert.equal(result.backend, "sqlite");
  assert.deepEqual(result.counts, counts(2, 2));
  assert.equal(result.linkedRounds, 1);
  assert.deepEqual(result.orphanedRoundIds, ["orphan"]);
  assert.deepEqual(listTodos({ includeDone: true, includeArchived: true }).todos, todos);
  assert.deepEqual(readTaskRecords("rounds"), rounds);
  assert.equal(readFileSync(join(result.backupDirectory, "todos.json"), "utf8"), original);
  assert.equal(readFileSync(join(directory, "todos.json"), "utf8"), original);
  assert.match(JSON.parse(readFileSync(join(result.backupDirectory, "manifest.json"), "utf8")).sources.todos.sha256, /^[a-f0-9]{64}$/);
  assert.equal(taskStoragePath(), join(directory, "tasks.sqlite"));
  const db = openTaskDatabase();
  try {
    assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.throws(() => db.prepare("INSERT INTO todos VALUES (?, ?, ?)").run("bad", 20, JSON.stringify({ id: "bad" })), /CHECK/);
    assert.throws(() => db.prepare("INSERT INTO todos VALUES (?, ?, ?)").run("a", 20, JSON.stringify(todo("a"))), /UNIQUE/);
  } finally { db.close(); }
  if (process.platform !== "win32") {
    for (const path of [join(directory, "tasks.sqlite"), join(directory, "task-storage.json"), join(result.backupDirectory, "todos.json")]) {
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
    assert.equal(statSync(result.backupDirectory).mode & 0o777, 0o700);
  }
});

test("migration is idempotent and legacy JSON never overwrites newer SQLite data", () => {
  seed([todo("one"), todo("deleted")]);
  const first = migrateTasksToSqlite();
  updateTodo({ id: "one" }, { title: "New title" });
  deleteTodo({ id: "deleted" });
  const added = addTodo({ title: "After cutover" }).todo;
  seed([todo("stale")]);
  const again = migrateTasksToSqlite();
  assert.equal(again.backupDirectory, first.backupDirectory);
  assert.deepEqual(listTodos().todos.map(({ id, title }) => [id, title]), [["one", "New title"], [added.id, added.title]]);
  assert.deepEqual(read("todos.json"), [todo("stale")], "no dual writes");
});

test("malformed JSON, invalid records and duplicate ids cannot partially migrate either collection", () => {
  for (const [todos, rounds, error] of [
    [[todo("x"), todo("x")], [], /duplicate/],
    [[todo("x", { done: "false" })], [], /boolean/],
    [[todo("x")], [round("x", { status: "unknown" })], /status/],
    [[todo("x")], [round("x", { todoId: 7 })], /todoId/],
  ]) {
    seed(todos, rounds);
    const original = readFileSync(join(directory, "todos.json"), "utf8");
    assert.throws(() => migrateTasksToSqlite(), error);
    assert.equal(existsSync(join(directory, "task-storage.json")), false);
    assert.equal(existsSync(join(directory, "tasks.sqlite")), false);
    assert.equal(readFileSync(join(directory, "todos.json"), "utf8"), original);
  }
  writeFileSync(join(directory, "rounds.json"), "[{\"id\":");
  assert.throws(() => migrateTasksToSqlite(), SyntaxError);
  assert.equal(existsSync(join(directory, "task-storage.json")), false);
});

test("missing sources import as empty, while an interrupted migration is never overwritten", () => {
  mkdirSync(join(directory, "task-migration.lock"));
  assert.throws(() => migrateTasksToSqlite(), /interrupted/);
  rmSync(join(directory, "task-migration.lock"), { recursive: true });
  writeFileSync(join(directory, "tasks.sqlite"), "unfinished");
  assert.throws(() => migrateTasksToSqlite(), /will not be overwritten/);
  assert.equal(readFileSync(join(directory, "tasks.sqlite"), "utf8"), "unfinished");
  rmSync(join(directory, "tasks.sqlite"));
  assert.deepEqual(migrateTasksToSqlite().counts, counts());
  assert.equal(existsSync(join(directory, "todos.json")), false);
});

test("selected but missing, damaged or newer databases fail closed instead of reviving JSON", () => {
  seed([todo("old")]);
  migrateTasksToSqlite();
  renameSync(join(directory, "tasks.sqlite"), join(directory, "saved.sqlite"));
  assert.throws(() => listTodos(), /database missing/);
  assert.throws(() => addTodo({ title: "Must not go to JSON" }), /database missing/);
  assert.equal(existsSync(join(directory, "tasks.sqlite")), false);
  writeFileSync(join(directory, "tasks.sqlite"), "damaged database");
  assert.throws(() => listTodos(), /database/);
  rmSync(join(directory, "tasks.sqlite"));
  renameSync(join(directory, "saved.sqlite"), join(directory, "tasks.sqlite"));
  execSql("PRAGMA user_version = 99");
  assert.throws(() => listTodos(), /schema/);
  assert.deepEqual(read("todos.json"), [todo("old")]);
});

test("round settlement and reopening roll back BOTH records on storage failure", () => {
  migrateTasksToSqlite();
  const task = addTodo({ title: "Finish Acme OA", due: "2030-01-01" }).todo;
  const hiring = recordRound({ kind: "oa", company: "Acme", due: "2030-01-01" }).round;
  assert.equal(hiring.todoId, task.id);
  // The todo write succeeds before the round write fails. It must be rolled back.
  execSql("CREATE TRIGGER fail_round BEFORE UPDATE ON rounds BEGIN SELECT RAISE(ABORT, 'injected round failure'); END;");
  assert.throws(() => updateRound(hiring.id, { status: "done" }), /injected/);
  assert.deepEqual(listTodos().todos, [task]);
  assert.deepEqual(listRounds(), [hiring]);
  execSql("DROP TRIGGER fail_round");
  updateRound(hiring.id, { status: "done" });
  const completedTodo = listTodos({ includeDone: true }).todos[0];
  const completedRound = listRounds()[0];
  execSql("CREATE TRIGGER fail_round BEFORE UPDATE ON rounds BEGIN SELECT RAISE(ABORT, 'injected round failure'); END;");
  assert.throws(() => updateRound(hiring.id, { status: "open" }), /injected/);
  assert.deepEqual(listTodos({ includeDone: true }).todos, [completedTodo]);
  assert.deepEqual(listRounds(), [completedRound]);
  execSql("DROP TRIGGER fail_round; CREATE TRIGGER fail_todo BEFORE UPDATE ON todos BEGIN SELECT RAISE(ABORT, 'injected todo failure'); END;");
  assert.throws(() => updateRound(hiring.id, { status: "open" }), /injected/);
  assert.deepEqual(listRounds(), [completedRound]);
  execSql("DROP TRIGGER fail_todo");
  updateRound(hiring.id, { status: "open" });
  assert.equal(listTodos().todos[0].done, false);
  assert.equal(listRounds()[0].status, "open");
});

test("deleting a todo preserves round history and does not prevent later settlement", () => {
  migrateTasksToSqlite();
  const task = addTodo({ title: "Acme assessment" }).todo;
  const hiring = recordRound({ kind: "oa", company: "Acme" }).round;
  deleteTodo({ id: task.id });
  assert.equal(updateRound(hiring.id, { status: "done" }).status, "done");
  assert.equal(listRounds()[0].todoId, task.id);
  assert.deepEqual(checkTaskStorage().orphanedRoundIds, [hiring.id]);
});

test("nested savepoints isolate caught failures; async callbacks cannot commit", () => {
  migrateTasksToSqlite();
  withTaskTransaction(() => {
    addTodo({ title: "Keep first" });
    assert.throws(() => withTaskTransaction(() => { addTodo({ title: "Discard" }); throw new Error("failed"); }), /failed/);
    addTodo({ title: "Keep last" });
  });
  assert.deepEqual(listTodos().todos.map((task) => task.title), ["Keep first", "Keep last"]);
  assert.throws(() => withTaskTransaction(async () => { addTodo({ title: "Rollback async" }); }), /synchronous/);
  assert.equal(listTodos().todos.length, 2);
});

test("small edits only write changed rows and invalid batches roll back", () => {
  seed([todo("edit"), todo("untouched")]);
  migrateTasksToSqlite();
  execSql("CREATE TRIGGER protect_untouched BEFORE UPDATE ON todos WHEN OLD.id = 'untouched' BEGIN SELECT RAISE(ABORT, 'unnecessary write'); END;");
  updateTodo({ id: "edit" }, { title: "Changed only this row" });
  assert.equal(listTodos().todos[1].title, "Task untouched");
  const before = listTodos().todos;
  assert.throws(() => updateTaskRecords("todos", (items) => {
    items[0].title = "Must roll back";
    items.push(todo("edit"));
    return { value: null, changed: true };
  }), /duplicate/);
  assert.deepEqual(listTodos().todos, before);
});

test("separate processes add todos and dedupe rounds without losing updates", async () => {
  migrateTasksToSqlite();
  await Promise.all(Array.from({ length: 4 }, (_, worker) => child(`
    import { addTodo } from ${JSON.stringify(todoModule)};
    import { recordRound } from ${JSON.stringify(roundModule)};
    for (let i = 0; i < 15; i++) {
      addTodo({ title: 'worker-${worker}-' + i });
      recordRound({ kind: 'interview', company: 'Acme', threadId: 'one-thread' });
    }
  `)));
  assert.equal(listTodos().todos.length, 60);
  assert.equal(new Set(listTodos().todos.map((task) => task.title)).size, 60);
  assert.equal(listRounds().length, 1);
});

test("an abrupt process exit leaves no partially committed todo/round transaction", async () => {
  migrateTasksToSqlite();
  const task = addTodo({ title: "Acme OA" }).todo;
  const hiring = recordRound({ kind: "oa", company: "Acme" }).round;
  await child(`
    import { withTaskTransaction } from ${JSON.stringify(storeModule)};
    import { updateRound } from ${JSON.stringify(roundModule)};
    withTaskTransaction(() => { updateRound(${JSON.stringify(hiring.id)}, {status: 'done'}); process.exit(0); });
  `);
  assert.deepEqual(listTodos().todos, [task]);
  assert.deepEqual(listRounds(), [hiring]);
  assert.equal(checkTaskStorage().counts.todos, 1);
});

test("export includes post-cutover edits and deletions, keeps originals untouched, and can seed a rollback", () => {
  seed([todo("complete"), todo("remove")]);
  migrateTasksToSqlite();
  completeTodo({ id: "complete" });
  deleteTodo({ id: "remove" });
  addTodo({ title: "New" });
  const hiring = recordRound({ kind: "interview", company: "Acme" }).round;
  const target = join(directory, "export");
  const expected = listTodos({ includeDone: true }).todos;
  exportTaskSnapshot(target);
  assert.deepEqual(JSON.parse(readFileSync(join(target, "todos.json"), "utf8")), expected);
  assert.deepEqual(JSON.parse(readFileSync(join(target, "rounds.json"), "utf8")), [hiring]);
  assert.deepEqual(read("todos.json"), [todo("complete"), todo("remove")]);
  assert.throws(() => exportTaskSnapshot(target), /already exists/);
  assert.throws(() => exportTaskSnapshot(directory), /already exists/);
  process.env.ROBIN_DATA_DIR = target;
  assert.deepEqual(listTodos({ includeDone: true }).todos, expected, "current export, not the pre-migration backup, restores later edits");
  migrateTasksToSqlite();
  assert.deepEqual(listTodos({ includeDone: true }).todos, expected);
});

test("export reads committed WAL contents, not an old main file or an uncommitted writer", () => {
  seed([todo("task")], [round("hiring", { todoId: "task" })]);
  migrateTasksToSqlite();
  const reader = new DatabaseSync(join(directory, "tasks.sqlite"), { readOnly: true });
  const writer = new DatabaseSync(join(directory, "tasks.sqlite"));
  try {
    reader.exec("BEGIN");
    reader.prepare("SELECT * FROM todos").all(); // Pin the old snapshot; prevent checkpointing.
    updateRound("hiring", { status: "done" });
    assert.ok(statSync(join(directory, "tasks.sqlite-wal")).size > 0);
    writer.exec("BEGIN IMMEDIATE; UPDATE todos SET payload = json_set(payload, '$.title', 'uncommitted');");
    const target = join(directory, "wal-export");
    exportTaskSnapshot(target);
    const todos = JSON.parse(readFileSync(join(target, "todos.json"), "utf8"));
    const rounds = JSON.parse(readFileSync(join(target, "rounds.json"), "utf8"));
    assert.equal(todos[0].done, true);
    assert.equal(todos[0].title, "Task task");
    assert.equal(rounds[0].status, "done");
    writer.exec("ROLLBACK");
    reader.exec("ROLLBACK");
  } finally {
    writer.close();
    reader.close();
  }
});

test("CLI refuses cutover without a stopped-writers acknowledgement", () => {
  const script = new URL("../../scripts/robin-task-storage.ts", import.meta.url);
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script.pathname, "migrate"], { env: process.env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /writers-stopped/);
  assert.deepEqual(readdirSync(directory), []);
});
