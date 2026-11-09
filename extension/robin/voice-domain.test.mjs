import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySettingsSection, clearSettingsSection } from './settings.ts';
const dir = mkdtempSync(join(tmpdir(), 'robin-voice-domain-'));
process.env.ROBIN_DATA_DIR = dir;
after(() => rmSync(dir, { recursive: true, force: true }));
import { transcribeVoice, synthesizeVoice, validateVoiceWav, voiceReadiness } from './voice-domain.ts';
import { voiceExcerpt } from './voice.ts';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { pcmVoiceWav } = await jiti.import('../../components/robin/voice-audio.ts');
const bytes = () => new Uint8Array(pcmVoiceWav(new Float32Array(16_000)));
const signal = () => new AbortController().signal;
const env = { ROBIN_VOICE_API_KEY: 'private-test-key' };
const tts = (url = 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav?Signature=private') => Response.json({ output: { audio: { url } } });

test('canonical WAV validation rejects malformed, stereo and oversized input before inference', async () => {
  validateVoiceWav(bytes());
  for (const input of [new Uint8Array(), new Uint8Array(2_000_000), bytes().fill(0), (() => { const b = bytes(); b[22] = 2; return b; })()]) {
    await assert.rejects(transcribeVoice(input, signal(), { env, fetch: () => assert.fail('invalid WAV must not leave server') }), e => ['audio'].includes(e.code));
  }
});
test('a cloud key cannot substitute for missing local ASR; no cloud fallback', async () => {
  await assert.rejects(transcribeVoice(bytes(), signal(), { env: { ...env, ROBIN_VOICE_WHISPER_BIN: '/missing/whisper-cli' }, fetch: () => assert.fail() }), { code: 'setup' });
});
test('missing TTS key and invalid origins fail closed without HTTP', async () => {
  for (const config of [{}, { ...env, ROBIN_VOICE_ORIGIN: 'http://localhost:30141' }, { ...env, ROBIN_VOICE_ORIGIN: 'https://dashscope.aliyuncs.com.attacker.test' }]) {
    await assert.rejects(synthesizeVoice('你好。', signal(), { env: config, fetch: () => assert.fail() }), { code: 'setup' });
  }
});
test('TTS returns bounded WAV through TLS; the signed download gets no API credential', async () => {
  let calls = 0;
  const result = await synthesizeVoice('你好。', signal(), { env, fetch: async (url, options) => {
    calls++;
    if (calls === 1) {
      assert.equal(JSON.parse(options.body).model, 'qwen3-tts-flash');
      assert.equal(JSON.parse(options.body).input.text, '你好。');
      assert.equal(options.headers.Authorization, 'Bearer private-test-key');
      return tts();
    }
    assert.equal(new URL(url).protocol, 'https:');
    assert.equal(options.headers, undefined);
    assert.equal(options.redirect, 'error');
    return new Response(bytes());
  } });
  assert.deepEqual(result, bytes()); assert.equal(calls, 2);
});
test('SSRF and redirects are not accepted as TTS downloads', async () => {
  for (const url of ['http://127.0.0.1/private.wav', 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.attacker.test/a.wav', 'https://user:secret@dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav', 'file:///a.wav']) {
    let calls = 0;
    await assert.rejects(synthesizeVoice('hello', signal(), { env, fetch: async () => { calls++; return tts(url); } }), { code: 'provider' });
    assert.equal(calls, 1);
  }
});
test('raw provider errors are not exposed or retried', async () => {
  for (const factory of [() => new Response('private-test-key', { status: 401 }), () => new Response('private-test-key'), () => Response.json({}), () => new Response('x'.repeat(300_000))]) {
    let calls = 0;
    await assert.rejects(synthesizeVoice('hello', signal(), { env, fetch: async () => { calls++; return factory(); } }), error => error.code === 'provider' && !error.message.includes('private-test-key'));
    assert.equal(calls, 1);
  }
});
test('TTS refuses empty/long text and non-WAV or excessive audio', async () => {
  for (const text of ['', 'a'.repeat(601), null, {}]) await assert.rejects(synthesizeVoice(text, signal(), { env, fetch: () => assert.fail() }), { code: 'text' });
  for (const payload of [new Uint8Array(20), new Uint8Array(9 * 1024 * 1024)]) {
    let calls = 0;
    await assert.rejects(synthesizeVoice('hello', signal(), { env, fetch: async () => ++calls === 1 ? tts() : new Response(payload) }), { code: 'provider' });
  }
});
test('concurrent paid requests are bounded and slots are released on cancel', async () => {
  const controllers = [new AbortController(), new AbortController()];
  const fetch = async (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  const pending = controllers.map(c => assert.rejects(synthesizeVoice('hello', c.signal, { env, fetch }), { code: 'cancelled' }));
  await assert.rejects(synthesizeVoice('hello', signal(), { env, fetch: () => assert.fail() }), { code: 'busy' });
  controllers.forEach(c => c.abort()); await Promise.all(pending);
  await assert.rejects(synthesizeVoice('hello', AbortSignal.abort(), { env, fetch: () => assert.fail() }), { code: 'cancelled' });
});
test('Boson uses its fixed endpoint and documented request, with no Alibaba fallback', async () => {
  let calls = 0;
  const result = await synthesizeVoice('你好。 Hello.', signal(), { env: { ...env, BOSON_API_KEY: 'bai-secret' }, fetch: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.boson.ai/v1/audio/speech');
    assert.equal(options.headers.Authorization, 'Bearer bai-secret');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { model: 'higgs-tts-3', input: '你好。 Hello.', voice: 'oliver', response_format: 'wav', stream: false });
    return new Response(bytes());
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, bytes());
});
test('a settings save and removal change synthesis without restart', async () => {
  try {
    applySettingsSection('boson', { apiKey: 'bai-saved' });
    assert.equal(voiceReadiness().ttsConfigured, true);
    assert.equal(voiceReadiness().ttsModel, 'higgs-tts-3');
    assert.ok(!JSON.stringify(voiceReadiness()).includes('bai-saved'));
    await synthesizeVoice('hello', signal(), { env: { BOSON_API_KEY: 'bai-env' }, fetch: async (_, options) => {
      assert.equal(options.headers.Authorization, 'Bearer bai-saved');
      return new Response(bytes());
    } });
  } finally { clearSettingsSection('boson'); }
  await assert.rejects(synthesizeVoice('hello', signal(), { env: {}, fetch: () => assert.fail() }), { code: 'setup' });
});
test('Boson errors, redirects, JSON and oversized audio are bounded, masked and never retried', async () => {
  for (const response of [new Response('bai-secret', { status: 401 }), new Response('', { status: 429 }),
    new Response('', { status: 302, headers: { Location: 'https://attacker.test/' } }),
    Response.json({ audio: 'unexpected' }), new Response(new Uint8Array(8 * 1024 * 1024 + 1))]) {
    let calls = 0;
    await assert.rejects(synthesizeVoice('hello', signal(), { env: { ...env, BOSON_API_KEY: 'bai-secret' }, fetch: async () => {
      calls++; return response;
    } }), error => error.code === 'provider' && !error.message.includes('bai-secret'));
    assert.equal(calls, 1);
  }
});
test('Boson shares concurrency and cancellation bounds with legacy speech', async () => {
  const controllers = [new AbortController(), new AbortController()];
  const pending = controllers.map(c => assert.rejects(synthesizeVoice('hello', c.signal, {
    env: { BOSON_API_KEY: 'bai-test' }, fetch: async (_, options) => new Promise((_, reject) =>
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })),
  }), { code: 'cancelled' }));
  await assert.rejects(synthesizeVoice('hello', signal(), { env, fetch: () => assert.fail() }), { code: 'busy' });
  controllers.forEach(c => c.abort()); await Promise.all(pending);
});
test('spoken excerpts strip code and tables, preserve negation and never split an overlong sentence', () => {
  assert.equal(voiceExcerpt('**不要删除。** 先备份！然后确认？第四句。'), '不要删除。 先备份！然后确认？');
  assert.equal(voiceExcerpt('```js\nsecret()\n```\n| A | B |\n[查看文档](https://example.test)\n不运行 `rm -rf`。'), '查看文档 不运行 。');
  assert.equal(voiceExcerpt('a'.repeat(601)), '');
  assert.equal(voiceExcerpt('```unfinished'), '');
});
