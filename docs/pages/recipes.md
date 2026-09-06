# Recipe Lab

Aperture can compare the hardware it actually observes with source-pinned inference recipes without downloading a model or running a benchmark.

```sh
aperture recipes --allow-scan
```

Save the complete local report with:

```sh
aperture recipes --allow-scan --out aperture-recipes.json
```

## What a recipe is

A recipe is a compact factual record derived from a published experiment. It can name the checkpoint family, numerical representation, runtime, GPU count, tensor/pipeline parallel shape, context, observed working set, and source hardware. Every record retains an exact upstream commit and page coordinate.

The first source is [`local-inference-lab/rtx6kpro`](https://github.com/local-inference-lab/rtx6kpro), pinned to commit `3023e7c2e572cd445cd62234607aaf765121da58`. Aperture does not vendor the upstream prose, scripts, images, Dockerfiles, or executable material. The catalog records facts and measurements required for compatibility reasoning and points back to the exact source.

## Four result states

`QUALIFIED` means the source itself labels the recipe qualified and the locally observed hard/reference conditions needed by Aperture are present. It still does not mean Aperture has loaded the model on this machine.

`CANDIDATE` means the hardware matches the established requirements/reference conditions for a source observation, but the source evidence is not an Aperture qualification of this machine.

`UNKNOWN` means the source does not establish a required boundary. A common example is a recipe observed on a 96 GiB GPU when the local GPU has 32 GiB and the source never established a lower memory floor. Aperture keeps the result unknown instead of converting the reference card into either a false minimum or a false compatibility claim.

`BLOCKED` means an observed hard requirement is violated. Examples include too few GPUs, a numerical format that requires a newer compute capability, or physical VRAM below an observed working-set lower bound for the exact recipe.

## Reference hardware is not a minimum

The central rule is that an observed reference machine and a proven hardware floor are different objects.

If a source says a configuration ran on one 96 GiB GPU, Aperture records that as a reference. It does not claim that 96 GiB is required. If the same source reports an 82 GiB per-GPU working set for an exact four-GPU configuration, a GPU with less than 82 GiB can be rejected for that exact configuration because the observed working set itself exceeds the physical capacity.

When the local machine is smaller than the reference but no floor is established, Aperture returns `UNKNOWN` and identifies the next canary: resolve the exact checkpoint and requested context, run the native fit assessment, and only then decide whether acquisition or loading is justified.

## Architecture and topology

The scan now asks `nvidia-smi` for compute capability and current PCIe generation/width when the installed driver exposes those fields. Failure of that optional detail probe does not erase the existing GPU capacity observation. Recipes that require a numerical feature, such as the SM120-class path used by native NVFP4 observations, fail closed when the required compute capability is known to be absent and remain `UNKNOWN` when it was not observed.

Multi-GPU recipes preserve the source's homogeneous GPU count. Mixed hardware is not silently treated as equivalent to a homogeneous tensor-parallel reference. PCIe generation and width are currently comparison evidence rather than a universal hard rejection because the source corpus does not establish a single topology floor for every recipe. Peer-to-peer bandwidth and NUMA locality remain explicitly unmeasured.

## Current source catalog

The first catalog includes source-pinned records for:

- Qwen3.8-27B official FP8, vLLM TP1 with MTP3;
- the qualified Qwen3.8-27B official-FP8 TP4 profile;
- Qwen3.5-397B-A17B NVFP4 TP4;
- Qwen3.5-122B-A10B NVFP4 TP2;
- MiniMax-M2.5 NVFP4 TP2;
- GLM-5 NVFP4 with TP2 + PP3 on six GPUs;
- Kimi K2.5 native INT4 TP8.

This is a seed catalog, not an assertion that these are the only useful experiments in the upstream wiki. The resolver and source contract are deliberately independent of RTX PRO 6000 branding so later catalogs can describe RTX 5090, RTX 3090, Apple unified-memory, eGPU, other PCIe systems, or future runtimes under the same evidence rules.

## Permission boundary

`aperture recipes` performs only the permissioned local hardware scan. It does not access model files, make model-host requests, download weights, install a runtime, execute inference, stop other workloads, or run stress tests. Those remain separate Aperture permissions and later transactions.
