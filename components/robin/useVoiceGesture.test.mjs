import assert from 'node:assert/strict';
import test from 'node:test';
import { hookHarness, deferred, settle } from '../../scripts/react-hook-harness.mjs';

function setup(t, { granted = true, permission } = {}) {
  let now = 0, phase = 'idle', starts = 0, finishes = 0, cancels = 0;
  const window = new EventTarget(), timers = new Map();
  const target = { captured: false, setPointerCapture() { this.captured = true; }, hasPointerCapture() { return this.captured; }, releasePointerCapture() { this.captured = false; } };
  const harness = hookHarness(new URL('./useVoiceGesture.ts', import.meta.url), {}, {
    window, navigator: { permissions: { query: async () => ({ state: granted ? 'granted' : 'prompt' }) } },
    Date: { now: () => now }, setTimeout: fn => { const id = Symbol(); timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
  });
  const actions = {
    phase: () => phase,
    start: async () => { starts++; phase = 'permission'; if (permission) await permission.promise; phase = 'recording'; return true; },
    finish: () => { finishes++; phase = 'transcribing'; },
    cancel: () => { cancels++; phase = 'idle'; },
  };
  const render = () => harness.render(() => harness.exports.useVoiceGesture(actions));
  render(); t.after(() => harness.unmount());
  const event = (extra = {}) => ({ button: 0, isPrimary: true, pointerId: 1, clientY: 200, currentTarget: target, preventDefault() {}, ...extra });
  return { render, event, window, time(ms) { now += ms; for (const fn of timers.values()) fn(); timers.clear(); }, phase: () => phase, counts: () => ({ starts, finishes, cancels }) };
}

test('short tap latches, second tap commits once; trailing native clicks never restart capture', async t => {
  const s = setup(t); await settle();
  s.render().handlers.onPointerDown(s.event()); await settle();
  s.time(40); s.render().handlers.onPointerUp(s.event()); s.render().handlers.onClick();
  assert.equal(s.phase(), 'recording'); assert.equal(s.counts().finishes, 0);
  s.render().handlers.onPointerDown(s.event()); s.render().handlers.onPointerUp(s.event()); s.render().handlers.onClick();
  assert.deepEqual(s.counts(), { starts: 1, finishes: 1, cancels: 0 });
});
test('known permission: hold then release finishes; slide up cancels instead', async t => {
  const s = setup(t); await settle();
  s.render().handlers.onPointerDown(s.event()); await settle(); s.time(400);
  assert.equal(s.render().holding, true);
  s.render().handlers.onPointerUp(s.event()); assert.equal(s.counts().finishes, 1);
  s.render().cancel();
  s.render().handlers.onPointerDown(s.event()); await settle(); s.time(400);
  s.render().handlers.onPointerMove(s.event({ clientY: 100 }));
  assert.equal(s.render().cancelling, true);
  s.render().handlers.onPointerUp(s.event({ clientY: 100 }));
  assert.equal(s.counts().finishes, 1); assert.equal(s.phase(), 'idle');
});
test('first authorization cannot turn a release into a send, even after the prompt resolves', async t => {
  const permission = deferred(); const s = setup(t, { granted: false, permission }); await settle();
  s.render().handlers.onPointerDown(s.event()); s.time(1200);
  permission.resolve(); await settle();
  s.render().handlers.onPointerUp(s.event()); s.render().handlers.onClick();
  assert.equal(s.phase(), 'recording'); assert.equal(s.counts().finishes, 0);
});
test('release before a late permission grant latches; pointer cancellation never commits', async t => {
  const permission = deferred(); const s = setup(t, { permission }); await settle();
  s.render().handlers.onPointerDown(s.event()); s.time(900);
  s.render().handlers.onPointerUp(s.event()); s.render().handlers.onClick();
  permission.resolve(); await settle(); assert.equal(s.counts().finishes, 0);
  s.render().handlers.onPointerDown(s.event()); s.render().handlers.onPointerCancel();
  assert.equal(s.counts().finishes, 0); assert.equal(s.phase(), 'idle');
});
test('keyboard activation is equivalent; repeated keys and lost capture cannot submit twice', async t => {
  const s = setup(t); await settle();
  s.render().handlers.onClick(); await settle(); assert.equal(s.phase(), 'recording');
  let prevented = false;
  s.render().handlers.onKeyDown({ key: 'Enter', repeat: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  s.render().handlers.onClick(); assert.equal(s.counts().finishes, 1);
  s.render().handlers.onLostPointerCapture(); assert.equal(s.counts().cancels, 0);
});
test('a second pointer is ignored; losing the active pointer cancels', async t => {
  const s = setup(t); await settle();
  s.render().handlers.onPointerDown(s.event()); await settle();
  s.render().handlers.onPointerDown(s.event({ pointerId: 2, isPrimary: false }));
  s.render().handlers.onPointerUp(s.event({ pointerId: 2 }));
  assert.equal(s.counts().finishes, 0);
  s.render().handlers.onLostPointerCapture(); assert.equal(s.counts().cancels, 1);
});
