// Mocked read-only APIs; never starts finalization, scanning, scoring or applications.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(() => {
    localStorage.setItem("pi-locale", "en");
    window.fixtureVisibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.fixtureVisibility });
    window.fixtureIntervals = new Map();
    const start = window.setInterval, stop = window.clearInterval;
    window.setInterval = (fn, ms, ...args) => { const id = start(fn, ms, ...args); window.fixtureIntervals.set(id, ms); return id; };
    window.clearInterval = (id) => { window.fixtureIntervals.delete(id); stop(id); };
  });
  const reads = { notes: 0, sweep: 0, score: 0, applications: 0 };
  let finalRunning = true, running = false;
  const draft = { id: "poll-fixture", title: "Poll fixture", text: "Saved", notionParentId: "", updatedAt: new Date().toISOString() };
  await context.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    assert.equal(request.method(), "GET", `Unexpected mutation ${path}`);
    let data = { attachments: [], vaults: [], archives: [], canvases: [], pages: [], modelList: [], todos: [], events: [], jobs: [], rounds: [], records: [], review: null, finals: {}, today: "2026-10-27" };
    if (path === "/api/robin/notes") data = { drafts: [draft] };
    if (path === "/api/robin/notes-agent") { reads.notes++; data = { finals: finalRunning ? { [draft.id]: { draftId: draft.id, status: "running", startedAt: new Date().toISOString(), sessionId: "fixture" } } : {} }; }
    if (path === "/api/robin/jobs/sweep") { reads.sweep++; data = { sweep: { running, boardsDone: 0, boardsTotal: 10, scanned: 0, matched: 0, unreachable: 0, directories: [] } }; }
    if (path === "/api/robin/jobs/score") { reads.score++; data = { scoring: { running, startedWith: 0, remaining: 0, round: 1, totalRounds: 1, model: null }, pending: 0, model: null }; }
    if (path === "/api/robin/jobs/applications") { reads.applications++; data = { running, rows: [], counts: {}, today: 0, day: "2026-10-27", settings: { configured: false, enabled: false, at: "09:00", timeZone: "UTC", dailyLimit: 0 } }; }
    return route.fulfill({ json: data });
  });
  const visibility = async (value) => page.evaluate((value) => { window.fixtureVisibility = value; document.dispatchEvent(new Event("visibilitychange")); }, value);
  const intervals = (ms) => page.evaluate((ms) => [...window.fixtureIntervals.values()].filter((value) => value === ms).length, ms);
  const advance = async (ms) => { await page.clock.runFor(ms); await page.waitForTimeout(200); };
  await page.goto("/notes?draft=poll-fixture");
  await page.locator('main[class*="notePane"] textarea').waitFor();
  await page.waitForFunction(() => [...window.fixtureIntervals.values()].includes(2500));
  assert.ok(await intervals(1000) > 0, "running finalization has an elapsed clock");
  await visibility("hidden");
  assert.equal(await intervals(2500), 0);
  assert.equal(await intervals(1000), 0);
  const hiddenReads = reads.notes;
  await advance(10_000);
  assert.equal(reads.notes, hiddenReads, "hidden note finalization does not poll");
  await visibility("visible"); await page.waitForTimeout(200);
  assert.ok(reads.notes > hiddenReads, "returning refreshes immediately");
  assert.equal(await intervals(2500), 1);
  finalRunning = false;
  await advance(3000);
  assert.equal(await intervals(2500), 0);
  assert.equal(await intervals(1000), 0);
  await page.goto("/dashboard/jobs");
  await page.getByRole("heading", { name: "Application automation", exact: true }).waitFor();
  await page.waitForTimeout(200);
  const idle = { ...reads };
  await advance(10_000);
  for (const key of ["sweep", "score", "applications"]) assert.equal(reads[key], idle[key], `${key} is slow while idle`);
  running = true;
  await advance(51_000);
  assert.equal(await intervals(4000), 2);
  assert.equal(await intervals(5000), 1);
  const active = { ...reads };
  // Allow each mocked fetch to settle before advancing another polling period.
  await advance(5500); await advance(5500);
  for (const key of ["sweep", "score", "applications"]) assert.ok(reads[key] >= active[key] + 2, `${key} updates during a run: ${active[key]} → ${reads[key]}; errors: ${errors.join(", ")}`);
  await visibility("hidden");
  const asleep = { ...reads };
  await advance(10_000);
  for (const key of ["sweep", "score", "applications"]) assert.equal(reads[key], asleep[key]);
  running = false;
  await visibility("visible"); await page.waitForTimeout(300);
  assert.equal(await intervals(4000), 0); assert.equal(await intervals(5000), 0);
  const settled = { ...reads };
  await advance(10_000);
  for (const key of ["sweep", "score", "applications"]) assert.equal(reads[key], settled[key], `${key} returns to idle cadence`);
  assert.deepEqual(errors, []);
  console.log("PASS: hidden note polling/clock pause and recover; Jobs idle/active/hidden cadence; no mutations.");
} finally { await browser.close(); }
