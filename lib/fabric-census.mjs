import {ApertureError,now} from './common.mjs';
import {validateFabricCensus} from './fabric.mjs';

export function makeFabricCensus(nodeObservations,{authorityNodeId,adapters=[]}={}){
  if(!Array.isArray(nodeObservations)||!nodeObservations.length)throw new ApertureError('FABRIC_CENSUS','At least one estate node observation is required.');
  const nodes=nodeObservations.map(observation=>{
    const scan=observation.scan;
    if(typeof observation.id!=='string'||!observation.id)throw new ApertureError('FABRIC_NODE','Every estate observation requires a node identity.');
    if(scan?.schema!=='aperture-scan/1')throw new ApertureError('FABRIC_SCAN','Every estate node must supply an Aperture scan/1 snapshot.');
    const workerReady=observation.worker?.headless===true&&observation.worker?.state==='READY';
    const reachable=observation.reachable===true;
    const state=reachable&&workerReady?'READY':'UNREACHABLE';
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
        kind:'nvidia',name:device.name,totalBytes:device.totalBytes,freeBytes:device.freeBytes,
        computeCapability:device.computeCapability??null,externalGate:device.externalGate===true,
        link:device.pcie?{kind:'PCIe',generation:device.pcie.generation??null,width:device.pcie.width??null}:null
      })),
      transport:observation.transport?{kind:observation.transport.kind||null,rateBitsPerSecond:observation.transport.rateBitsPerSecond??null,measured:observation.transport.measured===true}:null
    };
  });
  const census={schema:'aperture-fabric-census/1',createdAt:now(),authorityNodeId,nodes,adapters,claimBoundary:'Reachability and worker readiness are observations. UNREACHABLE does not imply powered off. Each accelerator remains a separate physical memory domain.'};
  validateFabricCensus(census);return census;
}
