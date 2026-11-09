import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createJiti} from 'jiti';
const dir=mkdtempSync(join(tmpdir(),'realtime-route-')),stub=join(dir,'domain.mjs');
writeFileSync(stub,`export class RealtimeError extends Error {};
export const realtimeReadiness=()=>({configured:true});
export const createRealtimeCredential=(signal)=>globalThis.__mint(signal);`);
const jiti=createJiti(import.meta.url,{alias:{'@/extension/robin/realtime-domain':stub,'@':process.cwd()},moduleCache:false});
const {GET,POST}=await jiti.import('./route.ts');
after(()=>{delete globalThis.__mint;rmSync(dir,{recursive:true,force:true});});
const req=(body='{}',extra={})=>new Request('http://localhost:30141/api/robin/voice/realtime',{method:'POST',headers:{host:'localhost:30141','content-type':'application/json',...extra},body});
test('GET never mints, POST requires trusted origin, JSON and empty bounded body',async()=>{
 globalThis.__mint=()=>assert.fail('no provider call');
 const result=await GET(new Request('http://localhost:30141/api/robin/voice/realtime',{headers:{host:'localhost:30141'}}));
 assert.deepEqual(await result.json(),{configured:true});assert.equal(result.headers.get('cache-control'),'no-store');
 assert.equal((await POST(req('{}',{origin:'https://evil.test'}))).status,403);
 assert.equal((await POST(req('{}',{'content-type':'text/plain'}))).status,415);
 for(const body of ['null','[]','{"tools":["todo_add"]}','x'.repeat(1000)]) assert.equal((await POST(req(body))).status,400);
});
test('explicit POST returns only domain credential and forwards cancellation, no caching',async()=>{
 const request=req();globalThis.__mint=signal=>{assert.equal(signal,request.signal);return {secret:'bai-eph-fixture',expiresAt:123};};
 const result=await POST(request);assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
 assert.deepEqual(await result.json(),{secret:'bai-eph-fixture',expiresAt:123});
 globalThis.__mint=()=>{throw new Error('private-key');};
 assert.deepEqual(await (await POST(req())).json(),{code:'request'});
});
