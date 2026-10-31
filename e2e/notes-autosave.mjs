// Controlled note save/delete interleavings. All APIs mocked; no personal writes.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  const draft = { id: "autosave-fixture", title: "Autosave fixture", text: "Initial", notionParentId: "", updatedAt: "2026-10-27T00:00:00Z" };
  const other = { ...draft, id: "untouched-fixture", title: "Untouched fixture", text: "Unchanged" };
  const patches = [], operations = [], errors = [];
  let releaseFirst, failNext = false, holdNext = false, releaseHeld, failDelete = false, removed = false;
  await context.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/robin/notes") {
      if (request.method() !== "GET") operations.push(request.method());
      if (request.method() === "DELETE") {
        if (failDelete) { failDelete = false; return route.fulfill({ status: 503, json: { error: "Fixture delete failed" } }); }
        removed = true; return route.fulfill({ json: { ok: true } });
      }
      if (request.method() === "PATCH") {
        patches.push(request.postDataJSON());
        if (patches.length === 1) {
          await new Promise((resolve) => { releaseFirst = resolve; });
          return route.fulfill({ status: 503, json: { error: "First write failed" } });
        }
        if (holdNext) { holdNext = false; await new Promise(resolve => { releaseHeld = resolve; }); }
        if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: "Latest write failed" } }); }
        Object.assign(draft, request.postDataJSON());
      }
      return route.fulfill({ json: { drafts: removed ? [other] : [draft, other], draft } });
    }
    assert.equal(request.method(), "GET", `Unexpected write to ${path}`);
    return route.fulfill({ json: { attachments: [], vaults: [], archives: [], pages: [], canvases: [], finals: {}, modelList: [], todos: [], events: [], jobs: [], rounds: [], records: [], review: null } });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install();
  await page.goto("/notes?draft=autosave-fixture");
  const editor = page.locator('main[class*="notePane"] textarea');
  await editor.waitFor();
  const wait = async predicate => {
    for (let i = 0; !(await predicate()) && i < 100; i++) await page.waitForTimeout(20);
    assert.ok(await predicate(), "fixture condition reached");
  };
  await editor.fill("Old draft");
  await page.clock.runFor(500);
  for (let i = 0; !releaseFirst && i < 100; i++) await page.waitForTimeout(20);
  assert.ok(releaseFirst, "first save reached the mock server");
  await editor.fill("Newest draft");
  await page.clock.runFor(500);
  assert.equal(patches.length, 1, "writes are serialized");
  releaseFirst();
  for (let i = 0; patches.length < 2 && i < 100; i++) await page.waitForTimeout(20);
  assert.equal(patches.length, 2, "newer queued save follows the failed one");
  await page.waitForTimeout(100);
  assert.equal(draft.text, "Newest draft");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.waitForTimeout(200);
  assert.equal(patches.length, 2, "failed old text must not be resurrected by a later flush");
  assert.equal(draft.text, "Newest draft");
  failNext = true;
  await editor.fill("Retry this latest draft");
  await page.clock.runFor(500);
  await page.getByRole("alert").filter({ hasText: "Latest write failed" }).waitFor();
  await page.locator('.save-status[data-state="error"]').waitFor();
  await page.getByRole("button", { name: /^Untouched fixture/ }).click();
  await wait(async () => await editor.inputValue() === "Unchanged");
  assert.equal(await page.locator('.save-status').getAttribute('data-state'), "idle");
  assert.equal(await page.getByRole("alert").filter({ hasText: "Latest write failed" }).count(), 0);
  await page.getByRole("button", { name: /^Autosave fixture/ }).click();
  await page.locator('.save-status[data-state="error"]').waitFor();
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(draft.text, "Retry this latest draft", "the newest failure must still remain retryable");
  holdNext = true;
  await editor.fill("Earlier success"); await page.clock.runFor(500); await wait(() => !!releaseHeld);
  const releaseEarlier = releaseHeld; releaseHeld = undefined;
  await editor.fill("Still waiting for receipt"); await page.clock.runFor(500);
  holdNext = true; releaseEarlier(); await wait(() => !!releaseHeld);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.save-status').getAttribute('data-state'), "saving", "an earlier receipt cannot mark a queued write saved");
  releaseHeld(); await wait(() => draft.text === "Still waiting for receipt");
  await page.locator('.save-status[data-state="saved"]').waitFor();
  const deleteButton = page.getByRole("button", { name: "Delete Autosave fixture", exact: true });
  failDelete = true;
  await editor.fill("Keep after failed delete");
  page.once("dialog", dialog => dialog.accept()); await deleteButton.click();
  await page.getByRole("alert").filter({ hasText: "Fixture delete failed" }).waitFor();
  assert.equal(await editor.inputValue(), "Keep after failed delete");
  assert.equal(await editor.isEnabled(), true);
  await editor.press("Control+s"); await wait(() => draft.text === "Keep after failed delete");
  await page.locator('.save-status[data-state="saved"]').waitFor();

  holdNext = true; failNext = true; releaseHeld = undefined;
  await editor.fill("Failed write before deletion"); await page.clock.runFor(500); await wait(() => !!releaseHeld);
  page.once("dialog", dialog => dialog.accept()); await deleteButton.click();
  assert.equal(await editor.isDisabled(), true, "deletion freezes edits before draining writes");
  assert.equal(removed, false);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  releaseHeld(); await wait(() => removed);
  await page.waitForTimeout(100);
  assert.equal(await editor.inputValue(), "Unchanged", "confirmed delete selects the remaining draft");
  const count = operations.length;
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.clock.runFor(1000); await page.waitForTimeout(100);
  assert.equal(operations.length, count, "a failed in-flight write cannot requeue after DELETE");
  assert.equal(operations.at(-1), "DELETE");
  assert.deepEqual(errors, []);
  console.log("PASS: serialized saves, obsolete failures, per-receipt status, retry after failed deletion and no PATCH after DELETE.");
} finally { await browser.close(); }
