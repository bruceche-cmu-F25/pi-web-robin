import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";

const prior = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-study-route-"));
process.env.ROBIN_DATA_DIR = dir;
after(() => { rmSync(dir, { recursive: true, force: true }); if (prior === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = prior; });
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, PATCH, POST, PUT } = await jiti.import("./route.ts");
const request = (method, body, origin) => new Request("http://localhost:30141/api/robin/learning/study", {
  method, headers: { host: "localhost:30141", "content-type": "application/json", ...(origin ? { origin } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("study route reads the default without writing; commits an edited week and refuses a stale edit", async () => {
  const initial = await (await GET(request("GET"))).json();
  assert.ok(initial.week.objective.includes("Python") || initial.week.objective.includes("后端"));
  assert.equal(initial.sessions[0].start, "10:00");
  assert.equal((await PATCH(request("PATCH", { date: initial.week.week, week: initial.week, expected: initial.week.updatedAt }, "https://evil.example"))).status, 403);
  assert.equal((await PATCH(request("PATCH", { date: initial.week.week, week: { objective: "bad", milestones: [] }, expected: "" }))).status, 400);
  const saved = await PATCH(request("PATCH", { date: initial.week.week, week: { objective: "每天做一道题", milestones: [{ title: "记一道题", done: false }] }, expected: initial.week.updatedAt }));
  assert.equal(saved.status, 200);
  const current = await (await GET(request("GET"))).json();
  assert.equal(current.week.objective, "每天做一道题");
  assert.notEqual(current.week.updatedAt, initial.week.updatedAt);
  assert.equal((await PATCH(request("PATCH", { date: initial.week.week, week: initial.week, expected: initial.week.updatedAt }))).status, 409);
});

test("review checkbox uses origin guard, rejects answer submissions and fences stale tabs", async () => {
  const body = { date: "2026-11-04", checked: true, expected: "" };
  assert.equal((await POST(request("POST", body, "https://evil.example"))).status, 403);
  assert.equal((await POST(request("POST", { ...body, checked: "yes" }))).status, 400);
  assert.equal((await POST(request("POST", { date: body.date, review: { recall: "answer", outcome: "mastered" }, expected: "" }))).status, 400);
  assert.equal((await POST(request("POST", { ...body, date: "2026-11-23" }))).status, 400);
  const saved = await POST(request("POST", body));
  assert.equal(saved.status, 200);
  const progress = (await saved.json()).progress;
  assert.equal((await (await GET(request("GET"))).json()).reviewChecks[body.date].checked, true);
  assert.equal((await POST(request("POST", body))).status, 409);
  assert.equal((await POST(request("POST", { ...body, checked: false, expected: progress.revision }))).status, 200);
});

test("invalid recurring sessions are rejected and cannot replace the saved schedule", async () => {
  assert.equal((await PUT(request("PUT", { sessions: [{ id: "x", title: "X", start: "10:00", end: "11:00", url: "javascript:alert(1)", days: [1], enabled: true }] }))).status, 400);
  assert.equal((await (await GET(request("GET"))).json()).sessions[0].id, "leetcode");
});
