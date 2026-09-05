# Understand memory and placement

Aperture evaluates supported local execution paths for your selected model. A checkpoint larger than currently free VRAM is not automatically discarded. Whether a particular configuration can load depends on its working memory, the runtime's supported placement, and the resources available at that time.

## Three memory quantities

**Physical GPU memory** is the capacity of the accelerator. **Available GPU memory** is the portion reported as available now. **The execution budget** is the smaller amount admitted after reservations and other limits. A checkpoint can exceed the second or third quantity without exceeding the first.

System RAM, GPU memory, disk storage, and pagefile capacity are not equivalent resources. Separate GPUs do not become one address space simply because their capacities can be added. Integrated and unified-memory graphics share a pool with the CPU, so their allocations must not be counted twice.

## What CPU/GPU split means here

For compatible GGUF models, the managed `node-llama-cpp` runtime can place a subset of layers on one selected accelerator and execute remaining layers on the CPU. The full checkpoint stays on local or mounted storage. This is ordinary split execution through the existing runtime, not a claim that all computation is streamed through a small GPU window.

The working set also needs context state, activations, runtime workspace, and buffers. Context and simultaneous sequences change that requirement. A file-size comparison is useful for orientation but is not an admission proof. Memory mapping does not turn disk storage into fast RAM.

A result with **zero GPU layers is CPU execution**, even when the CUDA or Vulkan backend initialized. A larger model running after other applications release memory is also a different test from a checkpoint exceeding physical GPU capacity.

## The current assessment sequence

The scanner prints a provisional explanation. **In 0.4.3, the native GGUF assessment runs before the weight-download prompt.** It reads at most 8 MiB per selected shard and 64 MiB total, then evaluates fixed-context layer placements against reserved budgets. A non-fitting or unavailable result stops acquisition. After acquisition and complete integrity hashing, each generation, chat launch and experiment trial receives a fresh assessment before loading. Actual loading retains native safety checks and verifies the assessed placement.

This means an early candidate answer is not a guarantee that a large download will lead to a successful launch. Existing services can consume RAM or VRAM between inspection and loading. Loading still needs a current resource check even after a future pre-download check is added.

## Explicit controls

`--backend` selects the route; `--device` selects one native device; `--gpu-layers` fixes a layer count for supported GGUF execution. `--context` sets tokens per sequence, and `--threads` controls CPU worker threads. Use [the reference](reference.md) for exact syntax.

The automatic route may explain a CUDA-to-Vulkan or CPU fallback. An explicitly requested backend is not silently replaced. Vulkan indexes refer to native Vulkan enumeration, not NVIDIA's index order. Ambiguous name matches are refused.

Automatic fit is conservative and can select zero GPU layers. A manually chosen layer count is a controlled configuration, not proof of optimal placement. Do not copy an arbitrary layer count from another machine and assume it is safe for yours.

## What has been demonstrated

The published record includes Qwen2.5-3B Q4_K_M on an RTX 4060 with four GPU layers and 2,048-token context while the checkpoint exceeded reported **free** VRAM. The checkpoint was still smaller than the card's physical capacity.

A successful model execution beyond that card's physical memory capacity remains unverified. A separate 14B assessment returned no admissible configuration under constrained budgets; that observation was not a generation test or an exhaustive proof that other placements cannot work. No throughput or model-quality conclusion follows from it.

The [verification source](https://github.com/BigBirdReturns/aperture/blob/v0.4.3/VERIFICATION.md) separates native observations from control tests. This distinction should remain intact in screenshots, tutorials, and benchmark reports.

## When the budget is insufficient

Keep the requested artifact and context unchanged while identifying which limit binds. You can choose to release resources used by your own applications, select a supported device, or explicitly create a different configuration. Aperture does not stop unrelated servers, change drivers, or silently substitute a smaller model to obtain a successful result.
