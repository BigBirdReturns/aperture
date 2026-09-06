import test from 'node:test';
import assert from 'node:assert/strict';
import {GiB} from '../lib/common.mjs';
import {evaluateCatalog,evaluateRecipe} from '../lib/recipes.mjs';
import {RECIPE_CATALOG} from '../lib/recipe-catalog.mjs';
import {parseNvidia,parseNvidiaDetails,mergeNvidiaDetails} from '../lib/scan.mjs';

const gpu=(index,name='NVIDIA RTX PRO 6000 Blackwell',total=96,free=90,computeCapability=12)=>({
  index,uuid:`GPU-fixture-${index}`,name,totalBytes:total*GiB,freeBytes:free*GiB,driver:'fixture',capacity:'DRIVER_REPORTED',externalGate:false,
  computeCapability,pcie:{generation:5,width:16}
});
const machine=devices=>({schema:'aperture-scan/1',platform:'linux',architecture:'x64',gpu:{devices}});
const recipe=id=>RECIPE_CATALOG.find(row=>row.id===id);

test('NVIDIA detail probe is additive and does not replace capacity identity',()=>{
  const base=parseNvidia('0, GPU-test-0, NVIDIA RTX 5090, 32768, 30000, 590.1\n');
  const detail=parseNvidiaDetails('0, GPU-test-0, 12.0, 5, 16\n');
  const merged=mergeNvidiaDetails(base,detail);
  assert.equal(merged[0].totalBytes,32768*1048576);
  assert.equal(merged[0].computeCapability,12);
  assert.deepEqual(merged[0].pcie,{generation:5,width:16});
});

test('NVFP4 hard architecture floor blocks pre-SM120 hardware',()=>{
  const row=evaluateRecipe(machine([gpu(0,'NVIDIA RTX 3090',24,24,8.6),gpu(1,'NVIDIA RTX 3090',24,24,8.6),gpu(2,'NVIDIA RTX 3090',24,24,8.6),gpu(3,'NVIDIA RTX 3090',24,24,8.6)]),recipe('rtx6kpro/qwen35-397b-a17b-nvfp4-tp4'));
  assert.equal(row.status,'BLOCKED');
  assert.ok(row.blockers.some(text=>text.includes('compute capability 12')));
});

test('approximate source working set remains UNKNOWN below the observation instead of becoming a fabricated floor',()=>{
  const row=evaluateRecipe(machine([gpu(0,'NVIDIA RTX 6000 fixture',80),gpu(1,'NVIDIA RTX 6000 fixture',80),gpu(2,'NVIDIA RTX 6000 fixture',80),gpu(3,'NVIDIA RTX 6000 fixture',80)]),recipe('rtx6kpro/qwen35-397b-a17b-nvfp4-tp4'));
  assert.equal(row.status,'UNKNOWN');
  assert.equal(row.blockers.length,0);
  assert.ok(row.unknowns.some(text=>text.includes('approximate observation')));
});

test('an explicitly established working-set floor can hard-block smaller physical VRAM',()=>{
  const base=recipe('rtx6kpro/qwen38-27b-official-fp8-vllm-tp1-mtp3');
  const exact={...base,hard:{...base.hard,perGpuObservedWorkingSetBytes:40*GiB},reference:{...base.reference,perGpuMemoryBytes:null}};
  const row=evaluateRecipe(machine([gpu(0,'NVIDIA fixture',32,30,12)]),exact);
  assert.equal(row.status,'BLOCKED');
  assert.ok(row.blockers.some(text=>text.includes('established working-set floor')));
});

test('smaller-than-reference memory remains unknown when the source did not establish a floor',()=>{
  const row=evaluateRecipe(machine([gpu(0,'NVIDIA GeForce RTX 5090',32,30,12)]),recipe('rtx6kpro/qwen38-27b-official-fp8-vllm-tp1-mtp3'));
  assert.equal(row.status,'UNKNOWN');
  assert.equal(row.blockers.length,0);
  assert.ok(row.unknowns.some(text=>text.includes('does not establish')));
});

test('nominal 96 GB class tolerates normal driver-reported capacity below 96 GiB',()=>{
  const row=evaluateRecipe(machine([0,1,2,3].map(i=>gpu(i,'NVIDIA RTX PRO 6000 Blackwell',95.5,90,12))),recipe('rtx6kpro/qwen38-27b-official-fp8-vllm-tp4-qualified'));
  assert.equal(row.status,'QUALIFIED');
});

test('qualified source becomes QUALIFIED only when reference conditions are observed',()=>{
  const row=evaluateRecipe(machine([0,1,2,3].map(i=>gpu(i))),recipe('rtx6kpro/qwen38-27b-official-fp8-vllm-tp4-qualified'));
  assert.equal(row.status,'QUALIFIED');
  assert.equal(row.evidenceStatus,'qualified');
});

test('field observation remains CANDIDATE on matching reference hardware',()=>{
  const row=evaluateRecipe(machine([0,1,2,3].map(i=>gpu(i))),recipe('rtx6kpro/qwen35-397b-a17b-nvfp4-tp4'));
  assert.equal(row.status,'CANDIDATE');
  assert.equal(row.evidenceStatus,'field-observation');
});

test('mixed GPUs do not inherit a homogeneous multi-GPU recipe',()=>{
  const devices=[gpu(0,'NVIDIA RTX PRO 6000 Blackwell'),gpu(1,'NVIDIA RTX PRO 6000 Blackwell'),gpu(2,'NVIDIA GeForce RTX 5090',96),gpu(3,'NVIDIA GeForce RTX 5090',96)];
  const row=evaluateRecipe(machine(devices),recipe('rtx6kpro/qwen38-27b-official-fp8-vllm-tp4-qualified'));
  assert.equal(row.status,'UNKNOWN');
  assert.ok(row.unknowns.some(text=>text.includes('homogeneous')));
});

test('current VRAM pressure is reported separately from physical capability',()=>{
  const devices=[0,1,2,3].map(i=>gpu(i,'NVIDIA RTX PRO 6000 Blackwell',96,40,12));
  const row=evaluateRecipe(machine(devices),recipe('rtx6kpro/qwen35-397b-a17b-nvfp4-tp4'));
  assert.equal(row.status,'CANDIDATE');
  assert.equal(row.availability,'BELOW_SOURCE_REFERENCE_HEADROOM');
  assert.ok(row.cautions.some(text=>text.includes('currently free')));
});

test('catalog report never claims execution and preserves source commit',()=>{
  const report=evaluateCatalog(machine([0,1,2,3].map(i=>gpu(i))));
  assert.equal(report.schema,'aperture-recipe-report/1');
  assert.equal(report.execution,'NOT_RUN');
  assert.equal(report.source.commit,'3023e7c2e572cd445cd62234607aaf765121da58');
  assert.equal(report.permissions.run,false);
  assert.equal(report.results.length,RECIPE_CATALOG.length);
});
