import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrateTasksToSqlite } from "./task-migration.ts";
import * as store from "./task-store.ts";

const job = (id, status) => ({ id, status, title: "Engineer", company: "Acme", url: `https://example.com/${id}`, location: "Remote", source: "test", discoveredAt: "2030-01-01", description: `Description for ${id}`, extra: { keep: true } });
const omitted = ["description", "review", "application"];
const active = row => row.status === "new" || row.status === "shortlist";

for (const backend of ["json", "sqlite"]) test(`${backend}: views retain full active records, omit only requested historical fields and never write`, () => {
  const previous = process.env.ROBIN_DATA_DIR;
  const directory = mkdtempSync(join(tmpdir(), "robin-view-"));
  process.env.ROBIN_DATA_DIR = directory;
  const parse = JSON.parse;
  try {
    const rows = [job("new", "new"), { ...job("old", "dropped"), description: "HISTORICAL_PAYLOAD_SENTINEL", review: { keep: true }, application: { keep: true } }, job("saved", "shortlist"), job("applied", "applied")];
    writeFileSync(join(directory, "jobs.json"), JSON.stringify(rows));
    if (backend === "sqlite") migrateTasksToSqlite();
    if (backend === "sqlite") JSON.parse = function (text, ...args) {
      assert.ok(!String(text).includes("HISTORICAL_PAYLOAD_SENTINEL"), "historical evidence must not cross into JS");
      return parse(text, ...args);
    };
    const expected = rows.map(row => active(row) ? row : Object.fromEntries(Object.entries(row).filter(([key]) => !omitted.includes(key))));
    assert.deepEqual(store.readTaskRecordsForView("jobs", omitted, active), expected);
    JSON.parse = parse;
    assert.deepEqual(store.readTaskRecords("jobs"), rows);
    assert.throws(() => store.readTaskRecordsForView("jobs", ["id"], active), /id/);
    assert.throws(() => store.readTaskRecordsForView("jobs", ["description') FROM jobs --"], active), /field/);
    assert.throws(() => store.readTaskRecordsForView("jobs", omitted, async () => true), /synchronous/);
    assert.deepEqual(store.readTaskRecordsForView("jobs", omitted, () => false).map(row => row.description), [undefined, undefined, undefined, undefined]);
  } finally {
    JSON.parse = parse;
    if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite view projection and hydration share one snapshot and see a caller's uncommitted edits", () => {
  const previous = process.env.ROBIN_DATA_DIR;
  const directory = mkdtempSync(join(tmpdir(), "robin-view-snapshot-"));
  process.env.ROBIN_DATA_DIR = directory;
  try {
    const original = job("one", "new");
    writeFileSync(join(directory, "jobs.json"), JSON.stringify([original]));
    migrateTasksToSqlite();
    const writer = store.openTaskDatabase();
    const changed = { ...original, status: "applied", description: "Committed after the projection" };
    try {
      const view = store.readTaskRecordsForView("jobs", omitted, row => {
        writer.prepare("UPDATE jobs SET payload = ? WHERE id = ?").run(JSON.stringify(changed), original.id);
        return active(row);
      });
      assert.deepEqual(view, [original], "never combine old metadata with a newer JD or status");
    } finally { writer.close(); }
    assert.deepEqual(store.readTaskRecords("jobs"), [changed]);
    store.withTaskTransaction(() => {
      store.updateTaskRecords("jobs", rows => { rows[0].status = "new"; return { value: null, changed: true }; }, [original.id]);
      assert.equal(store.readTaskRecordsForView("jobs", omitted, active)[0].description, changed.description);
    });
    const db = store.openTaskDatabase();
    try { db.exec("PRAGMA user_version = 2"); } finally { db.close(); }
    assert.throws(() => store.readTaskRecordsForView("jobs", omitted, active), /mismatch/);
  } finally {
    if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
