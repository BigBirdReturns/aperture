const GiB = 1024 ** 3;

export const RTX6KPRO_SOURCE = Object.freeze({
  id: 'local-inference-lab/rtx6kpro',
  commit: '3023e7c2e572cd445cd62234607aaf765121da58',
  observedAt: '2026-09-06',
  repository: 'https://github.com/local-inference-lab/rtx6kpro',
  treatment: 'FACTS_AND_MEASUREMENTS_ONLY',
  note: 'Aperture does not vendor upstream prose, scripts, images, Dockerfiles, or executable material. Recipes retain exact source coordinates and distinguish reference hardware from established requirements.'
});

const source = (path, section, evidence = 'research-only') => ({
  sourceId: RTX6KPRO_SOURCE.id,
  commit: RTX6KPRO_SOURCE.commit,
  path,
  section,
  evidence
});

export const RECIPE_CATALOG = Object.freeze([
  {
    id: 'rtx6kpro/qwen38-27b-official-fp8-vllm-tp1-mtp3',
    title: 'Qwen3.8-27B official FP8, vLLM, TP1, MTP3',
    model: {family: 'Qwen3.8-27B', representation: 'FP8', checkpoint: 'Qwen/Qwen3.8-27B-FP8'},
    runtime: {engine: 'vLLM', tensorParallel: 1, pipelineParallel: 1, mtp: 3, kvCache: 'FP8'},
    hard: {gpuVendor: 'NVIDIA', gpuCount: 1, homogeneous: false},
    reference: {computeCapability: 12, perGpuMemoryBytes: 96 * GiB, contextTokens: 128000, pcieGeneration: null, pcieWidth: null},
    evidenceStatus: 'research-only',
    source: source('models/qwen38-27b.md', 'TP=1: Official FP8 With MTP3, TP=1')
  },
  {
    id: 'rtx6kpro/qwen38-27b-official-fp8-vllm-tp4-qualified',
    title: 'Qwen3.8-27B official FP8, vLLM, TP4 qualified profile',
    model: {family: 'Qwen3.8-27B', representation: 'FP8', checkpoint: 'Qwen/Qwen3.8-27B-FP8'},
    runtime: {engine: 'vLLM', tensorParallel: 4, pipelineParallel: 1, mtp: 3, kvCache: 'FP8'},
    hard: {gpuVendor: 'NVIDIA', gpuCount: 4, homogeneous: true},
    reference: {computeCapability: 12, perGpuMemoryBytes: 96 * GiB, contextTokens: 1000000, pcieGeneration: null, pcieWidth: null},
    evidenceStatus: 'qualified',
    source: source('models/qwen38-27b.md', 'TP=4: Qualified Official-FP8 Deployment, TP=4', 'qualified')
  },
  {
    id: 'rtx6kpro/qwen35-397b-a17b-nvfp4-tp4',
    title: 'Qwen3.5-397B-A17B NVFP4, TP4 reference fit',
    model: {family: 'Qwen3.5-397B-A17B', representation: 'NVFP4', checkpoint: 'nvidia/Qwen3.5-397B-A17B-NVFP4'},
    runtime: {engine: 'vLLM-or-SGLang', tensorParallel: 4, pipelineParallel: 1, mtp: null, kvCache: 'checkpoint-dependent'},
    hard: {gpuVendor: 'NVIDIA', gpuCount: 4, homogeneous: true, computeCapabilityMin: 12},
    reference: {computeCapability: 12, perGpuMemoryBytes: 96 * GiB, observedWorkingSetBytes: 82 * GiB, contextTokens: null, pcieGeneration: 5, pcieWidth: 16},
    evidenceStatus: 'field-observation',
    source: source('hardware/gpu-configs.md', 'Model Sizing Guide / 4-GPU Configurations', 'field-observation'),
    supportingSources: [source('optimization/nvfp4-quantization.md', 'What is NVFP4 / SM120f Compilation and GEMM Backends', 'mechanism')]
  },
  {
    id: 'rtx6kpro/qwen35-122b-a10b-nvfp4-tp2',
    title: 'Qwen3.5-122B-A10B NVFP4, TP2 reference fit',
    model: {family: 'Qwen3.5-122B-A10B', representation: 'NVFP4', checkpoint: null},
    runtime: {engine: 'vLLM-or-SGLang', tensorParallel: 2, pipelineParallel: 1, mtp: null, kvCache: 'checkpoint-dependent'},
    hard: {gpuVendor: 'NVIDIA', gpuCount: 2, homogeneous: true, computeCapabilityMin: 12},
    reference: {computeCapability: 12, perGpuMemoryBytes: 96 * GiB, contextTokens: null, pcieGeneration: 5, pcieWidth: 16},
    evidenceStatus: 'field-observation',
    source: source('hardware/gpu-configs.md', 'Model Sizing Guide / What Fits on 4x 96GB', 'field-observation'),
    supportingSources: [source('optimization/nvfp4-quantization.md', 'Qwen3.5 Other Sizes / SM120f Compilation and GEMM Backends', 'mechanism')]
  },
  {
    id: 'rtx6kpro/minimax-m2.5-nvfp4-tp2',
    title: 'MiniMax-M2.5 NVFP4, TP2 reference fit',
    model: {family: 'MiniMax-M2.5', representation: 'NVFP4', checkpoint: null},
    runtime: {engine: 'vLLM-or-SGLang', tensorParallel: 2, pipelineParallel: 1, mtp: null, kvCache: 'checkpoint-dependent'},
    hard: {gpuVendor: 'NVIDIA', gpuCount: 2, homogeneous: true, computeCapabilityMin: 12},
    reference: {computeCapability: 12, perGpuMemoryBytes: 96 * GiB, contextTokens: null, pcieGeneration: 5, pcieWidth: 16},
    evidenceStatus: 'field-observation',
    source: source('hardware/gpu-configs.md', 'Model Sizing Guide', 'field-observation'),
    supportingSources: [source('optimization/nvfp4-quantization.md', 'Performance: NVFP4 vs FP8', 'field-observation')]
  },
  {
    id: 'rtx6kpro/glm5-nvfp4-tp2-pp3',
    title: 'GLM-5 NVFP4, TP2 + PP3, six-GPU reference fit',
    model: {family: 'GLM-5', representation: 'NVFP4', checkpoint: null},
    runtime: {engine: 'vLLM-or-SGLang', tensorParallel: 2, pipelineParallel: 3, mtp: null, kvCache: 'BF16-on-SM120-reference'},
    hard: {gpuVendor: 'NVIDIA', gpuCount: 6, homogeneous: true, computeCapabilityMin: 12},
    reference: {computeCapability: 12, perGpuMemoryBytes: 96 * GiB, contextTokens: null, pcieGeneration: 5, pcieWidth: 16},
    evidenceStatus: 'field-observation',
    source: source('hardware/gpu-configs.md', 'Model Sizing Guide', 'field-observation'),
    supportingSources: [source('optimization/nvfp4-quantization.md', 'FP8 KV Cache Limitations on SM120', 'field-observation')]
  },
  {
    id: 'rtx6kpro/kimi-k2.5-native-int4-tp8',
    title: 'Kimi K2.5 native INT4, TP8 reference fit',
    model: {family: 'Kimi K2.5', representation: 'native INT4', checkpoint: null},
    runtime: {engine: 'vLLM-or-SGLang', tensorParallel: 8, pipelineParallel: 1, mtp: null, kvCache: 'BF16-or-FP8'},
    hard: {gpuVendor: 'NVIDIA', gpuCount: 8, homogeneous: true},
    reference: {computeCapability: 12, perGpuMemoryBytes: 96 * GiB, observedWorkingSetBytes: 60 * GiB, contextTokens: null, pcieGeneration: 5, pcieWidth: 16},
    evidenceStatus: 'field-observation',
    source: source('hardware/gpu-configs.md', '8-GPU Configurations', 'field-observation'),
    supportingSources: [source('optimization/nvfp4-quantization.md', 'Kimi K2.5 NVFP4 vs Native INT4', 'comparative-observation')]
  }
]);
