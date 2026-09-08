import {createHash} from 'node:crypto';
import {ApertureError,now} from './common.mjs';
import {qualifyRuntimeCandidate,validateRuntimeAdapter} from './runtime-adapter.mjs';

export const CAIRN_FABRIC_PLAN_SCHEMA='aperture-cairn-fabric-plan/1';
export const CAIRN_FABRIC_OCCURRENCE_SCHEMA='aperture-cairn-fabric-occurrence/1';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const canon=value=>Array.isArray(value)?value.map(canon):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canon(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');
const positive=(value,name)=>{
  if(!Number.isSafeInteger(value)||value<1)throw new ApertureError('CAIRN_FABRIC_INPUT',`${name} must be a positive safe integer.`);
  return value;
};

export function seatsFromFabricCensus(census){
  if(census?.schema!=='aperture-fabric-census/1'||!Array.isArray(census.nodes)||!census.nodes.length)throw new ApertureError('CAIRN_FABRIC_CENSUS','Aperture Fabric census data is required.');
  const seats=[],ids=new Set(),domains=new Set();
  for(const node of census.nodes){
    if(typeof node.id!=='string'||!node.id)throw new ApertureError('CAIRN_FABRIC_CENSUS','Every census node requires a stable id.');
    for(const device of node.devices||[]){
      if(typeof device.id!=='string'||!device.id)throw new ApertureError('CAIRN_FABRIC_CENSUS','Every execution device requires a node-local id.');
      const id=`${node.id}/${device.id}`,memoryDomain=device.memoryDomain;
      if(ids.has(id))throw new ApertureError('CAIRN_FABRIC_CENSUS','Execution seat ids must be unique.');
      if(typeof memoryDomain!=='string'||!memoryDomain||domains.has(memoryDomain))throw new ApertureError('CAIRN_FABRIC_CENSUS','Each execution seat must retain one unique physical memory domain.');
      ids.add(id);domains.add(memoryDomain);
      const capacitySlots=device.scheduling?.concurrentJobs??1;positive(capacitySlots,`Seat ${id} concurrency`);
      seats.push({id,nodeId:node.id,deviceId:device.id,memoryDomain,state:node.state,platform:node.os?.platform??node.platform??null,architecture:node.os?.architecture??node.architecture??null,productName:node.productName??node.hardware?.productName??null,observedAt:node.observedAt??census.observedAt??null,runtime:{...(node.runtime||{}),...(device.runtime||{})},memory:{allocationHeadroomBytes:node.memory?.allocationHeadroomBytes??null,physicalBytes:node.memory?.physicalBytes??node.memory?.totalBytes??null},device:{...device,memoryDomain},capacitySlots});
    }
  }
  return seats.sort((a,b)=>a.id.localeCompare(b.id));
}

function validateJobs(jobs){
  if(!Array.isArray(jobs)||!jobs.length)throw new ApertureError('CAIRN_FABRIC_JOB','At least one fabric job is required.');
  const ids=new Set();
  for(const job of jobs){
    if(!object(job)||typeof job.id!=='string'||!job.id||ids.has(job.id)||!object(job.model)||typeof job.model.id!=='string'||!job.model.id)throw new ApertureError('CAIRN_FABRIC_JOB','Fabric jobs require unique ids and model ids.');
    ids.add(job.id);
    if(job.priority!=null&&!Number.isFinite(job.priority))throw new ApertureError('CAIRN_FABRIC_JOB','Fabric job priority must be finite.');
    if(job.adapters!=null&&(!Array.isArray(job.adapters)||job.adapters.some(id=>typeof id!=='string'||!id)))throw new ApertureError('CAIRN_FABRIC_JOB','Fabric adapter filters must be arrays of adapter ids.');
  }
  return jobs;
}
function validateAdapters(adapters){
  if(!Array.isArray(adapters)||!adapters.length)throw new ApertureError('CAIRN_FABRIC_ADAPTER','At least one runtime adapter is required.');
  const ids=new Set();
  for(const adapter of adapters){validateRuntimeAdapter(adapter);if(ids.has(adapter.id))throw new ApertureError('CAIRN_FABRIC_ADAPTER','Runtime adapter ids must be unique.');ids.add(adapter.id);}
  return adapters;
}
const candidateRef=qualification=>({state:qualification.state,phase:qualification.phase,adapterId:qualification.adapter.id,adapterVersion:qualification.adapter.version,seatId:qualification.seat.id,nodeId:qualification.seat.nodeId,deviceId:qualification.seat.deviceId,memoryDomain:qualification.seat.memoryDomain,score:qualification.score,holds:qualification.holds,evidence:qualification.fit?.evidence??null});

function artifactPlan(assignments){
  const rows=new Map();
  for(const assignment of assignments){
    for(const artifact of assignment.qualification.artifacts){
      const key=[assignment.nodeId,artifact.locator,artifact.revision??'',artifact.revisionPolicy??''].join('\n');
      if(!rows.has(key))rows.set(key,{nodeId:assignment.nodeId,locator:artifact.locator,revision:artifact.revision??null,revisionPolicy:artifact.revisionPolicy??null,roles:[],consumers:[],state:'NOT_MATERIALIZED'});
      const row=rows.get(key);
      if(!row.roles.includes(artifact.role))row.roles.push(artifact.role);
      if(!row.consumers.includes(assignment.jobId))row.consumers.push(assignment.jobId);
    }
  }
  return [...rows.values()].sort((a,b)=>a.nodeId.localeCompare(b.nodeId)||a.locator.localeCompare(b.locator)).map((row,index)=>({id:`cairn-materialization-${index+1}`,...row,roles:row.roles.sort(),consumers:row.consumers.sort()}));
}

export async function makeCairnFabricPlan({census,jobs,adapters}){
  validateJobs(jobs);validateAdapters(adapters);
  const seats=seatsFromFabricCensus(census),usage=new Map(seats.map(seat=>[seat.id,0])),assignments=[],unplaced=[],candidateLedger=[];
  const ordered=[...jobs].sort((a,b)=>(b.priority??0)-(a.priority??0)||a.id.localeCompare(b.id));
  for(const job of ordered){
    const candidates=[];
    for(const adapter of adapters){
      if(job.adapters&&!job.adapters.includes(adapter.id))continue;
      for(const seat of seats){
        const qualification=await qualifyRuntimeCandidate(adapter,{seat,job});
        candidates.push({adapter,seat,qualification});
        candidateLedger.push({jobId:job.id,...candidateRef(qualification)});
      }
    }
    const qualified=candidates.filter(row=>row.qualification.state==='QUALIFIED'&&(usage.get(row.seat.id)||0)<row.seat.capacitySlots);
    qualified.sort((a,b)=>b.qualification.score-a.qualification.score||((usage.get(a.seat.id)||0)/a.seat.capacitySlots)-((usage.get(b.seat.id)||0)/b.seat.capacitySlots)||a.seat.id.localeCompare(b.seat.id)||a.adapter.id.localeCompare(b.adapter.id));
    const selected=qualified[0];
    if(!selected){
      const anyQualified=candidates.some(row=>row.qualification.state==='QUALIFIED');
      unplaced.push({code:anyQualified?'SEAT_CAPACITY':'NO_QUALIFIED_SEAT',message:anyQualified?'Every qualified seat has reached its admitted concurrent-job capacity.':'No runtime adapter qualified this job on a currently admitted seat.',jobId:job.id,required:job.required!==false,candidates:candidates.map(row=>candidateRef(row.qualification))});
      continue;
    }
    usage.set(selected.seat.id,(usage.get(selected.seat.id)||0)+1);
    assignments.push({jobId:job.id,required:job.required!==false,priority:job.priority??0,adapterId:selected.adapter.id,adapterVersion:selected.adapter.version,nodeId:selected.seat.nodeId,seatId:selected.seat.id,deviceId:selected.seat.deviceId,memoryDomain:selected.seat.memoryDomain,qualification:selected.qualification,execution:'NOT_RUN'});
  }
  assignments.sort((a,b)=>a.jobId.localeCompare(b.jobId));unplaced.sort((a,b)=>a.jobId.localeCompare(b.jobId));candidateLedger.sort((a,b)=>a.jobId.localeCompare(b.jobId)||a.seatId.localeCompare(b.seatId)||a.adapterId.localeCompare(b.adapterId));
  const requiredHolds=unplaced.filter(row=>row.required),materializations=artifactPlan(assignments);
  const topology={nodes:census.nodes.length,seats:seats.length,memoryDomains:seats.map(seat=>({seatId:seat.id,nodeId:seat.nodeId,memoryDomain:seat.memoryDomain,kind:seat.device.kind,name:seat.device.name??null,capacitySlots:seat.capacitySlots})),pooled:false};
  const planMaterial={status:requiredHolds.length?'HOLD':'READY_TO_PREPARE',evidenceTier:census.synthetic===true?'SYNTHETIC_PLANNER_FIXTURE':'LIVE_CENSUS',authorityNodeId:census.authorityNodeId??null,topology,assignments:assignments.map(row=>({jobId:row.jobId,required:row.required,priority:row.priority,adapterId:row.adapterId,adapterVersion:row.adapterVersion,nodeId:row.nodeId,seatId:row.seatId,deviceId:row.deviceId,memoryDomain:row.memoryDomain,qualificationHash:row.qualification.qualificationHash})),unplaced,cairn:{materializations}};
  const planHash=digest(planMaterial);
  return {schema:CAIRN_FABRIC_PLAN_SCHEMA,createdAt:now(),planHash,status:planMaterial.status,evidenceTier:planMaterial.evidenceTier,authority:{state:'NOT_BOUND',authorityNodeId:census.authorityNodeId??null,requirement:'Bind these exact plan intents through the existing governed occurrence, lease, and fence mechanism before preparation.'},topology,assignments,unplaced,candidates:candidateLedger,cairn:{keeper:'CAIRN',materializations,transfers:'NOT_RUN'},execution:'NOT_RUN',claimBoundary:'Aperture routes independent work to qualified native runtime seats. CAIRN materializes admitted artifacts only at selected nodes. Memory domains remain separate; this plan makes no pooled-VRAM or additive-memory claim.'};
}

export function bindCairnFabricOccurrence(plan,occurrence){
  if(plan?.schema!==CAIRN_FABRIC_PLAN_SCHEMA||plan.status!=='READY_TO_PREPARE')throw new ApertureError('CAIRN_FABRIC_HOLD','Only a READY_TO_PREPARE CAIRN Fabric plan can bind to an occurrence.');
  if(typeof occurrence?.id!=='string'||!occurrence.id||typeof occurrence?.fence!=='string'||!occurrence.fence||typeof occurrence?.authorityNodeId!=='string'||!occurrence.authorityNodeId)throw new ApertureError('CAIRN_FABRIC_AUTHORITY','An existing governed occurrence id, fence, and authority node are required.');
  if(occurrence.permissions?.prepare!==true||occurrence.permissions?.materialize!==true||occurrence.permissions?.launch!==true)throw new ApertureError('CAIRN_FABRIC_AUTHORITY','The governed occurrence must explicitly admit preparation, artifact materialization, and launch.');
  if(occurrence.planHash!==plan.planHash)throw new ApertureError('CAIRN_FABRIC_AUTHORITY','The governed occurrence does not bind the exact CAIRN Fabric plan hash.');
  if(plan.authority.authorityNodeId&&occurrence.authorityNodeId!==plan.authority.authorityNodeId)throw new ApertureError('CAIRN_FABRIC_AUTHORITY','The supplied occurrence authority does not match the census authority.');
  return {schema:CAIRN_FABRIC_OCCURRENCE_SCHEMA,createdAt:now(),state:'READY_TO_PREPARE',planHash:plan.planHash,occurrence:{id:occurrence.id,fence:occurrence.fence,authorityNodeId:occurrence.authorityNodeId},planSchema:plan.schema,assignments:plan.assignments.map(row=>({jobId:row.jobId,nodeId:row.nodeId,seatId:row.seatId,deviceId:row.deviceId,memoryDomain:row.memoryDomain,adapterId:row.adapterId,authorization:{schema:'aperture-runtime-authorization/1',adapterId:row.adapterId,seatId:row.seatId,jobId:row.jobId,qualificationHash:row.qualification.qualificationHash,occurrenceId:occurrence.id,fence:occurrence.fence,allowPrepare:true,allowMaterialization:true,allowLaunch:true}})),cairn:plan.cairn,claimBoundary:'This object binds an exact Aperture placement hash to an externally admitted occurrence. It does not create, replace, or extend the estate authority plane.'};
}
