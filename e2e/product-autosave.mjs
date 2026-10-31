// All APIs mocked: delayed/failed writes, no personal product data or paid calls.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  const idea = { id: "autosave", name: "Initial name", note: "Initial note", step: "spot", links: [], createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z" };
  const writes = [], errors = [];
  let blockNext = true, failNext = true, release, removed = false, failRead = false;
  await context.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/robin/products/autosave") {
      const body = request.postDataJSON();
      writes.push({ method: request.method(), body });
      const fail = failNext; failNext = false;
      if (blockNext) { blockNext = false; await new Promise((resolve) => { release = resolve; }); }
      if (fail) return route.fulfill({ status: 503, json: { error: "Fixture write failed" } });
      if (request.method() === "DELETE") { removed = true; return route.fulfill({ json: { ok: true } }); }
      Object.assign(idea, body);
      return route.fulfill({ json: { idea } });
    }
    assert.equal(request.method(), "GET", `Unexpected write ${path}`);
    if (path === "/api/robin/products") return route.fulfill(failRead
      ? { status: 503, json: { error: "Fixture read failed" } }
      : { json: { ideas: removed ? [] : [idea], captures: [] } });
    return route.fulfill({ json: { resources: [], opportunities: [], assessments: {}, savedIds: [], todos: [], events: [], jobs: [], rounds: [], records: [], finals: {}, review: null } });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  const wait = async (predicate) => {
    for (let i = 0; !predicate() && i < 150; i++) await page.waitForTimeout(20);
    assert.ok(predicate(), "fixture condition reached");
  };
  const warned = () => page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  await page.goto("/product?idea=autosave");
  const row = page.locator('li[class*="idea"]').filter({ has: page.locator("#product-notebook-autosave") });
  const note = page.locator("#product-notebook-autosave textarea").first();
  const name = row.locator("input").first();
  await note.waitFor();
  assert.equal(await warned(), false);
  await note.fill("Old edit");
  assert.equal(await row.locator('.save-status[data-state="dirty"]').count(), 1);
  assert.equal(await warned(), true, "debounced edits warn before leaving");
  await page.clock.runFor(1100); await wait(() => !!release);
  await note.fill("Newest edit");
  await page.clock.runFor(1100);
  assert.equal(writes.length, 1, "newer edit waits for older request");
  assert.equal(await warned(), true, "in-flight writes warn before leaving");
  release();
  await wait(() => idea.note === "Newest edit");
  await page.waitForTimeout(100);
  await note.blur(); await page.clock.runFor(1500);
  assert.equal(writes.length, 2, "old failed draft is never resurrected");
  assert.equal(await note.inputValue(), "Newest edit");
  assert.equal(await warned(), false);
  failNext = true;
  await note.fill("Retry newest"); await page.clock.runFor(1100);
  await wait(() => writes.length === 3);
  await page.getByRole("alert").filter({ hasText: "Fixture write failed" }).waitFor();
  assert.equal(await warned(), true);
  await row.locator('.save-status[data-state="error"]').waitFor();
  assert.match(await row.locator('.save-status').innerText(), /Save not confirmed/);
  await row.getByRole("button", { name: "Retry save", exact: true }).click();
  await wait(() => idea.note === "Retry newest");
  await row.locator('.save-status[data-state="saved"]').waitFor();
  assert.equal(await warned(), false);
  const beforeName = writes.length;
  blockNext = true; release = undefined;
  await name.fill("Temporary name"); await name.blur(); await wait(() => !!release);
  await name.fill("Initial name"); await name.blur();
  assert.equal(writes.length, beforeName + 1);
  release();
  await wait(() => writes.length === beforeName + 2 && idea.name === "Initial name");
  await page.waitForTimeout(100);
  assert.equal(await name.inputValue(), "Initial name", "reverting to stored name still queues behind the old edit");
  assert.equal(await warned(), false);
  failRead = true;
  await note.fill("Confirmed despite offline read"); await page.clock.runFor(1100);
  await page.getByRole("alert").filter({ hasText: "Fixture read failed" }).waitFor();
  assert.equal(await note.inputValue(), "Confirmed despite offline read");
  assert.equal(await warned(), false, "acknowledged text is not lost on a failed refresh");
  failRead = false;
  blockNext = true; release = undefined;
  await note.fill("Save before delete"); await page.clock.runFor(1100); await wait(() => !!release);
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Delete idea", exact: true }).click();
  assert.equal(removed, false, "delete waits for text writes");
  release(); await wait(() => removed);
  assert.equal(writes.at(-1).method, "DELETE");
  await page.clock.runFor(2000);
  assert.equal(writes.at(-1).method, "DELETE", "no delayed PATCH after deletion");
  assert.deepEqual(errors, []);
  console.log("PASS: product text serialization, obsolete failure fencing, retry, name revert, unload warning and delete ordering.");
} finally { await browser.close(); }
