import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig, runDailyBrief, runDigests, sendDailyAgenda } from './bridge.ts';
const now = new Date('2026-10-30T10:00:00').getTime();
test('enabled Brief refuses a non-phone bridge rather than suppressing legacy mail silently', () => {
  assert.throws(() => readConfig({ ROBIN_BRIEF_ENABLED: '1', ROBIN_BRIEF_ALLOW_PRIVATE_MODEL: '1', ROBIN_BRIEF_REPLACE_LEGACY: '1', ROBIN_BRIEF_START: '2026-10-30' }, { notificationChannel: 'telegram' }), /phone push channel/);
});
const config = () => ({ notificationChannel: 'push', token: '', allowlist: [42], piWebUrl: 'http://localhost',
  dailyBrief: { startDate: '2026-10-30', time: '08:00' },
  dailyAgenda: { enabled: true, time: '08:00', locale: 'zh' }, gmailDigest: { enabled: true, time: '08:00', locale: 'zh', chatIds: [], query: 'newer_than:1d' },
  jobDigest: { enabled: false, chatIds: [], sweepAt: '', morning: '08:00', evening: '20:00', count: 10, locale: 'zh' }, reminders: { enabled: false },
});
function fixture() {
  const calls = [], marks = [];
  const ledger = { pending: (_key, ids) => ids, mark: (...args) => marks.push(args) };
  return { calls, marks, deps: { now: () => now, log() {}, googleConnected: () => true, dailyAgendaLedger: ledger, gmailLedger: ledger, jobLedger: ledger, reminderLedger: ledger, briefOwnsDay: () => false,
    fetch: async (url, init) => { calls.push({ url, init });
      if (url.endsWith('/api/robin/brief/tick')) return Response.json({ status: 'accepted' });
      if (url.endsWith('/api/push/send') && init.method === 'GET') return Response.json({ subscriptions: 1 });
      throw new Error('unexpected dispatch');
    },
  } };
}
test('handoff replaces only agenda/mail, tick uses the existing HTTP lane and leaves old ledgers untouched', async () => {
  const f = fixture(); await runDigests(config(), f.deps); await runDailyBrief(config(), f.deps);
  assert.equal(f.calls.filter(c => c.url.endsWith('/api/robin/brief/tick')).length, 1);
  assert.ok(!f.calls.some(c => c.url.includes('assistant'))); assert.deepEqual(f.marks, []);
  assert.equal(JSON.parse(f.calls.at(-1).init.body).day, '2026-10-30');
});
test('an already consumed old slot prevents same-day handoff replay; durable ownership prevents rollback replay', async () => {
  const f = fixture(); f.deps.dailyAgendaLedger = { ...f.deps.dailyAgendaLedger, pending: () => [] };
  await runDailyBrief(config(), f.deps); assert.equal(f.calls.length, 0);
  f.deps.briefOwnsDay = () => true;
  await runDigests({ ...config(), dailyBrief: undefined }, f.deps);
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].url.endsWith('/api/push/send'));
});
test('existing mail-only deployment keeps the old agenda until both processes enable the new gate', async () => {
  const f = fixture(), c = { ...config(), dailyBrief: { ...config().dailyBrief, mailOnly: true, startAt: new Date('2026-10-30T08:00:00').getTime() } };
  f.deps.fetch = async (url, init) => {
    f.calls.push({ url, init });
    if (url.endsWith('/api/robin/assistant')) return Response.json({ reply: 'fixture agenda', usedTools: [] });
    if (url.endsWith('/api/push/send')) return Response.json(init.method === 'GET' ? { subscriptions: 1 } : { accepted: 1 });
    throw Error('unexpected mail call');
  };
  await runDigests(c, f.deps);
  assert.equal(f.calls.filter(c => c.url.endsWith('/api/robin/assistant')).length, 1);
});
test('combined morning suppresses the old agenda and mail; an old delivery prevents a replay', async () => {
  const f = fixture(), c = { ...config(), dailyBrief: { ...config().dailyBrief, mailOnly: true, morningDaily: true, startAt: new Date('2026-10-30T08:00:00').getTime() } };
  f.deps.fetch = async (url, init) => {
    f.calls.push({ url, init });
    if (url.endsWith('/api/robin/assistant')) { assert.equal(JSON.parse(init.body).readOnly, true); return Response.json({ reply: 'fixture agenda', usedTools: [] }); }
    if (url.endsWith('/api/push/send')) return Response.json(init.method === 'GET' ? { subscriptions: 1 } : { accepted: 1 });
    if (url.endsWith('/api/robin/brief/tick')) return Response.json({ status: 'accepted' });
    throw Error('unexpected mail call');
  };
  await runDigests(c, f.deps);
  assert.equal(f.calls.filter(c => c.url.endsWith('/api/robin/assistant')).length, 0);
  assert.equal(f.calls.filter(c => c.url.endsWith('/api/push/send') && c.init.method === 'POST').length, 0);
  f.deps.dailyAgendaLedger = { ...f.deps.dailyAgendaLedger, pending: () => [] };
  await runDailyBrief(c, f.deps); assert.equal(f.calls.filter(c => c.url.endsWith('/api/robin/brief/tick')).length, 1);
  f.deps.briefOwnsMailDay = () => true;
  const before = f.calls.length; await runDigests({ ...c, dailyBrief: undefined }, f.deps);
  assert.equal(f.calls.length, before + 1, 'old agenda ownership must also be checked when disabling the lane');
});

test('a legacy model finishing after handoff cannot send; configuration mismatch is not silently ignored', async () => {
  const f = fixture(); const old = { ...config(), dailyBrief: undefined };
  f.deps.reloadConfig = config;
  f.deps.fetch = async url => { f.calls.push(url); return Response.json({ reply: 'fixture agenda', usedTools: [] }); };
  await sendDailyAgenda(old, f.deps, '2026-10-30');
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].endsWith('/api/robin/assistant')); assert.deepEqual(f.marks, []);
  f.deps.fetch = async () => Response.json({ status: 'disabled-or-not-due' });
  await assert.rejects(runDailyBrief(config(), f.deps), /matching bridge\/server/);
});
