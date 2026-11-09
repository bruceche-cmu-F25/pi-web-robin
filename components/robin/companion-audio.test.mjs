import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from 'jiti';
const { UtteranceGate, utteranceWav } = await createJiti(import.meta.url, { alias: { '@': process.cwd() } }).import('./companion-audio.ts');
const frame = level => new Float32Array(1600).fill(level);
function fixture() {
  let starts = 0; const turns = [];
  const gate = new UtteranceGate(16000, () => starts++, value => turns.push(value));
  const push = (level, count) => { for (let i = 0; i < count; i++) gate.push(frame(level)); };
  return { gate, push, turns, starts: () => starts };
}
test('silence and short noise do not submit; a brief pause does not split a sentence', () => {
  const f = fixture(); f.push(0, 100); f.push(0.1, 1); f.push(0, 20);
  assert.equal(f.starts(), 0); assert.equal(f.turns.length, 0);
  f.push(0.1, 10); f.push(0, 10); f.push(0.1, 10);
  assert.equal(f.starts(), 1); assert.equal(f.turns.length, 0);
  f.push(0, 15); assert.equal(f.turns.length, 1); assert.equal(f.turns[0].limited, false);
});
test('a second turn reuses the gate, explicit finish flushes once, stop discards capture', () => {
  const f = fixture(); f.push(0.1, 3); f.gate.flush(); f.gate.flush();
  assert.equal(f.turns.length, 1); f.push(0.1, 3); f.gate.reset(); f.gate.flush();
  assert.equal(f.turns.length, 1); f.push(0.1, 3); f.push(0, 15); assert.equal(f.turns.length, 2);
});
test('duration cutoff is marked incomplete; PCM output is bounded WAV', async () => {
  const f = fixture(); f.push(0.1, 450);
  assert.equal(f.turns.length, 1); assert.equal(f.turns[0].limited, true);
  const wav = await utteranceWav(f.turns[0]);
  assert.equal(Buffer.from(wav).toString('ascii', 0, 4), 'RIFF');
  assert.equal(new DataView(wav).getUint32(24, true), 16000);
  await assert.rejects(utteranceWav({ samples: new Float32Array(0), sampleRate: 16000, limited: false }));
});
