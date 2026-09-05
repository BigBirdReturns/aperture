import os from 'node:os';
import {command,which,now,clean,appHome} from './common.mjs';
import {platformInventory,cgroupMemory,storageAt} from './hardware.mjs';
export function parseNvidia(text) {
  const devices=[];
  for(const line of text.trim().split(/\r?\n/)) {
    const row=line.split(',').map(x=>x.trim());if(row.length!==6)continue;
    const [index,uuid,name,total,free,driver]=row;
    if(!/^\d+$/.test(index)||!/^GPU-[a-z0-9-]+$/i.test(uuid)||total===''||free===''||!Number.isFinite(Number(total))||!Number.isFinite(Number(free)))continue;
    const totalBytes=Number(total)*1048576,freeBytes=Number(free)*1048576;
    if(freeBytes<0||totalBytes<=0||freeBytes>totalBytes)continue;
    devices.push({index:Number(index),uuid,name:clean(name),totalBytes,freeBytes,driver,capacity:'DRIVER_REPORTED',memoryDomain:uuid,externalGate:/CMP/i.test(name)});
  }
  return devices;
}
export async function scan({storage=appHome()}={}) {
  const startedAt=now();
  const [hardware,disk]=await Promise.all([platformInventory(),storageAt(storage)]);
  let total=os.totalmem(),available=hardware.memory.availableBytes??os.freemem(),basis='OS physical memory';
  if(process.platform==='linux') {
    const cgroup=await cgroupMemory();
    if(cgroup){total=Math.min(total,cgroup.totalBytes);available=Math.min(available,cgroup.availableBytes);basis+=' and '+cgroup.basis;}
  }
  available=Math.min(total,Math.max(0,available));
  const commitHeadroomBytes=process.platform==='win32'&&hardware.memory.commitLimitBytes!=null&&hardware.memory.committedBytes!=null?Math.max(0,hardware.memory.commitLimitBytes-hardware.memory.committedBytes):null;
  const allocationHeadroomBytes=commitHeadroomBytes===null?available:Math.min(available,commitHeadroomBytes);
  let devices=[],gpuObservation='NVIDIA driver unavailable; see OS graphics inventory for other devices.';
  const smi=await which(['nvidia-smi']);
  if(smi)try {
    const r=await command(smi,['--query-gpu=index,uuid,name,memory.total,memory.free,driver_version','--format=csv,noheader,nounits']);
    if(r.code===0){devices=parseNvidia(r.stdout);gpuObservation='NVIDIA driver inventory';}
  }catch{}
  return {schema:'aperture-scan/1',startedAt,observedAt:now(),platform:process.platform,architecture:process.arch,
    cpu:clean(os.cpus()[0]?.model||'unknown'),logicalCpus:os.availableParallelism?.()||os.cpus().length,
    memory:{totalBytes:total,availableBytes:available,allocationHeadroomBytes,commitHeadroomBytes,basis,
      installedBytes:hardware.modules.length?hardware.modules.reduce((n,m)=>n+(m.bytes||0),0):null,
      swapTotalBytes:hardware.memory.swapTotalBytes??null,swapFreeBytes:hardware.memory.swapFreeBytes??null},
    storage:disk,hardware,
    gpu:{devices,observation:gpuObservation,appleUnifiedMemory:process.platform==='darwin'&&process.arch==='arm64'},
    installed:{llamaServer:await which(['llama-server']),python:await which(['python3','python','py'])},
    notMeasured:['memory/storage/network throughput','GPU stability','model performance','NPU model compatibility','non-NVIDIA dedicated capacity before native backend discovery'],
    privacy:'Local only. OS device inventory and selected paths only. No personal-folder traversal, credentials, uploads or stress tests. Snapshots contain local device/path information.'};
}
