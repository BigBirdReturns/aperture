import {ApertureError, RUNTIME_VERSION} from './common.mjs';
import {verifyNativeDevice} from './backends.mjs';
export function nativeOptions(plan) {
  const gpu=plan.method.backend==='cpu'?false:plan.method.backend;
  return {
    llama:{gpu,build:'never',skipDownload:true,usePrebuiltBinaries:true,progressLogs:false,
      ramPadding:Math.max(0,plan.machine.memory.availableBytes-plan.method.ramBudgetBytes),
      ...(plan.method.gpuBudgetBytes!=null?{vramPadding:Math.max(0,(plan.method.nativeObservation?.vram?.free??plan.method.gpu?.freeBytes??0)-plan.method.gpuBudgetBytes)}:{})},
    model:{modelPath:plan.model.source.path,useMmap:true,useMlock:false,ignoreMemorySafetyChecks:false,
      gpuLayers:gpu?(Number.isInteger(plan.method.gpuLayers)?plan.method.gpuLayers:{min:0,fitContext:{contextSize:plan.request.contextPerSequence}}):0},
    context:{contextSize:plan.request.contextPerSequence,sequences:1,batchSize:Math.min(512,plan.request.contextPerSequence),
      failedCreationRemedy:false,ignoreMemorySafetyChecks:false,performanceTracking:true,
      ...(plan.request.threads?{threads:plan.request.threads}:{})}
  };
}
export async function generate(api,plan,{prompt,tokens=128,onText=()=>{},onStage=()=>{},signal}={}) {
  if(plan.request.parallel!==1)throw new ApertureError('CONCURRENCY','This guided worker requires exactly one sequence.');
  const opts=nativeOptions(plan),started=performance.now();let llama,model,context,session,first=null;
  try {
    onStage('Initializing native backend');
    llama=await api.getLlama(opts.llama);
    if(llama.gpu!==opts.llama.gpu)throw new ApertureError('BACKEND_CHANGED','The native runtime did not select the approved CPU/GPU backend.');
    await verifyNativeDevice(llama,plan);
    onStage('Loading selected model weights');
    model=await llama.loadModel({...opts.model,loadSignal:signal});
    onStage('Allocating fixed context');
    context=await model.createContext({...opts.context,createSignal:signal});
    const sequence=context.getSequence(),actual=sequence.contextSize;
    if(!Number.isInteger(actual)||actual<plan.request.contextPerSequence||actual>plan.request.contextPerSequence+255) {
      throw new ApertureError('CONTEXT_CHANGED','Native context readback differs from the requested size beyond documented alignment.');
    }
    const loadSeconds=(performance.now()-started)/1000;
    session=new api.LlamaChatSession({contextSequence:sequence});
    const meterBefore=sequence.tokenMeter?.getState?.();
    const generationStart=performance.now();
    onStage('Generating response');
    const text=await session.prompt(prompt,{maxTokens:tokens,temperature:0,seed:42,signal,
      onTextChunk:chunk=>{if(first===null)first=(performance.now()-generationStart)/1000;onText(chunk);}});
    if(typeof text!=='string'||!text.trim())throw new ApertureError('EMPTY_OUTPUT','The runtime returned no usable generated text.');
    const usage=meterBefore?sequence.tokenMeter.diff(meterBefore):null;
    const generationSeconds=(performance.now()-generationStart)/1000;
    return {status:'GENERATED_NOT_TASK_QUALIFIED',runtime:`node-llama-cpp@${RUNTIME_VERSION}`,backend:llama.gpu,
      requestedContext:plan.request.contextPerSequence,observedContext:actual,observedGpuLayers:Number.isInteger(model.gpuLayers)?model.gpuLayers:null,
      loadSeconds,generationSeconds,firstTextChunkSeconds:first,
      text,deviceNames:plan.method.expectedDeviceNames??[],nativeDevice:plan.method.nativeDevice??null,backendFallback:plan.method.backendFallback??null,
      outputTokenCount:usage?.usedOutputTokens??null,inputTokenCount:usage?.usedInputTokens??null,
      outputTokensPerWallSecond:usage&&generationSeconds>0?usage.usedOutputTokens/generationSeconds:null,
      performanceBasis:'Native sequence token counters and generation wall clock (including prompt processing). First text chunk is not an exact token event; this is not a decode-only benchmark.'};
  }finally{
    for(const object of [session,context,model,llama]) {try{await object?.dispose?.();}catch{}}
  }
}
