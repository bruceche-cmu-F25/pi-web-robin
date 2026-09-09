import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST, PATCH } = await jiti.import("./route.ts");
const { GET: learningGET } = await jiti.import("../learning/route.ts");
const { registerPracticeTools } = await jiti.import("../../../../extension/robin/practice-tools.ts");
const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "robin-practice-route-"));
process.env.ROBIN_DATA_DIR = directory;
const file = join(directory, "practice.json");
after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});
beforeEach(() => writeFileSync(file, "[]"));
const request = (method = "GET", body, headers = {}) => new Request("http://localhost:30141/api/robin/practice", {
  method, headers: { host: "localhost:30141", "content-type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("attempt writes still enforce same-origin, JSON, and valid problem/outcome", async () => {
  assert.equal((await POST(request("POST", {}, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(request("POST", {}, { "content-type": "text/plain" }))).status, 415);
  for (const body of [null, {}, { problem: "two-sum", outcome: "wrong" }]) {
    assert.equal((await POST(request("POST", body))).status, 400);
  }
  assert.equal((await POST(request("POST", { problem: "not-a-problem", outcome: "solved" }))).status, 404);
  assert.equal(readFileSync(file, "utf8"), "[]");
});

test("API attempts persist, update the daily budget, and agree with the coach", async () => {
  const payload = { problem: "two-sum", outcome: "solved", hintLevel: 0, confidence: 4 };
  assert.equal((await POST(request("POST", payload))).status, 200);
  const state = await (await GET(request())).json();
  assert.equal(state.records[0].attempts.length, 1);
  assert.equal(state.records[0].attempts[0].on, state.today);
  assert.equal(state.records[0].scheduleVersion, 2);
  const daily = (await (await learningGET(request())).json()).practice.daily;
  assert.equal(daily.newDone, 1);
  assert.equal(daily.newProblems.length, 0);
  assert.equal(daily.rounds, 1);
  const tools = new Map();
  registerPracticeTools({ registerTool: (tool) => tools.set(tool.name, tool) });
  const result = await tools.get("practice_due").execute("test", {});
  assert.match(JSON.stringify(result), /new 1\/1, reviews 0\/3/);
  await PATCH(request("PATCH", { problem: "two-sum", status: "solved" }));
  assert.equal(JSON.parse(readFileSync(file))[0].attempts.length, 1, "status changes cannot pretend to be practice");
});

test("legacy history is adapted on GET without rewriting it, and survives the next write", async () => {
  const legacy = [{ slug: "two-sum", status: "attempted", attempts: [], updatedAt: "2026-01-01T12:00:00Z", note: "Keep my note" }];
  writeFileSync(file, JSON.stringify(legacy));
  const original = readFileSync(file, "utf8");
  const snapshot = await (await GET(request())).json();
  assert.equal(snapshot.records[0].nextReviewOn, "2026-01-02");
  assert.equal(readFileSync(file, "utf8"), original, "GET never writes migration data");
  await POST(request("POST", { problem: "two-sum", outcome: "stuck" }));
  const saved = JSON.parse(readFileSync(file))[0];
  assert.equal(saved.note, "Keep my note");
  assert.equal(saved.attempts.length, 1);
  assert.equal(saved.attempts[0].kind, "review");
  const daily = (await (await learningGET(request())).json()).practice.daily;
  assert.equal(daily.newDone, 0);
  assert.equal(daily.reviewDone, 1);
});
