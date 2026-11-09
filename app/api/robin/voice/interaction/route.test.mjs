import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createJiti } from 'jiti';
const dir = mkdtempSync(join(tmpdir(), 'voice-interaction-route-'));
const previous = process.env.ROBIN_DATA_DIR; process.env.ROBIN_DATA_DIR = dir;
const stub = join(dir, 'assistant.mjs');
writeFileSync(stub, 'export const runRobinVoiceTurn = (...args) => globalThis.__voiceRun(...args);');
const jiti = createJiti(import.meta.url, { alias: { '@/lib/robin-assistant': stub, '@': process.cwd() }, moduleCache: false });
const { POST, GET } = await jiti.import('./route.ts');
const { withVoiceTaskScope, executeVoiceTask } = await jiti.import(process.cwd() + '/extension/robin/voice-action-domain.ts');
after(() => { delete globalThis.__voiceRun; rmSync(dir, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const input = () => ({ requestId: `${Date.now()}-${randomUUID()}`, message: '明天去喂鱼', allowTasks: true });
const request = (body, origin = 'http://localhost:30141') => new Request('http://localhost:30141/api/robin/voice/interaction', { method: 'POST', headers: { host: 'localhost:30141', origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('bounded, guarded input; invalid requests do not call Robin', async () => {
  globalThis.__voiceRun = () => assert.fail('not dispatched');
  assert.equal((await POST(request({ ...input(), allowTasks: undefined }))).status, 400);
  assert.equal((await POST(request({ ...input(), message: 'x'.repeat(25_000) }))).status, 413);
  assert.equal((await POST(request(input(), 'https://attacker.invalid'))).status, 403);
});
test('actual task receipt overrides invented model output, replay does not dispatch again', async () => {
  let calls = 0;
  globalThis.__voiceRun = async (id, prompt, allowed) => {
    calls++; assert.equal(allowed, true); assert.match(prompt, /same Robin/); assert.match(prompt, /not a promise|not turn a todo date/);
    await withVoiceTaskScope('fixture', id, async () => executeVoiceTask('fixture', { action: 'add', title: '喂鱼', due: '2030-01-02' }));
    return { final: 'not even JSON', sessionId: 'fixture' };
  };
  const body = input(), response = await POST(request(body));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json(); assert.equal(result.state, 'done'); assert.equal(result.receipt.title, '喂鱼');
  assert.match(result.spoken, /2030-01-02/);
  assert.deepEqual(await (await POST(request(body))).json(), result); assert.equal(calls, 1);
  const get = await GET(new Request(`http://localhost:30141/api/robin/voice/interaction?id=${body.requestId}`, { headers: { host: 'localhost:30141' } }));
  assert.deepEqual(await get.json(), result);
});
test('disconnect cannot turn saved action into cancellation; provider errors never leak', async () => {
  const gate = Promise.withResolvers(), started = Promise.withResolvers();
  globalThis.__voiceRun = async (id, _prompt, _allow, ...rest) => {
    assert.equal(rest.length, 0, 'no browser AbortSignal reaches write turn');
    started.resolve(); await gate.promise;
    await withVoiceTaskScope('fixture', id, async () => executeVoiceTask('fixture', { action: 'add', title: 'saved after disconnect' }));
    throw new Error('SECRET provider error');
  };
  const controller = new AbortController(), body = input();
  const pending = POST(new Request(request(body), { signal: controller.signal }));
  await started.promise; controller.abort(); gate.resolve();
  const result = await (await pending).json(); assert.equal(result.state, 'done'); assert.equal(result.receipt.title, 'saved after disconnect');
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  globalThis.__voiceRun = () => { throw new Error('SECRET'); };
  const uncertain = await (await POST(request(input()))).json();
  assert.equal(uncertain.state, 'uncertain'); assert.ok(!JSON.stringify(uncertain).includes('SECRET'));
});
test('read-only voice cannot gain a receipt from model words', async () => {
  globalThis.__voiceRun = async (_id, _prompt, allowed) => {
    assert.equal(allowed, false);
    return { final: JSON.stringify({ answer: '我已经创建了任务', spoken: '我已经创建了任务' }), sessionId: 'fixture' };
  };
  const result = await (await POST(request({ ...input(), allowTasks: false }))).json();
  assert.equal(result.receipt, undefined); assert.match(result.answer, /没有已确认/);
});
