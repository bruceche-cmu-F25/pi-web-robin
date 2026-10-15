import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import { checkTaskStorage, exportTaskSnapshot, migrateTasksToSqlite } from "./task-migration.ts";
import { TASK_COLLECTIONS, TASK_TABLES, TASK_SCHEMA_VERSION, taskSchemaSql, tablesAtVersion } from "./task-schema.ts";
import { openTaskDatabase, taskStoragePath, withTaskTransaction } from "./task-store.ts";
import { addTodo, listTodos, updateTodo } from "./todo-domain.ts";
import { listRounds, updateRound } from "./round-domain.ts";
import { createCalendarEvent, deleteCalendarEvent } from "./calendar-domain.ts";
import { updateLink, deleteLink } from "./link-domain.ts";
import { updateJob } from "./job-domain.ts";
import { setTechEventFlags } from "./tech-event-domain.ts";
import { readEvents, readLinks, readJobs, readTechEvents, updateLinks, updateJobs } from "./store.ts";

const previous = process.env.ROBIN_DATA_DIR;
let directory;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "robin-upgrade-"));
  process.env.ROBIN_DATA_DIR = directory;
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
});
const read = (name) => JSON.parse(readFileSync(join(directory, name), "utf8"));
const write = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + "\n");
const timestamp = "2030-01-01T00:00:00Z";
const task = { id: "task", title: "Acme OA", done: false, createdAt: timestamp };
const hiring = { id: "hiring", kind: "oa", company: "Acme", todoId: "task", status: "open", createdAt: timestamp, updatedAt: timestamp };
const event = { id: "trip", title: "Trip", date: "2030-05-19", endDate: "2030-05-22", start: "08:30", location: "Local time", createdAt: timestamp, extra: { preserve: true } };
const link = { id: "bookmark", title: "Docs", url: "https://example.com/docs", group: "Reading", icon: "png", iconCheckedAt: timestamp, createdAt: timestamp };
const job = { id: "job", title: "Engineer", company: "Acme", location: "Remote", url: "https://example.com/job", source: "test", status: "applied", appliedAt: timestamp, score: 4.5, description: "Employer text stays data", review: { custom: ["retain", "verbatim"] }, flags: ["test"], note: "Keep note", discoveredAt: timestamp };
const tech = { id: "luma:one", title: "Build night", url: "https://luma.com/one", source: "luma", startAt: "2099-01-01T12:00:00Z", timezone: "America/Los_Angeles", online: false, topics: ["ai"], matched: ["build"], score: 3, saved: true, hidden: true, discoveredAt: timestamp };
const phase2 = { events: [event], links: [link], jobs: [job], tech_events: [tech] };
function seedPhase2() {
  for (const [table, records] of Object.entries(phase2)) write(TASK_COLLECTIONS[table].file, records);
}
function seedV1() {
  writeFileSync(join(directory, "tasks.sqlite"), "", { mode: 0o600 });
  const db = new DatabaseSync(join(directory, "tasks.sqlite"));
  try {
    db.exec(taskSchemaSql(0, 1));
    db.prepare("INSERT INTO todos VALUES (?, ?, ?)").run(task.id, 0, JSON.stringify(task));
    db.prepare("INSERT INTO rounds VALUES (?, ?, ?)").run(hiring.id, 0, JSON.stringify(hiring));
    db.exec("PRAGMA journal_mode = WAL");
  } finally { db.close(); }
  write("task-storage.json", { backend: "sqlite", schemaVersion: 1, migratedAt: timestamp, backupDirectory: "phase1-backup" });
  // v1 data has diverged from these legacy snapshots. They must never be read.
  writeFileSync(join(directory, "todos.json"), "stale damaged JSON");
  write("rounds.json", []);
  seedPhase2();
}
function child(code) {
  return new Promise((resolve, reject) => {
    const worker = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code], {
      env: { ...process.env, ROBIN_DATA_DIR: directory }, stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    worker.stderr.on("data", (chunk) => { stderr += chunk; });
    worker.on("error", reject);
    worker.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Worker ${code}: ${stderr}`)));
  });
}

test("fresh cutover preserves all six collections and unrelated JSON; export is lossless", () => {
  write("todos.json", [task]); write("rounds.json", [hiring]); seedPhase2();
  write("products.json", [{ id: "untouched", note: "Other feature" }]);
  const original = new Map(tablesAtVersion(2).map((table) => [table, readFileSync(join(directory, TASK_COLLECTIONS[table].file), "utf8")]));
  const migrated = migrateTasksToSqlite();
  assert.equal(migrated.schemaVersion, TASK_SCHEMA_VERSION);
  assert.deepEqual(migrated.counts, Object.fromEntries(TASK_TABLES.map((table) => [table, table === "runtime_state" ? 0 : 1])));
  assert.deepEqual(readEvents(), [event]);
  assert.deepEqual(readLinks(), [link]);
  assert.deepEqual(readJobs(), [job]);
  assert.deepEqual(readTechEvents(), [tech]);
  const exported = join(directory, "export");
  exportTaskSnapshot(exported);
  for (const table of tablesAtVersion(2)) {
    const file = TASK_COLLECTIONS[table].file;
    assert.equal(readFileSync(join(directory, file), "utf8"), original.get(table));
    assert.equal(readFileSync(join(migrated.backupDirectory, file), "utf8"), original.get(table));
    assert.deepEqual(JSON.parse(readFileSync(join(exported, file), "utf8")), JSON.parse(original.get(table)));
  }
  assert.deepEqual(read("products.json"), [{ id: "untouched", note: "Other feature" }]);
});

test("v1 stays mixed until explicit upgrade and keeps SQLite task edits rather than stale JSON", async () => {
  seedV1();
  updateTodo({ id: task.id }, { title: "Latest title" });
  updateRound(hiring.id, { status: "done" });
  createCalendarEvent({ title: "Before upgrade", date: "2030-06-01" });
  await updateLink(link.id, { title: "Edited bookmark" });
  assert.equal(checkTaskStorage().backend, "mixed");
  assert.equal(checkTaskStorage().schemaVersion, 1);
  assert.equal(taskStoragePath("todos"), join(directory, "tasks.sqlite"));
  assert.equal(taskStoragePath("events"), join(directory, "events.json"));
  const before = listTodos({ includeDone: true }).todos;
  const rounds = listRounds();
  const events = readEvents();
  const migrated = migrateTasksToSqlite();
  assert.equal(migrated.backend, "sqlite");
  assert.equal(migrated.schemaVersion, TASK_SCHEMA_VERSION);
  assert.deepEqual(listTodos({ includeDone: true }).todos, before);
  assert.deepEqual(listRounds(), rounds);
  assert.deepEqual(readEvents(), events);
  assert.equal(readLinks()[0].title, "Edited bookmark");
  assert.equal(taskStoragePath("events"), join(directory, "tasks.sqlite"));
  // The upgrade backup is current v1 data, including WAL commits, not stale JSON.
  const backup = new DatabaseSync(join(migrated.backupDirectory, "tasks.sqlite"), { readOnly: true });
  try {
    assert.equal(backup.prepare("PRAGMA user_version").get().user_version, 1);
    assert.deepEqual(JSON.parse(backup.prepare("SELECT payload FROM todos").get().payload), before[0]);
  } finally { backup.close(); }
  assert.equal(JSON.parse(readFileSync(join(migrated.backupDirectory, "task-storage.json"), "utf8")).schemaVersion, 1);
  assert.equal(readFileSync(join(directory, "todos.json"), "utf8"), "stale damaged JSON");
});

test("an invalid new collection aborts the entire upgrade without blocking v1 task storage", () => {
  seedV1();
  write("jobs.json", [job, job]);
  assert.throws(() => migrateTasksToSqlite(), /duplicate/);
  assert.equal(read("task-storage.json").schemaVersion, 1);
  const db = openTaskDatabase(true);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'events'").get(), undefined);
  } finally { db.close(); }
  assert.equal(addTodo({ title: "Still usable" }).open, 2);
  assert.deepEqual(read("events.json"), [event]);
});

test("a failure after import but before COMMIT rolls back DDL, records, and schema version", (t) => {
  seedV1();
  const original = DatabaseSync.prototype.exec;
  const failure = t.mock.method(DatabaseSync.prototype, "exec", function (sql) {
    if (sql === "COMMIT") throw new Error("injected pre-commit failure");
    return original.call(this, sql);
  });
  assert.throws(() => migrateTasksToSqlite(), /injected/);
  failure.mock.restore();
  assert.equal(read("task-storage.json").schemaVersion, 1);
  const db = openTaskDatabase(true);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'events'").get(), undefined);
  } finally { db.close(); }
  assert.deepEqual(listTodos().todos, [task]);
  assert.deepEqual(read("events.json"), [event]);
  assert.equal(migrateTasksToSqlite().schemaVersion, TASK_SCHEMA_VERSION);
});

test("a committed upgrade with an unpublished selector fails closed then resumes WITHOUT reimport", async () => {
  seedV1();
  const oldSelection = readFileSync(join(directory, "task-storage.json"), "utf8");
  const migrated = migrateTasksToSqlite();
  await updateLink(link.id, { title: "After commit" });
  // Exactly the durable state after the latest COMMIT, before selector publication.
  writeFileSync(join(directory, "task-storage.json"), oldSelection);
  writeFileSync(join(directory, "links.json"), "stale malformed snapshot");
  assert.throws(() => readLinks(), /version mismatch/);
  assert.throws(() => createCalendarEvent({ title: "Must not reach old JSON", date: "2030-02-01" }), /version mismatch/);
  assert.deepEqual(read("events.json"), [event]);
  const recovered = migrateTasksToSqlite();
  assert.equal(recovered.backupDirectory, migrated.backupDirectory);
  assert.equal(readLinks()[0].title, "After commit");
  assert.equal(read("task-storage.json").schemaVersion, TASK_SCHEMA_VERSION);
  assert.equal(readFileSync(join(directory, "links.json"), "utf8"), "stale malformed snapshot");
});

test("post-upgrade calendar/link/job/flag edits persist only to SQLite and survive re-running migration", async () => {
  seedV1(); migrateTasksToSqlite();
  const local = createCalendarEvent({ title: "New event", date: "2030-05-01", start: "10:00" });
  assert.equal(deleteCalendarEvent(event.id), true);
  await updateLink(link.id, { title: "New title", group: "Apps" });
  updateJob(job.id, { note: "New note", status: "shortlist" });
  setTechEventFlags(tech.id, { saved: false });
  const result = migrateTasksToSqlite();
  assert.equal(result.counts.events, 1);
  assert.deepEqual(readEvents(), [local]);
  assert.equal(readLinks()[0].group, "Apps");
  assert.equal(readJobs()[0].note, "New note");
  assert.equal(readJobs()[0].appliedAt, timestamp);
  assert.equal(readTechEvents()[0].saved, undefined);
  assert.equal(readTechEvents()[0].hidden, true);
  assert.deepEqual(read("events.json"), [event]);
  assert.deepEqual(read("links.json"), [link]);
  assert.deepEqual(read("jobs.json"), [job]);
  assert.deepEqual(read("tech-events.json"), [tech]);
  deleteLink(link.id);
  const exported = join(directory, "current-export");
  exportTaskSnapshot(exported);
  assert.deepEqual(JSON.parse(readFileSync(join(exported, "links.json"), "utf8")), []);
  process.env.ROBIN_DATA_DIR = exported;
  assert.deepEqual(readEvents(), [local], "current export can serve a JSON rollback");
  migrateTasksToSqlite();
  assert.deepEqual(readEvents(), [local]);
  assert.equal(readJobs()[0].note, "New note");
});

test("one SQLite transaction can roll back changes across the new collections", () => {
  seedPhase2(); migrateTasksToSqlite();
  assert.throws(() => withTaskTransaction(() => {
    createCalendarEvent({ title: "Discard", date: "2030-01-01" });
    updateLinks((links) => { links[0].title = "Discard"; return { value: null, changed: true }; });
    updateJobs((jobs) => { jobs[0].note = "Discard"; return { value: null, changed: true }; });
    setTechEventFlags(tech.id, { hidden: false });
    throw new Error("cancelled batch");
  }), /cancelled batch/);
  assert.deepEqual(readEvents(), [event]);
  assert.deepEqual(readLinks(), [link]);
  assert.deepEqual(readJobs(), [job]);
  assert.deepEqual(readTechEvents(), [tech]);
});

test("independent processes append calendar/link/job rows without lost updates", async () => {
  migrateTasksToSqlite();
  const calendarModule = new URL("./calendar-domain.ts", import.meta.url).href;
  const storeModule = new URL("./store.ts", import.meta.url).href;
  await Promise.all(Array.from({ length: 3 }, (_, worker) => child(`
    import { createCalendarEvent } from ${JSON.stringify(calendarModule)};
    import { updateLinks, updateJobs } from ${JSON.stringify(storeModule)};
    for (let i = 0; i < 10; i++) {
      const id = '${worker}-' + i;
      createCalendarEvent({ title: id, date: '2030-01-01' });
      updateLinks(items => { items.push({ ...${JSON.stringify(link)}, id }); return { value: null, changed: true }; });
      updateJobs(items => { items.push({ ...${JSON.stringify(job)}, id }); return { value: null, changed: true }; });
    }
  `)));
  assert.equal(readEvents().length, 30);
  assert.equal(readLinks().length, 30);
  assert.equal(readJobs().length, 30);
});

test("selected database loss never sends new-domain writes back to stale JSON", () => {
  seedV1(); migrateTasksToSqlite();
  rmSync(join(directory, "tasks.sqlite"));
  assert.throws(() => readJobs(), /database missing/);
  assert.throws(() => createCalendarEvent({ title: "No fallback", date: "2030-01-01" }), /database missing/);
  assert.equal(existsSync(join(directory, "tasks.sqlite")), false);
  assert.deepEqual(read("events.json"), [event]);
});
