import {ApertureError} from './common.mjs';

export const RPC_ADAPTER_NAME='llama.cpp-rpc';

export function qualifyRpcAdapter(observation){
  const blockers=[];
  if(observation?.name!==RPC_ADAPTER_NAME)blockers.push('Adapter identity is not llama.cpp-rpc.');
  if(!/^[0-9a-f]{40}$/i.test(observation?.commit||''))blockers.push('Exact llama.cpp commit is missing.');
  if(typeof observation?.buildIdentity!=='string'||!observation.buildIdentity)blockers.push('Runtime build identity is missing.');
  for(const capability of ['cuda','rpcServer','llamaBench'])if(observation?.capabilities?.[capability]!==true)blockers.push(`Required capability ${capability} is not observed.`);
  if(observation?.transport!=='lan-tcp')blockers.push('Only the LAN-scoped TCP candidate is admitted for the first Fabric adapter.');
  return {...observation,state:blockers.length?'HOLD':'QUALIFIED',blockers};
}

export function makeRpcIntents(plan){
  if(plan?.schema!=='aperture-fabric-plan/1'||plan.status!=='READY_TO_CANARY')throw new ApertureError('FABRIC_RPC_PLAN','RPC intents require a Fabric plan admitted to the canary stage.');
  if(plan.adapter?.name!==RPC_ADAPTER_NAME||!plan.adapter.commit)throw new ApertureError('FABRIC_RPC_ADAPTER','The Fabric plan is not bound to a qualified llama.cpp RPC adapter.');
  const active=plan.memory.gpuDomains.filter(domain=>domain.weightBytes>0);
  const workers=active.map((domain,index)=>({
    schema:'aperture-fabric-worker-intent/1',
    occurrenceId:plan.occurrence.id,
    leaseEpoch:plan.occurrence.leaseEpoch,
    fence:plan.occurrence.fence,
    ordinal:index,
    nodeId:domain.nodeId,
    deviceId:domain.deviceId,
    memoryDomain:domain.memoryDomain,
    role:domain.nodeId===plan.occurrence.authorityNodeId?'LOCAL_CUDA_DOMAIN':'RPC_CUDA_DOMAIN',
    runtime:{adapter:RPC_ADAPTER_NAME,commit:plan.adapter.commit,buildIdentity:plan.adapter.buildIdentity},
    requestedWeightBytes:domain.weightBytes,
    network:{scope:'ESTATE_LAN_ONLY',endpoint:'ALLOCATE_EPHEMERAL_AT_WORKER'},
    permissions:{openDesktop:false,browser:false,arbitraryShell:false,modelExecution:true},
    state:'PREPARE_NOT_EXECUTED'
  }));
  const controller={
    schema:'aperture-fabric-controller-intent/1',
    occurrenceId:plan.occurrence.id,
    leaseEpoch:plan.occurrence.leaseEpoch,
    fence:plan.occurrence.fence,
    authorityNodeId:plan.occurrence.authorityNodeId,
    runtime:{adapter:RPC_ADAPTER_NAME,commit:plan.adapter.commit,buildIdentity:plan.adapter.buildIdentity},
    model:plan.model,
    placement:{domains:active.map((domain,index)=>({ordinal:index,nodeId:domain.nodeId,deviceId:domain.deviceId,weightBytes:domain.weightBytes})),cpuWeightBytes:plan.memory.cpuWeightBytes},
    canaries:plan.canaries,
    benchmark:plan.benchmark,
    rule:'The estate worker resolves its own local executable and device selector. The controller receives only admitted endpoints and may not discover or invoke sibling desktops directly.',
    state:'PREPARE_NOT_EXECUTED'
  };
  return {schema:'aperture-fabric-rpc-transaction/1',occurrenceId:plan.occurrence.id,fence:plan.occurrence.fence,adapter:plan.adapter,workers,controller,execution:'NOT_RUN'};
}

export function admitPreparedRpcTransaction(transaction,prepared){
  if(transaction?.schema!=='aperture-fabric-rpc-transaction/1')throw new ApertureError('FABRIC_RPC_TRANSACTION','Unknown Fabric RPC transaction.');
  if(!Array.isArray(prepared)||prepared.length!==transaction.workers.length)throw new ApertureError('FABRIC_RPC_PREPARE','Every admitted worker must return one preparation receipt.');
  const byOrdinal=new Map(prepared.map(row=>[row.ordinal,row]));
  const endpoints=[];
  for(const intent of transaction.workers){
    const row=byOrdinal.get(intent.ordinal);
    if(!row||row.fence!==transaction.fence||row.nodeId!==intent.nodeId||row.deviceId!==intent.deviceId)throw new ApertureError('FABRIC_FENCE','Worker preparation does not match the admitted worker intent.');
    if(row.status!=='READY'||typeof row.endpointRef!=='string'||!row.endpointRef)throw new ApertureError('FABRIC_RPC_PREPARE','A worker did not reach READY with an estate-scoped endpoint reference.');
    endpoints.push({ordinal:intent.ordinal,endpointRef:row.endpointRef});
  }
  return {...transaction,prepared,endpoints,state:'READY_TO_LOAD'};
}

export function staleWorkerMayCommit(transaction,receipt){
  return receipt?.occurrenceId===transaction?.occurrenceId&&receipt?.fence===transaction?.fence;
}
