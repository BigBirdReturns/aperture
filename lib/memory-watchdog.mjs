import os from 'node:os';
import {ApertureError} from './common.mjs';
import {cgroupMemory} from './hardware.mjs';
import {observeMacMemory} from './macos-memory.mjs';

function bytes(value,label) {
  if(!Number.isSafeInteger(value)||value<0)throw new ApertureError('MEMORY_MONITOR_FAILED',`${label} is unavailable.`);
  return value;
}
export function watchdogPolicy(plan) {
  const reserve=plan?.method?.reserveBytes;
  if(!Number.isSafeInteger(reserve)||reserve<1)throw new ApertureError('MEMORY_POLICY','The execution plan has no valid system-memory reserve.');
  const basis=plan?.machine?.memory?.basis??'';
  return {reserveBytes:reserve,requireCgroup:/cgroup/i.test(basis),requireMacPressure:/memory_pressure/i.test(basis)};
}
export async function observeSystemMemory({
  platform=process.platform,
  freeMemory=os.freemem,
  totalMemory=os.totalmem,
  readCgroup=cgroupMemory,
  readMacMemory=observeMacMemory,
  rss=()=>process.memoryUsage().rss
}={}) {
  const rawPhysicalAvailableBytes=bytes(Math.floor(Number(freeMemory())),'OS available physical memory');
  let physicalAvailableBytes=rawPhysicalAvailableBytes;
  let macPressureAvailableBytes=null,macPressureFreePercent=null,macPressureStatus=null;
  if(platform==='darwin') {
    const totalBytes=bytes(Math.floor(Number(totalMemory())),'OS total physical memory');
    const observation=await readMacMemory({totalBytes,rawFreeBytes:rawPhysicalAvailableBytes});
    macPressureStatus=observation?.status??null;
    if(macPressureStatus==='OBSERVED') {
      macPressureAvailableBytes=bytes(Math.floor(Number(observation.availableBytes)),'macOS pressure-aware available memory');
      physicalAvailableBytes=Math.min(totalBytes,Math.max(rawPhysicalAvailableBytes,macPressureAvailableBytes));
      macPressureFreePercent=Number.isFinite(Number(observation.pressureFreePercent))?Number(observation.pressureFreePercent):null;
    }
  }
  let cgroupAvailableBytes=null,availableBytes=physicalAvailableBytes;
  if(platform==='linux') {
    const observation=await readCgroup();
    if(observation!=null) {
      cgroupAvailableBytes=bytes(Math.floor(Number(observation.availableBytes)),'cgroup available memory');
      availableBytes=Math.min(availableBytes,cgroupAvailableBytes);
    }
  }
  const basis=platform==='darwin'&&macPressureAvailableBytes!=null
    ?'macOS memory_pressure available capacity'
    :cgroupAvailableBytes==null?'OS physical available memory':'Minimum of OS physical and cgroup-v2 available memory';
  return {observedAt:new Date().toISOString(),availableBytes,physicalAvailableBytes,rawPhysicalAvailableBytes,
    macPressureAvailableBytes,macPressureFreePercent,macPressureStatus,cgroupAvailableBytes,
    processRssBytes:bytes(Math.floor(Number(rss())),'process RSS'),basis};
}
export function pressureReason(observation,{reserveBytes,requireCgroup=false,requireMacPressure=false}) {
  if(requireCgroup&&observation.cgroupAvailableBytes==null)return new ApertureError('MEMORY_MONITOR_FAILED','The cgroup memory observation used for admission is no longer available.');
  if(requireMacPressure&&observation.macPressureAvailableBytes==null)return new ApertureError('MEMORY_MONITOR_FAILED','The macOS pressure-aware memory observation used for admission is no longer available.');
  if(observation.availableBytes<=reserveBytes)return new ApertureError('SYSTEM_MEMORY_PRESSURE',`Available system memory ${observation.availableBytes} bytes reached the reserved floor ${reserveBytes} bytes.`);
  return null;
}
export function startSystemMemoryWatchdog(plan,controller,{intervalMs=250,observe=observeSystemMemory,onPressure=()=>{}}={}) {
  if(!(controller instanceof AbortController))throw new ApertureError('MEMORY_POLICY','A watchdog AbortController is required.');
  if(!Number.isSafeInteger(intervalMs)||intervalMs<10||intervalMs>60000)throw new ApertureError('MEMORY_POLICY','The watchdog interval is invalid.');
  const policy=watchdogPolicy(plan);
  let stopped=false,timer=null,pending=Promise.resolve(),samples=0,minimumAvailableBytes=null,peakProcessRssBytes=0,last=null,trigger=null;
  const summary=()=>({status:trigger?'TRIGGERED':stopped?'STOPPED':'MONITORING',...policy,samples,minimumAvailableBytes,peakProcessRssBytes,last,trigger});
  async function sample() {
    if(stopped||controller.signal.aborted)return;
    try {
      last=await observe();samples++;
      minimumAvailableBytes=minimumAvailableBytes==null?last.availableBytes:Math.min(minimumAvailableBytes,last.availableBytes);
      peakProcessRssBytes=Math.max(peakProcessRssBytes,last.processRssBytes??0);
      const reason=pressureReason(last,policy);
      if(reason) {
        trigger={code:reason.code,message:reason.message,observation:last};
        controller.abort(reason);
        try{onPressure(reason,summary());}catch{}
      }
    } catch(error) {
      const reason=error instanceof ApertureError?error:new ApertureError('MEMORY_MONITOR_FAILED',`System-memory observation failed: ${error.message}`);
      trigger={code:reason.code,message:reason.message,observation:last};
      controller.abort(reason);
      try{onPressure(reason,summary());}catch{}
    }
    if(!stopped&&!controller.signal.aborted)timer=setTimeout(()=>{pending=sample();},intervalMs);
    timer?.unref?.();
  }
  pending=sample();
  return {summary,async stop(){stopped=true;if(timer)clearTimeout(timer);await pending;return summary();}};
}
export function abortFailure(error,controller) {
  const reason=controller?.signal?.aborted?controller.signal.reason:null;
  return reason instanceof ApertureError?reason:error;
}
