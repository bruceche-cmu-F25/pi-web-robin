import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { localVoiceConfig } from './local-voice.ts';
import { transcribeVoice, voiceReadiness } from './voice-domain.ts';

const dir = mkdtempSync(join(tmpdir(), 'robin-local-voice-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const command = join(dir, 'whisper-cli');
writeFileSync(command, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
const model = value('--model'), input = value('--file'), output = value('--output-file');
assert.equal(value('--language'), 'auto');
assert.equal(value('--max-context'), '0');
assert.equal(process.env.ROBIN_VOICE_API_KEY, undefined);
assert.equal(process.env.PI_WEB_PASSWORD, undefined);
assert.equal(fs.statSync(path.dirname(input)).mode & 0o777, 0o700);
assert.equal(fs.statSync(input).mode & 0o777, 0o600);
assert.equal(fs.readFileSync(input).subarray(0, 4).toString(), 'RIFF');
fs.writeFileSync(model + '.started', JSON.stringify({ pid: process.pid, input }));
const mode = fs.readFileSync(model, 'utf8');
if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'fail') { console.error('private-transcript-secret'); process.exit(1); }
else if (mode !== 'missing') fs.writeFileSync(output + '.txt', mode === 'huge' ? 'x'.repeat(64001) : mode === 'empty' ? '  ' : '明天，不是今天。');
`, { mode: 0o700 });
let index = 0;
function config(mode = 'ok') {
  const model = join(dir, `model-${index++}.bin`); writeFileSync(model, mode);
  return { ROBIN_VOICE_WHISPER_BIN: command, ROBIN_VOICE_WHISPER_MODEL: model, ROBIN_VOICE_API_KEY: 'private-key', PI_WEB_PASSWORD: 'private-password' };
}
function wav() {
  const b = Buffer.alloc(32044); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40); return b;
}
function run(env, signal = new AbortController().signal) {
  return transcribeVoice(wav(), signal, { env, fetch: () => assert.fail('ASR must never call HTTP') });
}
function assertClean(env) {
  const { input } = JSON.parse(readFileSync(env.ROBIN_VOICE_WHISPER_MODEL + '.started'));
  assert.equal(existsSync(dirname(input)), false, 'temporary audio and transcript removed');
}

test('local dictation needs no cloud key; sanitized child args/env, private temp files and cleanup', async () => {
  const env = config(); delete env.ROBIN_VOICE_API_KEY;
  assert.equal(localVoiceConfig(env).ready, true);
  assert.equal(await run(env), '明天，不是今天。'); assertClean(env);
  const withKeys = config(); assert.equal(await run(withKeys), '明天，不是今天。'); assertClean(withKeys);
});
test('readiness separates local ASR from optional TTS and reveals no paths', () => {
  const saved = { ...process.env }, env = config();
  try {
    delete process.env.ROBIN_VOICE_API_KEY; delete process.env.DASHSCOPE_API_KEY;
    process.env.ROBIN_VOICE_WHISPER_BIN = env.ROBIN_VOICE_WHISPER_BIN;
    process.env.ROBIN_VOICE_WHISPER_MODEL = env.ROBIN_VOICE_WHISPER_MODEL;
    assert.deepEqual(voiceReadiness(), { configured: true, ttsConfigured: false, asrModel: 'whisper.cpp (local)', ttsModel: 'qwen3-tts-flash' });
    process.env.ROBIN_VOICE_WHISPER_MODEL = '/missing/model.bin';
    assert.equal(voiceReadiness().configured, false);
  } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
});
test('missing engine/model fails closed, including explicit invalid overrides', async () => {
  for (const env of [{ ...config(), ROBIN_VOICE_WHISPER_BIN: '/missing/executable' }, { ...config(), ROBIN_VOICE_WHISPER_MODEL: '/missing/model.bin' }]) {
    assert.equal(localVoiceConfig(env).ready, false);
    await assert.rejects(run(env), { code: 'setup' });
  }
});
test('failed, absent, empty and oversized outputs have safe errors and always clean up', async () => {
  for (const mode of ['fail', 'missing', 'empty', 'huge']) {
    const env = config(mode);
    await assert.rejects(run(env), { code: mode === 'empty' ? 'empty' : 'local', message: mode === 'empty' ? 'empty' : 'local' });
    assertClean(env);
  }
  // Executable exists but cannot spawn: error/close must release the concurrency slot.
  const invalid = join(dir, 'bad-executable'); writeFileSync(invalid, '#!/missing/interpreter\n', { mode: 0o700 });
  await assert.rejects(run({ ...config(), ROBIN_VOICE_WHISPER_BIN: invalid }), { code: 'local' });
  assert.equal(await run(config()), '明天，不是今天。');
});
test('abort actually kills inference before releasing the slot; busy/pre-abort do not start children', async () => {
  const env = config('hang'), controller = new AbortController();
  const pending = assert.rejects(run(env, controller.signal), { code: 'cancelled' });
  try {
    for (let i = 0; i < 200 && !existsSync(env.ROBIN_VOICE_WHISPER_MODEL + '.started'); i++) await delay(10);
    const { pid } = JSON.parse(readFileSync(env.ROBIN_VOICE_WHISPER_MODEL + '.started'));
    const busy = config(); await assert.rejects(run(busy), { code: 'busy' });
    assert.equal(existsSync(busy.ROBIN_VOICE_WHISPER_MODEL + '.started'), false);
    controller.abort(); await pending;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); assertClean(env);
    const aborted = config(); await assert.rejects(run(aborted, AbortSignal.abort()), { code: 'cancelled' });
    assert.equal(existsSync(aborted.ROBIN_VOICE_WHISPER_MODEL + '.started'), false);
    assert.equal(await run(config()), '明天，不是今天。');
  } finally { controller.abort(); await pending; }
});
