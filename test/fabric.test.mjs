import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {GiB} from '../lib/common.mjs';
import {makeFabricPlan,admitFabricCanaries,admitFabricBenchmark,reducedFabricReceipt} from '../lib/fabric.mjs';
import {qualifyRpcAdapter,makeRpcIntents,admitPreparedRpcTransaction,staleWorkerMayCommit} from '../lib/fabric-rpc.mjs';
import {makeFabricCensus} from '../lib/fabric-census.mjs';
import {fabricPolicyFromSpec} from '../lib/fabric-spec.mjs';

const adapter=qualifyRpcAdapter({name:'llama.cpp-rpc',commit:'a'.repeat(40),buildIdentity:'fixture-cuda-rpc',transport:'lan-tcp',capabilities:{cuda:true,rpcServer:true,llamaBench:true}});
const gpu=(id,domain,free=23,name='NVIDIA RTX 3090')=>({id,memoryDomain:domain,kind:'nvidia',name,totalBytes:24*GiB,freeBytes:free*GiB,computeCapability:8.6,externalGate:false,link:{kind:'PCIe',generation:4,width:16}});
const census=()=>({schema:'aperture-fabric-census/1',authorityNodeId:'head',adapters:[adapter],nodes:[
  {id:'head',state:'READY',memory:{allocationHeadroomBytes:64*GiB},devices:[gpu('gpu0','domain0')]},
  {id:'worker-a',state:'READY',memory:{allocationHeadroomBytes:48*GiB},devices:[gpu('gpu0','domain1'),gpu('gpu1','domain2')]},
  {id:'worker-b',state:'READY',memory:{allocationHeadroomBytes:64*GiB},devices:[gpu('gpu0','domain3')]}
]});
const model=(bytes=104*GiB)=>({bytes,files:[0,1,2,3].map(i=>({name:`model-${i+1}.gguf`,sha256:String(i+1).repeat(64)}))});
const benchmark={id:'portable-v1',promptTokens:4096,generatedTokens:256,contextDepths:[0,32768,65536,131072],repetitions:3,batchSize:4096,ubatchSize:4096,output:'json'};
const policy={gpuCount:4,deviceName:'NVIDIA RTX 3090',homogeneous:true,reservePerGpuBytes:2*GiB,hostReserveBytes:4*GiB,adapter:'llama.cpp-rpc',canaries:[2048,8192,32768],benchmark};

test('four 3090s remain four memory domains rather than one 96 GiB device',()=>{
  const plan=makeFabricPlan(census(),model(),policy);
  assert.equal(plan.status,'READY_TO_CANARY');
  assert.equal(plan.memory.pooled,false);
  assert.equal(plan.memory.gpuDomains.length,4);
  assert.equal(new Set(plan.memory.gpuDomains.map(row=>row.memoryDomain)).size,4);
  assert.equal(plan.memory.planningTotalPhysicalBytes,96*GiB);
  assert.ok(plan.memory.cpuWeightBytes>0);
  assert.equal(plan.requirements.deviceName,'NVIDIA RTX 3090');
  assert.equal(plan.requirements.homogeneous,true);
  assert.match(plan.memory.statement,/not one addressable VRAM pool/);
});

test('current free memory, not nominal card capacity, bounds placement',()=>{
  const c=census();c.nodes[1].devices[0].freeBytes=5*GiB;
  const plan=makeFabricPlan(c,model(),policy);
  const constrained=plan.memory.gpuDomains.find(row=>row.memoryDomain==='domain1');
  assert.equal(constrained.usableBytes,3*GiB);
  assert.equal(constrained.weightBytes,3*GiB);
});

test('exact 3090 selector refuses a lookalike aggregate containing another card',()=>{
  const c=census();c.nodes[2].devices[0]=gpu('gpu0','domain3',23,'NVIDIA GeForce RTX 5090');
  const plan=makeFabricPlan(c,model(),policy);
  assert.equal(plan.status,'HOLD');
  assert.ok(plan.holds.some(row=>row.code==='GPU_COUNT'));
  assert.equal(plan.memory.gpuDomains.length,3);
});

test('homogeneous placement remains an independent policy when no exact model selector is supplied',()=>{
  const c=census();c.nodes[2].devices[0]=gpu('gpu0','domain3',23,'NVIDIA GeForce RTX 5090');
  const plan=makeFabricPlan(c,model(),{...policy,deviceName:null});
  assert.equal(plan.status,'HOLD');
  assert.ok(plan.holds.some(row=>row.code==='HOMOGENEOUS'));
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

test('ordinary per-node Aperture scans become one fabric census without opening the occupied seat',()=>{
  const scan=(uuid,index=0)=>({schema:'aperture-scan/1',observedAt:'2026-09-07T00:00:00Z',memory:{totalBytes:64*GiB,allocationHeadroomBytes:48*GiB},gpu:{devices:[{index,uuid,memoryDomain:uuid,name:'NVIDIA RTX 3090',totalBytes:24*GiB,freeBytes:23*GiB,computeCapability:8.6,externalGate:false,pcie:{generation:4,width:16}}]}});
  const observations=[
    {id:'head',reachable:true,worker:{headless:true,state:'READY',transport:'estate-agent'},scan:scan('GPU-a')},
    {id:'occupied',reachable:true,interactiveOccupied:true,worker:{headless:true,state:'READY',transport:'estate-agent'},scan:scan('GPU-b')}
  ];
  const result=makeFabricCensus(observations,{authorityNodeId:'head',adapters:[adapter]});
  assert.equal(result.nodes[1].state,'READY');
  assert.equal(result.nodes[1].interactiveOccupied,true);
  assert.equal(result.nodes[1].worker.headless,true);
  assert.equal(result.nodes[1].devices[0].kind,'nvidia');
});

test('census does not misclassify a non-NVIDIA accelerator as an NVIDIA placement resource',()=>{
  const scan={schema:'aperture-scan/1',memory:{allocationHeadroomBytes:32*GiB},gpu:{devices:[{index:0,name:'Intel Arc Graphics',totalBytes:8*GiB,freeBytes:7*GiB,externalGate:false}]}};
  const result=makeFabricCensus([{id:'head',reachable:true,worker:{headless:true,state:'READY'},scan}],{authorityNodeId:'head'});
  assert.equal(result.nodes[0].devices[0].kind,'other');
});

test('reachable machine without a ready headless worker remains distinguishable from network loss',()=>{
  const scan={schema:'aperture-scan/1',memory:{allocationHeadroomBytes:32*GiB},gpu:{devices:[]}};
  const result=makeFabricCensus([{id:'head',reachable:true,worker:{headless:true,state:'READY'},scan},{id:'seat',reachable:true,worker:{headless:false,state:'MISSING'},scan}],{authorityNodeId:'head'});
  assert.equal(result.nodes[1].state,'NO_HEADLESS_WORKER');
  assert.match(result.claimBoundary,/does not imply network failure/);
});

test('the checked-in Qwen3.8 Fabric spec mechanically becomes the exact planner policy',async()=>{
  const spec=JSON.parse(await fs.readFile(new URL('../benchmarks/qwen38-flash-next-ud-q4-k-xl/fabric-spec.json',import.meta.url),'utf8'));
  const mapped=fabricPolicyFromSpec(spec);
  assert.deepEqual(mapped,policy);
  const plan=makeFabricPlan(census(),model(),mapped);
  assert.equal(plan.status,'READY_TO_CANARY');
  assert.equal(plan.requirements.deviceName,'NVIDIA RTX 3090');
  assert.deepEqual(plan.canaries,[2048,8192,32768]);
  assert.deepEqual(plan.benchmark.contextDepths,[0,32768,65536,131072]);
});
