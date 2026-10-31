// Existing dev server; mocked APIs, no personal data reads/writes.
// node --env-file-if-exists=.env.local e2e/mobile-tab-clearance.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 402, height: 874 }, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
  await context.route("**/api/**", route => {
    assert.equal(route.request().method(), "GET", "Navigation must not write data");
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/robin/jobs/applications") return route.fulfill({ json: { settings: { enabled: false, configured: false, timeZone: "America/Los_Angeles", at: "09:00", dailyLimit: 5 }, rows: [], counts: {}, running: false, today: 0, todaySubmitted: 0, total: 0, legacy: 0 } });
    return route.fulfill({ json: { today: "2030-05-12", connected: false, review: null, jobs: [], rounds: [], events: [], todos: [], links: [], records: [] } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  const cdp = await context.newCDPSession(page);
  const trigger = page.locator(".robin-mobile-nav-trigger");
  for (const path of ["/dashboard/gmail", "/dashboard/jobs", "/dashboard/events"]) {
    await page.goto(path);
    const tabs = page.locator('nav[class*="sources"]');
    await tabs.waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const [width, height, top] of [[402, 874, 62], [320, 812, 59], [375, 812, 44], [390, 844, 0], [844, 390, 0], [959, 768, 24], [960, 768, 0]]) {
      console.log(`Checking ${path}: ${width}px, safe top ${top}`);
      await page.setViewportSize({ width, height });
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top, bottom: 0, left: 0, right: 0 } });
      // Wait for both the media query hook and CSS layout after resizing.
      await page.waitForFunction(narrow => !!document.querySelector('.robin-nav.is-drawer') === narrow, width < 960);
      const tabBox = await tabs.boundingBox();
      if (width < 960) {
        const menuBox = await trigger.boundingBox();
        assert.equal(menuBox.y, top + 12, "Safe-area emulation must be active");
        assert.ok(tabBox.y >= menuBox.y + menuBox.height + 4, `${path} at ${width}px/inset ${top}: tabs (${tabBox.y}) must clear menu bottom (${menuBox.y + menuBox.height})`);
        assert.equal(await page.locator('.robin-page').first().evaluate(el => getComputedStyle(el).paddingTop), "0px", "Move the inset, do not duplicate it below the tabs");
        if (process.env.E2E_SCREENSHOT_DIR && width === 402) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/${path.split("/").at(-1)}.png` });
        const first = tabs.locator('button[aria-pressed="true"], a[aria-current="page"]');
        await first.click();
        assert.equal(await trigger.getAttribute("aria-expanded"), "false", "Selected tab must not hit the menu");
        await trigger.click();
        assert.equal(await trigger.getAttribute("aria-expanded"), "true");
        await page.keyboard.press("Escape");
        assert.equal(await trigger.getAttribute("aria-expanded"), "false");
      } else {
        assert.equal(await trigger.isVisible(), false);
        assert.equal(tabBox.y, 0, "Desktop rail layout keeps tabs flush to the top");
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal overflow");
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS: Incoming/jobs/events tabs clear the menu with 0–62px safe areas at 320–960px; tabs and drawer remain clickable.");
} finally {
  await browser.close();
}
