// Existing dev server; all workspace APIs are mocked. No notes or vaults are changed.
// node --env-file-if-exists=.env.local e2e/notes-mobile-reading.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
const output = "/tmp/notes-mobile-reading";
mkdirSync(output, { recursive: true });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok());
  }
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "glass"); });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.stack); });
  const draft = { id: "mobile-reading", title: "Lecture 10", text: Array.from({ length: 24 }, (_, i) => `## Section ${i + 1}\n\nMore put in code, reduce human error. How can we put everything on the cloud as script and code to manage?\n\nInfrastructure as code.`).join("\n\n"), notionParentId: "", updatedAt: new Date().toISOString() };
  let writes = 0;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") writes++;
    if (path === "/api/robin/notes") return route.fulfill({ json: { drafts: [draft] } });
    if (path === "/api/robin/obsidian") return route.fulfill({ json: { vaults: [{ id: "local", name: "Obsidian Vault", path: "/fixture/vault" }], archives: [] } });
    if (path === "/api/robin/notes/attachments") return route.fulfill({ json: { attachments: [{ id: "pdf", name: "Lecture-10.pdf", kind: "pdf", pages: 12 }] } });
    if (path === "/api/models") return route.fulfill({ json: { modelList: [{ provider: "test", id: "fixture", name: "Fixture" }], defaultModel: { provider: "test", modelId: "fixture" } } });
    return route.fulfill({ json: { canvases: [], finals: {}, todos: [], events: [], rounds: [], jobs: [], links: [], sessions: [], running: [], counts: {} } });
  });
  await page.goto("/notes?draft=mobile-reading");
  const editor = page.locator('main textarea');
  await editor.waitFor();
  await page.waitForFunction(() => document.querySelector('main textarea')?.value.includes('Infrastructure'));
  await page.getByRole("button", { name: "预览", exact: true }).click();
  const sheet = page.locator('[class*="sheetHead"]').locator("..");
  const fold = page.locator('details[class*="filingDisclosure"]');
  const review = page.getByRole("button", { name: "预览并保存", exact: true });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, bottom: 34, left: 0, right: 0 } });
  if (process.env.E2E_BASELINE) {
    await page.screenshot({ path: `${output}/before.png` });
    console.log("Before:", { sheet: await sheet.boundingBox(), filing: await page.locator('[data-place="sheet"]').boundingBox() });
  } else {
    for (const theme of ["glass", "glass-dark", "light"]) {
      await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
      for (const [width, height] of [[390, 844], [320, 667], [844, 390]]) {
        await page.setViewportSize({ width, height });
        await fold.waitFor();
        assert.equal(await fold.getAttribute("open"), null, "Filing must not consume the reading area by default");
        const bounds = await sheet.boundingBox();
        const footer = await fold.boundingBox();
        assert.ok(footer.height <= 52, `Collapsed filing is one row: ${footer.height}`);
        const menu = await page.locator('.robin-mobile-nav-trigger').boundingBox();
        const tabs = await page.locator('.robin-workspace-tabs').boundingBox();
        assert.ok(tabs.x >= menu.x + menu.width && Math.abs(tabs.y + tabs.height / 2 - menu.y - menu.height / 2) <= 4, "Workspace tabs share the menu row without covering its hit area");
        if (width === 390) assert.ok(bounds.height >= height * 0.6, `Reading sheet gets most of the notched viewport: ${bounds.height}`);
        assert.ok(footer.y + footer.height <= height - 33, "Filing remains above the home indicator");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal overflow");
        await sheet.evaluate(el => { el.scrollTop = el.scrollHeight; });
        const last = sheet.locator('article p').last();
        const lastBox = await last.boundingBox();
        assert.ok(lastBox.y < bounds.y + bounds.height && lastBox.y + lastBox.height > bounds.y, `The last paragraph can be read without a nested preview scrollport (${theme} ${width}: ${JSON.stringify({ bounds, lastBox })})`);
        await sheet.evaluate(el => { el.scrollTop = 0; });
        await page.screenshot({ path: `${output}/${theme}-${width}.png` });
        await fold.locator("summary").click();
        await review.scrollIntoViewIfNeeded();
        const reviewBox = await review.boundingBox();
        assert.ok(reviewBox.y >= footer.y - 300 && reviewBox.y + reviewBox.height <= height - 33, "Expanded actions can be scrolled into the usable viewport");
        await review.click();
        const confirm = page.getByRole("button", { name: "确认存入 Obsidian", exact: true });
        await confirm.scrollIntoViewIfNeeded();
        assert.equal(await confirm.isEnabled(), true, "Archive review retains explicit confirmation");
        assert.notEqual(await fold.getAttribute("open"), null, "Review opens its controls");
        await page.getByRole("button", { name: "返回编辑", exact: true }).click();
        assert.equal(await editor.inputValue(), draft.text, "Folding and reviewing preserve the draft");
        assert.equal(await fold.getAttribute("open"), null, "Back to editing releases the space again");
        await page.getByRole("button", { name: "预览", exact: true }).click();
      }
    }
    await page.locator('.robin-mobile-nav-trigger').click();
    await page.locator('#robin-navigation[role="dialog"]').waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator('.robin-mobile-nav-trigger').getAttribute('aria-expanded'), 'false');
    await page.setViewportSize({ width: 390, height: 500 });
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await editor.scrollIntoViewIfNeeded();
    assert.ok((await editor.boundingBox()).height >= 160, 'A short viewport never crushes the text editor');
    assert.equal(await editor.inputValue(), draft.text);
    await fold.locator("summary").focus();
    await page.keyboard.press("Enter");
    assert.notEqual(await fold.getAttribute("open"), null, "Keyboard can open filing");
    await page.keyboard.press("Enter");
    assert.equal(await fold.getAttribute("open"), null);
    await page.setViewportSize({ width: 1440, height: 900 });
    await review.waitFor();
    assert.equal(await fold.count(), 0, "Desktop retains its existing masthead actions");
    assert.equal(writes, 0, "Disclosure and preview never write or call a model");
    assert.deepEqual(errors, []);
    console.log("PASS: mobile reading area, whole-sheet scroll, collapsed filing, confirmation, touch/keyboard, safe areas and desktop");
  }
} finally { await browser.close(); }
