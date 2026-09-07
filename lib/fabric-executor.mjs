import {ApertureError} from './common.mjs';
import {admitFabricCanaries,admitFabricBenchmark,reducedFabricReceipt} from './fabric.mjs';
import {makeRpcIntents,admitPreparedRpcTransaction} from './fabric-rpc.mjs';

async function alwaysCleanup(api,context){
  if(typeof api.cleanup!=='function')return {status:'NO_CLEANUP_ADAPTER'};
  try{return await api.cleanup(context);}catch(error){return {status:'CLEANUP_FAILED',error:String(error?.code||error?.message||error)};}
}

export async function executeFabricPlan(plan,api){
  if(plan?.schema!=='aperture-fabric-plan/1'||plan.status!=='READY_TO_CANARY')throw new ApertureError('FABRIC_EXECUTION_GATE','Only a Fabric plan admitted to READY_TO_CANARY may execute.');
  for(const method of ['prepareWorker','load','runCanary','runBenchmark','cleanup'])if(typeof api?.[method]!=='function')throw new ApertureError('FABRIC_EXECUTOR',`Missing Fabric executor method ${method}.`);
  const tx=makeRpcIntents(plan),journal=[];let preparedTx=null,loaded=null,current=plan;
  try{
    const prepared=[];
    for(const intent of tx.workers){
      const receipt=await api.prepareWorker(intent);
      prepared.push(receipt);journal.push({stage:'WORKER_PREPARE',ordinal:intent.ordinal,status:receipt?.status||'UNKNOWN'});
    }
    preparedTx=admitPreparedRpcTransaction(tx,prepared);
    loaded=await api.load(preparedTx.controller,preparedTx.endpoints);
    if(loaded?.fence!==plan.occurrence.fence||loaded?.status!=='LOADED')throw new ApertureError('FABRIC_LOAD','Distributed load did not return a matching fenced LOADED receipt.');
    journal.push({stage:'LOAD',status:'LOADED'});
    const canaryResults=[];
    for(const context of plan.canaries){
      const result=await api.runCanary({occurrenceId:plan.occurrence.id,fence:plan.occurrence.fence,context,loadedRef:loaded.loadedRef});
      canaryResults.push(result);journal.push({stage:'CANARY',context,status:result?.status||'UNKNOWN'});
      if(result?.status!=='PASS')break;
    }
    if(canaryResults.length!==plan.canaries.length){
      current={...plan,status:'HOLD_CORRECTNESS',correctness:'FAILED',performance:'NOT_ADMITTED',canaryResults};
      return {status:current.status,plan:current,journal,receipt:reducedFabricReceipt(current)};
    }
    current=admitFabricCanaries(plan,canaryResults);
    if(current.status!=='READY_TO_BENCHMARK')return {status:current.status,plan:current,journal,receipt:reducedFabricReceipt(current)};
    const measurement=await api.runBenchmark({occurrenceId:plan.occurrence.id,fence:plan.occurrence.fence,loadedRef:loaded.loadedRef,benchmark:plan.benchmark});
    current=admitFabricBenchmark(current,measurement);journal.push({stage:'BENCHMARK',status:'MEASURED'});
    return {status:'MEASURED',plan:current,journal,receipt:reducedFabricReceipt(current)};
  }catch(error){
    journal.push({stage:'ERROR',code:error?.code||'ERROR',message:String(error?.message||error)});
    throw Object.assign(error,{fabricJournal:journal});
  }finally{
    const cleanup=await alwaysCleanup(api,{transaction:preparedTx||tx,loaded,occurrenceId:plan.occurrence.id,fence:plan.occurrence.fence});
    journal.push({stage:'CLEANUP',status:cleanup?.status||'UNKNOWN'});
  }
}
