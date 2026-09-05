import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {acquisitionKey,reuseCachedAcquisition} from '../lib/acquire.mjs';
import {executePlan,resume} from '../lib/wizard.mjs';
import {makePlan} from '../lib/routes.mjs';

const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'aperture-cache-reuse-'));
const priorHome=process.env.APERTURE_HOME;
process.env.APERTURE_HOME=path.join(tmp,'home');
const data=Buffer.from('cached model bytes');
const sha256=createHash('sha256').update(data).digest('hex');
const model={
  kind:'gguf',name:'chosen.gguf',local:false,bytes:data.length,
  source:{kind:'hf',repo:'org/model',revision:'a'.repeat(40),filename:'chosen.gguf'},
  files:[{name:'chosen.gguf',bytes:data.length,sha256,url:'https://example.test/chosen.gguf'}],
  gguf:{version:3,tensors:1,metadata:{'general.architecture':'llama','llama.block_count':1},complete:true},
  contentVerification:'PINNED_REVISION_HEADERS_ONLY'
};
function destination(value=model){return path.join(process.env.APERTURE_HOME,'models',acquisitionKey(value));}
async function seed(value=model,{checksum=value.files[0].sha256,bytes=data}={}){
  const dir=destination(value);await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'.aperture-download.json'),JSON.stringify({schema:'aperture-download/1',key:acquisitionKey(value)}));
  await fs.writeFile(path.join(dir,value.files[0].name),bytes);
  if(checksum!==null)await fs.writeFile(path.join(dir,value.files[0].name+'.sha256'),checksum+'\n');
  return dir;
}
test('absent managed cache is a read-only miss',async()=>{
  assert.equal(await reuseCachedAcquisition(model,destination()),null);
});

test('an incomplete remote descriptor is a cache miss',async()=>{
  assert.equal(await reuseCachedAcquisition({kind:'gguf',local:false},destination()),null);
});


test('complete cache binds the remote selection without network or transfer',async()=>{
  const dir=await seed();
  const cached=await reuseCachedAcquisition(model,dir);
  assert.equal(cached.local,true);
  assert.equal(cached.source.kind,'local');
  assert.equal(cached.source.path,path.join(dir,'chosen.gguf'));
  assert.equal(cached.files[0].sha256,sha256);
  assert.equal(cached.contentVerification,'CACHE_PATH_AND_EXPECTED_HASH_BOUND_FULL_HASH_PENDING');
  assert.deepEqual(cached.acquiredFrom,model.source);
});

test('cache identity or size drift fails closed',async()=>{
  const changed={...model,source:{...model.source,revision:'b'.repeat(40)}};
  const wrong=await seed(changed,{checksum:'0'.repeat(64)});
  await assert.rejects(reuseCachedAcquisition(changed,wrong),e=>e.code==='CACHE_CHANGED');
  const short={...model,name:'short.gguf',source:{...model.source,filename:'short.gguf'},
    files:[{...model.files[0],name:'short.gguf',bytes:data.length+1}]};
  const shortDir=await seed(short,{bytes:data});
  await assert.rejects(reuseCachedAcquisition(short,shortDir),e=>e.code==='CACHE_CHANGED');
});
test('execution binds a complete cache before prefit or acquisition',async()=>{
  const runModel={...model,name:'run.gguf',source:{...model.source,revision:'c'.repeat(40),filename:'run.gguf'},
    files:[{...model.files[0],name:'run.gguf',url:'https://example.test/run.gguf'}]};
  await seed(runModel);
  const log=[];let received;
  const ui={say:value=>log.push(value),confirm:async()=>{throw new Error('unexpected permission prompt');}};
  const result=await executePlan({schema:'aperture-answer/1',blockers:[],model:runModel},ui,{}, {
    reuseCachedAcquisition,
    prepareNativeFit:async()=>{throw new Error('network prefit must not run');},
    acquire:async()=>{throw new Error('transfer must not run');},
    run:async plan=>{received=plan;return 'used';}
  });
  assert.equal(result,'used');
  assert.equal(received.model.local,true);
  assert.equal(received.model.source.kind,'local');
  assert.ok(log.some(line=>line.includes('No model-host request or weight transfer')));
});

test('resuming a remote answer reports and uses its complete managed cache',async()=>{
  const resumeModel={...model,name:'resume.gguf',source:{...model.source,revision:'d'.repeat(40),filename:'resume.gguf'},
    files:[{...model.files[0],name:'resume.gguf',url:'https://example.test/resume.gguf'}]};
  await seed(resumeModel);
  const machine={platform:'win32',architecture:'x64',cpu:'TEST CPU',logicalCpus:8,
    memory:{totalBytes:16*1024**3,availableBytes:12*1024**3,allocationHeadroomBytes:12*1024**3,commitHeadroomBytes:20*1024**3},
    storage:{path:tmp,freeBytes:50*1024**3},hardware:{},installed:{python:null,llamaServer:null},
    gpu:{appleUnifiedMemory:false,devices:[]}};
  const plan=makePlan(machine,resumeModel,{backend:'cpu',context:2048,contextExplicit:true});
  const file=path.join(tmp,'remote-answer.json');await fs.writeFile(file,JSON.stringify(plan));
  const log=[];let received;
  const ui={say:value=>log.push(value),confirm:async()=>{throw new Error('unexpected permission prompt');}};
  await resume(file,ui,{runApproved:true},{reuseCachedAcquisition,run:async value=>{received=value;return value;}});
  assert.equal(received.model.local,true);
  assert.ok(log.some(line=>line.includes('No model-host request or weight transfer')));
  assert.ok(log.some(line=>line.includes('Download: none for weights')));
  assert.ok(!log.some(line=>line.includes('Download/reuse the exact selected model')));
});

test.after(async()=>{
  if(priorHome===undefined)delete process.env.APERTURE_HOME;
  else process.env.APERTURE_HOME=priorHome;
  await fs.rm(tmp,{recursive:true,force:true});
});
