import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), "robin-note-finals-"));
process.env.ROBIN_DATA_DIR = dataDir;
const {
  cancelNoteFinalize,
  isNoteFinalizeRunning,
  readNoteFinalsView,
  startNoteFinalize,
} = await import("./note-finalize-jobs.ts");

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a finalize outlives its request and leaves the finished note on disk", async () => {
  const job = deferred();
  const started = startNoteFinalize("draft-a", () => job.promise);

  assert.equal(started.status, "running");
  assert.equal(isNoteFinalizeRunning("draft-a"), true);
  assert.equal(readNoteFinalsView()["draft-a"].status, "running");
  assert.throws(() => startNoteFinalize("draft-a", () => job.promise), /already being prepared/);

  job.resolve({ title: "React state", content: "# React state" });
  await settle();

  const ready = readNoteFinalsView()["draft-a"];
  assert.equal(ready.status, "ready");
  assert.equal(ready.title, "React state");
  assert.equal(ready.content, "# React state");
  assert.equal(isNoteFinalizeRunning("draft-a"), false);
});

test("a failed run is recorded; a cancelled one leaves nothing behind", async () => {
  const failing = deferred();
  startNoteFinalize("draft-b", () => failing.promise);
  failing.reject(new Error("model unavailable"));
  await settle();
  assert.equal(readNoteFinalsView()["draft-b"].status, "error");
  assert.equal(readNoteFinalsView()["draft-b"].error, "model unavailable");

  const slow = deferred();
  let signal;
  startNoteFinalize("draft-c", (received) => { signal = received; return slow.promise; });
  assert.equal(cancelNoteFinalize("draft-c"), true);
  assert.equal(signal.aborted, true);
  slow.resolve({ title: "late", content: "late" });
  await settle();
  assert.equal(readNoteFinalsView()["draft-c"], undefined);
});

test("a running record with no live job reads as interrupted, without being rewritten", () => {
  const file = join(dataDir, "note-finals.json");
  writeFileSync(file, JSON.stringify({ orphan: { status: "running", startedAt: "2026-09-14T00:00:00Z" } }));

  const view = readNoteFinalsView().orphan;
  assert.equal(view.status, "error");
  assert.match(view.error, /Interrupted/);
  // Polled GETs read this, so the correction is derived, never written back.
  assert.equal(JSON.parse(readFileSync(file, "utf8")).orphan.status, "running");
});
