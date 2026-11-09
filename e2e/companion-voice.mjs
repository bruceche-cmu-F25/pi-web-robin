// Mocked Agent, ASR and TTS; real browser WebAudio/worklet and media playback. No paid calls or writes.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/companion-voice.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fullstackPlan, practicePlan } from '../extension/robin/learning.ts';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const until = async fn => { const deadline = Date.now() + 15000; while (!fn()) { assert.ok(Date.now() < deadline, 'condition timed out'); await new Promise(resolve => setTimeout(resolve, 50)); } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => {
    localStorage.setItem('pi-locale', 'en'); localStorage.setItem('pi-theme', 'light');
    sessionStorage.setItem('robin:voice:engine-v2', 'legacy'); // Pin the retained local-ASR/Agent path.
    window.__micCalls = 0; window.__stops = 0; window.__holdPermission = false;
    navigator.mediaDevices.getUserMedia = async () => {
      window.__micCalls++;
      const audio = new AudioContext(); await audio.resume();
      const oscillator = audio.createOscillator(), gain = audio.createGain(), destination = audio.createMediaStreamDestination();
      oscillator.frequency.value = 220; gain.gain.value = 0;
      oscillator.connect(gain); gain.connect(destination); oscillator.start();
      window.__level = level => { gain.gain.value = level; };
      const track = destination.stream.getAudioTracks()[0], stop = track.stop.bind(track);
      window.__track = track;
      track.stop = () => { window.__stops++; stop(); void audio.close(); };
      if (window.__holdPermission) await new Promise(resolve => { window.__grant = resolve; });
      return destination.stream;
    };
  });
  let asr = 0, tts = 0, writes = 0, replyFails = false, speechFails = false;
  let replyGate = null, speechGate = null, transcript = 'What needs review?';
  const requests = [];
  const wav = Buffer.alloc(44 + 320000); // ten seconds of silent PCM
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(320000, 40);
  const unset = { set: false };
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/api/robin/companion') {
      requests.push(req.postDataJSON()); if (replyGate) await replyGate.promise;
      return route.fulfill(replyFails ? { status: 503, json: { code: 'unconfirmed' } } : { json: {
        answer: 'Two items need review.', spoken: 'Two items need review.', actionState: 'not-executed', sessionId: `fixture-${requests.length}`, consultedTools: ['todo_list'],
      } }).catch(() => {});
    }
    if (url.pathname === '/api/robin/voice') {
      if (req.method() === 'GET') return route.fulfill({ json: { configured: true, ttsConfigured: true, asrModel: 'local', ttsModel: 'higgs-tts-3' } });
      if (url.searchParams.get('op') === 'transcribe') {
        asr++; assert.equal(req.postDataBuffer().toString('ascii', 0, 4), 'RIFF');
        return route.fulfill({ json: { text: transcript } });
      }
      assert.equal(url.searchParams.get('op'), 'speak'); tts++;
      if (speechGate) await speechGate.promise;
      return route.fulfill(speechFails ? { status: 502, json: { code: 'provider' } } : { contentType: 'audio/wav', body: wav }).catch(() => {});
    }
    if (req.method() !== 'GET') writes++;
    if (url.pathname === '/api/robin/todos') return route.fulfill({ json: { todos: [] } });
    if (url.pathname === '/api/robin/events') return route.fulfill({ json: { events: [] } });
    if (url.pathname === '/api/robin/links') return route.fulfill({ json: { links: [] } });
    if (url.pathname === '/api/robin/learning') return route.fulfill({ json: { practice: practicePlan([], 'neetcode150', '2030-01-01'), fullstack: fullstackPlan([]) } });
    if (url.pathname === '/api/robin/settings') return route.fulfill({ json: {
      boson: { set: true, source: 'file' }, notifications: { channel: 'telegram' }, google: { clientId: unset, clientSecret: unset, calendars: [] }, notion: { apiToken: unset }, playwright: { extensionToken: unset },
      storedAt: '/fixture', telegram: { botToken: unset, allowedChatIds: [], dailyAgenda: { enabled: false, time: '08:00', locale: 'en' }, jobDigest: { enabled: false, morning: '08:00', evening: '20:00', count: 10, locale: 'en', chatIds: [], sweepAt: '03:00' }, gmailDigest: { enabled: false, time: '08:00', locale: 'en', chatIds: [], query: 'newer_than:1d' }, reminders: { enabled: false, lead: 30, locale: 'en', chatIds: [] }, transcription: { enabled: false, baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', apiKey: unset } },
    } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser:', error.message); });
  const root = page.locator('[data-robin-companion]');
  const panel = root.locator('dialog');
  const button = name => panel.getByRole('button', { name, exact: true });
  const status = () => panel.getByRole('status');
  const input = () => panel.getByRole('textbox', { name: 'Talk to Robin' });
  const level = value => page.evaluate(value => window.__level(value), value);
  const utter = async () => { await level(.1); await page.waitForTimeout(450); await level(0); };
  const open = async () => { await page.getByRole('button', { name: 'Start voice conversation', exact: true }).click(); await panel.waitFor(); };
  const listen = async () => { await open(); await status().filter({ hasText: 'Listening' }).waitFor().catch(async error => { console.error('Voice state:', await panel.innerText(), { writes, mic: await page.evaluate(() => ({calls: window.__micCalls, stops: window.__stops, engine: sessionStorage.getItem('robin:voice:engine-v2')})) }); throw error; }); };
  const received = () => page.waitForFunction(() => { const record = JSON.parse(sessionStorage.getItem('robin:companion:recent-v1') || '{}'); return !record.pending && record.messages?.at(-1)?.role === 'assistant'; });
  await page.goto('/dashboard/settings#voice');
  assert.equal(await page.evaluate(() => window.__micCalls), 0);
  assert.equal(await root.getByRole('button').count(), 0, 'no floating Robin button');
  await listen();
  assert.equal(await page.evaluate(() => window.__micCalls), 1, 'one click starts capture');
  assert.equal(await panel.getByRole('button').count(), 3, 'only transcript, mute and end');
  assert.equal(await input().isVisible(), false, 'no form wall on entry');
  assert.equal(await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'), false);
  await level(.1); await page.waitForTimeout(450); await level(0); await page.waitForTimeout(500);
  assert.equal(asr, 0, 'a short pause does not submit');
  await level(.1); await page.waitForTimeout(350); await level(0);
  await until(() => asr === 1 && tts === 1); await status().filter({ hasText: 'Speaking' }).waitFor();
  assert.equal(requests[0].context.page, '/dashboard/settings');
  await button('Mute microphone').click();
  assert.equal(await page.evaluate(() => window.__track.enabled), false);
  assert.equal(await root.locator('audio').evaluate(el => el.paused), false, 'mute does not cut off Robin');
  await level(.1); await page.waitForTimeout(600); await level(0);
  assert.equal(asr, 1, 'muted samples are not captured');
  await button('Unmute microphone').click();
  assert.equal(await page.evaluate(() => window.__track.enabled), true);
  const firstCount = requests.length;
  await level(.1); await page.waitForTimeout(350);
  assert.equal(await root.locator('audio').evaluate(el => el.paused), true, 'new speech interrupts playback');
  await level(0); await until(() => requests.length === firstCount + 1 && tts === 2);
  assert.equal(await page.evaluate(() => window.__micCalls), 1, 'continuous turns use one explicit mic grant');
  await button('End conversation').click();
  assert.equal(await page.evaluate(() => window.__stops), 1);
  assert.equal(await root.locator('audio').isHidden(), true);

  // Stopping while TTS is pending must discard even a successfully generated late response.
  speechGate = deferred(); await listen();
  await utter(); await until(() => tts === 3);
  await status().filter({ hasText: 'Preparing audio' }).waitFor();
  await button('End conversation').click(); speechGate.resolve(); speechGate = null;
  await page.waitForTimeout(200); assert.equal(await root.locator('audio').isHidden(), true);

  // TTS failure keeps the confirmed text, without pretending that audio played.
  speechFails = true; await listen();
  await utter(); await until(() => tts === 4);
  await panel.getByRole('alert').filter({ hasText: 'Audio failed' }).waitFor();
  assert.ok(await panel.locator('[data-role="assistant"]').count() > 0);
  await button('End conversation').click(); speechFails = false;

  // A reply arriving after End must not append text or restart speech.
  replyGate = deferred(); const heldBefore = requests.length;
  const answersBefore = await panel.locator('[data-role="assistant"]').count();
  await listen();
  await utter(); await until(() => requests.length > heldBefore);
  await status().filter({ hasText: 'Waiting for reply' }).waitFor();
  await button('End conversation').click(); replyGate.resolve(); replyGate = null;
  await page.waitForTimeout(200);
  assert.equal(await panel.locator('[data-role="assistant"]').count(), answersBefore);
  assert.equal(tts, 4);

  // A failed reply is neither success nor an implicit retry.
  replyFails = true; await listen(); await button('Transcript').click(); await input().fill('Check again'); await button('Send').click();
  await status().filter({ hasText: 'Reply not confirmed' }).waitFor();
  const failedCount = requests.length; await page.waitForTimeout(300); assert.equal(requests.length, failedCount); replyFails = false;
  await button('End conversation').click();

  // Late microphone permission after an explicit stop releases the newly returned track.
  await page.evaluate(() => { window.__holdPermission = true; });
  await open(); await status().filter({ hasText: 'Waiting for permission' }).waitFor();
  await page.waitForFunction(() => !!window.__grant);
  const beforeStops = await page.evaluate(() => window.__stops);
  await button('End conversation').click(); await page.evaluate(() => { window.__grant(); window.__holdPermission = false; });
  await page.waitForFunction(expected => window.__stops > expected, beforeStops);
  assert.equal(await panel.isVisible(), false);

  // Incomplete speech is a reviewable draft, not an automatic prompt.
  transcript = 'because'; const beforeRequests = requests.length;
  await listen(); await utter();
  await status().filter({ hasText: 'Draft · not sent' }).waitFor(); assert.equal(requests.length, beforeRequests);
  assert.equal(await input().inputValue(), 'because');
  // Hiding the page closes the microphone and never resumes it on return.
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await button('Resume conversation').waitFor();
  await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await button('Resume conversation').isVisible(), true);
  await button('Transcript').click();
  await panel.getByText('Use & privacy', { exact: true }).click(); await button('Clear this conversation').click();
  await input().fill('Keep this context.'); await button('Send').click(); await received();
  await page.goto('/dashboard/settings?tab=fixture#general');
  assert.equal(await page.evaluate(() => window.__micCalls), 0, 'document navigation never restores voice consent');
  await listen(); await button('Transcript').click();
  await panel.getByText('Keep this context.', { exact: true }).waitFor();
  // Root owner stays present when Next's patched history updates the current page/reference.
  await page.evaluate(() => history.pushState(null, '', '/notes?id=note-1&token=NEVER_FORWARD'));
  await panel.getByText('/notes · id=note-1', { exact: true }).waitFor();
  await input().fill('What is selected?'); await button('Send').click(); await received();
  assert.equal(requests.at(-1).context.reference, 'id=note-1');
  assert.ok(!JSON.stringify(requests.at(-1)).includes('NEVER_FORWARD'));
  // Select before opening: the voice dialog deliberately makes the page behind it inert.
  await button('End conversation').click();
  await page.locator('main h1').evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const selected = getSelection(); selected.removeAllRanges(); selected.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  await listen(); await button('Transcript').click();
  await button('Include selected text').click();
  await input().fill('Explain this selection'); await button('Send').click(); await received();
  assert.match(requests.at(-1).context.selection, /Settings/);
  assert.match(requests.at(-1).context.selection, /id=note-1/);

  await button('Transcript').click();
  await mkdir('outputs/robin-voice', { recursive: true });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const bounds = await panel.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.ok((await button('End conversation').boundingBox()).height >= 44);
    assert.equal(await panel.getByRole('button').count(), 3);
    await page.screenshot({ path: `outputs/robin-voice/companion-${width}.png` });
  }
  await page.setViewportSize({ width: 640, height: 320 });
  await page.waitForFunction(() => { const box = document.querySelector('[aria-label="End conversation"]')?.getBoundingClientRect(); return box && box.top >= 0 && box.bottom <= innerHeight; });
  await panel.press('Escape'); assert.equal(await panel.isVisible(), false);
  assert.equal(await page.evaluate(() => window.__track.readyState), 'ended');
  // Home places voice in thumb reach, not in the header or a retired recording/review panel.
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/dashboard');
  // The dev-only Next badge can sit over the last header control; it is not application chrome.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const controls = page.locator('.robin-dashboard-toolbar > :is(a, button)');
    await controls.first().waitFor({ state: 'visible' });
    await controls.last().waitFor({ state: 'visible' });
    assert.equal(await controls.count(), 2, 'phone header has Chat and Search only');
    const boxes = await controls.evaluateAll(elements => elements.map(el => el.getBoundingClientRect().toJSON()));
    for (let i = 0; i < boxes.length; i++) {
      assert.ok(boxes[i].width >= 44 && boxes[i].height >= 44, `retain touch target size: ${width}px ${JSON.stringify(boxes[i])}`);
      assert.ok(boxes[i].x >= 0 && boxes[i].right <= width, 'all controls remain on screen');
      if (i) assert.ok(boxes[i].x - boxes[i - 1].right >= 3.5, 'space between controls');
    }
    const dockVoice = page.locator('.robin-dashboard-dock [data-companion-launcher]');
    const voiceBox = await dockVoice.boundingBox();
    assert.ok(voiceBox.width >= 56 && voiceBox.height >= 56 && voiceBox.x >= 0 && voiceBox.x + voiceBox.width <= width, `voice fits the phone dock: ${width}px ${JSON.stringify(voiceBox)}`);
    const slots = await page.locator('.robin-dashboard-dock > button').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().toJSON()));
    assert.equal(slots.length, 5, 'four destinations and one voice action');
    assert.ok(slots[1].x + slots[1].width <= voiceBox.x + 1 && voiceBox.x + voiceBox.width <= slots[3].x + 1, `voice sits between Calendar and Tasks: ${JSON.stringify(slots)}`);
    await page.screenshot({ path: `outputs/robin-voice/home-toolbar-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const homeVoice = page.locator('.robin-dashboard-dock [data-companion-launcher]');
  assert.ok(await homeVoice.evaluate(el => getComputedStyle(el.querySelector('svg')).color !== getComputedStyle(el).backgroundColor), 'dock must not paint the voice glyph in its own background color');
  await homeVoice.click();
  await status().filter({ hasText: 'Listening' }).waitFor();
  assert.equal(await page.evaluate(() => window.__micCalls), 1);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'glass'));
  await page.screenshot({ path: 'outputs/robin-voice/companion-home-390.png' });
  await button('End conversation').click();
  // Other phone pages put Voice in navigation, not over the page's bottom controls.
  await page.goto('/dashboard/settings#voice');
  await page.locator('.robin-mobile-nav-trigger').click();
  await page.locator('.robin-nav-utility [data-companion-launcher]').click();
  await status().filter({ hasText: 'Listening' }).waitFor();
  await button('End conversation').click();
  assert.equal(await page.locator('.robin-mobile-nav-trigger').evaluate(el => el === document.activeElement), true);
  assert.deepEqual(errors, []); assert.equal(writes, 0);
  console.log(JSON.stringify({ ok: true, asr, tts, turns: requests.length, writes, note: 'Mocked Agent/ASR/TTS; real worklet, generated microphone stream; no paid calls' }));
} finally { await browser.close(); }
