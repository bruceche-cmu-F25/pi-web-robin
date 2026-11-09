import assert from 'node:assert/strict';
import { test, after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJiti } from 'jiti';
const dir = mkdtempSync(join(tmpdir(), 'robin-realtime-'));
process.env.ROBIN_DATA_DIR = dir;
const jiti = createJiti(import.meta.url);
const { createRealtimeCredential, realtimeReadiness } = await jiti.import('./realtime-domain.ts');
const signal = () => new AbortController().signal;
const env = { BOSON_API_KEY: 'server-only-fixture' };
const ok = () => Response.json({ value: 'bai-eph-test', expires_at: Math.floor(Date.now()/1000)+60, ignored: 'never-return-this' });
beforeEach(() => { delete globalThis.__robinRealtimeMints; });
after(() => { delete globalThis.__robinRealtimeMints; rmSync(dir, { recursive:true, force:true }); });
test('readiness is presence only; missing key never calls network', async () => {
  assert.equal(typeof realtimeReadiness().configured, 'boolean');
  await assert.rejects(createRealtimeCredential(signal(), { env:{}, fetch:()=>assert.fail() }), { code:'setup' });
});
test('fixed endpoint, short TTL, no redirects and only an ephemeral value leaves server', async () => {
  const result = await createRealtimeCredential(signal(), { env, fetch:async (url, options) => {
    assert.equal(url, 'https://api.boson.ai/v1/realtime/client_secrets');
    assert.equal(options.headers.Authorization, 'Bearer server-only-fixture');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { expires_after:{seconds:60} });
    return ok();
  } });
  assert.deepEqual(Object.keys(result).sort(), ['expiresAt','secret']);
  assert.equal(result.secret, 'bai-eph-test');
  assert.ok(!JSON.stringify(result).includes('server-only-fixture'));
});
test('provider failures are safe codes, not upstream bodies or credentials', async () => {
  for (const [status,code] of [[401,'auth'],[429,'quota'],[500,'provider']]) {
    await assert.rejects(createRealtimeCredential(signal(), {env, fetch:async()=>new Response('private-error', {status})}), {code});
  }
  await assert.rejects(createRealtimeCredential(signal(), {env, fetch:async()=>{throw new Error('secret');}}), e=>e.code==='provider'&&!e.message.includes('secret'));
});
test('oversized, expired and long-lived credentials are rejected', async () => {
  for (const body of [{value:'real-server-key',expires_at:Date.now()/1000+60}, {value:'bai-eph-expired',expires_at:1}, {value:'bai-eph-long',expires_at:Math.floor(Date.now()/1000)+7200}]) {
    await assert.rejects(createRealtimeCredential(signal(), {env,fetch:async()=>Response.json(body)}), {code:'provider'});
  }
  await assert.rejects(createRealtimeCredential(signal(), {env,fetch:async()=>new Response('x'.repeat(20_000))}), {code:'provider'});
});
test('abort cancels the broker; reconnect storms are bounded with no retries', async () => {
  const controller = new AbortController();
  const pending = createRealtimeCredential(controller.signal, {env,fetch:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))))});
  controller.abort(); await assert.rejects(pending, {code:'cancelled'});
  delete globalThis.__robinRealtimeMints;
  for(let i=0;i<10;i++) await createRealtimeCredential(signal(),{env,fetch:async()=>ok()});
  await assert.rejects(createRealtimeCredential(signal(),{env,fetch:()=>assert.fail('rate limited before fetch')}),{code:'busy'});
});
