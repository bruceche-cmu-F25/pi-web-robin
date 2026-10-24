import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { RobinReadOnlyBackend } from './robin-backend.mjs';

const work = (id = 'task-1', extra = {}) => ({ id, ownerId: 'robin-local', instruction: '我今天有什么待办？', ...extra });
const answer = () => Response.json({ reply: '今天有两个待办。', usedTools: ['todo_list'], sessionId: 'private-session' });
function fixture({ hold = false, ...options } = {}) {
  const started = Promise.withResolvers();
  const calls = [];
  const backend = new RobinReadOnlyBackend({
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      if (init.method !== 'POST') return Response.json({ sessionId: 'private' });
      started.resolve();
      if (hold) await new Promise((resolve, reject) => {
        init.signal.throwIfAborted();
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
      return answer();
    },
    ...options,
  });
  return { backend, calls, started: started.promise, work: work(), nextWork: work('task-2') };
}

test('fixed loopback endpoint and read-only body; no protocol/context fields reach Robin', async () => {
  const { backend, calls } = fixture({ password: 'local-test-password' });
  const outcome = await backend.submit(work('task-1', {
    mode: 'default', tools: ['bash'], conversation: 'secret history', cwd: '/private', model: 'other',
  }));
  assert.deepEqual(outcome, { content: '今天有两个待办。', artifacts: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:30141/api/robin/assistant');
  assert.deepEqual(JSON.parse(calls[0].body), { mode: 'readOnly', message: '我今天有什么待办？' });
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from('pi:local-test-password').toString('base64')}`);
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[0].headers.Origin, 'http://127.0.0.1:30141');
  assert.equal(JSON.stringify(backend).includes('password'), false);
});

test('invalid targets, untrusted owners, attachments, empty inputs and resume are rejected before HTTP', async () => {
  for (const origin of ['https://example.com', 'file:///tmp/x', 'http://localhost/api', 'http://pi:secret@localhost', 'http://localhost/?x=1']) {
    assert.throws(() => new RobinReadOnlyBackend({ origin }), /loopback/);
  }
  const { backend, calls } = fixture();
  for (const task of [{}, work('a', { ownerId: 'stranger' }), work('b', { inputParts: [{}] }), work('c', { resumeContext: {} }), work('d', { instruction: ' ' })]) {
    await assert.rejects(backend.submit(task));
  }
  assert.equal(calls.length, 0);
  await assert.rejects(backend.respondAuthorization(), /does not support/);
  await assert.rejects(backend.respondInput(), /does not support/);
});

test('duplicate admission is atomic, owner isolated, and cancelled IDs are not replayed', async () => {
  const { backend, calls, started } = fixture({ hold: true });
  const pending = backend.submit(work());
  const rejected = assert.rejects(pending, { code: 'WORK_CANCELLED' });
  await assert.rejects(backend.submit(work()), /already active/);
  await started;
  assert.equal(backend.status('task-1', { ownerId: 'stranger' }).state, 'not_found');
  await assert.rejects(backend.cancel('task-1', { ownerId: 'stranger' }));
  assert.equal(calls[0].signal.aborted, false);
  assert.deepEqual(await backend.cancel('task-1', { ownerId: 'robin-local' }), { taskId: 'task-1', state: 'cancelled' });
  await rejected;
  assert.equal(backend.status('task-1').state, 'not_found');
  await assert.rejects(backend.submit(work()), /already submitted/);
  assert.equal(calls.length, 1);
});

test('completed and failed task IDs cannot trigger duplicate billing', async () => {
  const good = fixture();
  await good.backend.submit(work());
  await assert.rejects(good.backend.submit(work()), /already submitted/);
  assert.equal(good.calls.length, 1);
  let count = 0;
  const bad = fixture({ fetchImpl: async () => { count++; throw new Error('private-secret'); } });
  await assert.rejects(bad.backend.submit(work()), error => !error.message.includes('private-secret'));
  await assert.rejects(bad.backend.submit(work()), /already submitted/);
  assert.equal(count, 1);
});

test('caller abort, close and timeout stop delivery; close and start are idempotent', async () => {
  for (const kind of ['caller', 'close', 'timeout']) {
    const controller = new AbortController();
    const { backend, started } = fixture({ hold: true, timeoutMs: kind === 'timeout' ? 10 : 1_000 });
    await backend.start();
    await backend.start();
    const rejection = assert.rejects(backend.submit(work(), { signal: controller.signal }), { code: 'WORK_CANCELLED' });
    await started;
    // AbortSignal.timeout is unref'ed; hold the test process while it fires.
    const keepAlive = setTimeout(() => {}, 1_000);
    try {
      if (kind === 'caller') controller.abort();
      if (kind === 'close') await backend.close();
      await rejection;
    } finally { clearTimeout(keepAlive); }
    await backend.close();
    await backend.close();
    await assert.rejects(backend.start(), /closed/);
    await assert.rejects(backend.submit(work('later')), /closed/);
  }
});

test('pre-aborted queries make no request and late replies are discarded', async () => {
  const first = fixture();
  await assert.rejects(first.backend.submit(work(), { signal: AbortSignal.abort() }));
  assert.equal(first.calls.length, 0);
  const late = Promise.withResolvers();
  const second = fixture({ fetchImpl: () => late.promise });
  const pending = second.backend.submit(work());
  await second.backend.cancel('task-1');
  late.resolve(answer());
  await assert.rejects(pending, { code: 'WORK_CANCELLED' });
});

test('listener faults/mutations are isolated and unsubscribe stops notifications', async () => {
  const { backend } = fixture();
  const events = [];
  backend.subscribe(event => { event.ownerId = 'wrong'; throw new Error('observer'); });
  const unsubscribe = backend.subscribe(event => events.push(event));
  await backend.submit(work());
  assert.equal(events.length, 1);
  assert.equal(events[0].ownerId, 'robin-local');
  assert.equal(events[0].type, 'backend.activity');
  unsubscribe();
  await backend.submit(work('next'));
  assert.equal(events.length, 1);
});

test('health checks are model-free; auth and malformed responses fail without leaking server bodies', async () => {
  const { backend, calls } = fixture();
  assert.equal((await backend.health()).ok, false);
  await backend.start();
  assert.equal((await backend.health()).ok, true);
  assert.equal(calls[0].method, undefined);
  for (const result of [new Response('private-secret', { status: 401 }), Response.json({ reply: '' }), new Response('not-json')]) {
    const failing = fixture({ fetchImpl: async () => result });
    await assert.rejects(failing.backend.submit(work()), error => /failed/.test(error.message) && !error.message.includes('private-secret'));
  }
});

test('real HTTP transport: one read-only POST, no redirect following, socket closes on cancel', async () => {
  const held = Promise.withResolvers();
  const disconnected = Promise.withResolvers();
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    if (body.message === 'hold') {
      res.on('close', () => disconnected.resolve());
      held.resolve();
    } else if (body.message === 'redirect') {
      res.writeHead(307, { location: '/must-not-follow' }).end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ reply: 'local fixture' }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const backend = new RobinReadOnlyBackend({ origin: `http://127.0.0.1:${server.address().port}` });
  try {
    assert.equal((await backend.submit(work())).content, 'local fixture');
    await assert.rejects(backend.submit(work('redirect', { instruction: 'redirect' })));
    const rejection = assert.rejects(backend.submit(work('held', { instruction: 'hold' })), { code: 'WORK_CANCELLED' });
    await held.promise;
    await backend.cancel('held');
    await rejection;
    await disconnected.promise;
    assert.equal(requests.length, 3);
    assert.ok(requests.every(body => body.mode === 'readOnly'));
  } finally {
    await backend.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

// Public SDK source entry: no installing/running upstream scripts, services or models.
const source = process.env.QWAUDIO_SOURCE;
test('upstream public conformance + BackendWorkRuntime composition', { skip: !source }, async () => {
  const sdk = await import(pathToFileURL(resolve(source, 'server/src/backend/backend-adapter-sdk.mjs')).href);
  assert.equal(sdk.BACKEND_ADAPTER_SDK_VERSION, '3.0.0');
  await sdk.verifyBackendAdapterConformance({ createFixture: async options => fixture(options) });
  const { backend, calls } = fixture();
  const host = sdk.createBackendAgentHost(backend);
  const runtime = new sdk.BackendWorkRuntime({ backend: host });
  const result = await runtime.run({ objective: '我今天有什么待办？', conversation: { secret: true } }, {
    taskId: 'gateway-task', ownerId: 'robin-local',
  });
  assert.deepEqual(result, { content: '今天有两个待办。', artifacts: [] });
  assert.deepEqual(JSON.parse(calls[0].body), { mode: 'readOnly', message: '我今天有什么待办？' });
  await host.close();
});
