import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, test } from 'node:test';
import { initializeBriefPipeline, runShadowBrief, briefReadingView } from './brief-domain.ts';
import { briefDeliverySlot, briefOwnsDay, briefDeliveryReceipts as readReceipts, deliverBrief, resolveBriefDelivery } from './brief-delivery-domain.ts';
import { briefSchedule, briefScheduleDue } from './brief-schedule.ts';
import { runBriefDeliveryTick } from '../../lib/brief-delivery-runner.ts';
import { localDate } from './dates.ts';
import { createDeliveryLedger } from './delivery-ledger.ts';
let root, clock;
const previous = process.env.ROBIN_DATA_DIR;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'brief-delivery-')); process.env.ROBIN_DATA_DIR = root; clock = new Date('2026-10-30T10:00:00').getTime(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const briefDeliveryReceipts = () => readReceipts(clock);
const scope = () => ({ day: localDate(new Date(clock)), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
const env = () => ({ ROBIN_BRIEF_ENABLED: '1', ROBIN_BRIEF_ALLOW_PRIVATE_MODEL: '1', ROBIN_BRIEF_REPLACE_LEGACY: '1', ROBIN_BRIEF_START: scope().day, ROBIN_BRIEF_TIME: '08:00' });
const options = () => ({ scope: scope(), now: () => clock,
  collect: source => ({ source, observedAt: new Date(clock).toISOString(), coverage: 'ready', detail: 'fixture', items: source === 'todos' ? [{ id: 'todo:one', source, section: 'tasks', title: 'Review fixture', summary: 'Review fixture', href: '/dashboard?view=todos', evidence: { kind: 'record', reference: 'one' } }] : [] }),
  editor: async () => JSON.stringify({ headline: 'Fixture briefing', items: [{ sourceIds: ['todo:one'], what: 'Review fixture', why: 'A judgement', suggestion: '', caveat: '', quotes: [{ sourceId: 'todo:one', quote: 'Review fixture' }] }] }),
  delivery: { expiresAt: clock + 3600_000 },
});
const transport = (send, extra = {}) => ({ now: () => clock, allowed: () => true, subscriptionCount: async () => 1, send, ...extra });
function sql(query) { const db = new DatabaseSync(join(root, 'brief.sqlite')); try { db.exec(query); } finally { db.close(); } }

test('deployment gate is explicit and default ticks neither initialize nor spend', async () => {
  assert.equal(briefSchedule({}), undefined);
  assert.throws(() => briefSchedule({ ROBIN_BRIEF_ENABLED: '1' }), /consent/);
  assert.throws(() => briefSchedule({ ...env(), ROBIN_BRIEF_START: 'bad' }), /start date/);
  assert.equal(briefScheduleDue(briefSchedule(env()), clock), true);
  assert.equal(briefScheduleDue({ time: '11:00', startDate: scope().day }, clock), false);
  assert.equal(briefOwnsDay(scope()), false);
  assert.equal((await runBriefDeliveryTick(scope().day, new AbortController().signal, { env: {}, now: () => clock })).status, 'disabled-or-not-due');
  assert.deepEqual(readdirSync(root), []);
});

test('edition and outbox roll back together; saved editor result completes publication without another turn', async () => {
  initializeBriefPipeline(); let turns = 0;
  const opts = options(), editor = opts.editor; opts.editor = async (...args) => { turns++; return editor(...args); };
  sql("CREATE TRIGGER reject_outbox BEFORE INSERT ON brief_outbox BEGIN SELECT RAISE(ABORT, 'fixture outbox failure'); END");
  await assert.rejects(runShadowBrief('atomic-delivery', opts), /outbox failure/);
  assert.equal(briefReadingView().edition, null); assert.deepEqual(briefDeliveryReceipts(), []);
  sql('DROP TRIGGER reject_outbox');
  const saved = await runShadowBrief('atomic-delivery', opts);
  assert.equal(turns, 1); assert.equal(briefDeliveryReceipts()[0].edition_id, saved.id);
  assert.equal(briefOwnsDay(scope()), true);
  assert.equal((await runShadowBrief('atomic-delivery', opts)).id, saved.id);
});

test('accepted payload pins its edition, concurrent callers cannot send twice, and old fallback stays fenced', async () => {
  initializeBriefPipeline(); const saved = await runShadowBrief('one-send', options());
  let count = 0, release; const waiting = new Promise(resolve => { release = resolve; });
  const deps = transport(async n => { count++; assert.ok(n.url.endsWith(saved.id)); assert.equal(n.body, saved.editorial.headline); assert.ok(!n.title.includes('预览')); await waiting; return { accepted: 1, failed: 1, expired: 0 }; });
  const first = deliverBrief(scope(), deps);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(await deliverBrief(scope(), deps), 'waiting-or-settled');
  release(); assert.equal(await first, 'accepted');
  assert.equal(await deliverBrief(scope(), deps), 'waiting-or-settled');
  assert.equal(count, 1); assert.equal(briefOwnsDay(scope()), true);
});

test('uncertain response and abandoned dispatch never auto-resend; manual settlement sends nothing', async () => {
  initializeBriefPipeline(); await runShadowBrief('uncertain-send', options()); let calls = 0;
  const deps = transport(async () => { calls++; throw new Error('response lost'); });
  assert.equal(await deliverBrief(scope(), deps), 'uncertain');
  assert.equal(await deliverBrief(scope(), deps), 'waiting-or-settled'); assert.equal(calls, 1);
  resolveBriefDelivery(briefDeliveryReceipts()[0].slot, 'cancelled');
  assert.equal(briefDeliveryReceipts()[0].state, 'cancelled'); assert.equal(briefOwnsDay(scope()), true);
  sql("UPDATE brief_outbox SET state='sending', owner='crashed', lease_until=0");
  assert.equal(await deliverBrief(scope(), deps), 'waiting-or-settled');
  assert.equal(briefDeliveryReceipts()[0].state, 'uncertain'); assert.equal(calls, 1);
});

test('only definite nonacceptance retries, within a finite budget and without regenerating', async () => {
  initializeBriefPipeline(); await runShadowBrief('retry-send', options()); let calls = 0;
  const deps = transport(async () => { calls++; return { accepted: 0, failed: 0, expired: 1 }; });
  assert.equal(await deliverBrief(scope(), deps), 'pending');
  assert.equal(await deliverBrief(scope(), deps), 'waiting-or-settled');
  clock += 300_000; assert.equal(await deliverBrief(scope(), deps), 'pending');
  clock += 300_000; assert.equal(await deliverBrief(scope(), deps), 'failed');
  clock += 300_000; assert.equal(await deliverBrief(scope(), deps), 'waiting-or-settled'); assert.equal(calls, 3);
});

test('no subscribers, revoked consent and expired editions cannot dispatch', async () => {
  initializeBriefPipeline(); await runShadowBrief('delivery-gates', options());
  const send = async () => { throw new Error('must not dispatch'); };
  await deliverBrief(scope(), transport(send, { subscriptionCount: async () => 0 }));
  assert.equal(briefDeliveryReceipts()[0].attempts, 0);
  let enabled = true;
  assert.equal(await deliverBrief(scope(), transport(send, { allowed: () => enabled, subscriptionCount: async () => { enabled = false; return 1; } })), 'disabled');
  clock += 3600_001;
  await deliverBrief(scope(), transport(send)); assert.equal(briefDeliveryReceipts()[0].state, 'expired');
});

test('scheduled tick uses one stable run; retry dispatch never recomposes, publication may finish after consent changes', async () => {
  initializeBriefPipeline(); let generations = 0, sends = 0;
  const deps = { env: env(), now: () => clock, allowed: () => true, subscriptionCount: async () => 1,
    compose: async (id, opts) => { generations++; assert.equal(opts.input, 'live'); return runShadowBrief(id, { ...options(), scope: opts.scope, delivery: opts.delivery, inputProfile: 'editor-live-v1' }); },
    send: async () => { sends++; return { accepted: 1, failed: 0, expired: 0 }; } };
  const day = scope().day;
  assert.equal((await runBriefDeliveryTick(day, new AbortController().signal, deps)).status, 'accepted');
  await runBriefDeliveryTick(day, new AbortController().signal, deps);
  assert.equal(generations, 1); assert.equal(sends, 1);
  await assert.rejects(runBriefDeliveryTick('2026-10-29', new AbortController().signal, deps), /current local day/);
});

test('a hung transport becomes uncertain within 60 seconds; a late acceptance never triggers a second dispatch', async t => {
  initializeBriefPipeline(); await runShadowBrief('hung-dispatch', options());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release, sends = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const deps = transport(async () => { sends++; return waiting; });
  const pending = deliverBrief(scope(), deps); await Promise.resolve();
  clock += 60_001; t.mock.timers.tick(60_001);
  assert.equal(await pending, 'uncertain');
  release({ accepted: 1, failed: 0, expired: 0 }); await Promise.resolve();
  assert.equal(await deliverBrief(scope(), deps), 'waiting-or-settled'); assert.equal(sends, 1);
});

test('an expired send owner cannot settle over an uncertain replacement', async () => {
  initializeBriefPipeline(); await runShadowBrief('owner-race', options()); let release, sends = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const deps = transport(async () => { sends++; return waiting; });
  const pending = deliverBrief(scope(), deps); await Promise.resolve(); clock += 120_001;
  assert.equal(await deliverBrief(scope(), deps), 'waiting-or-settled');
  release({ accepted: 1, failed: 0, expired: 0 }); assert.equal(await pending, 'ownership-lost');
  assert.equal(briefDeliveryReceipts()[0].state, 'uncertain'); assert.equal(sends, 1);
});

test('read-only receipts report expired windows even with no subscribers and do not update storage', async () => {
  initializeBriefPipeline(); await runShadowBrief('expired-read', options()); clock += 3600_001;
  assert.equal(briefDeliveryReceipts()[0].state, 'expired');
  const db = new DatabaseSync(join(root, 'brief.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT state FROM brief_outbox').get().state, 'pending'); } finally { db.close(); }
});

test('server tick independently enforces original delivery history without initialization or legacy writes', async () => {
  createDeliveryLedger('telegram-state.json').mark(scope().day, 0); const before = readdirSync(root);
  const result = await runBriefDeliveryTick(scope().day, new AbortController().signal, { env: env(), now: () => clock, allowed: () => true,
    compose: async () => { throw Error('must not generate'); }, subscriptionCount: async () => { throw Error('must not contact push'); } });
  assert.equal(result.status, 'legacy-consumed'); assert.deepEqual(readdirSync(root), before);
});

test('a legacy acceptance arriving during generation cancels the new intent instead of sending both', async () => {
  initializeBriefPipeline(); let consumed = false, turns = 0;
  const deps = { env: env(), now: () => clock, allowed: () => true, subscriptionCount: async () => 1, legacyConsumed: () => consumed,
    compose: async (id, opts) => { turns++; const edition = await runShadowBrief(id, { ...options(), delivery: opts.delivery }); consumed = true; return edition; },
    send: async () => { throw Error('must not dispatch'); } };
  assert.equal((await runBriefDeliveryTick(scope().day, new AbortController().signal, deps)).status, 'legacy-consumed');
  assert.equal(briefDeliveryReceipts()[0].state, 'cancelled'); assert.equal(briefOwnsDay(scope()), true);
  await runBriefDeliveryTick(scope().day, new AbortController().signal, deps); assert.equal(turns, 1);
});

test('generation crossing midnight publishes history but never sends yesterday; revoked delivery stops before transport', async () => {
  initializeBriefPipeline(); let enabled = true;
  const deps = { env: env(), now: () => clock, allowed: () => enabled, subscriptionCount: async () => 1, legacyConsumed: () => false,
    compose: async (id, opts) => { const edition = await runShadowBrief(id, { ...options(), delivery: opts.delivery }); clock += 86400_000; return edition; },
    send: async () => { throw Error('must not dispatch'); } };
  assert.equal((await runBriefDeliveryTick(scope().day, new AbortController().signal, deps)).status, 'past-day');
  assert.equal(briefDeliveryReceipts()[0].state, 'expired');
  deps.compose = async (id, opts) => { const edition = await runShadowBrief(id, { ...options(), delivery: opts.delivery }); enabled = false; return edition; };
  assert.equal((await runBriefDeliveryTick(scope().day, new AbortController().signal, deps)).status, 'disabled');
});

test('DST repeated hours share one day slot and a skipped scheduled hour becomes due after the gap', () => {
  const original = process.env.TZ; process.env.TZ = 'America/Los_Angeles';
  try {
    const first = new Date('2026-11-01T01:45:00-07:00'), second = new Date('2026-11-01T01:45:00-08:00');
    const config = { startDate: '2026-11-01', time: '01:30' };
    assert.ok(briefScheduleDue(config, first.getTime())); assert.ok(briefScheduleDue(config, second.getTime()));
    const s = d => ({ day: localDate(d), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    assert.equal(briefDeliverySlot(s(first)), briefDeliverySlot(s(second)));
    assert.ok(briefScheduleDue({ startDate: '2027-03-14', time: '02:30' }, new Date('2027-03-14T03:00:00-07:00').getTime()));
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
