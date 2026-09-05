# Supported paths and verified results

This page describes the **0.4.4 release** and its retained observations. It separates implemented adapters, actual native execution, and unverified combinations. The complete checkpoint and context remain part of each result; an installed CLI or passing control suite does not qualify every device or architecture.

## Platform and runtime coverage

| Path | Implementation | Native evidence recorded |
| --- | --- | --- |
| Windows x64 CPU | Managed GGUF runtime | Qwen2.5-0.5B Q4_K_M, 2,048 context, output produced. |
| Windows NVIDIA CUDA | Managed GGUF runtime plus installed-library discovery | In 0.4.1: RTX 3090, Qwen2.5-0.5B Q4_K_M, 25 GPU layers, 2,048 context; generation and two-turn chat with clean exit. In 0.4.4: Qwen2.5-14B Q4_K_M completed a CPU/RTX 4060 split while its tensor payload exceeded the device's reported physical memory. |
| Windows NVIDIA Vulkan | Managed GGUF runtime | RTX 4060 partial CPU/GPU execution; RTX 3090 automatic fallback observed on the preceding release path. |
| Windows Intel UHD 770 Vulkan | Managed GGUF runtime | 25 GPU layers, 2,048 context; nonempty truncated output, not task-quality qualification. |
| Linux CPU | Managed GGUF runtime | Model-link acquisition, runtime installation, generation, and public GitHub package acquisition exercised. |
| macOS / Apple Metal | Adapter implemented | Native Mac inference not verified by this project. |
| Other Intel / AMD / NVIDIA combinations | Dependent on compatible prebuilt runtime and drivers | No blanket hardware-family qualification. |
| Safetensors via Transformers/Accelerate | Compatibility adapter; existing Python/PyTorch required | No general native safetensors qualification claimed here. |
| NPU | Inventory and explicit unsupported request | Numerical execution not implemented. |
| Multiple GPUs or hosts | No full placement/distributed implementation | No pooled-memory claim. |

The guided runner admits one sequence. Automatic connections to Codex, Claude Code, OpenCode, or other external harnesses are not implemented in this application. Magnitude's feature list does not transfer to Aperture.

## A recorded partial-offload case

The Qwen2.5-3B Q4_K_M checkpoint was **2,104,932,768 bytes**. A Windows RTX 4060 trial used **four GPU layers**, retained **2,048-token context**, and generated `42` while driver-reported free VRAM was **1,979,711,488 bytes**. It exceeded available memory, not the card's nominal physical capacity.

That bounded trial establishes the reported split path. It does not establish an optimal layer count, a speed advantage, quality across tasks, or operation of a checkpoint larger than the card's physical memory.

## Release-specific CUDA correction

The earlier `NoBinaryFoundError` remained reproducible with closed worker stdin. Compatible CUDA libraries existed in an installed Ollama directory but were absent from the worker search path. Release 0.4.1 adds bounded discovery and applies the selected directory only to child processes.

The integrated path produced `42` and retained `CEDAR83` across two chat turns on the recorded RTX 3090 configuration. This is a real native check, not a throughput benchmark. It does not demonstrate every CUDA installation layout.

## Current limitations that affect a first run

Native GGUF fit assessment precedes the complete weight-download prompt. The lightweight `--answer-only` result remains provisional. Release 0.4.4 records one checkpoint larger than the selected accelerator's physical memory completing through a CPU/GPU split. That result does not generalize to arbitrary architectures or checkpoints. Automatic fitting may select zero GPU layers; that remains CPU execution.

A legacy Qwen3.5 GGUF RoPE-layout mismatch is retained as a compatibility failure. Missing adapters, unknown topology, and incomplete runs remain visible. NPU execution, remote-range numerical streaming, general quantized-safetensors support, parallel guided sessions, and distributed execution are outside the demonstrated release.

## Evidence and reproducibility

The [version-pinned verification record](https://github.com/BigBirdReturns/aperture/blob/v0.4.4/VERIFICATION.md) names native observations, artifacts, retained failures, and the distinction between free and physical VRAM. Full private machine/run files are not included in the public repository.

The release contains **156 source/control tests**. Its Node 22/24 by Ubuntu/Windows/macOS workflow also checks package installation. Those checks are separate from native inference on a particular host. Public documentation has its own link, command-consistency, responsive-layout, and browser-interaction checks.

[Read the release notes](releases.md), [check the workflows](https://github.com/BigBirdReturns/aperture/actions), or [report your model combination](https://github.com/BigBirdReturns/aperture/issues/new?template=model-support.yml).



## Windows scan resilience in 0.4.4

Windows hardware discovery now runs core CPU, memory, graphics, NPU and external-link observations separately from extended storage and network inventory. The two bounded groups run concurrently. If the extended provider stalls, Aperture retains the completed core facts and marks the record partial; it reports the whole operating-system inventory unavailable only when both groups fail. One PnP enumeration supplies both NPU and external-link rows.

The release qualification returned complete inventory on the separate Windows host in 7.946 seconds after those providers had already been exercised. That is an observed warm-provider result, not a clean-machine latency guarantee. The preexisting numerical and permission paths are unchanged.

## Additional public-package passage

The published 0.4.3 package was also exercised from a new npm cache and an empty Aperture home on a separate Core Ultra 5 Windows x64 host. The fixed 0.5B Q4_K_M artifact completed pre-download native fit, provider-hash verification, CUDA generation with 25 observed GPU layers at 2,048 context, a two-turn context-retention check, and a clean exit. The selected GPU was idle before the run, while an unrelated workload on the host's other GPU remained in place. The [public receipt](https://github.com/BigBirdReturns/aperture/blob/main/verification/windows-public-first-use-20260905.json) excludes local paths, prompts, GPU UUIDs, and model weights.

The first detailed Windows operating-system inventory timed out even though NVIDIA discovery and the numerical path remained available. A subsequent full refresh succeeded. Release 0.4.4 isolates core hardware discovery from extended storage and network providers so a slow extended query cannot erase CPU, memory, graphics, NPU, and external-link observations. This repair is not part of the historical 0.4.3 package passage described above.

## Admission and regression checks in 0.4.3

The ordinary Windows runner returned `42` with the fixed 0.5B Q4_K_M checkpoint on CPU and RTX 4060 CUDA, preserving 2,048 context and reading back zero and 25 GPU layers respectively. A CPU chat retained a public badge code across two turns and exited cleanly. Integrity hashing preceded final native assessment. The pinned 14B target checked 50 placements and refused before acquisition under the observed constrained budgets. This remains a refusal, not beyond-physical-memory inference. See the version-pinned verification record for exact boundaries.

## Fresh installation in 0.4.3

A Windows x64 empty-home and empty-npm-cache run installed the pinned runtime, downloaded and hash-verified the original 491,400,032-byte 0.5B checkpoint, and generated `42` on CPU with 2048 context and one sequence. No existing managed runtime or model was reused. Windows and Node were already installed. This is separate from GPU and beyond-physical-memory qualification.
