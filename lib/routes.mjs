import {makePlan as basePlan,explain as baseExplain} from './plan.mjs';
import {ApertureError,GiB,gib,clean} from './common.mjs';
export function makePlan(machine,model,options={}) {
  const backend=options.backend??'auto',device=options.device??null;
  if(!['auto','cpu','cuda','vulkan','metal','npu'].includes(backend))throw new ApertureError('BACKEND','Choose auto, cpu, cuda, vulkan, metal or npu.');
  if(options.cpu&&backend!=='auto'&&backend!=='cpu')throw new ApertureError('BACKEND_CONFLICT','--cpu cannot be combined with another backend.');
  if(device!==null&&(typeof device!=='string'||!device.trim()||device.length>200))throw new ApertureError('DEVICE','Supply a bounded device index, UUID or name.');
  const requested=options.cpu?'cpu':backend;
  const headroom=machine.memory.allocationHeadroomBytes??machine.memory.availableBytes;
  let selectedMachine=machine;
  if((requested==='cuda'||requested==='auto')&&device!==null) {
    const matches=machine.gpu.devices.filter(g=>String(g.index)===device||g.uuid===device||g.name.toLowerCase().includes(device.toLowerCase()));
    if(matches.length!==1)throw new ApertureError('DEVICE','The CUDA device selector must identify exactly one observed device. Use --backend vulkan for Vulkan indexes or integrated graphics.');
    selectedMachine={...machine,gpu:{...machine.gpu,devices:matches}};
  }
  const forceCPU=['cpu','vulkan','npu'].includes(requested);
  let p=basePlan({...selectedMachine,memory:{...machine.memory,availableBytes:headroom}},model,{...options,cpu:forceCPU||options.cpu});
  if(requested==='auto'&&p.blockers.some(b=>b.startsWith('Current accelerator headroom'))){
    p=basePlan({...machine,memory:{...machine.memory,availableBytes:headroom}},model,{...options,cpu:true});
    p.method.backendFallback='CPU_AFTER_LOW_GPU_HEADROOM';
    p.cautions.push('Observed dedicated GPUs lack reserved headroom. The automatic route uses CPU without stopping other workloads.');
  }
  p.machine=machine;
  p.request.backend=requested;p.request.device=device;
  if(options.threads!==undefined&&(!Number.isInteger(options.threads)||options.threads<1||options.threads>machine.logicalCpus))throw new ApertureError('THREADS','Thread count exceeds available logical CPUs.');
  p.request.threads=options.threads??Math.max(1,Math.min(8,Math.floor((machine.logicalCpus||2)/2)));
  if(requested==='vulkan'||requested==='auto'&&p.method.backend==='cpu'&&!p.method.backendFallback&&(machine.hardware?.graphics||[]).length) {
    p.method.backend='vulkan';p.method.gpu=null;p.method.gpuBudgetBytes=null;
    p.method.gpuLayers=options.gpuLayers??'fit to the fixed context at load time';
    p.method.route='Enumerate the native Vulkan devices, bind one device, fit GPU layers to the fixed context, and execute remaining layers on CPU. Integrated graphics shares the system-memory budget.';
    p.cautions.push('Vulkan capacity and the selected device are checked with the managed runtime before weights are loaded. OS display enumeration alone is not execution support.');
  }
  if(requested==='cuda'&&!p.method.gpu)p.blockers.push('No eligible CUDA device was observed. No fallback is implied by an explicit backend.');
  if(requested==='metal'&&!machine.gpu.appleUnifiedMemory)p.blockers.push('This Metal route requires a native Apple Silicon process.');
  if(requested==='npu') {
    p.method.backend='npu';p.method.gpu=null;
    p.method.route='No numerical NPU adapter is available for the selected checkpoint; device discovery alone does not supply an execution method.';
    p.blockers.push('The neural device is inventoried, but this release has no NPU numerical adapter for this checkpoint. It will not pretend that GGUF can execute on an NPU or silently switch to CPU.');
  }
  if(model.kind!=='gguf'&&['vulkan','npu'].includes(p.method.backend))p.blockers.push('The bundled safetensors adapter does not implement this requested backend.');
  if((machine.hardware?.neural||[]).length)p.cautions.push('An NPU is present. It is retained in the inventory, not counted as GPU VRAM; NPU execution needs a matching architecture/format/runtime adapter.');
  if(machine.memory.commitHeadroomBytes!=null)p.cautions.push(`RAM budget also respects current Windows commit headroom (${gib(machine.memory.commitHeadroomBytes)}). Pagefile capacity is not added to physical RAM.`);
  p.status=p.blockers.length?'NEEDS_A_CHANGE_OR_ADAPTER':'CANDIDATE_REQUIRES_LOAD_CHECK';
  return p;
}
export function explain(plan) {
  const native=plan.method.backend==='vulkan'?`Vulkan device selection: ${clean(plan.request.device??'automatic after native discovery')}. No memory is pooled across devices.\n`:'';
  return baseExplain(plan).replace('GPU: CPU route selected; other accelerator support is not inferred.',plan.method.backend==='vulkan'?'GPU: Vulkan candidate; native device readback required.':plan.method.backend==='npu'?'NPU: detected hardware requires an execution adapter.':'GPU: CPU route selected.')+native+`CPU worker threads: ${plan.request.threads??'runtime default'}.\n`;
}
