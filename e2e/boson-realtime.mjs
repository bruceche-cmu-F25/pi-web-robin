// Mocked Boson transport; actual microphone worklet/PCM playback. No paid calls.
// PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/boson-realtime.mjs
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fullstackPlan,practicePlan} from '../extension/robin/learning.ts';
const baseURL=process.env.E2E_BASE_URL??'http://127.0.0.1:30141';
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome'});
const until=async fn=>{const end=Date.now()+15000;while(!fn()){assert.ok(Date.now()<end,'condition timeout');await new Promise(r=>setTimeout(r,30));}};
try {
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844},serviceWorkers:'block'});
 if(process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post('/api/web-auth',{headers:{Origin:baseURL},data:{password:process.env.PI_WEB_PASSWORD}})).ok());
 await context.addInitScript(()=>{
  localStorage.setItem('pi-locale','en'); localStorage.setItem('pi-theme','light');
  sessionStorage.setItem('robin:voice:engine-v2','boson'); // Explicit retained trial; Robin is now the default.
  window.__micCalls=0;window.__stops=0;
  navigator.mediaDevices.getUserMedia=async()=>{
   window.__micCalls++;
   const audio=new AudioContext(); await audio.resume();
   const oscillator=audio.createOscillator(),gain=audio.createGain(),destination=audio.createMediaStreamDestination();
   gain.gain.value=0; oscillator.connect(gain);gain.connect(destination);oscillator.start();
   window.__level=value=>gain.gain.value=value;
   const track=destination.stream.getAudioTracks()[0],stop=track.stop.bind(track);window.__track=track;
   track.stop=()=>{window.__stops++;stop();void audio.close();};
   if(window.__holdPermission) await new Promise(resolve=>window.__grant=resolve);
   return destination.stream;
  };
 });
 let mints=0,unexpected=0,credentialFailure=false,holdMint=null;
 await context.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/robin/voice/realtime'){
   if(req.method()==='GET') return route.fulfill({json:{configured:true}});
   mints++;assert.deepEqual(req.postDataJSON(),{}); if(holdMint) await holdMint;
   return route.fulfill(credentialFailure?{status:502,json:{code:'quota'}}:{json:{secret:'bai-eph-fixture',expiresAt:Math.floor(Date.now()/1000)+60}}).catch(()=>{});
  }
  if(req.method()!=='GET') unexpected++;
  if(path==='/api/robin/todos') return route.fulfill({json:{todos:[]}});
  if(path==='/api/robin/events') return route.fulfill({json:{events:[]}});
  if(path==='/api/robin/links') return route.fulfill({json:{links:[]}});
  if(path==='/api/robin/learning') return route.fulfill({json:{practice:practicePlan([],'neetcode150','2030-01-01'),fullstack:fullstackPlan([])}});
  return route.fulfill({json:{}});
 });
 let socket=null,connections=0,closed=0; const sent=[];
 await context.routeWebSocket('wss://api.boson.ai/**',ws=>{
  socket=ws;connections++;
  ws.onMessage(raw=>{
   const event=JSON.parse(String(raw));sent.push(event);
   if(event.type==='session.update'){
    assert.deepEqual(event.session.tools,[]);assert.equal(event.session.tool_choice,'none');
    assert.equal(event.session.model,'higgs-realtime');assert.equal(event.session.audio.input.turn_detection.type,'semantic_vad');
    ws.send(JSON.stringify({type:'session.created',session:{...event.session,id:'fixture-session'}}));
   }
  });
  ws.onClose(()=>{closed++;});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const panel=page.locator('[data-robin-companion] dialog'),status=panel.getByRole('status');
 const button=name=>panel.getByRole('button',{name,exact:true});
 const emit=event=>socket.send(JSON.stringify(event));
 const samples=Buffer.alloc(96000);for(let i=0;i<48000;i++) samples.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/24000)*1000),i*2);
 const audio=samples.toString('base64');
 const speak=async(id='r1',text='Hello, this is realtime.')=>{
  emit({type:'input_audio_buffer.speech_started',item_id:`u-${id}`});
  emit({type:'input_audio_buffer.speech_stopped',item_id:`u-${id}`});
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:`u-${id}`,transcript:'Can you hear me?'});
  emit({type:'response.created',response:{id,status:'in_progress'}});
  emit({type:'response.output_audio_transcript.delta',response_id:id,item_id:`a-${id}`,delta:text});
  emit({type:'response.output_audio.delta',response_id:id,item_id:`a-${id}`,content_index:0,delta:audio});
  await status.filter({hasText:'Speaking'}).waitFor();
 };
 const launch=()=>page.locator(page.viewportSize().width < 960 ? '.robin-dashboard-toolbar [data-companion-launcher]' : '.robin-nav-entry[data-companion-launcher]').click();
 const open=async()=>{await launch();await status.filter({hasText:'Listening'}).waitFor();};
 await page.goto('/dashboard');await page.addStyleTag({content:'nextjs-portal { display: none !important; }'});
 assert.equal(mints,0);assert.equal(await page.evaluate(()=>window.__micCalls),0);
 await open();assert.equal(mints,1);assert.equal(connections,1);
 assert.equal(await panel.getByRole('button').count(),3);assert.equal(await panel.getByRole('textbox').isVisible(),false);
 await until(()=>sent.some(e=>e.type==='input_audio_buffer.append'));
 const chunk=sent.find(e=>e.type==='input_audio_buffer.append');assert.ok(Buffer.from(chunk.audio,'base64').length>0);
 await speak();
 // Live Boson sends this before interruption/done. It used to disconnect the call.
 emit({type:'response.output_audio.delta',response_id:'r1',item_id:'a-r1',content_index:0,delta:''});
 await page.waitForTimeout(100);assert.equal(closed,0);assert.equal(await panel.getByRole('alert').count(),0);
 await button('Mute microphone').click();assert.equal(await page.evaluate(()=>window.__track.enabled),false);
 assert.ok((await status.innerText()).includes('Speaking'),'mute retains output');
 await page.waitForTimeout(100);const frames=sent.filter(e=>e.type==='input_audio_buffer.append').length;
 await page.waitForTimeout(150);assert.equal(sent.filter(e=>e.type==='input_audio_buffer.append').length,frames);
 await button('Unmute microphone').click();
 emit({type:'input_audio_buffer.speech_started',item_id:'u-next'});await status.filter({hasText:'Listening'}).waitFor();
 emit({type:'response.output_audio.delta',response_id:'r1',item_id:'a-r1',content_index:0,delta:audio});
 await page.waitForTimeout(100);assert.ok(!(await status.innerText()).includes('Speaking'),'late cancelled audio cannot restart playback');
 emit({type:'response.done',response:{id:'r1',status:'cancelled'}});
 await until(()=>sent.some(e=>e.type==='conversation.item.truncate'));
 assert.ok(sent.find(e=>e.type==='conversation.item.truncate').audio_end_ms<2000);
 await speak('r2','Second reply.');emit({type:'response.done',response:{id:'r2',status:'completed'}});
 await button('Transcript').click();await panel.getByText('Second reply.').waitFor();
 assert.ok((await panel.innerText()).includes('Detected turn end → playback'));
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:844});const box=await panel.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);
  await mkdir('outputs/robin-voice',{recursive:true});await page.screenshot({path:`outputs/robin-voice/realtime-${width}.png`});
 }
 const stored=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
 assert.ok(!stored.includes('bai-eph-fixture'));assert.ok(!stored.includes('Second reply.'));
 await button('End conversation').click();await until(()=>closed===1);
 assert.equal(await page.evaluate(()=>window.__track.readyState),'ended');
 // Late permission grants never mint or open a socket.
 await page.evaluate(()=>window.__holdPermission=true);
 await launch();await status.filter({hasText:'Waiting for permission'}).waitFor();
 await button('End conversation').click();await page.evaluate(()=>window.__grant());await page.waitForTimeout(150);
 assert.equal(mints,1);assert.equal(await page.evaluate(()=>window.__track.readyState),'ended');
 await page.evaluate(()=>window.__holdPermission=false);
 // End while ephemeral credential is pending ignores even a successful late result.
 let release;holdMint=new Promise(r=>release=r);
 await launch();await until(()=>mints===2);
 await button('End conversation').click();release();holdMint=null;await page.waitForTimeout(150);assert.equal(connections,1);
 // Provider failure stops mic and never falls back to a paid alternate path.
 credentialFailure=true;await launch();
 await panel.getByRole('alert').filter({hasText:'credit or rate limit'}).waitFor();assert.equal(await page.evaluate(()=>window.__track.readyState),'ended');
 await button('End conversation').click();credentialFailure=false;
 // Backgrounding closes; returning never restarts the session.
 await open();const beforeHide=closed;
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await until(()=>closed>beforeHide);assert.equal(await page.evaluate(()=>window.__track.readyState),'ended');
 await page.evaluate(()=>{delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
 await button('End conversation').click();
 await open();emit({type:'error',error:{type:'insufficient_quota',message:'never-echo-this-key'}});
 await panel.getByRole('alert').filter({hasText:'credit or rate limit'}).waitFor();assert.ok(!(await panel.innerText()).includes('never-echo-this-key'));
 await page.keyboard.press('Escape');assert.equal(await panel.isVisible(),false);
 // A provider tool event cannot turn the chat trial into an agent or a write.
 await open();emit({type:'response.created',response:{id:'bad-tool',status:'in_progress'}});
 emit({type:'response.function_call_arguments.done',response_id:'bad-tool',name:'todo_add',arguments:'{"title":"must not run"}'});
 await panel.getByRole('alert').filter({hasText:'session failed'}).waitFor();
 assert.equal(await page.evaluate(()=>window.__track.readyState),'ended');await button('End conversation').click();
 // User-selected fallback closes realtime before it starts local recognition.
 await context.route('**/api/robin/voice',route=>route.fulfill({json:{configured:true,ttsConfigured:true,asrModel:'local',ttsModel:'higgs-tts-3'}}));
 await open();const priorClose=closed;await button('Transcript').click();
 await panel.getByRole('combobox',{name:'Voice mode'}).selectOption('legacy');
 await until(()=>closed>priorClose);await status.filter({hasText:'Listening'}).waitFor();
 assert.ok((await panel.innerText()).includes('Read-only'));assert.equal(await page.evaluate(()=>sessionStorage.getItem('robin:voice:engine-v2')),'legacy');
 await button('End conversation').click();
 // Even continuous activity cannot keep the trial open beyond the client cap.
 await page.clock.install();await open();await button('Transcript').click();
 await panel.getByRole('combobox',{name:'Voice mode'}).selectOption('boson');await status.filter({hasText:'Listening'}).waitFor();
 for(let i=0;i<10;i++){
  emit({type:'input_audio_buffer.speech_started',item_id:`cap-${i}`});await page.waitForTimeout(20);
  await page.clock.fastForward(60_000);
 }
 await panel.getByRole('alert').filter({hasText:'time or idle limit'}).waitFor();
 assert.equal(await page.evaluate(()=>window.__track.readyState),'ended');await button('End conversation').click();
 assert.equal(unexpected,0,'no Agent, ASR, TTS or write request');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,mints,connections,closed,unexpected,note:'Mock provider; real WebAudio capture, streaming PCM and playback. No paid calls.'}));
 await context.close();
}finally{await browser.close();}
