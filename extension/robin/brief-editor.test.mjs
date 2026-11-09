import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import { initializeBriefPipeline, runShadowBrief, briefReadingView, briefRunDetails } from './brief-domain.ts';
import { prepareBriefEditor, parseBriefEditorial, briefNotificationPreview, composeMorningBrief } from './brief-editor.ts';
const previous = process.env.ROBIN_DATA_DIR;
let root;
const scope = { day: '2026-10-30', timezone: 'UTC' };
const stamp = '2026-10-30T10:00:00Z';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'brief-editor-')); process.env.ROBIN_DATA_DIR = root; });
afterEach(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const input = source => ({ source, observedAt: stamp, coverage: 'ready', detail: 'fixture source', items: source === 'todos' || source === 'world' ? [{
  id: `${source}:one`, source, section: source === 'world' ? 'world' : 'tasks', title: source === 'world' ? 'Historical announcement' : 'Review a document',
  summary: source === 'world' ? 'Last week a preview was announced, not released.' : 'Review the document before making a decision.',
  href: source === 'world' ? 'https://example.com/announcement' : '/dashboard?view=todos&todo=one',
  ...(source === 'world' ? { publishedOn: '2026-10-23' } : { due: '2026-10-31' }),
  evidence: { kind: source === 'world' ? 'legacy-passage' : 'record', reference: 'fixture-one' },
}] : [] });
const inputs = () => ['mail','calendar','todos','world'].map(input);
const reply = message => {
  const data = JSON.parse(message);
  return JSON.stringify({ headline: '先处理材料；历史动态仅作背景。', items: data.candidates.map(c => ({ sourceIds: [c.id], what: c.text.split('\n')[0], why: '这是需要核对来源的判断。', suggestion: '', caveat: c.source === 'world' ? '历史资料，非今日新消息。' : '', quotes: [{ sourceId: c.id, quote: c.text.split('\n')[0] }] })) });
};
const deps = editor => ({ scope, collect: source => input(source), editor });
function sql(query) { const db = new DatabaseSync(join(root, 'brief.sqlite')); try { db.exec(query); } finally { db.close(); } }

test('reader creates nothing and editor pack preserves dates/coverage with bounded fair source shares', () => {
  assert.equal(briefReadingView().initialized, false); assert.deepEqual(readdirSync(root), []);
  const many = inputs().map(source => ({ ...source, items: Array.from({ length: 100 }, (_, i) => ({ ...input(source.source === 'world' ? 'world' : 'todos').items[0], source: source.source, id: `${source.source}:${i}`, title: 'X'.repeat(1000), summary: 'Y'.repeat(5000) })) }));
  const pack = prepareBriefEditor(many, scope);
  assert.ok(pack.message.length <= 50_000); assert.ok(pack.omittedCount > 0);
  assert.equal(new Set(pack.candidates.map(c => c.item.source)).size, 4);
  assert.ok(pack.candidates.length <= 32);
  const small = prepareBriefEditor(inputs(), scope);
  assert.ok(small.message.includes('2026-10-23')); assert.ok(small.message.includes('legacy-passage'));
});

test('morning highlights actionable mail and tasks before arrangements and sourced public updates', () => {
  const mailItem = { id: 'mail:one', source: 'mail', section: 'updates', title: 'Recruiter email', summary: 'Subject: Recruiter email', href: 'https://mail.google.com/mail/u/0/#all/one', evidence: { kind: 'mail-message', reference: 'one', quote: 'Subject: Recruiter email' } };
  const news = { ...input('world').items[0], id: 'world:new', title: 'Publisher update', publishedOn: scope.day, evidence: { kind: 'legacy-passage', reference: 'source', quote: 'Publisher update' } };
  const mail = { ...input('mail'), items: [mailItem], mailReport: { from: stamp, to: stamp, accountKey: 'hash', total: 1, reviewed: 1, failed: 0,
    messages: [{ id: 'one', priority: 2, subject: 'Recruiter email', summary: 'Need response', date: stamp, href: mailItem.href, attachments: [], attachmentCount: 0, reviewed: true }] },
    mailEditorial: { headline: 'mail', items: [{ section: 'personal', sourceIds: ['mail:one'], what: 'Reply to recruiter', why: '', suggestion: 'Check the deadline', caveat: '', quotes: [{ sourceId: 'mail:one', quote: 'Subject: Recruiter email' }] }], consideredIds: ['mail:one'], omittedCount: 0 } };
  const brief = composeMorningBrief([mail, input('calendar'), input('todos'), { ...input('world'), items: [news] }]);
  assert.deepEqual(brief.items.map(row => [row.sourceIds[0], row.actionable === true]), [['mail:one', true], ['todos:one', true], ['world:new', false]]);
  assert.equal(brief.items[0].quotes[0].quote, 'Subject: Recruiter email');
  assert.match(brief.headline, /资讯/);
  const edition = { id: 'fixture', day: scope.day, deliveryTime: '08:00', kind: 'daily', editorial: brief, coverage: [] , mailReport: mail.mailReport };
  assert.match(briefNotificationPreview(edition).title, /每日简报/);
  assert.match(briefNotificationPreview(edition).body, /Reply to recruiter/);
  assert.deepEqual(briefNotificationPreview(edition).body.split('\n').slice(1), ['• Reply to recruiter', '• Review a document · Review the document before making a…']);
  const failed = { ...mailItem, id: 'mail:failed', title: 'Unreviewed newsletter', href: 'https://mail.google.com/mail/u/0/#all/failed' };
  const mixed = { ...mail, items: [failed, mailItem], mailReport: { ...mail.mailReport, failed: 1, total: 2, messages: [
    { ...mail.mailReport.messages[0], id: 'failed', href: failed.href, reviewed: false, priority: 3 }, mail.mailReport.messages[0],
  ] }, mailEditorial: { ...mail.mailEditorial, items: [
    { ...mail.mailEditorial.items[0], sourceIds: ['mail:failed'], what: 'Unreviewed', quotes: [{ sourceId: 'mail:failed', quote: 'Subject: Unreviewed newsletter' }] },
    mail.mailEditorial.items[0],
  ] } };
  const corrected = composeMorningBrief([mixed, input('calendar'), input('todos'), { ...input('world'), items: [news] }]);
  assert.equal(corrected.items[0].what, 'Reply to recruiter');
  assert.ok(!corrected.items.some(row => row.sourceIds.includes('mail:failed')));
  assert.match(corrected.headline, /2项可留意/);
});
test('optional interpretation may be empty, but missing or oversized fields and empty facts remain invalid', () => {
  const pack = prepareBriefEditor(inputs(), scope), raw = JSON.parse(reply(pack.message));
  raw.items[0].why = '';
  assert.equal(parseBriefEditorial(JSON.stringify(raw), pack).items[0].why, '');
  for (const mutate of [x => { delete x.items[0].why; }, x => { x.items[0].why = 'x'.repeat(401); }, x => { x.items[0].what = ''; }]) {
    const invalid = structuredClone(raw); mutate(invalid);
    assert.throws(() => parseBriefEditorial(JSON.stringify(invalid), pack), /Invalid Brief editorial text/);
  }
});
test('parser rejects invented references, quote fabrication, reuse and private/public mixing', () => {
  const pack = prepareBriefEditor(inputs(), scope);
  const valid = JSON.parse(reply(pack.message));
  assert.equal(parseBriefEditorial(JSON.stringify(valid), pack).items.length, 2);
  for (const mutate of [
    x => { x.items[0].sourceIds = ['invented']; },
    x => { x.items[0].quotes[0].quote = 'This sentence was never in the evidence.'; },
    x => { x.items.push(x.items[0]); },
    x => { x.items[0].sourceIds.push('world:one'); },
    x => { x.items[0].quotes = []; },
  ]) {
    const bad = structuredClone(valid); mutate(bad);
    assert.throws(() => parseBriefEditorial(JSON.stringify(bad), pack));
  }
  assert.throws(() => parseBriefEditorial('private malformed output', pack), error => !error.message.includes('private malformed'));
});

test('editor output, reader and notification share one immutable edition; retries spend no second turn', async () => {
  initializeBriefPipeline(); let calls = 0;
  const options = deps(async message => { calls++; return reply(message); });
  const edition = await runShadowBrief('editor-once', options);
  assert.equal(edition.mode, 'shadow'); assert.ok(edition.editorial);
  assert.equal(edition.editorial.items[0].section, 'personal'); assert.equal(edition.editorial.items[1].section, 'world');
  const view = briefReadingView(edition.id);
  assert.deepEqual(view.edition, edition);
  assert.ok(view.notification.url.includes(edition.id)); assert.equal(view.notification.body, edition.editorial.headline);
  assert.deepEqual(await runShadowBrief('editor-once', options), edition); assert.equal(calls, 1);
  await runShadowBrief('later-raw-shadow', { scope, collect: input });
  assert.equal(briefReadingView().edition.id, edition.id, 'later raw previews do not displace the editorial reader');
  assert.equal(briefReadingView('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa').edition, null);
  assert.equal(briefNotificationPreview({ ...edition, editorial: undefined }), null);
  const partial = briefNotificationPreview({ ...edition, coverage: edition.coverage.map(source => ({ ...source, coverage: 'partial' })) });
  assert.equal(partial.body, `来源不全 · ${edition.editorial.headline}`); assert.equal(partial.url, view.notification.url);
  assert.equal(partial.title, `每日简报 · ${edition.day}`);
});

test('reader exposes both immutable scheduled editions for the selected day, not a replacement', async () => {
  initializeBriefPipeline();
  const mail = { ...input('mail'), mailReport: { from: '2026-10-28T08:00:00Z', to: stamp, accountKey: 'a'.repeat(64), total: 0, reviewed: 0, failed: 0, messages: [] },
    mailEditorial: { headline: '没有新邮件', items: [], consideredIds: [], omittedCount: 0 } };
  const collect = source => source === 'mail' ? mail : input(source);
  const morning = await runShadowBrief('reader-morning', { scope, inputProfile: 'mail-daily-v1', collect, delivery: { time: '08:00', expiresAt: Date.parse('2026-10-30T18:00:00Z') } });
  const evening = await runShadowBrief('reader-evening', { scope, inputProfile: 'mail-all-v2', collect, delivery: { time: '18:00', expiresAt: Date.parse('2026-10-31T00:00:00Z') } });
  assert.deepEqual(briefReadingView().editions, [{ id: evening.id, time: '18:00' }, { id: morning.id, time: '08:00' }]);
  assert.deepEqual(briefReadingView(morning.id).editions, briefReadingView(evening.id).editions);
  assert.equal(briefReadingView(morning.id).edition.id, morning.id);
  assert.equal(briefReadingView(evening.id).edition.id, evening.id);
  assert.match(briefNotificationPreview(evening).title, /晚报/);
  assert.match(briefNotificationPreview(morning).body, /\n• /);
});
test('publication rollback reuses the validated editorial result without paying again', async () => {
  initializeBriefPipeline(); let calls = 0;
  sql("CREATE TRIGGER reject_edition BEFORE INSERT ON brief_editions BEGIN SELECT RAISE(ABORT, 'fixture publish failure'); END");
  const options = deps(async message => { calls++; return reply(message); });
  await assert.rejects(runShadowBrief('saved-editor-output', options), /fixture publish failure/);
  assert.equal(briefReadingView().edition, null);
  assert.ok(briefRunDetails('saved-editor-output').steps.some(s => s.outcome === 'validated-result-saved'));
  sql('DROP TRIGGER reject_edition');
  const edition = await runShadowBrief('saved-editor-output', options);
  assert.equal(edition.revision, 1); assert.equal(calls, 1);
});

test('an editor reservation freezes unavailable sources too; uncertain retries cannot reacquire', async () => {
  initializeBriefPipeline(); let reads = 0, calls = 0;
  const options = { ...deps(async message => { calls++; return reply(message); }), collect: source => { reads++; return source === 'mail' ? { ...input(source), coverage: 'unavailable' } : input(source); } };
  sql("CREATE TRIGGER reject_edition BEFORE INSERT ON brief_editions BEGIN SELECT RAISE(ABORT, 'fixture publish failure'); END");
  await assert.rejects(runShadowBrief('frozen-gaps', options), /fixture publish failure/);
  sql('DROP TRIGGER reject_edition');
  const resumed = await runShadowBrief('frozen-gaps', { ...options, collect: source => { reads++; return input(source); } });
  assert.equal(resumed.coverage.find(s => s.source === 'mail').coverage, 'unavailable');
  assert.equal(reads, 4); assert.equal(calls, 1);
  await assert.rejects(runShadowBrief('uncertain-gaps', { ...options, editor: async () => { throw new Error('fixture uncertain'); } }), /fixture uncertain/);
  const before = reads;
  await assert.rejects(runShadowBrief('uncertain-gaps', { ...options, collect: source => { reads++; return input(source); } }), /already reserved/);
  assert.equal(reads, before);
});

test('a saved editorial result cannot rebuild a missing frozen source manifest', async () => {
  initializeBriefPipeline(); let reads = 0;
  const options = { ...deps(async message => reply(message)), collect: source => { reads++; return input(source); } };
  sql("CREATE TRIGGER reject_edition BEFORE INSERT ON brief_editions BEGIN SELECT RAISE(ABORT, 'fixture publish failure'); END");
  await assert.rejects(runShadowBrief('missing-manifest', options), /fixture publish failure/);
  sql("DROP TRIGGER reject_edition; DELETE FROM brief_inputs WHERE source = 'mail'");
  await assert.rejects(runShadowBrief('missing-manifest', options), /Frozen Brief source result is missing/);
  assert.equal(reads, 4); assert.equal(briefReadingView().edition, null);
});

test('invalid output and uncertain turns retain the prior edition and cannot automatically spend again', async () => {
  initializeBriefPipeline(); const old = await runShadowBrief('good-editor', deps(async message => reply(message)));
  let calls = 0;
  const bad = deps(async () => { calls++; return '{"headline":"bad","items":[{"sourceIds":["invented"]}]}'; });
  await assert.rejects(runShadowBrief('bad-editor', bad), /reference/);
  assert.equal(briefReadingView().edition.id, old.id);
  await assert.rejects(runShadowBrief('bad-editor', bad), /already reserved/);
  assert.equal(calls, 1);
});

test('cancellation fences late model output and retains the reservation', async () => {
  initializeBriefPipeline(); const controller = new AbortController(); let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const pending = runShadowBrief('cancel-editor', { ...deps(message => new Promise(resolve => { release = () => resolve(reply(message)); started(); })), signal: controller.signal });
  await waiting; controller.abort(new Error('fixture cancelled'));
  await assert.rejects(pending, /fixture cancelled/);
  release(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(briefReadingView().edition, null);
  await assert.rejects(runShadowBrief('cancel-editor', deps(async message => reply(message))), /already reserved/);
});

test('empty inputs do not pay for an invented quiet-day headline, and editor mode cannot reuse raw request identities', async () => {
  initializeBriefPipeline(); let called = false;
  await assert.rejects(runShadowBrief('empty-editor', { ...deps(async () => { called = true; return ''; }), collect: source => ({ ...input(source), items: [] }) }), /No candidates/);
  assert.equal(called, false);
  await runShadowBrief('raw-request', { scope, collect: input });
  await assert.rejects(runShadowBrief('raw-request', deps(async message => reply(message))), /different input profile/);
});
