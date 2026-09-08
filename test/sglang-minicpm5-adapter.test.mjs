import test from 'node:test';
import assert from 'node:assert/strict';
import {GiB} from '../lib/common.mjs';
import {qualifyRuntimeCandidate,executeRuntimeQualification} from '../lib/runtime-adapter.mjs';
import {makeSglangMiniCpm5Adapter,SGLANG_MINICPM5_SOURCE} from '../lib/adapters/sglang-minicpm5.mjs';

const seat=(name='NVIDIA GeForce RTX 5090')=>({id:'node-a/cuda0',nodeId:'node-a',deviceId:'cuda0',memoryDomain:'domain-a',state:'READY',platform:'linux',architecture:'x64',observedAt:'2026-09-07T00:00:00Z',runtime:{cuda:{available:true,identity:'cuda-fixture'},sglang:{serve:true,identity:'sglang-fixture',revision:SGLANG_MINICPM5_SOURCE.revision}},device:{id:'cuda0',kind:'nvidia',name,memoryDomain:'domain-a',totalBytes:32*GiB,freeBytes:30*GiB,computeCapability:12}});
const job=(overrides={})=>({id:'coding',kind:'inference-service',model:{id:'openbmb/MiniCPM5-2B',quantization:'BF16'},speculative:{algorithm:'DSPARK'},distribution:{nodes:1},service:{host:'127.0.0.1',port:30000},policy:{allowRemoteCode:true,allowLanBind:false},...overrides});
const authority=qualificationHash=>({schema:'aperture-runtime-authorization/1',adapterId:'sglang/minicpm5-2b-dspark',seatId:'node-a/cuda0',jobId:'coding',qualificationHash,occurrenceId:'occ-1',fence:'occ-1:1',allowPrepare:true,allowMaterialization:true,allowLaunch:true});

test('official MiniCPM5 DSPARK recipe qualifies an observed Linux RTX 5090 seat',async()=>{
  const result=await qualifyRuntimeCandidate(makeSglangMiniCpm5Adapter(),{seat:seat(),job:job()});
  assert.equal(result.state,'QUALIFIED');
  assert.equal(result.adapter.source.revision,SGLANG_MINICPM5_SOURCE.revision);
  assert.equal(result.fit.evidence.tier,'UPSTREAM_VERIFIED_PLATFORM');
  assert.deepEqual(result.artifacts.map(row=>row.role),['target-model','draft-model']);
  assert.deepEqual(result.fit.recipe.argvTemplate,[
    'serve','--model-path','<CAIRN:target-model>','--reasoning-parser','qwen3','--tool-call-parser','minicpm5','--mem-fraction-static','0.75','--cuda-graph-max-bs','128','--host','127.0.0.1','--port','30000','--trust-remote-code','--speculative-algorithm','DSPARK','--speculative-draft-model-path','<CAIRN:draft-model>','--speculative-dspark-block-size','7'
  ]);
});

test('unverified NVIDIA hardware holds instead of generalizing the upstream benchmark',async()=>{
  const result=await qualifyRuntimeCandidate(makeSglangMiniCpm5Adapter(),{seat:seat('NVIDIA GeForce RTX 3090'),job:job()});
  assert.equal(result.state,'HOLD');
  assert.ok(result.holds.some(row=>row.code==='UNVERIFIED_PLATFORM'));
});

test('non-loopback serving requires explicit private-LAN authority',async()=>{
  const result=await qualifyRuntimeCandidate(makeSglangMiniCpm5Adapter(),{seat:seat(),job:job({service:{host:'0.0.0.0',port:30000}})});
  assert.equal(result.state,'HOLD');
  assert.ok(result.holds.some(row=>row.code==='NETWORK_AUTHORIZATION'));
});

test('source-pinned SGLang adapter materializes exact artifacts, launches shell-free argv, observes, and cleans up',async()=>{
  let command=null,cleaned=false;
  const driver={
    async prepareArtifacts({intents}){return {schema:'aperture-cairn-materialization/1',state:'READY',artifacts:intents.map((intent,index)=>({role:intent.role,locator:intent.locator,resolvedRevision:String(index+1).repeat(40),files:[{name:`artifact-${index}.bin`,bytes:100+index,sha256:String(index+1).repeat(64)}],privatePath:`/srv/cairn/artifact-${index}`}))};},
    async launch(input){command=input.command;return {state:'RUNNING',handleRef:'sglang-1',privateHandle:{pid:91}};},
    async observe(){return {state:'PASS',metrics:{readyMs:1200}};},
    async stop({privateHandle}){assert.deepEqual(privateHandle,{pid:91});cleaned=true;return {state:'STOPPED'};}
  };
  const adapter=makeSglangMiniCpm5Adapter({driver}),qualification=await qualifyRuntimeCandidate(adapter,{seat:seat(),job:job()});
  const result=await executeRuntimeQualification(adapter,qualification,{authorization:authority(qualification.qualificationHash)});
  assert.equal(result.state,'PASS');
  assert.equal(cleaned,true);
  assert.equal(command.shell,false);
  assert.equal(command.executable,'sglang');
  assert.ok(command.argv.includes('/srv/cairn/artifact-0'));
  assert.ok(command.argv.includes('/srv/cairn/artifact-1'));
  assert.doesNotMatch(JSON.stringify(result),/\/srv\/cairn|"pid":91/);
  assert.ok(result.launch.command.argv.includes('<CAIRN_LOCAL_PATH>'));
});
