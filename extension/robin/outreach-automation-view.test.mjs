import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildAutomationView} from './outreach-automation-view.ts';
const base={id:'a',name:'Ava',company:'Example Brand',status:'new',segment:'info_exec',persona:'ecommerce_owner',sourcingLane:'dtc_shopify',assessedVersion:6,watchList:'customers, platforms, inventory and competitors',informationNeedEvidence:{url:'https://example.com/need',quote:'Ava reviews customer, platform and inventory signals.'},whyNow:{summary:'Launch',url:'https://example.com/now',quote:'Launched in 2026.'},companyFit:{score:42,evidence:'Hands-on operator'},reachability:{score:40,evidence:'Personal route'},newsBurden:Object.fromEntries(['change','breadth','unfiltered','footprint'].map(k=>[k,{score:2,evidence:'Public evidence'}])),email:'',emailCheck:'missing',emailQuote:'',emailSource:'',socials:{instagram:'https://instagram.com/ava'},createdAt:'2026-09-30T06:59:00Z'};
const now='2026-09-30T18:00:00Z';
test('LA date excludes prior-day discovery and counts one person once across channels',()=>{
 const view=buildAutomationView({run:null,leads:[{...base,sentAt:'2026-09-30T09:00:00Z',socialOutreach:{instagram:{sentAt:'2026-09-30T10:00:00Z'}}}]},{checks:{},attempts:[]},now);
 assert.equal(view.discovered,0);assert.equal(view.contacted,1);assert.deepEqual(view.sent,{email:1,instagram:1});assert.equal(view.events.length,2);
});
test('pending and uncertain attempts remain visible across days and cannot count as ready or sent',()=>{
 const leads=[base,{...base,id:'b',name:'Bea'}];
 const checks=Object.fromEntries(leads.map(l=>[l.id,{instagram:'personal',instagramUrl:l.socials.instagram}]));
 const attempts=leads.map((l,i)=>({id:l.id,leadId:l.id,channel:'instagram',state:i?'uncertain':'pending',at:'2026-09-29T12:00:00Z'}));
 const v=buildAutomationView({run:null,leads},{checks,attempts},now);
 assert.equal(v.contacted,0);assert.equal(v.counts.instagram,0);assert.equal(v.unresolved,2);assert.equal(v.events.length,2);
});
test('pending LinkedIn connection is excluded from automated channels',()=>{
 const lead={...base,socials:{...base.socials,linkedin:'https://linkedin.com/in/ava'},linkedinConnection:{route:'https://linkedin.com/in/ava'}};
 const v=buildAutomationView({run:null,leads:[lead]},{checks:{a:{instagram:'personal',instagramUrl:base.socials.instagram}},attempts:[]},now);
 assert.equal(v.counts.connection,1);assert.equal(v.counts.instagram,0);
});
test('runner activity becomes stale after the expected half-hour cadence is missed',()=>{
 const runner={id:'run-1',command:'ensure-research',startedAt:'2026-09-30T17:10:00Z',finishedAt:'2026-09-30T17:11:00Z',outcome:'succeeded'};
 const fresh=buildAutomationView({run:null,leads:[]},{checks:{},attempts:[],runner},'2026-09-30T17:50:00Z');
 const stale=buildAutomationView({run:null,leads:[]},{checks:{},attempts:[],runner},'2026-09-30T18:00:01Z');
 assert.equal(fresh.runner.stale,false);
 assert.equal(stale.runner.stale,true);
});
