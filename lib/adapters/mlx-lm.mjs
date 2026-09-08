import {ApertureError} from '../common.mjs';
import {defineRuntimeAdapter,RUNTIME_PROBE_SCHEMA,RUNTIME_FIT_SCHEMA,RUNTIME_PREPARATION_SCHEMA,RUNTIME_LAUNCH_SCHEMA,RUNTIME_OBSERVATION_SCHEMA,RUNTIME_STOP_SCHEMA} from '../runtime-adapter.mjs';
import {CAIRN_MATERIALIZATION_SCHEMA,validateCairnMaterialization,publicCairnArtifacts} from '../cairn-materialization.mjs';

export const MLX_LM_SOURCE=Object.freeze({repository:'ml-explore/mlx-lm',revision:'7fb4be44d560e5b74595210f83cb6003a57e52a7',path:'mlx_lm/server.py'});
const ADAPTER_ID='mlx-lm/server';
const hold=(schema,code,message,evidence=null)=>({schema,state:'HOLD',holds:[{code,message,evidence}]});
const integer=(value,name,min=1,max=65535)=>{
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new ApertureError('MLX_INPUT',`${name} must be an integer from ${min} through ${max}.`);
  return value;
};
const observation=(seat,live={})=>({
  state:live.state??seat.state,
  platform:live.platform??seat.platform,
  architecture:live.architecture??seat.architecture,
  runtime:{...(seat.runtime||{}),...(live.runtime||{})},
  device:{...(seat.device||{}),...(live.device||{})},
  memory:{...(seat.memory||{}),...(live.memory||{})},
  observedAt:live.observedAt??seat.observedAt??null
});
function fitEvidence(job,seat){
  const evidence=job.fitEvidence;
  if(evidence?.schema!=='aperture-runtime-fit-evidence/1'||evidence.state!=='FIT'||evidence.adapterId!==ADAPTER_ID||evidence.seatId!==seat.id||evidence.modelId!==job.model.id||evidence.sourceRevision!==MLX_LM_SOURCE.revision)return null;
  if(!Number.isSafeInteger(evidence.workingSetBytes)||evidence.workingSetBytes<1||typeof evidence.receiptSha256!=='string'||!/^[0-9a-f]{64}$/i.test(evidence.receiptSha256))return null;
  if(evidence.basis==='synthetic-fixture'&&job.fixture!==true)return null;
  if(!['measured','runtime-estimator','synthetic-fixture'].includes(evidence.basis))return null;
  return evidence;
}
const privateArtifact=preparation=>preparation.privateMaterialization?.artifacts?.find(artifact=>artifact.role==='target-model');

export function makeMlxLmServerAdapter({driver={}}={}){
  return defineRuntimeAdapter({
    id:ADAPTER_ID,
    version:'1',
    source:MLX_LM_SOURCE,
    metadata:{runtime:'MLX-LM',surface:'OpenAI-compatible HTTP server',evidence:'official server implementation'},
    async probe({seat,job}){
      const live=typeof driver.probeSeat==='function'?await driver.probeSeat({seat,job}):{},facts=observation(seat,live),failures=[];
      if(!['READY','IDLE'].includes(facts.state))failures.push({code:'SEAT_STATE',message:'The seat is not in READY or IDLE state.'});
      if(String(facts.platform).toLowerCase()!=='darwin'||String(facts.architecture).toLowerCase()!=='arm64')failures.push({code:'PLATFORM',message:'MLX-LM requires an Apple-silicon macOS seat.'});
      if(!['metal','apple'].includes(String(facts.device.kind).toLowerCase()))failures.push({code:'ACCELERATOR',message:'The seat does not expose an Apple Metal execution device.'});
      if(facts.runtime.mlxLm?.server!==true||typeof facts.runtime.mlxLm?.identity!=='string'||!facts.runtime.mlxLm.identity)failures.push({code:'MLX_LM',message:'Current mlx_lm.server capability and package identity were not observed.'});
      if(facts.runtime.mlxLm?.revision!==MLX_LM_SOURCE.revision)failures.push({code:'MLX_LM_REVISION',message:'The observed MLX-LM runtime does not match the source-pinned server revision.'});
      if(facts.runtime.metal?.available!==true)failures.push({code:'METAL',message:'Current Metal availability was not observed.'});
      const headroom=facts.memory.allocationHeadroomBytes??facts.device.freeBytes;
      if(!Number.isSafeInteger(headroom)||headroom<1)failures.push({code:'CAPACITY',message:'Current unified-memory allocation headroom was not observed.'});
      if(failures.length)return {schema:RUNTIME_PROBE_SCHEMA,state:'HOLD',holds:failures};
      return {schema:RUNTIME_PROBE_SCHEMA,state:'READY',facts:{platform:facts.platform,architecture:facts.architecture,observedAt:facts.observedAt,runtime:{mlxLm:facts.runtime.mlxLm,metal:facts.runtime.metal},device:{kind:facts.device.kind,name:facts.device.name,memoryDomain:facts.device.memoryDomain??seat.memoryDomain??null},memory:{allocationHeadroomBytes:headroom,physicalBytes:facts.memory.physicalBytes??facts.device.totalBytes??null,domain:'unified'}}};
    },
    async fit({seat,job,probe}){
      const failures=[];
      if(job.kind!=='inference-service')failures.push({code:'JOB_KIND',message:'This adapter serves inference-service jobs.'});
      if(job.model.format!=='mlx')failures.push({code:'MODEL_FORMAT',message:'The model must be an admitted MLX artifact.'});
      const evidence=fitEvidence(job,seat);
      if(!evidence)failures.push({code:'FIT_EVIDENCE',message:'MLX placement requires an exact seat- and model-bound fit receipt; unified memory is not inferred from nominal capacity.'});
      if(evidence&&evidence.workingSetBytes>probe.facts.memory.allocationHeadroomBytes)failures.push({code:'HEADROOM',message:`The admitted ${evidence.workingSetBytes}-byte working set exceeds the current ${probe.facts.memory.allocationHeadroomBytes}-byte unified-memory headroom.`});
      const host=job.service?.host??'127.0.0.1',port=integer(job.service?.port??8080,'MLX-LM port');
      const loopback=['127.0.0.1','::1','localhost'].includes(String(host).toLowerCase());
      const origins=job.service?.allowedOrigins??[];
      if(!loopback&&(job.policy?.allowLanBind!==true||job.policy?.networkScope!=='private-lan'))failures.push({code:'NETWORK_AUTHORIZATION',message:'Non-loopback serving requires explicit private-LAN bind authority.'});
      if(!loopback&&(!Array.isArray(origins)||!origins.length||origins.includes('*')))failures.push({code:'ORIGIN_POLICY',message:'Private-LAN serving requires an explicit non-wildcard origin allowlist.'});
      if(job.policy?.allowRemoteCode===true&&!/^[0-9a-f]{64}$/i.test(job.policy?.remoteCodeReceiptSha256||''))failures.push({code:'REMOTE_CODE_RECEIPT',message:'Remote-code execution requires an exact reviewed-source SHA-256 receipt.'});
      if(failures.length)return {schema:RUNTIME_FIT_SCHEMA,state:'HOLD',holds:failures};
      const artifacts=[{role:'target-model',locator:job.model.locator??`hf://${job.model.id}`,revision:job.model.revision??null,revisionPolicy:job.model.revision?'PINNED':'RESOLVE_EXACT_BEFORE_PREPARE'}];
      const argvTemplate=['--model','<CAIRN:target-model>','--host',host,'--port',String(port)];
      if(!loopback)argvTemplate.push('--allowed-origins',origins.join(','));
      if(job.policy?.allowRemoteCode===true)argvTemplate.push('--trust-remote-code');
      const spare=probe.facts.memory.allocationHeadroomBytes-evidence.workingSetBytes;
      return {schema:RUNTIME_FIT_SCHEMA,state:'FIT',score:200+Math.min(99,Math.floor(spare/2**30)),artifacts,endpoint:{host,port,scope:loopback?'loopback':'private-lan'},recipe:{executable:'mlx_lm.server',argvTemplate},evidence:{tier:'EXACT_RUNTIME_FIT_RECEIPT',receiptSha256:evidence.receiptSha256,basis:evidence.basis,workingSetBytes:evidence.workingSetBytes,currentHeadroomBytes:probe.facts.memory.allocationHeadroomBytes,source:MLX_LM_SOURCE,capacityClaim:'The admitted working set is compared against current unified-memory headroom; GPU and RAM are one domain.'}};
    },
    async prepare({qualification,authorization}){
      if(typeof driver.prepareArtifacts!=='function')return hold(RUNTIME_PREPARATION_SCHEMA,'CAIRN_DRIVER','No CAIRN materialization driver is bound.');
      const result=await driver.prepareArtifacts({intents:qualification.artifacts,qualification,authorization});
      if(result?.schema!==CAIRN_MATERIALIZATION_SCHEMA)return hold(RUNTIME_PREPARATION_SCHEMA,'CAIRN_CONTRACT','The materializer did not return aperture-cairn-materialization/1.');
      const materialization=validateCairnMaterialization(result,qualification.artifacts);
      if(materialization.state==='HOLD')return {schema:RUNTIME_PREPARATION_SCHEMA,state:'HOLD',holds:materialization.holds};
      return {schema:RUNTIME_PREPARATION_SCHEMA,state:'READY',artifacts:publicCairnArtifacts(materialization),privateMaterialization:materialization};
    },
    async launch({qualification,authorization,preparation}){
      if(typeof driver.launch!=='function')return hold(RUNTIME_LAUNCH_SCHEMA,'RUNTIME_DRIVER','No MLX-LM launch driver is bound.');
      const target=privateArtifact(preparation);
      if(!target)throw new ApertureError('MLX_ARTIFACT','A prepared target-model artifact is required.');
      const endpoint=qualification.fit.endpoint,template=qualification.fit.recipe.argvTemplate;
      const argv=template.map(value=>value==='<CAIRN:target-model>'?target.privatePath:value);
      const command={executable:'mlx_lm.server',argv,shell:false};
      const result=await driver.launch({command,qualification,authorization,preparation});
      if(result?.state==='HOLD')return {schema:RUNTIME_LAUNCH_SCHEMA,state:'HOLD',holds:result.holds||[{code:'LAUNCH_HOLD',message:'MLX-LM launch was held by the execution driver.'}]};
      if(result?.state!=='RUNNING'||typeof result.handleRef!=='string'||!result.handleRef)throw new ApertureError('MLX_LAUNCH','The MLX-LM driver did not return a running handle.');
      return {schema:RUNTIME_LAUNCH_SCHEMA,state:'RUNNING',handleRef:result.handleRef,endpoint:result.endpoint??endpoint,command:{executable:command.executable,argv:command.argv.map((value,index,array)=>index>0&&array[index-1]==='--model'?'<CAIRN_LOCAL_PATH>':value),shell:false},privateHandle:result.privateHandle??result.handleRef};
    },
    async observe({qualification,authorization,preparation,launch}){
      if(typeof driver.observe!=='function')return hold(RUNTIME_OBSERVATION_SCHEMA,'RUNTIME_DRIVER','No MLX-LM observation driver is bound.');
      const result=await driver.observe({qualification,authorization,preparation,launch,privateHandle:launch.privateHandle});
      if(result?.state==='HOLD')return {schema:RUNTIME_OBSERVATION_SCHEMA,state:'HOLD',holds:result.holds||[{code:'OBSERVATION_HOLD',message:'MLX-LM readiness remained unresolved.'}]};
      if(result?.state==='FAIL')return {schema:RUNTIME_OBSERVATION_SCHEMA,state:'FAIL',failure:result.failure??null};
      if(result?.state!=='PASS'&&result?.state!=='RUNNING')throw new ApertureError('MLX_OBSERVE','The MLX-LM driver returned no admissible observation.');
      return {schema:RUNTIME_OBSERVATION_SCHEMA,state:result.state,endpoint:result.endpoint??launch.endpoint,metrics:result.metrics??null};
    },
    async stop({qualification,authorization,preparation,launch,failure}){
      if(typeof driver.stop!=='function')return {schema:RUNTIME_STOP_SCHEMA,state:'FAIL',failure:{code:'RUNTIME_DRIVER',message:'No MLX-LM cleanup driver is bound.'}};
      const result=await driver.stop({qualification,authorization,preparation,launch,failure,privateHandle:launch.privateHandle});
      if(result?.state!=='STOPPED')return {schema:RUNTIME_STOP_SCHEMA,state:result?.state==='HOLD'?'HOLD':'FAIL',holds:result?.holds??undefined,failure:result?.failure??null};
      return {schema:RUNTIME_STOP_SCHEMA,state:'STOPPED',handleRef:launch.handleRef,observedAt:result.observedAt??null};
    }
  });
}
