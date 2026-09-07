import {createHash} from 'node:crypto';
import {ApertureError,GiB,now} from './common.mjs';

const integer=(value,name)=>{
  if(!Number.isSafeInteger(value)||value<0)throw new ApertureError('FABRIC_INPUT',`${name} must be a non-negative safe integer.`);
  return value;
};
const sha=value=>typeof value==='string'&&/^[0-9a-f]{64}$/i.test(value);
const canon=value=>{
  if(Array.isArray(value))return value.map(canon);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canon(value[key])]));
  return value;
};
const digest=value=>createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');
const fail=(code,message,holds)=>holds.push({code,message});
export const canonicalGpuModel=value=>String(value||'').toLowerCase().replace(/\bnvidia\b/g,'').replace(/\bgeforce\b/g,'').replace(/\s+/g,' ').trim();

export function validateFabricCensus(census){
  if(census?.schema!=='aperture-fabric-census/1'||!Array.isArray(census.nodes)||!census.nodes.length)throw new ApertureError('FABRIC_CENSUS','A fabric census with at least one node is required.');
  if(typeof census.authorityNodeId!=='string'||!census.nodes.some(node=>node.id===census.authorityNodeId))throw new ApertureError('FABRIC_AUTHORITY','The fabric census must identify one authority node contained in the census.');
  const nodes=new Set(),domains=new Set();
  for(const node of census.nodes){
    if(typeof node.id!=='string'||!node.id||nodes.has(node.id))throw new ApertureError('FABRIC_NODE','Fabric node identities must be unique non-empty strings.');
    nodes.add(node.id);
    integer(node.memory?.allocationHeadroomBytes??0,`Node ${node.id} allocation headroom`);
    for(const device of node.devices||[]){
      if(typeof device.id!=='string'||!device.id)throw new ApertureError('FABRIC_DEVICE','Fabric devices require node-local identities.');
      if(typeof device.memoryDomain!=='string'||!device.memoryDomain||domains.has(device.memoryDomain))throw new ApertureError('FABRIC_DOMAIN','Every accelerator must retain one unique physical memory domain.');
      domains.add(device.memoryDomain);
      integer(device.totalBytes,`Device ${device.id} physical memory`);integer(device.freeBytes,`Device ${device.id} free memory`);
      if(device.freeBytes>device.totalBytes)throw new ApertureError('FABRIC_MEMORY','Free accelerator memory cannot exceed physical memory.');
    }
  }
  return census;
}

export function validateFabricModel(model){
  integer(model?.bytes,'Model bytes');
  if(model.bytes<1)throw new ApertureError('FABRIC_MODEL','The exact admitted model byte count is required before placement.');
  if(!Array.isArray(model.files)||!model.files.length||model.files.some(file=>!sha(file.sha256)))throw new ApertureError('FABRIC_MODEL','Every admitted model file requires an exact SHA-256.');
  return model;
}

function adapterFor(census,name){return (census.adapters||[]).find(adapter=>adapter.name===name&&adapter.state==='QUALIFIED')||null;}

export function makeFabricPlan(census,model,policy={}){
  validateFabricCensus(census);validateFabricModel(model);
  const holds=[],authority=census.nodes.find(node=>node.id===census.authorityNodeId);
  const requiredGpuCount=policy.gpuCount??1;
  if(!Number.isSafeInteger(requiredGpuCount)||requiredGpuCount<1)throw new ApertureError('FABRIC_POLICY','gpuCount must be a positive integer.');
  if(policy.deviceModel!=null&&(typeof policy.deviceModel!=='string'||!canonicalGpuModel(policy.deviceModel)))throw new ApertureError('FABRIC_POLICY','deviceModel must be a non-empty canonical GPU model when supplied.');
  const requiredModel=policy.deviceModel?canonicalGpuModel(policy.deviceModel):null;
  const reservePerGpuBytes=policy.reservePerGpuBytes??2*GiB,hostReserveBytes=policy.hostReserveBytes??4*GiB;
  integer(reservePerGpuBytes,'GPU reserve');integer(hostReserveBytes,'Host reserve');
  const eligible=[];
  for(const node of census.nodes){
    if(node.state!=='READY'&&node.state!=='IDLE')continue;
    for(const device of node.devices||[]){
      if(String(device.kind||'').toLowerCase()!=='nvidia'||device.externalGate)continue;
      const canonicalModel=canonicalGpuModel(device.name);
      if(requiredModel&&canonicalModel!==requiredModel)continue;
      const usable=Math.max(0,Math.min(device.freeBytes,device.totalBytes)-reservePerGpuBytes);
      eligible.push({nodeId:node.id,deviceId:device.id,memoryDomain:device.memoryDomain,name:device.name,canonicalModel,totalBytes:device.totalBytes,freeBytes:device.freeBytes,usableBytes:usable,computeCapability:device.computeCapability??null,link:device.link??null});
    }
  }
  eligible.sort((a,b)=>b.usableBytes-a.usableBytes||a.nodeId.localeCompare(b.nodeId)||a.deviceId.localeCompare(b.deviceId));
  const selector=requiredModel?` matching canonical model ${policy.deviceModel}`:'';
  if(eligible.length<requiredGpuCount)fail('GPU_COUNT',`Requires ${requiredGpuCount} admitted NVIDIA memory domains${selector}; ${eligible.length} are presently eligible.`,holds);
  const selected=eligible.slice(0,requiredGpuCount);
  if(policy.homogeneous===true&&selected.length===requiredGpuCount){
    const cohorts=new Set(selected.map(row=>`${row.canonicalModel}|${row.totalBytes}|${row.computeCapability??'unknown'}`));
    if(cohorts.size!==1)fail('HOMOGENEOUS',`The admitted placement requires ${requiredGpuCount} homogeneous NVIDIA devices.`,holds);
  }
  let remaining=model.bytes;
  const placement=selected.map(domain=>{
    const weightBytes=Math.min(remaining,domain.usableBytes);remaining-=weightBytes;
    return {...domain,weightBytes};
  });
  const hostBudget=Math.max(0,(authority.memory?.allocationHeadroomBytes||0)-hostReserveBytes);
  const cpuWeightBytes=Math.max(0,remaining);
  if(cpuWeightBytes>hostBudget)fail('HOST_HEADROOM',`GPU placement leaves ${cpuWeightBytes} model bytes for authority-host memory, above the current ${hostBudget}-byte fabric host budget.`,holds);
  const multiHost=new Set(placement.filter(row=>row.weightBytes>0).map(row=>row.nodeId)).size>1;
  const requestedAdapter=policy.adapter??(multiHost?'llama.cpp-rpc':'local-native');
  const adapter=adapterFor(census,requestedAdapter);
  if(!adapter)fail('ADAPTER',`No qualified ${requestedAdapter} adapter is present in the census.`,holds);
  if(adapter&&(!/^[0-9a-f]{40}$/i.test(adapter.commit||'')||!adapter.buildIdentity))fail('ADAPTER_IDENTITY','The runtime adapter must retain an exact commit and build identity.',holds);
  const canaries=[...(policy.canaries||[])];
  if(multiHost&&!canaries.length)fail('CORRECTNESS_GATE','Multi-host placement requires explicit correctness canaries before performance admission.',holds);
  const requirements={gpuCount:requiredGpuCount,deviceModel:policy.deviceModel??null,canonicalDeviceModel:requiredModel,homogeneous:policy.homogeneous===true,reservePerGpuBytes,hostReserveBytes};
  const material={model:{bytes:model.bytes,files:model.files.map(file=>({name:file.name,sha256:file.sha256}))},authorityNodeId:census.authorityNodeId,requirements,placement:placement.map(row=>({nodeId:row.nodeId,deviceId:row.deviceId,memoryDomain:row.memoryDomain,weightBytes:row.weightBytes})),cpuWeightBytes,adapter:adapter?{name:adapter.name,commit:adapter.commit,buildIdentity:adapter.buildIdentity}:requestedAdapter,canaries,benchmark:policy.benchmark??null};
  const planHash=digest(material),occurrenceId=policy.occurrenceId||`fabric-${planHash.slice(0,20)}`;
  return {schema:'aperture-fabric-plan/1',createdAt:now(),status:holds.length?'HOLD':'READY_TO_CANARY',occurrence:{id:occurrenceId,leaseEpoch:1,fence:`${occurrenceId}:1`,authorityNodeId:census.authorityNodeId},model:{bytes:model.bytes,files:model.files.map(file=>({name:file.name,sha256:file.sha256}))},requirements,memory:{pooled:false,statement:'Independent accelerator memory domains are placement resources, not one addressable VRAM pool.',gpuDomains:placement,planningTotalPhysicalBytes:placement.reduce((sum,row)=>sum+row.totalBytes,0),planningTotalUsableBytes:placement.reduce((sum,row)=>sum+row.usableBytes,0),cpuWeightBytes,authorityHostBudgetBytes:hostBudget},adapter:adapter?{name:adapter.name,commit:adapter.commit,buildIdentity:adapter.buildIdentity,capabilities:adapter.capabilities||{}}:{name:requestedAdapter,state:'MISSING'},multiHost,canaries,benchmark:policy.benchmark??null,holds,planHash,execution:'NOT_RUN',correctness:'NOT_RUN',performance:'NOT_ADMITTED'};
}

export function admitFabricCanaries(plan,results){
  if(plan.status!=='READY_TO_CANARY')throw new ApertureError('FABRIC_HOLD','A held fabric plan cannot admit canary results.');
  if(!Array.isArray(results)||results.length!==plan.canaries.length)throw new ApertureError('FABRIC_CANARY','Canary results must cover the complete admitted sequence.');
  for(let i=0;i<plan.canaries.length;i++){
    const result=results[i];
    if(result.context!==plan.canaries[i]||result.fence!==plan.occurrence.fence)throw new ApertureError('FABRIC_FENCE','Canary identity or fence does not match the admitted occurrence.');
    if(result.status!=='PASS')return {...plan,status:'HOLD_CORRECTNESS',correctness:'FAILED',performance:'NOT_ADMITTED',canaryResults:results};
  }
  return {...plan,status:'READY_TO_BENCHMARK',correctness:'PASS',canaryResults:results};
}

export function admitFabricBenchmark(plan,measurement){
  if(plan.status!=='READY_TO_BENCHMARK'||plan.correctness!=='PASS')throw new ApertureError('FABRIC_BENCHMARK_GATE','Performance cannot be admitted before every correctness canary passes.');
  if(measurement?.fence!==plan.occurrence.fence)throw new ApertureError('FABRIC_FENCE','Benchmark fence does not match the admitted occurrence.');
  for(const key of ['promptTokensPerSecond','decodeTokensPerSecond'])if(!Number.isFinite(measurement[key])||measurement[key]<=0)throw new ApertureError('FABRIC_MEASUREMENT',`${key} must be a positive observed measurement.`);
  return {...plan,status:'MEASURED',execution:'COMPLETED',performance:{status:'MEASURED',...measurement}};
}

export function reducedFabricReceipt(plan){
  const nodeMap=new Map();let n=0;const anon=node=>{if(!nodeMap.has(node))nodeMap.set(node,`node-${++n}`);return nodeMap.get(node);};
  return {schema:'aperture-fabric-receipt/1',createdAt:now(),status:plan.status,occurrence:{id:plan.occurrence.id,leaseEpoch:plan.occurrence.leaseEpoch},model:plan.model,requirements:plan.requirements,memory:{pooled:false,gpuDomains:plan.memory.gpuDomains.map((row,index)=>({node:anon(row.nodeId),domain:`gpu-domain-${index+1}`,name:row.name,canonicalModel:row.canonicalModel,totalBytes:row.totalBytes,freeBytes:row.freeBytes,usableBytes:row.usableBytes,weightBytes:row.weightBytes,computeCapability:row.computeCapability,link:row.link??null})),cpuWeightBytes:plan.memory.cpuWeightBytes,authorityHostBudgetBytes:plan.memory.authorityHostBudgetBytes},adapter:plan.adapter,canaries:plan.canaries,correctness:plan.correctness,benchmark:plan.benchmark,performance:plan.performance,holds:plan.holds,claimBoundary:'This receipt reports separate memory domains and an admitted placement. Planning totals are never a claim of pooled VRAM. Performance is present only after fenced correctness canaries pass.'};
}
