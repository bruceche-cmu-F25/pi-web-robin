import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { composeBrief } from './brief-runner.ts';
import { initializeBriefPipeline, briefRunDetails } from '../extension/robin/brief-domain.ts';
import { addTodo, listTodos } from '../extension/robin/todo-domain.ts';
import { localDate } from '../extension/robin/dates.ts';
let root;
const previous = process.env.ROBIN_DATA_DIR;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'brief-runner-')); process.env.ROBIN_DATA_DIR = root; });
afterEach(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
test('consent is required before any storage or model work', async () => {
  await assert.rejects(composeBrief('no-consent', { allowPrivateModel: false, signal: new AbortController().signal }, async () => { throw new Error('must not call'); }), /Explicit consent/);
  assert.deepEqual(readdirSync(root), []);
});
test('editor adapter is one-shot, tool-free, notification-silent and does not mutate source records', async () => {
  initializeBriefPipeline(); addTodo({ title: 'Synthetic private task', due: localDate(new Date()) });
  const before = listTodos(); let calls = 0;
  const turn = async options => {
    calls++; assert.equal(options.oneShot, true); assert.equal(options.silenceCompletionNotifications, true);
    assert.deepEqual(options.toolNames, []); assert.equal(options.remembered, null); assert.equal(options.timeoutMs, 90_000);
    assert.match(options.preamble, /untrusted DATA/);
    const candidate = JSON.parse(options.message).candidates.find(item => item.source === 'todos');
    return { usedTools: [], sessionId: 'synthetic', reply: JSON.stringify({ headline: '先检查这项任务。', items: [{ sourceIds: [candidate.id], what: '有一项待办需要查看。', why: '判断：可以先核对截止日期。', suggestion: '核对原任务。', caveat: '未执行任何操作。', quotes: [{ sourceId: candidate.id, quote: 'Synthetic private task' }] }] }) };
  };
  const first = await composeBrief('explicit-editor', { allowPrivateModel: true, signal: new AbortController().signal }, turn);
  assert.ok(first.editorial); assert.equal(calls, 1); assert.deepEqual(listTodos(), before);
  assert.equal((await composeBrief('explicit-editor', { allowPrivateModel: true, signal: new AbortController().signal }, turn)).id, first.id);
  assert.equal(calls, 1);
  await assert.rejects(composeBrief('explicit-editor', { allowPrivateModel: true, input: 'gmail', signal: new AbortController().signal }, turn), /different input profile/);
  const mailEdition = await composeBrief('explicit-mail-editor', { allowPrivateModel: true, input: 'gmail', signal: new AbortController().signal }, turn);
  assert.equal(mailEdition.coverage.find(source => source.source === 'mail').coverage, 'disconnected');
  assert.equal(briefRunDetails('explicit-mail-editor').inputProfile, 'editor-gmail-v1');
  await assert.rejects(composeBrief('failed-provider-editor', { allowPrivateModel: true, signal: new AbortController().signal }, async () => { throw new Error('private provider detail'); }), error => !error.message.includes('private provider detail') && /allowance remains reserved/.test(error.message));
});
test('live acquisition reserves calendar/public capacity before mail, never sends private records to public sources, and edits once', async () => {
  initializeBriefPipeline(); addTodo({ title: 'Synthetic private task', due: localDate(new Date()) });
  const originalFetch = globalThis.fetch; const urls = []; let turns = 0;
  globalThis.fetch = async (url, options) => {
    urls.push(String(url)); assert.ok(['https://openai.com/news/rss.xml', 'https://hacks.mozilla.org/feed/'].includes(String(url)));
    assert.equal(options.body, undefined); assert.equal(JSON.stringify(options).includes('Synthetic private'), false);
    return new Response(`<rss><channel><item><title>Synthetic public release</title><link>${new URL('/synthetic', url)}</link><pubDate>${new Date().toUTCString()}</pubDate><description>Synthetic public excerpt</description></item></channel></rss>`);
  };
  try {
    const edition = await composeBrief('live-editor-01', { allowPrivateModel: true, input: 'live', signal: new AbortController().signal }, async options => {
      turns++; const input = JSON.parse(options.message);
      assert.deepEqual(input.coverage.map(c => c.source), ['calendar', 'world', 'mail', 'todos']);
      return { usedTools: [], sessionId: 'synthetic', reply: JSON.stringify({ headline: '先看任务，再看公开更新。', items: ['todos', 'world'].map(source => {
        const candidate = input.candidates.find(c => c.source === source);
        return { sourceIds: [candidate.id], what: '合成测试条目。', why: '判断：先核对原文。', suggestion: '', caveat: '未执行操作。', quotes: [{ sourceId: candidate.id, quote: candidate.text.split('\n')[0] }] };
      }) }) };
    });
    assert.equal(turns, 1); assert.equal(urls.length, 2); assert.ok(edition.items.some(i => i.evidence.kind === 'public-feed'));
    assert.equal(edition.editorial.items[0].section, 'personal'); assert.equal(edition.editorial.items[1].section, 'world');
    assert.equal(briefRunDetails('live-editor-01').inputProfile, 'editor-live-v1');
  } finally { globalThis.fetch = originalFetch; }
});
