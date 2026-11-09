import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import {
  applicationAnswerEditor, applicationBoard, applicationCandidates, applicationJob, applicationPreferencesHash, applicationSettings,
  approveApplicationField, approvedResume, checkApplicationPreparation, configureApplications, saveApplicationFacts, saveApplicationProfile, applicationSources,
  confirmApplicationReceipt, confirmApplicationEmailReceipt, pendingApplicationEmailReceipts, reserveApplication, saveApplicationResult, grantApplicationSubmission, uncertainApplicationSubmission, confirmApplicationRejection, dismissApplication, dropApplication, holdUnverifiedApplication, claimApplicationReport, settleApplicationReport, recordApplicationPreflight,
} from "./job-application-domain.ts";
import { applicationAnswers, applicationClock, applicationUrl, applicationReceiptTarget, applicationPostingMatches, DEFAULT_APPLICATION_SETTINGS, APPLICATION_SUBMISSION_POLICY } from "./job-applications.ts";
import { DEFAULT_JOB_PROFILE, digestCandidates } from "./jobs.ts";
import { readJobs, writeJobs, writeJobProfile } from "./store.ts";
import { absorb } from "./job-intake.ts";
import { makeFetchContext } from "./job-providers.ts";
import { scoringContext, ELIGIBILITY_CHECKS } from "./job-evidence.ts";
import { resetTaskStore } from "./task-store.test-support.mjs";
import { reconcileApplicationEmailReceipts } from "../../lib/job-application-email.ts";

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

test("application readback keeps counters and evidence without deserializing unrelated JDs", () => {
  writeJobs([job("1", { description: "BOARD_UNUSED_JD", review: { context: "BOARD_UNUSED_REVIEW" } }),
    job("2", { description: "BOARD_UNUSED_JD", status: "dropped" })]);
  const row = reserveApplication("1", settings, now);
  saveApplicationResult("1", row.application.attemptId, { stage: "review", fields: [], blockers: [], resumeVerified: true });
  const expected = applicationBoard(now);
  const stored = readJobs();
  const parse = JSON.parse;
  try {
    if (process.env.ROBIN_TEST_TASK_BACKEND !== "json") JSON.parse = function (text, ...args) {
      assert.equal(text.includes("BOARD_UNUSED_JD") || text.includes("BOARD_UNUSED_REVIEW"), false);
      return parse.call(this, text, ...args);
    };
    assert.deepEqual(applicationBoard(now), expected);
  } finally { JSON.parse = parse; }
  assert.deepEqual(readJobs(), stored, "the narrow readback is never persisted");
});

test("unresolved submissions remain on the workbench beyond the 100-record history window", () => {
  writeJobs([job("1")]);
  const { application } = reserveApplication("1", settings, now);
  writeJobs([job("1", { application: { ...application, stage: "uncertain", updatedAt: "2026-10-01T00:00:00Z" } }),
    ...Array.from({ length: 102 }, (_, index) => job(String(index + 2), { application: {
      ...application, stage: "review", updatedAt: new Date(now.getTime() - index * 1000).toISOString(),
    } }))]);
  const board = applicationBoard(now);
  assert.equal(board.total, 103);
  assert.equal(board.rows.length, 101);
  assert.equal(board.rows.at(-1).id, "1");
  assert.equal(board.rows.at(-1).application.stage, "uncertain");
});

test("browser preflight failure is visible without reserving any job, then clears on recovery", () => {
  recordApplicationPreflight("BSK_BROWSER_UNAVAILABLE");
  assert.equal(applicationBoard(now).preflightError.message, "BSK_BROWSER_UNAVAILABLE");
  assert.equal(applicationBoard(now).today, 0);
  recordApplicationPreflight();
  assert.equal(applicationBoard(now).preflightError, null);
});

test("frozen notification keeps its delivery while the dashboard shows live outcomes", () => {
  writeJobs([job("1")]);
  const frozen = applicationBoard(now).report;
  assert.equal(claimApplicationReport(frozen, "report-owner"), true);
  settleApplicationReport(frozen, "report-owner", "accepted", 1);
  const row = reserveApplication("1", settings, now);
  saveApplicationResult("1", row.application.attemptId, { stage: "error", fields: [], blockers: ["read failed"], resumeVerified: false });
  const live = applicationBoard(now).report;
  assert.equal(live.delivery, "accepted");
  assert.equal(live.attempted, 1);
  assert.equal(live.errors, 1);
  assert.equal(live.rows[0].stage, "error");
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

test('branded Greenhouse redirects are bound to the recorded employer host and exact requisition', () => {
  const direct = 'https://job-boards.greenhouse.io/sambanovasystems/jobs/6224938004';
  const stored = 'https://sambanova.ai/sambanova-available-positions/?gh_jid=6224938004';
  const actual = 'https://sambanova.ai/company/careers/job-openings?gh_jid=6224938004';
  assert.equal(applicationPostingMatches(actual, direct, stored), true);
  assert.equal(applicationPostingMatches(actual, direct, stored, true), true);
  for (const bad of [
    'https://sambanova.ai/company/careers/job-openings?gh_jid=123',
    'https://sambanova.ai.evil.test/company/careers/job-openings?gh_jid=6224938004',
    'https://user:pass@sambanova.ai/company/careers/job-openings?gh_jid=6224938004',
    'https://sambanova.ai/company/careers/job-openings?gh_jid=6224938004&gh_jid=6224938004',
    'http://sambanova.ai/company/careers/job-openings?gh_jid=6224938004',
  ]) assert.equal(applicationPostingMatches(bad, direct, stored, true), false, bad);
  assert.equal(applicationPostingMatches(actual, direct, 'https://jobright.ai/jobs/info/other'), false);
});

test('a queryless official redirect must retain the recorded employer path and requisition', () => {
  for (const [tenant, id, source, actual] of [
    ['airbnb', '8332157', 'https://careers.airbnb.com/positions/8332157?gh_jid=8332157', 'https://careers.airbnb.com/positions/8332157/'],
    ['roblox', '8304210', 'https://careers.roblox.com/jobs/8304210?gh_jid=8304210', 'https://careers.roblox.com/jobs/8304210'],
    ['rubrik', '8267709', 'https://www.rubrik.com/company/careers/departments/job.8267709?gh_jid=8267709', 'https://www.rubrik.com/company/careers/departments/job.8267709'],
  ]) {
    const ats = `https://job-boards.greenhouse.io/${tenant}/jobs/${id}`;
    assert.equal(applicationPostingMatches(actual, ats, source), true);
    assert.equal(applicationPostingMatches(actual, ats, source, true), false, 'queryless branded pages are not submission receipts');
    for (const bad of [actual.replace(id, '9999'), `${actual}?gh_jid=9999`, `${actual}?tracking=1`,
      actual.replace('https://', 'https://attacker.'), actual.replace('https://', 'http://')]) {
      assert.equal(applicationPostingMatches(bad, ats, source), false, bad);
    }
  }
  const ats = 'https://job-boards.greenhouse.io/sambanovasystems/jobs/6224938004';
  assert.equal(applicationPostingMatches('https://sambanova.ai/company/careers/job-openings', ats,
    'https://sambanova.ai/company/careers/job-openings?gh_jid=6224938004'), false);
});

test('Greenhouse legacy-to-new host redirect retains exact tenant and requisition identity', () => {
  const legacy = 'https://boards.greenhouse.io/chime/jobs/8922481002';
  const modern = 'https://job-boards.greenhouse.io/chime/jobs/8922481002';
  assert.equal(applicationPostingMatches(modern, legacy, legacy), true);
  assert.equal(applicationPostingMatches(legacy, modern, modern), true);
  assert.equal(applicationPostingMatches(`${modern}/confirmation`, legacy, legacy, true), true);
  for (const different of [
    'https://job-boards.greenhouse.io/other/jobs/8922481002',
    'https://job-boards.greenhouse.io/chime/jobs/123',
    'https://job-boards.greenhouse.io.evil.test/chime/jobs/8922481002',
    'https://user:pass@job-boards.greenhouse.io/chime/jobs/8922481002',
  ]) assert.equal(applicationPostingMatches(different, legacy, legacy), false, different);
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

test('reported manual Submit locks the job without inventing a receipt or marking Applied', () => {
  writeJobs([job('1')]); reserveApplication('1', settings, now);
  holdUnverifiedApplication('1', 'User reported clicking Submit; no receipt confirmed', 'Manual Submit reported; receipt unverified');
  const row = readJobs()[0];
  assert.equal(row.application.stage, 'uncertain');
  assert.equal(row.application.receipt, undefined);
  assert.equal(row.status, 'new');
  assert.equal(applicationCandidates(now).length, 0);
  assert.throws(() => reserveApplication('1', settings, now), /no longer available/);
  configureApplications({ answers: { Email: 'changed@example.com' } });
  assert.equal(applicationCandidates(now).length, 0, 'source changes cannot release the duplicate lock');
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

test("user-edited facts and exact job-scoped question approvals preserve the submission boundary", () => {
  writeJobs([job('1'), job('2')]);
  for (const id of ['1', '2']) {
    const reserved = reserveApplication(id, settings, now);
    saveApplicationResult(id, reserved.application.attemptId, { stage: 'attention', resumeVerified: true, blockers: [], fields: [
      { key: 'pronouns', label: 'What are your pronouns?*', kind: 'select', options: ['He/Him', 'She/Her'], value: '', required: true, check: 'empty' },
    ] });
  }
  const before = readJobs();
  const original = applicationAnswerEditor();
  saveApplicationFacts('I do not require visa sponsorship. This does not establish unrestricted work authorization.', original.confirmedFacts);
  assert.throws(() => saveApplicationFacts('stale edit', original.confirmedFacts), /changed elsewhere/);
  assert.throws(() => approveApplicationField('1', 'What are your pronouns?*', 'Other'), /available answer/);
  assert.throws(() => approveApplicationField('1', 'Any declaration', 'Yes'), /exact form question/);
  approveApplicationField('1', 'What are your pronouns?*', 'He/Him');
  assert.equal(applicationAnswers(applicationSettings(), '1')['what are your pronouns?'], 'He/Him');
  assert.equal(applicationAnswers(applicationSettings(), '2')['what are your pronouns?'], undefined);
  assert.equal(applicationSettings().submissionPolicy, settings.submissionPolicy);
  assert.deepEqual(readJobs(), before, 'approval never mutates past attempts or clicks Submit');
  approveApplicationField('1', 'What are your pronouns?*', '');
  assert.equal(applicationAnswers(applicationSettings(), '1')['what are your pronouns?'], undefined);
});

test("one reusable personal profile is shared across jobs without rewriting attempts or authorization", () => {
  writeJobs([job('1'), job('2')]);
  settings = configureApplications({ answers: { Email: 'candidate@example.com', 'I agree to arbitration': 'Yes',
    'What are your salary expectations?': '$120,000', '[job:2] I agree to arbitration': 'Yes' } });
  const reserved = reserveApplication('1', settings, now);
  saveApplicationResult('1', reserved.application.attemptId, { stage: 'attention', resumeVerified: true, blockers: [], fields: [] });
  const before = readJobs();
  assert.equal(applicationBoard(now).rows[0].application.stage, 'attention');
  const { revision } = applicationAnswerEditor();
  const standing = { pronouns: 'he/him', raceEthnicity: 'Asian', sponsorshipNow: 'No', sponsorshipFuture: 'No' };
  saveApplicationProfile('The user confirmed these facts.', standing, { Email: 'candidate@example.com', 'Preferred city?': 'Seattle' }, revision);
  assert.deepEqual(applicationAnswerEditor().standing, standing);
  assert.equal(applicationSettings().answers['[job:2] I agree to arbitration'], 'Yes', 'job-scoped approval stays intact');
  assert.equal(applicationSettings().answers['I agree to arbitration'], 'Yes', 'older generic answers are retained for history');
  assert.equal(applicationSettings().answers['What are your salary expectations?'], '$120,000', 'old pay answers are not deleted');
  assert.equal(applicationAnswers(applicationSettings(), '1')['i agree to arbitration'], undefined, 'generic legal answer is never projected');
  assert.equal(applicationAnswers(applicationSettings(), '1')['what are your salary expectations?'], undefined, 'generic pay answer is never projected');
  assert.equal(applicationAnswers(applicationSettings(), '2')['preferred city?'], 'Seattle', 'approved recurring question is available on future roles');
  assert.match(applicationSources().confirmed, /"pronouns": "he\/him"/);
  assert.throws(() => saveApplicationProfile('stale', {}, {}, revision), /changed elsewhere/);
  assert.throws(() => saveApplicationProfile('', { agreement: 'Yes' }, {}, applicationAnswerEditor().revision), /Invalid reusable/);
  assert.throws(() => saveApplicationProfile('', {}, { 'I agree to arbitration': 'Yes' }, applicationAnswerEditor().revision), /legal declarations/);
  assert.throws(() => saveApplicationProfile('', {}, { 'What are your salary expectations?': '$120,000' }, applicationAnswerEditor().revision), /pay choices/);
  assert.equal(applicationSettings().submissionPolicy, settings.submissionPolicy);
  assert.deepEqual(readJobs(), before);
  assert.equal(applicationBoard(now).rows[0].application.stage, 'blocked', 'old evidence is historical after the global profile changes');
});

test("reservations, including failures, remain counted across days", () => {
  writeJobs(Array.from({ length: 6 }, (_, index) => job(String(index + 1))));
  for (let id = 1; id <= 5; id++) {
    const row = reserveApplication(String(id), settings, now);
    saveApplicationResult(row.id, row.application.attemptId, { stage: "blocked", fields: [], blockers: ["Chrome closed"], resumeVerified: false });
  }
  assert.equal(applicationBoard(now).today, 5);
  reserveApplication("6", settings, now);
  assert.equal(applicationBoard(now).today, 6);
  assert.equal(applicationBoard(new Date("2026-10-26T17:00:00Z")).today, 0);
});

test("saving one of two questions keeps the other visible and resumes only after both", () => {
  const cv = 'Built production web applications with Python and TypeScript.';
  const description = 'Build production web applications, test APIs, review changes and collaborate with engineers. '.repeat(8);
  const profile = { ...DEFAULT_JOB_PROFILE, cv, notes: 'User-confirmed preferences', locationAllow: ['United States'] };
  writeJobProfile(profile);
  const candidate = job('1', { title: 'Software Engineer', location: 'Remote, United States', description, score: 4.5 });
  candidate.review = { context: scoringContext(candidate, profile), roleEvidence: description.slice(0, 80), cvEvidence: cv,
    checks: Object.fromEntries(ELIGIBILITY_CHECKS.map(key => [key, key === 'location' ? { status: 'met', quote: 'Remote, United States' } : { status: 'not-stated' }])) };
  writeJobs([candidate]);
  const row = reserveApplication("1", settings, now);
  saveApplicationResult("1", row.application.attemptId, { stage: "attention", fields: [
    { key: "first", label: "First question?", kind: "select", required: true, value: "", options: ["Yes", "No"], check: "empty" },
    { key: "second", label: "Second question?", kind: "select", required: true, value: "", options: ["Yes", "No"], check: "empty" },
  ], blockers: [], resumeVerified: true });
  assert.deepEqual(applicationBoard(now).rows[0].pendingQuestionKeys, ["first", "second"]);
  approveApplicationField("1", "First question?", "Yes");
  const afterFirst = applicationBoard(now).rows[0];
  assert.equal(afterFirst.application.stage, "blocked", "historical read-back remains invalidated");
  assert.deepEqual(afterFirst.pendingQuestionKeys, ["second"]);
  assert.deepEqual(applicationCandidates(now), [], 'auto-run waits while another known answer is missing');
  assert.equal(afterFirst.application.fields[0].value, "", "approved answer is not echoed as a form value");
  assert.equal(Object.hasOwn(afterFirst, "answers"), false, "private answer map stays off the board");
  approveApplicationField("1", "Second question?", "No");
  assert.deepEqual(applicationBoard(now).rows[0].pendingQuestionKeys, []);
  assert.deepEqual(applicationCandidates(now).map((entry) => entry.id), ['1'], 'later auto-run may re-audit after all answers are saved');
});

test("a saved standing answer resolves a matching pending question without exposing its value", () => {
  writeJobs([job("1")]);
  const row = reserveApplication("1", settings, now);
  saveApplicationResult("1", row.application.attemptId, { stage: "attention", fields: [
    { key: "sponsor", label: "Do you need visa sponsorship now?", kind: "select-one", required: true, value: "", options: ["Yes", "No"], check: "empty" },
  ], blockers: [], resumeVerified: true });
  assert.deepEqual(applicationBoard(now).rows[0].pendingQuestionKeys, ["sponsor"]);
  saveApplicationProfile("", { sponsorshipNow: "No" }, {}, applicationAnswerEditor().revision);
  assert.deepEqual(applicationBoard(now).rows[0].pendingQuestionKeys, []);
});

test("the automatic batch size does not become a daily reservation cap", () => {
  settings = configureApplications({ dailyLimit: 1 });
  writeJobs([job("1"), job("2")]);
  reserveApplication("1", settings, now);
  assert.doesNotThrow(() => reserveApplication("2", settings, now));
  assert.equal(applicationBoard(now).today, 2);
});

test("zero daily limit removes only the volume cap, not distinct-job accounting", () => {
  settings = configureApplications({ dailyLimit: 0 });
  writeJobs(Array.from({ length: 22 }, (_, index) => job(String(index + 1))));
  for (let id = 1; id <= 22; id++) reserveApplication(String(id), settings, now);
  assert.equal(applicationBoard(now).today, 22);
  assert.equal(applicationBoard(now).todaySubmitted, 0, "attempts never become confirmed submissions");
  assert.equal(applicationSettings().dailyLimit, 0);
});

test("removing a failed record hides it without deleting the job or its attempt count", () => {
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
  assert.doesNotThrow(() => reserveApplication("2", settings, now));
  assert.throws(() => dismissApplication("missing"), /no longer exists/);
  saveApplicationResult("1", reserved.application.attemptId, { stage: "error", fields: [], blockers: ["Late worker result"], resumeVerified: false });
  assert.equal(applicationBoard(now).total, 1, "late results do not resurrect removed records");
  assert.equal(applicationBoard(now).today, 2);
});

test("dropping an unanswered job removes the question, keeps its audit, and blocks future auto-selection", () => {
  writeJobs([job("1")]);
  const reserved = reserveApplication("1", settings, now);
  saveApplicationResult("1", reserved.application.attemptId, { stage: "attention", fields: [], blockers: ["Question needs approval"], resumeVerified: true });
  const before = readJobs()[0].application;
  dropApplication("1", now);
  const dropped = readJobs()[0];
  assert.equal(dropped.status, "dropped");
  assert.deepEqual(dropped.application, { ...before, dismissedAt: now.toISOString() });
  assert.equal(applicationBoard(now).today, 1);
  assert.equal(applicationBoard(now).total, 0);
  assert.deepEqual(applicationCandidates(now).map(({ id }) => id), []);
  assert.throws(() => dropApplication("1", now), /Only an unresolved/);
  assert.throws(() => reserveApplication("1", settings, now), /no longer available/);
});

test("drop refuses submission-locked and confirmed applications without changing their status", () => {
  writeJobs([job("1")]);
  const reserved = reserveApplication("1", settings, now);
  saveApplicationResult("1", reserved.application.attemptId, { stage: "attention", fields: [], blockers: [], resumeVerified: true });
  const locked = readJobs()[0];
  writeJobs([{ ...locked, application: { ...locked.application, submission: { nonce: "pending" } } }]);
  assert.throws(() => dropApplication("1"), /Only an unresolved/);
  assert.equal(readJobs()[0].status, "new");
  writeJobs([{ ...locked, application: { ...locked.application, receipt: { at: now.toISOString(), text: "Received", url: locked.url } } }]);
  assert.throws(() => dropApplication("1"), /Only an unresolved/);
  assert.equal(readJobs()[0].status, "new");
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

test('a unique after-click Greenhouse email settles only the linked Robin attempt, never a click alone', () => {
  settings = configureApplications({ submissionPolicy: APPLICATION_SUBMISSION_POLICY });
  writeJobs([job('1')]); const row = reserveApplication('1', settings, now), { snapshot, review } = reviewed();
  const grant = grantApplicationSubmission('1', row.application.attemptId, snapshot, review);
  uncertainApplicationSubmission('1', row.application.attemptId, 'No browser receipt');
  const mail = { id: '1a1a3a5fdd63134c', from: 'no-reply@us.greenhouse-mail.io',
    subject: 'Thank you for applying to Example', bodyText: 'Your application has been received.',
    date: new Date(Date.parse(grant.grantedAt) + 60_000).toISOString() };
  assert.equal(pendingApplicationEmailReceipts().length, 1);
  for (const bad of [{ ...mail, from: 'attacker@example.com' }, { ...mail, subject: 'Thank you for applying to Other' },
    { ...mail, date: now.toISOString() }, { ...mail, bodyIncomplete: true }]) {
    assert.equal(confirmApplicationEmailReceipt('1', row.application.attemptId, bad), false);
    assert.equal(readJobs()[0].status, 'new');
  }
  assert.equal(confirmApplicationEmailReceipt('1', row.application.attemptId, mail), true);
  assert.equal(confirmApplicationEmailReceipt('1', row.application.attemptId, mail), false);
  assert.equal(readJobs()[0].status, 'applied');
  assert.equal(readJobs()[0].application.receipt.source, 'email');
  assert.equal(readJobs()[0].application.receipt.mailId, mail.id);
  assert.equal(pendingApplicationEmailReceipts().length, 0);
});

test('read-only mail reconciliation links one confirmed employer message to its pending Robin job', async () => {
  settings = configureApplications({ submissionPolicy: APPLICATION_SUBMISSION_POLICY });
  writeJobs([job('1')]); const row = reserveApplication('1', settings, now), { snapshot, review } = reviewed();
  const grant = grantApplicationSubmission('1', row.application.attemptId, snapshot, review);
  uncertainApplicationSubmission('1', row.application.attemptId, 'Waiting for email');
  const mail = { id: '1a1a3a5fdd63134c', from: 'no-reply@us.greenhouse-mail.io',
    subject: 'Thank you for applying to Example', bodyText: 'Your application has been received.',
    date: new Date(Date.parse(grant.grantedAt)+60_000).toISOString() };
  let reads = 0;
  const deps = { list: async () => [mail], get: async () => { reads++; return mail; } };
  assert.equal(await reconcileApplicationEmailReceipts(deps), 1);
  assert.equal(await reconcileApplicationEmailReceipts(deps), 0);
  assert.equal(reads, 1);
  assert.equal(readJobs()[0].application.receipt.mailId, mail.id);
});

test('two plausible employer messages cannot be assigned to a single Robin attempt', async () => {
  settings = configureApplications({ submissionPolicy: APPLICATION_SUBMISSION_POLICY });
  writeJobs([job('1')]); const row = reserveApplication('1', settings, now), { snapshot, review } = reviewed();
  const grant = grantApplicationSubmission('1', row.application.attemptId, snapshot, review);
  const base = { from: 'no-reply@us.greenhouse-mail.io', subject: 'Thank you for applying to Example',
    bodyText: 'Your application has been received.', date: new Date(Date.parse(grant.grantedAt)+60_000).toISOString() };
  let reads = 0;
  assert.equal(await reconcileApplicationEmailReceipts({ list: async () => [
    { ...base, id: '1a1a3a5fdd63134c' }, { ...base, id: '2a1a3a5fdd63134c' }],
    get: async () => { reads++; return null; } }), 0);
  assert.equal(reads, 0);
  assert.equal(readJobs()[0].application.receipt, undefined);
});

test('an employer email without a unique pending attempt cannot be assigned to a job', () => {
  settings = configureApplications({ submissionPolicy: APPLICATION_SUBMISSION_POLICY });
  writeJobs([job('1'), job('2')]);
  for (const id of ['1', '2']) {
    const row = reserveApplication(id, settings, now), { snapshot, review } = reviewed();
    grantApplicationSubmission(id, row.application.attemptId, snapshot, review);
  }
  const mail = { id: '1a1a3a5fdd63134c', from: 'no-reply@us.greenhouse-mail.io',
    subject: 'Thank you for applying to Example', bodyText: 'Your application has been received.', date: new Date(Date.now()+60_000).toISOString() };
  assert.equal(confirmApplicationEmailReceipt('1', applicationJob('1').application.attemptId, mail), false);
  assert.equal(readJobs().filter(j => j.status === 'applied').length, 0);
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

test('exploratory applications admit scored Bay Area/remote roles from 3.5, including short JD, but not known blockers', () => {
  const profile = { ...DEFAULT_JOB_PROFILE, cv: 'Built production web applications with Python and TypeScript.',
    notes: 'User-confirmed preferences', minScore: 3.75,
    locationAlways: ['Bay Area'], locationAllow: ['Bay Area', 'Remote', 'USA', 'United States'] };
  writeJobProfile(profile);
  const description = 'Build production web applications with Python and TypeScript. '.repeat(9);
  const make = (id, company, location, score, extra = {}) => {
    const posting = job(id, { title: 'Software Engineer', company, location, score,
      url: `https://job-boards.greenhouse.io/${company.toLowerCase()}/jobs/${id}`, description, ...extra });
    posting.scoreContext ??= scoringContext(posting, profile);
    return posting;
  };
  const rows = [make('1', 'BayCo', 'Emeryville, CA', 3.5),
    make('2', 'RemoteCo', 'Remote, United States', 3.65, { description: '', flags: ['incomplete-jd', 'verification-failed', 'unknown-experience'] }),
    make('3', 'NYCo', 'Remote - New York City, NY', 4),
    make('4', 'OutsideCo', 'Seattle, WA, USA', 4),
    make('5', 'BlockedCo', 'San Jose, CA', 3.6, { flags: ['blocked-workAuthorization'] }),
    make('6', 'BadReviewCo', 'San Jose, CA', 3.65, { flags: ['unsupported-evidence', 'verification-failed'] }),
    make('7', 'UnsupportedCo', 'San Jose, CA', 4, { url: 'https://www.builtinsf.com/job/7' }),
    make('8', 'WrongRoleCo', 'Remote US', 3.65, { description: '', flags: ['incomplete-jd', 'verification-failed', 'mismatched-title'] }),
    make('9', 'StaleCo', 'Remote US', 3.65, { scoreContext: 'old-profile' }),
    make('10', 'BelowFloorCo', 'Remote US', 3.4),
    make('11', 'AuthorizedCo', 'Remote US', 3.5, { flags: ['no-sponsorship'] })];
  writeJobs(rows);
  assert.deepEqual(digestCandidates(rows, profile, now.getTime()), [], 'unverified jobs are never presented as verified digest recommendations');
  assert.deepEqual(applicationCandidates(now).map(row => row.id), ['2', '1', '11']);
});

test('unsupported ATS never enters the automatic queue or consumes a daily reservation', () => {
  const profile = { ...DEFAULT_JOB_PROFILE, cv: 'Built production web applications with Python and TypeScript.',
    notes: 'User-confirmed preferences', minScore: 3 };
  writeJobProfile(profile);
  const description = 'Build production web applications, test APIs and review changes. '.repeat(8);
  const supported = job('1', { title: 'Software Engineer', location: 'Remote US', description, score: 4.5 });
  supported.review = { context: scoringContext(supported, profile), roleEvidence: description.slice(0, 80), cvEvidence: profile.cv,
    checks: Object.fromEntries(ELIGIBILITY_CHECKS.map(key => [key, key === 'location' ? { status: 'met', quote: 'Remote US' } : { status: 'not-stated' }])) };
  const unsupported = { ...supported, id: '2', company: 'Other', url: 'https://www.builtinsf.com/job/2' };
  unsupported.review = { ...supported.review, context: scoringContext(unsupported, profile) };
  const branded = { ...supported, id: '3', company: 'Third', url: 'https://careers.third.test/position?gh_jid=3333',
    alternateUrls: ['https://job-boards.greenhouse.io/third/jobs/3333'] };
  branded.review = { ...supported.review, context: scoringContext(branded, profile) };
  writeJobs([unsupported, supported, branded]);
  assert.deepEqual(applicationCandidates(now).map(row => row.id).sort(), ['1', '3']);
  assert.doesNotThrow(() => checkApplicationPreparation('3'), 'a verified direct alias can prepare without allowing the branded host');
  assert.throws(() => checkApplicationPreparation('2'), /Board adapter unavailable/);
  assert.throws(() => reserveApplication('2', settings, now), /Board adapter unavailable/);
  assert.equal(applicationBoard(now).today, 0);
  assert.equal(readJobs()[0].application, undefined);
});

test('newly confirmed facts requeue a blocked candidate, never a submission-locked one', () => {
  const cv = 'Built production web applications with Python and TypeScript.';
  const description = 'Build production web applications, test APIs, review changes and collaborate with engineers. '.repeat(8);
  const profile = { ...DEFAULT_JOB_PROFILE, cv, notes: 'User-confirmed preferences', locationAllow: ['United States'] };
  writeJobProfile(profile);
  const candidate = job('1', { title: 'Software Engineer', location: 'Remote, United States', description, score: 4.5 });
  candidate.review = { context: scoringContext(candidate, profile), roleEvidence: description.slice(0, 80), cvEvidence: cv,
    checks: Object.fromEntries(ELIGIBILITY_CHECKS.map(key => [key, key === 'location' ? { status: 'met', quote: 'Remote, United States' } : { status: 'not-stated' }])) };
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
