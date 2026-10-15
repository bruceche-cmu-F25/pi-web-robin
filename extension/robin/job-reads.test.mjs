import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { resetTaskStore } from "./task-store.test-support.mjs";

const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-job-reads-"));
process.env.ROBIN_DATA_DIR = dir;
resetTaskStore(dir);

const { claimJobScoringRun, claimJobSweepRun, heartbeatJobScoringRun, heartbeatJobSweepRun, jobBoard, pendingJobCount, pendingJobIds, saveJobSweepState, saveScoringState, scorerName, scoringState, scoringStatus, sweepState } =
  await import("./job-domain.ts");
const { jobProfile, saveJobProfile } = await import("./job-profile.ts");
const { DEFAULT_JOB_PROFILE } = await import("./jobs.ts");
const { readJobScoringState, readJobSweepState, writeJobProfile, writeJobScoringState, writeJobSweepState, writeJobs } = await import("./store.ts");

after(() => {
  rmSync(dir, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});

const job = (id, extra = {}) => ({
  id, title: "AI Engineer", company: "Acme", location: "Remote US", source: "test",
  url: `https://example.com/${id}`, status: "new", discoveredAt: new Date().toISOString(),
  ...extra,
});

beforeEach(() => {
  writeJobProfile({ ...DEFAULT_JOB_PROFILE });
  writeJobs([]);
});

test("the board is best-first and carries the thresholds the page explains itself with", () => {
  writeJobProfile({ ...DEFAULT_JOB_PROFILE, minScore: 3, digestSize: 7 });
  writeJobs([job("low", { score: 2 }), job("high", { score: 5 }), job("mid", { score: 4 })]);

  const board = jobBoard();
  assert.deepEqual(board.jobs.map((entry) => entry.id), ["high", "mid", "low"]);
  assert.equal(board.minScore, 3);
  assert.equal(board.digestSize, 7);
});

test("the board reports unconfigured until a company or board is tracked", () => {
  // The shipped default already tracks four boards, so start from an empty one.
  writeJobProfile({ ...DEFAULT_JOB_PROFILE, boards: [], companies: [] });
  assert.equal(jobBoard().configured, false);

  saveJobProfile({ ...DEFAULT_JOB_PROFILE, boards: ["remoteok"], companies: [] });
  assert.equal(jobBoard().configured, true);
});

test("the board does not carry the stored posting text", () => {
  writeJobs([job("one", { description: "x".repeat(5_000) })]);
  const serialised = JSON.stringify(jobBoard());
  assert.ok(serialised.length < 2_000, `board was ${serialised.length} bytes`);
});

test("the pending count and ids agree, and both come from the store each time", () => {
  writeJobs([job("scored", { score: 3, reason: "fits", scoredAt: "2026-09-02T00:00:00.000Z" }), job("fresh")]);
  assert.deepEqual(pendingJobIds(), ["fresh"]);
  assert.equal(pendingJobCount(), pendingJobIds().length);

  writeJobs([]);
  assert.equal(pendingJobCount(), 0);
});

test("a high score with no review is queued again rather than trusted", () => {
  // The rule that makes the backlog worth recounting: 4+ is the band that gets
  // pushed, so it has to survive a review before it is treated as settled.
  writeJobs([job("hot", { score: 4.5, reason: "fits", scoredAt: "2026-09-02T00:00:00.000Z" })]);
  assert.deepEqual(pendingJobIds(), ["hot"]);

  writeJobs([job("cool", { score: 3, reason: "fits", scoredAt: "2026-09-02T00:00:00.000Z" })]);
  assert.deepEqual(pendingJobIds(), []);
});

test("scoringStatus pairs the published run with the live backlog", () => {
  writeJobs([job("fresh")]);
  const status = scoringStatus();
  // No run has ever been published, but the backlog is still answerable.
  assert.equal(status.scoring, null);
  assert.equal(status.pending, 1);
  assert.equal(status.model, null);
});

test("scoring leases reject a fresh owner, expire cleanly, and reject late progress", () => {
  const base = { startedAt: "2026-10-04T10:00:00.000Z", finishedAt: null, running: true, round: 0, totalRounds: 1, startedWith: 1, remaining: 1, model: null, error: null };
  const first = { ...base, id: "first", ownerId: "runtime-one", heartbeatAt: "2026-10-04T10:00:00.000Z" };
  assert.equal(claimJobScoringRun(first, Date.parse("2026-10-04T09:58:00.000Z")), true);
  assert.equal(claimJobScoringRun({ ...first, id: "second", ownerId: "runtime-two" }, Date.parse("2026-10-04T09:59:00.000Z")), false);
  assert.equal(heartbeatJobScoringRun("first", "runtime-two", "2026-10-04T10:01:00.000Z"), false);
  assert.equal(heartbeatJobScoringRun("first", "runtime-one", "2026-10-04T10:01:00.000Z"), true);
  assert.equal(saveScoringState({ ...first, round: 1 }), true);
  assert.equal(readJobScoringState().heartbeatAt, "2026-10-04T10:01:00.000Z", "progress cannot regress a newer heartbeat");
  const second = { ...base, id: "second", ownerId: "runtime-two", heartbeatAt: "2026-10-04T10:04:00.000Z", startedAt: "2026-10-04T10:04:00.000Z" };
  assert.equal(claimJobScoringRun(second, Date.parse("2026-10-04T10:02:00.000Z")), true);
  assert.equal(saveScoringState({ ...first, round: 1 }), false, "a replaced scorer cannot overwrite the new run");
  assert.equal(readJobScoringState().id, "second");

  writeJobScoringState({ ...base, id: "abandoned", ownerId: "gone", heartbeatAt: "2020-01-01T00:00:00.000Z" });
  assert.equal(scoringState().running, false);
  assert.match(scoringState().error, /lease expired/);
  assert.equal(readJobScoringState().running, true, "GET projection does not rewrite recovery state");
});

test("directory sweep leases preserve cursors and reject a replaced writer", () => {
  const base = { startedAt: "2026-10-04T10:00:00.000Z", finishedAt: null, running: true, boardsTotal: 10, boardsDone: 4, unreachable: 0, scanned: 4, matched: 1, added: 1, directories: [], cursors: { greenhouse: 4 }, cursorVersion: 2, error: null };
  const first = { ...base, id: "sweep-one", ownerId: "runtime-one", heartbeatAt: "2026-10-04T10:00:00.000Z" };
  assert.equal(claimJobSweepRun(first, Date.parse("2026-10-04T09:58:00.000Z")), true);
  assert.equal(claimJobSweepRun({ ...first, id: "sweep-two", ownerId: "runtime-two" }, Date.parse("2026-10-04T09:59:00.000Z")), false);
  assert.equal(heartbeatJobSweepRun("sweep-one", "runtime-one", "2026-10-04T10:01:00.000Z"), true);
  assert.equal(saveJobSweepState({ ...first, boardsDone: 5, cursors: { greenhouse: 5 } }), true);
  assert.equal(readJobSweepState().heartbeatAt, "2026-10-04T10:01:00.000Z");
  const second = { ...base, id: "sweep-two", ownerId: "runtime-two", heartbeatAt: "2026-10-04T10:04:00.000Z", startedAt: "2026-10-04T10:04:00.000Z" };
  assert.equal(claimJobSweepRun(second, Date.parse("2026-10-04T10:02:00.000Z")), true);
  assert.equal(saveJobSweepState({ ...first, boardsDone: 6 }), false);
  assert.equal(readJobSweepState().id, "sweep-two");

  writeJobSweepState({ ...base, id: "abandoned-sweep", ownerId: "gone", heartbeatAt: "2020-01-01T00:00:00.000Z" });
  assert.equal(sweepState().running, false);
  assert.match(sweepState().error, /lease expired/);
  assert.equal(readJobSweepState().running, true, "read projection leaves the interrupted evidence intact");
});

test("a pinned scorer is reported as provider/modelId", () => {
  assert.equal(scorerName({ provider: "zenmux", modelId: "claude-sonnet-4-6" }), "zenmux/claude-sonnet-4-6");
  assert.equal(scorerName(null), null);
  assert.equal(scorerName(undefined), null);
});

test("saving a profile clamps out-of-range numbers rather than refusing them", () => {
  const saved = saveJobProfile({ ...DEFAULT_JOB_PROFILE, minScore: 99, maxYears: -4, digestSize: 0 });
  assert.equal(saved.minScore, 5);
  assert.equal(saved.maxYears, 0);
  assert.equal(saved.digestSize, 1);
  assert.deepEqual(jobProfile(), saved);
});

test("a company whose URL no provider recognises is refused while the user is looking at it", () => {
  assert.throws(
    () => saveJobProfile({ companies: [{ name: "Acme", url: "https://acme.example/careers" }] }),
    /not a supported job board/,
  );
  assert.throws(() => saveJobProfile({ companies: [{ url: "https://boards.greenhouse.io/acme" }] }), /needs a name/);
});

test("an omitted field falls back to its default, not to what was stored", () => {
  saveJobProfile({ ...DEFAULT_JOB_PROFILE, minScore: 5, notes: "keep me" });
  const replaced = saveJobProfile({});
  assert.equal(replaced.minScore, DEFAULT_JOB_PROFILE.minScore);
  assert.equal(replaced.notes, "");
});
