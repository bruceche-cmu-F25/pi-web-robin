import assert from 'node:assert/strict';
import test from 'node:test';
import { collectStoredBriefSource } from './brief-sources.ts';
import { composeShadow, validateBriefInput } from './brief.ts';
const now = new Date('2026-10-30T15:00:00Z');
const scope = { day: '2026-10-30', timezone: 'America/Los_Angeles' };
const signal = new AbortController().signal;
const story = { key: 'public-fixture', title: 'A prior-week release', what: 'Stored editorial summary', eventDate: '2026-10-23',
  source: { url: 'https://example.com/release', publishedOn: '2026-10-23', quote: 'A preserved original passage, not a newly verified claim.', checkedAt: '2026-10-26T12:00:00Z' } };
function readers() {
  return {
    now: () => now,
    mail: () => ({ day: scope.day, reviewedAt: now.toISOString(), items: [
      { id: 'action', subject: 'Interview invitation', summary: 'Choose a time', snippet: 'Select a slot', triage: 'act', action: 'none' },
      { id: 'handled', subject: 'Already handled', summary: 'Done', triage: 'act', action: 'none', done: true },
      { id: 'tracked', subject: 'Already tracked', summary: 'Existing task', triage: 'tracked', action: 'todo' },
    ] }),
    calendar: async () => ({ today: scope.day, google: { connected: true, error: 'Local only' }, events: [
      { id: 'today', title: 'Local appointment', date: scope.day, start: '10:00', end: '11:00' },
      { id: 'tomorrow', title: 'Tomorrow', date: '2026-10-31' },
    ] }),
    todos: () => ({ today: scope.day, todos: [
      { id: 'task', title: 'Real task', due: scope.day, done: false },
      { id: 'done', title: 'Completed', due: scope.day, done: true },
      { id: 'archived', title: 'Archived', due: scope.day, done: false, archivedAt: now.toISOString() },
      { id: 'later', title: 'Undated intention', done: false },
    ] }),
    world: () => ({ today: scope.day, edition: { week: '2026-10-26', from: '2026-10-19', through: '2026-10-25', slots: [{ date: scope.day, story }] } }),
  };
}
test('four stored adapters preserve provenance, dates and original wording without writing source records', async () => {
  const deps = readers(), baseline = JSON.stringify([deps.mail(), await deps.calendar(), deps.todos(), deps.world()]);
  const inputs = await Promise.all(['mail', 'calendar', 'todos', 'world'].map(source => collectStoredBriefSource(source, scope, signal, deps)));
  const result = composeShadow(inputs);
  assert.deepEqual(result.items.map(i => i.id), ['mail:action', 'calendar:today', 'todo:task', 'world:2026-10-26:public-fixture']);
  assert.equal(inputs[1].coverage, 'partial'); assert.match(inputs[1].detail, /Google/);
  assert.equal(result.items[0].evidence.kind, 'stored-review');
  assert.equal(result.items.at(-1).publishedOn, '2026-10-23'); assert.equal(result.items.at(-1).evidence.kind, 'legacy-passage');
  assert.match(inputs[3].detail, /not today's news/);
  assert.equal(JSON.stringify([deps.mail(), await deps.calendar(), deps.todos(), deps.world()]), baseline);
});
test('stale mail, missing weekly stories and source gaps never become an all-clear', async () => {
  const deps = readers(); deps.mail = () => ({ day: '2026-10-29', reviewedAt: now.toISOString(), items: [] });
  deps.world = () => ({ today: scope.day, edition: null });
  const mail = await collectStoredBriefSource('mail', scope, signal, deps);
  const world = await collectStoredBriefSource('world', scope, signal, deps);
  assert.equal(mail.coverage, 'stale'); assert.equal(world.coverage, 'unavailable');
  assert.deepEqual(mail.items, []);
  const old = await collectStoredBriefSource('todos', { ...scope, day: '2026-10-29' }, signal, deps);
  assert.equal(old.coverage, 'unavailable');
});
test('validation rejects unsafe links, duplicate IDs, invented source identities and unbounded output', async () => {
  const input = await collectStoredBriefSource('mail', scope, signal, readers());
  for (const href of ['javascript:alert(1)', '//evil.example/', '/\\evil.example', 'https://user:secret@example.com/']) {
    assert.throws(() => validateBriefInput({ ...input, items: [{ ...input.items[0], href }] }, 'mail'), /Invalid/);
  }
  assert.throws(() => validateBriefInput({ ...input, items: [input.items[0], input.items[0]] }, 'mail'), /Invalid/);
  assert.throws(() => validateBriefInput({ ...input, source: 'world' }, 'mail'), /Invalid/);
  assert.throws(() => validateBriefInput({ ...input, items: Array(201).fill(input.items[0]) }, 'mail'), /Invalid/);
});
