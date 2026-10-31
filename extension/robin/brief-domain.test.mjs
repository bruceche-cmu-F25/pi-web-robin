import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import { briefPipelineStatus, briefRunDetails, initializeBriefPipeline, runShadowBrief } from './brief-domain.ts';
const previous = process.env.ROBIN_DATA_DIR;
let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'robin-brief-test-')); process.env.ROBIN_DATA_DIR = root; });
afterEach(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const scope = { day: '2026-10-30', timezone: 'America/Los_Angeles' };
const instant = Date.parse('2026-10-30T15:00:00Z');
const input = (source, coverage = 'ready') => ({ source, coverage, observedAt: new Date(instant).toISOString(), detail: 'Synthetic stored input', items: [] });
const deps = (collect = source => input(source)) => ({ scope, collect, now: () => instant });
function sql(text) { const db = new DatabaseSync(join(root, 'brief.sqlite')); try { db.exec(text); } finally { db.close(); } }

test('status creates nothing; initialization is explicit and idempotent; no legacy data touched', async () => {
  assert.equal(briefPipelineStatus().initialized, false); assert.deepEqual(readdirSync(root), []);
  await assert.rejects(runShadowBrief('request-one', deps()), /not initialized/);
  writeFileSync(join(root, 'mail-review.json'), '{"fixture":"untouched"}');
  initializeBriefPipeline(); initializeBriefPipeline();
  assert.equal(briefPipelineStatus().initialized, true);
  assert.deepEqual(readdirSync(root).sort(), ['brief.sqlite', 'mail-review.json']);
});

test('same request returns exactly one immutable version; a new request creates a new version', async () => {
  initializeBriefPipeline(); let calls = 0;
  const first = await runShadowBrief('request-one', deps(source => { calls++; return input(source); }));
  const retry = await runShadowBrief('request-one', deps(() => { throw new Error('must not collect again'); }));
  assert.deepEqual(retry, first); assert.equal(calls, 4); assert.equal(first.mode, 'shadow');
  const second = await runShadowBrief('request-two', deps());
  assert.equal(second.revision, first.revision + 1); assert.notEqual(second.id, first.id);
  assert.deepEqual(briefRunDetails('request-one').edition, first);
  assert.deepEqual(briefRunDetails('request-one').steps.slice(-2).map(s => s.stage), ['publish', 'close']);
});

test('failed acquisition resumes from saved source results, not a second full scan', async () => {
  initializeBriefPipeline();
  await assert.rejects(runShadowBrief('resume-one', deps(source => source === 'calendar' ? { ...input(source), source: 'wrong' } : input(source))), /Invalid brief/);
  assert.equal(briefRunDetails('resume-one').inputs.length, 1);
  const called = [];
  await runShadowBrief('resume-one', deps(source => { called.push(source); return input(source); }));
  assert.deepEqual(called, ['calendar', 'todos', 'world']);
  assert.equal(briefPipelineStatus().runs[0].stage, 'done');
});

test('source failures are coverage gaps; total failure preserves prior edition; unavailable inputs can retry', async () => {
  initializeBriefPipeline(); const old = await runShadowBrief('old-edition', deps());
  await assert.rejects(runShadowBrief('failed-new', deps(() => { throw new Error('secret upstream token'); })), /No usable sources/);
  assert.equal(briefPipelineStatus().edition.id, old.id);
  assert.ok(!JSON.stringify(briefRunDetails('failed-new')).includes('secret'));
  const recovered = await runShadowBrief('failed-new', deps());
  assert.equal(recovered.revision, 2);
});

test('concurrent contenders cannot claim while an owner is live', async () => {
  initializeBriefPipeline(); let release;
  const first = runShadowBrief('first-worker', deps(source => source === 'mail' ? new Promise(resolve => { release = () => resolve(input(source)); }) : input(source)));
  await assert.rejects(runShadowBrief('second-worker', deps()), /already running/);
  release(); await first;
});

test('expired worker cannot publish or mark its replacement failed', async () => {
  initializeBriefPipeline(); let release; let clock = instant;
  const old = runShadowBrief('same-request', { ...deps(source => source === 'mail' ? new Promise(resolve => { release = () => resolve(input(source)); }) : input(source)), now: () => clock });
  clock += 61_000;
  assert.equal(briefPipelineStatus(clock).runs[0].interrupted, true);
  const replacement = await runShadowBrief('same-request', { ...deps(), now: () => clock });
  release(); await assert.rejects(old, /ownership expired/);
  assert.equal(briefPipelineStatus(clock).edition.id, replacement.id);
  assert.equal(briefPipelineStatus(clock).runs[0].stage, 'done');
});

test('publication rollback cannot leave a completed run or partial edition; retry uses saved inputs', async () => {
  initializeBriefPipeline();
  sql("CREATE TRIGGER fixture_failure BEFORE INSERT ON brief_editions BEGIN SELECT RAISE(ABORT, 'fixture publication failure'); END;");
  await assert.rejects(runShadowBrief('atomic-test', deps()), /fixture publication failure/);
  assert.equal(briefPipelineStatus().edition, null); assert.equal(briefPipelineStatus().runs[0].stage, 'failed');
  assert.equal(briefRunDetails('atomic-test').inputs.length, 4);
  sql('DROP TRIGGER fixture_failure');
  const result = await runShadowBrief('atomic-test', deps(() => { throw new Error('already saved'); }));
  assert.equal(result.revision, 1);
});

test('abort ends promptly without publishing or advancing an unsaved source', async () => {
  initializeBriefPipeline(); const controller = new AbortController();
  const pending = runShadowBrief('cancel-test', { ...deps(() => new Promise(() => {})), signal: controller.signal });
  controller.abort(new Error('fixture cancellation'));
  await assert.rejects(pending, /fixture cancellation/);
  assert.equal(briefRunDetails('cancel-test').inputs.length, 0);
  assert.equal(briefPipelineStatus().runs[0].failure, 'cancelled-or-deadline');
});

test('corrupt/newer databases are never overwritten or silently reinitialized', () => {
  writeFileSync(join(root, 'brief.sqlite'), 'not sqlite');
  assert.throws(() => initializeBriefPipeline()); assert.throws(() => briefPipelineStatus());
  rmSync(join(root, 'brief.sqlite')); initializeBriefPipeline(); sql('PRAGMA user_version = 99');
  assert.throws(() => initializeBriefPipeline(), /Unsupported/); assert.throws(() => briefPipelineStatus(), /Unsupported/);
});
