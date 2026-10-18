// Existing dev server; APIs mocked after login, no personal data writes.
// node --env-file-if-exists=.env.local e2e/matrix-theme.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
    if (process.env.PI_WEB_PASSWORD) {
      const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
      assert.ok(login.ok(), `Login failed (${login.status()})`);
    }
    await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
    const fixtures = {
      "/api/sessions": { sessions: [], runningSessionIds: [], sessionListVersion: 1 },
      "/api/sessions/ui-state": { version: 1, revision: 0, sessions: {}, projects: {} },
      "/api/agent/running": { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
      "/api/models": { models: [], modelList: [] },
    };
    await context.route("**/api/**", (route) => route.fulfill({ json: fixtures[new URL(route.request().url()).pathname] ?? {} }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const openSettings = async () => {
      if (width <= 640) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
    };
    const expectMatrix = async () => {
      await page.waitForFunction(() => document.documentElement.dataset.theme === "matrix");
      assert.equal(await page.locator("html").evaluate((root) => root.classList.contains("dark") && getComputedStyle(root).colorScheme === "dark"), true);
    };
    await page.goto("/");
    await openSettings();
    const matrix = page.getByRole("radio", { name: "Matrix", exact: true });
    await matrix.locator("..").click();
    await expectMatrix();
    assert.equal(await page.evaluate(() => localStorage.getItem("pi-theme")), "matrix");
    const failures = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const color = (key) => style.getPropertyValue(`--${key}`).trim();
      const luminance = (hex) => {
        const [r, g, b] = hex.slice(1).match(/../g).map((part) => {
          const c = parseInt(part, 16) / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return r * 0.2126 + g * 0.7152 + b * 0.0722;
      };
      const failures = [];
      const check = (fg, bg) => {
        const a = luminance(color(fg)), b = luminance(color(bg));
        if (!((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5)) failures.push(`${fg} on ${bg}`);
      };
      for (const fg of ["text", "text-muted", "text-dim", "accent"]) {
        for (const bg of ["bg", "bg-panel", "bg-hover", "bg-selected", "user-bg", "assistant-bg", "tool-bg"]) check(fg, bg);
      }
      for (const bg of ["accent", "accent-hover"]) check("accent-contrast", bg);
      const group = document.querySelector(".settings-theme-options").getBoundingClientRect();
      for (const name of document.querySelectorAll(".settings-theme-name")) {
        const box = name.getBoundingClientRect();
        if (name.scrollWidth > name.clientWidth || name.scrollHeight > name.clientHeight || box.right > group.right || box.left < group.left) failures.push(`Clipped label: ${name.textContent}`);
      }
      return failures;
    });
    assert.deepEqual(failures, [], `${width}px: WCAG AA and swatch layout`);
    await matrix.focus();
    await matrix.press("ArrowLeft");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "zenburn");
    await page.keyboard.press("ArrowRight");
    await expectMatrix();
    if (process.env.E2E_SCREENSHOT_DIR) {
      await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/matrix-${width}.png` });
    }
    await page.reload();
    await expectMatrix();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await expectMatrix();
    await openSettings();
    assert.equal(await matrix.isChecked(), true);
    assert.deepEqual(errors, []);
    console.log(`PASS Matrix ${width}px: selection, contrast, layout, keyboard, refresh and system independence`);
    await context.close();
  }
} finally {
  await browser.close();
}
