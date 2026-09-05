import {ApertureError, GiB, gib, now, clean, positive} from './common.mjs';
export function makePlan(machine, model, {context=4096, contextExplicit=false, parallel=1, cpu=false, gpuLayers=null}={}) {
  positive(context,'Context'); positive(parallel,'Sessions',1024);
  if (gpuLayers!==null && (!Number.isInteger(gpuLayers)||gpuLayers<0||gpuLayers>10000)) throw new ApertureError('GPU_LAYERS','GPU layers must be an integer from 0 to 10000.');
  const eligible=machine.gpu.devices.filter(d=>!d.externalGate);
  const gpu=cpu?null:eligible.sort((a,b)=>b.freeBytes-a.freeBytes)[0]||null;
  const metal=!cpu&&!gpu&&machine.gpu.appleUnifiedMemory;
  const backend=gpu?'cuda':metal?'metal':'cpu';
  const m=model.gguf?.metadata||{}, architecture=model.kind==='gguf'?m['general.architecture']:model.config?.model_type;
  const trained=model.kind==='gguf'?m[`${architecture}.context_length`]:model.config?.max_position_embeddings;
  if (!contextExplicit && Number.isInteger(trained) && trained>0) context=Math.min(context,trained);
  const ram=Math.floor(machine.memory.availableBytes*0.7);
  const reserve=Math.min(2*GiB,Math.floor(ram*0.2));
  const gpuBudget=gpu?Math.max(0,gpu.freeBytes-Math.max(GiB,Math.floor(gpu.totalBytes*0.1))):null;
  let status='CANDIDATE_REQUIRES_LOAD_CHECK', route, blockers=[], cautions=[];
  if (contextExplicit&&trained&&context>trained) blockers.push(`Requested context ${context} exceeds the declared ${trained}; no context extension is assumed.`);
  if (parallel!==1) blockers.push('This guided runner currently supports one sequence. The requested session count has been preserved, not reduced.');
  if (!gpu&&!metal&&machine.gpu.devices.some(d=>d.externalGate)&&!cpu) blockers.push('This machine contains a CMP accelerator requiring the existing Dekker capacity gate. Select --cpu explicitly for a separate CPU route.');
  if (model.kind==='gguf') route=gpu?'Keep the selected GGUF on disk. Load a runtime-fitted number of layers on the selected GPU and execute remaining layers on the CPU.':metal?'Keep the selected GGUF on disk and use Metal with shared system memory. RAM and GPU memory are not counted twice.':'Keep the selected GGUF on disk and execute on the CPU with memory mapping.';
  else {
    route='Use the bundled Transformers/Accelerate adapter: preserve checkpoint precision, allocate supported modules to GPU/CPU, and request separate permission if disk offload is needed.';
    if (metal) blockers.push('The bundled safetensors adapter does not support Metal. A matching adapter or explicit CPU route is needed.');
    if (model.config?.quantization_config) blockers.push('This quantized safetensors layout needs a matching numerical adapter; automatic conversion is disabled.');
    if (model.config?.auto_map) cautions.push('Remote model code will not be executed. Native architecture support must be verified.');
  }
  if (gpu&&gpuBudget<=reserve) blockers.push('Current accelerator headroom is below the reserve. Close other workloads or choose --cpu; no other process will be stopped.');
  const beyondVram=gpu?model.bytes>gpuBudget:null;
  if (beyondVram) cautions.push('The checkpoint exceeds the selected GPU budget. That selects a split-execution candidate; it is not by itself a rejection.');
  if (model.bytes>ram+(gpuBudget||0)) cautions.push('Weights exceed the provisional resident budgets. Paging/offload may be slow and may still fail. This runner does not implement remote-range numerical streaming.');
  if (!model.local && machine.storage.freeBytes!=null && (model.downloadBytes||model.bytes)+GiB>machine.storage.freeBytes) cautions.push('The scanned filesystem lacks whole-checkpoint download space. The actual download destination must be checked separately; an existing mounted checkpoint is another source option.');
  if (!architecture) cautions.push('Architecture metadata was not resolved. Native support and exact working-set size remain unverified.');
  let kvBytes=null;
  // Only the conventional dense MHA/GQA formula is used here. Hybrids/MLA/SWA remain unknown.
  if (model.kind==='gguf'&&['llama','qwen2','mistral'].includes(architecture)) {
    const layers=m[`${architecture}.block_count`], heads=m[`${architecture}.attention.head_count`], kvheads=m[`${architecture}.attention.head_count_kv`]??heads, embed=m[`${architecture}.embedding_length`];
    const k=m[`${architecture}.attention.key_length`]??(embed/heads),v=m[`${architecture}.attention.value_length`]??(embed/heads);
    if ([layers,kvheads,k,v].every(n=>Number.isFinite(n)&&n>0)) kvBytes=layers*kvheads*(k+v)*2*context*parallel;
  }
  if (kvBytes!=null) cautions.push(`The conventional full-context F16 KV estimate is ${gib(kvBytes)} before padding/workspace; its placement still needs the native planner.`);
  if (blockers.length) status='NEEDS_A_CHANGE_OR_ADAPTER';
  return {schema:'aperture-answer/1',createdAt:now(),status,machine,model,
    request:{contextPerSequence:context,contextDefaulted:!contextExplicit,parallel,preserveArtifact:true,automaticQuantization:false,modelSubstitution:false},
    method:{backend,route,gpu,ramBudgetBytes:ram,gpuBudgetBytes:gpuBudget,reserveBytes:reserve,kvEstimateBytes:kvBytes,
      gpuLayers:gpu||metal?(gpuLayers??'fit to the fixed context at load time'):0,cacheType:'backend F16 default',memoryMapping:model.kind==='gguf',diskOffload:false},
    beyondVram,blockers,cautions,execution:'NOT_RUN',performance:{tokensPerSecond:null,timeToFirstToken:null,basis:'No model benchmark has been run.'}};
}
export function explain(plan) {
  const {model,machine,method,request}=plan;
  const lines=[`\nYOUR MODEL AND THIS MACHINE\n`,
    `Model: ${clean(model.name)} (${gib(model.bytes)}; ${model.kind==='gguf'?'GGUF':'safetensors'})`,
    `CPU: ${machine.cpu}; available RAM: ${gib(machine.memory.availableBytes)}`,
    method.gpu?`GPU: ${method.gpu.name}; currently free: ${gib(method.gpu.freeBytes)}`:method.backend==='metal'?'GPU: Apple Metal using shared system memory':'GPU: CPU route selected; other accelerator support is not inferred.',
    `Context: ${request.contextPerSequence.toLocaleString()} tokens per session; sessions: ${request.parallel}${request.contextDefaulted?' (visible defaults)':''}`,
    '', `Configuration: ${method.route}`,
    `Provisional RAM budget: ${gib(method.ramBudgetBytes)}${method.gpu?`; GPU budget: ${gib(method.gpuBudgetBytes)}`:''}.`,
    `Placement: ${method.gpuLayers===0?'CPU only':method.gpuLayers}. Checkpoint and representation unchanged.`,
    ''];
  if (plan.blockers.length) lines.push('Needed before this runner can start:',...plan.blockers.map(s=>`  ${s}`));
  else lines.push('A supported execution family has been selected. Loading still has to verify this particular model and configuration.');
  lines.push(...plan.cautions.map(s=>`  ${s}`),'',
    'Speed: not measured. No throughput number is invented from the GPU name.',
    `Download: ${model.local?'none for weights; your existing files remain in place':gib(model.downloadBytes||model.bytes)+' of weights/support files only after approval'}.`,
    'No inference, benchmark, upload, driver change, or experiment has happened.',
    '');
  return lines.join('\n');
}
