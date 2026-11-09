import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createJiti } from 'jiti';
import { initializeBriefPipeline, runShadowBrief } from '../../../../extension/robin/brief-domain.ts';
const root = mkdtempSync(join(tmpdir(), 'brief-route-'));
const previous = process.env.ROBIN_DATA_DIR;
process.env.ROBIN_DATA_DIR = root;
let calls = 0; const inputs = [];
globalThis.__briefRouteCompose = async (requestId, options) => { inputs.push(options.input); assert.equal(options.delivery, undefined); return runShadowBrief(requestId, {
  scope: { day: '2026-10-30', timezone: 'UTC' },
  collect: source => ({ source, observedAt: '2026-10-30T10:00:00Z', coverage: 'ready', detail: 'fixture', items: source === 'todos' ? [{ id: 'todo:one', source, section: 'tasks', title: 'Synthetic task', summary: 'Source summary', href: '/dashboard?view=todos', evidence: { kind: 'record', reference: 'one' } }] : [] }),
  editor: async () => { calls++; return JSON.stringify({ headline: 'fixture headline', items: [{ sourceIds: ['todo:one'], what: 'Review the task.', why: 'A judgement.', suggestion: '', caveat: '', quotes: [{ sourceId: 'todo:one', quote: 'Synthetic task' }] }] }); },
}); };
const runner = join(root, 'runner.mjs');
writeFileSync(runner, 'export const composeBrief = (...args) => globalThis.__briefRouteCompose(...args);');
const jiti = createJiti(import.meta.url, { alias: { '@/lib/brief-runner': runner, '@': process.cwd() }, moduleCache: false });
const route = await jiti.import('./route.ts');
after(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; delete globalThis.__briefRouteCompose; });
const request = (method, body, query = '', headers = {}) => new Request(`http://localhost/api/robin/brief${query}`, { method,
  headers: { Host: 'localhost', Origin: 'http://localhost', 'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
test('reader is side-effect free; exact missing editions do not fall back; guarded consent precedes model work', async () => {
  const initial = await route.GET(request('GET'));
  assert.equal((await initial.json()).initialized, false); assert.equal(existsSync(join(root, 'brief.sqlite')), false);
  assert.equal(initial.headers.get('Cache-Control'), 'private, no-store');
  const body = { action: 'compose', requestId: 'fixture-http', allowPrivateModel: true };
  assert.equal((await route.POST(request('POST', body, '', { Origin: 'https://evil.example' }))).status, 403);
  assert.equal((await route.POST(request('POST', body, '', { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await route.POST(request('POST', { ...body, allowPrivateModel: false }))).status, 400);
  assert.equal((await route.POST(request('POST', { ...body, input: 'anything' }))).status, 400);
  assert.equal((await route.POST(request('POST', { ...body, requestId: 'daily-brief:reserved' }))).status, 400);
  assert.equal(calls, 0);
  initializeBriefPipeline();
  const first = await (await route.POST(request('POST', body))).json();
  assert.ok(first.edition.editorial); assert.equal(calls, 1);
  assert.equal((await (await route.POST(request('POST', body))).json()).edition.id, first.edition.id);
  assert.equal(calls, 1);
  const read = await (await route.GET(request('GET', null, `?edition=${first.edition.id}`))).json();
  assert.deepEqual(read, first);
  assert.ok(read.notification.url.endsWith(first.edition.id));
  assert.equal((await route.GET(request('GET', null, '?edition=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))).status, 404);
  assert.equal((await route.POST(request('POST', { ...body, requestId: 'fixture-live', input: 'live', delivery: { expiresAt: Date.now() + 60000 } }))).status, 200);
  assert.equal(inputs.at(-1), 'live'); assert.equal(calls, 2);
});
