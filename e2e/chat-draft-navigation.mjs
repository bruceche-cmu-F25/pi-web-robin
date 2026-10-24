// Existing dev server; all application APIs mocked after login. Never sends a prompt.
// node --env-file-if-exists=.env.local e2e/chat-draft-navigation.mjs
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
  const cwd = "/tmp/draft space/中文";
  const fixtures = {
    "/api/sessions": { sessions: [], runningSessionIds: [], sessionListVersion: 1 },
    "/api/sessions/ui-state": { version: 1, revision: 0, sessions: {}, projects: {} },
    "/api/agent/running": { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 },
    "/api/models": { models: [], modelList: [] },
    "/api/robin/todos": { todos: [], today: "2030-05-12" },
    "/api/robin/events": { events: [], today: "2030-05-12" },
    "/api/robin/gmail": { review: null, connected: false },
    "/api/robin/jobs": { jobs: [] },
    "/api/robin/rounds": { rounds: [] },
    "/api/robin/practice": { records: [] },
    "/api/robin/tech-events": { events: [] },
  };
  const writes = [];
  await context.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/cwd/validate") return route.fulfill({ json: { cwd: request.postDataJSON().cwd } });
    if (request.method() !== "GET") writes.push(`${request.method()} ${path}`);
    return route.fulfill({ json: fixtures[path] ?? {} });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const composer = page.locator("textarea").first();
  const expectDraft = async (text) => {
    await composer.waitFor({ state: "visible" });
    await page.waitForFunction((expected) => document.querySelector("textarea")?.value === expected, text);
  };
  await page.goto(`/?cwd=${encodeURIComponent(cwd)}`);
  await expectDraft("");
  // Exercise the random temporary id created by New, not only the initial id.
  await page.keyboard.press("Control+Alt+n");
  const draft = "还没发送的草稿\nsecond line";
  await composer.fill(draft);
  await page.locator('.robin-nav-entry[href^="/dashboard/gmail?"]').click();
  await page.waitForURL((url) => url.pathname === "/dashboard/gmail");
  await page.locator('.robin-nav-entry[href^="/?cwd="]').click();
  await expectDraft(draft);
  await page.reload();
  await expectDraft(draft);

  // Plain / uses tab memory; a separate tab must not inherit this draft.
  await page.goto("/");
  await expectDraft(draft);
  const other = await context.newPage();
  await other.goto(`/?cwd=${encodeURIComponent(cwd)}`);
  await other.locator("textarea").first().waitFor({ state: "visible" });
  assert.equal(await other.locator("textarea").first().inputValue(), "", "separate tabs do not share drafts");
  await other.close();

  // An explicit New abandons this composer; a reload must not resurrect it.
  await page.keyboard.press("Control+Alt+n");
  await expectDraft("");
  await page.reload();
  await expectDraft("");
  await composer.fill("delete this draft");
  await composer.fill("");
  await page.reload();
  await expectDraft("");
  assert.deepEqual(writes, [], "navigation must never create or prompt a session");
  assert.deepEqual(errors, []);
  console.log("PASS: new-session draft survives native navigation and reload, stays tab-local, and clears intentionally");
} finally {
  await browser.close();
}
