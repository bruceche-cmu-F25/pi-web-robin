import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { runApplications, tickApplicationsDaily } from './job-application-runner.ts';
import { withBskApplicationBrowser } from './job-application-bsk-browser.ts';
import { applicationPreferencesHash, configureApplications, applicationBoard, applicationCandidates } from '../extension/robin/job-application-domain.ts';
import { readJobs, writeJobs, writeJobProfile } from '../extension/robin/store.ts';
import { DEFAULT_JOB_PROFILE } from '../extension/robin/jobs.ts';
import { scoringContext, ELIGIBILITY_CHECKS } from '../extension/robin/job-evidence.ts';
import { JOBRIGHT_TRUSTED_SUBMISSION_POLICY } from '../extension/robin/job-applications.ts';
import { claimBackgroundRun, releaseBackgroundRun } from '../extension/robin/background-run-domain.ts';
import { resetTaskStore } from '../extension/robin/task-store.test-support.mjs';

const dir = mkdtempSync(join(tmpdir(), 'robin-jobright-test-'));
const old = { ROBIN_DATA_DIR: process.env.ROBIN_DATA_DIR, ROBIN_BSK_APPLICATIONS_READY: process.env.ROBIN_BSK_APPLICATIONS_READY };
process.env.ROBIN_DATA_DIR = dir;
process.env.ROBIN_BSK_APPLICATIONS_READY = '1';
resetTaskStore(dir);
const fixture = join(dir, 'fixture.json');
let review;
async function mockWithBrowser(job, _signal, work) {
  return work(async (mode, input = {}) => {
    const record = JSON.parse(readFileSync(fixture, 'utf8'));
    record.calls.push(mode);
    if (record.scenario === 'unavailable') {
      writeFileSync(fixture, JSON.stringify(record));
      throw Object.assign(new Error('The employer displays a missing/unavailable posting'), { code: 'POSTING_UNAVAILABLE' });
    }
    if (record.scenario === 'invalid') {
      writeFileSync(fixture, JSON.stringify(record));
      throw new Error('Browser operation did not return a usable result');
    }
    let result;
    if (mode === 'autofill') {
      record.state = { fields: record.scenario === 'no-form' ? [] : [{ key: 'name', label: 'Name', kind: 'text', value: 'Wrong', required: true, options: [], check: 'needs-review' }],
        resumeVerified: record.scenario !== 'no-resume', errors: [], autofill: { clickedAt: new Date().toISOString(), completedAt: new Date().toISOString(), summary: '1/1 required fields filled' } };
      result = { snapshot: record.state };
    } else if (mode === 'repair') {
      for (const d of input.decisions || []) if (d.action !== 'attention') record.state.fields.find(f => f.key === d.key).value = d.value;
      result = { snapshot: record.state };
    } else if (mode === 'preflight' && record.scenario === 'preflight-fails') {
      writeFileSync(fixture, JSON.stringify(record));
      throw new Error('SUBMIT_CONTROL_UNAVAILABLE');
    } else if (mode === 'submit') {
      const rejected = record.scenario === 'rejected-always' || record.scenario === 'rejected-first' && record.calls.filter(x => x === 'submit').length === 1;
      result = rejected ? { rejection: { at: new Date().toISOString(), url: job.application.url, text: 'Missing entry for required field: Name' } }
        : record.scenario === 'uncertain' ? { uncertain: true, reason: 'No definitive receipt after Submit (posting matched; success heading=false; confirmation text=false; form visible=true; correction heading=false); do not resubmit automatically.' }
        : { receipt: { at: new Date().toISOString(), url: job.application.url, text: 'Thanks so much for applying to join us at Example!' } };
    } else if (mode === 'receipt') throw new Error('No unambiguous receipt found');
    else result = { snapshot: record.state };
    writeFileSync(fixture, JSON.stringify(record));
    return result;
  });
}
const runner = { tickApplicationsDaily, runApplications: (options) => runApplications(options,
  { loadCV: async () => 'Approved CV', review: (...args) => review(...args) }, mockWithBrowser) };
const job = { id:'1',title:'Engineer',company:'Example',location:'US',source:'greenhouse',status:'new',url:'https://job-boards.greenhouse.io/example/jobs/1',discoveredAt:new Date().toISOString() };
beforeEach(() => {
  writeJobs([job]); writeJobProfile({ ...DEFAULT_JOB_PROFILE, notes: 'approved' });
  const bytes=Buffer.from('%PDF-1.0\nfixture'), resumePath=join(dir,'approved.pdf');writeFileSync(resumePath,bytes);
  configureApplications({ enabled:false,answers:{},resumePath,resumeHash:createHash('sha256').update(bytes).digest('hex'),preferencesHash:applicationPreferencesHash(),submissionPolicy:JOBRIGHT_TRUSTED_SUBMISSION_POLICY });
  writeFileSync(fixture,JSON.stringify({calls:[],scenario:'success'}));
  review = (snapshot) => ({ decisions:snapshot.fields.map(f=>({key:f.key,action:'set',value:'Correct',source:'cv',quote:'Approved CV',reason:'CV'})),issues:[] });
});
after(() => { for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(dir,{force:true,recursive:true}); });

test('without an approved live BSK pilot, no preparation reserves a job or opens a browser', async () => {
  delete process.env.ROBIN_BSK_APPLICATIONS_READY;
  try {
    await assert.rejects(runner.runApplications({id:'1'}), /real form read-back and receipt pilot/);
    assert.deepEqual(JSON.parse(readFileSync(fixture,'utf8')).calls, []);
    assert.equal(readJobs()[0].application, undefined);
  } finally { process.env.ROBIN_BSK_APPLICATIONS_READY = '1'; }
});

test('a failed BSK batch preflight consumes no application reservation or browser attempt', async () => {
  await assert.rejects(runApplications({ id: '1' }, { loadCV: async () => 'Approved CV', review },
    withBskApplicationBrowser, async () => { throw new Error('BSK_BROWSER_UNAVAILABLE'); }), /BSK_BROWSER_UNAVAILABLE/);
  assert.equal(readJobs()[0].application, undefined);
  assert.equal(applicationBoard().today, 0);
  assert.match(applicationBoard().preflightError.message, /BSK_BROWSER_UNAVAILABLE/);
  assert.deepEqual(JSON.parse(readFileSync(fixture, 'utf8')).calls, []);
});

test('autofill precedes corrections, and verified submission alone marks Applied',async()=>{
  await runner.runApplications({id:'1'});
  assert.equal(readJobs()[0].status,'applied', JSON.stringify({ application: readJobs()[0].application, cli: JSON.parse(readFileSync(fixture,'utf8')) }));
  assert.equal(readJobs()[0].application.stage,'submitted');
  assert.deepEqual(JSON.parse(readFileSync(fixture,'utf8')).calls,['autofill','repair','preflight','submit']);
  assert.equal(applicationBoard().todaySubmitted,1);
  await assert.rejects(runner.runApplications({id:'1'}),/no longer available/);
});
test('a known job id submits and updates only that posting, never another candidate', async () => {
  const other = { ...job, id: '2', company: 'Other', title: 'Backend Engineer',
    url: 'https://job-boards.greenhouse.io/other/jobs/2' };
  writeJobs([job, other]);
  await runner.runApplications({ id: '2' });
  assert.equal(readJobs().find(row => row.id === '1').application, undefined);
  assert.equal(readJobs().find(row => row.id === '1').status, 'new');
  assert.equal(readJobs().find(row => row.id === '2').status, 'applied');
  assert.equal(readJobs().find(row => row.id === '2').application.receipt.url, other.url);
});

test('an exploratory direct ATS job with no JD still needs audited form and exact receipt', async () => {
  const profile = { ...DEFAULT_JOB_PROFILE, cv: 'Built FastAPI backends and React applications.',
    notes: 'approved', minScore: 3.75, locationAllow: ['Bay Area', 'Remote'] };
  writeJobProfile(profile);
  const posting = { ...job, title: 'Software Engineer', company: 'Example', location: 'Remote US',
    description: '', score: 3.65, flags: ['incomplete-jd', 'verification-failed'] };
  posting.scoreContext = scoringContext(posting, profile);
  writeJobs([posting]);
  configureApplications({ enabled: true, at: '00:00', dailyLimit: 10, preferencesHash: applicationPreferencesHash() });
  assert.equal(applicationCandidates().length, 1);
  await runner.runApplications({ scheduled: true });
  assert.equal(readJobs()[0].application.stage, 'submitted');
  assert.equal(readJobs()[0].status, 'applied');
  assert.deepEqual(JSON.parse(readFileSync(fixture,'utf8')).calls, ['autofill','repair','preflight','submit']);
});

test('preflight failure does not persist a submission lock or click Submit', async () => {
  writeFileSync(fixture, JSON.stringify({calls:[],scenario:'preflight-fails'}));
  await runner.runApplications({id:'1'});
  const app = readJobs()[0].application;
  assert.equal(app.stage, 'error');
  assert.equal(app.submission, undefined);
  assert.deepEqual(JSON.parse(readFileSync(fixture,'utf8')).calls, ['autofill','repair','preflight']);
});

test('a Jobright completion without employer form fields stops before CV review or Submit', async () => {
  writeFileSync(fixture, JSON.stringify({calls:[],scenario:'no-form'}));
  await runner.runApplications({id:'1',validateOnly:true});
  const row = readJobs()[0];
  assert.equal(row.application.stage,'error');
  assert.match(row.application.blockers.join(' '), /No employer form fields/);
  assert.deepEqual(JSON.parse(readFileSync(fixture,'utf8')).calls, ['autofill']);
  assert.equal(row.application.submission, undefined);
});

test('Ashby uses the same Job ID, durable grant and one-click receipt path', async () => {
  writeJobs([{...job,source:'ashby',url:'https://jobs.ashbyhq.com/example/40659fe7-545e-4b08-b6d7-2567b18b9ed3/application'}]);
  await runner.runApplications({id:'1'});
  const row = readJobs()[0];
  assert.equal(row.application.stage,'submitted');
  assert.equal(row.status,'applied');
  assert.ok(row.application.submission);
  assert.deepEqual(JSON.parse(readFileSync(fixture,'utf8')).calls, ['autofill','repair','preflight','submit']);
});

test('only this posting’s scoped answers reach evidence and review; the full configuration still binds submission', async () => {
  configureApplications({ answers: { Name: 'General', '[job:1] Name': 'Correct', '[job:2] Consent': 'foreign-consent' } });
  const original = review;
  review = (snapshot, evidence, scoped) => {
    assert.deepEqual(scoped.answers, { name: 'Correct' });
    assert.ok(evidence.confirmed.includes('Correct'));
    assert.ok(!evidence.confirmed.includes('foreign-consent'));
    return original(snapshot);
  };
  await runner.runApplications({ id: '1' });
  assert.equal(readJobs()[0].application.stage, 'submitted');
});

test('missing Jobright attachment blocks submission without attempting a replacement',async()=>{
  writeFileSync(fixture,JSON.stringify({calls:[],scenario:'no-resume'}));await runner.runApplications({id:'1'});
  assert.equal(readJobs()[0].application.stage,'error');
  assert.match(readJobs()[0].application.blockers.join(' '),/No attached resume/);
  assert.ok(!JSON.parse(readFileSync(fixture,'utf8')).calls.includes('submit'));
});
test('unknown personal answers go to Attention without clicking Submit',async()=>{
  review = snapshot=>({decisions:snapshot.fields.map(f=>({key:f.key,action:'attention',value:'',source:'none',quote:'',reason:'Need user fact'})),issues:[]});
  await runner.runApplications({id:'1'});
  assert.equal(readJobs()[0].application.stage,'attention', JSON.stringify(readJobs()[0].application));
  assert.equal(readJobs()[0].status,'new');
  assert.ok(!JSON.parse(readFileSync(fixture,'utf8')).calls.includes('submit'));
});
test('a browser transport error is technical, not a personal question',async()=>{
  writeFileSync(fixture,JSON.stringify({calls:[],scenario:'invalid'}));await runner.runApplications({id:'1'});
  assert.equal(readJobs()[0].application.stage,'error');
  assert.ok(!JSON.stringify(readJobs()).includes('secret-never-log'));
});
test('ambiguous submit is durable and cannot be retried or silently reset',async()=>{
  writeFileSync(fixture,JSON.stringify({calls:[],scenario:'uncertain'}));await runner.runApplications({id:'1'});
  assert.equal(readJobs()[0].status,'new');assert.equal(readJobs()[0].application.stage,'uncertain');
  assert.ok(readJobs()[0].application.submission);
  assert.match(readJobs()[0].application.blockers[0], /form visible=true/);
  await assert.rejects(runner.runApplications({id:'1'}),/no longer available/);
  await assert.rejects(runner.runApplications({id:'1',mode:'receipt'}),/No unambiguous receipt/);
  assert.equal(JSON.parse(readFileSync(fixture,'utf8')).calls.filter(x=>x==='submit').length,1);
});
test('only an explicit validation rejection permits one rebuilt, fully audited retry',async()=>{
  writeFileSync(fixture,JSON.stringify({calls:[],scenario:'rejected-first'}));await runner.runApplications({id:'1'});
  assert.equal(readJobs()[0].status,'applied');assert.equal(readJobs()[0].application.rejections.length,1);
  assert.deepEqual(JSON.parse(readFileSync(fixture,'utf8')).calls,['autofill','repair','preflight','submit','autofill','repair','preflight','submit']);
  assert.equal(applicationBoard().today,1);
});
test('repeated explicit rejection stops after the single bounded recovery, never claims success',async()=>{
  writeFileSync(fixture,JSON.stringify({calls:[],scenario:'rejected-always'}));await runner.runApplications({id:'1'});
  assert.equal(readJobs()[0].status,'new');assert.equal(readJobs()[0].application.stage,'error');
  assert.equal(readJobs()[0].application.rejections.length,2);
  assert.equal(JSON.parse(readFileSync(fixture,'utf8')).calls.filter(x=>x==='submit').length,2);
});
test('validation-only and missing submission authorization never click Submit',async()=>{
  await runner.runApplications({id:'1',validateOnly:true});assert.equal(readJobs()[0].application.stage,'review');
  configureApplications({submissionPolicy:''});await runner.runApplications({id:'1'});assert.equal(readJobs()[0].application.stage,'review');
  assert.ok(!JSON.parse(readFileSync(fixture,'utf8')).calls.includes('submit'));
});
test('unavailable postings are explained and not repeatedly retried as widget failures',async()=>{
  writeFileSync(fixture,JSON.stringify({calls:[],scenario:'unavailable'}));await runner.runApplications({id:'1'});
  assert.match(readJobs()[0].application.blockers.join(' '),/missing\/unavailable posting/);
  assert.equal(readJobs()[0].application.stage,'unavailable');
  assert.equal(readJobs()[0].status,'new', 'unavailable is not a user-requested pipeline drop');
  assert.deepEqual(JSON.parse(readFileSync(fixture,'utf8')).calls,['autofill']);
});
test('automatic batches continue across a day without a daily cap or retrying unanswered roles', async () => {
  const now = new Date();
  const cv = 'Approved CV built production Python and TypeScript services with Terraform.';
  const profile = { ...DEFAULT_JOB_PROFILE, notes: 'approved', cv, minScore: 3 };
  writeJobProfile(profile);
  configureApplications({ enabled: true, dailyLimit: 0, at: '00:00', preferencesHash: applicationPreferencesHash() });
  const description = 'Build tested backend services and maintain production APIs on cloud infrastructure. '.repeat(8);
  const jobs = [
    { ...job, title: 'Software Engineer', location: 'San Francisco, CA', description, score: 4.5, postedAt: now.toISOString().slice(0, 10) },
    { ...job, id: '2', url: 'https://job-boards.greenhouse.io/example/jobs/2', title: 'Backend Engineer', location: 'San Francisco, CA', description, score: 4.5, postedAt: now.toISOString().slice(0, 10) },
  ];
  for (const entry of jobs) entry.review = { context: scoringContext(entry, profile), roleEvidence: description.slice(0, 90), cvEvidence: cv,
    checks: Object.fromEntries(ELIGIBILITY_CHECKS.map(key => [key, key === 'location' ? { status: 'met', quote: 'San Francisco, CA' } : { status: 'not-stated' }])) };
  writeJobs(jobs);
  assert.equal(applicationCandidates(now).length, 2);
  assert.equal((await runner.runApplications({ scheduled: true, now })).value.processed, 0, 'zero pauses unattended work');
  assert.equal((await runner.runApplications({ now })).value.processed, 2);
  assert.equal(applicationBoard(now).today, 2);
  assert.equal(applicationBoard(now).todaySubmitted, 2);
  writeJobs(jobs);
  configureApplications({ dailyLimit: 1 });
  const previousReview = review;
  review = (snapshot, evidence, ...rest) => evidence.job.includes('Software Engineer')
    ? { decisions: snapshot.fields.map(field => ({ key: field.key, action: 'attention', value: '', source: 'none', quote: '', reason: 'User must confirm' })), issues: [] }
    : previousReview(snapshot, evidence, ...rest);
  assert.equal((await runner.runApplications({ scheduled: true, now })).value.processed, 1);
  assert.equal(readJobs().find(entry => entry.id === '1').application.stage, 'attention');
  assert.equal((await runner.runApplications({ scheduled: true, now })).value.processed, 1, 'next batch runs despite one attempt today');
  assert.equal(readJobs().find(entry => entry.id === '2').application.stage, 'submitted', 'an unresolved question does not stop the next safe application');
  assert.equal((await runner.runApplications({ scheduled: true, now })).value.processed, 0, 'unanswered roles are not repeatedly attempted');
  assert.equal(applicationBoard(now).todaySubmitted, 1);
  const more = Array.from({ length: 21 }, (_, index) => {
    const entry = { ...jobs[1], id: String(index + 3), company: `Company ${index + 3}`, title: 'Backend Engineer',
      url: `https://job-boards.greenhouse.io/company${index + 3}/jobs/${index + 3}` };
    return { ...entry, review: { ...jobs[1].review, context: scoringContext(entry, profile) } };
  });
  writeJobs(more);
  configureApplications({ dailyLimit: 20 });
  assert.equal(applicationCandidates(now).length, 21);
  assert.equal((await runner.runApplications({ scheduled: true, now })).value.processed, 20, 'one automatic run uses the configured limit');
  assert.equal(readJobs().filter(entry => !entry.application).length, 1);
  assert.equal((await runner.runApplications({ scheduled: true, now })).value.processed, 1, 'the next run continues automatically');
  assert.equal(applicationBoard(now).today, 21);
});

test('paused or unlimited schedules and a remote owner prevent unattended work',async()=>{
  await runner.tickApplicationsDaily();assert.equal(readJobs()[0].application,undefined);
  configureApplications({ enabled: true, dailyLimit: 0, at: '00:00' });
  await runner.tickApplicationsDaily();assert.equal(readJobs()[0].application,undefined);
  claimBackgroundRun('job-applications','remote');try{assert.equal((await runner.runApplications({id:'1'})).started,false);}finally{releaseBackgroundRun('job-applications','remote');}
});
