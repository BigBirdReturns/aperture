import test from 'node:test';
import assert from 'node:assert/strict';
import {defineRuntimeAdapter,qualifyRuntimeCandidate,executeRuntimeQualification,RUNTIME_PROBE_SCHEMA,RUNTIME_FIT_SCHEMA,RUNTIME_PREPARATION_SCHEMA,RUNTIME_LAUNCH_SCHEMA,RUNTIME_OBSERVATION_SCHEMA,RUNTIME_STOP_SCHEMA} from '../lib/runtime-adapter.mjs';

const source={repository:'example/runtime',revision:'a'.repeat(40),path:'docs/recipe.md'};
const seat={id:'node-a/gpu0',nodeId:'node-a',deviceId:'gpu0',memoryDomain:'domain-a'};
const job={id:'job-a',kind:'inference-service',model:{id:'example/model'}};
const authority=qualificationHash=>({schema:'aperture-runtime-authorization/1',adapterId:'example/runtime',seatId:seat.id,jobId:job.id,qualificationHash,occurrenceId:'occ-1',fence:'occ-1:1',allowPrepare:true,allowMaterialization:true,allowLaunch:true});

function adapter(overrides={}){
  return defineRuntimeAdapter({
    id:'example/runtime',version:'1',source,
    async probe(){return {schema:RUNTIME_PROBE_SCHEMA,state:'READY',facts:{runtime:'example'}};},
    async fit(){return {schema:RUNTIME_FIT_SCHEMA,state:'FIT',score:10,artifacts:[{role:'model',locator:'hf://example/model'}]};},
    async prepare(){return {schema:RUNTIME_PREPARATION_SCHEMA,state:'READY'};},
    async launch(){return {schema:RUNTIME_LAUNCH_SCHEMA,state:'RUNNING',handleRef:'handle-1',privateHandle:{pid:7}};},
    async observe(){return {schema:RUNTIME_OBSERVATION_SCHEMA,state:'PASS'};},
    async stop(){return {schema:RUNTIME_STOP_SCHEMA,state:'STOPPED'};},
    ...overrides
  });
}

test('runtime adapter definition requires an exact upstream revision and all six lifecycle methods',()=>{
  assert.throws(()=>defineRuntimeAdapter({id:'bad',version:'1',source:{...source,revision:'main'}}),error=>error.code==='RUNTIME_ADAPTER_SOURCE');
  assert.throws(()=>defineRuntimeAdapter({id:'bad',version:'1',source}),error=>error.code==='RUNTIME_ADAPTER_METHOD');
});

test('qualification is read-only and stops before fit when the probe holds',async()=>{
  let fitCalls=0,sideEffects=0;
  const candidate=adapter({
    async probe(){return {schema:RUNTIME_PROBE_SCHEMA,state:'HOLD',holds:[{code:'OFFLINE',message:'Seat offline.'}]};},
    async fit(){fitCalls++;return {schema:RUNTIME_FIT_SCHEMA,state:'FIT',score:1};},
    async prepare(){sideEffects++;return {schema:RUNTIME_PREPARATION_SCHEMA,state:'READY'};}
  });
  const result=await qualifyRuntimeCandidate(candidate,{seat,job});
  assert.equal(result.state,'HOLD');
  assert.equal(result.phase,'PROBE');
  assert.equal(fitCalls,0);
  assert.equal(sideEffects,0);
  assert.equal(result.holds[0].code,'OFFLINE');
});

test('qualification preserves source, fit evidence, score, and artifact intents',async()=>{
  const result=await qualifyRuntimeCandidate(adapter(),{seat,job});
  assert.equal(result.state,'QUALIFIED');
  assert.equal(result.adapter.source.revision,'a'.repeat(40));
  assert.equal(result.score,10);
  assert.deepEqual(result.artifacts,[{role:'model',locator:'hf://example/model'}]);
});

test('execution requires exact fenced authority including materialization consent',async()=>{
  const candidate=adapter(),qualification=await qualifyRuntimeCandidate(candidate,{seat,job});
  assert.rejects(()=>executeRuntimeQualification(candidate,qualification,{authorization:{...authority(qualification.qualificationHash),allowMaterialization:false}}),error=>error.code==='RUNTIME_AUTHORIZATION');
  assert.rejects(()=>executeRuntimeQualification(candidate,qualification,{authorization:{...authority(qualification.qualificationHash),fence:''}}),error=>error.code==='RUNTIME_AUTHORIZATION');
});

test('cleanup runs after an observation failure and private handles stay out of the receipt',async()=>{
  let stopped=false;
  const candidate=adapter({
    async observe(){throw Object.assign(new Error('readiness failed'),{code:'READINESS'});},
    async stop({launch}){assert.deepEqual(launch.privateHandle,{pid:7});stopped=true;return {schema:RUNTIME_STOP_SCHEMA,state:'STOPPED'};}
  });
  const qualification=await qualifyRuntimeCandidate(candidate,{seat,job});
  const result=await executeRuntimeQualification(candidate,qualification,{authorization:authority(qualification.qualificationHash)});
  assert.equal(result.state,'FAIL_RUNTIME');
  assert.equal(result.failure.code,'READINESS');
  assert.equal(result.cleanup.state,'STOPPED');
  assert.equal(stopped,true);
  assert.doesNotMatch(JSON.stringify(result),/"pid":7|privateHandle/);
});

test('a held preparation launches nothing',async()=>{
  let launches=0;
  const candidate=adapter({
    async prepare(){return {schema:RUNTIME_PREPARATION_SCHEMA,state:'HOLD',holds:[{code:'BYTES',message:'Artifact bytes absent.'}]};},
    async launch(){launches++;return {schema:RUNTIME_LAUNCH_SCHEMA,state:'RUNNING',handleRef:'unexpected'};}
  });
  const qualification=await qualifyRuntimeCandidate(candidate,{seat,job});
  const result=await executeRuntimeQualification(candidate,qualification,{authorization:authority(qualification.qualificationHash)});
  assert.equal(result.state,'HOLD_PREPARATION');
  assert.equal(launches,0);
});
