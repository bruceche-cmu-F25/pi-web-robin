// Mocked provider and session writes; real Chat, capture worklet and transcript lifecycle.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/voice-transcript.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const until = async fn => { const end = Date.now() + 15000; while (!fn()) { assert.ok(Date.now() < end, 'condition timeout'); await new Promise(r => setTimeout(r, 30)); } };
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth', { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => {
    localStorage.setItem('pi-locale', 'en');
    sessionStorage.setItem('robin:voice:engine-v2', 'boson'); // Exercise the explicitly retained Realtime transcript path.
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext(); await audio.resume();
      const source = audio.createOscillator(), gain = audio.createGain(), destination = audio.createMediaStreamDestination();
      gain.gain.value = 0; source.connect(gain); gain.connect(destination); source.start();
      const track = destination.stream.getAudioTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { stop(); void audio.close(); };
      return destination.stream;
    };
  });
  const cwd = '/tmp/voice-fixture', existing = 'voice-saved-fixture', fresh = 'voice-new-fixture';
  const rows = new Map([[existing, []], [fresh, []]]), attempts = [];
  let creates = 0, prompts = 0, failAfterCommit = false, blockSave;
  const info = id => ({ id, cwd, projectKey: cwd, projectRoot: cwd, path: `${cwd}/${id}.jsonl`, name: id,
    created: new Date().toISOString(), modified: new Date().toISOString(), messageCount: rows.get(id).length, firstMessage: 'Voice chat' });
  await context.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === '/api/robin/voice/realtime') return route.fulfill({ json: req.method() === 'GET' ? { configured: true } : { secret: 'bai-eph-fixture', expiresAt: Math.floor(Date.now() / 1000) + 60 } });
    if (path === '/api/agent/new') {
      creates++; assert.equal(req.postDataJSON().type, 'ensure_session');
      return route.fulfill({ json: { sessionId: fresh } });
    }
    if (path.startsWith('/api/agent/') && req.method() === 'POST') {
      const body = req.postDataJSON(), id = path.split('/').at(-1);
      if (body.type === 'prompt') prompts++;
      if (body.type === 'append_voice_transcript') {
        attempts.push({ id, ...body });
        if (blockSave) await blockSave;
        const list = rows.get(id); const previous = list.find(row => row.voiceTranscript.id === body.transcript.id);
        if (!previous) list.push({ role: body.transcript.role, content: body.transcript.role === 'user' ? body.transcript.text : [{ type: 'text', text: body.transcript.text }],
          timestamp: Date.now(), voiceTranscript: body.transcript, entryId: `entry-${list.length}` });
        if (failAfterCommit) { failAfterCommit = false; return route.fulfill({ status: 503, json: { error: 'Lost acknowledgment' } }); }
        return route.fulfill({ json: { success: true, data: { entryId: (previous ?? list.at(-1)).entryId } } });
      }
      return route.fulfill({ json: { success: true, data: {} } });
    }
    if (path === '/api/cwd/validate') return route.fulfill({ json: { cwd: req.postDataJSON().cwd } });
    if (path === '/api/sessions') return route.fulfill({ json: { sessions: [info(existing), ...(rows.get(fresh).length ? [info(fresh)] : [])], runningSessionIds: [], sessionListVersion: attempts.length } });
    if (path === '/api/sessions/ui-state') return route.fulfill({ json: { version: 1, revision: 0, sessions: {}, projects: {} } });
    const id = path.split('/').at(-1);
    if (path.startsWith('/api/sessions/') && rows.has(id)) {
      const list = rows.get(id);
      return route.fulfill({ json: { info: info(id), sessionId: id, leafId: list.at(-1)?.entryId ?? null, tree: [],
        context: { messages: list, entryIds: list.map(row => row.entryId), hasMore: false, thinkingLevel: 'off' }, toolNames: [], totalActiveMs: 0 } });
    }
    if (path === '/api/agent/running') return route.fulfill({ json: { runningSessionIds: [], sessionListVersion: attempts.length } });
    if (path === '/api/models') return route.fulfill({ json: { models: [], modelList: [] } });
    if (path === '/api/worktrees') return route.fulfill({ json: { worktrees: [], projectRoot: cwd, projectKey: cwd, currentWorktreePath: cwd } });
    if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"connected","isStreaming":false}\n\n' });
    return route.fulfill({ json: {} });
  });
  let socket;
  await context.routeWebSocket('wss://api.boson.ai/**', ws => {
    socket = ws;
    ws.onMessage(raw => { const event = JSON.parse(String(raw)); if (event.type === 'session.update') ws.send(JSON.stringify({ type: 'session.created', session: event.session })); });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const panel = page.locator('[data-robin-companion] dialog');
  const launch = async () => {
    await page.locator('.chat-input-shell [data-companion-launcher]').click();
    await panel.getByRole('status').filter({ hasText: 'Listening' }).waitFor();
    await panel.getByText('Captions save to the chat where you started voice.').waitFor();
  };
  const emit = event => socket.send(JSON.stringify(event));
  const turn = (n, done = true) => {
    emit({ type: 'input_audio_buffer.speech_started', item_id: `u-${n}` });
    emit({ type: 'input_audio_buffer.speech_stopped', item_id: `u-${n}` });
    emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: `u-${n}`, transcript: `Hello ${n}` });
    emit({ type: 'response.created', response: { id: `r-${n}` } });
    emit({ type: 'response.output_audio_transcript.delta', response_id: `r-${n}`, item_id: `a-${n}`, delta: `Reply ${n}` });
    emit({ type: 'response.output_audio.delta', response_id: `r-${n}`, item_id: `a-${n}`, content_index: 0, delta: '' });
    if (done) emit({ type: 'response.done', response: { id: `r-${n}`, status: 'completed' } });
  };
  await page.goto(`/?session=${existing}`); await launch();
  turn(1); await until(() => rows.get(existing).length === 2);
  turn(2); await until(() => rows.get(existing).length === 4);
  assert.equal(creates, 0); assert.equal(prompts, 0);
  assert.deepEqual(rows.get(existing).map(row => row.role), ['user', 'assistant', 'user', 'assistant']);
  // An uncertain save retains the exact ID; explicit retry does not duplicate a committed caption.
  failAfterCommit = true; turn(3);
  await panel.getByRole('alert').filter({ hasText: 'not been saved' }).waitFor();
  const beforeRetry = attempts.length;
  await page.waitForTimeout(200); assert.equal(attempts.length, beforeRetry, 'no automatic retry');
  await panel.getByRole('button', { name: 'Retry saving text' }).click();
  await until(() => rows.get(existing).length === 6);
  assert.equal(attempts[beforeRetry - 1].transcript.id, attempts[beforeRetry].transcript.id);
  assert.ok(attempts.every(request => request.id === existing));
  await panel.getByRole('button', { name: 'End conversation', exact: true }).click();
  await page.locator('.chat-main').getByText('Reply 3', { exact: true }).waitFor();
  await page.reload(); await page.locator('.chat-main').getByText('Reply 3', { exact: true }).waitFor();
  // A fresh composer initializes one session only; End still saves partial generated speech.
  await page.goto(`/?cwd=${encodeURIComponent(cwd)}`); await launch();
  assert.equal(creates, 0, 'opening voice alone does not create a session');
  turn(4, false); await until(() => rows.get(fresh).length === 1);
  await panel.getByRole('button', { name: 'End conversation', exact: true }).click();
  await until(() => rows.get(fresh).length === 2);
  assert.equal(rows.get(fresh)[1].voiceTranscript.interrupted, true);
  assert.equal(creates, 1); assert.equal(prompts, 0);
  await page.locator('.chat-main').getByText('Reply 4', { exact: true }).waitFor();
  await page.reload(); await page.locator('.chat-main').getByText('Reply 4', { exact: true }).waitFor();
  // A save in flight belongs to the launch-time chat even after selecting another chat.
  await page.setViewportSize({ width: 1440, height: 900 });
  let releaseSave; blockSave = new Promise(resolve => { releaseSave = resolve; });
  await launch(); const beforeSwitch = attempts.length; turn(5, false);
  await until(() => attempts.length > beforeSwitch);
  await panel.getByRole('button', { name: 'End conversation', exact: true }).click();
  await page.locator(`a.session-tree-main[href="?session=${existing}"]`).click();
  blockSave = null; releaseSave();
  await until(() => rows.get(fresh).length === 4);
  assert.ok(attempts.slice(beforeSwitch).every(request => request.id === fresh));
  assert.equal(rows.get(existing).length, 6);
  await page.locator('.chat-main').getByText('Reply 3', { exact: true }).waitFor();
  assert.equal(await page.locator('.chat-main').getByText('Reply 5', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, creates, prompts, saved: [...rows.values()].reduce((sum, list) => sum + list.length, 0), attempts: attempts.length }));
} finally { await browser.close(); }
