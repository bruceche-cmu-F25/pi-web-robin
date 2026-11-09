import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, test } from 'node:test';
import { runMailBriefTick } from './brief-mail-runner.ts';
import { initializeBriefPipeline } from '../extension/robin/brief-domain.ts';
import { briefOwnsDay, briefOwnsMailDay, briefDeliveryReceipts } from '../extension/robin/brief-delivery-domain.ts';
import { dueMailWindow } from '../extension/robin/brief-schedule.ts';
import { withBriefStore } from '../extension/robin/brief-store.ts';
const oldRoot = process.env.ROBIN_DATA_DIR, oldTZ = process.env.TZ;
let root, now, collected, sent;
const day = '2026-11-02', accountKey = createHash('sha256').update('fixture@example.test').digest('hex');
const env = { ROBIN_BRIEF_ENABLED: '1', ROBIN_BRIEF_ALLOW_PRIVATE_MODEL: '1', ROBIN_BRIEF_REPLACE_LEGACY: '1', ROBIN_BRIEF_MODE: 'mail', ROBIN_BRIEF_MORNING_DAILY: '1', ROBIN_BRIEF_START: day, ROBIN_BRIEF_START_AT: '2026-11-02T16:00:00Z' };
beforeEach(() => { process.env.TZ = 'America/Los_Angeles'; root = mkdtempSync(join(tmpdir(), 'mail-slots-')); process.env.ROBIN_DATA_DIR = root; initializeBriefPipeline(); now = Date.parse(env.ROBIN_BRIEF_START_AT); collected = 0; sent = []; });
afterEach(() => { rmSync(root, { recursive: true, force: true }); for (const [k,v] of [['ROBIN_DATA_DIR',oldRoot],['TZ',oldTZ]]) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
function deps(extra = {}) { return { now: () => now, env, allowed: () => true, legacyConsumed: () => false, subscriptionCount: async () => 1,
  collect: source => {
    if (source !== 'mail') return { source, coverage: 'ready', observedAt: new Date(now).toISOString(), detail: 'Not requested', items: [] };
    collected++; return { source, coverage: 'ready', observedAt: new Date(now).toISOString(), detail: 'fixture', items: [],
      mailReport: { from: '2026-11-02T02:00:00Z', to: new Date(now).toISOString(), accountKey, total: 0, reviewed: 0, failed: 0, messages: [] },
      mailEditorial: { headline: '0封邮件，0封已审阅', items: [], consideredIds: [], omittedCount: 0 } };
  }, send: async note => { sent.push(note); return { accepted: 1, failed: 0, expired: 0 }; }, ...extra }; }
test('08:00 and 18:00 have independent editions/receipts; retries do not recollect; agenda is not owned', async () => {
  const d = deps(), signal = new AbortController().signal;
  assert.equal((await runMailBriefTick(day, signal, d)).status, 'accepted');
  await runMailBriefTick(day, signal, d); assert.equal(collected, 1); assert.equal(sent.length, 1);
  now += 10 * 3600_000;
  assert.equal((await runMailBriefTick(day, signal, d)).status, 'accepted');
  assert.equal(collected, 2); assert.equal(sent.length, 2); assert.notEqual(sent[0].url, sent[1].url);
  assert.match(sent[0].title, /每日简报/); assert.match(sent[1].title, /晚报/);
  assert.equal(briefDeliveryReceipts(now).length, 2);
  assert.equal(briefOwnsDay({ day, timezone: 'America/Los_Angeles' }), true, 'combined morning edition owns the old agenda slot');
  assert.equal(briefOwnsMailDay({ day, timezone: 'America/Los_Angeles' }), true);
  const state = withBriefStore(db => JSON.parse(db.prepare("SELECT payload FROM brief_source_state WHERE source_key = ?").get(`mail:coverage-v2:${accountKey}`).payload));
  assert.equal(state.to, new Date(now).toISOString());
});
test('without the new opt-in flag, the existing morning mail-only schedule and agenda ownership are unchanged', async () => {
  const d = deps({ env: { ...env, ROBIN_BRIEF_MORNING_DAILY: '0' } });
  assert.equal((await runMailBriefTick(day, new AbortController().signal, d)).status, 'accepted');
  assert.match(sent[0].title, /邮箱早报/);
  assert.equal(briefOwnsDay({ day, timezone: 'America/Los_Angeles' }), false);
});
test('morning automatically includes saved tasks, calendar and public sources without another model call', async () => {
  const signal = new AbortController().signal;
  const seen = [];
  const d = deps({ collect: source => {
    seen.push(source);
    if (source === 'mail') return deps().collect(source);
    const record = source === 'todos' ? { id: 'todo:one', source, section: 'tasks', title: 'Submit application', summary: '2026-11-02', due: day,
      href: '/dashboard?view=todos&todo=one', evidence: { kind: 'record', reference: 'one' } }
      : source === 'calendar' ? { id: 'calendar:one', source, section: 'schedule', title: 'Interview', summary: '10:00', eventDate: day,
        href: '/dashboard?view=calendar', evidence: { kind: 'record', reference: 'one' } }
      : { id: 'world:one', source, section: 'world', title: 'A publisher announcement', summary: 'Last week', publishedOn: day,
        href: 'https://example.com/news', evidence: { kind: 'legacy-passage', reference: 'one', quote: 'A publisher announcement' } };
    return { source, coverage: 'ready', observedAt: new Date(now).toISOString(), detail: 'Fixture', items: [record] };
  } });
  await runMailBriefTick(day, signal, d);
  assert.deepEqual(seen, ['calendar', 'world', 'todos', 'mail']);
  const edition = withBriefStore(db => JSON.parse(db.prepare('SELECT payload FROM brief_editions').get().payload));
  assert.equal(edition.kind, 'daily'); assert.equal(edition.editorial.items[0].actionable, true);
  assert.equal(edition.editorial.items.at(-1).section, 'world'); assert.match(sent[0].body, /Submit application/);
  assert.equal(edition.mailReport.total, 0); assert.equal(edition.coverage.length, 4);
});
test('disabled, before-first-boundary, no subscription and legacy-consumed slots never generate', async () => {
  const signal = new AbortController().signal;
  now--; assert.equal((await runMailBriefTick(day, signal, deps())).status, 'disabled-or-not-due'); now++;
  assert.equal((await runMailBriefTick(day, signal, deps({ subscriptionCount: async () => 0 }))).status, 'no-subscribers');
  assert.equal((await runMailBriefTick(day, signal, deps({ legacyConsumed: () => true }))).status, 'legacy-consumed');
  assert.equal((await runMailBriefTick(day, signal, deps({ env: {} }))).status, 'disabled-or-not-due'); assert.equal(collected, 0);
});
test('uncertain sends neither advance coverage nor automatically resend', async () => {
  const d = deps({ send: async () => { sent.push('unknown'); throw Error('unknown transport result'); } }), signal = new AbortController().signal;
  assert.equal((await runMailBriefTick(day, signal, d)).status, 'uncertain'); await runMailBriefTick(day, signal, d);
  assert.equal(sent.length, 1); assert.equal(collected, 1);
  assert.equal(withBriefStore(db => db.prepare("SELECT 1 FROM brief_source_state WHERE source_key = ?").get(`mail:coverage-v2:${accountKey}`)), undefined);
});
test('a valid legacy OAuth grant without a cached email verifies profile before send, not on settled polls', async () => {
  writeFileSync(join(root,'google.json'), JSON.stringify({ refreshToken: 'fixture-refresh', accessToken: 'fixture-access', accessTokenExpiresAt: Date.now()+3600_000, connectedAt: new Date().toISOString() }));
  writeFileSync(join(root,'secrets.json'), JSON.stringify({ notifications: { channel: 'push' } }));
  const previousFetch = globalThis.fetch; let profiles = 0;
  globalThis.fetch = async url => { assert.equal(url,'https://gmail.googleapis.com/gmail/v1/users/me/profile'); profiles++; return Response.json({ emailAddress: 'fixture@example.test' }); };
  try {
    const d = deps({ allowed: undefined }), signal = new AbortController().signal;
    assert.equal((await runMailBriefTick(day, signal, d)).status,'accepted');
    await runMailBriefTick(day, signal, d); assert.equal(profiles,1); assert.equal(sent.length,1);
  } finally { globalThis.fetch = previousFetch; }
});

test('every mail slot looks back 48 hours, including DST and first-run evenings', () => {
  const schedule = { time: '08:00', startDate: '2026-01-01', mailOnly: true, startAt: 0 };
  for (const date of ['2026-03-08T08:00:00', '2026-11-01T08:00:00', '2026-11-02T08:00:00', '2026-11-02T18:05:00']) {
    const w = dueMailWindow(schedule, new Date(date).getTime());
    assert.equal((Date.parse(w.to) - Date.parse(w.from)) / 3600_000, 48);
    assert.equal(new Date(w.to).getHours(), date.includes('18:05') ? 18 : 8);
  }
  assert.equal(dueMailWindow(schedule, new Date('2026-11-02T18:05:00').getTime()).time, '18:00');
});
