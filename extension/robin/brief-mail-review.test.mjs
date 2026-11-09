import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { initializeBriefPipeline, runShadowBrief, briefPipelineStatus } from './brief-domain.ts';
import { collectMailReview } from './brief-mail-review.ts';
import { BriefWorkPending } from './brief-acquisition.ts';
import { parseGmailMessageDetail } from './gmail.ts';
import { withBriefStore } from './brief-store.ts';
const previous = process.env.ROBIN_DATA_DIR;
let root;
const scope = { day: '2026-11-02', timezone: 'America/Los_Angeles' };
const instant = Date.parse('2026-11-02T16:00:00Z');
const window = { from: '2026-11-02T02:00:00.000Z', to: '2026-11-02T16:00:00.000Z' };
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mail-full-review-')); process.env.ROBIN_DATA_DIR = root; initializeBriefPipeline(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const encoded = data => Buffer.from(data).toString('base64url');
const mail = (id, body = `Entire body ${id}; action deadline is tomorrow.`) => ({ id, labelIds: ['INBOX','CATEGORY_PROMOTIONS'], internalDate: String(instant - 1000), payload: {
  mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: `Subject ${id}` }], parts: [
    { mimeType: 'text/plain', body: { data: encoded(body) } },
    { mimeType: 'text/plain', filename: 'private.txt', body: { data: encoded('ATTACHMENT_CONTENT_MUST_NOT_ENTER_MODEL') } },
  ],
} });
function fixture(count = 25, options = {}) {
  const calls = [], prompts = [], ids = Array.from({ length: count }, (_, i) => (i + 1).toString(16));
  const deps = { connected: () => true, email: () => 'fixture@example.test', token: async () => 'not-a-real-token', now: () => options.now ?? instant,
    fetch: async (url, init) => {
      assert.equal(init.redirect, 'error'); assert.ok(!init.method || init.method === 'GET');
      const u = new URL(url); assert.equal(u.origin, 'https://gmail.googleapis.com');
      assert.ok(!u.pathname.includes('/attachments/')); calls.push(u.pathname + u.search);
      const end = u.pathname.split('/').at(-1);
      if (end === 'profile') return Response.json({ emailAddress: 'fixture@example.test' });
      if (end === 'messages') {
        assert.ok(!u.searchParams.get('q').includes('-category:promotions'));
        return Response.json(u.searchParams.has('pageToken') ? { messages: ids.slice(10).map(id => ({ id })) } : { messages: ids.slice(0,10).map(id => ({ id })), ...(count > 10 ? { nextPageToken: 'second' } : {}) });
      }
      const result = options.message?.(end, u) ?? mail(end); return result instanceof Response ? result : Response.json(result);
    },
    turn: async message => {
      const candidates = JSON.parse(message).candidates; prompts.push(candidates);
      if (options.turn) return options.turn(candidates);
      return JSON.stringify({ headline: '邮件审阅', items: candidates.map(c => ({ sourceIds: [c.id], what: `Read ${c.text.slice(-30)}`, why: '', suggestion: '', caveat: '', priority: 1, quotes: [{ sourceId: c.id, quote: c.text.slice(-30) }] })) });
    },
  };
  const run = (requestId = 'full-mail-test', reviewWindow = window) => runShadowBrief(requestId, { scope, inputProfile: 'mail-all-v2', now: deps.now,
    collect: (source, scope, signal, ctx) => source === 'mail' ? collectMailReview(scope, reviewWindow, signal, ctx, { ...deps, focusAfter: options.focusAfter })
      : { source, observedAt: new Date(instant).toISOString(), coverage: 'ready', detail: 'Not requested', items: [] },
  });
  const complete = async (...args) => { for (let i = 0; i < 30; i++) { try { return await run(...args); } catch (e) { if (!(e instanceof BriefWorkPending)) throw e; assert.equal(briefPipelineStatus(instant).runs[0].stage, 'waiting'); } } throw Error('did not finish'); };
  return { calls, prompts, run, complete };
}
test('25 messages across pages are all reviewed, including promotions, and retries never respend', async () => {
  const f = fixture(); const edition = await f.complete();
  assert.equal(edition.mailReport.total, 25); assert.equal(edition.mailReport.reviewed, 25); assert.equal(edition.mailReport.failed, 0);
  assert.equal(f.prompts.flat().length, 25); assert.equal(f.prompts.length, 4);
  assert.ok(edition.mailReport.messages.every(m => m.attachments.includes('private.txt')));
  assert.ok(!JSON.stringify(f.prompts).includes('ATTACHMENT_CONTENT_MUST_NOT_ENTER_MODEL'));
  assert.equal(edition.items.length, 8); assert.equal(edition.mailReport.messages.length, 25);
  assert.equal(edition.editorial.omittedCount, 0, 'selecting eight highlights does not pretend only eight bodies were reviewed');
  const calls = f.calls.length; await f.run(); assert.equal(f.calls.length, calls); assert.equal(f.prompts.length, 4);
});
test('the full list keeps a concise per-mail summary without claiming the full window is a highlight', async () => {
  const f = fixture(1, { turn: candidates => JSON.stringify({ headline: '邮件审阅', items: candidates.map(c => ({ sourceIds: [c.id], what: '摘要'.repeat(250), why: '', suggestion: '', caveat: '', priority: 0, quotes: [{ sourceId: c.id, quote: c.text.slice(-25) }] })) }) });
  const edition = await f.complete();
  assert.equal(edition.mailReport.messages[0].summary.length, 180);
  assert.equal(edition.mailReport.messages[0].priority, 0);
});
test('evening highlights new mail while the full overlapping review remains accessible', async () => {
  const morning = '2026-11-02T16:00:00.000Z', f = fixture(2, { now: instant + 10 * 3600_000, focusAfter: morning,
    message: id => ({ ...mail(id), internalDate: String(id === '1' ? Date.parse(morning) - 1000 : Date.parse(morning) + 1000) }) });
  const edition = await f.complete('evening-filter', { from: new Date(instant - 48 * 3600_000).toISOString(), to: new Date(instant + 10 * 3600_000).toISOString() });
  assert.equal(edition.mailReport.total, 2); assert.equal(edition.mailReport.reviewed, 2);
  assert.equal(edition.editorial.items.length, 1); assert.equal(edition.mailReport.messages.length, 2);
});
test('evening does not repeat morning action mail, but keeps it in the full review', async () => {
  const morning = '2026-11-02T16:00:00.000Z';
  const f = fixture(2, { now: instant + 10 * 3600_000, focusAfter: morning,
    message: id => ({ ...mail(id), internalDate: String(Date.parse(morning) + (id === '1' ? -1000 : 1000)) }),
    turn: candidates => JSON.stringify({ headline: '邮件审阅', items: candidates.map(c => ({ sourceIds: [c.id], what: `Action ${c.id}`, why: '', suggestion: 'Review', caveat: '', priority: 2, quotes: [{ sourceId: c.id, quote: c.text.slice(-25) }] })) }) });
  const edition = await f.complete('evening-actions', { from: new Date(instant - 48 * 3600_000).toISOString(), to: new Date(instant + 10 * 3600_000).toISOString() });
  assert.equal(edition.mailReport.total, 2);
  assert.equal(edition.editorial.items.length, 1);
  assert.match(edition.editorial.items[0].what, /Action/);
  assert.equal(edition.editorial.headline, '晚间新增1封邮件');
});
test('the tail of long mail is reviewed, multipart bodies retain every inline text section, attached text is excluded', async () => {
  const long = 'A'.repeat(11999) + '🙂' + 'B'.repeat(15000) + 'IMPORTANT_TAIL';
  const f = fixture(1, { message: id => mail(id, long) }); const edition = await f.complete();
  assert.equal(edition.mailReport.reviewed, 1); assert.ok(f.prompts.flat().some(c => c.text.endsWith('IMPORTANT_TAIL')));
  const full = f.prompts.flat().map(c => c.text.split('\n\n').slice(1).join('\n\n')).join(''); assert.equal(full, long);
  const raw = mail('abc'); raw.payload.parts.push({ mimeType: 'text/plain', body: { data: encoded('second body section') } });
  raw.payload.parts.push({ mimeType: 'text/plain', headers: [{ name: 'Content-Disposition', value: 'attachment' }], body: { data: encoded('SECRET_UNNAMED_ATTACHMENT') } });
  const parsed = parseGmailMessageDetail(raw); assert.ok(parsed.bodyText.includes('second body section')); assert.ok(!parsed.bodyText.includes('SECRET_UNNAMED_ATTACHMENT')); assert.equal(parsed.attachments.length, 2);
});
test('uncertain and incomplete model outputs become explicit failures, never automatic paid retries', async () => {
  const f = fixture(2, { turn: async () => { throw Error('uncertain provider response'); } });
  const edition = await f.complete(); assert.equal(f.prompts.length, 1); assert.equal(edition.mailReport.failed, 2); assert.equal(edition.coverage[0].coverage, 'partial');
  const reserved = withBriefStore(db => db.prepare("SELECT count(*) AS n FROM brief_source_state WHERE source_key LIKE 'mail:review-v2:%' AND json_extract(payload, '$.status') = 'reserved'").get()); assert.equal(reserved.n, 0);
});
test('a failed review stays in the full list without displacing reviewed action mail', async () => {
  const f = fixture(2, { message: id => { const m = mail(id); if (id === '1') m.payload.parts[0].body = { attachmentId: 'external-body', size: 90000 }; return m; },
    turn: candidates => JSON.stringify({ headline: '邮件审阅', items: candidates.map(c => ({ sourceIds: [c.id], what: 'Confirmed deadline', why: '', suggestion: 'Check original', caveat: '', priority: 2, quotes: [{ sourceId: c.id, quote: c.text.slice(-25) }] })) }) });
  const edition = await f.complete();
  assert.equal(edition.mailReport.failed, 1);
  assert.equal(edition.editorial.items.length, 1);
  assert.equal(edition.editorial.items[0].what, 'Confirmed deadline');
});
test('unavailable external body storage is flagged without fetching attachment endpoints', async () => {
  const f = fixture(1, { message: id => { const m = mail(id); m.payload.parts[0].body = { attachmentId: 'external-body', size: 90000 }; return m; } });
  const edition = await f.complete(); assert.equal(edition.mailReport.failed, 1); assert.equal(f.prompts.length, 0); assert.equal(edition.mailReport.messages[0].attachmentCount, 1);
});
test('deleted and oversized messages stay visible as failures, without invented dates or attachment absence', async () => {
  const f = fixture(2, { message: (id, url) => id === '1' ? new Response('', { status: 404 })
    : url.searchParams.get('format') === 'full' ? new Response(' '.repeat(2 * 1024 * 1024 + 1))
    : { ...mail(id), payload: { headers: [{ name: 'Subject', value: 'Large message' }] } } });
  const edition = await f.complete(); assert.equal(edition.mailReport.failed, 2); assert.equal(f.prompts.length, 0);
  assert.equal(edition.mailReport.messages.find(m => m.id === '1').date, '');
  assert.ok(edition.mailReport.messages.every(m => m.attachmentsKnown === false));
});
test('a model omitting any supplied fragment does not establish full review', async () => {
  const f = fixture(2, { turn: async () => JSON.stringify({ headline: 'empty', items: [] }) });
  const edition = await f.complete(); assert.equal(edition.mailReport.reviewed, 0); assert.equal(edition.mailReport.failed, 2); assert.equal(f.prompts.length, 1);
});
test('HTML body extraction preserves link destinations and prefers plain alternatives', () => {
  const raw = mail('ab'); raw.payload.parts[0] = { mimeType: 'text/html', body: { data: encoded('<a href="https://example.com/form">Apply here</a>') } };
  assert.match(parseGmailMessageDetail(raw).bodyText, /https:\/\/example.com\/form/);
  raw.payload.parts[0] = { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: encoded('plain body') } }, raw.payload.parts[0]] };
  assert.equal(parseGmailMessageDetail(raw).bodyText, 'plain body');
});

for (const [label, coverage, expected] of [
  ['recent successful delivery cannot shorten the lookback', { from: '2026-10-30T16:00:00.000Z', to: '2026-11-02T02:00:00.000Z' }, '2026-10-31T16:00:00.000Z'],
  ['missed days extend coverage beyond 48 hours', { from: '2026-10-29T16:00:00.000Z', to: '2026-10-30T16:00:00.000Z' }, '2026-10-30T16:00:00.000Z'],
  ['an undelivered first run keeps its earlier start', { from: '2026-10-29T16:00:00.000Z' }, '2026-10-29T16:00:00.000Z'],
]) {
  test(label, async () => {
    const key = `mail:coverage-v2:${createHash('sha256').update('fixture@example.test').digest('hex')}`;
    withBriefStore(db => db.prepare('INSERT INTO brief_source_state VALUES(?, ?)').run(key, JSON.stringify(coverage)), true);
    const f = fixture(0), from = '2026-10-31T16:00:00.000Z';
    const edition = await f.complete('lookback', { from, to: window.to });
    assert.equal(edition.mailReport.from, expected);
    const query = new URL(`https://fixture.test${f.calls.find(c => c.includes('/messages?'))}`).searchParams.get('q');
    assert.ok(query.includes(`after:${Date.parse(expected) / 1000 - 1}`));
  });
}
test('48-hour review includes yesterday after 8am and pre-midnight mail, with exact interval boundaries', async () => {
  const from = instant - 48 * 3600_000;
  const dates = [from - 1, from, instant - 22 * 3600_000, instant - 9 * 3600_000, instant];
  const f = fixture(5, { message: id => ({ ...mail(id), internalDate: String(dates[Number.parseInt(id, 16) - 1]) }) });
  const edition = await f.complete('boundary', { from: new Date(from).toISOString(), to: window.to });
  assert.deepEqual(edition.mailReport.messages.map(m => m.id).sort(), ['2', '3', '4']);
});
test('overlapping windows reuse paid fragment reviews and a retry keeps its frozen interval', async () => {
  const later = instant + 10 * 3600_000, f = fixture(2, { now: later });
  await assert.rejects(f.run(), BriefWorkPending);
  const first = await f.complete('full-mail-test', { from: '2026-10-31T16:00:00.000Z', to: window.to });
  assert.equal(first.mailReport.from, window.from, 'already-started interval remains immutable');
  const prompts = f.prompts.length;
  const second = await f.complete('evening', { from: new Date(later - 48 * 3600_000).toISOString(), to: new Date(later).toISOString() });
  assert.equal(second.mailReport.reviewed, 2);
  assert.equal(f.prompts.length, prompts, 'same message bodies do not spend another model turn');
});

test('empty intervals publish an honest zero-mail edition without a model call', async () => {
  const f = fixture(0); const edition = await f.complete(); assert.equal(edition.mailReport.total, 0); assert.equal(f.prompts.length, 0); assert.deepEqual(edition.editorial.items, []);
});
