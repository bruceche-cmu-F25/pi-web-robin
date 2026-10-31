// Existing dev server, mocked application APIs; no personal data writes.
// node --env-file-if-exists=.env.local e2e/mobile-native.mjs
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  for (const touch of [true, false]) {
    const context = await browser.newContext({ baseURL, viewport: { width: 844, height: 390 }, isMobile: touch, hasTouch: touch, reducedMotion: "reduce", serviceWorkers: "block" });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
    const today = "2030-05-12";
    const fixtures = {
      "/api/robin/todos": { today, todos: [] },
      "/api/robin/events": { today, events: [], google: { connected: false } },
      "/api/robin/jobs": { jobs: [] }, "/api/robin/links": { links: [] },
      "/api/robin/rounds": { rounds: [] }, "/api/robin/gmail": { today, connected: false, review: null },
      "/api/robin/learning": { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan([]) },
    };
    const writes = [], errors = [];
    await context.route("**/api/**", route => {
      if (route.request().method() !== "GET") writes.push(route.request().url());
      return route.fulfill({ json: fixtures[new URL(route.request().url()).pathname] ?? {} });
    });
    // Optional source-built CSS when the shared dev server's watcher is stale.
    // Replace, never layer over old hover rules; don't restart active agent sessions.
    if (process.env.E2E_GLOBAL_CSS) {
      const css = await readFile(process.env.E2E_GLOBAL_CSS, "utf8");
      await context.route("**/_next/static/chunks/*.css", async route => {
        const response = await route.fetch();
        const body = await response.text();
        const start = body.indexOf("/* [project]/app/globals.css ");
        const end = body.indexOf("/* [project]/app/settings.css ");
        await route.fulfill({ response, body: start >= 0 && end > start ? body.slice(0, start) + css + "\n" + body.slice(end) : body });
      });
    }
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    // Home now has its own dock; Learning still exercises the shared drawer.
    await page.goto("/learn");
    await page.locator(".pi-page-title").waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Exercise the real shared stylesheet, without invoking app actions.
    await page.evaluate(() => {
      const host = document.createElement("div"); host.id = "mobile-native-fixture";
      host.style.cssText = "position:fixed;top:0;right:0;z-index:9999;background:var(--bg-panel);max-width:100%;padding:8px";
      host.innerHTML = `<button class="ui-action ui-action--chip" data-hover="danger" style="padding:12px">Touch fixture</button>
        <button class="ui-action ui-action--card" data-active="true" disabled>Disabled</button>
        <input aria-label="Input fixture" style="font-size:12px;width:100px" value="Draft">
        <p>Selectable text <a href="#native-content">ordinary link</a></p>`;
      document.body.append(host);
    });
    const button = page.getByRole("button", { name: "Touch fixture" });
    const disabled = page.getByRole("button", { name: "Disabled", exact: true });
    const appearance = () => button.evaluate(el => {
      const css = getComputedStyle(el);
      return [css.backgroundColor, css.color, css.borderColor];
    });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
      await page.mouse.move(0, 389);
      const resting = await appearance();
      if (touch) {
        await button.tap();
        await page.waitForFunction(() => !document.querySelector('#mobile-native-fixture button').matches(':active'));
      } else await button.hover();
      if (touch) assert.deepEqual(await appearance(), resting, "Touch must not latch destructive hover styling");
      else assert.notDeepEqual(await appearance(), resting, "Mouse hover must still work");
      const box = await button.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      assert.equal(await button.evaluate(el => {
        const swatch = document.createElement("span"); swatch.style.backgroundColor = "var(--bg-selected)"; el.append(swatch);
        const matches = getComputedStyle(el).backgroundColor === getComputedStyle(swatch).backgroundColor; swatch.remove(); return matches;
      }), true, "Press feedback wins over hover without changing geometry");
      assert.deepEqual(await button.boundingBox(), box);
      await page.mouse.up();
      const disabledBefore = await disabled.evaluate(el => getComputedStyle(el).backgroundColor);
      await disabled.hover();
      await page.mouse.down();
      assert.equal(await disabled.evaluate(el => getComputedStyle(el).backgroundColor), disabledBefore, "Disabled controls do not get press feedback");
      await page.mouse.up();
    }
    for (const [width, height] of [[320, 812], [375, 812], [844, 390], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      const fieldSize = await page.getByLabel("Input fixture").evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert.equal(fieldSize, touch || width <= 640 ? 16 : 12, "Touch fields stay zoom-safe in landscape and on tablets; desktop density stays unchanged");
    }
    const controlStyle = await button.evaluate(el => { const css = getComputedStyle(el); return { touch: css.touchAction, select: css.webkitUserSelect || css.userSelect, highlight: css.webkitTapHighlightColor }; });
    assert.equal(controlStyle.touch, "manipulation");
    assert.equal(controlStyle.select, "none");
    assert.equal(controlStyle.highlight, "rgba(0, 0, 0, 0)");
    assert.notEqual(await page.locator("#mobile-native-fixture p").evaluate(el => getComputedStyle(el).userSelect), "none");
    assert.notEqual(await page.locator("#mobile-native-fixture a").evaluate(el => getComputedStyle(el).webkitTouchCallout), "none", "Ordinary links keep their native long-press menu");
    await page.locator("#mobile-native-fixture").evaluate(el => el.remove());
    for (const [width, height] of [[320, 568], [375, 812], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.locator(".robin-mobile-nav-trigger").click();
      const nav = page.locator(".robin-nav.is-drawer");
      const last = nav.locator(".robin-nav-entry").last();
      await last.scrollIntoViewIfNeeded();
      const bounds = await last.boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height + 1, `Last navigation control must be reachable at ${width}x${height}: ${JSON.stringify(bounds)}`);
      assert.ok(await nav.locator(".robin-nav-entry").evaluateAll(nodes => nodes.every(el => el.getBoundingClientRect().height >= 44)), "Short drawers scroll instead of shrinking tap targets");
      assert.equal(await nav.evaluate(el => getComputedStyle(el).overscrollBehaviorY), "contain");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (touch && process.env.E2E_SCREENSHOT_DIR) {
        await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/drawer-${width}.png` });
      }
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.activeElement === document.querySelector(".robin-mobile-nav-trigger"));
    }
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    await context.close();
  }
  console.log("PASS: touch/mouse hover, press feedback, selection, portrait/landscape/tablet fields, scrollable phone navigation. Hardware checks still required.");
} finally { await browser.close(); }
