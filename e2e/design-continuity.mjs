// Mocked APIs only: saved list positions, URL filters and linked-document reading context.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  const date = "2030-05-12T12:00:00Z", errors = [];
  const paragraphs = Array.from({ length: 40 }, (_, i) => `Reading paragraph ${i}. The reader decides what to do; the interface preserves their context.`).join("\n\n");
  const fixtures = {
    "/api/sessions": { sessions: [], runningSessionIds: [], sessionListVersion: 1 },
    "/api/sessions/ui-state": { version: 1, revision: 0, sessions: {}, projects: {} },
    "/api/agent/running": { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
    "/api/models": { models: [], modelList: [] },
    "/api/robin/gmail": { connected: true, today: "2030-05-12", review: { reviewedAt: date, headline: "Fixture mail", skipped: 0,
      items: Array.from({ length: 35 }, (_, i) => ({ id: `mail-${i}`, category: "other", action: "none", triage: "act", subject: `Reading item ${i}`, from: "Fixture", summary: "Reading context", snippet: "Fixture", next: "Read the message" })) } },
    "/api/robin/ai-weekly": { archive: [], preferences: { enabled: false }, edition: null, read: [], deliveries: [], run: null },
    "/api/robin/products": { ideas: Array.from({ length: 25 }, (_, i) => ({ id: `idea-${i}`, name: `Idea ${i}`, note: "A small experiment", step: "spot", links: [], createdAt: date, updatedAt: date })), captures: [] },
    "/api/robin/product-library": { resources: [] },
    "/api/robin/todos": { todos: [], today: "2030-05-12" }, "/api/robin/events": { events: [] },
    "/api/robin/jobs": { jobs: [] }, "/api/robin/rounds": { rounds: [] }, "/api/robin/practice": { records: [] },
    "/api/skills": { skills: [{ name: "Reading fixture", description: "Follow a document and return to where you left off.", filePath: "/tmp/design-fixture/SKILL.md", disableModelInvocation: false, sourceInfo: { source: "user", scope: "user" } }] },
    "/api/tools/settings": { isWindows: false }, "/api/cache-miss-notices": { enabled: false },
  };
  await context.route("**/api/**", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/api/cwd/validate") return route.fulfill({ json: { cwd: "/tmp/design-fixture" } });
    assert.equal(request.method(), "GET", `Unexpected write ${url.pathname}`);
    if (url.pathname === "/api/skills/content") return route.fulfill({ json: { content: url.searchParams.has("document") ? "# Linked document\n\nKeep the original reading position." : `# Reading fixture\n\n${paragraphs}\n\n[Open companion](companion.md)\n\n${paragraphs}` } });
    return route.fulfill({ json: fixtures[url.pathname] ?? { opportunities: [], assessments: {}, savedIds: [] } });
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard/gmail");
  const search = page.locator('#incoming-email input[type="search"]');
  await search.fill("Reading"); await page.waitForURL(/mailq=Reading/);
  const mail = page.locator("#incoming-email .overflow-y-auto");
  await mail.evaluate(el => { el.scrollTop = 650; }); await page.waitForTimeout(100);
  await page.locator('button[aria-controls="incoming-ai"]').click();
  await page.waitForURL(/feed=ai/); await page.goBack();
  await page.waitForFunction(() => document.querySelector('#incoming-email .overflow-y-auto')?.scrollTop > 600);
  assert.equal(await search.inputValue(), "Reading");
  await page.reload(); await search.waitFor();
  await page.waitForFunction(() => document.querySelector('#incoming-email .overflow-y-auto')?.scrollTop > 600);
  assert.equal(await search.inputValue(), "Reading");

  await page.goto("/product?view=ideas&stage=spot");
  const product = page.locator("main.overflow-y-auto");
  await page.getByRole("button", { name: "My ideas 25", exact: true }).waitFor();
  await product.evaluate(el => { el.scrollTop = 900; }); await page.waitForTimeout(100);
  await page.reload(); await product.waitFor();
  await page.waitForFunction(() => document.querySelector('main.overflow-y-auto')?.scrollTop > 850);
  assert.equal(await page.getByLabel("Filter by project stage").inputValue(), "spot");

  await page.goto("/?cwd=%2Ftmp%2Fdesign-fixture");
  await page.locator("textarea").first().waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings", exact: true }).getByRole("button", { name: "Skills", exact: true }).click();
  const link = page.getByRole("link", { name: "Open companion", exact: true });
  await link.scrollIntoViewIfNeeded();
  const detail = page.locator('.config-detail').filter({ has: link });
  const readingTop = await detail.evaluate(el => el.scrollTop);
  assert.ok(readingTop > 500);
  await link.click(); await page.getByRole("heading", { name: "Linked document", exact: true }).waitFor();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await link.waitFor();
  await page.waitForFunction(top => Math.abs(document.querySelector('.skill-instructions')?.closest('.config-detail').scrollTop - top) < 2, readingTop);
  assert.ok(await page.locator('.skill-instructions').evaluate(el => el.closest('.config-field') === document.activeElement));
  assert.ok(await page.locator('.config-field-label').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 13));
  assert.equal(await page.locator('.config-button').first().evaluate(el => getComputedStyle(el).animationName), "none");
  if (process.env.E2E_SCREENSHOT_DIR) {
    await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/settings-${theme}.png` });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/settings-mobile.png` });
  }
  await page.emulateMedia({ contrast: "more" });
  for (const theme of ["light", "dark", "pine"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); }, theme);
    assert.equal(await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return style.getPropertyValue('--text').trim() === style.getPropertyValue('--text-muted').trim();
    }), true, `High contrast wins over the ${theme} palette`);
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches), true);
  assert.equal(await page.locator('.settings-dialog-surface').evaluate(el => getComputedStyle(el).backdropFilter), "none");
  assert.deepEqual(errors, []);
  console.log("PASS: mail search/history/scroll, product filter/scroll, skill reading position/focus, settings type scale and accessibility preferences.");
} finally { await browser.close(); }
