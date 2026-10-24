// Existing dev server, mocked APIs and synthetic microphone: no personal data or paid calls.
// node --env-file-if-exists=.env.local e2e/recordings.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fullstackPlan, practicePlan } from "../extension/robin/learning.ts";
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1100 }, reducedMotion: "no-preference", serviceWorkers: "block", permissions: ["microphone", "clipboard-read", "clipboard-write"] });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => {
    if (!localStorage.getItem("pi-locale")) localStorage.setItem("pi-locale", "en");
    window.__streams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await original(...args); window.__streams.push(stream); return stream; };
  });
  let record = { id: "aa9189cc-03a4-4881-9d98-ce6e5690cc7d", title: "Meeting", createdAt: "2030-01-01T00:00:00Z", revision: 1, fileName: "source.wav", bytes: 16044, seconds: 601, chunks: 2, parts: [], text: "" };
  let records = [record], calls = 0, fail = true, uploads = 0;
  let releaseChunk;
  let holdChunk = false;
  let config = { engine: "local", model: "small", ready: false, reason: "missing-model" };
  await context.route("**/api/**", async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (path === "/api/robin/recordings") {
      if (req.method() === "POST") { uploads++; return route.fulfill({ json: { recording: record } }); }
      return route.fulfill({ json: { recordings: records, config } });
    }
    if (path === "/api/robin/settings" && req.method() !== "GET") throw new Error("Recordings must not change cloud credentials/settings");
    if (path.startsWith("/api/robin/recordings/")) {
      if (url.searchParams.has("audio")) return route.fulfill({ status: 204 });
      if (req.method() === "POST") {
        calls++;
        if (holdChunk) await new Promise((resolve) => { releaseChunk = resolve; });
        if (record.parts.length === 1 && fail) { fail = false; return route.fulfill({ status: 502, json: { error: "Local process temporarily unavailable" } }); }
        const parts = [...record.parts, `Segment ${record.parts.length + 1}`];
        record = { ...record, parts, text: parts.join("\n\n"), revision: record.revision + 1 }; records = [record];
      }
      if (req.method() === "PATCH") { record = { ...record, ...req.postDataJSON(), revision: record.revision + 1 }; records = [record]; }
      if (req.method() === "DELETE") { records = []; return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { recording: record } });
    }
    if (path === "/api/robin/learning") return route.fulfill({ json: { practice: practicePlan([], "neetcode150", "2030-01-01"), fullstack: fullstackPlan([]) } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard");
  const tools = page.getByRole("navigation", { name: "Tools", exact: true });
  await tools.getByRole("link", { name: "Local toolbox", exact: true }).waitFor();
  assert.equal(await tools.getByRole("link").count(), 1, "all utilities share the toolbox entry");
  assert.equal(await page.locator('.robin-nav-main a[href^="/recordings"]').count(), 0, "utilities do not get a global tab");
  assert.equal(await page.locator('.robin-dashboard-shortcuts a').count(), 4, "the original shortcuts stay unchanged");
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    const entry = tools.getByRole("link", { name: "Local toolbox", exact: true });
    await entry.scrollIntoViewIfNeeded();
    assert.ok((await entry.boundingBox()).height >= 44);
    assert.ok(await tools.evaluate((el) => {
      const links = document.getElementById("dashboard-links");
      return el.nextElementSibling === links && links.getBoundingClientRect().top >= el.getBoundingClientRect().bottom;
    }), `Tools sits directly above Links at ${width}px`);
    assert.ok(await page.locator('.robin-dashboard').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/dashboard-tools-${width}.png` });
  }
  await tools.getByRole("link", { name: "Local toolbox", exact: true }).click();
  await page.getByRole("heading", { name: "Local toolbox", exact: true }).waitFor();
  await page.getByRole("navigation", { name: "Choose a tool" }).getByRole("link", { name: "Speech to text", exact: true }).click();
  await page.getByRole("heading", { name: "Recordings", exact: true }).waitFor();
  assert.equal(await page.locator('.robin-nav-main a[aria-current="page"]').getAttribute("href"), "/dashboard");
  await page.getByRole("link", { name: /Back to toolbox/ }).click();
  await page.getByRole("navigation", { name: "Choose a tool" }).getByRole("link", { name: "Speech to text", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Recordings", exact: true }).waitFor();

  // Missing setup is explained next to the disabled action, not mislabeled as partial success.
  const transcribeButton = page.getByRole("button", { name: /^transcribe \/ resume$/i });
  await page.getByText(/Audio saved — no transcript yet/).waitFor();
  assert.equal(await transcribeButton.isDisabled(), true);
  assert.equal(await page.getByText(/Partial transcript/).count(), 0);
  await page.locator('#recording-setup-needed').waitFor();
  assert.equal(calls, 0);
  assert.equal(await page.locator('input[type="password"]').count(), 0, "local mode has no API key form");
  await page.getByRole("button", { name: "View local setup", exact: true }).click();
  assert.equal(await page.locator('#recording-local-setup').evaluate((el) => el === document.activeElement), true);
  assert.equal(await transcribeButton.isDisabled(), true, "viewing setup cannot pretend the model exists");
  config = { engine: "local", model: "small", ready: true };
  await page.getByRole("button", { name: "Check local setup", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Transcribe / resume"]')?.disabled);
  assert.equal(calls, 0, "checking local setup never starts transcription");
  assert.equal(await page.locator('#recording-setup-needed').count(), 0);
  assert.equal(await page.locator('#recording-local-setup').evaluate((el) => el.open), false, "ready setup is compact, not a wall of instructions");

  // Slow local inference: honest progress, adjacent feedback, reduced motion, safe stop.
  const editor = page.getByRole("region", { name: "Transcript", exact: true });
  const progress = editor.getByRole("progressbar");
  await page.evaluate(() => { window.__savedPlayer = document.querySelector('audio[preload="metadata"]'); });
  holdChunk = true;
  await transcribeButton.click();
  await editor.getByRole("status").filter({ hasText: "Transcribing segment 1 of 2" }).waitFor();
  assert.equal(await progress.getAttribute("aria-valuenow"), "0", "waiting is not invented progress");
  const status = editor.getByRole("status");
  assert.notEqual(await status.evaluate((el) => getComputedStyle(el, '::before').animationName), "none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await status.evaluate((el) => getComputedStyle(el, '::before').animationName), "none");
  assert.equal(await progress.locator('span').evaluate((el) => getComputedStyle(el).transitionDuration), "0s");
  if (process.env.E2E_SCREENSHOT_DIR) await editor.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/recordings-processing.png` });
  await page.getByRole("button", { name: "Stop after this segment", exact: true }).click();
  await editor.getByRole("status").filter({ hasText: "Stopping after the current segment" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Stopping after the current segment…", exact: true }).isDisabled(), true);
  await page.waitForFunction(() => document.querySelector('button[aria-label="Transcribe / resume"]')?.disabled);
  assert.equal(typeof releaseChunk, "function");
  holdChunk = false; releaseChunk();
  await editor.getByRole("status").filter({ hasText: "Stopped. Completed segments are saved" }).waitFor();
  assert.equal(calls, 1, "stop finishes this segment but never starts the next");
  assert.equal(await progress.getAttribute("aria-valuenow"), "1");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await transcribeButton.click();
  await editor.getByRole("alert").filter({ hasText: "Local process temporarily unavailable" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Transcript", exact: true }).inputValue(), "Segment 1");
  await page.getByRole("button", { name: /^transcribe \/ resume$/i }).click();
  await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("Segment 2"));
  assert.equal(calls, 3, "resume only retries the failed segment");
  await editor.getByRole("status").filter({ hasText: "Transcription complete" }).waitFor();
  assert.equal(await progress.getAttribute("aria-valuenow"), "2");
  assert.equal(await page.evaluate(() => window.__savedPlayer === document.querySelector('audio[preload="metadata"]')), true, "progress never remounts the audio player");
  await page.getByRole("textbox", { name: "Transcript", exact: true }).fill("Edited transcript 中文");
  await page.getByText("Unsaved changes", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved" }).waitFor();
  assert.equal(record.text, "Edited transcript 中文");
  await page.getByRole("button", { name: "Copy text", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Copied" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), record.text);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download TXT", exact: true }).click();
  assert.equal((await download).suggestedFilename(), "Meeting.txt");

  // Mobile selection focuses the transcript; cancelling unsaved edits keeps the current record.
  records = [record, { ...record, id: "bb9189cc-03a4-4881-9d98-ce6e5690cc7d", title: "Other recording", text: "Another transcript" }];
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const otherEntry = page.getByRole("button", { name: /Other recording/ });
  await otherEntry.waitFor();
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole("textbox", { name: "Transcript", exact: true }).fill("Unsaved draft");
  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => dialog.dismiss());
  await otherEntry.click();
  assert.equal(await page.getByRole("textbox", { name: "Transcript", exact: true }).inputValue(), "Unsaved draft");
  assert.equal(await otherEntry.getAttribute("aria-pressed"), "false");
  page.on("dialog", (dialog) => dialog.accept());
  await otherEntry.focus(); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.id === "record-transcript");
  assert.equal(await page.getByRole("textbox", { name: "Transcript", exact: true }).inputValue(), "Another transcript");
  await page.getByRole("button", { name: /^Meeting/ }).click();
  await page.waitForFunction(() => document.activeElement?.id === "record-transcript");
  assert.equal(await page.getByRole("textbox", { name: "Transcript", exact: true }).inputValue(), record.text);
  await page.setViewportSize({ width: 1440, height: 1100 });
  records = [record];
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await otherEntry.waitFor({ state: "detached" });

  // Real browser MediaRecorder with synthetic microphone; draft survives reload, tracks stop.
  await page.getByRole("button", { name: /^start recording$/i }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  await page.waitForTimeout(5500);
  assert.notEqual(await page.locator('[data-phase="recording"] > [aria-hidden="true"]').evaluate((el) => getComputedStyle(el).animationName), "none");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  assert.equal(await page.locator('[data-phase="paused"] > [aria-hidden="true"]').evaluate((el) => getComputedStyle(el).animationName), "none", "pause stops the live pulse");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  assert.equal(await page.locator('[data-phase="recording"] > [aria-hidden="true"]').evaluate((el) => getComputedStyle(el).animationName), "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await page.getByRole("button", { name: /^save audio$/i }).waitFor();
  assert.ok(await page.evaluate(() => window.__streams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended"))));
  const other = await context.newPage(); await other.goto("/recordings");
  await other.getByRole("alert").filter({ hasText: "Another recordings tab" }).waitFor();
  assert.equal(await other.getByRole("button", { name: /^start recording$/i }).isDisabled(), true);
  await other.close();
  await page.reload();
  await page.getByRole("button", { name: /^save audio$/i }).waitFor();
  await page.getByRole("button", { name: /^save audio$/i }).click();
  await page.getByRole("status").filter({ hasText: "Saved" }).waitFor();
  assert.equal(uploads, 1);
  await page.reload();
  await page.getByRole("button", { name: /^start recording$/i }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^save audio$/i }).count(), 0);

  // Denied permission never blocks the upload alternative.
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Denied", "NotAllowedError"); }; });
  await page.getByRole("button", { name: /^start recording$/i }).click();
  await page.getByRole("alert").filter({ hasText: "Could not start the microphone" }).waitFor();
  await page.locator('input[type="file"]').setInputFiles({ name: "wrong.txt", mimeType: "text/plain", buffer: Buffer.from("not audio") });
  await page.getByRole("region", { name: "New recording", exact: true }).getByRole("alert").filter({ hasText: "Choose a supported audio file" }).waitFor();
  await page.locator('input[type="file"]').setInputFiles({ name: "uploaded.wav", mimeType: "audio/wav", buffer: Buffer.from("synthetic upload, API mocked") });
  await page.getByRole("button", { name: /^save audio$/i }).click();
  await page.getByRole("status").filter({ hasText: "Saved" }).waitFor();
  assert.equal(uploads, 2);

  // Responsive Chinese and both themes, no horizontal clipping.
  await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.reload();
  await page.getByRole("heading", { name: "录音转写", exact: true }).waitFor();
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(150);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width} overflow`);
      if (process.env.E2E_SCREENSHOT_DIR && width === 375) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/recordings-${theme}-mobile.png` });
    }
  }
  if (process.env.E2E_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/recordings.png`, fullPage: true });
  await page.getByRole("button", { name: "删除录音", exact: true }).click();
  await page.getByText("还没有录音。在上方开始录音或选择音频文件。").waitFor();
  assert.equal(records.length, 0);
  await page.getByRole("link", { name: /返回工具箱/ }).click();
  await page.getByRole("link", { name: "语音转文字", exact: true }).waitFor();
  await page.getByRole("link", { name: /返回仪表盘工具/ }).click();
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.getByRole("navigation", { name: "工具", exact: true }).getByRole("link", { name: "本地工具箱", exact: true }).waitFor();
  assert.equal(await page.locator('.robin-nav-main a[href^="/recordings"]').count(), 0);
  assert.deepEqual(errors, []);
  console.log("Recordings: honest progress, inline feedback, safe stop, unsaved edits, keyboard/mobile focus, reduced motion, resumable transcription, editing/export, synthetic microphone, draft recovery and themes passed.");
} finally { await browser.close(); }
