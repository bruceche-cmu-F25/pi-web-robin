// Existing dev server; real browser capture with a synthetic microphone, mocked ASR/agent/TTS.
// No paid calls, real microphone, saved tasks or sessions.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { validateVoiceWav } from '../extension/robin/voice-domain.ts';
import { fullstackPlan, practicePlan } from '../extension/robin/learning.ts';
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:30141';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, permissions: ['microphone'], serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => {
    localStorage.setItem('pi-locale', 'en');
    window.__streams = []; window.__permissionReady = true; window.__meterReads = 0;
    const readSamples = AnalyserNode.prototype.getFloatTimeDomainData;
    AnalyserNode.prototype.getFloatTimeDomainData = function(samples) {
      window.__meterReads++;
      if (typeof window.__meterAmplitude !== 'number') return readSamples.call(this, samples);
      // Deterministic synthetic level fixtures for the visual meter only; capture still uses MediaRecorder.
      for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 8) * window.__meterAmplitude;
    };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      if (!window.__permissionReady) await new Promise(resolve => { window.__grant = resolve; });
      const stream = await original(...args); window.__streams.push(stream); return stream;
    };
  });
  let ttsConfigured = false, tts = 0;
  let asr = 0, turns = 0, holdASR = false, releaseASR, failASR = false, holdTurn = false, releaseTurn, failTurn = false;
  const messages = [], errors = [];
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/robin/voice') {
      if (request.method() === 'GET') return route.fulfill({ json: { configured: true, ttsConfigured } });
      if (url.searchParams.get('op') === 'speak') {
        tts++;
        const bytes = Buffer.alloc(44 + 16_000 * 2 * 3);
        bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
        bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28);
        bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
        return route.fulfill({ contentType: 'audio/wav', body: bytes });
      }
      assert.equal(url.searchParams.get('op'), 'transcribe');
      asr++; validateVoiceWav(request.postDataBuffer());
      if (holdASR) await new Promise(resolve => { releaseASR = resolve; });
      return route.fulfill(failASR ? { status: 422, json: { code: 'empty' } } : { json: { text: '明天下午三点提醒我开会，不是今天。' } }).catch(() => {});
    }
    if (url.pathname === '/api/robin/assistant') {
      if (request.method() === 'GET') return route.fulfill({ json: { sessionId: 'voice-fixture', running: false } });
      turns++; messages.push(request.postDataJSON());
      if (holdTurn) await new Promise(resolve => { releaseTurn = resolve; });
      return route.fulfill(failTurn ? { status: 500, json: { error: 'unconfirmed' } } : { json: { reply: '已记录明天下午三点开会。', usedTools: ['todo_add'], sessionId: 'voice-fixture' } });
    }
    if (url.pathname === '/api/robin/todos') return route.fulfill({ json: { todos: [] } });
    if (url.pathname === '/api/robin/events') return route.fulfill({ json: { events: [] } });
    if (url.pathname === '/api/robin/links') return route.fulfill({ json: { links: [] } });
    if (url.pathname === '/api/robin/learning') return route.fulfill({ json: { practice: practicePlan([], 'neetcode150', '2030-01-01'), fullstack: fullstackPlan([]) } });
    return route.fulfill({ json: {} });
  });
  mkdirSync('outputs/robin-voice', { recursive: true });
  const page = await context.newPage(); page.on('pageerror', e => { errors.push(e.message); console.error('pageerror:', e.message); });
  await page.goto('/dashboard');
  const launch = () => page.getByRole('button', { name: 'Talk to Robin', exact: true });
  const panel = page.locator('[data-voice-panel]');
  const recording = () => page.locator('[data-voice-panel][data-voice-phase="recording"]').waitFor();
  const stopTracks = () => page.waitForFunction(() => window.__streams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  const finish = async () => { await page.waitForTimeout(750); await panel.getByRole('button', { name: 'Done speaking', exact: true }).click(); };
  const confirm = async () => {
    await panel.getByRole('textbox', { name: 'Robin heard', exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Confirm and send', exact: true }).click();
  };
  const close = async () => { await panel.getByRole('button', { name: /^(Close voice|Cancel recording)$/ }).click(); await panel.waitFor({ state: 'hidden' }); };

  // One tap starts immediately. The same original button finishes; no menu or keyboard.
  await launch().click(); await recording();
  assert.equal(await page.evaluate(() => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)), false);
  assert.equal(turns + asr, 0);
  await page.waitForTimeout(750);
  await page.locator('.robin-dashboard-toolbar').getByRole('button', { name: 'Done speaking', exact: true }).click();
  const transcript = panel.getByRole('textbox', { name: 'Robin heard', exact: true });
  await transcript.waitFor();
  assert.equal(await transcript.inputValue(), '明天下午三点提醒我开会，不是今天。');
  assert.equal(turns, 0, 'Finishing never submits unreviewed recognition');
  await transcript.fill('');
  assert.equal(await transcript.isVisible(), true, 'Deleting all recognized text keeps an editable field');
  assert.equal(await panel.getByRole('button', { name: 'Confirm and send', exact: true }).isEnabled(), false);
  await transcript.fill('明天下午四点提醒我开会，不是今天。');
  await page.screenshot({ path: 'outputs/robin-voice/review-390.png' });
  await page.evaluate(() => document.documentElement.style.setProperty('--app-viewport-height', '420px'));
  const reviewSend = await panel.getByRole('button', { name: 'Confirm and send', exact: true }).boundingBox();
  assert.ok(reviewSend.y + reviewSend.height <= 420, 'Send follows the app keyboard viewport');
  await page.evaluate(() => document.documentElement.style.removeProperty('--app-viewport-height'));
  await close();
  const streamsBeforeReview = await page.evaluate(() => window.__streams.length);
  await launch().click(); await transcript.waitFor();
  assert.equal(await transcript.inputValue(), '明天下午四点提醒我开会，不是今天。');
  assert.equal(await page.evaluate(() => window.__streams.length), streamsBeforeReview, 'Reopening a draft does not turn on the microphone');
  await confirm();
  await panel.getByText('已记录明天下午三点开会。', { exact: true }).waitFor();
  assert.equal(turns, 1); assert.equal(asr, 1);
  assert.deepEqual(messages[0], { message: '明天下午四点提醒我开会，不是今天。' });
  await stopTracks(); await close();

  // Hold/release through real pointer capture and a nonmodal top-layer panel.
  let box = await launch().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await recording(); await page.waitForTimeout(800);
  await panel.getByText('Release to finish · slide up to cancel', { exact: true }).waitFor();
  await page.mouse.up(); await transcript.waitFor();
  assert.equal(turns, 1, 'Hold/release also requires a separate Send');
  await confirm(); await panel.getByText('已记录明天下午三点开会。', { exact: true }).waitFor();
  assert.equal(turns, 2); await close();

  // Slide-up cancellation: no transcription upload and no turn.
  box = await launch().boundingBox();
  await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down(); await recording();
  await page.waitForTimeout(400); await page.mouse.move(box.x + 22, box.y - 50);
  await panel.getByText('Release to cancel', { exact: true }).waitFor();
  await page.mouse.up(); await stopTracks();
  assert.equal(asr, 2); assert.equal(turns, 2); await close();

  // A late permission grant after release stays in tap mode; nothing auto-submits.
  await page.evaluate(() => { window.__permissionReady = false; });
  box = await launch().boundingBox();
  await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down(); await page.waitForTimeout(450); await page.mouse.up();
  await page.waitForFunction(() => typeof window.__grant === 'function');
  await page.evaluate(() => { window.__permissionReady = true; window.__grant(); });
  await recording(); assert.equal(turns, 2);
  await finish(); await confirm(); await panel.getByText('已记录明天下午三点开会。', { exact: true }).waitFor();
  assert.equal(turns, 3); await close();

  // Closing during recognition aborts it and fences its late result.
  holdASR = true; await launch().click(); await recording(); await finish();
  while (!releaseASR) await page.waitForTimeout(10);
  await close(); holdASR = false; releaseASR(); await page.waitForTimeout(150);
  assert.equal(turns, 3);

  // Recognition errors never become instructions. Retry requires a new user recording.
  failASR = true; await launch().click(); await recording(); await finish();
  await panel.getByRole('alert').waitFor(); assert.equal(turns, 3); await close(); failASR = false;

  // Once submitted, close/reopen is only a voice UI action, not cancellation or resubmission.
  holdTurn = true; await launch().click(); await recording(); await finish(); await confirm();
  while (!releaseTurn) await page.waitForTimeout(10);
  assert.equal(turns, 4); await close();
  await launch().click(); await panel.getByText(/Robin is working/).waitFor();
  assert.equal(turns, 4);
  holdTurn = false; releaseTurn(); await panel.getByText('已记录明天下午三点开会。', { exact: true }).waitFor(); await close();

  failTurn = true; await launch().click(); await recording(); await finish(); await confirm();
  await panel.getByRole('alert').waitFor(); assert.match(await panel.getByRole('alert').textContent(), /may still have run/);
  assert.equal(turns, 5); assert.equal(await panel.getByRole('link', { name: /execution record/i }).count(), 1);
  await close(); failTurn = false;

  // Pointer cancellation discards, while keyboard activation remains available.
  await launch().focus(); await page.keyboard.press('Enter'); await recording();
  await close(); await stopTracks();

  // Layout, real waveform, dark/reduced-motion, secure fallback bounds. Synthetic data only.
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'glass'); window.__meterAmplitude = 0.03; });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const capture = width >= 960 ? page.locator('#dashboard-desktop-assistant').getByRole('button', { name: 'Dictate', exact: true }) : launch();
    await capture.waitFor();
    assert.equal(await launch().count(), width >= 960 ? 0 : 1, 'Standalone voice is phone-only; desktop uses its input microphone');
    if (width >= 960) {
      const bar = page.locator('#dashboard-desktop-assistant');
      await bar.getByRole('button', { name: 'Act', exact: true }).click();
      await capture.waitFor();
      assert.equal(await capture.count(), 1, 'Act keeps one input microphone');
      await bar.getByRole('button', { name: 'Search', exact: true }).click();
      await capture.waitFor();
      assert.equal(await capture.count(), 1, 'Search keeps one input microphone');
    }
    await capture.click(); await recording();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page fits ${width}`);
    const bounds = await panel.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    const material = await panel.evaluate(el => ({ fill: getComputedStyle(el).backgroundColor, filter: getComputedStyle(el).backdropFilter, rim: getComputedStyle(el, '::after').pointerEvents }));
    assert.match(material.fill, /rgba\(.+, 0\.56\)/, 'shared translucent overlay tint');
    assert.match(material.filter, /blur\(10px\)/, 'one frost layer on the panel');
    assert.equal(material.rim, 'none', 'glass rim never steals gestures');
    assert.ok(bounds.height <= 160, `Capture stays compact at ${width}px, not a full voice sheet: ${bounds.height}`);
    assert.ok((await panel.getByRole('button', { name: 'Done speaking', exact: true }).boundingBox()).height >= 44);
    await page.waitForTimeout(950);
    const bars = panel.locator('[data-voice-meter] > span');
    assert.equal(await bars.count(), 9);
    assert.ok(await bars.nth(4).evaluate(el => Number(el.style.transform.match(/scaleY\((.+)\)/)[1]) > 0.4), 'quiet speech has a visible envelope');
    await page.screenshot({ path: `outputs/robin-voice/direct-${width}.png` });
    if (width === 390) {
      await page.evaluate(() => { window.__meterAmplitude = 0; }); await page.waitForTimeout(2400);
      const resting = await bars.evaluateAll(es => es.map(el => Number(el.style.transform.match(/scaleY\((.+)\)/)[1])));
      assert.ok(resting.every(value => value < 0.085), `silence settles; no fake looping wave: ${resting.join(',')}`);
      await page.evaluate(() => { window.__meterAmplitude = 0.03; });
    }
    await close();
    const reads = await page.evaluate(() => window.__meterReads);
    await page.waitForTimeout(120); assert.equal(await page.evaluate(() => window.__meterReads), reads, 'meter sampling stops with capture');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'glass-dark'));
  await page.setViewportSize({ width: 844, height: 390 });
  await launch().click(); await recording(); await page.waitForTimeout(350);
  assert.ok(await panel.locator('[data-voice-meter] > span').evaluateAll(es => es.every(el => el.style.transform === 'scaleY(0.0833)')), 'reduced motion uses stationary level dots');
  await page.screenshot({ path: 'outputs/robin-voice/direct-landscape.png' });
  const materialCdp = await context.newCDPSession(page);
  await materialCdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  assert.equal(await panel.evaluate(el => getComputedStyle(el).backdropFilter), 'none');
  assert.equal(await panel.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(44, 44, 46)');
  await materialCdp.send('Emulation.setEmulatedMedia', { features: [] }); await materialCdp.detach();
  await close();

  // Search dictation inside the existing modal stays read-only and appends the draft.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('robin-assistant-open', { detail: 'search' })));
  const dialog = page.locator('dialog[open]');
  await dialog.locator('input[name="query"]').fill('Existing search.');
  await dialog.getByRole('button', { name: 'Dictate', exact: true }).click(); await recording();
  await page.waitForTimeout(750); await panel.getByRole('button', { name: 'Done speaking', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('dialog[open] input[name="query"]')?.value.includes('不是今天'));
  assert.match(await dialog.locator('input[name="query"]').inputValue(), /^Existing search\./);
  assert.equal(turns, 5); await close();
  await page.keyboard.press('Escape');

  // Actual Chromium touch events, not mouse events on a narrow viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(page);
  box = await launch().boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 22, y: box.y + 22 }] });
  await recording(); await page.waitForTimeout(800);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await transcript.waitFor(); assert.equal(turns, 5, 'Touch release only transcribes');
  await confirm();
  await panel.getByText('已记录明天下午三点开会。', { exact: true }).waitFor();
  assert.equal(turns, 6); assert.equal(tts, 0); await close(); await cdp.detach();

  // Existing optional speech remains explicit; closing suppresses it, not the action.
  ttsConfigured = true; await page.reload();
  await launch().click(); await recording(); await finish(); await transcript.waitFor();
  await panel.locator('summary').filter({ hasText: 'Voice options' }).click();
  await panel.getByRole('checkbox', { name: 'Read Robin’s replies aloud', exact: true }).check();
  await confirm();
  await panel.locator('audio').waitFor({ state: 'visible' });
  assert.equal(tts, 1); assert.equal(turns, 7);
  await panel.getByRole('button', { name: 'Stop playback', exact: true }).click();
  assert.equal(await panel.locator('audio').evaluate(el => el.paused && !el.hasAttribute('src')), true);
  await close();
  await context.addInitScript(() => localStorage.setItem('pi-locale', 'zh-CN'));
  await page.reload(); await page.evaluate(() => { window.__meterAmplitude = 0.025; });
  await page.getByRole('button', { name: '跟 Robin 说', exact: true }).click(); await recording(); await page.waitForTimeout(950);
  assert.equal(await page.getByRole('dialog', { name: '跟 Robin 说', exact: true }).count(), 1, 'Compact panel retains an accessible name');
  assert.ok((await panel.boundingBox()).height <= 160, 'Chinese capture stays compact');
  await page.screenshot({ path: 'outputs/robin-voice/direct-zh.png' });
  await panel.getByRole('button', { name: '说完了', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Robin 听到的是', exact: true }).waitFor();
  assert.equal(turns, 7, 'Chinese recognition also waits for explicit Send');
  await page.screenshot({ path: 'outputs/robin-voice/review-zh.png' });
  await panel.getByRole('button', { name: '关闭语音', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, asr, turns, tts, note: 'synthetic microphone, mocked ASR/agent; not physical iOS/Android validation' }));
} finally { await browser.close(); }
