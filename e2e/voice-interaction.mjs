// Mocked Robin/ASR/TTS transport; real WebAudio/worklet. No paid calls or real task writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const until = async fn => { const end = Date.now() + 20_000; while (!fn()) { assert.ok(Date.now() < end, 'condition timeout'); await new Promise(r => setTimeout(r, 50)); } };
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => {
    localStorage.setItem('pi-locale', 'en');
    sessionStorage.setItem('robin:voice:engine', 'boson'); // Old trial preference must NOT silently win.
    window.__micCalls = 0; window.__speechStarts = 0; window.__speechStops = 0; window.__mediaPlays = 0;
    const streamSource = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function (...args) { window.__captureContext = this; return streamSource.apply(this, args); };
    const bufferSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const node = bufferSource.call(this), start = node.start.bind(node), stop = node.stop.bind(node);
      node.start = (...args) => {
        if (this !== window.__captureContext || this.state !== 'running') throw new Error('Speech must use the already-running capture context');
        window.__speechStarts++; return start(...args);
      };
      node.stop = (...args) => { window.__speechStops++; return stop(...args); };
      return node;
    };
    // Model iOS refusing a media-element play long after the opening gesture.
    // Normal Robin replies must never depend on this API.
    HTMLMediaElement.prototype.play = function () {
      window.__mediaPlays++;
      return Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'));
    };
    navigator.mediaDevices.getUserMedia = async () => {
      window.__micCalls++;
      const audio = new AudioContext(); await audio.resume();
      const oscillator = audio.createOscillator(), gain = audio.createGain(), target = audio.createMediaStreamDestination();
      gain.gain.value = 0; oscillator.connect(gain); gain.connect(target); oscillator.start();
      window.__level = value => { gain.gain.value = value; };
      const track = target.stream.getAudioTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { stop(); void audio.close(); }; window.__track = track;
      return target.stream;
    };
  });
  const calls = [], results = new Map(); let gets = 0, tts = 0, asr = 0, unexpected = 0, gate, asrGate, fail = false, speechFails = false, transcript = '改成后天';
  const wav = Buffer.alloc(44 + 160000); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(160000, 40);
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/robin/voice/interaction') {
      if (request.method() === 'GET') { gets++; return route.fulfill({ json: results.get(url.searchParams.get('id')) }); }
      const body = request.postDataJSON(); calls.push(body);
      const action = body.undoOf ? 'undo' : body.message.includes('完成') ? 'complete' : body.lastActionId ? 'update' : 'add';
      const result = { requestId: body.requestId, state: 'done', answer: body.allowTasks ? '已保存：去三楼喂鱼。' : 'No tasks yet.', spoken: body.allowTasks ? '已保存。' : 'No tasks yet.', sessionId: 'fixture',
        ...(body.allowTasks && body.message !== 'Any tasks?' ? { receipt: { requestId: body.requestId, action, taskId: 'same-task', title: '去三楼喂鱼', due: action === 'add' ? '2030-01-02' : '2030-01-03', revision: String(calls.length), undoable: action !== 'undo' } } : {}) };
      results.set(body.requestId, result);
      if (gate) await gate.promise;
      if (fail) return route.abort('failed');
      return route.fulfill({ json: result }).catch(() => {});
    }
    if (url.pathname === '/api/robin/voice') {
      if (request.method() === 'GET') return route.fulfill({ json: { configured: true, ttsConfigured: true, asrModel: 'local', ttsModel: 'higgs-tts-3' } });
      if (url.searchParams.get('op') === 'transcribe') {
        asr++; const text = transcript;
        if (asrGate) await asrGate.promise;
        return route.fulfill(text ? { json: { text } } : { status: 400, json: { code: 'empty' } });
      }
      assert.equal(url.searchParams.get('op'), 'speak'); tts++; return route.fulfill(speechFails ? { status: 502, json: { code: 'provider' } } : { contentType: 'audio/wav', body: wav });
    }
    if (url.pathname === '/api/robin/settings' && request.method() === 'GET') {
      // Read-only, redacted readiness/configuration; keep the real settings page
      // shape rather than crashing it with an invalid empty fixture.
      return route.continue();
    }
    if (request.method() !== 'GET' || url.pathname === '/api/robin/voice/realtime') unexpected++;
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('Browser:', e.message); });
  await page.goto('/dashboard/settings#voice');
  const panel = page.locator('[data-robin-companion] dialog');
  const button = name => panel.getByRole('button', { name, exact: true });
  const open = async () => {
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const nav = page.locator('.robin-mobile-nav-trigger');
    if (await nav.isVisible()) {
      await page.locator('.robin-navigation-container:not(.robin-navigation-pending)[inert]').waitFor({ state: 'attached' });
      await nav.click(); await page.locator('.robin-navigation-open').waitFor();
    }
    await page.getByRole('button', { name: 'Start voice conversation', exact: true }).click(); await panel.waitFor();
    await panel.getByRole('status').filter({ hasText: 'Listening' }).waitFor();
  };
  const settled = () => page.waitForFunction(() => !JSON.parse(sessionStorage.getItem('robin:voice:interaction-v1') || '{}').pendingId);
  const send = async text => { await panel.getByRole('textbox').fill(text); await button('Send').click(); };
  const utter = async () => { await page.evaluate(() => window.__level(.1)); await page.waitForTimeout(450); await page.evaluate(() => window.__level(0)); };
  await open(); await button('Transcript').click();
  assert.match(await panel.innerText(), /Robin understands and acts/);
  assert.equal(await panel.locator('select').inputValue(), 'robin');
  await send('Any tasks?'); await until(() => calls.length === 1); await settled(); assert.equal(calls[0].allowTasks, true);
  await until(() => tts === 1); // Typed/corrected input in an active voice call must also speak.
  await panel.getByRole('status').filter({ hasText: 'Speaking' }).waitFor();
  assert.equal(await page.evaluate(() => window.__speechStarts), 1);
  assert.equal(await button('Retry speech').count(), 0, 'normal replies need no playback button');
  assert.equal(await panel.getByRole('checkbox').count(), 0, 'voice entry needs no separate checkbox');
  gate = Promise.withResolvers(); await send('明天去三楼喂鱼'); await until(() => calls.length === 2);
  assert.equal(await panel.locator('select').isDisabled(), true);
  assert.equal(await button('Check result').count(), 0, 'an ordinary in-flight request is not an uncertain outcome');
  await button('End conversation').click(); gate.resolve(); gate = null; await settled();
  assert.equal(tts, 1, 'late receipt never restarts speech');
  await open(); await panel.locator('[data-task-receipt="same-task"]').waitFor();
  assert.equal(await panel.getByRole('checkbox').count(), 0);
  await utter(); await until(() => calls.length === 3 && tts === 2);
  await panel.getByRole('status').filter({ hasText: 'Speaking' }).waitFor();
  assert.equal(await page.evaluate(() => window.__mediaPlays), 0, 'automatic speech does not need media-element permission');
  assert.equal(await button('Retry speech').count(), 0);
  const stoppedBeforeMute = await page.evaluate(() => window.__speechStops);
  await button('Mute microphone').click();
  assert.equal(await page.evaluate(() => window.__speechStops), stoppedBeforeMute, 'mute preserves playback');
  await button('Unmute microphone').click();
  assert.equal(calls[2].lastActionId, calls[1].requestId); assert.equal(calls[2].message, '改成后天');
  await panel.getByRole('status').filter({ hasText: 'Speaking' }).waitFor();
  transcript = '完成那个'; await utter(); await until(() => calls.length === 4); await settled();
  assert.equal(calls[3].lastActionId, calls[2].requestId);
  // Undo is another explicit request, never a playback cancellation.
  await button('Undo').click(); await until(() => calls.length === 5); await settled();
  assert.equal(calls[4].undoOf, calls[3].requestId);
  // Noise while waiting must not permanently suppress the answer or stop capture.
  const spokenBeforeNoise = tts;
  gate = Promise.withResolvers(); transcript = '明天再喂鱼'; await utter(); await until(() => calls.length === 6);
  asrGate = Promise.withResolvers(); transcript = ''; await utter(); await until(() => asr === 4);
  gate.resolve(); gate = null; await settled();
  assert.equal(tts, spokenBeforeNoise);
  asrGate.resolve(); asrGate = null;
  await until(() => tts === spokenBeforeNoise + 1);
  assert.equal(calls.length, 6, 'empty recognition did not start another task turn');
  assert.equal(await page.evaluate(() => window.__track.readyState), 'live');
  // A correction can be transcribed while the previous write is in flight,
  // but cannot dispatch until it has that operation's real task reference.
  gate = Promise.withResolvers(); transcript = '明天再喂鱼'; await utter(); await until(() => calls.length === 7);
  transcript = '改成后天'; await utter(); await until(() => asr === 6);
  assert.equal(calls.length, 7); gate.resolve(); gate = null;
  await until(() => calls.length === 8); await settled();
  assert.equal(calls[7].lastActionId, calls[6].requestId);
  await button('Transcript').click();
  fail = true; await send('下周再喂鱼'); await until(() => calls.length === 9);
  await panel.getByRole('alert').waitFor(); const count = calls.length;
  await button('End conversation').click();
  await page.reload(); await until(() => gets > 0); await settled();
  assert.equal(calls.length, count, 'reload checks GET only; never repeats an action');
  assert.equal(await page.evaluate(() => window.__micCalls), 0, 'reload never restores microphone consent');
  fail = false;
  // Only an actual audio failure offers Retry speech. It never repeats the Agent turn.
  await open(); await button('Transcript').click(); speechFails = true;
  await send('Say hello'); await until(() => calls.length === 10);
  await button('Retry speech').waitFor();
  speechFails = false; const turnsBeforeRetry = calls.length;
  await button('Retry speech').click();
  await panel.getByRole('status').filter({ hasText: 'Speaking' }).waitFor();
  assert.equal(calls.length, turnsBeforeRetry);
  assert.equal(await button('Retry speech').count(), 0);
  await button('End conversation').click();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await open();
    const box = await panel.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
    assert.equal(await panel.getByRole('checkbox').count(), 0);
    const control = await button('End conversation').boundingBox(); assert.ok(control.height >= 44);
    await button('End conversation').click();
  }
  assert.equal(unexpected, 0); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, turns: calls.length, asr, tts, outcomeReads: gets, unexpected }));
  await context.close();
} finally { await browser.close(); }
