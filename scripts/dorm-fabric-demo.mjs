import fs from 'node:fs/promises';
import {makeSglangMiniCpm5Adapter} from '../lib/adapters/sglang-minicpm5.mjs';
import {makeMlxLmServerAdapter} from '../lib/adapters/mlx-lm.mjs';
import {makeCairnFabricPlan} from '../lib/cairn-fabric.mjs';

const fixture=JSON.parse(await fs.readFile(new URL('../fixtures/fabric/dorm-lab.json',import.meta.url),'utf8'));
const plan=await makeCairnFabricPlan({census:fixture,jobs:fixture.jobs,adapters:[makeSglangMiniCpm5Adapter(),makeMlxLmServerAdapter()]});
const summary={
  schema:'aperture-dorm-fabric-demo/1',
  evidenceTier:plan.evidenceTier,
  status:plan.status,
  nodes:plan.topology.nodes,
  seats:plan.topology.seats,
  memoryDomains:plan.topology.memoryDomains.length,
  assignments:plan.assignments.map(row=>({jobId:row.jobId,nodeId:row.nodeId,seatId:row.seatId,adapterId:row.adapterId,artifactIntents:row.qualification.artifacts.length})),
  unplaced:plan.unplaced.map(row=>({jobId:row.jobId,required:row.required,code:row.code})),
  cairnMaterializations:plan.cairn.materializations,
  execution:plan.execution,
  claimBoundary:plan.claimBoundary
};
console.log(JSON.stringify(summary,null,2));
