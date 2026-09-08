import {ApertureError} from '../common.mjs';
import {defineRuntimeAdapter,RUNTIME_PROBE_SCHEMA,RUNTIME_FIT_SCHEMA,RUNTIME_PREPARATION_SCHEMA,RUNTIME_LAUNCH_SCHEMA,RUNTIME_OBSERVATION_SCHEMA,RUNTIME_STOP_SCHEMA} from '../runtime-adapter.mjs';
import {CAIRN_MATERIALIZATION_SCHEMA,validateCairnMaterialization,publicCairnArtifacts} from '../cairn-materialization.mjs';

export const SGLANG_MINICPM5_SOURCE=Object.freeze({repository:'sgl-project/sglang',revision:'2bf04f3a67edf5f1c43b4f00761f19758346dcf7',path:'docs/src/snippets/configs/openbmb/minicpm5-2b.jsx'});
export const SGLANG_MINICPM5_MODEL='openbmb/MiniCPM5-2B';
export const SGLANG_MINICPM5_DRAFT='openbmb/MiniCPM5-2B-DSpark';
const ADAPTER_ID='sglang/minicpm5-2b-dspark';
const hold=(schema,code,message,evidence=null)=>({schema,state:'HOLD',holds:[{code,message,evidence}]});
const exact40=value=>typeof value==='string'&&/^[0-9a-f]{40}$/i.test(value);
const integer=(value,name,min=1,max=65535)=>{
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new ApertureError('SGLANG_INPUT',`${name} must be an integer from ${min} through ${max}.`);
  return value;
};
const normalized=value=>String(value||'').toLowerCase().replace(/\bnvidia\b/g,'').replace(/\bgeforce\b/g,'').replace(/\s+/g,' ').trim();
const observation=(seat,live={})=>({
  state:live.state??seat.state,
  platform:live.platform??seat.platform,
  architecture:live.architecture??seat.architecture,
  productName:live.productName??seat.productName??'',
  runtime:{...(seat.runtime||{}),...(live.runtime||{})},
  device:{...(seat.device||{}),...(live.device||{})},
  observedAt:live.observedAt??seat.observedAt??null
});
function verifiedPlatform(facts){
  const device=normalized(facts.device.name),product=normalized(facts.productName);
  if(/\brtx 5090\b/.test(device)&&!device.includes('laptop'))return {id:'rtx-5090',rank:300};
  if(/\brtx pro 6000\b/.test(device))return {id:'rtx-pro-6000',rank:350};
  if(/\bh200\b/.test(device))return {id:'h200',rank:400};
  if(product.includes('dgx spark')||device.includes('gb10'))return {id:'dgx-spark',rank:250};
  return null;
}
function platformEvidence(job,seat){
  const evidence=job.platformEvidence;
  return evidence?.schema==='aperture-runtime-platform-evidence/1'&&evidence.state==='PASS'&&evidence.adapterId===ADAPTER_ID&&evidence.seatId===seat.id&&evidence.sourceRevision===SGLANG_MINICPM5_SOURCE.revision&&typeof evidence.receiptSha256==='string'&&/^[0-9a-f]{64}$/i.test(evidence.receiptSha256)?evidence:null;
}
const privateArtifact=(preparation,role)=>preparation.privateMaterialization?.artifacts?.find(artifact=>artifact.role===role);

export function makeSglangMiniCpm5Adapter({driver={}}={}){
  return defineRuntimeAdapter({
    id:ADAPTER_ID,
    version:'1',
    source:SGLANG_MINICPM5_SOURCE,
    metadata:{runtime:'SGLang',model:SGLANG_MINICPM5_MODEL,speculativeAlgorithm:'DSPARK',evidence:'official verified recipe'},
    async probe({seat,job}){
      const live=typeof driver.probeSeat==='function'?await driver.probeSeat({seat,job}):{},facts=observation(seat,live);
      const failures=[];
      if(!['READY','IDLE'].includes(facts.state))failures.push({code:'SEAT_STATE',message:'The seat is not in READY or IDLE state.'});
      if(String(facts.platform).toLowerCase()!=='linux')failures.push({code:'PLATFORM',message:'The pinned SGLang recipe requires a Linux seat.'});
      if(String(facts.device.kind).toLowerCase()!=='nvidia')failures.push({code:'ACCELERATOR',message:'The pinned SGLang recipe requires an NVIDIA CUDA accelerator.'});
      if(facts.device.externalGate)failures.push({code:'EXTERNAL_GATE',message:'The accelerator retains an unresolved external capacity gate.'});
      if(facts.runtime.cuda?.available!==true)failures.push({code:'CUDA',message:'Current CUDA availability was not observed.'});
      if(facts.runtime.sglang?.serve!==true||typeof facts.runtime.sglang?.identity!=='string'||!facts.runtime.sglang.identity)failures.push({code:'SGLANG',message:'Current SGLang serve capability and build identity were not observed.'});
      if(facts.runtime.sglang?.revision!==SGLANG_MINICPM5_SOURCE.revision)failures.push({code:'SGLANG_REVISION',message:'The observed SGLang runtime does not match the source-pinned recipe revision.'});
      if(!Number.isSafeInteger(facts.device.freeBytes)||facts.device.freeBytes<1)failures.push({code:'CAPACITY',message:'Current free accelerator bytes were not observed.'});
      if(failures.length)return {schema:RUNTIME_PROBE_SCHEMA,state:'HOLD',holds:failures};
      return {schema:RUNTIME_PROBE_SCHEMA,state:'READY',facts:{platform:facts.platform,architecture:facts.architecture,productName:facts.productName,observedAt:facts.observedAt,runtime:{cuda:facts.runtime.cuda,sglang:facts.runtime.sglang},device:{kind:facts.device.kind,name:facts.device.name,totalBytes:facts.device.totalBytes??null,freeBytes:facts.device.freeBytes,computeCapability:facts.device.computeCapability??null,memoryDomain:facts.device.memoryDomain??seat.memoryDomain??null}}};
    },
    async fit({seat,job,probe}){
      const failures=[];
      if(job.kind!=='inference-service')failures.push({code:'JOB_KIND',message:'This adapter serves inference-service jobs.'});
      if(job.model.id!==SGLANG_MINICPM5_MODEL)failures.push({code:'MODEL',message:`This adapter is pinned to ${SGLANG_MINICPM5_MODEL}.`});
      if(job.model.quantization!=null&&String(job.model.quantization).toUpperCase()!=='BF16')failures.push({code:'QUANTIZATION',message:'The pinned upstream recipe is BF16.'});
      if(job.speculative?.algorithm!=null&&String(job.speculative.algorithm).toUpperCase()!=='DSPARK')failures.push({code:'SPECULATIVE',message:'The pinned upstream recipe uses DSPARK.'});
      if(job.policy?.allowRemoteCode!==true)failures.push({code:'REMOTE_CODE_CONSENT',message:'The upstream recipe requires --trust-remote-code; the job must admit it explicitly.'});
      const platform=verifiedPlatform(probe.facts),localEvidence=platformEvidence(job,seat);
      if(!platform&&!localEvidence)failures.push({code:'UNVERIFIED_PLATFORM',message:'The seat is outside the upstream verified platform set and has no exact local qualification receipt.',evidence:{verifiedPlatforms:['H200','RTX 5090','RTX PRO 6000','DGX Spark'],source:SGLANG_MINICPM5_SOURCE}});
      const host=job.service?.host??'127.0.0.1',port=integer(job.service?.port??30000,'SGLang port');
      const loopback=['127.0.0.1','::1','localhost'].includes(String(host).toLowerCase());
      if(!loopback&&(job.policy?.allowLanBind!==true||job.policy?.networkScope!=='private-lan'))failures.push({code:'NETWORK_AUTHORIZATION',message:'Non-loopback serving requires explicit private-LAN bind authority.'});
      if(job.distribution?.nodes!=null&&job.distribution.nodes!==1)failures.push({code:'DISTRIBUTION',message:'The pinned recipe is single-node.'});
      if(failures.length)return {schema:RUNTIME_FIT_SCHEMA,state:'HOLD',holds:failures};
      const artifacts=[
        {role:'target-model',locator:`hf://${SGLANG_MINICPM5_MODEL}`,revision:null,revisionPolicy:'RESOLVE_EXACT_BEFORE_PREPARE'},
        {role:'draft-model',locator:`hf://${SGLANG_MINICPM5_DRAFT}`,revision:null,revisionPolicy:'RESOLVE_EXACT_BEFORE_PREPARE'}
      ];
      const argvTemplate=['serve','--model-path','<CAIRN:target-model>','--reasoning-parser','qwen3','--tool-call-parser','minicpm5','--mem-fraction-static','0.75','--cuda-graph-max-bs','128','--host',host,'--port',String(port),'--trust-remote-code','--speculative-algorithm','DSPARK','--speculative-draft-model-path','<CAIRN:draft-model>','--speculative-dspark-block-size','7'];
      return {schema:RUNTIME_FIT_SCHEMA,state:'FIT',score:(platform?.rank??200)+Math.min(99,Math.floor(probe.facts.device.freeBytes/2**30)),artifacts,endpoint:{host,port,scope:loopback?'loopback':'private-lan'},recipe:{executable:'sglang',argvTemplate},evidence:{tier:localEvidence?'LOCAL_QUALIFICATION_RECEIPT':'UPSTREAM_VERIFIED_PLATFORM',platform:platform?.id??'locally-qualified',source:SGLANG_MINICPM5_SOURCE,capacityClaim:'Current free bytes are retained; no undocumented minimum-VRAM threshold is inferred.'}};
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
      if(typeof driver.launch!=='function')return hold(RUNTIME_LAUNCH_SCHEMA,'RUNTIME_DRIVER','No SGLang launch driver is bound.');
      const target=privateArtifact(preparation,'target-model'),draft=privateArtifact(preparation,'draft-model');
      if(!target||!draft)throw new ApertureError('SGLANG_ARTIFACT','Prepared target and draft artifacts are required.');
      const endpoint=qualification.fit.endpoint;
      const command={executable:'sglang',argv:['serve','--model-path',target.privatePath,'--reasoning-parser','qwen3','--tool-call-parser','minicpm5','--mem-fraction-static','0.75','--cuda-graph-max-bs','128','--host',endpoint.host,'--port',String(endpoint.port),'--trust-remote-code','--speculative-algorithm','DSPARK','--speculative-draft-model-path',draft.privatePath,'--speculative-dspark-block-size','7'],shell:false};
      const result=await driver.launch({command,qualification,authorization,preparation});
      if(result?.state==='HOLD')return {schema:RUNTIME_LAUNCH_SCHEMA,state:'HOLD',holds:result.holds||[{code:'LAUNCH_HOLD',message:'SGLang launch was held by the execution driver.'}]};
      if(result?.state!=='RUNNING'||typeof result.handleRef!=='string'||!result.handleRef)throw new ApertureError('SGLANG_LAUNCH','The SGLang driver did not return a running handle.');
      return {schema:RUNTIME_LAUNCH_SCHEMA,state:'RUNNING',handleRef:result.handleRef,endpoint:result.endpoint??endpoint,command:{executable:command.executable,argv:command.argv.map((value,index,array)=>index>0&&['--model-path','--speculative-draft-model-path'].includes(array[index-1])?'<CAIRN_LOCAL_PATH>':value),shell:false},privateHandle:result.privateHandle??result.handleRef};
    },
    async observe({qualification,authorization,preparation,launch}){
      if(typeof driver.observe!=='function')return hold(RUNTIME_OBSERVATION_SCHEMA,'RUNTIME_DRIVER','No SGLang observation driver is bound.');
      const result=await driver.observe({qualification,authorization,preparation,launch,privateHandle:launch.privateHandle});
      if(result?.state==='HOLD')return {schema:RUNTIME_OBSERVATION_SCHEMA,state:'HOLD',holds:result.holds||[{code:'OBSERVATION_HOLD',message:'SGLang readiness remained unresolved.'}]};
      if(result?.state==='FAIL')return {schema:RUNTIME_OBSERVATION_SCHEMA,state:'FAIL',failure:result.failure??null};
      if(result?.state!=='PASS'&&result?.state!=='RUNNING')throw new ApertureError('SGLANG_OBSERVE','The SGLang driver returned no admissible observation.');
      return {schema:RUNTIME_OBSERVATION_SCHEMA,state:result.state,endpoint:result.endpoint??launch.endpoint,metrics:result.metrics??null};
    },
    async stop({qualification,authorization,preparation,launch,failure}){
      if(typeof driver.stop!=='function')return {schema:RUNTIME_STOP_SCHEMA,state:'FAIL',failure:{code:'RUNTIME_DRIVER',message:'No SGLang cleanup driver is bound.'}};
      const result=await driver.stop({qualification,authorization,preparation,launch,failure,privateHandle:launch.privateHandle});
      if(result?.state!=='STOPPED')return {schema:RUNTIME_STOP_SCHEMA,state:result?.state==='HOLD'?'HOLD':'FAIL',holds:result?.holds??undefined,failure:result?.failure??null};
      return {schema:RUNTIME_STOP_SCHEMA,state:'STOPPED',handleRef:launch.handleRef,observedAt:result.observedAt??null};
    }
  });
}
