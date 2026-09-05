import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {acquire,acquisitionKey} from '../lib/acquire.mjs';
import {parseSource} from '../lib/models.mjs';
import {terminalUI} from '../lib/ui.mjs';
import {Readable,Writable} from 'node:stream';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'aperture-release-tests-'));
const bytes=Buffer.from('a complete, deliberately synthetic transfer fixture');
const sha256=createHash('sha256').update(bytes).digest('hex');
const model={kind:'gguf',local:false,source:{kind:'hf',repo:'test/model',revision:'a'.repeat(40),filename:'a.gguf'},files:[{name:'a.gguf',url:'https://example.org/a.gguf',bytes:bytes.length,sha256}],bytes:bytes.length};
test('HF shorthand remains a repository source',()=>assert.equal(parseSource('hf:Qwen/example').repo,'Qwen/example'));
test('the transfer cache key binds the exact quantization and revision',()=>{assert.notEqual(acquisitionKey(model),acquisitionKey({...model,source:{...model.source,revision:'b'.repeat(40)}}));});
test('approved pinned transfers resume and check the resulting full hash',async()=>{
  const dir=path.join(tmp,'resume');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'.aperture-download.json'),JSON.stringify({key:acquisitionKey(model)}));
  await fs.writeFile(path.join(dir,'a.gguf.part'),bytes.subarray(0,8));let range;
  const result=await acquire(model,dir,{approved:true,fetcher:async(u,o)=>{range=o.headers.Range;return new Response(bytes.subarray(8),{status:206,headers:{'content-range':`bytes 8-${bytes.length-1}/${bytes.length}`,'content-length':String(bytes.length-8)}});}});
  assert.equal(range,'bytes=8-');assert.equal(result.files[0].sha256,sha256);assert.deepEqual(await fs.readFile(path.join(dir,'a.gguf')),bytes);
});
test('completed cached artifacts are rechecked and reused without a request',async()=>{
  const dir=path.join(tmp,'reuse');await acquire(model,dir,{approved:true,fetcher:async()=>new Response(bytes)});let calls=0;
  const result=await acquire(model,dir,{approved:true,fetcher:async()=>{calls++;throw Error('not allowed');}});assert.equal(calls,0);assert.equal(result.files[0].sha256,sha256);
});
test('same-size corrupted cached artifacts are rejected',async()=>{
  const dir=path.join(tmp,'corrupt');await acquire(model,dir,{approved:true,fetcher:async()=>new Response(bytes)});await fs.writeFile(path.join(dir,'a.gguf'),Buffer.alloc(bytes.length));
  await assert.rejects(acquire(model,dir,{approved:true}),e=>e.code==='CACHE_CHANGED');
});
test('a server without range support restarts the file without appending duplicate bytes',async()=>{
  const dir=path.join(tmp,'restart');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'.aperture-download.json'),JSON.stringify({key:acquisitionKey(model)}));await fs.writeFile(path.join(dir,'a.gguf.part'),bytes.subarray(0,8));
  await acquire(model,dir,{approved:true,fetcher:async()=>new Response(bytes,{headers:{'content-length':String(bytes.length)}})});assert.deepEqual(await fs.readFile(path.join(dir,'a.gguf')),bytes);
});
test('invalid ranges never promote a partial',async()=>{
  const dir=path.join(tmp,'bad-range');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'.aperture-download.json'),JSON.stringify({key:acquisitionKey(model)}));await fs.writeFile(path.join(dir,'a.gguf.part'),bytes.subarray(0,8));
  await assert.rejects(acquire(model,dir,{approved:true,fetcher:async()=>new Response(bytes.subarray(8),{status:206,headers:{'content-range':`bytes 9-${bytes.length}/${bytes.length+1}`}})}),e=>e.code==='DOWNLOAD_RANGE');
});
test('menu selection can be corrected without restarting setup',async()=>{
  const out=new Writable({write(c,e,cb){cb();}}),ui=terminalUI({input:Readable.from(['oops\n2\n']),output:out});
  try{assert.equal(await ui.choose(['one','two']), 'two');}finally{ui.close();}
});
test.after(async()=>{await fs.rm(tmp,{recursive:true,force:true});});
