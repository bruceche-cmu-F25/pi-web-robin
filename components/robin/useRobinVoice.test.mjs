import assert from 'node:assert/strict';
import test from 'node:test';
import { hookHarness, deferred, settle } from '../../scripts/react-hook-harness.mjs';
import { voiceExcerpt } from '../../extension/robin/voice.ts';
function setup(t, { getUserMedia, fetchImpl } = {}) {
  const window = new EventTarget(), document = new EventTarget(); document.visibilityState = 'visible';
  const tracks = [], recorders = [], contexts = [], calls = [], drafts = [], revoked = [];
  function stream() {
    const track = { readyState: 'live', stop() { this.readyState = 'ended'; }, onended: null }; tracks.push(track);
    return { getTracks: () => [track] };
  }
  class Context { state = 'running'; constructor() { contexts.push(this); } resume() { return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); } }
  class Recorder {
    static isTypeSupported() { return true; }
    state = 'inactive'; mimeType = 'audio/webm';
    constructor() { recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['sample']) }); this.onstop?.(); }
  }
  Object.assign(window, { isSecureContext: true, MediaRecorder: Recorder, AudioContext: Context, OfflineAudioContext: Context });
  const audio = { src: '', plays: 0, pause() {}, removeAttribute() { this.src = ''; }, load() {}, async play() { this.plays++; } };
  const harness = hookHarness(new URL('./useRobinVoice.ts', import.meta.url), {
    '@/extension/robin/voice': { VOICE_SECONDS: 60, voiceExcerpt },
    './voice-audio': { recordingToWav: async () => new ArrayBuffer(100) },
  }, {
    window, document, navigator: { mediaDevices: { getUserMedia: getUserMedia ?? (async () => stream()) } },
    MediaRecorder: Recorder, AudioContext: Context, Blob, CustomEvent,
    URL: { createObjectURL: () => 'blob:voice', revokeObjectURL: url => revoked.push(url) },
    fetch: async (url, options) => { calls.push({ url, options }); return fetchImpl ? fetchImpl(url, options) : url.includes('transcribe') ? Response.json({ text: '不要删除。' }) : new Response('audio'); },
  });
  function render() { const voice = harness.render(() => harness.exports.useRobinVoice(text => drafts.push(text))); voice.audioRef.current = audio; return voice; }
  t.after(() => harness.unmount());
  return { render, harness, stream, tracks, contexts, recorders, calls, drafts, audio, document, window, revoked };
}

test('ending during the permission prompt releases a late microphone and never uploads', async t => {
  const permission = deferred(); const s = setup(t, { getUserMedia: () => permission.promise });
  const pending = s.render().start(true);
  assert.equal(s.render().phase, 'permission');
  s.render().end(); permission.resolve(s.stream()); await pending;
  assert.ok(s.tracks.every(track => track.readyState === 'ended'));
  assert.ok(s.contexts.every(context => context.state === 'closed'));
  assert.equal(s.calls.length, 0); assert.equal(s.render().talk, false);
});
test('dictation releases tracks before upload and only returns an editable draft', async t => {
  const s = setup(t); await s.render().start(false);
  assert.equal(s.render().phase, 'recording'); s.render().finish(); await settle();
  assert.ok(s.tracks.every(track => track.readyState === 'ended'));
  assert.deepEqual(s.drafts, ['不要删除。']); assert.equal(s.render().phase, 'review');
  s.render().prepareReply()('Done.'); await settle();
  assert.equal(s.calls.length, 1, 'dictation never enables automatic speech or assistant dispatch');
});
test('ending during recognition aborts the request and ignores late transcription', async t => {
  const pending = deferred(); const s = setup(t, { fetchImpl: () => pending.promise });
  await s.render().start(true); s.render().finish(); await settle();
  s.render().end(); assert.equal(s.calls[0].options.signal.aborted, true);
  pending.resolve(Response.json({ text: 'late instruction' })); await settle();
  assert.deepEqual(s.drafts, []); assert.equal(s.render().phase, 'idle');
});
test('reply consent is captured once at dispatch, speech uses only a short excerpt', async t => {
  const s = setup(t); await s.render().start(true); s.render().finish(); await settle();
  const reply = s.render().prepareReply(); reply('第一句。第二句。第三句。第四句。'); reply('duplicate.'); await settle();
  assert.equal(s.calls.length, 2);
  assert.deepEqual(JSON.parse(s.calls[1].options.body), { text: '第一句。第二句。第三句。' });
  assert.equal(s.audio.plays, 1); assert.equal(s.render().phase, 'speaking');
  s.render().stop(); assert.deepEqual(s.revoked, ['blob:voice']);
});
test('ending while Robin works suppresses its later reply without sending a cancel-task request', async t => {
  const s = setup(t); await s.render().start(true); s.render().finish(); await settle();
  const reply = s.render().prepareReply(); s.render().end(); reply('Do not speak this.'); await settle();
  assert.equal(s.calls.length, 1); assert.equal(s.audio.plays, 0);
});
test('unmount aborts pending synthesis, invalidates late audio and releases capture', async t => {
  const pending = deferred(); const s = setup(t, { fetchImpl: url => url.includes('speak') ? pending.promise : Promise.resolve(Response.json({ text: 'hello' })) });
  await s.render().start(true); s.render().finish(); await settle();
  s.render().prepareReply()('Hello.'); await settle();
  s.harness.unmount(); assert.equal(s.calls[1].options.signal.aborted, true);
  pending.resolve(new Response('late audio')); await settle();
  assert.equal(s.audio.plays, 0); assert.ok(s.tracks.every(track => track.readyState === 'ended'));
});
test('page backgrounding ends capture and cancels all automatic voice consent', async t => {
  const s = setup(t); await s.render().start(true);
  s.document.visibilityState = 'hidden'; s.document.dispatchEvent(new Event('visibilitychange'));
  assert.ok(s.tracks.every(track => track.readyState === 'ended'));
  assert.equal(s.render().talk, false); assert.equal(s.calls.length, 0);
});
test('sending while recording discards capture rather than submitting unseen recognition', async t => {
  const s = setup(t); await s.render().start(true); s.render().prepareReply(); await settle();
  assert.equal(s.calls.length, 0); assert.equal(s.render().phase, 'waiting');
  assert.ok(s.tracks.every(track => track.readyState === 'ended'));
});
