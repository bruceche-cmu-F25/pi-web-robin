// Existing dev server. All application APIs mocked after login; never prompts or writes user data.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/navigation-placement.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const key = "pi-web:navigation-placement";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok(), `Login failed (${login.status()})`);
  }
  await context.addInitScript(() => {
    localStorage.setItem("pi-locale", "en");
    localStorage.setItem("pi-theme", "light"); // Baseline geometry; Glass gutters have their own suite.
  });
  const cwd = "/tmp/navigation-preview";
  const fixtures = {
    "/api/sessions": { sessions: [], runningSessionIds: [], sessionListVersion: 1 },
    "/api/sessions/ui-state": { version: 1, revision: 0, sessions: {}, projects: {} },
    "/api/agent/running": { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
    "/api/models": { models: [], modelList: [] },
    "/api/robin/todos": { todos: [], today: "2030-05-12" },
    "/api/robin/events": { events: [], today: "2030-05-12" },
    "/api/robin/gmail": { review: null, connected: false },
    "/api/robin/ai-weekly": { archive: [], preferences: { enabled: false }, edition: null, read: [], deliveries: [], run: null },
    "/api/robin/jobs": { jobs: [] },
    "/api/robin/rounds": { rounds: [] },
    "/api/robin/practice": { records: [] },
    "/api/robin/tech-events": { events: [] },
    "/api/tools/settings": { isWindows: false },
    "/api/cache-miss-notices": { enabled: false },
  };
  const writes = [];
  await context.route("**/api/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/cwd/validate") return route.fulfill({ json: { cwd: request.postDataJSON().cwd } });
    if (request.method() !== "GET") writes.push(`${request.method()} ${path}`);
    // Navigation preferences are still usable when service settings are unavailable.
    if (path === "/api/robin/settings") return route.fulfill({ status: 503, json: { error: "Service settings unavailable (test fixture)" } });
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
  const nav = page.locator(".robin-navigation-container");
  const box = selector => page.locator(selector).boundingBox();
  const ready = async placement => {
    await page.waitForFunction(value => document.querySelector("[data-navigation-placement]")?.getAttribute("data-navigation-placement") === value, placement);
    if (placement === "left" && page.viewportSize().width >= 960) await page.locator(".robin-nav.is-rail").waitFor();
    if (placement === "top-icons" && page.viewportSize().width >= 960) await page.locator(".robin-nav.is-top-icons").waitFor();
  };
  const pick = (target, value) => target.getByRole("radiogroup", { name: "Global navigation", exact: true }).getByText(value, { exact: true }).click();
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Page does not overflow");
  await page.goto(`/?cwd=${encodeURIComponent(cwd)}`);
  await page.locator("textarea").first().waitFor();
  await ready("left");
  assert.equal((await nav.boundingBox()).width, 48);
  assert.equal((await nav.boundingBox()).x, 0);
  assert.equal((await box("#session-sidebar")).x, 48);
  const styleSignature = () => page.evaluate(() => [".pi-topbar", ".session-sidebar", ".chat-input-textarea"].map(selector => {
    const el = document.querySelector(selector);
    const s = getComputedStyle(el);
    return [s.fontFamily, s.fontSize, s.color, s.backgroundColor, s.backgroundImage];
  }));
  const before = await styleSignature();
  const sidebarWidth = (await box("#session-sidebar")).width;
  const entry = page.locator('.robin-nav-entry[data-nav-label="Research"]');
  await entry.focus();
  await page.getByRole("tooltip").waitFor();
  assert.equal(await page.getByRole("tooltip").textContent(), "Research");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("tooltip").count(), 0);
  assert.ok((await entry.boundingBox()).width >= 44);
  assert.ok((await entry.boundingBox()).height >= 44);
  await page.locator("textarea").first().fill("draft survives navigation placement changes");
  await page.locator("textarea").first().evaluate(el => { el.navigationMarker = true; });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await pick(page, "Top");
  await ready("top");
  assert.equal(await page.evaluate(k => localStorage.getItem(k), key), "top");
  assert.equal((await nav.boundingBox()).width, 1440);
  assert.equal((await box("#session-sidebar")).x, 0);
  assert.equal((await box("#session-sidebar")).width, sidebarWidth);
  assert.deepEqual(await styleSignature(), before, "Existing content styling is unchanged");
  assert.equal(await page.locator("textarea").first().evaluate(el => el.navigationMarker), true, "Chat does not remount");
  await pick(page, "Left");
  await page.keyboard.press("Escape");
  await ready("left");
  assert.equal(await page.locator("textarea").first().inputValue(), "draft survives navigation placement changes");
  await page.reload();
  await ready("left");
  await page.locator("textarea").first().waitFor();
  assert.equal((await nav.boundingBox()).width, 48);

  // Labels are an opt-in, without changing the existing default or remounting content.
  await page.getByRole("button", { name: "Show navigation labels", exact: true }).click();
  await ready("left-labels");
  assert.equal((await nav.boundingBox()).width, 184);
  assert.ok((await entry.locator(".robin-nav-label").boundingBox()).width > 40);
  assert.equal(await page.locator("textarea").first().inputValue(), "draft survives navigation placement changes");
  assert.deepEqual(await styleSignature(), before);
  if (process.env.E2E_SCREENSHOT_DIR) {
    await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/navigation-labels.png` });
  }
  await page.reload(); await ready("left-labels");
  assert.equal((await nav.boundingBox()).width, 184);
  await page.getByRole("button", { name: "Hide navigation labels", exact: true }).click();
  await ready("left");

  // Settings on another page/tab controls the same mounted shell.
  const other = await context.newPage();
  await other.goto("/dashboard/settings");
  await pick(other, "Top");
  await ready("top");
  assert.equal((await nav.boundingBox()).width, 1440);
  await pick(other, "Top, icons only");
  await ready("top-icons");
  assert.equal((await nav.boundingBox()).width, 1440);
  assert.equal((await entry.locator(".robin-nav-label").boundingBox()).width, 1);
  assert.equal((await entry.boundingBox()).width, 44);
  assert.equal(await page.locator("textarea").first().inputValue(), "draft survives navigation placement changes");
  await other.reload();
  await other.waitForFunction(() => document.querySelector('.robin-nav.is-top-icons'));
  assert.equal(await other.getByRole("radio", { name: "Top, icons only", exact: true }).isChecked(), true);
  await pick(other, "Left");
  await ready("left");
  await other.close();

  assert.equal(await page.locator("[data-focus-trigger], #focus-timer-panel").count(), 0, "Focus timer is removed from the rail");
  await page.locator("textarea").first().fill("");
  await mkdir("outputs/global-sidebar-preview", { recursive: true });
  await page.screenshot({ path: "outputs/global-sidebar-preview/live-48px.png" });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await pick(page, "Top, icons only");
  await page.keyboard.press("Escape");
  await ready("top-icons");
  await entry.focus();
  await page.getByRole("tooltip").waitFor();
  assert.ok((await page.getByRole("tooltip").boundingBox()).y >= (await nav.boundingBox()).height);
  await page.keyboard.press("Escape");
  await entry.hover();
  await page.getByRole("tooltip").waitFor();
  await page.mouse.move(700, 400);
  await page.locator("textarea").first().focus();
  assert.equal(await page.getByRole("tooltip").count(), 0);
  assert.deepEqual(await styleSignature(), before, "Icons-only top navigation leaves content styling unchanged");
  await page.screenshot({ path: "outputs/global-sidebar-preview/live-top-icons.png" });
  assert.equal(await page.locator("[data-focus-trigger], #focus-timer-panel").count(), 0, "Focus timer is removed from top navigation");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await pick(page, "Left");
  await page.keyboard.press("Escape");
  await ready("left");

  for (const size of [{ width: 1024, height: 400 }, { width: 960, height: 768 }]) {
    await page.setViewportSize(size);
    await ready("left");
    await noOverflow();
    const utility = await box(".robin-nav-utility");
    assert.ok(utility.y + utility.height <= size.height, "Utilities stay reachable on short screens");
    await entry.focus();
    await page.keyboard.press("Escape");
    const research = await entry.boundingBox();
    assert.ok(research.y >= 0 && research.y + research.height <= utility.y, "Keyboard reaches scrolled rail entries");
  }
  // Phone chat exposes useful workspaces in one native scrolling row; More keeps the directory.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => !document.querySelector(".robin-nav.is-rail"));
  assert.equal((await nav.boundingBox()).width, 390);
  const compact = page.locator('.robin-nav-compact');
  assert.deepEqual(await compact.locator('.robin-nav-label').allTextContents(), ['Home', 'Chat', 'Notes', 'Learning Hub', 'Incoming', 'Jobs', 'Research', 'More']);
  for (const width of [320, 390, 812]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow();
    const top = (await compact.getByRole('link').first().boundingBox()).y;
    for (const link of await compact.getByRole('link').all()) {
      await link.focus();
      const rect = await link.boundingBox(); assert.ok(rect.height >= 44 && rect.width >= 44);
      assert.ok(Math.abs(rect.y - top) <= 1, `Shortcuts never wrap into a second header row: ${JSON.stringify({ width, top, rect })}`);
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1, 'Focus reveals each full shortcut in the scroll strip');
      assert.ok((await link.locator('.robin-nav-label').boundingBox()).width > 20);
      assert.equal(new URL(await link.getAttribute('href'), baseURL).searchParams.get('cwd'), cwd, 'Shortcuts preserve the active chat project');
    }
    await compact.getByRole('link', { name: 'Home', exact: true }).focus();
    await page.screenshot({ path: `outputs/global-sidebar-preview/phone-shortcuts-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('textarea').first().fill('mobile navigation draft');
  await compact.getByRole('link', { name: 'More', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/dashboard' && url.searchParams.get('view') === 'more');
  assert.equal(new URL(page.url()).searchParams.get('cwd'), cwd);
  await page.locator('[data-workspace="settings"]').click();
  await page.waitForURL(url => url.pathname === '/dashboard/settings');
  const secret = page.locator('#google').getByLabel('Client Secret', { exact: true });
  await page.evaluate(() => location.replace('#google'));
  await secret.fill('unsaved-navigation-fixture');
  let guarded = false;
  page.once('dialog', async dialog => { guarded = dialog.type() === 'beforeunload'; await dialog.dismiss(); });
  await page.goBack({ timeout: 3000 }).catch(() => {});
  assert.ok(guarded, 'Back from settings entered through More protects the secret draft');
  assert.equal(await secret.inputValue(), 'unsaved-navigation-fixture');
  await secret.fill('');
  await page.goBack();
  await page.waitForURL(url => url.pathname === '/dashboard');
  await page.goBack(); await page.locator('textarea').first().waitFor();
  assert.equal(await page.locator('textarea').first().inputValue(), 'mobile navigation draft');
  // Robin pages keep their existing drawer and close behavior.
  await page.goto(`/dashboard/gmail?cwd=${encodeURIComponent(cwd)}`);
  const trigger = page.locator(".robin-mobile-nav-trigger");
  await trigger.click();
  await page.locator('.robin-nav-entry[href^="/dashboard/settings?"]').click();
  await page.waitForURL(url => url.pathname === "/dashboard/settings");
  await pick(page, "Top, icons only");
  await trigger.click();
  await page.keyboard.press("Escape");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await noOverflow();
  assert.deepEqual(writes, [], "Preference changes do not write service settings or start sessions");
  assert.deepEqual(errors, []);
  console.log("PASS: 48px/184px rails + both top modes, both settings, reload/cross-tab sync, unchanged styles, draft, tooltip, no focus timer, short-screen scroll and mobile behavior");
} finally {
  await browser.close();
}
