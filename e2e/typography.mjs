// Existing dev server; synthetic data only. No live model or personal API writes.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/typography.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fullstackPlan, practicePlan } from '../extension/robin/learning.ts';
import { COURSE_LESSONS, COURSE_STAGES, COURSE_SOURCES } from '../extension/robin/learning-course.ts';
import { DEFAULT_JOB_PROFILE } from '../extension/robin/jobs.ts';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:30141', out = process.env.AUDIT_OUT ?? '/tmp/pi-typography';
await mkdir(out, {recursive:true});
const now = '2026-10-31T12:00:00Z', today = '2026-10-31';
const note = { path:'Sample.md', title:'排版与可读性 Typography', links:[], unresolved:[], modified:now, excerpt:'同样的信息需要清晰的层级。Readable content matters more than decoration.' };
const project = {id:'fixture',name:'研究项目 Research',brief:'比较不同检索策略对引用准确性的影响。',objective:'验证一个具体假设',note:'## 研究笔记\n\n中文与 English 的混排需要保持清晰。\n\n### 方法\n\nReadability and information hierarchy.',links:[],createdAt:now,updatedAt:now,papers:0,needsPdf:0,read:0,messages:0,hasNotes:true};
const fixtures = {
 '/api/sessions':{sessions:[],runningSessionIds:[],sessionListVersion:1}, '/api/sessions/ui-state':{version:1,revision:0,sessions:{},projects:{}}, '/api/agent/running':{runningSessionIds:[],awaitingInputSessionIds:[],sessionListVersion:1},
 '/api/models':{models:[],modelList:[]}, '/api/tools/settings':{isWindows:false}, '/api/cache-miss-notices':{enabled:false}, '/api/skills':{skills:[]},
 '/api/robin/todos':{today,todos:[{id:'task',title:'阅读 React 文档并整理实验结果',due:today,done:false,revision:'v1'}]},
 '/api/robin/events':{today,events:[{id:'event',title:'项目讨论 Design review',date:today,start:'12:00',end:'13:00',source:'local'}],google:{connected:true}},
 '/api/robin/links':{links:[{id:'link',title:'Full Stack Open',url:'https://fullstackopen.com/en/',group:'日常入口',iconCheckedAt:today}]}, '/api/robin/rounds':{rounds:[]},
 '/api/robin/gmail':{today,connected:true,review:{reviewedAt:now,headline:'请查看项目进度，并确认面试安排。',skipped:0,items:[{id:'mail',category:'document',action:'none',triage:'act',subject:'项目资料 Project update',from:'Fixture',summary:'新的项目资料已准备好，请确认下一步安排。',snippet:'Fixture',next:'查看项目资料'}]}},
 '/api/robin/ai-weekly':{archive:[],preferences:{enabled:false},edition:null,read:[],deliveries:[],run:null},
 '/api/robin/jobs':{jobs:[{id:'job',company:'Example',title:'Software Engineer',location:'Remote',source:'greenhouse',status:'new',url:'https://example.com/jobs/1',discoveredAt:now,score:4.5,reason:'后端经验与岗位相关，需要核实入职时间和工作许可要求。'}],scan:null,minScore:3.75,configured:true},
 '/api/robin/jobs/profile':{profile:DEFAULT_JOB_PROFILE,providers:[],presets:[],starterCompanies:[]}, '/api/robin/jobs/score':{scoring:null,pending:0,model:null}, '/api/robin/jobs/sweep':{sweep:null},
 '/api/robin/jobs/applications':{settings:{enabled:false,timeZone:'America/Los_Angeles',at:'09:00',dailyLimit:10,configured:false},running:false,day:today,today:0,todaySubmitted:0,legacy:0,counts:{},total:0,rows:[]},
 '/api/robin/planner':{today,to:'2026-11-06',todos:[],events:[],google:{connected:true},conflicts:[],minuteOfDay:600,timezone:'UTC',now,revision:'fixture'},
 '/api/robin/fso':{fullstack:fullstackPlan([]),notes:{},current:null},
 '/api/robin/settings':{notifications:{channel:'telegram'},google:{clientId:{set:false},clientSecret:{set:false},calendars:[]},notion:{apiToken:{set:false}},playwright:{extensionToken:{set:false}},storedAt:'/fixture/secrets.json',googleRedirectUri:`${baseURL}/api/robin/google/callback`,telegram:{botToken:{set:false},allowedChatIds:[],dailyAgenda:{enabled:false,time:'08:00',locale:'en'},jobDigest:{enabled:false,morning:'08:00',evening:'20:00',count:10,locale:'en',chatIds:[],sweepAt:'03:00'},gmailDigest:{enabled:false,time:'08:00',locale:'en',chatIds:[],query:'newer_than:1d'},reminders:{enabled:false,lead:30,locale:'en',chatIds:[]},transcription:{enabled:false,baseUrl:'https://api.openai.com/v1',model:'whisper-1',apiKey:{set:false}}}},
 '/api/robin/learning':{practice:practicePlan([],'neetcode150',today),fullstack:fullstackPlan([])},
 '/api/robin/learning/course':{stages:COURSE_STAGES,sources:COURSE_SOURCES,lessons:COURSE_LESSONS.map(x=>({...x,fingerprint:'fixture'})),progress:[]},
 '/api/robin/practice':{records:[],currentSlug:null,list:'neetcode150',today},
 '/api/robin/notes':{drafts:[{id:'fixture',title:'排版测试 Typography',text:'# 清晰的阅读层级\n\n正文需要足够的行距。Readable English text alongside 中文。\n\n## 方法\n\n用 `code` 表示技术内容，正文不需要一直使用等宽字体。',notionParentId:'',updatedAt:now}]},
 '/api/robin/canvases':{canvases:[]}, '/api/robin/notes/attachments':{attachments:[]},
 '/api/robin/products':{ideas:[{id:'fixture',name:'研究助手 Research assistant',note:'## 问题\n\n帮助读者核对证据。Keep the reading surface calm.',step:'spot',links:[],createdAt:now,updatedAt:now}],captures:[]}, '/api/robin/product-library':{resources:[]}, '/api/robin/validation':{initialized:false,projects:[]},
 '/api/research/projects':{projects:[project],activeId:'general'}, '/api/research/objective':{objective:project.objective,note:project.note,revision:'fixture',captureState:{captures:[],vaults:[],vaultId:''}}, '/api/research/papers':{papers:[]}, '/api/research/sessions':{sessions:[],run:null},
 '/api/robin/recordings':{recordings:[],config:{engine:'local',model:'small',ready:false,reason:'missing-model'}}, '/api/robin/jarvis':{leads:[],run:null}, '/api/robin/google':{configured:false,connected:false},
};
const pages = [
 ['home','/dashboard?view=daily'],['calendar','/dashboard?view=calendar'],['todos','/dashboard?view=todos'],['more','/dashboard?view=more'],
 ['mail','/dashboard/gmail'],['weekly','/dashboard/gmail?feed=ai'],['jobs','/dashboard/jobs'],['events','/dashboard/events'],['settings','/dashboard/settings'],
 ['learn','/learn'],['course','/learn/roadmap?view=course'],['fso','/learn/fso'],['gpt2','/learn/gpt2'],['watch','/learn/watch'],['coding','/coding'],
 ['notes','/notes?draft=fixture'],['obsidian','/obsidian?vault=fixture&note=Sample.md&view=read'],['research','/research'],['research-project','/research?project=fixture'],['product','/product?idea=fixture'],['validation','/product/validation'],['tools','/tools'],['recordings','/recordings'],['outreach','/outreach/research'],['chat','/?cwd=%2Ftmp%2Ftype-fixture']
];
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL}), report=[];
try {
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce',hasTouch:process.env.AUDIT_TOUCH !== 'false'});
 if(process.env.PI_WEB_PASSWORD) {const r=await context.request.post('/api/web-auth',{headers:{Origin:baseURL},data:{password:process.env.PI_WEB_PASSWORD}});if(!r.ok())throw Error('Login failed');}
 await context.addInitScript(()=>{if(!localStorage.getItem('pi-locale'))localStorage.setItem('pi-locale','zh-CN');if(!localStorage.getItem('pi-theme'))localStorage.setItem('pi-theme','glass');});
 // Same source-CSS fallback as mobile-native.mjs when a shared dev watcher is stale.
 // Replace the compiled sheet; never layer over the obsolete global rules.
 if (process.env.E2E_GLOBAL_CSS) {
  const css = await readFile(process.env.E2E_GLOBAL_CSS, 'utf8');
  await context.route('**/_next/static/chunks/*.css', async route => {
   const response = await route.fetch(), body = await response.text();
   const start = body.indexOf('/* [project]/app/globals.css '), end = body.indexOf('/* [project]/app/settings.css ');
   await route.fulfill({ response, body: start >= 0 && end > start ? body.slice(0, start) + css + '\n' + body.slice(end) : body });
  });
 }
 const blocked=[];
 await context.route('**/api/**',route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(path==='/api/cwd/validate')return route.fulfill({json:{cwd:'/tmp/type-fixture'}});
  if(req.method()!=='GET'){blocked.push(path);return route.fulfill({status:409,json:{error:'Read-only typography audit'}});}
  if(path==='/api/robin/obsidian/vault')return route.fulfill({json:url.searchParams.has('path')?{note:{...note,content:'# 排版测试 Typography\n\n中文与 English 的混排需要清晰。Long-form reading benefits from comfortable line spacing.\n\n## 方法\n\n普通正文与 `code` 应有所区分。',url:'obsidian://open?vault=fixture&file=Sample'}}:url.searchParams.has('vaultId')?{notes:[note],limited:false,skipped:0}:{vaults:[{id:'fixture',name:'Fixture vault',path:'/fixture'}]}});
  if(path==='/api/research/agent') { const projectId=url.searchParams.get('project')||'general'; return route.fulfill({json:{messages:[],run:null,sessions:[],conversation:{id:`discussion:${projectId}`,projectId,title:'Fixture',revision:0,kind:'discussion',default:true,messageCount:0,createdAt:now,updatedAt:now}}}); }
  return route.fulfill({json:fixtures[path]??{records:[],finals:{},resources:[],opportunities:[],assessments:{},savedIds:[],todos:[],events:[],jobs:[],rounds:[],links:[],pages:[],vaults:[],review:null}});
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);let errors=[];page.on('pageerror',e=>errors.push(e.stack));
 for(const [name,url] of pages.filter(([name]) => !process.env.AUDIT_PAGES || process.env.AUDIT_PAGES.split(',').includes(name))){
  errors=[];
  await page.evaluate(()=>{localStorage.setItem('pi-locale','zh-CN');localStorage.setItem('pi-theme','glass');}).catch(()=>{});
  try {await page.goto(url,{timeout:30000});await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.waitForTimeout(900);await page.evaluate(()=>document.fonts.ready);} catch(e){throw new Error(`${name}: ${e.message}`, {cause:e});}
  for(const [variant,width,height,theme,locale] of [['phone',390,844,'glass','zh-CN'],['narrow',320,844,'glass-dark','zh-CN'],['desktop',1440,1000,'glass','zh-CN'],['english',390,844,'glass-dark','en']]){
   await page.setViewportSize({width,height});
   if(locale==='en'){await page.evaluate(()=>{localStorage.setItem('pi-locale','en');localStorage.setItem('pi-theme','glass-dark');});await page.reload();await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.waitForTimeout(600);}
   await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.classList.toggle('dark',t.endsWith('dark'));},theme);await page.waitForTimeout(150);
   const metrics=await page.evaluate(()=>{
    const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>2&&r.height>2&&s.visibility!=='hidden'&&!!el.getClientRects().length&&!el.closest('[hidden]');};
    const inspect=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {text:(el.innerText||el.textContent||'').trim().slice(0,140),tag:el.tagName,cls:typeof el.className==='string'?el.className:'',family:s.fontFamily,size:parseFloat(s.fontSize),weight:s.fontWeight,style:s.fontStyle,line:s.lineHeight,spacing:s.letterSpacing,color:s.color,fieldSize:s.getPropertyValue('--field-font-size'),rect:[r.x,r.y,r.width,r.height].map(v=>Math.round(v)),overflow:el.scrollWidth>el.clientWidth+1};};
    const nodes=[...document.querySelectorAll('h1,h2,h3,p,button,label,a,small,time,summary,input,textarea,select,span')].filter(visible);
    return {coarsePointer:matchMedia('(any-pointer: coarse)').matches,rootSize:getComputedStyle(document.documentElement).fontSize,headings:nodes.filter(el=>/^H[123]$/.test(el.tagName)).map(inspect),small:nodes.filter(el=>parseFloat(getComputedStyle(el).fontSize)<12&&el.textContent.trim()&&!el.querySelector('h1,h2,h3,p,span,button,a')).map(inspect).slice(0,60),fields:nodes.filter(el=>['INPUT','TEXTAREA','SELECT'].includes(el.tagName)).map(inspect).slice(0,20),copy:nodes.filter(el=>el.tagName==='P'&&el.textContent.length>25).map(inspect).slice(0,15),overflow:document.documentElement.scrollWidth>innerWidth+1};
   });
   assert.deepEqual(errors, [], `${name}/${variant}: no page exceptions`);
   assert.equal(metrics.overflow, false, `${name}/${variant}: root overflow`);
   if (!['settings','notes','obsidian','chat'].includes(name)) {
    const title = metrics.headings.find(h => h.tag === 'H1' && !/pi-chrome-label|pi-eyebrow/.test(h.cls));
    assert.ok(title, `${name}/${variant}: workspace title exists`);
    assert.equal(title.size, width < 960 ? 24 : 32, `${name}/${variant}: page-title size`);
    assert.equal(title.style, 'italic', `${name}/${variant}: page-title style`);
    assert.equal(title.weight, '400', `${name}/${variant}: page-title weight`);
   }
   if (name === 'obsidian') {
    assert.equal(metrics.headings[0].size, width < 960 ? 24 : 32, 'Obsidian chrome follows page-title role');
    assert.ok(metrics.headings.some(h => h.tag === 'H1' && h.style === 'normal' && h.size > 30), 'Reading heading keeps its own scale');
   }
   if (metrics.coarsePointer || width <= 640) {
    for (const f of metrics.fields) assert.ok(f.size >= 16, `${name}/${variant}: field floor ${f.cls}`);
   }
   const titleField = metrics.fields.find(f => f.cls.includes('titleInput'));
   if (name === 'product') assert.equal(titleField?.size, width <= 640 ? 26 : 30, 'Product title never shrinks to field floor');
   if (name === 'notes') assert.equal(titleField?.size, width < 960 ? 24 : 30, 'Notes title never shrinks to field floor');
   if (name === 'research-project') {
    const goal = metrics.fields.find(f => f.cls.includes('focusField'));
    assert.equal(goal?.size, width <= 760 ? 18 : 20, 'Research goal keeps emphasis');
   }
   const actions = name === 'fso' ? '[class*="FsoWorkspace"][class*="barNav"] button'
    : name === 'notes' && width < 960 ? '[class*="NotesWorkspace"][class*="viewToggle"] button'
    : name === 'obsidian' && width < 960 ? '[class*="ObsidianWorkspace"][class*="mobileTabs"] button' : null;
   if (actions) {
    const buttons = await page.locator(actions).evaluateAll(nodes => nodes.map(el => ({size:parseFloat(getComputedStyle(el).fontSize),height:el.getBoundingClientRect().height})));
    assert.ok(buttons.length > 0, `${name}: actions exist`);
    for (const button of buttons) {
     assert.ok(button.size >= 13, `${name}: readable action type`);
     assert.ok(button.height >= 44, `${name}: touch target independent of type size`);
    }
   }
   report.push({name,url,variant,theme,locale,width,height,errors:[...errors],...metrics});
   await page.screenshot({path:`${out}/${name}-${variant}.png`});
  }
  await writeFile(`${out}/metrics.json`,JSON.stringify({report,blocked},null,2));
  console.log(name,report.filter(x=>x.name===name).map(x=>`${x.variant}:${x.headings?.filter(h=>h.tag==='H1').map(h=>`${h.size}px/${h.style}/${h.family.split(',')[0]}`).join('|')}`).join(' '),errors.length?'ERRORS':'');
 }
 // Shared cascade contract: base copy, explicit leading, local overrides, and
 // larger title fields. No model requests, no saving synthetic inputs.
 await page.evaluate(() => {
  const probe = document.createElement('section');
  probe.id = 'typography-probe'; probe.className = 'robin-dashboard';
  probe.innerHTML = `<p id="type-body" class="text-sm">正文 Body</p>
    <p id="type-relaxed" class="text-sm leading-relaxed">Explicit leading</p>
    <p id="type-local" class="text-sm" style="line-height:2">Local leading</p>
    <p id="type-meta" class="text-xs">Metadata</p>
    <h1 class="pi-page-title">标题 Title</h1>
    <input id="type-field" style="--field-font-size:30px;font-size:var(--field-font-size)" value="Title">
    <div class="chat-input-surface"><textarea class="chat-input-textarea" style="--chat-content-font-size:22px">Draft</textarea></div>`;
  document.body.append(probe);
 });
 for (const width of [390, 812, 960, 1440]) {
  await page.setViewportSize({width,height:900});
  const values = await page.locator('#typography-probe').evaluate(el => Object.fromEntries([...el.querySelectorAll('p,h1,input,textarea')].map(node => {
   const css=getComputedStyle(node); return [node.id || node.tagName,{size:parseFloat(css.fontSize),leading:parseFloat(css.lineHeight)/parseFloat(css.fontSize)}];
  })));
  assert.equal(values['type-body'].leading, 1.6);
  assert.equal(values['type-relaxed'].leading, 1.625);
  assert.equal(values['type-local'].leading, 2);
  assert.equal(values['type-meta'].leading, 1.6);
  assert.equal(values['type-field'].size, 30);
  assert.equal(values.TEXTAREA.size, 22);
  assert.equal(values.H1.size, width < 960 ? 24 : 32);
 }
 await page.evaluate(() => { document.documentElement.style.fontSize='26px'; });
 assert.equal(await page.locator('#typography-probe h1').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)), 52, 'Page titles respond to enlarged root text');
 await context.close();
}finally{await browser.close();}
console.log(out);
