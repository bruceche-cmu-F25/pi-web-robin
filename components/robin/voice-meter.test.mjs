import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceLevel, smoothVoiceLevel } from './voice-meter.ts';

const tone = amplitude => Float32Array.from({ length: 1024 }, (_, i) => Math.sin(i / 8) * amplitude);
test('silence rests; low-volume speech remains visible; loud input is bounded', () => {
  assert.equal(voiceLevel(new Float32Array(1024)), 0);
  assert.equal(voiceLevel(new Float32Array()), 0);
  assert.equal(voiceLevel(tone(0.0001)), 0);
  assert.ok(voiceLevel(tone(0.01)) > 0.4);
  assert.ok(voiceLevel(tone(0.1)) > voiceLevel(tone(0.01)));
  assert.equal(voiceLevel(tone(1)), 1);
  assert.equal(voiceLevel(new Float32Array([NaN])), 0);
});
test('envelope has no overshoot, responds faster than it releases, then settles to rest', () => {
  assert.equal(smoothVoiceLevel(0, 1, 0), 0);
  const rise = smoothVoiceLevel(0, 1, 120);
  const falling = smoothVoiceLevel(1, 0, 120);
  assert.ok(rise > 1 - falling);
  assert.ok(rise > 0 && rise < 1);
  let level = 1;
  for (let i = 0; i < 120; i++) level = smoothVoiceLevel(level, 0, 16.67);
  assert.equal(level, 0);
  const single = smoothVoiceLevel(0, 1, 100);
  let stepped = 0;
  for (let i = 0; i < 10; i++) stepped = smoothVoiceLevel(stepped, 1, 10);
  assert.ok(Math.abs(single - stepped) < 0.00001, 'same envelope at different frame rates');
});
