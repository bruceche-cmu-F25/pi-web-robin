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
    window.addEventListener('pagehide', () => sessionStorage.setItem('__voiceTrackStates', JSON.stringify(window.__voiceStreams.flatMap(s => s.getTracks().map(t => t.readyState)))));
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { const s = await original(...args); window.__voiceStreams.push(s); return s; };
  });
  const cwd = "/tmp/voice-fixture", id = "voice-chat-fixture", timestamp = new Date().toISOString();
  const info = { id, cwd, projectKey: cwd, projectRoot: cwd, path: `${cwd}/session.jsonl`, name: "Voice fixture", created: timestamp, modified: timestamp, messageCount: 1, firstMessage: "Earlier question" };
  let asr = 0, tts = 0, prompts = 0, hold = false, failAsr = false, release, pageFileReads = 0;
  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>External fixture</h1>' }));
  await context.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (path.startsWith('/api/files/dashboard') || path.startsWith('/api/files/learn')) pageFileReads++;
    if (path === '/api/robin/settings') return route.fulfill({ status: 503, json: { error: 'Fixture: credentials unavailable' } });
    if (path === "/api/robin/voice") {
      if (req.method() === "GET") return route.fulfill({ json: { configured: true, ttsConfigured: false, asrModel: "whisper.cpp (local)", ttsModel: "qwen3-tts-flash" } });
      if (url.searchParams.get("op") !== "transcribe") { tts++; return route.fulfill({ status: 500, json: {} }); }
      asr++; validateVoiceWav(req.postDataBuffer());
      if (failAsr) return route.fulfill({ status: 502, json: { code: 'local' } });
      if (hold) await new Promise(resolve => { release = resolve; });
      return route.fulfill({ json: { text: "明天下午三点，不是今天。" } }).catch(() => {});
    }
    if (path.startsWith("/api/agent/") && req.method() === "POST" && req.postDataJSON()?.type === "prompt") prompts++;
    if (path === "/api/cwd/validate") return route.fulfill({ json: { cwd: req.postDataJSON().cwd } });
    if (path === "/api/sessions") return route.fulfill({ json: { sessions: [info], runningSessionIds: [], sessionListVersion: 1 } });
    if (path === `/api/sessions/${id}`) return route.fulfill({ json: { info, sessionId: id, leafId: "u", tree: [],
      context: { messages: [{ role: "user", content: `Earlier question\n\n[Site settings](/dashboard/settings#voice) · [Absolute settings](${baseURL}/dashboard/settings#voice) · [Protocol-relative settings](//${new URL(baseURL).host}/dashboard/settings#voice) · [External fixture](https://example.com/voice-links) · [Source file](docs/fixture.md)` }], entryIds: ["u"], oldestEntryId: "u", hasMore: false, thinkingLevel: "off" }, toolNames: [], totalActiveMs: 0 } });
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
  const mic = shell.locator('.chat-input-surface').getByRole("button", { name: /^(Dictate|Done speaking)$/ });
  const panel = page.locator('[data-voice-panel]');
  const allTracksStopped = () => page.waitForFunction(() => window.__voiceStreams.every(s => s.getTracks().every(t => t.readyState === "ended")));
  const start = async () => {
    if (await panel.isVisible()) await panel.getByRole('button', { name: /^(Close voice|Cancel recording)$/ }).click();
    await mic.click();
    await panel.getByRole("button", { name: "Done speaking", exact: true }).waitFor();
  };
  const finish = async () => { await page.waitForTimeout(750); await panel.getByRole("button", { name: "Done speaking", exact: true }).click(); };
  await page.goto(`/?cwd=${encodeURIComponent(cwd)}`);
  const voiceStart = shell.locator('[data-companion-launcher]');
  await voiceStart.waitFor();
  mkdirSync('outputs/robin-voice', { recursive: true });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const surface = await shell.locator('.chat-input-surface').boundingBox(), launch = await voiceStart.boundingBox();
    assert.ok(launch.width >= 44 && launch.height >= 44, 'voice has a full touch target');
    assert.ok(launch.x >= surface.x && launch.x + launch.width <= surface.x + surface.width + 1, 'voice belongs inside the composer');
    assert.equal(await page.locator('[data-robin-companion]').getByRole('button').count(), 0, 'no floating launcher');
    await page.screenshot({ path: `outputs/robin-voice/voice-entry-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await input.fill("Prefix replace suffix");
  assert.equal(await voiceStart.count(), 0, 'a draft restores Send instead of competing with voice');
  // An attached image must survive recognition; no attachment write reaches the server.
  await input.evaluate(el => {
    const data = new DataTransfer();
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII="), c => c.charCodeAt(0));
    data.items.add(new File([bytes], "pixel.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: data }));
  });
  await shell.locator('img[src^="blob:"]').waitFor();
  await input.evaluate(el => { el.focus(); el.setSelectionRange(7, 14); });
  await start();
  assert.equal(await input.evaluate(el => el === document.activeElement), true, 'Recording does not blur the composer');
  assert.equal(await shell.locator('[data-voice-inline]').count(), 1, 'Capture lives beside the composer, not in a floating dialog');
  assert.equal(await page.locator('[data-voice-panel][popover]').count(), 0);
  assert.equal(await shell.locator('.chat-send-button').isEnabled(), false, 'Send waits for dictation');
  assert.equal(await page.getByRole('button', { name: 'Done speaking', exact: true }).count(), 1, 'One visible finish action after the tap');
  await input.press('Enter');
  assert.equal(await input.inputValue(), 'Prefix replace suffix');
  assert.equal(prompts, 0); assert.equal(asr, 0);
  assert.equal(await panel.getAttribute('data-voice-phase'), 'recording');
  await finish();
  await page.waitForFunction(() => document.querySelector(".chat-input-textarea")?.value === "Prefix 明天下午三点，不是今天。 suffix");
  assert.equal(await shell.locator('img[src^="blob:"]').count(), 1);
  assert.equal(asr, 1); assert.equal(prompts + tts, 0);
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await shell.getByRole('status').filter({ hasText: 'Transcribed and added to your draft' }).count(), 1);
  assert.equal(await shell.getByText(/Microphone off/).count(), 0, 'Success is not presented as a microphone failure');
  await allTracksStopped();
  assert.equal(await shell.locator('.chat-send-button').isEnabled(), true, 'Only an explicit Send can submit the returned draft');
  assert.equal(await shell.getByRole("button", { name: "Voice conversation", exact: true }).count(), 0);
  assert.equal(await shell.getByText(/search field|search text/).count(), 0, "composer uses draft copy, not search instructions");
  // Recognition uses the current draft/selection, not a recording-start snapshot.
  hold = true; await start(); await finish();
  await page.waitForFunction(() => document.querySelector('[data-voice-phase="transcribing"]'));
  while (!release) await page.waitForTimeout(10);
  assert.equal(await shell.locator('.chat-send-button').isEnabled(), false);
  const pendingDraft = await input.inputValue(); await input.press('Enter');
  assert.equal(await input.inputValue(), pendingDraft); assert.equal(prompts, 0);
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
  // Failures stay actionable in place; retry does not replace or send the draft.
  const beforeFailure = await input.inputValue();
  failAsr = true; await start(); await finish();
  await panel.getByRole('alert').filter({ hasText: 'Local Whisper could not transcribe' }).waitFor();
  assert.equal(await panel.getByRole('link', { name: 'Voice settings', exact: true }).getAttribute('href'), '/dashboard/settings#voice');
  assert.equal(await input.inputValue(), beforeFailure);
  failAsr = false;
  await panel.getByRole('button', { name: 'Dictate', exact: true }).click();
  await panel.getByRole('button', { name: 'Done speaking', exact: true }).waitFor();
  await finish(); await panel.waitFor({ state: 'hidden' }); await allTracksStopped();
  // Cancelling recognition must not repopulate or reopen the inline bar later.
  const beforeCancel = await input.inputValue();
  hold = true; await start(); await finish(); while (!release) await page.waitForTimeout(10);
  await panel.getByRole('button', { name: 'Cancel recording', exact: true }).click();
  await panel.waitFor({ state: 'hidden' });
  hold = false; release(); release = null; await page.waitForTimeout(150);
  assert.equal(await input.inputValue(), beforeCancel); assert.equal(await panel.count(), 0);
  mkdirSync("outputs/robin-voice", { recursive: true });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    // The keyboard hides the model toolbar, not the microphone next to the textarea.
    await page.evaluate(() => document.documentElement.setAttribute("data-keyboard-open", "true"));
    await mic.waitFor({ state: "visible" }); const box = await mic.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
    assert.ok(await shell.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await start();
    assert.equal(await shell.locator('.chat-input-surface button[data-recording="true"]').count(), 1, 'Original target stays mounted');
    assert.equal(await mic.isVisible(), false, 'The inline bar owns tap-to-finish');
    await page.waitForTimeout(700);
    assert.ok(await shell.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    const bar = await panel.boundingBox();
    assert.ok(bar.height <= 80 && bar.x >= 0 && bar.x + bar.width <= width, 'Compact recording bar fits the composer');
    await page.screenshot({ path: `outputs/robin-voice/chat-${width}.png` });
    await panel.getByRole("button", { name: "Cancel recording", exact: true }).click(); await allTracksStopped();
    await panel.waitFor({ state: 'hidden' });
    await page.evaluate(() => document.documentElement.removeAttribute("data-keyboard-open"));
  }
  // Keyboard activation moves focus into the inline controls, Escape returns it.
  await mic.focus(); await page.keyboard.press('Enter');
  await panel.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-voice-inline]')?.contains(document.activeElement));
  await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Dictate');
  await allTracksStopped();
  // A held original trigger stays visible until release; sliding up still cancels.
  const heldBox = await mic.boundingBox(), beforeHoldAsr = asr;
  await page.mouse.move(heldBox.x + heldBox.width / 2, heldBox.y + heldBox.height / 2);
  await page.mouse.down(); await page.waitForTimeout(400);
  assert.equal(await mic.isVisible(), true);
  await page.mouse.move(heldBox.x + heldBox.width / 2, heldBox.y - 90);
  await page.mouse.up(); await panel.waitFor({ state: 'hidden' }); await allTracksStopped();
  assert.equal(asr, beforeHoldAsr, 'Cancelled hold never transcribes');
  // Web links are not filesystem previews. Native modified clicks still open tabs.
  const savedDraft = await input.inputValue();
  const transcript = page.locator('.markdown-body');
  for (const label of ['Site settings', 'Absolute settings', 'Protocol-relative settings']) {
    const link = transcript.getByRole('link', { name: label, exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute('target'), null);
    await link.click(); await page.waitForURL('**/dashboard/settings#voice');
    assert.equal(context.pages().length, 1, `${label}: stays in this tab`);
    await page.goBack(); await input.waitFor();
    assert.equal(await input.inputValue(), savedDraft);
  }
  for (const [label, options] of [['External fixture', {}], ['Site settings', { button: 'middle' }], ['Site settings', { modifiers: ['ControlOrMeta'] }]]) {
    const popupEvent = context.waitForEvent('page');
    await transcript.getByRole('link', { name: label, exact: true }).click(options);
    const popup = await popupEvent;
    await popup.waitForURL(label === 'External fixture' ? 'https://example.com/voice-links' : '**/dashboard/settings#voice');
    assert.equal(await popup.evaluate(() => window.opener === null), true);
    await popup.close();
    assert.equal(await input.inputValue(), savedDraft);
  }
  assert.equal(await transcript.getByRole('link', { name: 'Source file', exact: true }).getAttribute('target'), null);
  // Escape closes inline capture without sending; setup lives in General settings.
  await start(); await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
  await allTracksStopped();
  assert.equal(await input.inputValue(), savedDraft);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.settings-section-tabs').getByRole('button', { name: 'General', exact: true }).click();
  const settingsLink = page.locator('.settings-general').getByRole('link', { name: 'Voice settings', exact: true });
  assert.equal(await settingsLink.getAttribute('href'), '/dashboard/settings#voice');
  assert.equal(await settingsLink.getAttribute('target'), null);
  await settingsLink.click(); await page.waitForURL('**/dashboard/settings#voice');
  assert.equal(pageFileReads, 0, 'Site links never reach the filesystem API');
  assert.equal(prompts + tts, 0); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, asr, prompts, tts, note: "synthetic microphone; mocked ASR; new and existing agent composers" }));
} finally { await browser.close(); }
