import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root=mkdtempSync(join(tmpdir(),'outreach-auto-'));process.env.ROBIN_DATA_DIR=root;
const a=await import('./outreach-automation-domain.ts');
const d=await import('./jarvis-domain.ts');
after(()=>rmSync(root,{recursive:true,force:true}));
const burden=Object.fromEntries(['change','breadth','unfiltered','footprint'].map(k=>[k,{score:2,evidence:'Public evidence'}]));
const lead={id:'x',name:'Ava Example',company:'Example Brand',role:'Founder and CEO',profileUrl:'https://example.com/ava',evidence:'Ava is the current founder and CEO of Example Brand.',evidenceUrl:'https://example.com/about',segment:'info_exec',persona:'ecommerce_owner',sourcingLane:'dtc_shopify',assessedVersion:6,status:'new',watchList:'customers, platforms, inventory and competitors',informationNeedEvidence:{url:'https://example.com/interview',quote:'Ava reviews customer, platform and inventory signals.'},whyNow:{summary:'New product launch',url:'https://example.com/news',quote:'Launched a new line in 2026.'},companyFit:{score:42,evidence:'Hands-on operator'},reachability:{score:40,evidence:'Personal route'},newsBurden:burden,socials:{instagram:'https://instagram.com/avaexample',linkedin:'https://linkedin.com/in/avaexample'},email:'',emailQuote:'',emailSource:'',emailCheck:'missing'};
const check={instagram:'personal',instagramUrl:lead.socials.instagram,sourceUrl:lead.socials.instagram,note:'Bio explicitly identifies Ava and her current brand.',emailSearched:false,checkedAt:new Date().toISOString()};
test('current DTC ICP uses personal Instagram or verified email and never falls back to LinkedIn',()=>{
 assert.equal(a.automationRoute(lead),'research');
 assert.equal(a.automationRoute(lead,check),'instagram');
 assert.equal(a.automationRoute(lead,{...check,instagram:'brand'}),'research');
 assert.equal(a.automationRoute({...lead,socials:{...lead.socials,instagram:'https://instagram.com/changed'}},check),'research');
 assert.equal(a.automationRoute({...lead,socials:{linkedin:lead.socials.linkedin}}, {...check,instagram:'missing',instagramUrl:undefined,emailSearched:true}),'skip');
 assert.equal(a.automationRoute({...lead,socials:{linkedin:lead.socials.linkedin},email:'ava@example.com',emailSource:'https://example.com/staff',emailQuote:'Ava ava@example.com',emailCheck:'source_found'}),'email');
});
test('legacy healthcare is excluded from the current campaign',()=>{
 const clinic={...lead,segment:'clinic'};
 assert.equal(a.automationRoute(clinic,check),'skip');
 assert.equal(a.automationRoute({...clinic,email:'ava@example.com',emailSource:'https://example.com/staff',emailQuote:'Ava ava@example.com',emailCheck:'source_found'},check),'skip');
});
test('all contacted, suppressed, replied and uncertain records are excluded across channels',()=>{
 for(const patch of [{sentAt:'2026-09-30T10:00:00Z'},{status:'declined'},{sendAttempt:{state:'uncertain'}},{socialOutreach:{linkedin:{sentAt:'2026-09-30T10:00:00Z'}}},{socialOutreach:{instagram:{repliedAt:'2026-09-30T10:00:00Z'}}}]) assert.equal(a.automationRoute({...lead,...patch},check),'skip');
});
test('daily count counts a multi-channel person once in Los Angeles time',()=>{
 assert.equal(a.contactedToday([{...lead,sentAt:'2026-09-30T10:00:00Z',socialOutreach:{instagram:{sentAt:'2026-09-30T11:00:00Z'}}}], '2026-09-30T15:00:00Z'),1);
 assert.equal(a.contactedToday([{...lead,sentAt:'2026-09-30T03:00:00Z'}],'2026-09-30T15:00:00Z'),0);
});
test('runner activity records observed work without claiming a future wake',()=>{
 const first=a.beginAutomationRunner('ensure-research','2026-09-30T15:00:00.000Z');
 assert.deepEqual(a.readOutreachAutomation().runner,{...first});
 const newer=a.beginAutomationRunner('status','2026-09-30T15:01:00.000Z');
 a.finishAutomationRunner(first.id,'failed','late result','2026-09-30T15:02:00.000Z');
 assert.equal(a.readOutreachAutomation().runner.id,newer.id,'an older invocation cannot overwrite newer activity');
 a.finishAutomationRunner(newer.id,'succeeded','checked live state','2026-09-30T15:03:00.000Z');
 assert.deepEqual(a.readOutreachAutomation().runner,{...newer,outcome:'succeeded',finishedAt:'2026-09-30T15:03:00.000Z',detail:'checked live state'});
});
test('a backend busy refusal releases only the unstarted email reservation',()=>{
 d.addJarvisCandidates([{...lead,name:'Cy Example',company:'Mail Brand',socials:{linkedin:'https://linkedin.com/in/cyexample'},email:'cy@example.com',emailSource:'https://example.com/cy',emailQuote:'Cy: cy@example.com',seniority:'Executive',industry:'DTC',profileUrl:'https://example.com/cy',evidenceUrl:'https://example.com/cy',evidence:'Cy operates Mail Brand.',needHypothesis:'To validate',opener:'I came across your work building Mail Brand.'}],new Set(['cy@example.com']));
 let saved=d.readJarvis().leads.find(l=>l.name==='Cy Example');
 d.updateOutreachReviewQueue({op:'add',ids:[saved.id]});saved=d.readJarvis().leads.find(l=>l.id===saved.id);
 d.prepareJarvisOutreachBatch({channel:'email',confirmed:true,items:[{id:saved.id,revision:saved.revision,identityChecked:true,draftChecked:true,route:saved.email,source:saved.emailSource,subject:saved.subject,body:saved.body}]},false);
 const attempt=a.claimAutomatedOutreach(saved.id,'email');
 a.releaseUnstartedAutomatedEmailAttempt(attempt.id);
 assert.equal(a.readOutreachAutomation().attempts.some(item=>item.id===attempt.id),false);
 const retry=a.claimAutomatedOutreach(saved.id,'email');
 assert.ok(retry.id,'the same approved plan can be reserved after a confirmed pre-delivery refusal');
 assert.throws(()=>a.releaseUnstartedAutomatedEmailAttempt('missing'),/unstarted pending email/);
 a.finishAutomatedOutreach(retry.id,'Result unknown',false);
 assert.throws(()=>a.releaseUnstartedAutomatedEmailAttempt(retry.id),/unstarted pending email/,'uncertain attempts are never released');
});
test('CRM-confirmed delivery repairs a ledger write interrupted after the external send',()=>{
 const candidate={...lead,name:'Bea Example',company:'Recovery Brand',socials:{instagram:'https://instagram.com/beaexample'},seniority:'Executive',industry:'DTC',profileUrl:'https://example.com/bea',evidenceUrl:'https://example.com/bea',evidence:'Bea operates Recovery Brand.',needHypothesis:'To validate',opener:'I came across your work building Recovery Brand.'};
 d.addJarvisCandidates([candidate]);
 let saved=d.readJarvis().leads.find(l=>l.name==='Bea Example');
 const checked={...check,instagramUrl:saved.socials.instagram,sourceUrl:saved.socials.instagram};
 a.recordContactCheck(saved.id,checked);
 d.updateOutreachReviewQueue({op:'add',ids:[saved.id]});saved=d.readJarvis().leads.find(l=>l.id===saved.id);
 const draft='Hi Bea, what do you use to keep up today?\n\nhttps://your-secretary.com';
 d.prepareJarvisOutreachBatch({channel:'instagram',confirmed:true,items:[{id:saved.id,revision:saved.revision,identityChecked:true,draftChecked:true,route:saved.socials.instagram,draft}]},false);
 const attempt=a.claimAutomatedOutreach(saved.id,'instagram');
 saved=d.readJarvis().leads.find(l=>l.id===saved.id);
 d.updateJarvisSocialOutreach(saved.id,{op:'sent',platform:'instagram',revision:saved.revision});
 assert.equal(a.readOutreachAutomation().attempts.find(item=>item.id===attempt.id).state,'pending');
 assert.deepEqual(a.reconcileAutomationAttempts(),{sent:1,blocked:0});
 assert.equal(a.readOutreachAutomation().attempts.find(item=>item.id===attempt.id).state,'sent');
 assert.deepEqual(a.reconcileAutomationAttempts(),{sent:0,blocked:0},'reconciliation is idempotent');
});
test('a send claim survives failures and cannot be claimed twice',()=>{
 d.addJarvisCandidates([{...lead,seniority:'Executive',industry:'DTC',profileUrl:'https://example.com/about',evidenceUrl:'https://example.com/about',evidence:'Ava operates Example Brand.',needHypothesis:'To validate',opener:'I came across your work building Example Brand.'}]);
 let l=d.readJarvis().leads.find(item=>item.name==='Ava Example');a.recordContactCheck(l.id,check);
 d.updateOutreachReviewQueue({op:'add',ids:[l.id]});l=d.readJarvis().leads.find(item=>item.id===l.id);
 d.prepareJarvisOutreachBatch({channel:'instagram',confirmed:true,items:[{id:l.id,revision:l.revision,identityChecked:true,draftChecked:true,route:l.socials.instagram,draft:'Hi Ava, what do you use to keep up today?\n\nhttps://your-secretary.com'}]},false);
 const attempt=a.claimAutomatedOutreach(l.id,'instagram');
 assert.throws(()=>a.claimAutomatedOutreach(l.id,'instagram'),/Previous attempt/);
 a.finishAutomatedOutreach(attempt.id,'UI result unavailable',false);
 assert.equal(a.readOutreachAutomation().attempts.find(item=>item.id===attempt.id).state,'uncertain');
 assert.throws(()=>a.claimAutomatedOutreach(l.id,'instagram'),/Previous attempt/);
 a.finishAutomatedOutreach(attempt.id,'Visible message in thread',true);
 assert.ok(d.readJarvis().leads.find(item=>item.id===l.id).socialOutreach.instagram.sentAt);
 a.finishAutomatedOutreach(attempt.id,'Late timeout from another process',false);
 assert.equal(a.readOutreachAutomation().attempts.find(item=>item.id===attempt.id).state,'sent','late failures cannot move confirmed delivery backward');
});
