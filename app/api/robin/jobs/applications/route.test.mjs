import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { claimBackgroundRun, releaseBackgroundRun } from "../../../../../extension/robin/background-run-domain.ts";
import { resetTaskStore } from "../../../../../extension/robin/task-store.test-support.mjs";
import { readJobs, writeJobs } from "../../../../../extension/robin/store.ts";
const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "robin-app-routes-"));
process.env.ROBIN_DATA_DIR = dir;
resetTaskStore(dir);
const route = await createJiti(import.meta.url, { alias: { "@": process.cwd() } }).import("./route.ts");
after(() => {
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});
const request = (method, body, origin = "http://localhost") => new Request("http://localhost/api/robin/jobs/applications", {
  method, headers: { Host: "localhost", Origin: origin, "Content-Type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
test("read-only board exposes no resume path, common answers or extension credentials", async () => {
  const response = await route.GET(request("GET"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.settings.enabled, false);
  for (const key of ["answers", "resumePath", "extensionToken"]) assert.equal(key in body.settings, false);
});
test("API accepts schedule changes only; no submit action or forged receipt", async () => {
  assert.equal((await route.PATCH(request("PATCH", { at: "08:45", dailyLimit: 3 }))).status, 200);
  for (const patch of [{ answers: { Email: "forged" } }, { resumePath: "/etc/passwd" }, { dailyLimit: 100 }, { enabled: "yes" }]) {
    assert.equal((await route.PATCH(request("PATCH", patch))).status, 400);
  }
  assert.equal((await route.POST(request("POST", { action: "submit", id: "1" }))).status, 400);
  assert.equal((await route.POST(request("POST", { action: "receipt" }))).status, 400);
  assert.equal((await route.POST(request("POST", { action: "prepare" }))).status, 400, "missing approved PDF is surfaced synchronously");
  assert.equal((await route.PATCH(request("PATCH", { enabled: false }, "https://evil.test"))).status, 403);
});
test("dismiss removes only the board row, requires a valid id and same origin", async () => {
  const row = { id: "dismiss-fixture", company: "Example", title: "Engineer", status: "new", url: "https://example.com/job", location: "US", source: "greenhouse", discoveredAt: new Date().toISOString(), application: {
    attemptId: "attempt", workflowVersion: 2, stage: "error", updatedAt: new Date().toISOString(), days: [], fields: [], blockers: [],
  } };
  writeJobs([row]);
  for (const id of [undefined, "", 123, "x".repeat(101), "missing"]) {
    assert.equal((await route.POST(request("POST", { action: "dismiss", id }))).status, 400);
  }
  assert.equal((await route.POST(request("POST", { action: "dismiss", id: row.id }, "https://evil.test"))).status, 403);
  const response = await route.POST(request("POST", { action: "dismiss", id: row.id }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 0);
  const saved = readJobs()[0];
  assert.ok(saved.application.dismissedAt);
  assert.deepEqual(saved, { ...row, application: { ...row.application, dismissedAt: saved.application.dismissedAt } });
  assert.equal((await route.POST(request("POST", { action: "dismiss", id: row.id }))).status, 200);
});

test("an active remote browser lane refuses overlapping actions", async () => {
  claimBackgroundRun("job-applications", "remote");
  try {
    assert.equal((await route.POST(request("POST", { action: "prepare" }))).status, 409);
    assert.equal((await route.POST(request("POST", { action: "dismiss", id: "dismiss-fixture" }))).status, 409);
  }
  finally { releaseBackgroundRun("job-applications", "remote"); }
});
