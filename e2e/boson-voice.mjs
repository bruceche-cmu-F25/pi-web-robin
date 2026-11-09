// All credentials/audio/API writes are fixtures; no Boson credits or real settings are used.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/boson-voice.mjs
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
    localStorage.setItem("pi-locale", "en");
    localStorage.setItem("pi-theme", "glass");
    window.micCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.micCalls++; throw new Error("No capture expected"); };
  });
  const unset = { set: false };
  let savedKey = "", saveFails = false, speechFails = false, saveGate = null, speechGate = null;
  let writes = 0, speaks = 0, agentCalls = 0;
  const settings = () => ({
    boson: savedKey ? { set: true, source: "file" } : unset,
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
  });
  // Half a second of silent WAV: enough to exercise native audio without loud fixtures.
  const wav = Buffer.alloc(44 + 16_000);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(16_000, 40);
  await context.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === "/api/robin/settings") {
      if (req.method() === "POST") {
        writes++;
        assert.equal(req.postDataJSON().section, "boson");
        if (saveGate) await saveGate;
        if (saveFails) return route.fulfill({ status: 400, json: { error: "Fixture save failed" } });
        savedKey = req.postDataJSON().apiKey;
      } else if (req.method() === "DELETE") { writes++; savedKey = ""; }
      return route.fulfill({ json: settings() });
    }
    if (url.pathname === "/api/robin/voice") {
      if (req.method() === "GET") return route.fulfill({ json: {
        configured: true, ttsConfigured: !!savedKey, asrModel: "local", ttsModel: savedKey ? "higgs-tts-3" : "qwen3-tts-flash",
      } });
      assert.equal(url.searchParams.get("op"), "speak"); speaks++;
      assert.deepEqual(Object.keys(req.postDataJSON()), ["text"]);
      assert.ok(!req.postData().includes("bai-"));
      if (speechGate) await speechGate;
      return speechFails ? route.fulfill({ status: 502, json: { code: "provider" } })
        : route.fulfill({ contentType: "audio/wav", body: wav });
    }
    if (url.pathname.includes("/assistant") && req.method() === "POST") agentCalls++;
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const panel = page.locator("#voice");
  const key = () => panel.getByLabel("Boson API Key", { exact: true });
  const save = () => panel.getByRole("button", { name: "Save Boson key", exact: true });
  const preview = () => panel.getByRole("button", { name: "Preview Boson voice", exact: true });
  const choose = async category => {
    await page.getByRole("navigation", { name: "Settings category" }).locator(`a[href="#${category}"]`).click();
    await page.locator(`#${category}`).waitFor();
  };
  await page.goto("/dashboard/settings#voice");
  await key().waitFor();
  assert.equal(await key().getAttribute("type"), "password");
  assert.equal(await preview().isDisabled(), true);
  assert.equal(speaks + writes, 0);
  await key().fill("bai-first-fixture");
  await choose("general"); await choose("voice");
  assert.equal(await key().inputValue(), "bai-first-fixture", "Category changes retain the secret draft in memory");
  saveFails = true;
  await save().click();
  await panel.getByRole("alert").filter({ hasText: "Fixture save failed" }).waitFor();
  assert.equal(await key().inputValue(), "bai-first-fixture", "Failed saves preserve the key");
  saveFails = false;
  let releaseSave;
  saveGate = new Promise(resolve => { releaseSave = resolve; });
  await save().click();
  await panel.getByRole("button", { name: "Saving…", exact: true }).waitFor();
  await key().fill("bai-newer-draft");
  releaseSave(); saveGate = null;
  await panel.getByText(/Saved on the Robin host/).waitFor();
  assert.equal(await key().inputValue(), "bai-newer-draft", "An in-flight edit is not erased by an older receipt");
  assert.equal(await preview().isDisabled(), true, "Preview requires saved settings, not an unsubmitted key");
  await save().waitFor(); await save().click();
  await page.waitForFunction(() => document.querySelector('#voice input[type="password"]')?.value === "");
  await panel.getByText("higgs-tts-3", { exact: false }).waitFor();
  assert.equal(speaks, 0, "Saving never spends credit automatically");
  assert.ok(!JSON.stringify(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).includes("bai-"));
  await preview().click();
  await panel.locator("audio").waitFor();
  assert.equal(speaks, 1);
  await panel.getByRole("button", { name: "Stop playback", exact: true }).click();
  assert.equal(await panel.locator("audio").isHidden(), true);
  speechFails = true;
  await preview().click();
  await panel.getByRole("alert").filter({ hasText: "Speech service failed" }).waitFor();
  assert.equal(speaks, 2, "Provider failure is not retried");
  speechFails = false;
  let releaseSpeech;
  speechGate = new Promise(resolve => { releaseSpeech = resolve; });
  await preview().click();
  await panel.getByRole("button", { name: "Generating preview…", exact: true }).waitFor();
  await choose("general"); releaseSpeech(); speechGate = null;
  await choose("voice");
  assert.equal(await panel.locator("audio").isHidden(), true, "Leaving the category discards late audio");
  assert.equal(await key().inputValue(), "", "Only presence is restored, never the stored key");
  await panel.getByRole("button", { name: "Remove saved Boson key", exact: true }).click();
  await panel.getByText(/No Boson key configured/).waitFor();
  assert.equal(await preview().isDisabled(), true);
  assert.equal(await page.evaluate(() => window.micCalls), 0);
  assert.equal(agentCalls, 0);
  await mkdir("outputs/robin-voice", { recursive: true });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const bounds = await key().boundingBox(); assert.ok(bounds.height >= 44);
    await key().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `outputs/robin-voice/boson-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, writes, speaks, agentCalls, note: "Mocked API/credentials/audio; no paid call" }));
} finally { await browser.close(); }
