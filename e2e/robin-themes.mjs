// Existing dev server; all application APIs mocked after login, no personal data writes.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/robin-themes.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { DARK_THEMES, THEME_OPTIONS } from "../lib/theme.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
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
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator('input[name="theme"]').first().waitFor({ state: "attached" });

  const paints = async () => page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const nav = getComputedStyle(document.querySelector(".robin-navigation-container"));
    const sidebar = getComputedStyle(document.querySelector(".sidebar-container"));
    const probe = document.createElement("span");
    document.body.append(probe);
    const paint = (background) => {
      probe.style.background = background;
      const style = getComputedStyle(probe);
      return background.includes("gradient") ? style.backgroundImage : style.backgroundColor;
    };
    const result = {
      nav: nav.backgroundImage, sidebar: sidebar.backgroundImage,
      themedChrome: paint("linear-gradient(180deg, var(--bg-panel), var(--bg))"),
      lightChrome: paint("linear-gradient(180deg, #f3f2f0, #ebe7e4), linear-gradient(90deg, rgb(234 205 124 / 0.13), rgb(139 81 60 / 0.07))"),
      darkChrome: paint("linear-gradient(180deg, #212730, #0d1116), linear-gradient(90deg, rgb(75 96 124 / 0.14), rgb(47 95 138 / 0.08))"),
      surface: paint("var(--accent-soft)"), themedSurface: paint("color-mix(in srgb, var(--accent) 15%, transparent)"),
      copy: root.getPropertyValue("--copy").trim(), muted: root.getPropertyValue("--text-muted").trim(),
      onAccent: root.getPropertyValue("--on-accent").trim(), accentContrast: root.getPropertyValue("--accent-contrast").trim(),
    };
    probe.remove();
    return result;
  });

  for (const { id } of THEME_OPTIONS.filter(({ id }) => id !== "auto")) {
    await page.locator(`input[name="theme"][value="${id}"]`).locator("..").click();
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, id);
    const colors = await paints();
    const expected = id === "light" ? colors.lightChrome : id === "dark" ? colors.darkChrome : colors.themedChrome;
    assert.equal(colors.nav, expected, `${id}: Robin navigation must use the selected palette`);
    assert.equal(colors.sidebar, expected, `${id}: session sidebar must use the selected palette`);
    if (id !== "light" && id !== "dark") {
      assert.equal(colors.surface, colors.themedSurface, `${id}: Robin accent surfaces must not retain the old blue/clay`);
      assert.equal(colors.copy, colors.muted, `${id}: Robin body copy follows palette contrast`);
      assert.equal(colors.onAccent, colors.accentContrast, `${id}: reversed text uses palette contrast`);
    }
    assert.equal(await page.locator("html").evaluate((root) => root.classList.contains("dark")), DARK_THEMES.includes(id));
    console.log(`PASS ${id}: navigation, session sidebar and Robin tokens`);
  }

  // Reload, system changes, and the mobile drawer all use the same tokens.
  await page.locator('input[name="theme"][value="contrast-dark"]').locator("..").click();
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "contrast-dark");
  assert.equal((await paints()).sidebar, (await paints()).themedChrome);
  const screenshots = process.env.E2E_SCREENSHOT_DIR;
  if (screenshots) {
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: `${screenshots}/contrast-dark-desktop.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  assert.equal((await paints()).sidebar, (await paints()).themedChrome);
  if (screenshots) await page.screenshot({ path: `${screenshots}/contrast-dark-mobile.png` });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator('input[name="theme"][value="auto"]').locator("..").click();
  for (const colorScheme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, colorScheme);
    const colors = await paints();
    assert.equal(colors.nav, colors[`${colorScheme}Chrome`]);
    assert.equal(colors.sidebar, colors[`${colorScheme}Chrome`]);
  }
  assert.deepEqual(errors, []);
  console.log("PASS reload, mobile sidebar, system preference and browser errors");
} finally {
  await browser.close();
}
