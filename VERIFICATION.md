# Aperture 0.4.0 verification

Observed September 4, 2026 Pacific / September 5 UTC. Native execution is separate from control tests and package installation. Full local records contain machine identifiers and paths and were not published.

## Native observations

| Path exercised | Model and requirement | Observed result |
| --- | --- | --- |
| Windows CPU, existing local GGUF, isolated runtime installation | Qwen2.5-0.5B Q4_K_M; context 2048 | Actual output `42`; zero GPU layers. Initial baseline run used v0.3.0 before this extension. |
| Windows Intel UHD 770 through Vulkan | Same 491,400,032-byte model; context 2048; 25 requested GPU layers | Generated nonempty text; 25 GPU layers and context 2048 read back. Load 4.5898 s, generation 5.2982 s. The 8-token response was truncated; this is execution evidence, not task-quality qualification. |
| Linux first-run URL acquisition and runtime installation | Exact public Qwen2.5-0.5B file; context 2048 | Downloaded and hashed the selected file, installed the pinned runtime, generated `42` on CPU. |
| Linux fresh public GitHub npm acquisition | Same saved model and context; implementation `0f8215d06ef6e263a87564ae67ae23c87d282148` | Public `npx --package=github:BigBirdReturns/aperture#hardware-completion-20260904 aperture run ...` completed; output `42`; 3 native output tokens; 0.84 s generation wall clock. |
| Windows partial CPU/GPU execution on RTX 4060 | Qwen2.5-3B Q4_K_M, 2,104,932,768 bytes; context 2048; four requested GPU layers | Driver-reported free VRAM 1,979,711,488 bytes, below checkpoint size. Actual output `42`, four GPU layers, context 2048; load 4.2570 s, generation 2.5389 s; 3 native output tokens. |
| Windows public GitHub npm acquisition, ordinary consent-driven wizard | Qwen2.5-0.5B; visible default context 4096; automatic backend | The pinned CUDA backend did not initialize; the runner explicitly selected Vulkan on RTX 3090. Output `42`; 25 GPU layers; context 4096. |

Qwen2.5-0.5B artifact SHA-256: `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`.

Qwen2.5-3B artifact SHA-256: `626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d`. Upstream revision: `7dabda4d13d513e3e842b20f0d435c732f172cbe` in `Qwen/Qwen2.5-3B-Instruct-GGUF`.

The partial-offload observation concerns free VRAM, not a checkpoint exceeding the 4060's nominal 8 GB physical capacity. The preceding automatic-fit trial completed with zero GPU layers; the four-layer trial was explicitly configured. These sequential observations do not establish a speedup, optimal placement, or broad architecture compatibility. Model weights and requested context were not changed between those trials.

## Hardware coverage

Complete OS inventory was observed on an i5-13500T Windows desktop, a Core Ultra 5 125H Windows laptop, and an i7-6770HQ Linux NUC. The scan exposed UHD 770, Arc integrated graphics, Iris Pro 580, the laptop's AI Boost compute accelerator, physical and available RAM, Windows commit headroom, disks, volumes and available link observations. Link rates are not bandwidth benchmarks. NPU discovery is not NPU inference. No native Mac inference test has been performed.

## Retained failures and boundaries

Windows GPU workers initially stalled during runtime import when inheriting the controller's open stdin. Giving numerical workers an ignored stdin resolved the observed path. A real subprocess regression checks EOF delivery. The selected legacy Qwen3.5 blob was rejected by the pinned runtime because its RoPE section array had three entries and that runtime expected four; no original file was rewritten. Runtime failures, missing adapters, unknown topology and zero-layer CPU placements remain visible. NPU execution, distributed inference, arbitrary checkpoint compatibility and complete multi-GPU placement are not claimed.

## Repeatable checks

`npm test` exercises 97 source/control cases. `node scripts/package-smoke.mjs` builds a package, installs it in an isolated npm cache and checks its actual version. The GitHub workflow runs those checks on Node 22 and 24 across Ubuntu, Windows and macOS. Consult the workflow at the release commit for its result; a green control job does not establish native inference on that hosted platform.
