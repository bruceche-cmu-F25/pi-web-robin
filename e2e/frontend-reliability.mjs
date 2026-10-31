// Every business request is intercepted. No real attachments, links, scans or paid turns.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
const errors = [];
async function context(options = {}) {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", ...options });
  if (process.env.PI_WEB_PASSWORD) {
    const auth = await ctx.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(auth.ok(), `Test authentication returned HTTP ${auth.status()}`);
  }
  await ctx.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  return ctx;
}
const fallback = { today: "2026-10-29", to: "2026-11-04", timezone: "UTC", minuteOfDay: 600, now: "2026-10-29T10:00:00Z", revision: "fixture", attachments: [], vaults: [], archives: [], canvases: [], pages: [], modelList: [], todos: [], events: [], jobs: [], rounds: [], records: [], review: null, finals: {}, conflicts: [] };
async function wait(page, predicate) {
  for (let i = 0; !(await predicate()) && i < 150; i++) await page.waitForTimeout(20);
  assert.ok(await predicate(), "fixture condition reached");
}
async function notes() {
  const ctx = await context();
  const page = await ctx.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.clock.install();
  const a = { id: "note-a", title: "Note A", text: "Saved A", notionParentId: "", updatedAt: new Date().toISOString() };
  const b = { ...a, id: "note-b", title: "Note B", text: "Saved B" };
  let files = [{ id: "one", name: "fixture.pdf", kind: "pdf", pages: 1 }, { id: "two", name: "keep.pdf", kind: "pdf", pages: 2 }];
  let deletions = 0, releaseDelete, holdRead = false, releaseRead;
  let uploads = 0, holdUpload = false, releaseUpload;
  const heldReads = [];
  let finalActive = false, finalReady = false, holdPoll = false, releasePoll;
  const running = { draftId: a.id, status: "running", startedAt: new Date().toISOString(), sessionId: "fixture" };
  await ctx.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === "/api/robin/notes/attachments") {
      if (req.method() === "POST") {
        const attachment = { id: `uploaded-${++uploads}`, name: `uploaded-${uploads}.pdf`, kind: "pdf", pages: 1 };
        files = [...files, attachment];
        if (holdUpload) { holdUpload = false; await new Promise(resolve => { releaseUpload = resolve; }); }
        return route.fulfill({ json: { attachment } });
      }
      if (req.method() === "DELETE") {
        assert.equal(req.postDataJSON().id, "one");
        deletions++;
        if (deletions === 1) { await new Promise(resolve => { releaseDelete = resolve; }); return route.fulfill({ status: 503, json: { error: "Fixture delete failed" } }); }
        if (deletions === 2) return route.abort("failed");
        files = files.filter(file => file.id !== "one");
        return route.fulfill({ json: { ok: true } });
      }
      assert.equal(req.method(), "GET");
      const attachments = new URL(req.url()).searchParams.get("draftId") === a.id ? [...files] : [];
      if (holdRead && attachments.length) {
        await new Promise(resolve => {
          heldReads.push(resolve);
          releaseRead = () => { holdRead = false; for (const resume of heldReads.splice(0)) resume(); };
        });
      }
      return route.fulfill({ json: { attachments } });
    }
    if (path === "/api/robin/notes-agent") {
      if (req.method() === "POST") {
        assert.equal(req.postDataJSON().action, "cancel", "no model work may start");
        finalActive = false; return route.fulfill({ json: { ok: true } });
      }
      assert.equal(req.method(), "GET");
      if (!finalActive) return route.fulfill({ json: { finals: {} } });
      if (holdPoll) {
        holdPoll = false;
        await new Promise(resolve => { releasePoll = resolve; });
        return route.fulfill({ json: { finals: { [a.id]: running } } });
      }
      return route.fulfill({ json: { finals: { [a.id]: finalReady ? { ...running, status: "ready", title: "Prepared", content: "Prepared content" } : running } } });
    }
    assert.equal(req.method(), "GET", `Unexpected write ${path}`);
    return route.fulfill({ json: path === "/api/robin/notes" ? { drafts: [a, b] } : fallback });
  });
  await page.goto(`/notes?draft=${a.id}`);
  const remove = page.getByRole("button", { name: "Remove fixture.pdf", exact: true });
  await remove.click(); await wait(page, () => !!releaseDelete);
  assert.equal(await remove.isVisible(), true, "unconfirmed removal keeps the file visible");
  assert.equal(await remove.isDisabled(), true);
  releaseDelete();
  await page.getByRole("status").filter({ hasText: "Could not remove fixture.pdf" }).waitFor();
  assert.equal(await remove.isEnabled(), true, "same control offers retry");
  await remove.click(); await wait(page, async () => deletions === 2 && await remove.isEnabled());
  assert.equal(await remove.isVisible(), true, "network rejection also retains the attachment");
  await page.getByRole("button", { name: /^Note B/ }).click();
  await page.getByRole("button", { name: /^Note A/ }).waitFor();
  holdRead = true;
  await page.getByRole("button", { name: /^Note A/ }).click(); await wait(page, () => !!releaseRead);
  await remove.click(); await remove.waitFor({ state: "detached" });
  releaseRead(); await page.waitForTimeout(100);
  assert.equal(await remove.count(), 0, "stale GET cannot resurrect a confirmed removal");
  assert.equal(await page.getByRole("button", { name: "Remove keep.pdf", exact: true }).count(), 1);
  assert.equal(deletions, 3);

  // The earlier list snapshot must not erase a newly acknowledged upload.
  releaseRead = undefined; holdRead = true;
  await page.reload(); await wait(page, () => !!releaseRead);
  const uploadInput = page.locator('main[class*="notePane"] input[type="file"]');
  await uploadInput.setInputFiles({ name: "fixture.pdf", mimeType: "application/pdf", buffer: Buffer.from("fixture") });
  const uploaded = page.getByRole("button", { name: "Remove uploaded-1.pdf", exact: true });
  await uploaded.waitFor();
  const oldUploadRead = page.waitForResponse(response => response.url().includes(`/notes/attachments?draftId=${a.id}`) && response.request().method() === "GET");
  releaseRead(); await (await oldUploadRead).finished(); await page.waitForTimeout(200);
  assert.equal(await uploaded.count(), 1, "old GET cannot erase a confirmed upload");

  // A read may already contain an upload whose POST response is still travelling.
  holdUpload = true;
  await uploadInput.setInputFiles({ name: "second.pdf", mimeType: "application/pdf", buffer: Buffer.from("fixture") });
  await wait(page, () => !!releaseUpload);
  await page.getByRole("button", { name: /^Note B/ }).click();
  await page.getByRole("button", { name: /^Note A/ }).click();
  const second = page.getByRole("button", { name: "Remove uploaded-2.pdf", exact: true });
  await second.waitFor(); releaseUpload(); await page.waitForTimeout(100);
  assert.equal(await second.count(), 1, "upload receipt must not duplicate an already-read attachment");

  finalActive = true;
  await page.reload(); await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
  holdPoll = true;
  await page.clock.runFor(2600); await wait(page, () => !!releasePoll);
  const earlier = releasePoll; releasePoll = undefined; finalReady = true;
  await page.clock.runFor(2600);
  const back = page.getByRole("button", { name: "Back to editing", exact: true }); await back.waitFor();
  earlier(); await page.waitForTimeout(150);
  assert.equal(await back.isVisible(), true, "old running snapshot cannot overwrite ready");

  finalReady = false;
  await page.reload(); await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
  holdPoll = true;
  await page.clock.runFor(2600); await wait(page, () => !!releasePoll);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  releasePoll(); await page.waitForTimeout(100);
  assert.equal(await page.getByRole("button", { name: "Stop", exact: true }).count(), 0, "old poll cannot undo local cancellation");
  assert.equal(await page.locator('main[class*="notePane"] textarea').isEnabled(), true);
  await ctx.close();

  const phone = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.route("**/api/**", route => {
    assert.equal(route.request().method(), "GET");
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/robin/notes" ? { drafts: [a] } : path === "/api/robin/notes/attachments" ? { attachments: files } : fallback });
  });
  const mobile = await phone.newPage(); mobile.on("pageerror", error => errors.push(error.message));
  await mobile.goto(`/notes?draft=${a.id}`);
  const button = mobile.getByRole("button", { name: "Remove keep.pdf", exact: true }); await button.waitFor();
  const box = await button.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await phone.close();
}

async function jobs() {
  const ctx = await context(); let scans = 0, scores = 0;
  await ctx.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === "POST") {
      assert.ok(["/api/robin/jobs/scan", "/api/robin/jobs/score"].includes(path), `Unexpected write ${path}`);
      // Mirror the real JSON guard; the old browser request failed here with 415.
      assert.match(req.headers()["content-type"] ?? "", /application\/json/);
      assert.deepEqual(req.postDataJSON(), {});
      if (path.endsWith("/scan")) { scans++; return route.fulfill({ json: { scan: { scanned: 1, matched: 0, added: 0, sources: [{ name: "fixture" }] } } }); }
      scores++; return route.fulfill({ json: { started: true } });
    }
    assert.equal(req.method(), "GET");
    const data = path === "/api/robin/jobs/score" ? { scoring: null, pending: 1, model: null }
      : path === "/api/robin/jobs/applications" ? { running: false, rows: [], counts: {}, today: 0, day: "2026-10-29", settings: { configured: false, enabled: false, at: "09:00", timeZone: "UTC", dailyLimit: 0 } }
        : path === "/api/robin/jobs" ? { jobs: [], configured: true } : fallback;
    return route.fulfill({ json: data });
  });
  const page = await ctx.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard/jobs");
  const header = page.locator("main > header");
  await header.getByRole("button", { name: /scan/i }).click(); await wait(page, () => scans === 1);
  await header.getByRole("button", { name: /score.*1 waiting/i }).click(); await wait(page, () => scores === 1);
  assert.equal(await page.getByText("Content-Type must be application/json").count(), 0);
  await ctx.close();
}

async function links() {
  const ctx = await context();
  let link = { id: "fixture", title: "Original link", url: "https://example.com/old", group: "Test", iconCheckedAt: "2026-10-29" };
  let failWrite = true, failRead = false, writes = 0;
  await ctx.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === "/api/robin/links") {
      if (req.method() === "PATCH") {
        writes++; if (failWrite) { failWrite = false; return route.fulfill({ status: 503, json: { error: "Fixture edit failed" } }); }
        link = { ...link, ...req.postDataJSON() }; failRead = true; return route.fulfill({ json: { link } });
      }
      assert.equal(req.method(), "GET");
      return route.fulfill(failRead ? { status: 503, json: { error: "Fixture read failed" } } : { json: { links: [link] } });
    }
    assert.equal(req.method(), "GET", `Unexpected write ${path}`);
    return route.fulfill({ json: { ...fallback, google: { connected: false }, connected: false, configured: true } });
  });
  const page = await ctx.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard#dashboard-links");
  const panel = page.locator("#dashboard-links"); await panel.waitFor();
  await panel.getByRole("button", { name: "Edit Original link", exact: true }).click();
  const name = panel.getByRole("textbox", { name: "Name (optional)", exact: true });
  await name.fill("Edited link");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "Fixture edit failed" }).waitFor();
  assert.equal(await name.inputValue(), "Edited link");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "Fixture read failed" }).waitFor();
  assert.equal(await name.count(), 0);
  await panel.getByRole("link", { name: /Edited link/ }).waitFor();
  assert.equal(writes, 2);
  await ctx.close();
}
try {
  await notes(); await jobs(); await links();
  assert.deepEqual(errors, []);
  console.log("PASS: attachment failure/retry and stale-read fencing; finalization read/command ordering; 44px phone target; job POST contract; retained link edits and offline receipts.");
} finally { await browser.close(); }
