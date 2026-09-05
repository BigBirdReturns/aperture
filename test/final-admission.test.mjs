// Control tests for the admission timing exposed by the native Windows run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareLocalExecution} from '../lib/native-fit.mjs';
import {runNative} from '../lib/run.mjs';
import {hashFile} from '../lib/common.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'aperture-final-admission-'));
const previousHome=process.env.APERTURE_HOME; process.env.APERTURE_HOME=root;
const file=path.join(root,'fixture.gguf'); await fs.writeFile(file,'fixture-not-a-native-model');
const digest=await hashFile(file), size=(await fs.stat(file)).size;
const plan=()=>({blockers:[],machine:{memory:{availableBytes:100}},
  request:{contextPerSequence:2048,parallel:1},
  model:{local:true,kind:'gguf',source:{path:file},files:[{name:'fixture.gguf',path:file,bytes:size,sha256:digest}]},
  method:{backend:'cpu',gpuLayers:'fit',ramBudgetBytes:100}});
const ui={say(){},confirm:async()=>false};
const fitted=(p,n=0)=>({plan:{...p,nativeFit:{selected:{gpuLayers:n}}},runtimeDirectory:root});
test('complete integrity check precedes final admission and pins only the returned plan',async()=>{
  const events=[], p=plan();
  const result=await prepareLocalExecution(p,ui,{}, {
    hashFile:async f=>{events.push('hash');return hashFile(f);},
    prepareNativeFit:async(q,u,o,phase)=>{events.push('fit');assert.match(phase,/after integrity/);return fitted(q,2);}
  });
  assert.deepEqual(events,['hash','fit']);assert.equal(result.modelContent[0].sha256,digest);
  assert.equal(result.plan.method.gpuLayers,2);assert.equal(p.method.gpuLayers,'fit');
  assert.equal(result.plan.request.contextPerSequence,2048);assert.equal(result.plan.request.parallel,1);
  assert.ok(Number.isFinite(Date.parse(result.integrityVerifiedAt)));
});
test('same-size corruption refuses before admission',async()=>{
  let called=false;const p=plan();p.model.files[0].sha256='0'.repeat(64);
  await assert.rejects(prepareLocalExecution(p,ui,{}, {prepareNativeFit:async()=>{called=true;}}),e=>e.code==='MODEL_CHANGED');
  assert.equal(called,false);
});
test('size change refuses before hashing and admission',async()=>{
  let called=false;const p=plan();p.model.files[0].bytes++;
  await assert.rejects(prepareLocalExecution(p,ui,{}, {hashFile:async()=>{called=true;}}),e=>e.code==='MODEL_CHANGED');
  assert.equal(called,false);
});
test('empty or nonlocal checkpoints cannot obtain final admission',async()=>{
  const p=plan();p.model.files=[];
  await assert.rejects(prepareLocalExecution(p,ui),e=>e.code==='MODEL_NOT_LOCAL');
  p.model.local=false;await assert.rejects(prepareLocalExecution(p,ui),e=>e.code==='MODEL_NOT_LOCAL');
});
test('every preparation rehashes and reassesses without freezing inferred placement',async()=>{
  const p=plan();let checks=0;
  const deps={prepareNativeFit:async q=>{assert.equal(q.method.gpuLayers,'fit');return fitted(q,++checks);}};
  assert.equal((await prepareLocalExecution(p,ui,{},deps)).plan.method.gpuLayers,1);
  assert.equal((await prepareLocalExecution(p,ui,{},deps)).plan.method.gpuLayers,2);
});
test('declining generation does not start native admission',async()=>{
  let called=false;
  const result=await runNative(plan(),ui,{prompt:'fixture'}, {prepareLocalExecution:async()=>{called=true;}});
  assert.equal(result,null);assert.equal(called,false);
});
test('second-trial refusal preserves the first result and launches no second worker',async()=>{
  let prepared=0, launched=0;const p=plan();
  const result=await runNative(p,ui,{experiment:true,runApproved:true}, {
    prepareLocalExecution:async q=>{
      assert.equal(q.method.gpuLayers,'fit');
      if(++prepared===2)throw Object.assign(new Error('resource pressure'),{code:'MODEL_DOES_NOT_FIT'});
      return {...fitted(q),modelContent:[{name:'fixture.gguf',sha256:digest}],integrityVerifiedAt:new Date().toISOString()};
    },
    supervised:async(exe,args)=>{
      launched++;const job=JSON.parse(await fs.readFile(args[1],'utf8'));
      assert.ok(job.integrityVerifiedAt);assert.equal(job.plan.request.contextPerSequence,2048);
      await fs.writeFile(job.resultFile,JSON.stringify({text:'fixture output',generationSeconds:0.1,observedGpuLayers:0,observedContext:2048}));
      return {code:0,stopped:false};
    }
  });
  assert.equal(prepared,2);assert.equal(launched,1);assert.equal(result.completed,1);
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.trials[0].result.text,'fixture output');
  assert.equal(result.trials[1].status,'REFUSED');assert.equal(result.trials[1].result.code,'MODEL_DOES_NOT_FIT');
});
test('initial refusal saves incomplete results without launching a worker',async()=>{
  let launched=false;
  const result=await runNative(plan(),ui,{runApproved:true,prompt:'fixture'}, {
    prepareLocalExecution:async()=>{throw Object.assign(new Error('no fit'),{code:'MODEL_DOES_NOT_FIT'});},
    supervised:async()=>{launched=true;}
  });
  assert.equal(launched,false);assert.equal(result.completed,0);assert.equal(result.status,'INCOMPLETE');
});
test.after(async()=>{
  if(previousHome===undefined)delete process.env.APERTURE_HOME;else process.env.APERTURE_HOME=previousHome;
  await fs.rm(root,{recursive:true,force:true});
});
