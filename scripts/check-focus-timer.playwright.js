// Run in an authenticated disposable browser (localStorage is test-only):
// playwright-cli -s=focus-timer run-code --filename=scripts/check-focus-timer.playwright.js
// No real API writes; clocks and sound output are instrumented.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Playwright CLI evaluates this function.
async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  // Local dev server (see AGENTS.md); page.url() may be about:blank on a reused session.
  const base = "http://127.0.0.1:30141";
  const context = page.context();
  // A reused session can carry a fake clock from a prior run; start clean.
  await page.close();
  page = await context.newPage();
  const key = "pi-web:focus-timer:v1";
  await context.route("**/api/**", (route) => route.request().method() === "GET"
    ? route.continue() : route.fulfill({ json: { ok: true } }));
  await context.addInitScript(() => {
    localStorage.setItem("pi-locale", "zh-CN");
    window.__focusToneStarts = 0;
    window.AudioContext = class {
      state = "running";
      currentTime = 0;
      destination = {};
      resume() { return Promise.resolve(); }
      createOscillator() { return { frequency: {}, connect() {}, start() { window.__focusToneStarts++; }, stop() {} }; }
      createGain() { return { connect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
    };
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/dashboard`);
  await page.evaluate((key) => localStorage.removeItem(key), key);
  const trigger = (target) => target.locator('[data-focus-trigger]');
  const panel = page.locator("#focus-timer-panel");
  await page.getByRole("button", { name: "打开专注计时器" }).click();
  check(await panel.getByRole("timer").innerText() === "25:00", "Default focus is 25 minutes");
  const focus = panel.getByRole("spinbutton", { name: /^专注/ });
  const rest = panel.getByRole("spinbutton", { name: /^休息/ });
  check(await rest.inputValue() === "5", "Default break is 5 minutes");
  await focus.fill("0");
  check(await focus.getAttribute("aria-invalid") === "true", "Invalid duration is explained inline");
  await focus.press("Tab");
  check(await focus.inputValue() === "25", "Invalid duration is not persisted");
  await focus.fill("1");
  await focus.press("Tab");
  await rest.fill("2");
  await rest.press("Tab");
  await panel.getByRole("checkbox", { name: "提示音" }).click();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).sound === false, key);
  await panel.getByRole("button", { name: "开始专注", exact: true }).click();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).status === "running", key);
  check(!await panel.isVisible(), "Starting dismisses the panel");
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  const browserNow = await page.evaluate(() => Date.now());
  check(saved.endsAt - browserNow <= 60_000 && saved.endsAt - browserNow >= 50_000, "Custom duration starts immediately");

  // Real route loads/reloads retain the exact deadline, independent of mount.
  for (const route of ["/learn", "/product", "/research", "/", "/dashboard"]) {
    await page.goto(`${base}${route}`);
    await trigger(page).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-focus-trigger]')?.getAttribute("data-active") === "true");
    check(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).endsAt, key) === saved.endsAt, `Deadline survives ${route}`);
  }
  await page.reload();
  await trigger(page).click();
  await panel.getByRole("button", { name: "暂停", exact: true }).click();
  await panel.getByRole("button", { name: "继续", exact: true }).waitFor();
  const paused = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  await focus.fill("50");
  await focus.press("Tab");
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).focusMinutes === 50, key);
  check(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).remainingMs, key) === paused.remainingMs, "Editing settings does not change paused time");
  await page.keyboard.press("Escape");
  check(await trigger(page).evaluate((el) => document.activeElement === el), "Escape returns focus to trigger");
  await trigger(page).click();
  await panel.getByRole("button", { name: "继续", exact: true }).click();
  await panel.getByRole("button", { name: "暂停", exact: true }).waitFor();
  await panel.getByRole("button", { name: "结束本次", exact: true }).click();
  await panel.getByRole("button", { name: "开始专注", exact: true }).waitFor();
  check(await panel.getByRole("timer").innerText() === "50:00", "Next round uses changed duration");

  // The timer is a nav item on wide screens and lives in the drawer below 960px.
  await page.keyboard.press("Escape"); // close the panel first so layout checks are stable
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
    for (const width of [960, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(100);
      check(await trigger(page).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.height >= 42;
      }), `Desktop trigger visible: ${theme}/${width}`);
      const nav = page.locator(".robin-nav");
      check(await nav.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `Navigation not clipped: ${theme}/${width}`);
    }
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator(".robin-mobile-nav-trigger").click();
      await page.waitForFunction(() => {
        const r = document.querySelector('[data-focus-trigger]')?.getBoundingClientRect();
        return Boolean(r && r.left >= 0 && r.right <= innerWidth && r.height >= 42);
      });
      await trigger(page).click();
      await page.waitForFunction(() => document.querySelector("#focus-timer-panel"));
      check(await panel.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && el.scrollWidth <= el.clientWidth + 1;
      }), `Panel fits: ${theme}/${width}`);
      await page.keyboard.press("Escape"); // closes panel and drawer together
      await page.waitForTimeout(150);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".robin-mobile-nav-trigger").click();
  await trigger(page).click();
  await page.waitForFunction(() => document.querySelector("#focus-timer-panel"));
  await page.screenshot({ path: "/tmp/focus-timer-mobile.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(await panel.evaluate((el) => getComputedStyle(el).animationName) === "none", "Reduced-motion disables entry animation");
  await page.keyboard.press("Escape");

  // Completion: a non-modal reminder that never steals focus, chimes once, and
  // stays dismissed. A running timer with a past deadline is written to storage
  // and the hook's own tick discovers it — no fake clock, so reruns stay clean.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key));
    s.sound = true;
    localStorage.setItem(key, JSON.stringify(s));
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }, key);
  await trigger(page).click(); // unlock audio now that sound is on
  await page.keyboard.press("Escape");
  const search = page.locator(".robin-dashboard-header input").first();
  await search.fill("timer-check");
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key));
    s.status = "running";
    s.endsAt = Date.now() - 1000;
    localStorage.setItem(key, JSON.stringify(s));
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }, key);
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).status === "complete", key);
  check(await panel.isVisible(), "Completion opens a reminder");
  check(await search.evaluate((el) => document.activeElement === el), "The reminder never steals typing focus");
  check(await page.evaluate(() => window.__focusToneStarts) === 2, "One two-note chime");
  await page.screenshot({ path: "/tmp/focus-timer-complete.png" });
  // A tab opened after completion must not re-announce it.
  const second = await context.newPage();
  await second.goto(`${base}/dashboard`);
  await trigger(second).waitFor();
  check(!await second.locator("#focus-timer-panel").isVisible(), "A second tab does not re-announce a completion");
  check(await page.evaluate(() => window.__focusToneStarts) + await second.evaluate(() => window.__focusToneStarts) === 2, "Still exactly one chime");
  // Dismiss and confirm it does not reopen on refresh.
  await panel.getByRole("button", { name: "暂不休息", exact: true }).click();
  await page.reload();
  await trigger(page).waitFor();
  check(!await panel.isVisible(), "Dismissed completion does not reopen after refresh");
  await trigger(page).click();
  await panel.getByRole("button", { name: "开始休息", exact: true }).click();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).phase === "break", key);
  check(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).remainingMs, key) === 120_000, "Break starts only on click and uses custom duration");
  await second.close();

  // Return to idle and check a compact chat header independently of RobinShell.
  await page.goto(`${base}/`);
  await page.setViewportSize({ width: 320, height: 700 });
  await trigger(page).click();
  await panel.getByRole("button", { name: "结束本次", exact: true }).click();
  check(await trigger(page).evaluate((el) => el.getBoundingClientRect().right <= innerWidth), "Chat timer stays accessible at 320px");
  await page.keyboard.press("Escape");
  await page.evaluate((key) => localStorage.removeItem(key), key);
  return "PASS: defaults/custom/invalid settings, pause/resume/end, route+reload persistence, light/dark 320–1440px, reduced motion, cross-tab sync and single chime/popup, no focus theft, dismissed reminder, manual break start, chat entry.";
}
