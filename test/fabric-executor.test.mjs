import test from 'node:test';
import assert from 'node:assert/strict';
import {GiB} from '../lib/common.mjs';
import {makeFabricPlan} from '../lib/fabric.mjs';
import {qualifyRpcAdapter} from '../lib/fabric-rpc.mjs';
import {executeFabricPlan} from '../lib/fabric-executor.mjs';

const adapter=qualifyRpcAdapter({name:'llama.cpp-rpc',commit:'b'.repeat(40),buildIdentity:'executor-fixture',transport:'lan-tcp',capabilities:{cuda:true,rpcServer:true,llamaBench:true}});
const device=(id,domain)=>({id,memoryDomain:domain,kind:'nvidia',name:'RTX 3090',totalBytes:24*GiB,freeBytes:23*GiB,externalGate:false});
const census={schema:'aperture-fabric-census/1',authorityNodeId:'head',adapters:[adapter],nodes:[
  {id:'head',state:'READY',memory:{allocationHeadroomBytes:64*GiB},devices:[device('g0','d0')]},
  {id:'worker',state:'READY',memory:{allocationHeadroomBytes:64*GiB},devices:[device('g0','d1'),device('g1','d2'),device('g2','d3')]}
]};
const model={bytes:104*GiB,files:[1,2,3,4].map(n=>({name:`${n}.gguf`,sha256:String(n).repeat(64)}))};
const policy={gpuCount:4,reservePerGpuBytes:2*GiB,hostReserveBytes:4*GiB,adapter:'llama.cpp-rpc',canaries:[2048,8192,32768],benchmark:{id:'portable-v1'}};
const plan=()=>makeFabricPlan(structuredClone(census),structuredClone(model),structuredClone(policy));
function api({failContext=null}={}){
  const calls=[];
  return {calls,
    prepareWorker:async intent=>{calls.push(['prepare',intent.ordinal]);return {ordinal:intent.ordinal,nodeId:intent.nodeId,deviceId:intent.deviceId,fence:intent.fence,status:'READY',endpointRef:`ep-${intent.ordinal}`};},
    load:async controller=>{calls.push(['load']);return {status:'LOADED',fence:controller.fence,loadedRef:'load-1'};},
    runCanary:async request=>{calls.push(['canary',request.context]);return {context:request.context,fence:request.fence,status:request.context===failContext?'FAIL':'PASS'};},
    runBenchmark:async request=>{calls.push(['bench']);return {fence:request.fence,promptTokensPerSecond:200,decodeTokensPerSecond:20};},
    cleanup:async context=>{calls.push(['cleanup',context.fence]);return {status:'CLEAN'};}
  };
}

test('executor runs preparation, load, ordered canaries, benchmark and cleanup',async()=>{
  const harness=api(),result=await executeFabricPlan(plan(),harness);
  assert.equal(result.status,'MEASURED');
  assert.equal(result.receipt.performance.decodeTokensPerSecond,20);
  assert.deepEqual(harness.calls.filter(row=>row[0]==='canary').map(row=>row[1]),[2048,8192,32768]);
  assert.equal(harness.calls.at(-1)[0],'cleanup');
});

test('failed canary suppresses benchmark and still cleans up',async()=>{
  const harness=api({failContext:8192}),result=await executeFabricPlan(plan(),harness);
  assert.equal(result.status,'HOLD_CORRECTNESS');
  assert.equal(harness.calls.some(row=>row[0]==='bench'),false);
  assert.equal(harness.calls.at(-1)[0],'cleanup');
});

test('load fence mismatch aborts before canaries and cleanup still runs',async()=>{
  const harness=api();harness.load=async()=>({status:'LOADED',fence:'stale:1',loadedRef:'bad'});
  await assert.rejects(executeFabricPlan(plan(),harness),e=>e.code==='FABRIC_LOAD');
  assert.equal(harness.calls.at(-1)[0],'cleanup');
});
