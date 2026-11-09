import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { after, test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { DEFAULT_JOB_PROFILE } from "../../../../extension/robin/jobs.ts";
import { readJobs, readJobProfile, readJobScoringState, writeJobScoringState, writeJobSweepState, writeJobs, writeJobProfile } from "../../../../extension/robin/store.ts";

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
writeFileSync(stub, `export async function runAssistantTurn(...args) { return globalThis.__jobRouteTest.score(...args); }
export function makeFetchContext() { return {}; }`);
const jiti = createJiti(import.meta.url, { alias: {
  "@/lib/robin-assistant": stub,
  "@": process.cwd(),
}, moduleCache: false });
const scoreRoute = await jiti.import("./score/route.ts");
const sweepRoute = await jiti.import("./sweep/route.ts");
const scanRoute = await jiti.import("./scan/route.ts");
const backgroundRuns = await jiti.import("../../../../extension/robin/background-run-domain.ts");
const jobsRoute = await jiti.import("./route.ts");
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

test("navigation GET is bounded, read-only and leaves the full board available", async () => {
  writeJobs([posting, { ...posting, id: "saved", status: "shortlist", description: "x".repeat(50_000) }]);
  const before = readJobs();
  const get = (query = "") => new Request(`http://localhost/api/robin/jobs${query}`, { headers: { Host: "localhost" } });
  const response = await jobsRoute.GET(get("?view=navigation"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { shortlist: 1, hasNew: true });
  assert.deepEqual(readJobs(), before);
  const board = await (await jobsRoute.GET(get())).json();
  assert.equal(board.jobs.length, 2);
  assert.ok("minScore" in board && "scan" in board);
  assert.deepEqual(await (await jobsRoute.GET(get("?view=unknown"))).json(), board);
});

test("status-scoped GET retains global cards, supports history/all, and rejects invalid scope", async () => {
  writeJobs([{ ...posting, ref: { board: "fixture", id: "opaque" }, scoredBy: "private-model", scoreContext: "binding" }, { ...posting, id: "copy" }, { ...posting, id: "history", status: "applied" }]);
  const get = query => jobsRoute.GET(new Request(`http://localhost/api/robin/jobs${query}`, { headers: { Host: "localhost" } }));
  const before = readJobs();
  const full = await (await get("")).json();
  const scoped = await (await get("?status=new")).json();
  assert.deepEqual(scoped.jobs, full.jobs.filter(job => job.status === "new"));
  assert.deepEqual(scoped.cards.map(card => card.ids.length).sort(), [1, 2]);
  assert.equal(scoped.scope, "new");
  assert.deepEqual((await (await get("?status=applied")).json()).jobs, full.jobs.filter(job => job.status === "applied"));
  assert.deepEqual((await (await get("?status=all")).json()).jobs, full.jobs);
  const cardView = await (await get("?status=new&view=cards")).json();
  const expectedCards = structuredClone(scoped);
  for (const job of expectedCards.jobs) for (const field of ["ref", "alternateUrls", "yearsRequired", "scoredAt", "scoredBy", "scoreContext"]) delete job[field];
  assert.deepEqual(cardView, expectedCards);
  assert.equal((await get("?status=invalid")).status, 400);
  assert.deepEqual(readJobs(), before);
});

test("the full job board negotiates gzip without changing its JSON or navigation payload", async () => {
  writeJobs(Array.from({ length: 30 }, (_, i) => ({ ...posting, id: `role-${i}`, reason: "Repeated board evidence ".repeat(20) })));
  const get = (encoding, query = "") => jobsRoute.GET(new Request(`http://localhost/api/robin/jobs${query}`, {
    headers: { Host: "localhost", "Accept-Encoding": encoding },
  }));
  const plain = await get("identity");
  const plainText = await plain.text();
  const compressed = await get("gzip");
  assert.equal(compressed.headers.get("Content-Encoding"), "gzip");
  assert.match(compressed.headers.get("Vary"), /Accept-Encoding/);
  assert.equal(compressed.headers.get("Cache-Control"), "no-store");
  const bytes = Buffer.from(await compressed.arrayBuffer());
  assert.equal(gunzipSync(bytes).toString(), plainText);
  assert.ok(bytes.length < Buffer.byteLength(plainText) / 2);
  assert.equal((await get("gzip;q=0")).headers.get("Content-Encoding"), null);
  const navigation = await get("gzip", "?view=navigation");
  assert.equal(navigation.headers.get("Content-Encoding"), null);
  assert.deepEqual(await navigation.json(), { shortlist: 0, hasNew: true });
});

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

test("a pinned scorer that went out of scope falls back to pi's default once and says so", async () => {
  writeJobProfile({ ...DEFAULT_JOB_PROFILE, scoreBatch: 1, scoreModel: { provider: "deepseek", modelId: "deepseek-v4-flash" } });
  writeJobs([posting]);
  const models = [];
  globalThis.__jobRouteTest = { score(_mode, _prompt, _images, model) {
    models.push(model);
    if (model === undefined) throw new Error("Model is not available in the enabled scope: deepseek/deepseek-v4-flash");
    writeJobs(readJobs().map(job => ({ ...job, score: 2, reason: "scored", scoredAt: new Date().toISOString() })));
    return { reply: "done", usedTools: [] };
  } };
  assert.equal((await (await scoreRoute.POST(request())).json()).started, true);
  const state = await waitForRun();
  assert.deepEqual(models, [undefined, null]);
  assert.equal(state.error, null);
  assert.equal(state.remaining, 0);
  assert.equal(state.model, null);
  assert.equal(state.fallbackFrom, "deepseek/deepseek-v4-flash");
});

test("a fresh scoring lease in another server process blocks duplicate paid work", async () => {
  writeJobProfile({ ...DEFAULT_JOB_PROFILE, scoreBatch: 1 });
  writeJobs([posting]);
  writeJobScoringState({
    id: "remote", ownerId: "another-process", heartbeatAt: new Date().toISOString(),
    startedAt: new Date().toISOString(), finishedAt: null, running: true,
    round: 0, totalRounds: 1, startedWith: 1, remaining: 1, model: null, error: null,
  });
  let calls = 0;
  globalThis.__jobRouteTest = { score() { calls++; return { reply: "done", usedTools: [] }; } };
  const result = await (await scoreRoute.POST(request())).json();
  assert.deepEqual({ started: result.started, reason: result.reason }, { started: false, reason: "already-running" });
  assert.equal(calls, 0);
  assert.equal(readJobScoringState().id, "remote");
});

test("a fresh sweep lease in another server process blocks duplicate ATS traffic", async () => {
  const at = new Date().toISOString();
  writeJobSweepState({
    id: "remote-sweep", ownerId: "another-process", heartbeatAt: at,
    startedAt: at, finishedAt: null, running: true, boardsTotal: 10, boardsDone: 2,
    unreachable: 0, scanned: 2, matched: 0, added: 0, directories: [], cursors: {}, cursorVersion: 2, error: null,
  });
  const result = await (await sweepRoute.POST(request({ limit: 1 }))).json();
  assert.deepEqual({ started: result.started, reason: result.reason }, { started: false, reason: "already-running" });
  assert.equal(result.sweep.id, "remote-sweep");
});

test("a fresh forward-scan lease blocks duplicate board traffic", async () => {
  assert.equal(backgroundRuns.claimBackgroundRun("job-forward-scan", "another-process"), true);
  try {
    const response = await scanRoute.POST(request());
    assert.equal(response.status, 409);
    assert.equal((await response.json()).reason, "already-running");
  } finally {
    backgroundRuns.releaseBackgroundRun("job-forward-scan", "another-process");
  }
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
