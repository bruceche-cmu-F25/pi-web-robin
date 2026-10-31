// Read-only settings; simulated browser permissions/streams, all application APIs mocked.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/voice-settings.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", {
    headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD },
  })).ok());
  await context.addInitScript(() => {
    if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "en");
    if (!localStorage.getItem("pi-theme")) localStorage.setItem("pi-theme", "glass");
    window.mic = { calls: 0, stopped: 0, error: null, defer: false, unknown: false };
    window.permissionStatus = Object.assign(new EventTarget(), { state: "prompt" });
    navigator.permissions.query = async () => {
      if (window.mic.unknown) throw new TypeError("Unsupported permission name");
      return window.permissionStatus;
    };
    navigator.mediaDevices.getUserMedia = async () => {
      window.mic.calls++;
      if (window.mic.error) throw new DOMException("Fixture", window.mic.error);
      const stream = { getTracks: () => [{ stop: () => window.mic.stopped++ }] };
      if (window.mic.defer) return new Promise(resolve => { window.resolveMicrophone = () => resolve(stream); });
      return stream;
    };
  });
  let writes = 0, reads = 0, failed = false, configured = true;
  const unset = { set: false };
  await context.route("**/api/**", route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") writes++;
    if (path === "/api/robin/voice") {
      reads++;
      return route.fulfill({ status: failed ? 503 : 200, json: { configured, ttsConfigured: false, asrModel: "whisper.cpp (local)", ttsModel: "fixture" } });
    }
    if (path === "/api/robin/settings") return route.fulfill({ json: {
      notifications: { channel: "telegram" }, google: { clientId: unset, clientSecret: unset, calendars: [] },
      notion: { apiToken: unset }, playwright: { extensionToken: unset },
      storedAt: "/fixture/secrets.json", googleRedirectUri: `${baseURL}/api/robin/google/callback`,
      telegram: { botToken: unset, allowedChatIds: [],
        dailyAgenda: { enabled: false, time: "08:00", locale: "en" },
        jobDigest: { enabled: false, morning: "08:00", evening: "20:00", count: 10, locale: "en", chatIds: [], sweepAt: "03:00" },
        gmailDigest: { enabled: false, time: "08:00", locale: "en", chatIds: [], query: "newer_than:1d" },
        reminders: { enabled: false, lead: 30, locale: "en", chatIds: [] },
        transcription: { enabled: false, baseUrl: "https://api.openai.com/v1", model: "whisper-1", apiKey: unset },
      },
    } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => { errors.push(e.message); console.error(e.message); });
  const panel = page.locator("#voice");
  const choose = async id => {
    if (page.viewportSize().width >= 960) await page.getByRole("navigation", { name: "Settings category" }).locator(`a[href="#${id}"]`).click();
    else await page.getByRole("combobox", { name: "Settings category" }).selectOption(id);
    await page.locator(`#${id}`).waitFor();
  };
  const check = () => panel.getByRole("button", { name: "Check microphone", exact: true }).click();
  await page.goto("/dashboard/settings#voice");
  await panel.getByText("Ask when needed", { exact: true }).waitFor({ timeout: 15_000 }).catch(async error => {
    console.error(await page.locator('body').innerText()); throw error;
  });
  await panel.getByText("Local Whisper installation found on the Robin host", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.mic.calls), 0, "Browsing settings never opens the mic");
  await check();
  await panel.getByRole("status").filter({ hasText: "Microphone access succeeded" }).waitFor();
  assert.deepEqual(await page.evaluate(() => [window.mic.calls, window.mic.stopped]), [1, 1]);
  await page.evaluate(() => { window.permissionStatus.state = "granted"; window.permissionStatus.dispatchEvent(new Event("change")); });
  await panel.getByText("Allowed by this browser", { exact: true }).waitFor();
  await page.evaluate(() => { window.permissionStatus.state = "denied"; window.permissionStatus.dispatchEvent(new Event("change")); window.mic.error = "NotAllowedError"; });
  await panel.getByText("Blocked · change the browser’s site permissions", { exact: true }).waitFor();
  await check();
  await panel.getByRole("alert").filter({ hasText: "Access was refused" }).waitFor();
  for (const [error, text] of [["NotFoundError", "No microphone was found"], ["NotReadableError", "Could not access the microphone"]]) {
    await page.evaluate(value => { window.mic.error = value; }, error);
    await check(); await panel.getByRole("alert").filter({ hasText: text }).waitFor();
  }
  // Unsupported Permissions API is not a permission denial, and the check still works.
  await choose("general");
  await page.evaluate(() => { window.mic.unknown = true; window.mic.error = null; });
  await choose("voice");
  await panel.getByText("Browser cannot report permission · use Check microphone", { exact: true }).waitFor();
  await check(); await panel.getByRole("status").filter({ hasText: "Microphone access succeeded" }).waitFor();

  // A late Allow after category navigation releases the stream without updating a new panel.
  const before = await page.evaluate(() => window.mic.stopped);
  await page.evaluate(() => { window.mic.defer = true; });
  await check();
  await panel.getByRole("button", { name: "Waiting for browser permission…" }).waitFor();
  await choose("general");
  await page.evaluate(() => window.resolveMicrophone());
  await page.waitForFunction(count => window.mic.stopped === count + 1, before);
  await choose("voice");
  assert.equal(await panel.getByRole("status").count(), 0, "No stale success receipt after returning");

  // Configuration checks are read-only and independent from mic access.
  const calls = await page.evaluate(() => window.mic.calls);
  failed = true;
  await panel.getByRole("button", { name: "Check configuration", exact: true }).click();
  await panel.getByText(/Could not check voice configuration/).first().waitFor();
  failed = false; configured = false;
  await panel.getByRole("button", { name: "Check configuration", exact: true }).click();
  await panel.getByText(/Local dictation is not ready/).waitFor();
  configured = true;
  await panel.getByRole("button", { name: "Check configuration", exact: true }).click();
  await panel.getByText("Local Whisper installation found on the Robin host", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.mic.calls), calls);
  await choose("general");
  await page.evaluate(() => Object.defineProperty(window, "isSecureContext", { configurable: true, value: false }));
  await choose("voice");
  await panel.getByText(/HTTPS required/).waitFor();
  assert.equal(await panel.getByRole("button", { name: "Check microphone", exact: true }).isDisabled(), true);
  await page.reload(); await panel.waitFor();
  assert.equal(await page.evaluate(() => window.mic.calls), 0);

  await mkdir("outputs/robin-voice", { recursive: true });
  for (const theme of ["glass", "glass-dark"]) {
    await page.evaluate(value => { localStorage.setItem("pi-theme", value); }, theme);
    await page.reload(); await panel.waitFor();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "Panel does not overflow");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const button = await panel.getByRole("button", { name: "Check microphone", exact: true }).boundingBox();
      assert.ok(button.height >= 44 && button.width >= 44, "Touch targets stay usable");
      await page.screenshot({ path: `outputs/robin-voice/settings-${theme}-${width}.png` });
    }
  }
  await page.evaluate(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", "glass"); });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.reload();
  await panel.getByRole("heading", { name: "语音与麦克风", exact: true }).waitFor();
  await page.screenshot({ path: "outputs/robin-voice/settings-zh.png" });
  assert.equal(writes, 0, "No settings writes, audio uploads or agent dispatches");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, reads, writes, note: "Mocked permissions and microphone; not physical iOS validation" }));
} finally { await browser.close(); }
