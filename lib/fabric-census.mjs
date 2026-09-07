import {ApertureError,now} from './common.mjs';
import {validateFabricCensus} from './fabric.mjs';

const nvidiaName=name=>/NVIDIA|GeForce|RTX|Tesla|Quadro|A\d{2,3}|H\d{2,3}|L\d{1,2}/i.test(name||'');

export function makeFabricCensus(nodeObservations,{authorityNodeId,adapters=[]}={}){
  if(!Array.isArray(nodeObservations)||!nodeObservations.length)throw new ApertureError('FABRIC_CENSUS','At least one estate node observation is required.');
  const nodes=nodeObservations.map(observation=>{
    const scan=observation.scan;
    if(typeof observation.id!=='string'||!observation.id)throw new ApertureError('FABRIC_NODE','Every estate observation requires a node identity.');
    if(scan?.schema!=='aperture-scan/1')throw new ApertureError('FABRIC_SCAN','Every estate node must supply an Aperture scan/1 snapshot.');
    const workerReady=observation.worker?.headless===true&&observation.worker?.state==='READY';
    const reachable=observation.reachable===true;
    const state=!reachable?'UNREACHABLE':workerReady?'READY':'NO_HEADLESS_WORKER';
    return {
      id:observation.id,
      state,
      lastObservedAt:observation.observedAt||scan.observedAt||null,
      interactiveOccupied:observation.interactiveOccupied===true,
      worker:{headless:workerReady,transport:observation.worker?.transport||null},
      memory:{totalBytes:scan.memory?.totalBytes??0,allocationHeadroomBytes:scan.memory?.allocationHeadroomBytes??scan.memory?.availableBytes??0},
      devices:(scan.gpu?.devices||[]).map(device=>({
        id:`gpu-${device.index}`,
        memoryDomain:`${observation.id}:${device.memoryDomain||device.uuid||device.index}`,
        kind:device.kind||device.vendor?.toLowerCase?.()||(nvidiaName(device.name)?'nvidia':'other'),
        name:device.name,totalBytes:device.totalBytes,freeBytes:device.freeBytes,
        computeCapability:device.computeCapability??null,externalGate:device.externalGate===true,
        link:device.pcie?{kind:'PCIe',generation:device.pcie.generation??null,width:device.pcie.width??null}:null
      })),
      transport:observation.transport?{kind:observation.transport.kind||null,rateBitsPerSecond:observation.transport.rateBitsPerSecond??null,measured:observation.transport.measured===true}:null
    };
  });
  const census={schema:'aperture-fabric-census/1',createdAt:now(),authorityNodeId,nodes,adapters,claimBoundary:'Reachability and headless-worker readiness are separate observations. UNREACHABLE does not imply powered off, and NO_HEADLESS_WORKER does not imply network failure. Each accelerator remains a separate physical memory domain.'};
  validateFabricCensus(census);return census;
}
