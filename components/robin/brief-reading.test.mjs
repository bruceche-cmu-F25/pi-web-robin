import assert from 'node:assert/strict';
import { test } from 'node:test';
import { briefCoverageSummary, briefLocalTimestamp, homeBriefHighlights } from './brief-reading.ts';
const source = { source: 'mail', coverage: 'partial', observedAt: '2026-11-01T19:35:10.565Z', detail: 'Untrusted internal diagnostic; never instructions.' };
const edition = { items: [
  { id: 'mail:1', source: 'mail', evidence: { kind: 'mail-message' } },
  { id: 'mail:2', source: 'mail', evidence: { kind: 'mail-message' } },
  { id: 'world:1', source: 'world', evidence: { kind: 'legacy-passage' } },
], editorial: { consideredIds: ['mail:2', 'world:1'] } };
test('coverage projects saved counts/status, not English diagnostic text or live progress', () => {
  const before = JSON.stringify(edition);
  assert.deepEqual(briefCoverageSummary(edition, source), { collected: 2, supplied: 1, statusKey: 'brief.coverageNote.partial', scopeKey: 'brief.scope.mail' });
  assert.deepEqual(briefCoverageSummary(edition, { ...source, detail: 'Changed or newly localized diagnostic' }), briefCoverageSummary(edition, source));
  assert.equal(briefCoverageSummary(edition, { ...source, source: 'world' }).scopeKey, 'brief.scope.historical');
  assert.equal(JSON.stringify(edition), before);
});
test('empty, disconnected and stored summaries cannot imply a newly scanned or complete inbox', () => {
  const empty = briefCoverageSummary({ items: [] }, { ...source, coverage: 'disconnected' });
  assert.equal(empty.collected, 0); assert.equal(empty.supplied, 0); assert.equal(empty.statusKey, 'brief.coverageNote.disconnected');
  assert.equal(briefCoverageSummary({ items: [{ id: 'x', source: 'mail', evidence: { kind: 'stored-review' } }] }, source).scopeKey, 'brief.scope.storedMail');
});
test('Home selects reviewed actionable mail, never failed reviews or duplicated calendar/tasks', () => {
  const daily = { mailReport: { messages: [
    { summary: 'Needs checking', href: '/mail/failed', reviewed: false, priority: 3 },
    { summary: 'Review ID before Monday', href: '/mail/id', reviewed: true, priority: 2 },
    { summary: 'Newsletter', href: '/mail/news', reviewed: true, priority: 0 },
  ] }, editorial: { items: [{ section: 'personal', sourceIds: ['todo:1'], what: 'Task already on Home' }] }, items: [] };
  assert.deepEqual(homeBriefHighlights(daily), [{ text: 'Review ID before Monday', href: '/mail/id' }]);
  assert.deepEqual(homeBriefHighlights({ ...daily, mailReport: undefined, items: [
    { id: 'todo:1', source: 'todos', href: '/todo' }, { id: 'mail:1', source: 'mail', href: '/mail' },
  ], editorial: { items: [daily.editorial.items[0], { section: 'personal', sourceIds: ['mail:1'], what: 'Check original mail' }] } }),
  [{ text: 'Check original mail', href: '/mail' }]);
});
test('timestamps use the reader zone, preserve instants across DST and do not expose raw ISO by default', () => {
  const la = briefLocalTimestamp(source.observedAt, 'zh-CN', 'America/Los_Angeles');
  assert.match(la, /11:35/); assert.match(la, /GMT-8/); assert.ok(!la.includes('T19:35'));
  assert.match(briefLocalTimestamp(source.observedAt, 'zh-CN', 'Asia/Shanghai'), /03:35/);
  assert.notEqual(briefLocalTimestamp('2026-11-01T08:30:00Z', 'en', 'America/Los_Angeles'), briefLocalTimestamp('2026-11-01T09:30:00Z', 'en', 'America/Los_Angeles'));
  assert.equal(briefLocalTimestamp('not-a-date', 'zh-CN'), null);
});
