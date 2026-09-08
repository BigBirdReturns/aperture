import test from 'node:test';
import assert from 'node:assert/strict';
import {GiB} from '../lib/common.mjs';
import {qualifyRuntimeCandidate,executeRuntimeQualification} from '../lib/runtime-adapter.mjs';
import {makeMlxLmServerAdapter,MLX_LM_SOURCE} from '../lib/adapters/mlx-lm.mjs';

const seat=(headroom=16*GiB)=>({id:'mac-a/metal0',nodeId:'mac-a',deviceId:'metal0',memoryDomain:'mac-a-unified',state:'READY',platform:'darwin',architecture:'arm64',runtime:{metal:{available:true,identity:'metal-fixture'},mlxLm:{server:true,identity:'mlx-lm-fixture',revision:MLX_LM_SOURCE.revision}},memory:{allocationHeadroomBytes:headroom,physicalBytes:24*GiB},device:{id:'metal0',kind:'metal',name:'Apple M4 GPU',memoryDomain:'mac-a-unified',totalBytes:24*GiB,freeBytes:headroom}});
const fitEvidence={schema:'aperture-runtime-fit-evidence/1',state:'FIT',adapterId:'mlx-lm/server',seatId:'mac-a/metal0',modelId:'mlx-community/Qwen3.5-4B-MLX-4bit',sourceRevision:MLX_LM_SOURCE.revision,basis:'measured',workingSetBytes:6*GiB,receiptSha256:'c'.repeat(64)};
const job=(overrides={})=>({id:'mac-chat',kind:'inference-service',model:{id:'mlx-community/Qwen3.5-4B-MLX-4bit',format:'mlx'},service:{host:'127.0.0.1',port:8080},policy:{allowRemoteCode:false,allowLanBind:false},fitEvidence,...overrides});
const authority=qualificationHash=>({schema:'aperture-runtime-authorization/1',adapterId:'mlx-lm/server',seatId:'mac-a/metal0',jobId:'mac-chat',qualificationHash,occurrenceId:'occ-2',fence:'occ-2:4',allowPrepare:true,allowMaterialization:true,allowLaunch:true});

test('MLX-LM requires an exact seat-bound fit receipt and keeps unified memory non-additive',async()=>{
  const result=await qualifyRuntimeCandidate(makeMlxLmServerAdapter(),{seat:seat(),job:job()});
  assert.equal(result.state,'QUALIFIED');
  assert.equal(result.fit.evidence.workingSetBytes,6*GiB);
  assert.equal(result.fit.evidence.currentHeadroomBytes,16*GiB);
  assert.match(result.fit.evidence.capacityClaim,/one domain/);
  const missing=await qualifyRuntimeCandidate(makeMlxLmServerAdapter(),{seat:seat(),job:job({fitEvidence:null})});
  assert.equal(missing.state,'HOLD');
  assert.ok(missing.holds.some(row=>row.code==='FIT_EVIDENCE'));
});

test('current unified-memory headroom can invalidate an otherwise exact fit receipt',async()=>{
  const result=await qualifyRuntimeCandidate(makeMlxLmServerAdapter(),{seat:seat(4*GiB),job:job()});
  assert.equal(result.state,'HOLD');
  assert.ok(result.holds.some(row=>row.code==='HEADROOM'));
});

test('MLX-LM adapter launches the official server surface from an exact CAIRN artifact',async()=>{
  let command=null,cleaned=false;
  const driver={
    async prepareArtifacts({intents}){return {schema:'aperture-cairn-materialization/1',state:'READY',artifacts:[{role:intents[0].role,locator:intents[0].locator,resolvedRevision:'d'.repeat(40),files:[{name:'model.safetensors',bytes:3*GiB,sha256:'d'.repeat(64)}],privatePath:'/cairn/qwen-mlx'}]};},
    async launch(input){command=input.command;return {state:'RUNNING',handleRef:'mlx-1',privateHandle:{pid:22}};},
    async observe(){return {state:'PASS'};},
    async stop(){cleaned=true;return {state:'STOPPED'};}
  };
  const adapter=makeMlxLmServerAdapter({driver}),qualification=await qualifyRuntimeCandidate(adapter,{seat:seat(),job:job()});
  const result=await executeRuntimeQualification(adapter,qualification,{authorization:authority(qualification.qualificationHash)});
  assert.equal(result.state,'PASS');
  assert.equal(cleaned,true);
  assert.deepEqual(command,{executable:'mlx_lm.server',argv:['--model','/cairn/qwen-mlx','--host','127.0.0.1','--port','8080'],shell:false});
  assert.doesNotMatch(JSON.stringify(result),/\/cairn\/qwen-mlx|"pid":22/);
});
