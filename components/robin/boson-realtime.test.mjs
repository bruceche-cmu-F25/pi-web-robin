import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from 'jiti';
const jiti=createJiti(import.meta.url);
const {Pcm24Encoder,decodePcm24,RealtimePlayer,bosonSession}=await jiti.import('./boson-realtime.ts');
test('no tools, bounded speech, semantic turn detection and explicit audio rates',()=>{
 assert.deepEqual(bosonSession.tools,[]); assert.equal(bosonSession.tool_choice,'none');
 assert.equal(bosonSession.audio.input.turn_detection.type,'semantic_vad');
 assert.equal(bosonSession.audio.input.format.rate,24000); assert.equal(bosonSession.audio.output.format.rate,24000);
 assert.ok(bosonSession.max_output_tokens<=256);
});
test('streaming PCM preserves duration and phase at physical device sample rates',()=>{
 for(const rate of [16000,24000,44100,48000,96000]){
  const input=new Float32Array(rate).fill(.5), encoder=new Pcm24Encoder(rate), chunks=[];
  for(let i=0;i<input.length;i+=2048) chunks.push(Buffer.from(encoder.encode(input.slice(i,i+2048)),'base64'));
  const bytes=Buffer.concat(chunks); assert.equal(bytes.length,48000,`one second at ${rate}`);
  const decoded=decodePcm24(bytes.toString('base64')); assert.ok(decoded.every(x=>Math.abs(x-.5)<.0001));
  assert.deepEqual(bytes,Buffer.from(new Pcm24Encoder(rate).encode(input),'base64'),'chunk boundaries do not change PCM');
 }
});
test('PCM clamps nonfinite and out-of-range samples, rejects malformed/oversized audio',()=>{
 const values=decodePcm24(new Pcm24Encoder(24000).encode(new Float32Array([-3,NaN,3])));
 assert.equal(values[0],-1); assert.equal(values[1],0); assert.ok(values[2]<1&&values[2]>.99);
 for(const value of ['','AA==','%%%','A'.repeat(256001)]) assert.throws(()=>decodePcm24(value));
});
test('player bounds backlog, records actual clock position and cancels all scheduled audio',async()=>{
 let playing=0, stopped=0, drained=0;
 const context={state:'running',currentTime:0,destination:{},createBuffer:()=>({copyToChannel(){}}),createBufferSource:()=>({connect(){},disconnect(){},start(){},stop(){stopped++;},onended:null})};
 const player=new RealtimePlayer(context,()=>playing++,()=>drained++);
 const audio=Buffer.alloc(48000).toString('base64');
 player.append('', 'a', 0);
 assert.equal(player.hasAudio(),false,'empty terminal deltas are harmless');
 player.append(audio,'a',0);
 player.append('', 'a', 0);
 assert.equal(player.hasAudio(),true,'empty interruption delta does not stop queued playback');
 assert.equal(playing,0,'receiving audio is not playback');
 context.currentTime=.515; await new Promise(r=>setTimeout(r,30));
 assert.equal(playing,1); assert.equal(player.position().audio_end_ms,500);
 player.clear(); assert.equal(stopped,1); assert.equal(player.hasAudio(),false); assert.equal(drained,0);
 for(let i=0;i<14;i++) player.append(audio,'b',0);
 assert.throws(()=>player.append(audio,'b',0)); player.clear();
 context.state='suspended'; assert.throws(()=>player.append(audio,'c',0));
});
