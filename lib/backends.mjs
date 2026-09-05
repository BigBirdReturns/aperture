import {fileURLToPath} from 'node:url';
import {command,ApertureError,GiB,gib,clean} from './common.mjs';
import {graphicsDomain} from './hardware.mjs';
const probeFile=fileURLToPath(new URL('./backend-probe-worker.mjs',import.meta.url));
export function nativeEnvironment(plan,base=process.env) {
  const env={...base,NODE_LLAMA_CPP_SKIP_DOWNLOAD:'true',CUDA_VISIBLE_DEVICES:plan.method.backend==='cuda'?plan.method.gpu?.uuid||'':''};
  delete env.GGML_VK_VISIBLE_DEVICES;
  if(plan.method.backend==='vulkan'&&Number.isInteger(plan.method.vulkanIndex))env.GGML_VK_VISIBLE_DEVICES=String(plan.method.vulkanIndex);
  return env;
}
async function probe(directory,backend,{uuid,index}={}) {
  const env={...process.env,NODE_LLAMA_CPP_SKIP_DOWNLOAD:'true'};
  delete env.GGML_VK_VISIBLE_DEVICES;
  if(backend==='cuda')env.CUDA_VISIBLE_DEVICES=uuid;
  if(backend==='vulkan'){env.CUDA_VISIBLE_DEVICES='';env.GGML_VK_VISIBLE_DEVICES=String(index);}
  const result=await command(process.execPath,[probeFile,directory,backend],{env,timeout:30000});
  const marker=result.stdout.split(/\r?\n/).find(s=>s.startsWith('APERTURE_BACKEND='));
  if(result.code!==0||result.timedOut||!marker)throw new ApertureError('BACKEND_UNAVAILABLE',`${backend}${index!==undefined?' device '+index:''}: the pinned prebuilt backend did not initialize. No driver or build tool was installed.`);
  const data=JSON.parse(marker.slice('APERTURE_BACKEND='.length));
  if(data.backend!==backend||!Array.isArray(data.names))throw new ApertureError('BACKEND_READBACK','Unexpected native backend observation.');
  return {...data,index};
}
export function deviceBudget(machine,observation) {
  const raw=observation.vram;
  if(!raw||![raw.free,raw.total].every(n=>Number.isFinite(n)&&n>=0)||raw.free>raw.total)throw new ApertureError('CAPACITY_UNKNOWN','Native device memory observation is incomplete.');
  const name=observation.names.join(' / ');
  const nvidia=machine.gpu.devices.filter(d=>observation.names.includes(d.name));
  const memoryDomain=nvidia.length?'dedicated':graphicsDomain(name,machine.platform,machine.architecture);
  const ramBudget=Math.floor((machine.memory.allocationHeadroomBytes??machine.memory.availableBytes)*0.7);
  let free=raw.free;
  if(nvidia.length)free=Math.min(free,...nvidia.map(d=>d.freeBytes));
  let budget=Math.max(0,free-Math.max(256*1024**2,Math.floor(raw.total*0.1)));
  // Unknown domains are treated conservatively as shared. Never add them to RAM.
  if(memoryDomain!=='dedicated')budget=Math.min(budget,Math.floor(ramBudget/2));
  return {name,memoryDomain,freeBytes:free,totalBytes:raw.total,budgetBytes:budget,ramBudgetBytes:memoryDomain==='dedicated'?ramBudget:Math.max(0,ramBudget-budget),
    sharedMemoryBudgetBytes:memoryDomain==='dedicated'?null:ramBudget,
    capacityBasis:nvidia.length?'Minimum of native Vulkan/CUDA and NVIDIA driver headroom':'Native backend budget, capped conservatively when sharing is known or unresolved'};
}
export function chooseVulkan(candidates,selector=null) {
  const matching=selector===null?candidates:candidates.filter(c=>/^\d+$/.test(selector)?c.index===Number(selector):c.names.some(n=>n.toLowerCase().includes(selector.toLowerCase())));
  if(!matching.length)throw new ApertureError('DEVICE_UNAVAILABLE','No initialized Vulkan device matches '+(selector??'the machine')+'.');
  if(selector!==null&&matching.length>1)throw new ApertureError('DEVICE_AMBIGUOUS','More than one Vulkan device matches. Select its native numeric index explicitly.');
  return [...matching].sort((a,b)=>b.screen.budgetBytes-a.screen.budgetBytes)[0];
}
export async function bindNative(plan,directory,ui) {
  let current=plan.method.backend;
  const automatic=(plan.request.backend??'auto')==='auto';
  if(current==='cpu')return plan;
  if(current==='metal') {
    const observation=await probe(directory,'metal');
    return {...plan,method:{...plan.method,expectedDeviceNames:observation.names,nativeObservation:observation}};
  }
  if(current==='cuda') {
    try {
      const observation=await probe(directory,'cuda',{uuid:plan.method.gpu.uuid});
      ui.say(`Native CUDA device: ${observation.names.map(clean).join(', ')}.`);
      return {...plan,method:{...plan.method,expectedDeviceNames:observation.names,nativeObservation:observation}};
    }catch(e){
      if(!automatic)throw e;
      ui.say('The pinned CUDA binary could not initialize. Checking Vulkan for the same selected hardware before proposing CPU execution.');
      current='vulkan';
    }
  }
  if(current!=='vulkan')throw new ApertureError('BACKEND_UNSUPPORTED','No numerical adapter for '+current+'.');
  const count=Math.max(1,Math.min(8,plan.machine.hardware?.graphics.length||plan.machine.gpu.devices.length||1));
  const candidates=[],failures=[];
  for(let index=0;index<count;index++) {
    try {const observation=await probe(directory,'vulkan',{index});if(observation.names.length!==1)throw Error('Expected one visible device');candidates.push({...observation,screen:deviceBudget(plan.machine,observation)});}
    catch(e){failures.push({index,error:clean(e.message)});}
  }
  const selector=automatic&&plan.method.gpu?plan.method.gpu.name:plan.request.device??null;
  let chosen;
  try{chosen=chooseVulkan(candidates,selector);}catch(e){
    if(!automatic)throw new ApertureError(e.code,e.message+' Initialized devices: '+candidates.map(c=>`${c.index}: ${c.names.join(', ')}`).join('; '));
    ui.say('No unambiguous compatible GPU backend was admitted. The automatic route proposes CPU execution with the same model and context.');
    return {...plan,beyondVram:null,method:{...plan.method,backend:'cpu',gpu:null,gpuLayers:0,gpuBudgetBytes:null,backendFallback:'CPU_AFTER_NATIVE_PROBE',backendFailures:failures}};
  }
  const {screen}=chosen;
  if(screen.budgetBytes<128*1024**2)throw new ApertureError('GPU_HEADROOM','The selected native device has insufficient reserved headroom. Choose --cpu or free memory; other workloads were not stopped.');
  ui.say(`Native Vulkan device ${chosen.index}: ${clean(screen.name)}. GPU budget ${gib(screen.budgetBytes)}; RAM budget ${gib(screen.ramBudgetBytes)}${screen.memoryDomain!=='dedicated'?' from the same physical memory domain, not additive':''}.`);
  return {...plan,beyondVram:screen.memoryDomain==='dedicated'?plan.model.bytes>screen.budgetBytes:null,method:{...plan.method,backend:'vulkan',gpu:null,
    vulkanIndex:chosen.index,nativeDevice:screen,expectedDeviceNames:chosen.names,nativeObservation:chosen,
    gpuBudgetBytes:screen.budgetBytes,ramBudgetBytes:screen.ramBudgetBytes,sharedMemoryBudgetBytes:screen.sharedMemoryBudgetBytes,
    gpuLayers:Number.isInteger(plan.method.gpuLayers)?plan.method.gpuLayers:'fit to the fixed context at load time',
    backendFallback:plan.method.backend==='cuda'?'CUDA_TO_VULKAN':null}};
}
export async function verifyNativeDevice(llama,plan) {
  if(plan.method.expectedDeviceNames) {
    const names=await llama.getGpuDeviceNames();
    if(JSON.stringify(names)!==JSON.stringify(plan.method.expectedDeviceNames))throw new ApertureError('DEVICE_CHANGED','The native device name/order changed after discovery. No weights were loaded.');
  }
}
