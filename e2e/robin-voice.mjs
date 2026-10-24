// Existing dev server; synthetic microphone and mocked ASR/TTS/agent. No paid calls or personal data.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { fullstackPlan, practicePlan } from '../extension/robin/learning.ts';
import { validateVoiceWav } from '../extension/robin/voice-domain.ts';
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:30141';
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
function wav() {
  const bytes = Buffer.alloc(44 + 16_000 * 2 * 3);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, permissions: ['microphone'], serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => {
    localStorage.setItem('pi-locale', 'en');
    window.__voiceStreams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await original(...args); window.__voiceStreams.push(stream); return stream; };
  });
  let configured = false, ttsConfigured = false, asr = 0, tts = 0, turns = 0, holdSpeech = false, releaseSpeech;
  const sent = [], spoken = [], errors = [];
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/api/robin/voice') {
      if (req.method() === 'GET') return route.fulfill({ json: { configured, ttsConfigured, asrModel: 'whisper.cpp (local)', ttsModel: 'qwen3-tts-flash' } });
      if (url.searchParams.get('op') === 'transcribe') {
        asr++; validateVoiceWav(req.postDataBuffer());
        return route.fulfill({ json: { text: '请查今天的待办，不要修改。' } });
      }
      tts++; spoken.push(req.postDataJSON().text);
      if (holdSpeech) await new Promise(resolve => { releaseSpeech = resolve; });
      return route.fulfill({ contentType: 'audio/wav', body: wav() });
    }
    if (url.pathname === '/api/robin/assistant') {
      if (req.method() === 'GET') return route.fulfill({ json: { sessionId: null, running: false } });
      turns++; sent.push(req.postDataJSON());
      return route.fulfill({ json: { reply: '今天有两项待办。没有修改任何记录。详情在屏幕上。第四句不播报。', usedTools: ['todo_list'], sessionId: 'voice-fixture' } });
    }
    if (url.pathname === '/api/robin/links') return route.fulfill({ json: { links: [] } });
    if (url.pathname === '/api/robin/todos') return route.fulfill({ json: { todos: [] } });
    if (url.pathname === '/api/robin/learning') return route.fulfill({ json: { practice: practicePlan([], 'neetcode150', '2030-01-01'), fullstack: fullstackPlan([]) } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('/dashboard');
  const bar = page.locator('.robin-assistant-bar');
  // Search owns a visible, keyboard-accessible microphone; it cannot dispatch an agent.
  const mic = bar.locator('.robin-assistant-form').getByRole('button', { name: 'Voice', exact: true });
  await mic.click();
  await bar.getByText('Local dictation is not ready.', { exact: false }).waitFor();
  assert.equal(await bar.getByRole('button', { name: 'Voice conversation', exact: true }).count(), 0);
  assert.equal(await bar.getByRole('button', { name: 'Confirm and send', exact: true }).count(), 0);
  configured = true;
  await bar.getByRole('button', { name: 'Check configuration', exact: true }).click();
  const searchInput = bar.locator('input[name="query"]');
  await searchInput.fill('Existing search.');
  await bar.getByRole('button', { name: 'Dictate', exact: true }).click();
  await bar.getByRole('button', { name: 'Done speaking', exact: true }).waitFor();
  assert.equal(await mic.getAttribute('data-recording'), 'true');
  await page.waitForTimeout(800);
  await bar.getByRole('button', { name: 'Done speaking', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[name="query"]')?.value.includes('不要修改'));
  assert.match(await searchInput.inputValue(), /^Existing search\./);
  assert.equal(asr, 1); assert.equal(turns + tts, 0);
  assert.equal(new URL(page.url()).pathname, '/dashboard');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await bar.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `search voice fits ${width}px`);
    const bounds = await mic.boundingBox();
    assert.ok(bounds.width >= 44 && bounds.height >= 44);
    await mic.focus(); assert.equal(await mic.evaluate(el => el === document.activeElement), true);
  }
  await bar.getByRole('button', { name: 'Dictate', exact: true }).click();
  await bar.getByRole('button', { name: 'Done speaking', exact: true }).waitFor();
  configured = false;
  await bar.getByRole('button', { name: 'Act', exact: true }).click();
  await page.waitForFunction(() => window.__voiceStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  assert.equal(asr, 1, 'switching modes discards recording');
  assert.equal(await mic.getAttribute('aria-expanded'), 'false');
  await bar.locator('input[name="instruction"]').fill('');
  asr = 0;
  await bar.getByRole('button', { name: 'Voice', exact: true }).click();
  await bar.getByText('Local dictation is not ready.', { exact: false }).waitFor();
  assert.equal(await bar.getByRole('button', { name: 'Dictate', exact: true }).isDisabled(), true);
  assert.equal(asr + tts + turns, 0);
  configured = true;
  await bar.getByRole('button', { name: 'Check configuration', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Dictate' && !b.disabled));

  // Real MediaRecorder → Web Audio decode/resample → canonical WAV upload.
  const input = bar.getByRole('textbox', { name: 'Instruction for Pi', exact: true });
  await input.fill('Existing draft.');
  await bar.getByRole('button', { name: 'Dictate', exact: true }).click();
  await bar.getByRole('button', { name: 'Done speaking', exact: true }).waitFor();
  await page.waitForTimeout(800);
  await bar.getByRole('button', { name: 'Done speaking', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[name="instruction"]')?.value.includes('不要修改'));
  assert.match(await input.inputValue(), /^Existing draft\./);
  assert.equal(asr, 1); assert.equal(turns, 0, 'recognition never auto-submits an action');
  assert.ok(await page.evaluate(() => window.__voiceStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))));
  await bar.getByRole('button', { name: 'Confirm and send', exact: true }).click();
  await bar.locator('.robin-assistant-reply').waitFor();
  assert.equal(turns, 1); assert.equal(tts, 0, 'dictation does not turn on speech');
  assert.equal(sent[0].mode, undefined, 'uses the existing default Robin conversation, not a new voice agent');

  assert.equal(await bar.getByRole('button', { name: 'Voice conversation', exact: true }).count(), 0, 'local dictation works without TTS setup');
  assert.equal(await bar.getByRole('button', { name: 'Read reply excerpt', exact: true }).count(), 0);
  // Existing optional TTS is tested separately; it is not needed to dictate.
  ttsConfigured = true;
  await page.reload();
  await bar.getByRole('button', { name: 'Act', exact: true }).click();
  await bar.getByRole('button', { name: 'Voice', exact: true }).click();
  // Conversation is explicit consent to audio replies, not to automatic actions.
  await bar.getByRole('button', { name: 'Voice conversation', exact: true }).click();
  await bar.getByRole('button', { name: 'Done speaking', exact: true }).waitFor();
  await page.waitForTimeout(800); await bar.getByRole('button', { name: 'Done speaking', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[name="instruction"]')?.value.includes('不要修改'));
  assert.equal(turns, 1);
  await bar.getByRole('button', { name: 'Confirm and send', exact: true }).click();
  await bar.getByRole('button', { name: 'Stop playback', exact: true }).waitFor();
  await bar.locator('audio').waitFor({ state: 'visible' });
  await page.waitForFunction(() => { const audio = document.querySelector('.robin-assistant-bar audio'); return audio && !audio.paused && audio.currentTime > 0; });
  assert.equal(tts, 1); assert.deepEqual(spoken, ['今天有两项待办。没有修改任何记录。详情在屏幕上。']);
  await bar.getByRole('button', { name: 'Stop playback', exact: true }).click();
  assert.equal(await bar.locator('audio').evaluate(a => a.paused && !a.hasAttribute('src')), true);
  assert.equal(turns, 2);

  // End during synthesis: no late audio, automatic replay or task cancel request.
  holdSpeech = true; await input.fill('Another question.');
  await bar.getByRole('button', { name: 'Confirm and send', exact: true }).click();
  await bar.getByText('Microphone off · preparing a spoken excerpt…', { exact: true }).waitFor();
  await page.waitForTimeout(200);
  assert.equal(typeof releaseSpeech, 'function');
  await bar.getByRole('button', { name: 'End voice', exact: true }).click();
  holdSpeech = false; releaseSpeech(); await page.waitForTimeout(200);
  assert.equal(await bar.locator('audio').isHidden(), true);
  assert.equal(turns, 3); assert.equal(tts, 2);

  // Closing UI while recording stops tracks and discards, without another ASR call.
  await bar.getByRole('button', { name: 'Dictate', exact: true }).click();
  await bar.getByRole('button', { name: 'Done speaking', exact: true }).waitFor();
  await bar.getByRole('button', { name: 'Voice', exact: true }).click();
  assert.ok(await page.evaluate(() => window.__voiceStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))));
  assert.equal(asr, 2);
  await bar.getByRole('button', { name: 'Voice', exact: true }).click();
  await bar.getByRole('button', { name: 'Dictate', exact: true }).click();
  await bar.getByRole('button', { name: 'Done speaking', exact: true }).waitFor();
  await bar.evaluate(el => { el.style.display = 'none'; });
  await page.waitForFunction(() => window.__voiceStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')));
  await bar.evaluate(el => { el.style.display = ''; });
  assert.equal(asr, 2, 'hiding a mounted workspace discards capture');
  await bar.getByRole('button', { name: 'Voice', exact: true }).click();

  const screenshots = process.env.E2E_SCREENSHOT_DIR || 'outputs/robin-voice'; mkdirSync(screenshots, { recursive: true });
  await bar.getByRole('button', { name: 'Voice', exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await bar.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `voice controls must not overflow ${width}px`);
    const record = bar.getByRole('button', { name: 'Dictate', exact: true });
    assert.ok((await record.boundingBox()).height >= 44);
    await record.focus(); assert.equal(await record.evaluate(el => el === document.activeElement), true);
    await bar.screenshot({ path: `${screenshots}/voice-${width}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.setViewportSize({ width: 844, height: 500 });
  assert.ok(await bar.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await bar.screenshot({ path: `${screenshots}/voice-dark-landscape.png` });
  // Initial setup screen in Chinese, still no paid calls or key field sent through chat.
  configured = false;
  await context.addInitScript(() => localStorage.setItem('pi-locale', 'zh-CN'));
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload();
  await bar.getByRole('button', { name: '执行', exact: true }).click();
  await bar.getByRole('button', { name: '语音', exact: true }).click();
  await bar.getByText('本地语音输入尚未就绪。', { exact: false }).waitFor();
  await bar.screenshot({ path: `${screenshots}/voice-setup-zh.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, asr, tts, turns, screenshots, note: 'synthetic microphone + mocked local ASR, optional TTS and agent responses; no live provider calls' }));
  await context.close();
} finally { await browser.close(); }
