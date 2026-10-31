// Existing server; mocked reads only. Browser gestures supplement, never replace, device testing.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  for (const reducedMotion of ["no-preference", "reduce"]) {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion, serviceWorkers: "block" });
    if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
    await context.addInitScript(theme => {
      localStorage.setItem("pi-locale", "en");
      if (theme) localStorage.setItem("pi-theme", theme);
    }, process.env.E2E_THEME);
    await context.route("**/api/**", route => {
      assert.equal(route.request().method(), "GET");
      return route.fulfill({ json: { review: null, connected: false, todos: [], events: [], rounds: [], jobs: [], archive: [], edition: null, deliveries: [], preferences: {}, read: [] } });
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/dashboard/gmail");
    const trigger = page.locator(".robin-mobile-nav-trigger");
    const panel = page.locator(".robin-navigation-container"), handle = page.locator("[data-drawer-handle]");
    const x = () => panel.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
    const opened = () => page.waitForFunction(() => {
      const el = document.querySelector(".robin-navigation-container");
      return !el.inert && !el.style.transform && Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m41) < 0.5;
    });
    const closed = () => page.waitForFunction(() => document.querySelector(".robin-navigation-container").inert);
    await trigger.waitFor(); await page.evaluate(() => document.fonts.ready);
    await trigger.focus(); await page.keyboard.press("Enter"); await opened();
    assert.equal(await panel.evaluate(el => getComputedStyle(el).transitionDuration), "0s", "Keyboard actions are immediate");
    assert.equal(await panel.getAttribute("aria-modal"), "true");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await panel.evaluate(el => el.contains(document.activeElement)), true, "Focus wraps inside the drawer");
    await page.keyboard.press("Escape"); await closed();
    await page.waitForFunction(() => document.activeElement === document.querySelector(".robin-mobile-nav-trigger"));
    await trigger.click(); await opened();
    let box = await handle.boundingBox();
    const start = Math.min(170, box.x + box.width - 8), y = box.y + box.height / 2;
    await page.mouse.move(start, y); await page.mouse.down();
    await page.mouse.move(start - 40, y, { steps: 5 });
    assert.ok((await x()) < -30 && (await x()) > -50, "Panel follows the pointer, not a CSS tween");
    await page.waitForTimeout(130); await page.mouse.up(); await opened();
    assert.equal(await panel.evaluate(el => el.style.transform), "", "Settled styles return to CSS");

    // Cancel and lost capture do not accidentally commit a close.
    await page.mouse.move(start, y); await page.mouse.down(); await page.mouse.move(start - 140, y, { steps: 5 });
    await panel.dispatchEvent("pointercancel", { pointerId: 1 }); await page.mouse.up(); await opened();
    if (reducedMotion === "no-preference") {
      await page.mouse.move(start, y); await page.mouse.down(); await page.mouse.move(start - 70, y, { steps: 5 });
      await page.waitForTimeout(130); await page.mouse.up();
      box = await handle.boundingBox();
      await page.mouse.move(Math.max(20, box.x + box.width - 10), y);
      await page.mouse.down();
      const paused = await x(); await page.waitForTimeout(60);
      assert.ok(Math.abs((await x()) - paused) < 1, "Re-grabbing stops the running spring at its presentation position");
      await panel.dispatchEvent("pointercancel", { pointerId: 1 }); await page.mouse.up(); await opened();
    }

    // Real touch events through Chromium's input pipeline, not synthetic React callbacks.
    await page.evaluate(() => document.fonts.ready);
    box = await handle.boundingBox();
    const touchX = box.x + Math.min(170, box.width - 10), touchY = box.y + box.height / 2;
    const cdp = await context.newCDPSession(page);
    assert.ok(box.height >= 44, "The drag handle is a touch-sized region");
    assert.match(await handle.evaluate(el => getComputedStyle(el).touchAction), /pan-y/);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchX, y: touchY }] });
    for (let dx = 20; dx <= 160; dx += 20) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchX - dx, y: touchY }] });
      await page.waitForTimeout(16);
    }
    assert.ok((await x()) < -130, `Touch drag must track the finger (position ${await x()})`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await closed();
    await page.waitForFunction(() => document.activeElement === document.querySelector(".robin-mobile-nav-trigger"));
    await trigger.click(); await opened();
    await page.setViewportSize({ width: 1200, height: 850 });
    await page.locator(".robin-nav.is-rail").waitFor();
    assert.equal(await panel.evaluate(el => el.style.transform), "", "Resizing releases gesture-owned styles");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("PASS: keyboard focus/no motion, pointer tracking, hold/cancel/re-grab, touch dismissal, reduced motion and desktop resize.");
} finally { await browser.close(); }
