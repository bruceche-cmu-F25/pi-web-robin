// Existing server; application APIs mocked. No real session/model/storage writes.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/session-list-loading.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) {
    const response = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(response.ok(), `Login failed: ${response.status()}`);
  }
  await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  const cwd = "/tmp/session-list-fixture";
  const row = (id, name) => ({ id, name, cwd, projectRoot: cwd, projectKey: cwd,
    path: `${cwd}/${id}.jsonl`, created: "2026-10-01T00:00:00Z", modified: "2026-10-01T00:00:00Z", messageCount: 1, firstMessage: name });
  const original = row("original", "Original session");
  const added = row("added", "Arrived during listing");
  const requests = [], writes = [], errors = [];
  const detailRequests = [], stateRequests = [];
  let releaseDetail;
  const detailGate = new Promise(resolve => { releaseDetail = resolve; });
  let release;
  let held = new Promise(resolve => { release = resolve; });
  let holding = true, fail = false, version = 2, polls = 0;
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === "/api/cwd/validate") return route.fulfill({ json: { cwd, projectRoot: cwd, projectKey: cwd } });
    if (request.method() !== "GET") writes.push(`${request.method()} ${path}`);
    if (path === "/api/sessions") {
      const snapshotVersion = holding ? 1 : version;
      const shouldFail = fail;
      requests.push({ query: url.search, version: snapshotVersion });
      if (holding) await held;
      return route.fulfill(shouldFail ? { status: 503, json: { error: "Temporary failure" } } : { json: {
        sessions: snapshotVersion === 1 ? [original] : [original, added], sessionListVersion: snapshotVersion,
        runningSessionIds: ["added"],
      } });
    }
    if (path === "/api/sessions/original") {
      detailRequests.push(url.search);
      await detailGate;
      return route.fulfill({ json: { sessionId: "original", info: original, filePath: original.path,
        leafId: "answer", tree: [], treeFormat: "summary", snapshotRevision: "fixture-1",
        context: { messages: [{ role: "assistant", content: [{ type: "text", text: "Single-flight detail fixture" }] }],
          entryIds: ["answer"], oldestEntryId: "answer", hasMore: false, thinkingLevel: "off" } } });
    }
    if (path === "/api/sessions/original/state") {
      stateRequests.push(path);
      return route.fulfill({ json: { running: false } });
    }
    if (path === "/api/agent/running") {
      polls++;
      return route.fulfill({ json: { runningSessionIds: ["added"], awaitingInputSessionIds: [], sessionListVersion: version, sessionUiStateRevision: 0 } });
    }
    const fixtures = {
      "/api/home": { home: "/tmp", generalProject: { root: cwd, key: cwd } },
      "/api/sessions/ui-state": { state: { version: 1, revision: 0, sessions: {}, projects: {}, projectOrder: [cwd] } },
      "/api/models": { models: [], modelList: [] },
      "/api/worktrees": { isGit: false, projectRoot: cwd, projectKey: cwd, worktrees: [] },
      "/api/git/status": { files: [] },
      "/api/robin/jobs": { shortlist: 0, hasNew: false },
    };
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage();
  await page.clock.install();
  page.on("pageerror", error => errors.push(error.message));
  const waitFor = async (predicate) => {
    for (let i = 0; i < 200; i++) { if (predicate()) return; await page.waitForTimeout(25); }
    assert.ok(predicate(), "fixture condition timed out");
  };
  const poll = async () => {
    const before = polls;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => polls > before);
    await page.waitForTimeout(150);
  };
  await page.goto(`/?cwd=${encodeURIComponent(cwd)}`);
  await waitFor(() => requests.length > 0 && polls > 0);
  await page.waitForTimeout(300);
  const startupRequests = requests.length;
  assert.ok(startupRequests <= 2, `startup must not add poll/background reloads to the summary + details reads: ${JSON.stringify(requests)}`);
  await poll(); await poll();
  assert.equal(requests.length, startupRequests, "polling during a slow initial load must not download the catalogue again");
  holding = false; release();
  await poll();
  await page.locator('[data-row-key="session:group:added"] .session-tree-main').waitFor();
  await page.waitForTimeout(300);
  const settled = requests.length;
  await poll();
  assert.equal(requests.length, settled, "an unchanged version does not re-download the catalogue");
  fail = true; version++;
  await poll();
  assert.ok(requests.length > settled, "a changed version requests a fresh catalogue");
  const failed = requests.length;
  fail = false;
  await poll();
  assert.ok(requests.length > failed, "failed list requests release the in-flight guard for a retry");
  await page.locator('[data-row-key="session:group:added"] .session-tree-main').waitFor();
  // A transport that never returns must not hold the polling guard forever.
  holding = true; held = new Promise(resolve => { release = resolve; }); version++;
  const beforeTimeout = requests.length;
  await poll();
  assert.equal(requests.length, beforeTimeout + 1);
  await page.clock.fastForward(30_001);
  await page.waitForTimeout(100);
  holding = false; release();
  await poll();
  assert.ok(requests.length > beforeTimeout + 1, "timeout releases the guard and the same version retries");
  await page.locator('[data-row-key="session:group:added"] .session-tree-main').waitFor();
  await page.goto("/?session=original");
  await waitFor(() => detailRequests.length > 0);
  await page.waitForTimeout(300);
  assert.equal(detailRequests.length, 1, "Strict Mode mount replay must share the forced detail request");
  assert.match(detailRequests[0], /force=1/, "coalescing must not remove the disk freshness check");
  releaseDetail();
  await page.getByText("Single-flight detail fixture", { exact: true }).waitFor();
  await waitFor(() => stateRequests.length > 0);
  await page.waitForTimeout(200);
  assert.equal(stateRequests.length, 1, "the state read is part of the same flight");
  assert.deepEqual(writes, [], "list reads never start or change a session");
  assert.deepEqual(errors, []);
  console.log(`PASS: ${startupRequests} startup list requests; slow loads do not overlap polls; changes/failures/timeouts recover; one forced detail/state read on mount.`);
} finally { await browser.close(); }
