import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import { initializeBriefPipeline, upgradeBriefPipeline, briefPipelineStatus, runShadowBrief } from './brief-domain.ts';
const previous = process.env.ROBIN_DATA_DIR;
let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'brief-upgrade-')); process.env.ROBIN_DATA_DIR = root; });
afterEach(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
function withDb(fn, file = join(root, 'brief.sqlite')) { const db = new DatabaseSync(file); try { return fn(db); } finally { db.close(); } }
function makeV1() {
  withDb(db => db.exec(`DROP TABLE brief_source_items; DROP TABLE brief_evidence; DROP TABLE brief_source_state; DROP TABLE brief_budgets;
    ALTER TABLE brief_runs DROP COLUMN input_profile; PRAGMA user_version = 1;`));
}
const deps = { scope: { day: '2026-10-30', timezone: 'UTC' }, collect: source => ({ source, observedAt: '2026-10-30T15:00:00Z', coverage: 'ready', detail: 'fixture', items: [] }) };

test('v1 is never upgraded by init/read/run; explicit offline upgrade preserves editions and makes a verified backup', async () => {
  initializeBriefPipeline(); const edition = await runShadowBrief('stored-edition', deps);
  makeV1();
  assert.throws(() => briefPipelineStatus(), /explicit offline upgrade/);
  assert.throws(() => initializeBriefPipeline(), /explicit offline upgrade/);
  await assert.rejects(runShadowBrief('must-not-upgrade', deps), /explicit offline upgrade/);
  assert.throws(() => upgradeBriefPipeline(false), /Stop all Brief writers/);
  const backup = upgradeBriefPipeline(true);
  assert.ok(backup.startsWith(root));
  assert.equal(withDb(db => db.prepare('PRAGMA user_version').get().user_version, join(backup, 'brief.sqlite')), 1);
  assert.equal(withDb(db => db.prepare('SELECT COUNT(*) AS n FROM brief_editions').get().n, join(backup, 'brief.sqlite')), 1);
  if (process.platform !== 'win32') assert.equal(statSync(join(backup, 'brief.sqlite')).mode & 0o777, 0o600);
  assert.deepEqual(await runShadowBrief('stored-edition', deps), edition);
  assert.equal(upgradeBriefPipeline(true), null);
  assert.equal(readdirSync(root).filter(n => n.startsWith('.brief-v1-backup-')).length, 1);
});

test('offline upgrade refuses a live owner and rolls back schema changes on failure', () => {
  initializeBriefPipeline(); makeV1();
  withDb(db => db.prepare("INSERT INTO brief_runs VALUES('id', 'request', '2026-10-30', 'UTC', 'owner', ?, 'harvest', '2026-10-30T15:00:00Z', NULL, NULL)").run(Date.now() + 60_000));
  assert.throws(() => upgradeBriefPipeline(true), /live lease/);
  assert.equal(withDb(db => db.prepare('PRAGMA user_version').get().user_version), 1);
  withDb(db => db.exec("UPDATE brief_runs SET lease_until=0; CREATE TABLE brief_evidence (fixture TEXT)"));
  assert.throws(() => upgradeBriefPipeline(true), /already exists/);
  assert.equal(withDb(db => db.prepare('PRAGMA user_version').get().user_version), 1);
  assert.ok(!withDb(db => db.prepare('PRAGMA table_info(brief_runs)').all()).some(c => c.name === 'input_profile'));
});

test('upgrade neither initializes absent storage nor overwrites a future schema', () => {
  assert.throws(() => upgradeBriefPipeline(true), /not initialized/); assert.deepEqual(readdirSync(root), []);
  initializeBriefPipeline(); withDb(db => db.exec('PRAGMA user_version=999'));
  assert.throws(() => upgradeBriefPipeline(true), /Unsupported/);
  assert.equal(withDb(db => db.prepare('PRAGMA user_version').get().user_version), 999);
});
