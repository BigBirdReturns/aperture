import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {ApertureError} from '../lib/common.mjs';
import {observeSystemMemory,pressureReason,startSystemMemoryWatchdog,watchdogPolicy,abortFailure} from '../lib/memory-watchdog.mjs';

const plan=(overrides={})=>({machine:{memory:{basis:'OS physical memory'}},method:{reserveBytes:1000},...overrides});
const observation=(available=2000,rss=0)=>({observedAt:new Date().toISOString(),availableBytes:available,physicalAvailableBytes:available,cgroupAvailableBytes:null,processRssBytes:rss,basis:'test'});
async function waitFor(predicate,limit=500) {
  const end=Date.now()+limit;
  while(Date.now()<end){if(predicate())return;await sleep(5);}
  assert.fail('condition was not reached');
}

test('system observation uses the tighter Linux cgroup headroom',async()=>{
  const x=await observeSystemMemory({platform:'linux',freeMemory:()=>5000,rss:()=>9000,readCgroup:async()=>({availableBytes:3000})});
  assert.equal(x.availableBytes,3000);assert.equal(x.physicalAvailableBytes,5000);
  assert.equal(x.cgroupAvailableBytes,3000);assert.equal(x.processRssBytes,9000);
});
test('system observation uses physical availability when no cgroup limit is present',async()=>{
  const x=await observeSystemMemory({platform:'linux',freeMemory:()=>5000,rss:()=>9000,readCgroup:async()=>null});
  assert.equal(x.availableBytes,5000);assert.equal(x.cgroupAvailableBytes,null);
});
test('invalid reserve is refused before monitoring',()=>{
  assert.throws(()=>watchdogPolicy({method:{reserveBytes:0}}),e=>e.code==='MEMORY_POLICY');
});
test('RSS above the allocation budget is not system pressure',()=>{
  assert.equal(pressureReason(observation(2000,100000),watchdogPolicy(plan())),null);
});
test('available system memory at the reserve produces a typed pressure result',()=>{
  const reason=pressureReason(observation(1000,1),watchdogPolicy(plan()));
  assert.equal(reason.code,'SYSTEM_MEMORY_PRESSURE');assert.match(reason.message,/1000 bytes/);
});
test('high process RSS does not abort while system headroom clears the reserve',async()=>{
  const controller=new AbortController();
  const watchdog=startSystemMemoryWatchdog(plan(),controller,{intervalMs:10,observe:async()=>observation(2000,50000)});
  await sleep(35);const summary=await watchdog.stop();
  assert.equal(controller.signal.aborted,false);assert.ok(summary.samples>=2);
  assert.equal(summary.peakProcessRssBytes,50000);assert.equal(summary.minimumAvailableBytes,2000);
});
test('watchdog aborts with the typed system-pressure cause',async()=>{
  const controller=new AbortController();
  const watchdog=startSystemMemoryWatchdog(plan(),controller,{intervalMs:10,observe:async()=>observation(999,1)});
  await waitFor(()=>controller.signal.aborted);const summary=await watchdog.stop();
  assert.equal(controller.signal.reason.code,'SYSTEM_MEMORY_PRESSURE');
  assert.equal(summary.status,'TRIGGERED');assert.equal(summary.trigger.observation.availableBytes,999);
});
test('loss of an admission-time cgroup observation fails closed',async()=>{
  const controller=new AbortController();
  const p=plan({machine:{memory:{basis:'OS physical memory and cgroup-v2 limit'}},method:{reserveBytes:1000}});
  const watchdog=startSystemMemoryWatchdog(p,controller,{intervalMs:10,observe:async()=>observation(5000,1)});
  await waitFor(()=>controller.signal.aborted);await watchdog.stop();
  assert.equal(controller.signal.reason.code,'MEMORY_MONITOR_FAILED');
});
test('asynchronous samples never overlap',async()=>{
  let active=0,maximum=0;
  const controller=new AbortController();
  const watchdog=startSystemMemoryWatchdog(plan(),controller,{intervalMs:10,observe:async()=>{
    active++;maximum=Math.max(maximum,active);await sleep(20);active--;return observation(2000,1);
  }});
  await sleep(80);await watchdog.stop();assert.equal(maximum,1);assert.equal(active,0);
});
test('stopping the watchdog prevents later samples',async()=>{
  let calls=0;const controller=new AbortController();
  const watchdog=startSystemMemoryWatchdog(plan(),controller,{intervalMs:10,observe:async()=>{calls++;return observation();}});
  await sleep(25);await watchdog.stop();const stoppedAt=calls;await sleep(30);assert.equal(calls,stoppedAt);
});
test('typed watchdog abort outranks the native cancellation wrapper',()=>{
  const controller=new AbortController();
  const reason=new ApertureError('SYSTEM_MEMORY_PRESSURE','floor reached');controller.abort(reason);
  assert.equal(abortFailure(new Error('operation aborted'),controller),reason);
});
test('ordinary external cancellation keeps the native error',()=>{
  const controller=new AbortController();controller.abort();const native=new Error('operation aborted');
  assert.equal(abortFailure(native,controller),native);
});
test('one-shot and chat workers use the system watchdog rather than RSS authority',async()=>{
  const native=await fs.readFile(new URL('../lib/native-worker.mjs',import.meta.url),'utf8');
  const chat=await fs.readFile(new URL('../lib/chat-worker.mjs',import.meta.url),'utf8');
  for(const source of [native,chat])assert.match(source,/startSystemMemoryWatchdog/);
  assert.doesNotMatch(native,/memoryUsage\(\)\.rss\s*>/);
});
