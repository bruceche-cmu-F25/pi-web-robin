import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { DEFAULT_JOB_PROFILE } from "../../../../extension/robin/jobs.ts";
import { readJobs, readJobProfile, readJobScoringState, writeJobs, writeJobProfile } from "../../../../extension/robin/store.ts";

const dir = mkdtempSync(join(tmpdir(), "robin-job-routes-"));
const previous = process.env.ROBIN_DATA_DIR;
process.env.ROBIN_DATA_DIR = dir;
after(() => {
  rmSync(dir, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
  delete globalThis.__jobRouteTest;
});
const stub = join(dir, "stub.mjs");
writeFileSync(stub, `export async function runAssistantTurn() { return globalThis.__jobRouteTest.score(); }
export function makeFetchContext() { return {}; }
export async function findDeadPostings() { return globalThis.__jobRouteTest.check(); }`);
const jiti = createJiti(import.meta.url, { alias: {
  "@/lib/robin-assistant": stub,
  "@/extension/robin/job-providers": stub,
  "@": process.cwd(),
}, moduleCache: false });
const scoreRoute = await jiti.import("./score/route.ts");
const digestRoute = await jiti.import("./digest/route.ts");
const profileRoute = await createJiti(import.meta.url, { alias: { "@": process.cwd() } }).import("./profile/route.ts");
const request = (body = {}) => new Request("http://localhost/api/robin/jobs", {
  method: "POST", headers: { "Content-Type": "application/json", Host: "localhost", Origin: "http://localhost" }, body: JSON.stringify(body),
});
const posting = { id: "role", title: "AI Engineer", company: "Acme", location: "Remote US", source: "test",
  url: "https://example.com/role", status: "new", discoveredAt: new Date().toISOString() };

async function waitForRun() {
  for (let i = 0; i < 100; i++) {
    const state = readJobScoringState();
    if (!state?.running) return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("scoring did not settle");
}

test("a no-progress scoring round stops once, reports an error and leaves the pipeline alone", async () => {
  writeJobProfile({ ...DEFAULT_JOB_PROFILE, scoreBatch: 1 });
  writeJobs([posting, { ...posting, id: "second", url: "https://example.com/second" }]);
  let calls = 0;
  globalThis.__jobRouteTest = { score() { calls++; return { reply: "No pending jobs.", usedTools: [] }; } };
  assert.equal((await (await scoreRoute.POST(request())).json()).started, true);
  const state = await waitForRun();
  assert.equal(calls, 1);
  assert.match(state.error, /no progress/);
  assert.equal(state.remaining, 2);
  assert.equal(readJobs().every(job => job.status === "new" && job.score === undefined), true);
});

test("a blacklist edit during live-link checks wins before digest formatting or claiming", async () => {
  writeJobProfile({ ...DEFAULT_JOB_PROFILE, minScore: 3 });
  writeJobs([{ ...posting, score: 3.5 }]);
  let release;
  const started = new Promise(resolve => { globalThis.__jobRouteTest = { check() {
    resolve(); return new Promise(done => { release = done; });
  } }; });
  const response = digestRoute.POST(request());
  await started;
  writeJobProfile({ ...readJobProfile(), blacklist: ["Acme"] });
  release(new Set());
  const result = await (await response).json();
  assert.equal(result.count, 0);
  assert.deepEqual(result.jobIds, []);
  assert.equal(readJobs()[0].notifiedAt, undefined);
  assert.equal(readJobs()[0].status, "new");
});

test("profile API keeps work facts, stretch policy and scan ceiling separate", async () => {
  const profile = { ...DEFAULT_JOB_PROFILE, professionalExperienceMonths: 8, experienceStretchYears: 2, maxYears: 3 };
  assert.equal((await profileRoute.PUT(request(profile))).status, 200);
  assert.equal(readJobProfile().professionalExperienceMonths, 8);
  assert.equal(readJobProfile().experienceStretchYears, 2);
  assert.equal(readJobProfile().maxYears, 3);
  for (const value of [-1, 1.5, "8", 1201, {}]) {
    assert.equal((await profileRoute.PUT(request({ ...profile, professionalExperienceMonths: value }))).status, 400);
    assert.equal(readJobProfile().professionalExperienceMonths, 8);
  }
});
