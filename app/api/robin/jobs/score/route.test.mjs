import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "job-score-route-"));
const stub = join(root, "runtime.mjs");
writeFileSync(stub, `
const state = () => globalThis.__jobScoreRouteTest;
export const scoringStatus = () => { state().reads++; return state().status; };
export const startJobScoring = () => { state().starts++; if (state().error) throw state().error; return state().result; };
`);
const route = await createJiti(import.meta.url, { alias: {
  "@/lib/job-scoring-runner": stub,
  "@/extension/robin/job-domain": stub,
  "@": process.cwd(),
} }).import("./route.ts");
let state;
beforeEach(() => {
  state = globalThis.__jobScoreRouteTest = {
    starts: 0, reads: 0,
    status: { scoring: null, pending: 1, model: null },
    result: { started: true, scoring: { id: "fixture", running: true } },
  };
});
after(() => { delete globalThis.__jobScoreRouteTest; rmSync(root, { recursive: true, force: true }); });
const request = (method = "POST", headers = {}) => new Request("http://localhost/api/robin/jobs/score", {
  method, headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json", ...headers },
});

test("GET reads the Job domain without starting scoring", async () => {
  const response = await route.GET(request("GET"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), state.status);
  assert.equal(state.reads, 1);
  assert.equal(state.starts, 0);
});

test("POST returns acceptance and refusal receipts unchanged", async () => {
  for (const result of [state.result,
    { started: false, reason: "already-running", scoring: { id: "remote" } },
    { started: false, reason: "nothing-pending", scoring: null },
  ]) {
    state.result = result;
    const response = await route.POST(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), result);
  }
  assert.equal(state.starts, 3);
});

test("the HTTP adapter keeps origin/content-type guards before starting work", async () => {
  assert.equal((await route.POST(request("POST", { Origin: "https://untrusted.example" }))).status, 403);
  assert.equal((await route.POST(request("POST", { "Content-Type": "text/plain" }))).status, 415);
  assert.equal(state.starts, 0);
});

test("synchronous start failures keep the existing JSON error response", async () => {
  state.error = new Error("Storage unavailable");
  const response = await route.POST(request());
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Storage unavailable" });
});
