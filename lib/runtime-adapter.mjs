import {createHash} from 'node:crypto';
import {ApertureError,now} from './common.mjs';
import {validateCairnIntents} from './cairn-materialization.mjs';

export const RUNTIME_ADAPTER_SCHEMA='aperture-runtime-adapter/1';
export const RUNTIME_PROBE_SCHEMA='aperture-runtime-probe/1';
export const RUNTIME_FIT_SCHEMA='aperture-runtime-fit/1';
export const RUNTIME_QUALIFICATION_SCHEMA='aperture-runtime-qualification/1';
export const RUNTIME_AUTHORIZATION_SCHEMA='aperture-runtime-authorization/1';
export const RUNTIME_PREPARATION_SCHEMA='aperture-runtime-preparation/1';
export const RUNTIME_LAUNCH_SCHEMA='aperture-runtime-launch/1';
export const RUNTIME_OBSERVATION_SCHEMA='aperture-runtime-observation/1';
export const RUNTIME_STOP_SCHEMA='aperture-runtime-stop/1';
export const RUNTIME_EXECUTION_SCHEMA='aperture-runtime-execution/1';

const METHODS=['probe','fit','prepare','launch','observe','stop'];
const idPattern=/^[a-z0-9][a-z0-9._/-]*$/;
const exactRevision=value=>typeof value==='string'&&/^[0-9a-f]{40}$/i.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,name)=>{
  if(typeof value!=='string'||!value.trim())throw new ApertureError('RUNTIME_ADAPTER_INPUT',`${name} must be a non-empty string.`);
  return value.trim();
};
const holds=value=>{
  if(!Array.isArray(value)||value.some(row=>!object(row)||typeof row.code!=='string'||!row.code||typeof row.message!=='string'||!row.message))
    throw new ApertureError('RUNTIME_ADAPTER_CONTRACT','A HOLD stage must return code/message hold records.');
  return value.map(row=>({code:row.code,message:row.message,evidence:row.evidence??null}));
};
const publicStage=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!key.startsWith('private')));
const adapterRef=adapter=>({id:adapter.id,version:adapter.version,source:adapter.source});
const seatRef=seat=>({id:seat.id,nodeId:seat.nodeId??null,deviceId:seat.deviceId??null,memoryDomain:seat.memoryDomain??seat.device?.memoryDomain??null});
const jobRef=job=>({id:job.id,kind:job.kind??null,modelId:job.model?.id??null});
const canon=value=>Array.isArray(value)?value.map(canon):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canon(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');

export function defineRuntimeAdapter(definition){
  if(!object(definition))throw new ApertureError('RUNTIME_ADAPTER_INPUT','Runtime adapter definition is required.');
  const id=text(definition.id,'Runtime adapter id').toLowerCase();
  if(!idPattern.test(id))throw new ApertureError('RUNTIME_ADAPTER_INPUT','Runtime adapter id must be a stable lowercase path-like identifier.');
  const version=text(definition.version,'Runtime adapter version');
  const source=definition.source;
  if(!object(source)||!exactRevision(source.revision))throw new ApertureError('RUNTIME_ADAPTER_SOURCE','Runtime adapters require an exact 40-hex upstream source revision.');
  const frozenSource=Object.freeze({repository:text(source.repository,'Source repository'),revision:source.revision.toLowerCase(),path:text(source.path,'Source path')});
  for(const method of METHODS)if(typeof definition[method]!=='function')throw new ApertureError('RUNTIME_ADAPTER_METHOD',`Runtime adapter ${id} must implement ${method}().`);
  return Object.freeze({schema:RUNTIME_ADAPTER_SCHEMA,id,version,source:frozenSource,...Object.fromEntries(METHODS.map(method=>[method,definition[method]])),metadata:Object.freeze({...definition.metadata})});
}

export function validateRuntimeAdapter(adapter){
  if(adapter?.schema!==RUNTIME_ADAPTER_SCHEMA||!idPattern.test(adapter.id||'')||!exactRevision(adapter.source?.revision)||METHODS.some(method=>typeof adapter[method]!=='function'))
    throw new ApertureError('RUNTIME_ADAPTER_CONTRACT','A complete aperture-runtime-adapter/1 object is required.');
  return adapter;
}

function validateProbe(value){
  if(value?.schema!==RUNTIME_PROBE_SCHEMA||!['READY','HOLD'].includes(value.state))throw new ApertureError('RUNTIME_ADAPTER_CONTRACT','probe() must return aperture-runtime-probe/1 in READY or HOLD state.');
  if(value.state==='HOLD')holds(value.holds);
  if(value.state==='READY'&&!object(value.facts))throw new ApertureError('RUNTIME_ADAPTER_CONTRACT','A READY probe requires observed facts.');
  return value;
}
function validateFit(value){
  if(value?.schema!==RUNTIME_FIT_SCHEMA||!['FIT','HOLD'].includes(value.state))throw new ApertureError('RUNTIME_ADAPTER_CONTRACT','fit() must return aperture-runtime-fit/1 in FIT or HOLD state.');
  if(value.state==='HOLD')holds(value.holds);
  if(value.state==='FIT'&&(!Number.isFinite(value.score)||value.score<0))throw new ApertureError('RUNTIME_ADAPTER_CONTRACT','A FIT result requires a finite non-negative score.');
  if(value.artifacts!=null&&!Array.isArray(value.artifacts))throw new ApertureError('RUNTIME_ADAPTER_CONTRACT','Runtime fit artifacts must be an array.');
  if(value.state==='FIT'&&value.artifacts?.length)validateCairnIntents(value.artifacts);
  return value;
}
function qualification(adapter,seat,job,state,phase,probe,fit,stageHolds=[]){
  const material={state,phase,adapter:adapterRef(adapter),seat:seatRef(seat),job:jobRef(job),score:state==='QUALIFIED'?fit.score:0,artifacts:state==='QUALIFIED'?[...(fit.artifacts||[])]:[],probe:probe?publicStage(probe):null,fit:fit?publicStage(fit):null,holds:stageHolds};
  return {schema:RUNTIME_QUALIFICATION_SCHEMA,createdAt:now(),...material,qualificationHash:digest(material)};
}

export async function qualifyRuntimeCandidate(adapter,{seat,job}){
  validateRuntimeAdapter(adapter);
  if(!object(seat)||typeof seat.id!=='string'||!seat.id)throw new ApertureError('RUNTIME_SEAT','Runtime qualification requires a stable seat id.');
  if(!object(job)||typeof job.id!=='string'||!job.id||!object(job.model)||typeof job.model.id!=='string'||!job.model.id)throw new ApertureError('RUNTIME_JOB','Runtime qualification requires a stable job id and model id.');
  const probe=validateProbe(await adapter.probe({seat,job}));
  if(probe.state==='HOLD')return qualification(adapter,seat,job,'HOLD','PROBE',probe,null,holds(probe.holds));
  const fit=validateFit(await adapter.fit({seat,job,probe}));
  if(fit.state==='HOLD')return qualification(adapter,seat,job,'HOLD','FIT',probe,fit,holds(fit.holds));
  return qualification(adapter,seat,job,'QUALIFIED','FIT',probe,fit,[]);
}

function validateAuthorization(authorization,qualification){
  if(authorization?.schema!==RUNTIME_AUTHORIZATION_SCHEMA)throw new ApertureError('RUNTIME_AUTHORIZATION','Execution requires aperture-runtime-authorization/1.');
  for(const [key,expected] of [['adapterId',qualification.adapter.id],['seatId',qualification.seat.id],['jobId',qualification.job.id],['qualificationHash',qualification.qualificationHash]])
    if(authorization[key]!==expected)throw new ApertureError('RUNTIME_AUTHORIZATION',`${key} does not match the qualified runtime candidate.`);
  if(typeof authorization.occurrenceId!=='string'||!authorization.occurrenceId||typeof authorization.fence!=='string'||!authorization.fence)
    throw new ApertureError('RUNTIME_AUTHORIZATION','Execution authority requires an occurrence id and fence.');
  if(authorization.allowPrepare!==true||authorization.allowLaunch!==true)throw new ApertureError('RUNTIME_AUTHORIZATION','Execution authority must explicitly admit preparation and launch.');
  if(qualification.artifacts.length&&authorization.allowMaterialization!==true)throw new ApertureError('RUNTIME_AUTHORIZATION','Artifact materialization requires explicit authority.');
  return authorization;
}
function validatePreparation(value){
  if(value?.schema!==RUNTIME_PREPARATION_SCHEMA||!['READY','HOLD'].includes(value.state))throw new ApertureError('RUNTIME_ADAPTER_CONTRACT','prepare() must return aperture-runtime-preparation/1 in READY or HOLD state.');
  if(value.state==='HOLD')holds(value.holds);
  return value;
}
function validateLaunch(value){
  if(value?.schema!==RUNTIME_LAUNCH_SCHEMA||!['RUNNING','HOLD'].includes(value.state))throw new ApertureError('RUNTIME_ADAPTER_CONTRACT','launch() must return aperture-runtime-launch/1 in RUNNING or HOLD state.');
  if(value.state==='HOLD')holds(value.holds);
  if(value.state==='RUNNING'&&(typeof value.handleRef!=='string'||!value.handleRef))throw new ApertureError('RUNTIME_ADAPTER_CONTRACT','A RUNNING launch requires a public handleRef.');
  return value;
}
function validateObservation(value){
  if(value?.schema!==RUNTIME_OBSERVATION_SCHEMA||!['PASS','RUNNING','HOLD','FAIL'].includes(value.state))throw new ApertureError('RUNTIME_ADAPTER_CONTRACT','observe() must return aperture-runtime-observation/1 in PASS, RUNNING, HOLD, or FAIL state.');
  if(value.state==='HOLD')holds(value.holds);
  return value;
}
function validateStop(value){
  if(value?.schema!==RUNTIME_STOP_SCHEMA||!['STOPPED','HOLD','FAIL'].includes(value.state))throw new ApertureError('RUNTIME_ADAPTER_CONTRACT','stop() must return aperture-runtime-stop/1 in STOPPED, HOLD, or FAIL state.');
  if(value.state==='HOLD')holds(value.holds);
  return value;
}
const failure=error=>({code:error?.code||'RUNTIME_FAILURE',message:String(error?.message||error)});

export async function executeRuntimeQualification(adapter,qualification,{authorization}){
  validateRuntimeAdapter(adapter);
  if(qualification?.schema!==RUNTIME_QUALIFICATION_SCHEMA||qualification.state!=='QUALIFIED')throw new ApertureError('RUNTIME_QUALIFICATION','Only a QUALIFIED runtime candidate can execute.');
  if(qualification.adapter.id!==adapter.id||qualification.adapter.version!==adapter.version)throw new ApertureError('RUNTIME_QUALIFICATION','The executing adapter does not match the qualification receipt.');
  validateAuthorization(authorization,qualification);
  const receipt={schema:RUNTIME_EXECUTION_SCHEMA,createdAt:now(),state:'PREPARING',adapter:qualification.adapter,seat:qualification.seat,job:qualification.job,occurrence:{id:authorization.occurrenceId,fence:authorization.fence},qualification,preparation:null,launch:null,observation:null,cleanup:null,failure:null,claimBoundary:'Qualification is read-only. Preparation, launch, observation, and cleanup occur only under the recorded occurrence fence.'};
  let prepared=null,launched=null,operationalFailure=null;
  try{
    prepared=validatePreparation(await adapter.prepare({qualification,authorization}));
    receipt.preparation=publicStage(prepared);
    if(prepared.state==='HOLD'){receipt.state='HOLD_PREPARATION';return receipt;}
    receipt.state='LAUNCHING';
    launched=validateLaunch(await adapter.launch({qualification,authorization,preparation:prepared}));
    receipt.launch=publicStage(launched);
    if(launched.state==='HOLD'){receipt.state='HOLD_LAUNCH';return receipt;}
    receipt.state='OBSERVING';
    const observation=validateObservation(await adapter.observe({qualification,authorization,preparation:prepared,launch:launched}));
    receipt.observation=publicStage(observation);
    receipt.state=observation.state==='PASS'||observation.state==='RUNNING'?'PASS':observation.state==='HOLD'?'HOLD_RUNTIME':'FAIL_RUNTIME';
  }catch(error){operationalFailure=error;receipt.failure=failure(error);receipt.state='FAIL_RUNTIME';}
  finally{
    if(launched?.state==='RUNNING'){
      try{
        const stopped=validateStop(await adapter.stop({qualification,authorization,preparation:prepared,launch:launched,failure:operationalFailure}));
        receipt.cleanup=publicStage(stopped);
        if(stopped.state!=='STOPPED')receipt.state='FAIL_CLEANUP';
      }catch(error){receipt.cleanup={schema:RUNTIME_STOP_SCHEMA,state:'FAIL',failure:failure(error)};receipt.state='FAIL_CLEANUP';}
    }
  }
  return receipt;
}
