import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-job-digest-"));
process.env.ROBIN_DATA_DIR = dir;

const { buildJobDigest } = await import("./job-domain.ts");
const { DEFAULT_JOB_PROFILE } = await import("./jobs.ts");
const { readJobProfile, readJobs, writeJobProfile, writeJobs } = await import("./store.ts");

after(() => {
  rmSync(dir, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});

const posting = {
  id: "role", title: "AI Engineer", company: "Acme", location: "Remote US", source: "test",
  url: "https://example.com/role", status: "new", discoveredAt: new Date().toISOString(),
};
/** Nothing is ever dead, so the check never removes a candidate on its own. */
const allLive = async () => new Set();

beforeEach(() => {
  writeJobProfile({ ...DEFAULT_JOB_PROFILE, minScore: 3 });
  writeJobs([{ ...posting, score: 3.5 }]);
});

test("a blacklist edit during the live-link check wins before formatting or claiming", async () => {
  // Hold the check open, edit the profile underneath it, then let it finish.
  let release;
  let opened;
  const reachedCheck = new Promise((resolve) => { opened = resolve; });
  const checkDead = () => {
    opened();
    return new Promise((done) => { release = done; });
  };

  const digest = buildJobDigest({ checkDead });
  await reachedCheck;
  writeJobProfile({ ...readJobProfile(), blacklist: ["Acme"] });
  release(new Set());

  const result = await digest;
  assert.equal(result.count, 0);
  assert.deepEqual(result.jobIds, []);
  // Never claimed, so the next slot can offer it again if the edit is undone.
  assert.equal(readJobs()[0].notifiedAt, undefined);
  assert.equal(readJobs()[0].status, "new");
});

test("a preview reads the batch without claiming it", async () => {
  const preview = await buildJobDigest({ preview: true, checkDead: allLive });
  assert.equal(preview.count, 1);
  assert.deepEqual(preview.jobIds, ["role"]);
  assert.equal(readJobs()[0].notifiedAt, undefined);

  const sent = await buildJobDigest({ checkDead: allLive });
  assert.deepEqual(sent.jobIds, ["role"]);
  assert.ok(readJobs()[0].notifiedAt);
});

test("a posting the boards confirm is gone is dropped, not sent", async () => {
  const gone = async () => new Set(["https://example.com/role"]);
  const result = await buildJobDigest({ checkDead: gone });
  assert.equal(result.count, 0);
  // Marked dropped so the next push does not spend a slot rediscovering it.
  assert.equal(readJobs()[0].status, "dropped");
});

test("the digest reports the scoring backlog alongside the batch", async () => {
  writeJobs([{ ...posting, score: 3.5 }, { ...posting, id: "unscored", url: "https://example.com/unscored" }]);
  const result = await buildJobDigest({ preview: true, checkDead: allLive });
  assert.equal(result.pending, 1);
  assert.equal(result.scoreBatch, DEFAULT_JOB_PROFILE.scoreBatch);
});
