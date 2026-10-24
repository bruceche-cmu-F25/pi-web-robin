import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { createJiti } from 'jiti';

const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), 'robin-act-route-'));
process.env.ROBIN_DATA_DIR = dir;
const stub = join(dir, 'runtime.mjs');
writeFileSync(stub, `
export const resolveMode = body => body.mode ?? 'default';
export const runAssistantTurn = (...args) => globalThis.__actRoute.run(...args);
export const getRpcSession = id => globalThis.__actRoute.live.get(id);
`);
const jiti = createJiti(import.meta.url, { alias: { '@/lib/robin-assistant': stub, '@/lib/rpc-manager': stub, '@': process.cwd() }, moduleCache: false });
const { GET, POST } = await jiti.import('./route.ts');
const sessions = await jiti.import('../../../../extension/robin/assistant-sessions.ts');
after(() => {
  delete globalThis.__actRoute;
  rmSync(dir, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
});
beforeEach(() => {
  rmSync(join(dir, 'assistant.json'), { force: true });
  globalThis.__actRoute = { live: new Map(), run() { throw new Error('GET must never start an agent'); } };
});
const request = (method, body) => new Request('http://localhost:30141/api/robin/assistant', {
  method, headers: { host: 'localhost:30141', 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('Act trace reads do not create or resume sessions, and do not expose other modes', async () => {
  sessions.writeCoachSessionId('coach-private');
  const before = readFileSync(sessions.assistantStatePath(), 'utf8');
  const response = await GET(request('GET'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { sessionId: null, running: false });
  assert.equal(readFileSync(sessions.assistantStatePath(), 'utf8'), before);
});
test('Act records remain readable when idle; running reflects the live wrapper', async () => {
  sessions.writeAssistantSessionId('act-record');
  assert.deepEqual(await (await GET(request('GET'))).json(), { sessionId: 'act-record', running: false });
  globalThis.__actRoute.live.set('act-record', { isRunning: () => true });
  assert.deepEqual(await (await GET(request('GET'))).json(), { sessionId: 'act-record', running: true });
  globalThis.__actRoute.live.set('act-record', { isRunning: () => false });
  assert.deepEqual(await (await GET(request('GET'))).json(), { sessionId: 'act-record', running: false });
});
test('read-only requests pass disconnect cancellation to the scoped turn', async () => {
  const controller = new AbortController();
  const req = new Request(request('POST', { mode: 'readOnly', message: 'List my todos' }), { signal: controller.signal });
  const started = Promise.withResolvers();
  globalThis.__actRoute.run = async (mode, message, images, model, signal) => {
    assert.equal(mode, 'readOnly');
    assert.equal(signal, req.signal);
    started.resolve();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    throw new Error('Generation stopped.');
  };
  const response = POST(req);
  await Promise.race([started.promise, response]);
  controller.abort();
  const result = await response;
  assert.equal(result.status, 500);
  assert.equal((await result.json()).error, 'Generation stopped.');
});

test('write-capable requests keep running independently of HTTP disconnect', async () => {
  globalThis.__actRoute.run = async (...args) => {
    assert.equal(args[4], undefined);
    return { reply: 'Done', usedTools: [], sessionId: 'write-session' };
  };
  assert.equal((await POST(request('POST', { message: 'Do this' }))).status, 200);
});

test('Act reply retains its exact execution session for the trace link', async () => {
  let calls = 0;
  globalThis.__actRoute.run = async (mode, message) => {
    calls++; assert.equal(mode, 'default'); assert.equal(message, 'Do this');
    return { reply: 'Done', usedTools: ['todo_add'], sessionId: 'exact-record' };
  };
  const response = await POST(request('POST', { message: 'Do this' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: 'Done', usedTools: ['todo_add'], sessionId: 'exact-record' });
  assert.equal(calls, 1);
});
