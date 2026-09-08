import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {makeSglangMiniCpm5Adapter} from '../lib/adapters/sglang-minicpm5.mjs';
import {makeMlxLmServerAdapter} from '../lib/adapters/mlx-lm.mjs';
import {makeCairnFabricPlan,bindCairnFabricOccurrence,seatsFromFabricCensus} from '../lib/cairn-fabric.mjs';

const load=async()=>JSON.parse(await fs.readFile(new URL('../fixtures/fabric/dorm-lab.json',import.meta.url),'utf8'));
const adapters=()=>[makeSglangMiniCpm5Adapter(),makeMlxLmServerAdapter()];

test('synthetic dorm fabric assigns native jobs across two runtime families and keeps every memory domain separate',async()=>{
  const fixture=await load(),plan=await makeCairnFabricPlan({census:fixture,jobs:fixture.jobs,adapters:adapters()});
  assert.equal(plan.status,'READY_TO_PREPARE');
  assert.equal(plan.evidenceTier,'SYNTHETIC_PLANNER_FIXTURE');
  assert.equal(plan.topology.nodes,6);
  assert.equal(plan.topology.seats,6);
  assert.equal(plan.topology.pooled,false);
  assert.equal(new Set(plan.topology.memoryDomains.map(row=>row.memoryDomain)).size,6);
  assert.deepEqual(plan.assignments.map(row=>[row.jobId,row.nodeId,row.adapterId]),[
    ['coding-service','room-101-5090','sglang/minicpm5-2b-dspark'],
    ['resident-mac-chat','room-203-m4','mlx-lm/server']
  ]);
  assert.equal(plan.unplaced.length,1);
  assert.equal(plan.unplaced[0].jobId,'rocm-vision-experiment');
  assert.equal(plan.unplaced[0].required,false);
  assert.equal(plan.cairn.materializations.length,3);
  assert.ok(plan.cairn.materializations.every(row=>['room-101-5090','room-203-m4'].includes(row.nodeId)));
  assert.equal('planningTotalPhysicalBytes' in plan.topology,false);
  assert.match(plan.claimBoundary,/no pooled-VRAM or additive-memory claim/);
});

test('candidate ledger carries exact refusal reasons for hardware that cannot run a requested native recipe',async()=>{
  const fixture=await load(),plan=await makeCairnFabricPlan({census:fixture,jobs:[fixture.jobs[0]],adapters:adapters()});
  const r9700=plan.candidates.find(row=>row.seatId==='room-301-r9700/rocm0'&&row.adapterId==='sglang/minicpm5-2b-dspark');
  assert.equal(r9700.state,'HOLD');
  assert.ok(r9700.holds.some(row=>['ACCELERATOR','CUDA','SGLANG'].includes(row.code)));
});

test('required unplaced work holds the whole plan rather than silently dropping it',async()=>{
  const fixture=await load(),required={...fixture.jobs[2],required:true},plan=await makeCairnFabricPlan({census:fixture,jobs:[fixture.jobs[0],required],adapters:adapters()});
  assert.equal(plan.status,'HOLD');
  assert.equal(plan.unplaced[0].required,true);
  assert.equal(plan.execution,'NOT_RUN');
});

test('seat concurrency is explicit and defaults to one job',async()=>{
  const fixture=await load(),first=fixture.jobs[0],second=structuredClone(first);second.id='coding-service-2';second.priority=99;
  const plan=await makeCairnFabricPlan({census:fixture,jobs:[first,second],adapters:adapters()});
  assert.equal(plan.status,'HOLD');
  assert.equal(plan.assignments.length,1);
  assert.equal(plan.unplaced[0].code,'SEAT_CAPACITY');
});

test('occurrence binding emits exact adapter authorizations without creating another authority plane',async()=>{
  const fixture=await load(),plan=await makeCairnFabricPlan({census:fixture,jobs:fixture.jobs.slice(0,2),adapters:adapters()});
  const bound=bindCairnFabricOccurrence(plan,{id:'dorm-demo-1',fence:'dorm-demo-1:7',authorityNodeId:'dorm-head',planHash:plan.planHash,permissions:{prepare:true,materialize:true,launch:true}});
  assert.equal(bound.state,'READY_TO_PREPARE');
  assert.equal(bound.assignments.length,2);
  assert.ok(bound.assignments.every(row=>row.authorization.fence==='dorm-demo-1:7'&&row.authorization.allowMaterialization===true));
  assert.ok(bound.assignments.every(row=>row.authorization.qualificationHash));
  assert.equal(bound.planHash,plan.planHash);
  assert.match(bound.claimBoundary,/does not create, replace, or extend/);
  assert.throws(()=>bindCairnFabricOccurrence(plan,{id:'dorm-demo-2',fence:'dorm-demo-2:1',authorityNodeId:'dorm-head',planHash:plan.planHash,permissions:{prepare:true,materialize:false,launch:true}}),error=>error.code==='CAIRN_FABRIC_AUTHORITY');
});

test('census flattening rejects duplicate physical memory domains',async()=>{
  const fixture=await load();fixture.nodes[2].devices[0].memoryDomain=fixture.nodes[1].devices[0].memoryDomain;
  assert.throws(()=>seatsFromFabricCensus(fixture),error=>error.code==='CAIRN_FABRIC_CENSUS');
});
