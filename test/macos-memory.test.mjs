import test from 'node:test';
import assert from 'node:assert/strict';
import {observeMacMemory,parseMacMemoryPressure} from '../lib/macos-memory.mjs';

const totalBytes=7516192768;
const pressure=`The system has 7516192768 (458752 pages with a page size of 16384).
System-wide memory free percentage: 84%`;

test('macOS pressure percentage converts to bounded available bytes',()=>{
  const result=parseMacMemoryPressure(pressure,totalBytes);
  assert.equal(result.totalBytes,totalBytes);
  assert.equal(result.availableBytes,Math.floor(totalBytes*0.84));
  assert.equal(result.pressureFreePercent,84);
  assert.equal(result.pressureReportedTotalBytes,totalBytes);
  assert.match(result.basis,/memory_pressure/);
});

test('macOS pressure parser rejects missing and impossible percentages',()=>{
  assert.equal(parseMacMemoryPressure('The system has 100 bytes.',100),null);
  assert.equal(parseMacMemoryPressure('System-wide memory free percentage: 101%',100),null);
  assert.equal(parseMacMemoryPressure('System-wide memory free percentage: -1%',100),null);
});

test('macOS pressure total cannot enlarge the host-visible memory pool',()=>{
  const result=parseMacMemoryPressure('The system has 16384 (1 pages with a page size of 16384).\nSystem-wide memory free percentage: 50%',8192);
  assert.equal(result.totalBytes,8192);
  assert.equal(result.availableBytes,4096);
});

test('pressure-aware observation includes reclaimable capacity instead of raw free pages alone',async()=>{
  const calls=[];
  const result=await observeMacMemory({
    totalBytes,
    rawFreeBytes:117063680,
    run:async(exe,args,options)=>{
      calls.push({exe,args,options});
      return {code:0,stdout:pressure,stderr:'',timedOut:false};
    }
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].exe,'/usr/bin/memory_pressure');
  assert.deepEqual(calls[0].args,['-Q']);
  assert.equal(calls[0].options.timeout,5000);
  assert.equal(result.status,'OBSERVED');
  assert.equal(result.availableBytes,Math.floor(totalBytes*0.84));
  assert.equal(result.rawFreeBytes,117063680);
  assert.equal(result.error,null);
});

test('raw free pages remain a floor when pressure output is lower',async()=>{
  const result=await observeMacMemory({
    totalBytes:1000,
    rawFreeBytes:400,
    run:async()=>({code:0,stdout:'System-wide memory free percentage: 25%',stderr:'',timedOut:false})
  });
  assert.equal(result.availableBytes,400);
});

test('failed pressure observation falls back explicitly to raw free pages',async()=>{
  const result=await observeMacMemory({
    totalBytes:1000,
    rawFreeBytes:125,
    run:async()=>{throw Error('unavailable');}
  });
  assert.equal(result.status,'FALLBACK');
  assert.equal(result.totalBytes,1000);
  assert.equal(result.availableBytes,125);
  assert.equal(result.rawFreeBytes,125);
  assert.equal(result.pressureFreePercent,null);
  assert.match(result.basis,/os\.freemem/);
  assert.match(result.error,/pressure-aware/);
});
