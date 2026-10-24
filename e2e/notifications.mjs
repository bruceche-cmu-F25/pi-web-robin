// Deterministic settings UI test: no real preference changes or push sends.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
  const data = {
    notifications: { channel: "telegram" },
    google: { clientId: { set: false }, clientSecret: { set: false }, calendars: [] },
    notion: { apiToken: { set: false } }, playwright: { extensionToken: { set: false } },
    storedAt: "test fixture", googleRedirectUri: `${baseURL}/api/robin/google/callback`,
    telegram: { botToken: { set: false }, allowedChatIds: [],
      dailyAgenda: { enabled: true, time: "08:00", locale: "zh" },
      jobDigest: { enabled: false, morning: "08:00", evening: "20:00", count: 10, locale: "zh", chatIds: [], sweepAt: "03:00" },
      gmailDigest: { enabled: false, time: "08:00", locale: "zh", chatIds: [], query: "newer_than:1d" },
      reminders: { enabled: true, lead: 30, locale: "zh", chatIds: [] },
      transcription: { enabled: false, baseUrl: "https://api.openai.com/v1", model: "whisper-1", apiKey: { set: false } },
    },
  };
  const writes = [], tests = [];
  let testFails = false;
  await context.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === "/api/robin/settings") {
      if (req.method() === "POST") {
        const body = req.postDataJSON(); writes.push(body);
        assert.equal(body.section, "notifications");
        data.notifications.channel = body.channel;
      }
      return route.fulfill({ json: data });
    }
    if (path === "/api/push/send") {
      tests.push(req.postDataJSON());
      return route.fulfill({ status: testFails ? 503 : 200, json: { accepted: testFails ? 0 : 1 } });
    }
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard/settings#notifications");
  const panel = page.locator("#notifications");
  await panel.getByRole("heading", { name: "定时通知", exact: true }).waitFor();
  const channel = panel.getByRole("combobox", { name: /通知渠道/ });
  assert.equal(await channel.inputValue(), "telegram");
  await channel.selectOption("push");
  await panel.getByRole("button").filter({ hasText: /^保存$/ }).click();
  await panel.getByRole("button").filter({ hasText: /^已保存$/ }).waitFor();
  assert.deepEqual(writes, [{ section: "notifications", channel: "push" }]);
  assert.equal(data.telegram.jobDigest.enabled, false, "channel selection must not enable a schedule");
  assert.equal(await panel.locator('label[hidden]').count(), 3);
  for (const label of await panel.locator('label[hidden]').all()) assert.equal(await label.isVisible(), false);
  await panel.getByRole("button", { name: "发送测试通知", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "推送服务已接受" }).waitFor();
  assert.equal(tests.length, 1);
  assert.equal(tests[0].url, "/dashboard");
  assert.equal(tests[0].ttl, 60);
  testFails = true;
  await panel.getByRole("button", { name: "发送测试通知", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "没有设备接受" }).waitFor();
  const bounds = await panel.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, "notification settings fit the phone viewport");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "/tmp/robin-notifications-mobile.png" });
  console.log("Phone notification settings: save, independent category switches, test success/failure, and no overflow passed.");
} finally { await browser.close(); }
