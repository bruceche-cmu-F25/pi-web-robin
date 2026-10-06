import test from 'node:test';
import assert from 'node:assert/strict';
import { outreachActivity, filterOutreachActivity, summarizeOutreach } from './outreach-crm.ts';

const first = '2026-09-29T12:00:00';
const next = '2026-09-30T12:00:00';
test('counts multichannel messages and follow-up once while deduplicating contacts', () => {
  const rows = outreachActivity([{ id: 'one', sentAt: first, sendAttempt: { state: 'sent', at: first }, followedUpAt: next,
    followUpAttempt: { state: 'sent', at: next }, socialOutreach: { instagram: { sentAt: next } } }]);
  const summary = summarizeOutreach(rows);
  assert.equal(summary.messages, 3);
  assert.equal(summary.people.length, 1);
  assert.equal(summary.followups, 1);
  assert.deepEqual(summary.channels.find(c => c.channel === 'email'), { channel: 'email', messages: 2, people: 1 });
  assert.equal(filterOutreachActivity(rows, '2026-09-30', '2026-09-30').length, 2);
  assert.equal(filterOutreachActivity(rows, '', '', 'instagram').length, 1);
});
test('excludes drafts, invitations and uncertain claims; accepts confirmed fallback timestamps', () => {
  const rows = outreachActivity([
    { id: 'pending', status: 'sent', queuedAt: first, sendAttempt: { state: 'pending', at: first }, followUpAttempt: { state: 'uncertain', at: first }, linkedinConnection: { requestedAt: first }, socialOutreach: { instagram: { draft: 'hello' } } },
    { id: 'confirmed', sendAttempt: { state: 'sent', at: next }, followUpAttempt: { state: 'sent', at: next } },
    { id: 'invalid', sentAt: 'invalid' },
  ]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.lead.id === 'confirmed'));
});
test('uses local calendar days with inclusive day boundaries and empty selections', () => {
  const rows = outreachActivity([{ id: 'a', sentAt: '2026-09-30T00:00:00' }, { id: 'b', sentAt: '2026-09-30T23:59:59' }, { id: 'c', sentAt: '2026-10-01T00:00:00' }]);
  assert.equal(filterOutreachActivity(rows, '2026-09-30', '2026-09-30').length, 2);
  assert.equal(filterOutreachActivity(rows, '2026-09-29', '2026-09-29').length, 0);
  assert.equal(summarizeOutreach([]).messages, 0);
});
