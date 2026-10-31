import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('CLI is explicit, shadow-only, idempotent across processes, and status omits private item text', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-cli-test-'));
  const run = (...args) => execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/robin-brief.ts', ...args], {
    cwd: process.cwd(), env: { ...process.env, ROBIN_DATA_DIR: root, NODE_NO_WARNINGS: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000,
  });
  try {
    assert.equal(JSON.parse(run('status')).initialized, false); assert.deepEqual(readdirSync(root), []);
    assert.throws(() => run('shadow', 'fixture-cli'), /not initialized/);
    assert.throws(() => run('generate'), /Usage/);
    run('init');
    const first = JSON.parse(run('shadow', 'fixture-cli'));
    const retry = JSON.parse(run('shadow', 'fixture-cli'));
    assert.equal(first.id, retry.id); assert.equal(first.revision, 1); assert.equal(first.mode, 'shadow');
    const status = JSON.parse(run('status'));
    assert.equal(status.edition.id, first.id); assert.equal(status.edition.items, undefined);
    const full = JSON.parse(run('inspect', 'fixture-cli'));
    assert.equal(full.inputs.length, 4); assert.equal(full.edition.mode, 'shadow');
    assert.ok(readdirSync(root).every(file => ['brief.sqlite', 'brief.sqlite-wal', 'brief.sqlite-shm'].includes(file)), 'Only the new Brief database and SQLite sidecars exist; no legacy domain was written');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('acquire CLI uses only mocked Gmail GETs, preserves legacy records, and never prints private bodies', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-acquire-cli-'));
  const google = JSON.stringify({ refreshToken: 'fixture', accessToken: 'fixture', accessTokenExpiresAt: Date.now() + 3600_000, email: 'fixture@example.test' });
  const legacy = '{"fixture":"unchanged"}';
  writeFileSync(join(root, 'google.json'), google, { mode: 0o600 });
  writeFileSync(join(root, 'mail-review.json'), legacy);
  const run = args => execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { main } from './scripts/robin-brief.ts';
    globalThis.fetch = async (url, init) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://gmail.googleapis.com');
      assert.ok(!init.method || init.method === 'GET');
      if (parsed.pathname.endsWith('/profile')) return Response.json({ emailAddress:'fixture@example.test', historyId:'100' });
      if (parsed.pathname.endsWith('/messages')) return Response.json({ messages:[{id:'a1'}] });
      if (parsed.pathname.endsWith('/history')) return Response.json({ historyId:'100' });
      return Response.json({ id:'a1', labelIds:['INBOX'], internalDate:String(Date.now()), snippet:'private fixture summary',
        payload: { mimeType:'text/plain', headers:[{name:'Subject',value:'private fixture subject'}], body:{data:Buffer.from('private fixture body').toString('base64url')} } });
    };
    await main(${JSON.stringify(args)});
  `], { cwd: process.cwd(), env: { ...process.env, ROBIN_DATA_DIR: root, NODE_NO_WARNINGS: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 });
  try {
    run(['init']);
    assert.throws(() => run(['upgrade']), /Usage/);
    assert.equal(JSON.parse(run(['upgrade', '--writers-stopped'])).automationEnabled, false);
    const output = run(['acquire', 'fixture-live-input']);
    assert.ok(!output.includes('private fixture')); const receipt = JSON.parse(output);
    assert.equal(receipt.itemCount, 1); assert.equal(receipt.mode, 'shadow');
    assert.equal(JSON.parse(run(['acquire', 'fixture-live-input'])).id, receipt.id);
    const details = JSON.parse(run(['inspect', 'fixture-live-input']));
    assert.equal(details.inputProfile, 'gmail-v1'); assert.ok(details.requestsReserved > 0);
    assert.ok(JSON.stringify(details).includes('private fixture body'));
    assert.equal(readFileSync(join(root, 'google.json'), 'utf8'), google);
    assert.equal(readFileSync(join(root, 'mail-review.json'), 'utf8'), legacy);
    assert.ok(readdirSync(root).every(file => ['google.json', 'mail-review.json', 'brief.sqlite', 'brief.sqlite-wal', 'brief.sqlite-shm'].includes(file)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
