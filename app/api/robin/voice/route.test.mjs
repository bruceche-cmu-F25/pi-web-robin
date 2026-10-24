import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { createJiti } from 'jiti';
const dir = mkdtempSync(join(tmpdir(), 'robin-voice-route-'));
const stub = join(dir, 'voice.mjs');
writeFileSync(stub, `
export class VoiceError extends Error { constructor(code, status=400) { super(code); this.code=code; this.status=status; } }
export const voiceReadiness = () => ({ configured: true, ttsConfigured: false, asrModel: 'whisper.cpp (local)', ttsModel: 'qwen3-tts-flash' });
export const transcribeVoice = (...args) => globalThis.__voiceRoute.transcribe(...args);
export const synthesizeVoice = (...args) => globalThis.__voiceRoute.speak(...args);
`);
const jiti = createJiti(import.meta.url, { alias: { '@/extension/robin/voice-domain': stub, '@': process.cwd() }, moduleCache: false });
const { GET, POST } = await jiti.import('./route.ts');
after(() => { delete globalThis.__voiceRoute; rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { globalThis.__voiceRoute = { transcribe: () => assert.fail('unexpected model call'), speak: () => assert.fail('unexpected model call') }; });
const request = (op, body, type = 'audio/wav', extra = {}) => new Request(`http://localhost:30141/api/robin/voice?op=${op}`, {
  method: 'POST', headers: { host: 'localhost:30141', 'content-type': type, ...extra }, body,
});
test('readiness reveals no credentials and creates no model turn', async () => {
  const result = await GET(new Request('http://localhost:30141/api/robin/voice', { headers: { host: 'localhost:30141' } }));
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await result.json(), { configured: true, ttsConfigured: false, asrModel: 'whisper.cpp (local)', ttsModel: 'qwen3-tts-flash' });
});
test('host/origin, content-type, unknown operations and upload bounds fail before a model call', async () => {
  assert.equal((await POST(request('transcribe', 'audio', 'audio/wav', { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await POST(request('transcribe', 'audio', 'text/plain'))).status, 415);
  assert.equal((await POST(request('speak', '{}', 'text/plain'))).status, 415);
  assert.equal((await POST(request('unknown', 'audio'))).status, 400);
  assert.equal((await POST(request('transcribe', new Uint8Array(2_000_000)))).status, 413);
  assert.equal((await POST(request('speak', 'x'.repeat(9_000), 'application/json'))).status, 413);
});
test('ASR returns only recognized text and preserves the request cancellation signal', async () => {
  const req = request('transcribe', new Uint8Array([1, 2, 3]));
  globalThis.__voiceRoute.transcribe = async (bytes, signal) => {
    assert.deepEqual([...bytes], [1, 2, 3]); assert.equal(signal, req.signal); return '不要删除。';
  };
  const result = await POST(req);
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { text: '不要删除。' });
});
test('TTS returns audio without caching or provider URLs', async () => {
  globalThis.__voiceRoute.speak = async text => { assert.equal(text, 'Hello.'); return new Uint8Array([1, 2, 3]); };
  const result = await POST(request('speak', JSON.stringify({ text: 'Hello.' }), 'application/json'));
  assert.equal(result.headers.get('content-type'), 'audio/wav');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [1, 2, 3]);
});
test('unexpected implementation errors never echo secrets or transcript data', async () => {
  globalThis.__voiceRoute.transcribe = async () => { throw new Error('private-key-and-audio'); };
  const result = await POST(request('transcribe', new Uint8Array([1])));
  assert.deepEqual(await result.json(), { code: 'request', error: 'request' });
});
