import test from 'node:test';
import assert from 'node:assert/strict';
import {GiB} from '../lib/common.mjs';
import {makeFabricPlan,admitFabricCanaries,admitFabricBenchmark,reducedFabricReceipt} from '../lib/fabric.mjs';
import {qualifyRpcAdapter,makeRpcIntents,admitPreparedRpcTransaction,staleWorkerMayCommit} from '../lib/fabric-rpc.mjs';

const adapter=qualifyRpcAdapter({name:'llama.cpp-rpc',commit:'a'.repeat(40),buildIdentity:'fixture-cuda-rpc',transport:'lan-tcp',capabilities:{cuda:true,rpcServer:true,llamaBench:true}});
const gpu=(id,domain,free=23)=>({id,memoryDomain:domain,kind:'nvidia',name:'NVIDIA RTX 3090',totalBytes:24*GiB,freeBytes:free*GiB,computeCapability:8.6,externalGate:false,link:{kind:'PCIe',generation:4,width:16}});
const census=()=>({schema:'aperture-fabric-census/1',authorityNodeId:'head',adapters:[adapter],nodes:[
  {id:'head',state:'READY',memory:{allocationHeadroomBytes:64*GiB},devices:[gpu('gpu0','domain0')]},
  {id:'worker-a',state:'READY',memory:{allocationHeadroomBytes:48*GiB},devices:[gpu('gpu0','domain1'),gpu('gpu1','domain2')]},
  {id:'worker-b',state:'READY',memory:{allocationHeadroomBytes:64*GiB},devices:[gpu('gpu0','domain3')]}
]});
const model=(bytes=104*GiB)=>({bytes,files:[0,1,2,3].map(i=>({name:`model-${i+1}.gguf`,sha256:String(i+1).repeat(64)}))});
const benchmark={id:'portable-v1',promptTokens:4096,generatedTokens:256,contextDepths:[0,32768,65536,131072],repetitions:3};
const policy={gpuCount:4,reservePerGpuBytes:2*GiB,hostReserveBytes:4*GiB,adapter:'llama.cpp-rpc',canaries:[2048,8192,32768],benchmark};

test('four 3090s remain four memory domains rather than one 96 GiB device',()=>{
  const plan=makeFabricPlan(census(),model(),policy);
  assert.equal(plan.status,'READY_TO_CANARY');
  assert.equal(plan.memory.pooled,false);
  assert.equal(plan.memory.gpuDomains.length,4);
  assert.equal(new Set(plan.memory.gpuDomains.map(row=>row.memoryDomain)).size,4);
  assert.equal(plan.memory.planningTotalPhysicalBytes,96*GiB);
  assert.ok(plan.memory.cpuWeightBytes>0);
  assert.match(plan.memory.statement,/not one addressable VRAM pool/);
});

test('current free memory, not nominal card capacity, bounds placement',()=>{
  const c=census();c.nodes[1].devices[0].freeBytes=5*GiB;
  const plan=makeFabricPlan(c,model(),policy);
  const constrained=plan.memory.gpuDomains.find(row=>row.memoryDomain==='domain1');
  assert.equal(constrained.usableBytes,3*GiB);
  assert.equal(constrained.weightBytes,3*GiB);
});

test('insufficient authority-host headroom holds instead of inventing pooled capacity',()=>{
  const c=census();c.nodes[0].memory.allocationHeadroomBytes=5*GiB;
  const plan=makeFabricPlan(c,model(),policy);
  assert.equal(plan.status,'HOLD');
  assert.ok(plan.holds.some(row=>row.code==='HOST_HEADROOM'));
});

test('missing exact runtime adapter identity holds the load',()=>{
  const c=census();c.adapters=[];
  const plan=makeFabricPlan(c,model(),policy);
  assert.equal(plan.status,'HOLD');
  assert.ok(plan.holds.some(row=>row.code==='ADAPTER'));
});

test('multi-host placement cannot benchmark without correctness canaries',()=>{
  const plan=makeFabricPlan(census(),model(),{...policy,canaries:[]});
  assert.equal(plan.status,'HOLD');
  assert.ok(plan.holds.some(row=>row.code==='CORRECTNESS_GATE'));
});

test('RPC intents preserve worker-local device ownership and forbid desktop control',()=>{
  const plan=makeFabricPlan(census(),model(),policy),tx=makeRpcIntents(plan);
  assert.equal(tx.workers.length,4);
  assert.ok(tx.workers.every(row=>row.permissions.openDesktop===false&&row.permissions.arbitraryShell===false));
  assert.ok(tx.workers.some(row=>row.role==='RPC_CUDA_DOMAIN'));
  assert.equal(tx.controller.placement.cpuWeightBytes,plan.memory.cpuWeightBytes);
});

test('every RPC worker must prepare under the exact occurrence fence',()=>{
  const tx=makeRpcIntents(makeFabricPlan(census(),model(),policy));
  const prepared=tx.workers.map(row=>({ordinal:row.ordinal,nodeId:row.nodeId,deviceId:row.deviceId,fence:tx.fence,status:'READY',endpointRef:`estate-endpoint-${row.ordinal}`}));
  assert.equal(admitPreparedRpcTransaction(tx,prepared).state,'READY_TO_LOAD');
  const stale=structuredClone(prepared);stale[0].fence='old:1';
  assert.throws(()=>admitPreparedRpcTransaction(tx,stale),e=>e.code==='FABRIC_FENCE');
});

test('failed long-context canary blocks all throughput admission',()=>{
  const plan=makeFabricPlan(census(),model(),policy);
  const results=plan.canaries.map(context=>({context,fence:plan.occurrence.fence,status:context===8192?'FAIL':'PASS'}));
  const gated=admitFabricCanaries(plan,results);
  assert.equal(gated.status,'HOLD_CORRECTNESS');
  assert.equal(gated.performance,'NOT_ADMITTED');
  assert.throws(()=>admitFabricBenchmark(gated,{fence:plan.occurrence.fence,promptTokensPerSecond:200,decodeTokensPerSecond:20}),e=>e.code==='FABRIC_BENCHMARK_GATE');
});

test('only a fully canary-qualified fenced occurrence admits performance',()=>{
  const plan=makeFabricPlan(census(),model(),policy);
  const canaries=plan.canaries.map(context=>({context,fence:plan.occurrence.fence,status:'PASS'}));
  const ready=admitFabricCanaries(plan,canaries);
  const measured=admitFabricBenchmark(ready,{fence:plan.occurrence.fence,promptTokensPerSecond:211.4,decodeTokensPerSecond:18.7,promptStdDev:1.2,decodeStdDev:.3});
  assert.equal(measured.status,'MEASURED');
  assert.equal(measured.performance.decodeTokensPerSecond,18.7);
  assert.equal(staleWorkerMayCommit(makeRpcIntents(plan),{occurrenceId:plan.occurrence.id,fence:'stale:1'}),false);
});

test('reduced receipt removes internal node/device identities while retaining topology truth',()=>{
  const receipt=reducedFabricReceipt(makeFabricPlan(census(),model(),policy));
  const text=JSON.stringify(receipt);
  assert.equal(receipt.memory.pooled,false);
  assert.doesNotMatch(text,/worker-a|worker-b|domain0|domain1|domain2|domain3/);
  assert.match(text,/gpu-domain-1/);
  assert.equal(receipt.performance,'NOT_ADMITTED');
});
