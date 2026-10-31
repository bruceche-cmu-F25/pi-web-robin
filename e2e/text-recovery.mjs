// All APIs mocked. No personal notes/ideas, provider calls, or external writes.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
const PREFIX = "pi-web:text-recovery:v1:";
try {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  // Suppress departure callbacks: the backup must already exist before them.
  await context.addInitScript(() => {
    // Match an HTTP LAN browser: getRandomValues exists, randomUUID does not.
    Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined });
    if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "en");
    window.addEventListener("pagehide", (event) => event.stopImmediatePropagation(), true);
    document.addEventListener("visibilitychange", (event) => event.stopImmediatePropagation(), true);
  });
  const draft = { id: "recovery-note", title: "Server title", text: "Server note", notionParentId: "", updatedAt: "2026-10-27T00:00:00Z" };
  const idea = { id: "recovery-idea", name: "Server name", note: "Server notebook", step: "spot", links: [], createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z" };
  let failWrites = true;
  const writes = [], errors = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    if (method !== "GET") {
      assert.equal(method, "PATCH", `Unexpected write ${method} ${path}`);
      assert.ok(path === "/api/robin/notes" || path === "/api/robin/products/recovery-idea");
      writes.push(request.postDataJSON());
      if (failWrites) return route.fulfill({ status: 503, json: { error: "Fixture offline write" } });
      Object.assign(path === "/api/robin/notes" ? draft : idea, request.postDataJSON());
      return route.fulfill({ json: path === "/api/robin/notes" ? { draft } : { idea } });
    }
    if (path === "/api/robin/notes") return route.fulfill({ json: { drafts: [draft] } });
    if (path === "/api/robin/products") return route.fulfill({ json: { ideas: [idea], captures: [] } });
    return route.fulfill({ json: { resources: [], opportunities: [], assessments: {}, savedIds: [], attachments: [], vaults: [], archives: [], pages: [], canvases: [], finals: {}, modelList: [], todos: [], events: [], jobs: [], rounds: [], records: [], review: null } });
  });
  const open = async (path) => {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install();
    await page.goto(path);
    return page;
  };
  const copies = (page) => page.evaluate((prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)).map((key) => JSON.parse(localStorage.getItem(key))), PREFIX);
  const wait = async (predicate) => {
    for (let i = 0; i < 150; i++) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 20)); }
    assert.fail("fixture condition not reached");
  };
  const panels = (page) => page.locator('section[aria-label="Local draft recovery"]');
  const editor = (page) => page.locator('main[class*="notePane"] textarea');
  const notePath = "/notes?draft=recovery-note";
  let page = await open(notePath);
  await editor(page).fill("未保存的正文 🙂\nsecond line");
  assert.equal((await copies(page))[0].fields.text, "未保存的正文 🙂\nsecond line", "persisted at edit boundary, before debounce or unload");
  await page.close();
  draft.text = "Server changed elsewhere";
  page = await open(notePath);
  await panels(page).waitFor();
  const initialWrites = writes.length;
  await page.clock.runFor(700);
  assert.equal(writes.length, initialWrites, "opening a backup never submits it");
  assert.equal(await editor(page).inputValue(), "Server changed elsewhere", "server version stays visible");
  await panels(page).locator("summary").click();
  assert.ok(await panels(page).getByText("未保存的正文 🙂", { exact: false }).isVisible());
  await panels(page).getByRole("button", { name: "Restore draft", exact: true }).click();
  assert.equal(await editor(page).inputValue(), "未保存的正文 🙂\nsecond line");
  await page.clock.runFor(500);
  await page.getByRole("alert").filter({ hasText: "Fixture offline write" }).waitFor();
  assert.equal((await copies(page)).length, 1, "failed save retains adopted backup");
  await page.close();
  page = await open(notePath);
  await panels(page).waitFor();
  failWrites = false;
  await panels(page).getByRole("button", { name: "Restore draft", exact: true }).click();
  await page.clock.runFor(500);
  await wait(async () => (await copies(page)).length === 0);
  assert.equal(draft.text, "未保存的正文 🙂\nsecond line");

  failWrites = true;
  await editor(page).fill("Discard me, not the server note");
  await page.close();
  page = await open(notePath);
  await panels(page).waitFor();
  const beforeDiscard = writes.length;
  await panels(page).getByRole("button", { name: "Discard backup", exact: true }).click();
  assert.equal((await copies(page)).length, 0);
  await page.clock.runFor(500);
  assert.equal(writes.length, beforeDiscard, "discard is local-only");
  assert.equal(await editor(page).inputValue(), draft.text);

  // Concurrent tabs retain independent copies; acknowledging one never clears the other.
  await editor(page).fill("Tab A text");
  const other = await open(notePath);
  await editor(other).fill("Tab B text");
  assert.equal((await copies(other)).length, 2);
  await page.close(); await other.close();
  page = await open(notePath);
  await wait(async () => await panels(page).count() === 2);
  failWrites = false;
  await panels(page).filter({ hasText: "Tab B text" }).getByRole("button", { name: "Restore draft", exact: true }).click();
  await page.clock.runFor(500);
  await wait(async () => (await copies(page)).length === 1);
  assert.equal((await copies(page))[0].fields.text, "Tab A text");
  await panels(page).getByRole("button", { name: "Discard backup", exact: true }).click();

  // Storage failure does not break typing or misrepresent a backup as durable.
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("pi-web:text-recovery:v1:")) throw new DOMException("Full", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  failWrites = true;
  await editor(page).fill("Still editable when storage is full");
  assert.equal(await editor(page).inputValue(), "Still editable when storage is full");
  await page.getByRole("status").filter({ hasText: "Local draft backup unavailable" }).waitFor();
  await page.close();

  const productPath = "/product?idea=recovery-idea";
  const notebook = (p) => p.locator("#product-notebook-recovery-idea textarea").first();
  const name = (p) => p.locator('li[class*="idea"]').filter({ has: p.locator("#product-notebook-recovery-idea") }).locator("input").first();
  page = await open(productPath);
  await name(page).fill("Recovered name");
  await notebook(page).fill("Recovered notebook");
  assert.equal((await copies(page)).length, 2, "name and note use independent backups");
  await page.close();
  idea.name = "New server name"; idea.note = "New server notebook";
  page = await open(productPath);
  await wait(async () => await panels(page).count() === 2);
  assert.equal(await name(page).inputValue(), "New server name");
  assert.equal(await notebook(page).inputValue(), "New server notebook");
  const beforeRestore = writes.length;
  await page.clock.runFor(1100);
  assert.equal(writes.length, beforeRestore);
  failWrites = false;
  const recoveredName = panels(page).filter({ has: page.locator("strong", { hasText: /^Name$/ }) });
  await recoveredName.getByRole("button", { name: "Restore draft", exact: true }).click();
  assert.equal(await name(page).inputValue(), "Recovered name");
  await name(page).blur();
  await wait(async () => idea.name === "Recovered name" && (await copies(page)).length === 1);
  assert.equal((await copies(page))[0].fields.note, "Recovered notebook", "name acknowledgement leaves the unsaved note copy alone");
  await panels(page).locator("summary").click();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await panels(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${width}: recovery panel must not overflow`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir("/tmp/text-recovery", { recursive: true });
  await panels(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/text-recovery/product-mobile.png" });
  await panels(page).getByRole("button", { name: "Restore draft", exact: true }).click();
  await page.clock.runFor(1100);
  await wait(async () => (await copies(page)).length === 0);
  assert.equal(idea.note, "Recovered notebook");

  // Sample synchronous input processing with a bounded large draft, not an INP/device guarantee.
  failWrites = true;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    window.inputSamples = [];
    let start;
    window.addEventListener("input", () => { start = performance.now(); }, true);
    window.addEventListener("input", (event) => window.inputSamples.push({ chars: event.target.value.length, ms: performance.now() - start }));
  });
  await notebook(page).fill("a".repeat(2000));
  await notebook(page).fill("b".repeat(200_000));
  assert.equal((await copies(page))[0].fields.note.length, 200_000, "large draft is not truncated");
  console.log("4x CPU input-handler samples (ms, not INP):", JSON.stringify(await page.evaluate(() => window.inputSamples)));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await notebook(page).fill("中文草稿恢复");
  await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.close();
  page = await open(productPath);
  const chinese = page.locator('section[aria-label="本机草稿恢复"]');
  await chinese.getByRole("button", { name: "恢复草稿", exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 812 });
  await chinese.locator("summary").click();
  assert.ok(await chinese.getByText("中文草稿恢复", { exact: true }).isVisible());
  assert.ok(await chinese.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await chinese.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/text-recovery/product-zh-320.png" });
  assert.deepEqual(errors, []);
  console.log("PASS: edit-time backups, departure without lifecycle hooks, explicit restore/discard, failed-save retention, exact ACK cleanup, two-tab isolation, quota warning, independent name/note and 320–1440px recovery layout.");
} finally { await browser.close(); }
