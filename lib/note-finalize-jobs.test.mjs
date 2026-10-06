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
  noteFinalizeRunName,
  readNoteFinalsView,
  startNoteFinalize,
} = await import("./note-finalize-jobs.ts");
const {
  claimBackgroundRun,
  releaseBackgroundRun,
  RUN_LEASE_MS,
} = await import("../extension/robin/background-run-domain.ts");
const { readNoteFinals, writeNoteFinal } = await import("../extension/robin/notes-agent-state.ts");

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

test("a remote finalizer blocks duplicate model work and can be cancelled here", () => {
  const draftId = "remote-draft";
  const runName = noteFinalizeRunName(draftId);
  assert.equal(claimBackgroundRun(runName, "remote-owner"), true);
  writeNoteFinal(draftId, { status: "running", startedAt: new Date().toISOString() });

  assert.equal(isNoteFinalizeRunning(draftId), true);
  assert.throws(() => startNoteFinalize(draftId, async () => ({ title: "duplicate", content: "duplicate" })), /already being prepared/);
  assert.equal(cancelNoteFinalize(draftId), true);
  assert.equal(isNoteFinalizeRunning(draftId), false);
  assert.equal(readNoteFinals()[draftId], undefined);
});

test("a replaced finalizer cannot publish a late result or release its replacement", async () => {
  const draftId = "replaced-draft";
  const job = deferred();
  startNoteFinalize(draftId, () => job.promise);
  const runName = noteFinalizeRunName(draftId);
  const replacementAt = Date.now() + RUN_LEASE_MS;
  assert.equal(claimBackgroundRun(runName, "replacement-owner", replacementAt), true);

  job.resolve({ title: "late title", content: "late content" });
  await settle();
  assert.equal(readNoteFinals()[draftId].status, "running");
  assert.equal(readNoteFinals()[draftId].title, undefined);
  assert.equal(isNoteFinalizeRunning(draftId), true);

  assert.equal(releaseBackgroundRun(runName, "replacement-owner"), true);
  cancelNoteFinalize(draftId);
});
