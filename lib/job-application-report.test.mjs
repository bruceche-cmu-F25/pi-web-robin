import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { applicationBoard, applicationPreferencesHash, configureApplications, holdUnverifiedApplication, recordDailyApplicationCheck, reserveApplication, saveApplicationResult } from '../extension/robin/job-application-domain.ts';
import { DEFAULT_APPLICATION_SETTINGS } from '../extension/robin/job-applications.ts';
import { DEFAULT_JOB_PROFILE } from '../extension/robin/jobs.ts';
import { readJobs, writeJobs, writeJobProfile } from '../extension/robin/store.ts';
import { resetTaskStore } from '../extension/robin/task-store.test-support.mjs';
import { readRuntimeState, updateRuntimeState } from '../extension/robin/task-store.ts';
import { createDeliveryLedger } from '../extension/robin/delivery-ledger.ts';
import { tickApplicationReport } from './job-application-runner.ts';
const previous = process.env.ROBIN_DATA_DIR;
const at = new Date('2026-10-25T17:00:00Z'), due = new Date('2026-10-26T01:30:00Z');
let root, calls;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'job-report-')); process.env.ROBIN_DATA_DIR = root; resetTaskStore(root); calls = [];
  writeJobProfile({ ...DEFAULT_JOB_PROFILE, notes: 'Confirmed preferences' });
  const pdf = Buffer.from('%PDF-1.0\nsynthetic'); const path = join(root, 'resume.pdf'); writeFileSync(path, pdf);
  configureApplications({ ...DEFAULT_APPLICATION_SETTINGS, enabled: true, resumePath: path,
    resumeHash: createHash('sha256').update(pdf).digest('hex'), preferencesHash: applicationPreferencesHash() });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const job = id => ({ id, company: 'Example', title: `Engineer ${id}`, source: 'greenhouse', status: 'new', location: 'US',
  url: `https://job-boards.greenhouse.io/example/jobs/${id}`, discoveredAt: at.toISOString() });
const deps = extra => ({ env: { ROBIN_JOB_APPLICATION_REPORT_ENABLED: '1' }, allowed: () => true,
  subscriptionCount: async () => 1, send: async note => { calls.push(note); return { accepted: 1, failed: 0, expired: 0 }; }, ...extra });
test('nightly pipeline check records supply, failures and unknown causes once without form data or browser actions', () => {
  writeJobs([job('1'), job('2')]);
  const settings = configureApplications({ dailyLimit: 20 });
  const first = reserveApplication('1', settings, at);
  saveApplicationResult('1', first.application.attemptId, { stage: 'error', fields: [],
    blockers: ['JOBRIGHT_INCOMPLETE: private form answer'], resumeVerified: false });
  const second = reserveApplication('2', settings, at);
  saveApplicationResult('2', second.application.attemptId, { stage: 'error', fields: [],
    blockers: ['private unknown employer failure'], resumeVerified: false });
  const time = new Date('2026-10-26T02:30:00Z'); // 19:30 in Los Angeles.
  updateRuntimeState('job-scan.json', () => ({ value: { startedAt: at.toISOString(), finishedAt: at.toISOString(), history: [{ errors: 0 }] }, result: null, changed: true }));
  assert.equal(recordDailyApplicationCheck(new Date('2026-10-26T02:29:00Z')), null);
  const check = recordDailyApplicationCheck(time);
  assert.equal(check.day, '2026-10-25');
  assert.equal(check.discovered, 2);
  assert.equal(check.attempted, 2);
  assert.equal(check.confirmed, 0);
  assert.ok(check.issues.includes('no-receipts'));
  assert.deepEqual(check.failures.map(f => [f.reason, f.count]), [['JOBRIGHT_INCOMPLETE', 1], ['UNCLASSIFIED_ERROR', 1]]);
  assert.ok(!JSON.stringify(check).includes('private'));
  assert.deepEqual(recordDailyApplicationCheck(new Date(time.getTime() + 60_000)), check, 'later ticks never rewrite the audit');
  assert.deepEqual(applicationBoard(time).dailyCheck, check);
  assert.equal(Object.keys(readRuntimeState('job-digest-state.json').applicationChecks).length, 1);
  assert.equal(readJobs().filter(j => j.application).length, 2, 'health check never reattempts an application');
});

test('daily check flags stale discovery and unresolved Submit without retrying', () => {
  writeJobs([job('1')]);
  reserveApplication('1', configureApplications({ dailyLimit: 20 }), at);
  holdUnverifiedApplication('1', 'Submit may have reached employer; private response unknown', 'Receipt unverified');
  const check = recordDailyApplicationCheck(new Date('2026-10-26T02:30:00Z'));
  assert.ok(check.issues.includes('scan-stale'));
  assert.ok(check.issues.includes('submission-uncertain'));
  assert.deepEqual(check.failures, [{ reason: 'SUBMISSION_UNCERTAIN', count: 1, ids: ['1'] }]);
  assert.ok(!JSON.stringify(check).includes('private'));
  assert.equal(readJobs()[0].application.stage, 'uncertain');
});

test('freeze one daily report with honest attempt/receipt counts and no private form answers on the phone', async () => {
  writeJobs([job('1')]);
  const settings = configureApplications({ dailyLimit: 5 });
  const row = reserveApplication('1', settings, at);
  saveApplicationResult('1', row.application.attemptId, { stage: 'attention', fields: [], blockers: ['private question'], resumeVerified: false });
  const before = applicationBoard(due).report;
  assert.equal(before.attempted, 1); assert.equal(before.confirmed, 0); assert.equal(before.attention, 1);
  assert.equal((await tickApplicationReport(new Date('2026-10-26T01:29:00Z'), deps())), 'not-due');
  assert.equal((await tickApplicationReport(due, deps())), 'accepted');
  assert.equal(calls.length, 1); assert.match(calls[0].body, /今日尝试 1，回执确认 0/);
  assert.ok(!JSON.stringify(calls[0]).includes('private question'));
  assert.equal((await tickApplicationReport(due, deps())), 'not-due'); assert.equal(calls.length, 1);
  assert.equal(applicationBoard(due).report.delivery, 'accepted');
  createDeliveryLedger('job-digest-state.json').mark('morning-2026-10-25', 0);
  assert.equal(applicationBoard(due).report.delivery, 'accepted', 'the discovery digest must preserve application report receipts');
  assert.equal(applicationBoard(due).report.rows[0].stage, 'attention');
  assert.equal(readJobs()[0].application.stage, 'attention', 'report does not change application state');
});
test('run completion sends immediately, once per run, independent of the optional evening report', async () => {
  const early = new Date('2026-10-25T17:10:00Z');
  const first = deps({ env: {}, run: { id: 'run-one', processed: 2 } });
  assert.equal(await tickApplicationReport(early, first), 'accepted');
  assert.match(calls[0].title, /投递简报/);
  assert.match(calls[0].body, /本轮处理 2/);
  assert.equal(await tickApplicationReport(early, first), 'already-claimed');
  assert.equal(await tickApplicationReport(early, deps({ env: {}, run: { id: 'run-two', processed: 1 } })), 'accepted');
  assert.equal(calls.length, 2);
  assert.equal(applicationBoard(early).report.delivery, 'not-sent', 'run receipts do not claim the evening edition');
});

test('concurrent ticks reserve one immutable payload; a second worker cannot send', async () => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const d = deps({ send: async note => { calls.push(note); started(); await new Promise(resolve => { release = resolve; }); return { accepted: 1, failed: 0, expired: 0 }; } });
  const first = tickApplicationReport(due, d);
  await waiting;
  assert.equal(await tickApplicationReport(due, d), 'not-due');
  assert.equal(calls.length, 1);
  release(); assert.equal(await first, 'accepted');
  assert.equal(applicationBoard(due).report.delivery, 'accepted');
});
test('disabled, unsubscribed and ambiguous sends cannot silently retry or mark submission success', async () => {
  assert.equal(await tickApplicationReport(due, deps({ env: {} })), 'disabled');
  assert.equal(await tickApplicationReport(due, deps({ subscriptionCount: async () => 0 })), 'no-subscribers-or-disabled');
  assert.equal(await tickApplicationReport(due, deps({ send: async note => { calls.push(note); throw Error('unknown acceptance'); } })), 'uncertain');
  assert.equal(await tickApplicationReport(due, deps()), 'not-due');
  assert.equal(calls.length, 1); assert.equal(applicationBoard(due).report.delivery, 'uncertain');
  assert.equal(applicationBoard(due).todaySubmitted, 0);
});
