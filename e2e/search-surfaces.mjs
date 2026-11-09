// Existing dev server; all application APIs mocked. Search never executes a command.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/search-surfaces.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const output = process.env.E2E_SCREENSHOT_DIR ?? "/tmp/pi-search-surfaces";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "light"); });
  const today = "2030-05-13";
  const fixtures = {
    "/api/robin/todos": { today, todos: [{ id: "task", title: "Linked 任务：检查键盘焦点与手机全文显示", done: false }] },
    "/api/robin/events": { today, events: [] },
    "/api/robin/jobs": { jobs: [] }, "/api/robin/rounds": { rounds: [] },
    "/api/robin/assistant": { sessionId: "fixture-trace", running: false },
    "/api/robin/links": { links: [
      { id: "jobs", title: "LinkedIn Jobs", url: "https://example.com/jobs", group: "Job hunt", iconCheckedAt: today },
      { id: "profile", title: "LinkedIn Profile · example-profile", url: "https://example.com/profile", group: "求职平台", iconCheckedAt: today },
      { id: "long", title: `Linked ${"LongUnbrokenName".repeat(8)}`, url: "https://example.com/long", group: "长标题与说明", iconCheckedAt: today },
    ] },
    "/api/robin/learning": { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan([]) },
  };
  const writes = [], errors = [];
  await context.route("**/api/**", route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() !== "GET") writes.push(`${req.method()} ${path}`);
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard?calendar=agenda");
  const header = page.locator(".robin-dashboard-header .robin-assistant-bar");
  assert.equal(await header.locator('button[type="submit"]').count(), 0, "Live search has no redundant submit button");
  const modes = header.locator(".robin-assistant-modes button");
  assert.equal(await modes.nth(0).getAttribute("aria-pressed"), "true");
  assert.equal(await modes.nth(1).getAttribute("aria-pressed"), "false");
  for (const theme of ["light", "dark", "glass", "glass-dark"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const geometry = await modes.evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect(), group = button.parentElement.getBoundingClientRect();
      return { height: box.height, width: box.width, topInset: box.top - group.top, fill: getComputedStyle(button).backgroundColor };
    }));
    assert.ok(geometry.every(button => button.height >= 44 && button.width >= 44 && button.topInset >= 3));
    assert.ok(Math.abs(geometry[0].width - geometry[1].width) < 1, "Equal segments keep the thumb aligned");
    const thumb = await header.locator('.robin-assistant-mode-thumb').boundingBox();
    const selected = await modes.nth(0).boundingBox();
    assert.ok(Math.abs(thumb.x - selected.x) < 1 && Math.abs(thumb.width - selected.width) < 1, "One inset thumb marks selection");
    await header.screenshot({ path: `${output}/modes-${theme}.png` });
  }
  // Real computed intermediate frames, interruption, keyboard and reduced motion.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const motion = await header.evaluate(async bar => {
    const thumb = bar.querySelector('.robin-assistant-mode-thumb');
    const buttons = bar.querySelectorAll('.robin-assistant-modes button');
    const x = () => new DOMMatrixReadOnly(getComputedStyle(thumb).transform).m41;
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    let moving;
    for (let i = 0; i < 20 && !moving; i++) { await frame(); moving = thumb.getAnimations()[0]; }
    if (!moving) throw new Error('Missing mode transition');
    moving.pause(); moving.currentTime = 70;
    const middle = x(), distance = thumb.getBoundingClientRect().width;
    buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await frame();
    const reversed = x();
    for (const animation of thumb.getAnimations()) animation.finish();
    await frame();
    return { middle, distance, reversed, final: x() };
  });
  assert.ok(motion.middle > 0 && motion.middle < motion.distance, JSON.stringify(motion));
  assert.ok(motion.reversed > 0 && motion.reversed <= motion.middle + 1, 'Reversal continues from the visible position');
  assert.equal(motion.final, 0);
  await modes.nth(1).focus(); await page.keyboard.press('Space');
  assert.equal(await header.getAttribute('data-mode'), 'execute');
  assert.equal(await header.locator('.robin-assistant-mode-thumb').evaluate(el => getComputedStyle(el).transitionDuration), '0s', 'Keyboard changes are immediate');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await modes.nth(0).click();
  assert.equal(await header.locator('.robin-assistant-mode-thumb').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  await header.locator("input").fill("linked");
  await header.locator(".robin-search-row").first().waitFor();
  assert.equal(await header.locator(".robin-search-row").count(), 4);
  const family = page.locator('#dashboard-links [data-link-groups] button').filter({ has: page.locator('[class*="familyMark"]') });
  await family.waitFor();
  assert.equal(await family.evaluate(el => getComputedStyle(el).borderLeftWidth), "0px", "Category colour is an inset mark, not a curved edge");
  await family.click();
  assert.equal(await family.getAttribute("aria-expanded"), "false");
  await family.click();
  assert.equal(await family.getAttribute("aria-expanded"), "true");

  for (const size of [{ width: 1440, height: 900 }, { width: 375, height: 812 }, { width: 320, height: 700 }, { width: 812, height: 375 }]) {
    await page.setViewportSize(size);
    for (const theme of ["light", "dark", "glass", "glass-dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
      await page.keyboard.press("Control+k");
      const dialog = page.locator(".robin-command-dialog[open]");
      await dialog.waitFor();
      const input = dialog.locator("input");
      await input.fill("linked");
      assert.equal(await dialog.locator('button[type="submit"]').count(), 0);
      const results = dialog.locator(".robin-search-results");
      await results.locator("li").nth(3).waitFor().catch(async error => {
        console.error('Search state', size, theme, await dialog.textContent().catch(() => 'closed'));
        await page.screenshot({ path: `${output}/failure.png` });
        throw error;
      });
      const geometry = await dialog.evaluate(el => {
        const outer = el.querySelector(".robin-command-dialog__content").getBoundingClientRect();
        const results = el.querySelector(".robin-search-results"), resultBox = results.getBoundingClientRect();
        const rows = [...el.querySelectorAll(".robin-search-row")].map(row => {
          const box = row.getBoundingClientRect(), css = getComputedStyle(row);
          return { height: box.height, radius: css.borderRadius, border: css.borderBottomWidth, inset: box.left - resultBox.left, overflow: row.scrollWidth > row.clientWidth };
        });
        const input = el.querySelector("input").getBoundingClientRect();
        const close = el.querySelector(".robin-command-dialog__close").getBoundingClientRect();
        return { left: resultBox.left - outer.left, right: outer.right - resultBox.right, bottom: outer.bottom, rows, inputWidth: input.width, close: { width: close.width, height: close.height }, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      const label = `${size.width}/${size.height}/${theme}`;
      assert.ok(Math.abs(geometry.left - geometry.right) <= 1, `Symmetric result gutters: ${label}`);
      assert.ok(geometry.inputWidth >= 100, `Usable input: ${label}`);
      assert.ok(geometry.bottom <= size.height - 12, `Dialog fits short screens: ${label}`);
      assert.equal(geometry.overflow, false, label);
      assert.deepEqual(geometry.close, { width: 44, height: 44 });
      for (const row of geometry.rows) {
        assert.ok(row.height >= 60 && row.inset >= 6, `Inset readable row: ${label}`);
        assert.equal(row.border, "0px", "No curved row dividers");
        assert.equal(row.overflow, false, "Long titles reflow");
      }
      await input.press("Enter");
      assert.equal(await results.locator("a").first().evaluate(el => el === document.activeElement), true, "Enter focuses the first result, not an execution");
      assert.ok(await results.locator("a").first().evaluate(el => getComputedStyle(el).outlineStyle !== "none"), "Keyboard focus remains visible");
      await page.screenshot({ path: `${output}/search-${size.width}-${theme}.png` });
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(await header.locator("input").inputValue(), "linked", "Palette does not reset the home search");
    }
  }
  // Phone Search and Act are separate entrances, with no mode switch or shared draft.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.keyboard.press("Control+k");
  const dialog = page.locator(".robin-command-dialog[open]"), input = dialog.locator("input");
  await input.fill("no-match-xyz");
  await dialog.getByRole("status").filter({ hasText: "没有" }).waitFor();
  await input.fill("daily");
  await dialog.locator('a[href="/dashboard"]').waitFor();
  assert.equal(await dialog.locator('button[type="submit"]').count(), 0, "Shortcut already has an actionable result");
  assert.equal(await dialog.locator("select").count(), 0, "Search cannot switch to Act");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "写给 Robin", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.robin-command-dialog[open] .robin-assistant-bar')?.dataset.mode === 'execute');
  assert.equal(await input.inputValue(), "", "Act never inherits a search query");
  assert.equal(await dialog.locator("select").count(), 0);
  assert.equal(await input.getAttribute('enterkeyhint'), 'send');
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  // A restored execution record is a transparent, inset footer, including in Glass.
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 960) { await page.getByRole("button", { name: "写给 Robin", exact: true }).click(); await dialog.waitFor(); }
    const surface = width < 960 ? dialog.locator(".robin-assistant-bar") : header;
    if (width >= 960) await surface.locator(".robin-assistant-modes").getByRole("button", { name: "执行", exact: true }).click();
    const footer = surface.locator(".robin-assistant-result-toolbar[data-idle]");
    await footer.waitFor();
    for (const theme of ["light", "dark", "glass", "glass-dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme.endsWith("dark")); }, theme);
      const style = await footer.evaluate(node => {
        const css = getComputedStyle(node), box = node.getBoundingClientRect(), outer = node.parentElement.getBoundingClientRect();
        const link = node.querySelector("a");
        return { fill: css.backgroundColor, position: css.position, left: box.left - outer.left, right: outer.right - box.right, height: link.getBoundingClientRect().height };
      });
      assert.equal(style.fill, "rgba(0, 0, 0, 0)", "Idle history must not paint a white rectangle inside the glass rim");
      assert.equal(style.position, "static");
      assert.ok(style.left >= 12 && style.right >= 12 && Math.abs(style.left - style.right) < 1, `Balanced footer gutters: ${JSON.stringify(style)}`);
      assert.ok(style.height >= 44, "Compact styling keeps a full touch target");
      assert.equal(await footer.locator("a").getAttribute("href"), "/?session=fixture-trace");
      await footer.locator("a").focus();
      await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
      assert.ok(await footer.locator("a").evaluate(node => node === document.activeElement && getComputedStyle(node).outlineStyle !== "none"), "History remains keyboard accessible with visible focus");
      await page.screenshot({ path: `${output}/trace-${width}-${theme}.png` });
    }
    if (width < 960) await page.keyboard.press("Escape");
  }
  assert.deepEqual(writes, [], "Search and mode switching never write user data");
  assert.deepEqual(errors, []);
  console.log(`PASS: inset result rows, balanced palette, long titles, keyboard focus, modes, light/dark/glass and narrow/short screens; screenshots: ${output}`);
} finally { await browser.close(); }
