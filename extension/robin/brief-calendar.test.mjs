import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectCalendarBrief } from './brief-calendar.ts';
import { BriefBudgetExhausted } from './brief-acquisition.ts';
const now = new Date('2026-10-30T10:00:00');
const scope = { day: '2026-10-30', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
const local = async () => ({ today: scope.day, events: [], google: { connected: true } });
const event = { id: 'fixture', summary: 'Synthetic calendar event', start: { dateTime: new Date('2026-10-30T11:00:00').toISOString() }, end: { dateTime: new Date('2026-10-30T12:00:00').toISOString() } };
const signal = () => new AbortController().signal;
test('fresh snapshot is bounded, honors enabled calendars and reports unfinished pages', async () => {
  let requests = 0, calls = 0;
  const result = await collectCalendarBrief(scope, signal(), { reserveRequest() { requests++; } }, {
    local, now: () => now, connected: () => true, token: async () => 'fixture-token',
    sources: () => [{ id: 'hidden', enabled: false }], fetch: async (url, init) => {
      calls++; assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
      assert.equal(new URL(url).searchParams.get('timeMax'), new Date('2026-10-31T00:00:00').toISOString());
      return Response.json({ items: [{ ...event, id: `fixture${calls}`, summary: `Synthetic event ${calls}` }], nextPageToken: `page${calls}` });
    },
  });
  assert.equal(requests, 3); assert.equal(calls, 2); assert.equal(result.coverage, 'partial'); assert.equal(result.items.length, 2);
});
test('account changes discard remote observations; exhausted budget retains explicit local-only coverage', async () => {
  let connected = true;
  const deps = { local, now: () => now, sources: () => [], connected: () => connected, token: async () => 'fixture', fetch: async () => { connected = false; return Response.json({ items: [event] }); } };
  const changed = await collectCalendarBrief(scope, signal(), { reserveRequest() {} }, deps);
  assert.equal(changed.items.length, 0); assert.equal(changed.coverage, 'partial');
  connected = true;
  const budget = await collectCalendarBrief(scope, signal(), { reserveRequest() { throw new BriefBudgetExhausted(); } }, deps);
  assert.equal(budget.coverage, 'partial'); assert.equal(budget.items.length, 0);
});
test('oversized responses and aborts cannot become complete calendar snapshots', async () => {
  const deps = { local, now: () => now, sources: () => [], connected: () => true, token: async () => 'fixture', fetch: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) };
  const result = await collectCalendarBrief(scope, signal(), { reserveRequest() {} }, deps);
  assert.equal(result.coverage, 'partial');
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(collectCalendarBrief(scope, stopped.signal, { reserveRequest() {} }, deps));
  for (const payload of [[], 'unexpected', 42]) {
    const malformed = await collectCalendarBrief(scope, signal(), { reserveRequest() {} }, { ...deps, fetch: async () => Response.json(payload) });
    assert.equal(malformed.coverage, 'partial', 'malformed success payload is not evidence of an empty calendar');
  }
  const differentZone = await collectCalendarBrief({ ...scope, timezone: scope.timezone === 'UTC' ? 'Pacific/Auckland' : 'UTC' }, signal(), { reserveRequest() { throw Error('must not reserve'); } }, deps);
  assert.equal(differentZone.coverage, 'unavailable');
});
