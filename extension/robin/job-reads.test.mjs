import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-job-reads-"));
process.env.ROBIN_DATA_DIR = dir;

const { jobBoard, pendingJobCount, pendingJobIds, scorerName, scoringStatus } =
  await import("./job-domain.ts");
const { jobProfile, saveJobProfile } = await import("./job-profile.ts");
const { DEFAULT_JOB_PROFILE } = await import("./jobs.ts");
const { writeJobProfile, writeJobs } = await import("./store.ts");

after(() => {
  rmSync(dir, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});

const job = (id, extra = {}) => ({
  id, title: "AI Engineer", company: "Acme", location: "Remote US", source: "test",
  url: `https://example.com/${id}`, status: "new", discoveredAt: "2026-09-01T00:00:00.000Z",
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
