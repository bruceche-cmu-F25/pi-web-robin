import assert from 'node:assert/strict';
import test from 'node:test';
import { hookHarness } from '../../scripts/react-hook-harness.mjs';

test('digital silence is rejected before upload; audible PCM retains canonical WAV framing', async () => {
  let samples = new Float32Array(16_000);
  class Offline {
    createBufferSource() { return { connect() {}, start() {} }; }
    async startRendering() { return { getChannelData: () => samples }; }
  }
  const { exports: audio } = hookHarness(new URL('./voice-audio.ts', import.meta.url), {
    '@/extension/robin/voice': { VOICE_SECONDS: 60, VOICE_SAMPLE_RATE: 16_000 },
  }, { OfflineAudioContext: Offline });
  const context = { decodeAudioData: async () => ({ length: 16_000, duration: 1 }) };
  const blob = new Blob(['fixture']);
  await assert.rejects(audio.recordingToWav(blob, context), /empty/);
  samples = Float32Array.from({ length: 16_000 }, (_, i) => Math.sin(i / 10) * 0.1);
  const wav = await audio.recordingToWav(blob, context);
  assert.equal(wav.byteLength, 44 + 16_000 * 2);
  assert.equal(new DataView(wav).getUint32(24, true), 16_000);
});
