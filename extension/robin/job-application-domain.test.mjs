import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import {
  applicationBoard, applicationCandidates, applicationPreferencesHash, approvedResume, configureApplications,
  confirmApplicationReceipt, reserveApplication, saveApplicationResult, grantApplicationSubmission, uncertainApplicationSubmission, confirmApplicationRejection, dismissApplication,
} from "./job-application-domain.ts";
import { applicationClock, applicationUrl, applicationReceiptTarget, DEFAULT_APPLICATION_SETTINGS, APPLICATION_SUBMISSION_POLICY } from "./job-applications.ts";
import { DEFAULT_JOB_PROFILE } from "./jobs.ts";
import { readJobs, writeJobs, writeJobProfile } from "./store.ts";
import { absorb } from "./job-intake.ts";
import { makeFetchContext } from "./job-providers.ts";
import { scoringContext, ELIGIBILITY_CHECKS } from "./job-evidence.ts";
import { resetTaskStore } from "./task-store.test-support.mjs";

const previous = process.env.ROBIN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "robin-application-test-"));
process.env.ROBIN_DATA_DIR = directory;
resetTaskStore(directory);
const now = new Date("2026-10-25T17:00:00Z");
const pdf = Buffer.from("%PDF-1.0\nfixture");
const path = join(directory, "approved.pdf");
const job = (id, extra = {}) => ({ id, company: "Example", title: `Engineer ${id}`, status: "new", source: "greenhouse", location: "US", url: `https://job-boards.greenhouse.io/example/jobs/${id}`, discoveredAt: now.toISOString(), ...extra });
let settings;
beforeEach(() => {
  writeJobs([]);
  writeJobProfile({ ...DEFAULT_JOB_PROFILE, notes: "User-confirmed preferences" });
  writeFileSync(path, pdf);
  settings = configureApplications({ ...DEFAULT_APPLICATION_SETTINGS, resumePath: path,
    resumeHash: createHash("sha256").update(pdf).digest("hex"), preferencesHash: applicationPreferencesHash(),
    answers: { Email: "candidate@example.com" } });
});
after(() => {
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
  rmSync(directory, { force: true, recursive: true });
});

test("LA day/time is independent of server timezone and tracks DST", () => {
  assert.deepEqual(applicationClock(now, "America/Los_Angeles"), { day: "2026-10-25", time: "10:00" });
  assert.deepEqual(applicationClock(new Date("2026-11-02T16:59:00Z"), "America/Los_Angeles"), { day: "2026-11-02", time: "08:59" });
  assert.equal(applicationClock(new Date("2026-10-26T02:00:00Z"), "America/Los_Angeles").day, "2026-10-25");
  assert.equal(applicationClock(new Date("2026-10-25T07:00:00Z"), "America/Los_Angeles").time, "00:00");
});

test("only direct, uncredentialed HTTPS ATS postings are admitted", () => {
  assert.equal(applicationUrl("https://jobs.ashbyhq.com/example/40659fe7-545e-4b08-b6d7-2567b18b9ed3?tracking=1"), "https://jobs.ashbyhq.com/example/40659fe7-545e-4b08-b6d7-2567b18b9ed3/application");
  for (const url of ["http://job-boards.greenhouse.io/a/jobs/1", "https://evil.test/a/jobs/1", "https://job-boards.greenhouse.io.evil.test/a/jobs/1", "https://user:pass@job-boards.greenhouse.io/a/jobs/1", "https://job-boards.greenhouse.io:444/a/jobs/1", "file:///etc/passwd", "https://job-boards.greenhouse.io/a"]) assert.equal(applicationUrl(url), null);
});

test('confirmation evidence is bound to the exact Greenhouse requisition, not an arbitrary redirect', () => {
  const url = `${job('1').url}/confirmation`;
  assert.equal(applicationUrl(url), null, 'not a new application target');
  assert.equal(applicationReceiptTarget(url), job('1').url);
  for (const bad of ['https://evil.test/example/jobs/1/confirmation', 'https://user:pass@job-boards.greenhouse.io/example/jobs/1/confirmation', `${job('1').url}/other/confirmation`]) assert.equal(applicationReceiptTarget(bad), null);
  writeJobs([job('1')]); const row = reserveApplication('1', settings, now);
  assert.throws(() => confirmApplicationReceipt('1', row.application.attemptId, { at: now.toISOString(), url: `${job('2').url}/confirmation`, text: 'Application received' }), /different posting/);
  confirmApplicationReceipt('1', row.application.attemptId, { at: now.toISOString(), url, text: 'Application received' });
  assert.equal(readJobs()[0].application.receipt.url, url);
  assert.equal(readJobs()[0].status, 'applied');
});

test("approved bytes cannot change, and enabling requires reconfirmed preferences", () => {
  assert.equal(approvedResume(settings).base64, pdf.toString("base64"));
  assert.equal(configureApplications({ enabled: true }).enabled, true);
  writeFileSync(path, "%PDF-1.0\nchanged");
  assert.throws(() => approvedResume(settings), /changed/);
  writeFileSync(path, pdf);
  writeJobProfile({ ...DEFAULT_JOB_PROFILE, notes: "changed" });
  assert.throws(() => configureApplications({ enabled: true }), /preferences changed/);
  assert.equal(configureApplications({ enabled: false }).enabled, false, "pause always remains possible");
});

test("five reservations, including failures, exhaust a day but not the next", () => {
  writeJobs(Array.from({ length: 6 }, (_, index) => job(String(index + 1))));
  for (let id = 1; id <= 5; id++) {
    const row = reserveApplication(String(id), settings, now);
    saveApplicationResult(row.id, row.application.attemptId, { stage: "blocked", fields: [], blockers: ["Chrome closed"], resumeVerified: false });
  }
  assert.equal(applicationBoard(now).today, 5);
  assert.throws(() => reserveApplication("6", settings, now), /limit/);
  reserveApplication("6", settings, new Date("2026-10-26T17:00:00Z"));
  assert.equal(applicationBoard(now).today, 5);
});

test("removing a failed record hides it without deleting the job or freeing daily budget", () => {
  settings = configureApplications({ dailyLimit: 1 });
  writeJobs([job("1"), job("2")]);
  const reserved = reserveApplication("1", settings, now);
  saveApplicationResult("1", reserved.application.attemptId, { stage: "error", fields: [], blockers: ["Unsupported board"], resumeVerified: false });
  const before = readJobs()[0];
  dismissApplication("1", now);
  dismissApplication("1", new Date("2026-10-26T17:00:00Z"));
  assert.deepEqual(readJobs()[0], { ...before, application: { ...before.application, dismissedAt: now.toISOString() } });
  assert.equal(applicationBoard(now).total, 0);
  assert.equal(applicationBoard(now).counts.error, 0);
  assert.equal(applicationBoard(now).today, 1);
  assert.throws(() => reserveApplication("2", settings, now), /limit/);
  assert.throws(() => dismissApplication("2"), /no longer exists/);
  assert.throws(() => dismissApplication("missing"), /no longer exists/);
  saveApplicationResult("1", reserved.application.attemptId, { stage: "error", fields: [], blockers: ["Late worker result"], resumeVerified: false });
  assert.equal(applicationBoard(now).total, 0, "late results do not resurrect removed records");
});

test("removing uncertain and submitted records preserves receipts and duplicate locks", () => {
  settings = configureApplications({ submissionPolicy: APPLICATION_SUBMISSION_POLICY });
  writeJobs([job("1"), job("2", { title: "Engineer 1" })]);
  const row = reserveApplication("1", settings, now), { snapshot, review } = reviewed();
  grantApplicationSubmission("1", row.application.attemptId, snapshot, review);
  const before = readJobs()[0];
  dismissApplication("1", now);
  assert.deepEqual(readJobs()[0].application.submission, before.application.submission);
  assert.equal(applicationBoard(now).total, 0);
  assert.throws(() => reserveApplication("1", settings, now), /no longer available/);
  assert.throws(() => reserveApplication("2", settings, now), /already has/);
  const receipt = { at: now.toISOString(), url: row.url, text: "Application received" };
  confirmApplicationReceipt("1", row.application.attemptId, receipt);
  dismissApplication("1", now);
  assert.deepEqual(readJobs()[0].application.receipt, receipt);
  assert.equal(readJobs()[0].status, "applied");
  assert.equal(applicationBoard(now).todaySubmitted, 1);
  assert.equal(applicationBoard(now).total, 0);
  assert.throws(() => reserveApplication("2", settings, now), /already has/);
});

test("prepared/applied duplicates are suppressed even with a new requisition id", () => {
  writeJobs([job("1", { title: "Engineer" }), job("2", { title: "Engineer" }), job("3", { status: "applied" }), job("4", { title: "Engineer 3" })]);
  reserveApplication("1", settings, now);
  assert.throws(() => reserveApplication("2", settings, now), /already has/);
  assert.throws(() => reserveApplication("3", settings, now), /no longer/);
  assert.throws(() => reserveApplication("4", settings, now), /already has/);
  assert.equal(applicationCandidates(now).length, 0, "unscored rows are never automatically prepared");
});

test('an unavailable posting stays visible, does not claim an unsubmitted role, and never weakens prior-application protection', () => {
  writeJobs([job('1', { title: 'Engineer' }), job('2', { title: 'Engineer' })]);
  const first = reserveApplication('1', settings, now);
  saveApplicationResult('1', first.application.attemptId, { stage: 'unavailable', fields: [], blockers: ['Posting missing'], resumeVerified: false });
  assert.equal(applicationBoard(now).counts.unavailable, 1);
  assert.equal(readJobs()[0].status, 'new');
  reserveApplication('2', settings, now);
  const jobs = readJobs(); jobs[0].appliedAt = now.toISOString(); writeJobs(jobs);
  assert.throws(() => reserveApplication('2', settings, now), /already has/);
  writeJobProfile({ ...DEFAULT_JOB_PROFILE, notes: 'Changed approved facts do not reopen a missing posting' });
  assert.equal(applicationBoard(now).rows.find(r => r.id === '1').application.stage, 'unavailable');
});

test("stale writers and forged preparation success never mark applied", () => {
  writeJobs([job("1")]);
  const first = reserveApplication("1", settings, now);
  const next = reserveApplication("1", settings, now);
  const result = { stage: "review", fields: [], blockers: [], resumeVerified: true };
  saveApplicationResult("1", first.application.attemptId, result);
  assert.equal(readJobs()[0].application.stage, "preparing");
  assert.throws(() => saveApplicationResult("1", next.application.attemptId, { ...result, stage: "submitted" }), /cannot/);
  assert.equal(readJobs()[0].status, "new");
  assert.throws(() => confirmApplicationReceipt("1", next.application.attemptId, { at: now.toISOString(), url: job("2").url, text: "Thank you for applying" }), /different/);
  confirmApplicationReceipt("1", next.application.attemptId, { at: now.toISOString(), url: job("1").url, text: "Thank you for applying" });
  assert.equal(readJobs()[0].status, "applied");
  assert.equal(readJobs()[0].appliedAt, now.toISOString());
  assert.equal(readJobs()[0].application.stage, "submitted");
});

test("source changes make old reviews visibly historical without rewriting their evidence", () => {
  writeJobs([job("1")]);
  const reserved = reserveApplication("1", settings, now);
  saveApplicationResult("1", reserved.application.attemptId, { stage: "review", fields: [], blockers: [], resumeVerified: true });
  writeJobProfile({ ...DEFAULT_JOB_PROFILE, notes: "new preferences" });
  assert.equal(applicationBoard(now).rows[0].application.stage, "blocked");
  assert.match(applicationBoard(now).rows[0].application.blockers[0], /historical/);
  assert.equal(readJobs()[0].application.stage, "review", "GET projects staleness without mutating history");
});

const reviewed = () => ({
  snapshot: { fields: [{ key: 'name', label: 'Name', kind: 'text', value: 'Candidate', required: true, options: [], check: 'needs-review' }], errors: [], resumeVerified: true,
    autofill: { clickedAt: now.toISOString(), completedAt: now.toISOString(), summary: '1/1 required fields filled' } },
  review: { decisions: [{ key: 'name', action: 'keep', value: 'Candidate', source: 'cv', quote: 'Candidate', reason: 'Approved CV' }], issues: [] },
});

test('submission requires explicit authorization, every reviewed field and fresh source approval', () => {
  writeJobs([job('1')]);
  let row = reserveApplication('1', settings, now);
  const { snapshot, review } = reviewed();
  assert.throws(() => grantApplicationSubmission('1', row.application.attemptId, snapshot, review), /not been authorized/);
  settings = configureApplications({ submissionPolicy: APPLICATION_SUBMISSION_POLICY });
  row = reserveApplication('1', settings, now);
  for (const bad of [{ ...snapshot, autofill: null }, { ...snapshot, fields: [{ ...snapshot.fields[0], pendingSelection: true }] }, { ...snapshot, resumeVerified: false }, { ...snapshot, fields: [] }, { ...snapshot, errors: ['Required value missing'] }]) {
    assert.throws(() => grantApplicationSubmission('1', row.application.attemptId, bad, review), /full form/);
  }
  assert.throws(() => grantApplicationSubmission('1', row.application.attemptId, snapshot, { decisions: [], issues: [] }), /full form/);
  configureApplications({ confirmedFacts: 'New facts after review' });
  assert.throws(() => grantApplicationSubmission('1', row.application.attemptId, snapshot, review), /sources changed/);
  assert.equal(readJobs()[0].application.submission, undefined);
});

test('durable submission boundary survives interruption and cannot be overwritten or reserved again', () => {
  settings = configureApplications({ submissionPolicy: APPLICATION_SUBMISSION_POLICY });
  writeJobs([job('1')]);const row = reserveApplication('1', settings, now), { snapshot, review } = reviewed();
  const grant = grantApplicationSubmission('1', row.application.attemptId, snapshot, review);
  assert.equal(grant.fingerprint, createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'));
  assert.equal(applicationBoard(now).rows[0].application.stage, 'uncertain');
  assert.throws(() => reserveApplication('1', settings, now), /no longer available/);
  assert.throws(() => grantApplicationSubmission('1', row.application.attemptId, snapshot, review), /no longer available/);
  saveApplicationResult('1', row.application.attemptId, { stage: 'error', fields: [], blockers: [], resumeVerified: false });
  assert.equal(readJobs()[0].application.stage, 'submitting');
  uncertainApplicationSubmission('1', row.application.attemptId, 'No definitive receipt');
  assert.equal(readJobs()[0].application.stage, 'uncertain');
  assert.equal(readJobs()[0].status, 'new');
  confirmApplicationReceipt('1', row.application.attemptId, { at: now.toISOString(), url: row.url, text: 'Thank you for applying' });
  assert.equal(applicationBoard(now).todaySubmitted, 1);
});

test('only narrow, fresh, same-posting validation rejection releases the persisted lock', () => {
  settings = configureApplications({ submissionPolicy: APPLICATION_SUBMISSION_POLICY });
  writeJobs([job('1')]);const row = reserveApplication('1', settings, now), { snapshot, review } = reviewed();
  grantApplicationSubmission('1', row.application.attemptId, snapshot, review);
  const rejection = { at: new Date().toISOString(), url: row.url, text: 'Missing entry for required field: Name' };
  assert.throws(() => confirmApplicationRejection('1', row.application.attemptId, { ...rejection, text: 'Something went wrong' }), /No definitive/);
  assert.throws(() => confirmApplicationRejection('1', row.application.attemptId, { ...rejection, at: '2000-01-01' }), /does not belong/);
  assert.throws(() => confirmApplicationRejection('1', row.application.attemptId, { ...rejection, url: job('2').url }), /does not belong/);
  assert.ok(readJobs()[0].application.submission);
  confirmApplicationRejection('1', row.application.attemptId, rejection);
  assert.equal(readJobs()[0].application.submission, undefined);
  assert.equal(readJobs()[0].status, 'new');
  const retry = reserveApplication('1', settings, now);
  assert.equal(retry.application.rejections[0].attemptId, row.application.attemptId);
  assert.notEqual(retry.application.attemptId, row.application.attemptId);
});

test('old preparation is not counted as current attempts or permanently excluded from manual reruns', () => {
  writeJobs([job('1')]);const row = reserveApplication('1', settings, now);
  const old = readJobs();delete old[0].application.workflowVersion;writeJobs(old);
  assert.equal(applicationBoard(now).today, 0);
  assert.equal(applicationBoard(now).legacy, 1);
  assert.notEqual(reserveApplication('1', settings, now).application.attemptId, row.application.attemptId);
});

test('newly confirmed facts requeue a blocked candidate, never a submission-locked one', () => {
  const cv = 'Built production web applications with Python and TypeScript.';
  const description = 'Build production web applications, test APIs, review changes and collaborate with engineers. '.repeat(8);
  const profile = { ...DEFAULT_JOB_PROFILE, cv, notes: 'User-confirmed preferences' };
  writeJobProfile(profile);
  const candidate = job('1', { title: 'Software Engineer', location: 'United States', description, score: 4.5 });
  candidate.review = { context: scoringContext(candidate, profile), roleEvidence: description.slice(0, 80), cvEvidence: cv,
    checks: Object.fromEntries(ELIGIBILITY_CHECKS.map(key => [key, key === 'location' ? { status: 'met', quote: 'United States' } : { status: 'not-stated' }])) };
  writeJobs([candidate]);
  assert.deepEqual(applicationCandidates(now).map(row => row.id), ['1']);
  reserveApplication('1', settings, now);
  assert.deepEqual(applicationCandidates(now), []);
  settings = configureApplications({ confirmedFacts: 'An explicitly confirmed new answer', submissionPolicy: APPLICATION_SUBMISSION_POLICY });
  assert.deepEqual(applicationCandidates(now).map(row => row.id), ['1']);
  dismissApplication('1', now);
  configureApplications({ confirmedFacts: 'Another confirmed answer must not requeue removed records' });
  assert.deepEqual(applicationCandidates(now), []);
  settings = configureApplications({ confirmedFacts: 'An explicitly confirmed new answer' });
  const row = reserveApplication('1', settings, now), { snapshot, review } = reviewed();
  grantApplicationSubmission('1', row.application.attemptId, snapshot, review);
  configureApplications({ confirmedFacts: 'A further explicitly confirmed answer' });
  assert.deepEqual(applicationCandidates(now), []);
});

test("scan retention keeps preparation evidence without changing the pipeline status", async () => {
  writeJobs([job("1", { discoveredAt: "2020-01-01T00:00:00Z" })]);
  reserveApplication("1", settings, now);
  await absorb([], { profile: DEFAULT_JOB_PROFILE, undated: "keep" }, makeFetchContext());
  assert.equal(readJobs().length, 1);
  assert.equal(readJobs()[0].status, "new");
  assert.ok(readJobs()[0].application);
});
