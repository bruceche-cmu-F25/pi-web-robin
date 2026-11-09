import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrateTasksToSqlite } from "./task-migration.ts";
import * as store from "./task-store.ts";

const job = (id, status = "new") => ({ id, status, title: id, company: "Acme", url: `https://example.com/${id}`, location: "Remote", source: "test", discoveredAt: "2030-01-01", extra: { preserved: true } });

for (const backend of ["json", "sqlite"]) test(`${backend}: selected records preserve order, identities, missing rows and atomic edits`, () => {
  const previous = process.env.ROBIN_DATA_DIR;
  const directory = mkdtempSync(join(tmpdir(), "robin-selected-"));
  process.env.ROBIN_DATA_DIR = directory;
  try {
    const initial = [{ ...job("first"), bucket: "__proto__" }, { ...job("second", "shortlist"), bucket: 1 }, { ...job("third"), bucket: { nested: true } }];
    writeFileSync(join(directory, "jobs.json"), JSON.stringify(initial));
    if (backend === "sqlite") migrateTasksToSqlite();
    assert.deepEqual(store.readTaskRecords("jobs", ["third", "missing", "first", "third"]), [initial[0], initial[2]]);
    assert.deepEqual(store.readTaskRecords("jobs", []), []);
    assert.deepEqual(store.readTaskRecords("jobs", ["' OR 1=1 --"]), []);
    assert.deepEqual(store.readTaskRecords("jobs", [...Array.from({ length: 1200 }, (_, i) => `missing-${i}`), "first"]), [initial[0]]);
    assert.deepEqual(store.countTaskRecordsByField("jobs", "status"), new Map([["new", 2], ["shortlist", 1]]));
    assert.deepEqual(store.countTaskRecordsByField("jobs", "bucket"), new Map([["__proto__", 1]]), "only string values count on both backends");
    assert.equal(store.countTaskRecordsByField("jobs", "absent").size, 0);
    const receipt = store.updateTaskRecords("jobs", rows => {
      assert.deepEqual(rows.map(row => row.id), ["first", "third"]);
      rows.reverse(); // A targeted edit never reorders the collection.
      rows[0].note = "changed";
      rows[1].status = "applied";
      return { value: "saved", changed: true };
    }, ["third", "missing", "first"]);
    assert.equal(receipt, "saved");
    const edited = [{ ...initial[0], status: "applied" }, initial[1], { ...initial[2], note: "changed" }];
    assert.deepEqual(store.readTaskRecords("jobs"), edited);
    assert.equal(store.countTaskRecordsByField("jobs", "status").get("new"), 1);
    store.updateTaskRecords("jobs", rows => { rows[0].note = "discard"; return { value: null, changed: false }; }, ["first"]);
    assert.throws(() => store.updateTaskRecords("jobs", async rows => {
      rows[0].note = "must not commit an async callback";
      return { value: null, changed: true };
    }, ["first"]), /synchronous/);
    assert.deepEqual(store.readTaskRecords("jobs"), edited);
    assert.throws(() => store.updateTaskRecords("jobs", rows => {
      rows[0].note = "must roll back";
      rows.push(job("not-selected"));
      return { value: null, changed: true };
    }, ["first"]), /selected|insert/i);
    assert.throws(() => store.updateTaskRecords("jobs", rows => {
      rows[0].id = "renamed";
      return { value: null, changed: true };
    }, ["first"]), /selected|insert/i);
    assert.throws(() => store.updateTaskRecords("jobs", rows => {
      rows.push({ ...rows[0] }); return { value: null, changed: true };
    }, ["first"]), /duplicate/i);
    assert.deepEqual(store.readTaskRecords("jobs"), edited);
    store.updateTaskRecords("jobs", rows => { rows.splice(0, 1); return { value: null, changed: true }; }, ["second"]);
    assert.deepEqual(store.readTaskRecords("jobs"), [edited[0], edited[2]]);
    store.updateTaskRecords("jobs", rows => { rows.push(job("fourth")); return { value: null, changed: true }; });
    assert.deepEqual(store.readTaskRecords("jobs").map(row => row.id), ["first", "third", "fourth"]);
    assert.throws(() => store.countTaskRecordsByField("jobs", "status') FROM jobs --"), /field/i);
  } finally {
    if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite selected operations never deserialize unrelated rows; nested edits and rollback stay atomic", () => {
  const previous = process.env.ROBIN_DATA_DIR;
  const directory = mkdtempSync(join(tmpdir(), "robin-selected-sqlite-"));
  process.env.ROBIN_DATA_DIR = directory;
  const parse = JSON.parse;
  try {
    writeFileSync(join(directory, "jobs.json"), JSON.stringify([job("first"), { ...job("second"), description: "UNRELATED_PAYLOAD_SENTINEL" }]));
    migrateTasksToSqlite();
    JSON.parse = function (text, ...args) {
      assert.ok(!String(text).includes("UNRELATED_PAYLOAD_SENTINEL"), "a primary-key operation must not parse other jobs");
      return parse(text, ...args);
    };
    assert.equal(store.readTaskRecords("jobs", ["first"])[0].id, "first");
    assert.equal(store.countTaskRecordsByField("jobs", "status").get("new"), 2);
    store.updateTaskRecords("jobs", rows => { rows[0].note = "saved"; return { value: null, changed: true }; }, ["first"]);
    JSON.parse = parse;
    store.withTaskTransaction(() => {
      store.updateTaskRecords("jobs", rows => {
        store.updateTaskRecords("jobs", others => { others[0].note = "nested"; return { value: null, changed: true }; }, ["second"]);
        rows[0].note = "outer";
        return { value: null, changed: true };
      }, ["first"]);
      assert.equal(store.readTaskRecords("jobs", ["second"])[0].note, "nested");
      assert.equal(store.countTaskRecordsByField("jobs", "note").get("outer"), 1);
    });
    const before = store.readTaskRecords("jobs");
    assert.throws(() => store.withTaskTransaction(() => {
      store.updateTaskRecords("jobs", rows => { rows[0].note = "rollback"; return { value: null, changed: true }; }, ["first"]);
      throw new Error("rollback test");
    }), /rollback test/);
    assert.deepEqual(store.readTaskRecords("jobs"), before);
    const db = store.openTaskDatabase();
    try { db.exec("PRAGMA user_version = 2"); } finally { db.close(); }
    assert.throws(() => store.readTaskRecords("jobs", []), /mismatch/);
    assert.throws(() => store.countTaskRecordsByField("jobs", "status"), /mismatch/);
    assert.throws(() => store.updateTaskRecords("jobs", () => ({ value: null, changed: false }), []), /mismatch/);
  } finally {
    JSON.parse = parse;
    if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
