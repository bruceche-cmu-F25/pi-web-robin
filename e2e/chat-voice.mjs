// Real composer + MediaRecorder/Web Audio, synthetic mic, mocked APIs. No paid calls or saved sessions.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/chat-voice.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { validateVoiceWav } from "../extension/robin/voice-domain.ts";
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, permissions: ["microphone"], serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => {
    localStorage.setItem("pi-locale", "en");
    window.__voiceStreams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { const s = await original(...args); window.__voiceStreams.push(s); return s; };
  });
  const cwd = "/tmp/voice-fixture", id = "voice-chat-fixture", timestamp = new Date().toISOString();
  const info = { id, cwd, projectKey: cwd, projectRoot: cwd, path: `${cwd}/session.jsonl`, name: "Voice fixture", created: timestamp, modified: timestamp, messageCount: 1, firstMessage: "Earlier question" };
  let asr = 0, tts = 0, prompts = 0, hold = false, release;
  await context.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (path === "/api/robin/voice") {
      if (req.method() === "GET") return route.fulfill({ json: { configured: true, ttsConfigured: false, asrModel: "whisper.cpp (local)", ttsModel: "qwen3-tts-flash" } });
      if (url.searchParams.get("op") !== "transcribe") { tts++; return route.fulfill({ status: 500, json: {} }); }
      asr++; validateVoiceWav(req.postDataBuffer());
      if (hold) await new Promise(resolve => { release = resolve; });
      return route.fulfill({ json: { text: "明天下午三点，不是今天。" } }).catch(() => {});
    }
    if (path.startsWith("/api/agent/") && req.method() === "POST" && req.postDataJSON()?.type === "prompt") prompts++;
    if (path === "/api/cwd/validate") return route.fulfill({ json: { cwd: req.postDataJSON().cwd } });
    if (path === "/api/sessions") return route.fulfill({ json: { sessions: [info], runningSessionIds: [], sessionListVersion: 1 } });
    if (path === `/api/sessions/${id}`) return route.fulfill({ json: { info, sessionId: id, leafId: "u", tree: [],
      context: { messages: [{ role: "user", content: "Earlier question" }], entryIds: ["u"], oldestEntryId: "u", hasMore: false, thinkingLevel: "off" }, toolNames: [], totalActiveMs: 0 } });
    if (path === "/api/sessions/ui-state") return route.fulfill({ json: { version: 1, revision: 0, sessions: {}, projects: {} } });
    if (path === "/api/agent/running") return route.fulfill({ json: { runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 } });
    if (path === "/api/models") return route.fulfill({ json: { models: [], modelList: [] } });
    if (path === "/api/worktrees") return route.fulfill({ json: { worktrees: [], projectRoot: cwd, projectKey: cwd, currentWorktreePath: cwd } });
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const shell = page.locator(".chat-input-shell"), input = shell.locator("textarea");
  const mic = shell.getByRole("button", { name: "Voice", exact: true });
  const allTracksStopped = () => page.waitForFunction(() => window.__voiceStreams.every(s => s.getTracks().every(t => t.readyState === "ended")));
  const start = async () => {
    if (await mic.getAttribute("aria-expanded") !== "true") await mic.click();
    await shell.getByRole("button", { name: "Dictate", exact: true }).click();
    await shell.getByRole("button", { name: "Done speaking", exact: true }).waitFor();
  };
  const finish = async () => { await page.waitForTimeout(750); await shell.getByRole("button", { name: "Done speaking", exact: true }).click(); };
  await page.goto(`/?cwd=${encodeURIComponent(cwd)}`);
  await input.fill("Prefix replace suffix");
  // An attached image must survive recognition; no attachment write reaches the server.
  await input.evaluate(el => {
    const data = new DataTransfer();
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII="), c => c.charCodeAt(0));
    data.items.add(new File([bytes], "pixel.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: data }));
  });
  await shell.locator('img[src^="blob:"]').waitFor();
  await input.evaluate(el => { el.focus(); el.setSelectionRange(7, 14); });
  await start(); await finish();
  await page.waitForFunction(() => document.querySelector(".chat-input-textarea")?.value === "Prefix 明天下午三点，不是今天。 suffix");
  assert.equal(await shell.locator('img[src^="blob:"]').count(), 1);
  assert.equal(asr, 1); assert.equal(prompts + tts, 0);
  await allTracksStopped();
  assert.equal(await shell.getByRole("button", { name: "Voice conversation", exact: true }).count(), 0);
  assert.equal(await shell.getByText(/search field|search text/).count(), 0, "composer uses draft copy, not search instructions");
  // Recognition uses the current draft/selection, not a recording-start snapshot.
  hold = true; await start(); await finish();
  await page.waitForFunction(() => document.querySelector('[data-voice-phase="transcribing"]'));
  while (!release) await page.waitForTimeout(10);
  await input.fill("Edited while transcribing. ");
  hold = false; release(); release = null;
  await page.waitForFunction(() => document.querySelector(".chat-input-textarea")?.value === "Edited while transcribing. 明天下午三点，不是今天。");
  // IME composition discards a late recognition rather than corrupting composed text.
  hold = true; await start(); await finish(); while (!release) await page.waitForTimeout(10);
  await input.dispatchEvent("compositionstart", { data: "拼" });
  hold = false; release(); release = null; await page.waitForTimeout(150);
  assert.equal(await input.inputValue(), "Edited while transcribing. 明天下午三点，不是今天。");
  await input.dispatchEvent("compositionend", { data: "拼" });
  // New changes the draft identity: old in-flight audio may not populate the new composer.
  hold = true; await start(); await finish(); while (!release) await page.waitForTimeout(10);
  await page.keyboard.press("Control+Alt+n");
  hold = false; release(); release = null; await page.waitForTimeout(150);
  assert.equal(await input.inputValue(), ""); await allTracksStopped();
  // The existing-session composer gets the same entry, not just the fresh hero composer.
  await page.goto(`/?session=${id}`); await input.waitFor(); await input.fill("Saved session draft. ");
  await start(); await finish();
  await page.waitForFunction(() => document.querySelector(".chat-input-textarea")?.value.includes("不是今天"));
  await page.reload(); await input.waitFor();
  assert.equal(await input.inputValue(), "Saved session draft. 明天下午三点，不是今天。", "dictated text follows the existing persisted draft path");
  mkdirSync("outputs/robin-voice", { recursive: true });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    // The keyboard hides the model toolbar, not the microphone next to the textarea.
    await page.evaluate(() => document.documentElement.setAttribute("data-keyboard-open", "true"));
    await mic.waitFor({ state: "visible" }); const box = await mic.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
    assert.ok(await shell.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await start(); assert.equal(await mic.getAttribute("data-recording"), "true");
    await shell.getByRole("button", { name: "End voice", exact: true }).click(); await allTracksStopped();
    assert.ok(await shell.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await shell.screenshot({ path: `outputs/robin-voice/chat-${width}.png` });
    await page.evaluate(() => document.documentElement.removeAttribute("data-keyboard-open"));
  }
  assert.equal(prompts + tts, 0); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, asr, prompts, tts, note: "synthetic microphone; mocked ASR; new and existing agent composers" }));
} finally { await browser.close(); }
