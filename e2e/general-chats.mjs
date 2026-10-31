// Existing dev server; APIs mocked after login. No folders or sessions are written.
// node --env-file-if-exists=.env.local e2e/general-chats.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) {
    const login = await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } });
    assert.ok(login.ok(), `Login failed (${login.status()})`);
  }
  await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  const project = "/tmp/project";
  const general = "/tmp/home/pi-cwd/general";
  let refuse = false;
  let calls = 0;
  const unexpectedWrites = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/default-cwd") {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return route.fulfill(refuse ? { status: 500, json: { error: "Cannot create general workspace" } } : { json: { cwd: general } });
    }
    if (path === "/api/cwd/validate") {
      const cwd = request.postDataJSON().cwd;
      return route.fulfill({ json: { cwd, projectRoot: cwd, projectKey: cwd } });
    }
    if (request.method() !== "GET") unexpectedWrites.push(`${request.method()} ${path}`);
    const cwd = url.searchParams.get("cwd") ?? project;
    const fixtures = {
      "/api/home": { home: "/tmp/home", generalProject: { root: general, key: general } },
      "/api/sessions": { sessions: [], runningSessionIds: [], sessionListVersion: 1 },
      "/api/sessions/ui-state": { version: 1, revision: 0, sessions: {}, projects: {} },
      "/api/agent/running": { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
      "/api/models": { models: [], modelList: [] },
      "/api/worktrees": { isGit: false, projectRoot: cwd, projectKey: cwd, worktrees: [] },
    };
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const composer = page.locator("textarea").first();
  const entry = page.getByRole("button", { name: "New general chat", exact: true });
  await page.goto(`/?cwd=${encodeURIComponent(project)}`);
  await composer.fill("Project draft stays in the project");
  refuse = true;
  await entry.click();
  await page.getByText("Cannot create general workspace", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("cwd"), project);
  assert.equal(await composer.inputValue(), "Project draft stays in the project");
  refuse = false;
  await entry.click();
  await page.waitForURL((url) => url.searchParams.get("cwd") === general);
  await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
  await page.locator(".new-session-context").getByText("General chats", { exact: true }).waitFor();
  assert.equal(calls, 2);
  await page.screenshot({ path: "/tmp/general-chats-desktop.png" });
  await composer.fill("General draft");
  await page.reload();
  await page.waitForFunction(() => document.querySelector("textarea")?.value === "General draft");
  await entry.click();
  await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
  assert.equal(calls, 3, "repeated entry opens a fresh composer in the same directory");
  assert.ok(await page.evaluate(() => Object.values(sessionStorage).some((value) => value.includes("Project draft stays in the project"))), "leaving parks the project draft rather than carrying it into general chat");
  await page.goto(`/?cwd=${encodeURIComponent(project)}`);
  await composer.waitFor({ state: "visible" });
  await page.locator(".new-session-context").getByText("project", { exact: true }).waitFor();
  await page.locator(".sidebar-new-button").click();
  assert.equal(new URL(page.url()).searchParams.get("cwd"), project, "project New still uses the project");
  assert.equal(calls, 3, "project New never requests the general workspace");
  assert.deepEqual(unexpectedWrites, [], "navigation must not create or prompt sessions");
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 375, height: 812 });
  // The mobile drawer may be closed, but its entry must retain the 44px touch target.
  await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector(".sidebar-general-chat")).minHeight) >= 44);
  await page.screenshot({ path: "/tmp/general-chats-mobile.png" });
  console.log("PASS: general entry, errors, stable grouping, reload, fresh chat, project drafts and mobile target");
} finally {
  await browser.close();
}
