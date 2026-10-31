import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { runApplications, tickApplicationsDaily } from './job-application-runner.ts';
import { applicationPreferencesHash, configureApplications, applicationBoard } from '../extension/robin/job-application-domain.ts';
import { readJobs, writeJobs, writeJobProfile } from '../extension/robin/store.ts';
import { DEFAULT_JOB_PROFILE } from '../extension/robin/jobs.ts';
import { APPLICATION_SUBMISSION_POLICY } from '../extension/robin/job-applications.ts';
import { claimBackgroundRun, releaseBackgroundRun } from '../extension/robin/background-run-domain.ts';
import { resetTaskStore } from '../extension/robin/task-store.test-support.mjs';

const dir = mkdtempSync(join(tmpdir(), 'robin-jobright-test-'));
const old = { ROBIN_DATA_DIR: process.env.ROBIN_DATA_DIR, PATH: process.env.PATH, PLAYWRIGHT_MCP_EXTENSION_TOKEN: process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN };
process.env.ROBIN_DATA_DIR = dir;
process.env.PATH = `${dir}/bin:${process.env.PATH}`;
process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = 'secret-never-log';
resetTaskStore(dir); mkdirSync(join(dir, 'bin'));
const fixture = join(dir, 'fixture.json');
writeFileSync(join(dir, 'bin/playwright-cli'), `#!${process.execPath}
const fs=require('node:fs'), path=${JSON.stringify(fixture)};
if(process.env.PI_WEB_PASSWORD)throw Error('password leaked');
const file=process.argv.find(a=>a.startsWith('--filename='));
if(!file){console.log(JSON.stringify({connected:true}));process.exit(0);}
const source=fs.readFileSync(file.slice(11),'utf8'), start=source.lastIndexOf(')(page, ')+8;
const input=JSON.parse(source.slice(start,source.indexOf('); } catch',start)));
if('resume' in input || 'replaceResume' in input)throw Error('Runner must not upload or replace Jobright resume');
const fixture=JSON.parse(fs.readFileSync(path,'utf8'));fixture.calls.push(input.mode);
if(fixture.scenario==='unavailable'){console.log(JSON.stringify({failure:'POSTING_UNAVAILABLE'}));fs.writeFileSync(path,JSON.stringify(fixture));process.exit(0);}
if(fixture.scenario==='invalid'){console.log('secret-never-log invalid response');fs.writeFileSync(path,JSON.stringify(fixture));process.exit(0);}
let result;
if(input.mode==='autofill'){fixture.state={fields:[{key:'name',label:'Name',kind:'text',value:'Wrong',required:true,options:[],check:'needs-review'}],resumeVerified:fixture.scenario!=='no-resume',errors:[],autofill:{clickedAt:new Date().toISOString(),completedAt:new Date().toISOString(),summary:'1/1 required fields filled'}};result={snapshot:fixture.state};}
else if(input.mode==='repair'){for(const d of input.decisions||[])if(d.action!=='attention')fixture.state.fields.find(f=>f.key===d.key).value=d.value;result={snapshot:fixture.state};}
else if(input.mode==='submit'){const rejected=fixture.scenario==='rejected-always'||fixture.scenario==='rejected-first'&&fixture.calls.filter(x=>x==='submit').length===1;result=rejected?{rejection:{at:new Date().toISOString(),url:input.url,text:'Missing entry for required field: Name'}}:fixture.scenario==='uncertain'?{uncertain:true}:{receipt:{at:new Date().toISOString(),url:input.url,text:'Thanks so much for applying to join us at Example!'}};}
else if(input.mode==='receipt'){result={failure:'NO_RECEIPT'};}
else result={snapshot:fixture.state};
fs.writeFileSync(path,JSON.stringify(fixture));console.log(JSON.stringify(result));
`, { mode: 0o700 });
let review;
const runner = { tickApplicationsDaily, runApplications: (options) => runApplications(options, { loadCV: async () => 'Approved CV', review: (...args) => review(...args) }) };
const job = { id:'1',title:'Engineer',company:'Example',location:'US',source:'greenhouse',status:'new',url:'https://job-boards.greenhouse.io/example/jobs/1',discoveredAt:new Date().toISOString() };
beforeEach(() => {
  writeJobs([job]); writeJobProfile({ ...DEFAULT_JOB_PROFILE, notes: 'approved' });
  const bytes=Buffer.from('%PDF-1.0\nfixture'), resumePath=join(dir,'approved.pdf');writeFileSync(resumePath,bytes);
  configureApplications({ enabled:false,answers:{},resumePath,resumeHash:createHash('sha256').update(bytes).digest('hex'),preferencesHash:applicationPreferencesHash(),submissionPolicy:APPLICATION_SUBMISSION_POLICY });
  writeFileSync(fixture,JSON.stringify({calls:[],scenario:'success'}));
  review = (snapshot) => ({ decisions:snapshot.fields.map(f=>({key:f.key,action:'set',value:'Correct',source:'cv',quote:'Approved CV',reason:'CV'})),issues:[] });
});
after(() => { for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(dir,{force:true,recursive:true}); });

test('autofill precedes corrections, and verified submission alone marks Applied',async()=>{
  await runner.runApplications({id:'1'});
  assert.equal(readJobs()[0].status,'applied', JSON.stringify({ application: readJobs()[0].application, cli: JSON.parse(readFileSync(fixture,'utf8')) }));
  assert.equal(readJobs()[0].application.stage,'submitted');
  assert.deepEqual(JSON.parse(readFileSync(fixture,'utf8')).calls,['autofill','repair','submit']);
  assert.equal(applicationBoard().todaySubmitted,1);
  await assert.rejects(runner.runApplications({id:'1'}),/no longer available/);
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
test('a transport/parse error is a technical failure, not Attention and not a token leak',async()=>{
  writeFileSync(fixture,JSON.stringify({calls:[],scenario:'invalid'}));await runner.runApplications({id:'1'});
  assert.equal(readJobs()[0].application.stage,'error');
  assert.ok(!JSON.stringify(readJobs()).includes('secret-never-log'));
});
test('ambiguous submit is durable and cannot be retried or silently reset',async()=>{
  writeFileSync(fixture,JSON.stringify({calls:[],scenario:'uncertain'}));await runner.runApplications({id:'1'});
  assert.equal(readJobs()[0].status,'new');assert.equal(readJobs()[0].application.stage,'uncertain');
  assert.ok(readJobs()[0].application.submission);
  await assert.rejects(runner.runApplications({id:'1'}),/no longer available/);
  await assert.rejects(runner.runApplications({id:'1',mode:'receipt'}),/No unambiguous receipt/);
  assert.equal(JSON.parse(readFileSync(fixture,'utf8')).calls.filter(x=>x==='submit').length,1);
});
test('only an explicit validation rejection permits one rebuilt, fully audited retry',async()=>{
  writeFileSync(fixture,JSON.stringify({calls:[],scenario:'rejected-first'}));await runner.runApplications({id:'1'});
  assert.equal(readJobs()[0].status,'applied');assert.equal(readJobs()[0].application.rejections.length,1);
  assert.deepEqual(JSON.parse(readFileSync(fixture,'utf8')).calls,['autofill','repair','submit','autofill','repair','submit']);
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
test('paused schedules and a remote owner prevent background work',async()=>{
  await runner.tickApplicationsDaily();assert.equal(readJobs()[0].application,undefined);
  claimBackgroundRun('job-applications','remote');try{assert.equal((await runner.runApplications({id:'1'})).started,false);}finally{releaseBackgroundRun('job-applications','remote');}
});
