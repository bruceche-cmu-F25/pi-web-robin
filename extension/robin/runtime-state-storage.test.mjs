import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import { checkTaskStorage, exportTaskSnapshot, migrateTasksToSqlite } from "./task-migration.ts";
import { taskSchemaSql, taskSourceFiles, tablesAtVersion } from "./task-schema.ts";
import { RUNTIME_STATE_FILES } from "./runtime-state-schema.ts";
import { openTaskDatabase, readRuntimeState, writeRuntimeState, updateRuntimeState } from "./task-store.ts";
import { claimBackgroundRun, withBackgroundRunOwnership, releaseBackgroundRun, backgroundRunActive, RUN_LEASE_MS } from "./background-run-domain.ts";
import { createDeliveryLedger } from "./delivery-ledger.ts";
import { addTodo, listTodos } from "./todo-domain.ts";
import { localDate } from "./dates.ts";
import { markMailDone, saveMailReview } from "./mail-domain.ts";
import { readMailReview, readJobScanState, writeJobScanState, writeTechEventScanState, readTechEvents, writeTechEvents } from "./store.ts";
import { readRoundScanState, writeRoundScanState } from "./round-domain.ts";
import { runTechEventScan } from "./tech-event-scan.ts";

const previous = process.env.ROBIN_DATA_DIR;
let directory;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "robin-runtime-storage-"));
  process.env.ROBIN_DATA_DIR = directory;
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
});
const write = (file, value) => writeFileSync(join(directory, file), `\n${JSON.stringify(value, null, 2)}\n`);
const read = (file) => JSON.parse(readFileSync(join(directory, file), "utf8"));
const timestamp = "2030-01-01T00:00:00Z";
const todo = { id: "task", title: "Current SQLite task", done: false, createdAt: timestamp };
const reviewItem = (id) => ({ id, category: "other", summary: id, action: "none", triage: "act" });
const states = {
  "background-runs.json": { scanner: { ownerId: "old-owner", heartbeatAt: timestamp, futureField: "preserve" } },
  "job-scan.json": { startedAt: timestamp, finishedAt: timestamp, weeklyAt: timestamp, scanned: 8, sources: [], extra: { nested: true } },
  "job-scoring.json": { id: "score", ownerId: "old-owner", running: false, startedAt: timestamp, remaining: 17 },
  "job-sweep.json": { id: "sweep", running: false, startedAt: timestamp, cursors: { one: 42, two: 8 }, directories: [] },
  "tech-event-scan.json": { startedAt: timestamp, finishedAt: timestamp, sources: [], seen: 8, kept: 3, added: 2, expired: 1 },
  "round-scan.json": { startedAt: timestamp, finishedAt: timestamp, days: 7, error: null },
  "telegram-state.json": { date: "2030-01-01", chatIds: [11, 11, 22], extra: "legacy daily" },
  "job-digest-state.json": { runs: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`run-${String(i).padStart(2, "0")}`, [11, 22]])), extra: "do not trim on import" },
  "gmail-digest-state.json": { runKey: "review:old", chatIds: [11, 22], extra: "legacy run" },
  "reminder-state.json": { runs: { "reminder:old": [11] } },
  "mail-review.json": { day: "2030-01-01", reviewedAt: timestamp, items: [{ ...reviewItem("mail"), done: true }], report: "old report", extra: { retained: true } },
};
function seedStates() { for (const [file, value] of Object.entries(states)) write(file, value); }
function seedSelected(version = 2) {
  const db = new DatabaseSync(join(directory, "tasks.sqlite"));
  try {
    db.exec(taskSchemaSql(0, version));
    db.prepare("INSERT INTO todos VALUES (?, ?, ?)").run(todo.id, 0, JSON.stringify(todo));
    db.exec("PRAGMA journal_mode = WAL");
  } finally { db.close(); }
  write("task-storage.json", { backend: "sqlite", schemaVersion: version, migratedAt: timestamp, backupDirectory: "previous-backup" });
  for (const file of taskSourceFiles(tablesAtVersion(version))) writeFileSync(join(directory, file), "obsolete corrupted JSON");
}
function child(code) {
  return new Promise((resolve, reject) => {
    const worker = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code], {
      env: { ...process.env, ROBIN_DATA_DIR: directory }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    worker.stdout.on("data", (chunk) => { stdout += chunk; });
    worker.stderr.on("data", (chunk) => { stderr += chunk; });
    worker.on("error", reject);
    worker.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Worker ${code}: ${stderr}`)));
  });
}

test("v2 keeps operational JSON until explicit v3 cutover; all state, legacy ledgers and exact backups survive", () => {
  seedSelected(); seedStates();
  const before = checkTaskStorage();
  assert.equal(before.backend, "mixed");
  assert.equal(before.schemaVersion, 2);
  assert.equal(before.counts.runtime_state, 11);
  writeJobScanState({ ...states["job-scan.json"], added: 4 });
  assert.equal(read("job-scan.json").added, 4);
  const originals = new Map(RUNTIME_STATE_FILES.map((file) => [file, readFileSync(join(directory, file), "utf8")]));
  const latestTask = addTodo({ title: "New v2 WAL commit" }).todo;
  const migrated = migrateTasksToSqlite();
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.counts.runtime_state, 11);
  assert.deepEqual(migrated.missingStateFiles, []);
  const manifest = JSON.parse(readFileSync(join(migrated.backupDirectory, "manifest.json"), "utf8"));
  for (const [file, raw] of originals) {
    assert.deepEqual(readRuntimeState(file), JSON.parse(raw));
    assert.equal(readFileSync(join(directory, file), "utf8"), raw);
    assert.equal(readFileSync(join(migrated.backupDirectory, file), "utf8"), raw);
    assert.equal(manifest.sources[file].sha256, createHash("sha256").update(raw).digest("hex"));
  }
  const backup = new DatabaseSync(join(migrated.backupDirectory, "tasks.sqlite"), { readOnly: true });
  try {
    assert.equal(backup.prepare("PRAGMA user_version").get().user_version, 2);
    assert.deepEqual(JSON.parse(backup.prepare("SELECT payload FROM todos WHERE id = ?").get(latestTask.id).payload), latestTask);
  } finally { backup.close(); }
  assert.deepEqual(createDeliveryLedger("telegram-state.json").pending("2030-01-01", [11, 22, 33]), [33]);
  assert.deepEqual(createDeliveryLedger("gmail-digest-state.json").pending("review:old", [11, 22, 33]), [33]);
  assert.equal(Object.keys(readRuntimeState("job-digest-state.json").runs).length, 30, "migration does not trim history");
});

test("v3 export includes later marks, checkpoints and handled mail and can seed JSON rollback then reimport", () => {
  seedStates(); migrateTasksToSqlite();
  const ledger = createDeliveryLedger("gmail-digest-state.json");
  ledger.mark("review:old", 33);
  writeRoundScanState({ startedAt: timestamp, finishedAt: "2030-01-02T00:00:00Z", days: 2 });
  saveMailReview([reviewItem("today")]);
  markMailDone("today", true);
  const current = new Map(RUNTIME_STATE_FILES.map((file) => [file, readRuntimeState(file)]));
  for (const file of RUNTIME_STATE_FILES) writeFileSync(join(directory, file), "obsolete corrupted JSON");
  const exported = join(directory, "current-snapshot");
  exportTaskSnapshot(exported);
  assert.equal(migrateTasksToSqlite().counts.runtime_state, 11, "rerunning never reimports legacy JSON");
  for (const [file, value] of current) assert.deepEqual(JSON.parse(readFileSync(join(exported, file), "utf8")), value);
  process.env.ROBIN_DATA_DIR = exported;
  assert.deepEqual(ledger.pending("review:old", [11, 22, 33, 44]), [44]);
  assert.equal(readMailReview().items[0].done, true);
  assert.equal(readRoundScanState().days, 2);
  migrateTasksToSqlite();
  for (const [file, value] of current) assert.deepEqual(readRuntimeState(file), value);
});

test("missing state is absent, not null or empty; an unregistered file is never imported", () => {
  write("secrets.json", { secret: "not part of the snapshot" });
  write("t.json", { runs: { untouched: [1] } });
  write("job-scan.json", {});
  const migrated = migrateTasksToSqlite();
  assert.equal(migrated.counts.runtime_state, 1);
  assert.ok(migrated.missingStateFiles.includes("reminder-state.json"));
  assert.equal(readRuntimeState("reminder-state.json"), null);
  assert.deepEqual(readRuntimeState("job-scan.json"), {});
  write("reminder-state.json", { runs: { stale: [1] } });
  assert.equal(readRuntimeState("reminder-state.json"), null, "missing SQL row does not fall back to stale JSON");
  const exported = join(directory, "sparse-export");
  exportTaskSnapshot(exported);
  assert.equal(existsSync(join(exported, "reminder-state.json")), false);
  assert.equal(existsSync(join(exported, "secrets.json")), false);
  assert.equal(existsSync(join(exported, "t.json")), false);
  const backup = JSON.parse(readFileSync(join(migrated.backupDirectory, "manifest.json"), "utf8"));
  assert.deepEqual(backup.sources["reminder-state.json"], { existed: false, sha256: null });
  assert.throws(() => readRuntimeState("secrets.json"), /Unregistered/);
});

test("bad operational JSON or ledger shape aborts upgrade and keeps v2 collections usable", () => {
  seedSelected();
  for (const bad of ["{", "null", "[]", JSON.stringify({ runs: [] }), JSON.stringify({ runs: { run: ["chat"] } })]) {
    writeFileSync(join(directory, "telegram-state.json"), bad);
    assert.throws(() => migrateTasksToSqlite());
    assert.equal(read("task-storage.json").schemaVersion, 2);
    assert.deepEqual(listTodos().todos, [todo]);
    assert.equal(readFileSync(join(directory, "telegram-state.json"), "utf8"), bad);
    const db = openTaskDatabase(true);
    try { assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'runtime_state'").get(), undefined); }
    finally { db.close(); }
  }
});

test("v2 -> v3 pre-COMMIT failure rolls back table, data and schema together", (t) => {
  seedSelected(); seedStates();
  const exec = DatabaseSync.prototype.exec;
  const failure = t.mock.method(DatabaseSync.prototype, "exec", function (sql) {
    if (sql === "COMMIT") throw new Error("injected commit failure");
    return exec.call(this, sql);
  });
  assert.throws(() => migrateTasksToSqlite(), /injected/);
  failure.mock.restore();
  assert.equal(read("task-storage.json").schemaVersion, 2);
  assert.equal(checkTaskStorage().schemaVersion, 2);
  for (const [file, value] of Object.entries(states)) assert.deepEqual(read(file), value);
  assert.equal(migrateTasksToSqlite().schemaVersion, 3);
});

test("unpublished v3 commit fails closed for state, then recovers without importing stale sends", () => {
  seedSelected(); seedStates();
  const oldSelection = readFileSync(join(directory, "task-storage.json"), "utf8");
  const migrated = migrateTasksToSqlite();
  createDeliveryLedger("telegram-state.json").mark("2030-01-01", 33);
  writeFileSync(join(directory, "task-storage.json"), oldSelection);
  writeFileSync(join(directory, "telegram-state.json"), "obsolete corrupted JSON");
  assert.throws(() => readRuntimeState("telegram-state.json"), /version mismatch/);
  assert.throws(() => writeJobScanState({ startedAt: timestamp }), /version mismatch/);
  assert.deepEqual(read("job-scan.json"), states["job-scan.json"]);
  const recovered = migrateTasksToSqlite();
  assert.equal(recovered.backupDirectory, migrated.backupDirectory);
  assert.deepEqual(createDeliveryLedger("telegram-state.json").pending("2030-01-01", [11, 22, 33, 44]), [44]);
});

test("a committed v1 -> v2 upgrade can be recovered before advancing to v3", () => {
  seedSelected(1); seedStates();
  const db = new DatabaseSync(join(directory, "tasks.sqlite"));
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec(taskSchemaSql(1, 2));
    db.prepare("INSERT INTO storage_migrations VALUES (?, ?)").run(2, JSON.stringify({ backend: "sqlite", schemaVersion: 2, migratedAt: timestamp, backupDirectory: "committed-v2-backup" }));
    db.exec("COMMIT");
  } finally { db.close(); }
  for (const file of ["events.json", "links.json", "jobs.json", "tech-events.json"]) writeFileSync(join(directory, file), "already imported, do not read");
  assert.equal(migrateTasksToSqlite().schemaVersion, 3);
  assert.deepEqual(listTodos().todos, [todo]);
  assert.deepEqual(readRuntimeState("job-sweep.json"), states["job-sweep.json"]);
});

test("owner fence rolls back domain rows, checkpoints, ledger and lease together; stale owners stay fenced", () => {
  seedStates(); migrateTasksToSqlite();
  const at = Date.parse(timestamp) + RUN_LEASE_MS;
  assert.equal(claimBackgroundRun("scanner", "new-owner", at), true);
  const ledger = createDeliveryLedger("telegram-state.json");
  assert.throws(() => withBackgroundRunOwnership("scanner", "new-owner", () => {
    addTodo({ title: "Roll me back" });
    writeJobScanState({ startedAt: timestamp, added: 100 });
    ledger.mark("2030-01-01", 33);
    releaseBackgroundRun("scanner", "new-owner");
    throw new Error("rollback batch");
  }, at), /rollback batch/);
  assert.deepEqual(listTodos().todos, []);
  assert.deepEqual(readJobScanState(), states["job-scan.json"]);
  assert.deepEqual(ledger.pending("2030-01-01", [33]), [33]);
  assert.equal(backgroundRunActive("scanner", at), true);
  assert.deepEqual(withBackgroundRunOwnership("scanner", "old-owner", () => ledger.mark("2030-01-01", 33), at), { owned: false });
  assert.throws(() => withBackgroundRunOwnership("scanner", "new-owner", () => Promise.resolve(), at), /synchronous/);
  assert.deepEqual(read("telegram-state.json"), states["telegram-state.json"]);
});

test("nested state writes preserve other documents and do not dual-write old JSON", () => {
  seedStates(); migrateTasksToSqlite();
  updateRuntimeState("job-scan.json", (current) => {
    createDeliveryLedger("reminder-state.json").mark("reminder:new", 33);
    writeRoundScanState({ startedAt: timestamp, days: 1 });
    return { value: { ...current, added: 7 }, result: null, changed: true };
  });
  assert.equal(readJobScanState().added, 7);
  assert.equal(readRoundScanState().days, 1);
  assert.deepEqual(createDeliveryLedger("reminder-state.json").pending("reminder:new", [33]), []);
  for (const [file, value] of Object.entries(states)) assert.deepEqual(read(file), value);
});

test("independent processes claim one lease, merge delivery marks and retain every handled email", async () => {
  seedStates();
  write("mail-review.json", { day: localDate(), reviewedAt: timestamp, items: Array.from({ length: 40 }, (_, i) => reviewItem(`mail-${i}`)) });
  migrateTasksToSqlite();
  const background = new URL("./background-run-domain.ts", import.meta.url).href;
  const delivery = new URL("./delivery-ledger.ts", import.meta.url).href;
  const mail = new URL("./mail-domain.ts", import.meta.url).href;
  const claimed = await Promise.all(Array.from({ length: 4 }, (_, worker) => child(`
    import { claimBackgroundRun } from ${JSON.stringify(background)};
    import { createDeliveryLedger } from ${JSON.stringify(delivery)};
    import { markMailDone } from ${JSON.stringify(mail)};
    const claimed = claimBackgroundRun('exclusive', 'owner-${worker}');
    const sql = createDeliveryLedger('telegram-state.json');
    const json = createDeliveryLedger('t.json');
    for (let i = ${worker * 10}; i < ${(worker + 1) * 10}; i++) {
      claimBackgroundRun('worker-' + i, 'owner-${worker}');
      sql.mark('concurrent', i); json.mark('concurrent', i);
      markMailDone('mail-' + i, true);
    }
    console.log(JSON.stringify(claimed));
  `)));
  assert.equal(claimed.filter((result) => result === "true").length, 1);
  const audience = Array.from({ length: 40 }, (_, i) => i);
  for (const file of ["telegram-state.json", "t.json"]) assert.deepEqual(createDeliveryLedger(file).pending("concurrent", audience), []);
  assert.equal(Object.keys(readRuntimeState("background-runs.json")).filter((name) => name.startsWith("worker-")).length, 40);
  assert.equal(readMailReview().items.filter((item) => item.done).length, 40);
});

test("missing or semantically damaged SQLite state fails closed, never reviving JSON delivery history", () => {
  seedStates(); migrateTasksToSqlite();
  const db = openTaskDatabase();
  try {
    db.prepare("UPDATE runtime_state SET payload = ? WHERE id = ?")
      .run(JSON.stringify({ id: "telegram-state.json", value: { runs: [] } }), "telegram-state.json");
  } finally { db.close(); }
  assert.throws(() => createDeliveryLedger("telegram-state.json").pending("2030-01-01", [11]), /invalid delivery runs/);
  assert.throws(() => createDeliveryLedger("telegram-state.json").mark("2030-01-01", 33), /invalid delivery runs/);
  assert.throws(() => checkTaskStorage(), /invalid delivery runs/);
  rmSync(join(directory, "tasks.sqlite"));
  assert.throws(() => readRoundScanState(), /database missing/);
  assert.throws(() => writeRuntimeState("round-scan.json", {}), /database missing/);
  assert.deepEqual(read("telegram-state.json"), states["telegram-state.json"]);
});

test("tech-event list and checkpoint roll back together on checkpoint storage failure", async () => {
  migrateTasksToSqlite();
  const event = { id: "old", title: "Expired", url: "https://example.com/old", source: "test", startAt: "2000-01-01T00:00:00Z", discoveredAt: timestamp };
  writeTechEvents([event]);
  writeTechEventScanState(states["tech-event-scan.json"]);
  const db = openTaskDatabase();
  try {
    db.exec(`CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON runtime_state
      WHEN NEW.id = 'tech-event-scan.json' BEGIN SELECT RAISE(ABORT, 'checkpoint failed'); END;`);
  } finally { db.close(); }
  await assert.rejects(() => runTechEventScan({ sources: [], now: Date.parse(timestamp) }), /checkpoint failed/);
  assert.deepEqual(readTechEvents(), [event]);
  assert.deepEqual(readRuntimeState("tech-event-scan.json"), states["tech-event-scan.json"]);
});
