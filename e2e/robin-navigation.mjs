// Existing dev server; all application APIs are mocked after login. No personal data is written.
// node --env-file-if-exists=.env.local --experimental-strip-types e2e/robin-navigation.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok(), `Login failed (${login.status()})`);
  }
  await context.addInitScript(() => {
    localStorage.setItem("pi-locale", "en");
    window.navigationDocumentId = crypto.randomUUID();
  });
  const today = "2030-05-12";
  const fixtures = {
    "/api/robin/todos": { todos: [], today },
    "/api/robin/events": { events: [], today, google: { connected: false } },
    "/api/robin/tech-events": { events: [], today, scan: null, scanning: false },
    "/api/robin/jobs": { jobs: [], scan: null, minScore: 4, digestSize: 10, configured: false },
    "/api/robin/gmail": { review: null, connected: false, today },
    "/api/robin/practice": { records: [], today },
    "/api/robin/rounds": { rounds: [] },
    "/api/robin/notes-agent": { finals: {} },
    "/api/robin/links": { links: [] },
    "/api/robin/learning": { practice: practicePlan([], "neetcode150", today), fullstack: fullstackPlan([]) },
  };
  const writes = [];
  await context.route("**/api/**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.fulfill({ json: fixtures[new URL(request.url()).pathname] ?? {} });
  });
  const page = await context.newPage();
  const errors = [];
  const documents = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
  });
  const nav = (path) => page.locator(`.robin-nav-entry[href^="${path}?"]`);
  const ready = async (path) => {
    await page.waitForURL((url) => url.pathname === path);
    await nav(path).and(page.locator('[aria-current="page"]')).waitFor({ state: "visible" });
    await page.locator("h1").first().waitFor();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const documentId = () => page.evaluate(() => window.navigationDocumentId);
  const visit = async (path, keyboard = false) => {
    const before = await documentId();
    const documentCount = documents.length;
    const start = performance.now();
    if (keyboard) { await nav(path).focus(); await page.keyboard.press("Enter"); }
    else await nav(path).click();
    await ready(path);
    console.log(`${path}: ${Math.round(performance.now() - start)}ms, document requests: ${documents.length - documentCount}`);
    assert.equal(await documentId(), before, `${path}: navigation must preserve the browser document`);
    assert.equal(documents.length, documentCount, `${path}: no full-page request`);
    assert.equal(new URL(page.url()).searchParams.get("session"), "navigation-test", "Session context survives navigation");
  };

  await page.goto("/dashboard?session=navigation-test");
  await ready("/dashboard");
  assert.equal(await nav("/dashboard/kanban").count(), 0, "Kanban is no longer a navigation tab");
  // Warm both routes before measuring the actual navigation, not first-time compilation.
  await context.request.get("/dashboard/gmail?session=navigation-test");
  await page.locator(".robin-nav").evaluate((element) => { element.navigationMarker = true; });
  await visit("/dashboard/gmail");
  assert.equal(await page.locator(".robin-nav").evaluate((element) => element.navigationMarker), true, "Dashboard children retain the navigation shell");
  for (const path of ["/dashboard/events", "/dashboard/jobs", "/learn", "/podcasts", "/dashboard"]) await visit(path);
  await visit("/learn", true);
  const beforeHistory = await documentId();
  await page.goBack();
  await ready("/dashboard");
  await page.goForward();
  await ready("/learn");
  assert.equal(await documentId(), beforeHistory, "Back/forward between enabled routes stays in the document");

  // Modifier-click keeps ordinary anchor semantics and doesn't leave the current page.
  const popupPromise = context.waitForEvent("page");
  await nav("/dashboard/gmail").click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  const popup = await popupPromise;
  await popup.waitForURL((url) => url.pathname === "/dashboard/gmail");
  assert.equal(new URL(page.url()).pathname, "/learn");
  await popup.close();

  // The same navigation closes the phone drawer; Escape still returns focus.
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.locator('button[aria-controls="robin-navigation"]');
  await trigger.click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement === document.querySelector('button[aria-controls="robin-navigation"]'));
  await trigger.click();
  const beforeMobile = await documentId();
  await nav("/dashboard/gmail").click();
  await page.waitForURL((url) => url.pathname === "/dashboard/gmail");
  await page.waitForFunction(() => document.querySelector('#robin-navigation')?.inert && !document.querySelector('.robin-shell-content')?.inert);
  assert.equal(await documentId(), beforeMobile);
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");

  // Cwd encoding is also retained when there is no active session.
  await page.setViewportSize({ width: 1440, height: 900 });
  const cwd = "/tmp/navigation space/中文";
  await page.goto(`/learn?cwd=${encodeURIComponent(cwd)}`);
  await ready("/learn");
  const beforeCwd = await documentId();
  await nav("/dashboard/gmail").click();
  await ready("/dashboard/gmail");
  assert.equal(new URL(page.url()).searchParams.get("cwd"), cwd);
  assert.equal(await documentId(), beforeCwd);

  // An expired session must redirect an uncached RSC navigation, not leave a dead link.
  if (process.env.PI_WEB_PASSWORD) {
    await context.clearCookies();
    await nav("/dashboard/events").click();
    await page.waitForURL((url) => url.pathname === "/login");
    await page.locator('input[type="password"]').waitFor();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, [], "Navigation must not mutate application data");
  console.log("PASS: soft navigation, persistent dashboard shell, history, keyboard/new-tab, mobile drawer, context, and expired auth");
} finally {
  await browser.close();
}
