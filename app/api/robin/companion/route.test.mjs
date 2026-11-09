import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createJiti } from 'jiti';
const dir = mkdtempSync(join(tmpdir(), 'companion-route-'));
const stub = join(dir, 'assistant.mjs');
writeFileSync(stub, 'export const runAssistantTurn = (...args) => globalThis.__companionRun(...args);');
const { POST } = await createJiti(import.meta.url, { alias: { '@/lib/robin-assistant': stub, '@': process.cwd() }, moduleCache: false }).import('./route.ts');
after(() => { delete globalThis.__companionRun; rmSync(dir, { recursive: true, force: true }); });
const request = body => new Request('http://localhost:30141/api/robin/companion', { method: 'POST', headers: { host: 'localhost:30141', 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('always read-only regardless of client flags, typed receipt and no caching', async () => {
  let calls = 0;
  globalThis.__companionRun = async (mode, prompt, images, model, signal) => {
    calls++; assert.equal(mode, 'readOnly'); assert.match(prompt, /not an execution channel/); assert.deepEqual(images, []); assert.equal(model, undefined); assert.ok(signal);
    return { reply: '{"answer":"Not executed.","spoken":"Not executed."}', sessionId: 'trace', usedTools: [] };
  };
  const response = await POST(request({ message: 'send this', mode: 'default', tools: ['todo_add'] }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).actionState, 'not-executed'); assert.equal(calls, 1);
});
test('invalid and oversized requests never dispatch', async () => {
  globalThis.__companionRun = () => assert.fail('must not dispatch');
  assert.equal((await POST(request({ message: '' }))).status, 400);
  assert.equal((await POST(request({ message: 'x'.repeat(250000) }))).status, 413);
});
test('provider errors are unconfirmed, redacted and not retried', async () => {
  let calls = 0;
  globalThis.__companionRun = () => { calls++; throw new Error('SECRET provider detail'); };
  const response = await POST(request({ message: 'hello' }));
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { code: 'unconfirmed' }); assert.equal(calls, 1);
});
test('disconnect cancels this read-only turn and refuses even a late result', async () => {
  const controller = new AbortController(); const started = Promise.withResolvers();
  globalThis.__companionRun = async (_mode, _prompt, _images, _model, signal) => {
    started.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return { reply: '{"answer":"late","spoken":"late"}', sessionId: 'late', usedTools: [] };
  };
  const response = POST(new Request(request({ message: 'hello' }), { signal: controller.signal }));
  await started.promise; controller.abort(); const result = await response;
  assert.equal(result.status, 503); assert.deepEqual(await result.json(), { code: 'cancelled' });
});
