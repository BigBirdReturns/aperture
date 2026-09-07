import {ApertureError} from './common.mjs';

const positive=(value,name)=>{
  if(!Number.isSafeInteger(value)||value<1)throw new ApertureError('FABRIC_SPEC',`${name} must be a positive safe integer.`);
  return value;
};
const nonNegative=(value,name)=>{
  if(!Number.isSafeInteger(value)||value<0)throw new ApertureError('FABRIC_SPEC',`${name} must be a non-negative safe integer.`);
  return value;
};

export function validateFabricBenchmarkSpec(spec){
  if(spec?.schema!=='aperture-fabric-benchmark-spec/1')throw new ApertureError('FABRIC_SPEC','Unknown Fabric benchmark spec schema.');
  if(spec.authority?.role!=='estate-head')throw new ApertureError('FABRIC_SPEC','The first distributed Fabric contract requires estate-head authority.');
  if(spec.accelerators?.memoryAccounting!=='FOUR_SEPARATE_PHYSICAL_DOMAINS')throw new ApertureError('FABRIC_SPEC','The Qwen3.8 acceptance contract must preserve four separate physical accelerator memory domains.');
  positive(spec.accelerators?.count,'Accelerator count');
  if(spec.accelerators?.selectorMode!=='canonical-model')throw new ApertureError('FABRIC_SPEC','The acceptance accelerator selector must use canonical-model semantics.');
  if(typeof spec.accelerators?.selector!=='string'||!spec.accelerators.selector)throw new ApertureError('FABRIC_SPEC','A canonical accelerator model selector is required.');
  nonNegative(spec.accelerators?.reservePerGpuBytes,'Per-GPU reserve');
  nonNegative(spec.host?.reserveBytes,'Host reserve');
  if(spec.host?.cpuWeightPlacement!=='AUTHORITY_HOST_ONLY_FOR_FIRST_ADAPTER')throw new ApertureError('FABRIC_SPEC','The first adapter may leave CPU-resident model state only on the authority host.');
  if(spec.adapter?.name!=='llama.cpp-rpc'||spec.adapter?.transport!=='lan-tcp'||spec.adapter?.scope!=='ESTATE_LAN_ONLY')throw new ApertureError('FABRIC_SPEC','The first Fabric adapter contract is llama.cpp-rpc over estate-LAN TCP only.');
  for(const capability of ['cuda','rpcServer','llamaBench'])if(!spec.adapter?.requiredCapabilities?.includes(capability))throw new ApertureError('FABRIC_SPEC',`Missing required adapter capability ${capability}.`);
  if(spec.correctness?.requiredBeforePerformance!==true||spec.correctness?.fenceRequired!==true||!Array.isArray(spec.correctness?.contexts)||!spec.correctness.contexts.length)throw new ApertureError('FABRIC_SPEC','Fenced correctness contexts are required before performance.');
  for(const context of spec.correctness.contexts)positive(context,'Correctness context');
  const benchmark=spec.benchmark;
  if(benchmark?.fixture!=='portable-v1')throw new ApertureError('FABRIC_SPEC','Unknown benchmark fixture.');
  for(const [key,value] of Object.entries({promptTokens:benchmark.promptTokens,generatedTokens:benchmark.generatedTokens,repetitions:benchmark.repetitions,batchSize:benchmark.batchSize,ubatchSize:benchmark.ubatchSize}))positive(value,key);
  if(!Array.isArray(benchmark.contextDepths)||!benchmark.contextDepths.length)throw new ApertureError('FABRIC_SPEC','Benchmark context depths are required.');
  for(const depth of benchmark.contextDepths)nonNegative(depth,'Benchmark context depth');
  if(benchmark.output!=='json')throw new ApertureError('FABRIC_SPEC','The acceptance benchmark requires machine-readable JSON output.');
  const seat=spec.occupiedSeat||{};
  if(seat.allowHeadlessGpuWorker!==true||seat.openDesktop!==false||seat.browser!==false||seat.focusChange!==false||seat.interactiveCredentialPrompt!==false)throw new ApertureError('FABRIC_SPEC','Occupied-seat protection must remain fail closed.');
  const custody=spec.custody||{};
  if(custody.verifyEveryModelShardSha256!==true||custody.workerReceiptsRequired!==true||custody.occurrenceLeaseAndFenceRequired!==true||custody.staleWorkerCommit!==false||custody.cleanupReceiptRequired!==true)throw new ApertureError('FABRIC_SPEC','Fabric custody and fencing requirements are incomplete.');
  return spec;
}

export function fabricPolicyFromSpec(spec){
  validateFabricBenchmarkSpec(spec);
  return {
    gpuCount:spec.accelerators.count,
    deviceModel:spec.accelerators.selector,
    homogeneous:spec.accelerators.homogeneous===true,
    reservePerGpuBytes:spec.accelerators.reservePerGpuBytes,
    hostReserveBytes:spec.host.reserveBytes,
    adapter:spec.adapter.name,
    canaries:[...spec.correctness.contexts],
    benchmark:{
      id:spec.benchmark.fixture,
      promptTokens:spec.benchmark.promptTokens,
      generatedTokens:spec.benchmark.generatedTokens,
      contextDepths:[...spec.benchmark.contextDepths],
      repetitions:spec.benchmark.repetitions,
      batchSize:spec.benchmark.batchSize,
      ubatchSize:spec.benchmark.ubatchSize,
      output:spec.benchmark.output
    }
  };
}
