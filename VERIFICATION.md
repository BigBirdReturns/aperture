# Aperture verification record

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

`npm test` exercises 156 source/control cases. `node scripts/package-smoke.mjs` builds a package, installs it in an isolated npm cache and checks its actual version. The GitHub workflow runs those checks on Node 22 and 24 across Ubuntu, Windows and macOS. Consult the workflow at the release commit for its result; a green control job does not establish native inference on that hosted platform.

## CUDA discovery correction, 0.4.1

The earlier Windows `NoBinaryFoundError` was reproduced with closed worker stdin. The pinned binary imports CUDA 13 cuBLAS; its fallback imports CUDA 12 cuBLAS/cudart. The required libraries were absent from the worker search path but present in the existing Ollama installation. Supplying that directory only to a child process allowed the unchanged runtime to initialize and generate.

The integrated discovery path was then exercised without a manual PATH change: Qwen2.5-0.5B Q4_K_M (the SHA-256 above), context 2048, RTX 3090, 25 observed GPU layers, actual output `42`, exit 0. A subsequent native CUDA chat returned `CEDAR83` on two turns at the same context and exited cleanly. These are bounded inference and continuity checks, not throughput or general quality benchmarks. Library discovery is exercised natively on this Windows host; other installed-prefix layouts have control coverage. This correction does not establish execution above nominal VRAM capacity.

## Native fit-before-download candidate (September 5, 2026)

Built on commit `f6b6e00c4c473d012922f8cdf5d25fe76a476f86`, preserving the Windows CUDA-library discovery repair. This section describes candidate code, not a change to the existing 0.4.1 release asset. All 125 source/control tests passed on Windows x64.

The ordinary setup path assessed and then generated `42` with the original Qwen2.5-0.5B Q4_K_M checkpoint on CPU, retaining context 2048 and one sequence. A second ordinary setup run used CUDA on the RTX 4060: the estimator selected 25 GPU layers, and execution read back 25 layers and context 2048 before returning `42`. The ordinary chat menu retained the badge code ORCHID47 across two turns on CPU at context 2048 and exited with code 0. These are execution/continuity observations, not quality or speed benchmarks.

The pinned Qwen2.5-14B Q4_K_M three-shard target at revision `b466e1f8c07172155743e8e1307507d8a4f91fbd` went through ordinary setup with an explicit RTX 4060 Vulkan request, context 2048 and one sequence. The native estimator accounted for 8,982,142,976 tensor bytes and assessed all 50 layer counts. None fit the then-current reserved budgets. The CLI exited 2 with MODEL_DOES_NOT_FIT before the weight-download prompt or acquisition. No full 14B checkpoint was downloaded and no 14B inference occurred. This proves the ordering/refusal behavior for the measured conditions, not beyond-physical-VRAM generation.

The estimator reads bounded, private temporary prefixes through Aperture's existing transport protections. The pinned runtime parses complete tensor tables from those local snapshots; it does not fetch remote weights itself. Prefix snapshots and transient jobs are removed afterward. Native estimates, full checkpoint hash verification, and actual model/context loading remain separate stages. NPU numerical execution, distributed inference, arbitrary GGUF support and universal clean-machine qualification remain outside this change.

## Integrated release acceptance, 0.4.2 (September 5, 2026)

The merged fit-before-download implementation was independently exercised from a fresh Windows x64 checkout. Its initial CLI trace showed that final admission still preceded complete hashing. The nearest repair shares a final-admission helper between generation and chat: verify every local file, then refresh native fit, then pin the returned placement for loading. Each experiment trial repeats this sequence from the original request. A later pre-load refusal retains earlier results in the run summary.

On this successor, the exact 491,400,032-byte Qwen2.5-0.5B Q4_K_M checkpoint above completed ordinary setup and generation on CPU (zero GPU layers) and RTX 4060 CUDA (25 GPU layers). Both preserved context 2048 and one sequence and returned `42` to the arithmetic prompt. Recorded integrity timestamps precede their native assessment timestamps. The ordinary CPU chat returned `ORCHID47` on both turns and exited 0 at the same context. The existing pinned native runtime and local checkpoint were reused; this is not a fresh-machine runtime installation test. An earlier exploratory short instruction produced truncated nonempty text, not task-qualified output; no general quality or speed claim follows from the selected smoke prompts.

The final ordinary remote-model setup assessed the pinned three-shard Qwen2.5-14B Q4_K_M checkpoint on RTX 4060 Vulkan. All 50 layer configurations failed the then-current budgets. Tensor payload was 8,982,142,976 bytes; requested context 2048 and one sequence were unchanged. At 16:33:32 UTC, the displayed nearest candidate used seven GPU layers and required 7,671,871,488 RAM bytes and 2,057,920,512 GPU bytes against budgets of 3,703,444,684 and 1,080,452,711 bytes. Setup exited 2 with `MODEL_DOES_NOT_FIT` before the acquisition prompt; no full 14B weights were acquired and no 14B generation occurred.

All 133 Windows source/control tests passed, including eight added final-admission tests. The controls cover integrity-before-assessment, corrupt/missing checkpoints, consent, independent repeat assessment, and preservation of a first trial when the second is refused. Final documentation checks passed across 12 HTML pages and 378 local links. Hosted and public-package installation results belong to the release's workflow and attached verification assets; private paths, prompts beyond these public smoke cases, UUIDs and model weights are not published.

## 0.4.3: fresh runtime installation (September 5, 2026)

A real empty-home, empty-npm-cache Windows x64 run of public 0.4.2 stalled when its runtime installer inherited the interactive controller input. A bounded native npm-version probe reproduced the distinction: inherited stdin timed out at 7 seconds; ignored stdin exited 0 in 101 milliseconds. The stalled installer belonging to this test was terminated; unrelated processes were not changed.

Managed commands now inherit stdout/stderr only and receive closed stdin. The added regression keeps the parent input open and confirms child EOF delivery and both output streams. It fails on the released implementation; all 135 source/control tests pass with the correction.

A new isolated npm archive installation using the corrected code started with no application home, runtime, model cache or npm cache. It installed node-llama-cpp 3.20.0 (123 packages), assessed the original Qwen2.5-0.5B-Instruct Q4_K_M before acquisition, downloaded and independently SHA-256-verified all 491,400,032 bytes, assessed again after integrity checking, and generated `42` on CPU. Requested and observed context were 2048; one sequence and zero GPU layers were retained. Generation wall time was 7.171443 seconds for three native output tokens, not a throughput qualification. The complete command exited 0.

The tested candidate archive still carried the 0.4.2 version field; 0.4.3 changes version/documentation alongside the same corrected executable module. The native result is separate from subsequent final-package installation checks. This was an empty application installation on an existing Windows/Node installation, not a clean OS image or another person's hardware. A new chat execution call was blocked before starting and contributes no new chat evidence. Earlier CPU/CUDA chat observations remain historical. Beyond-physical-VRAM execution, NPU execution and native Mac inference remain unverified.

## Public 0.4.3 first-use passage on a separate Windows host

The published 0.4.3 tarball was installed through a new npm cache and an empty Aperture application home on a second Windows x64 host. The selected artifact remained Qwen2.5-0.5B-Instruct Q4_K_M at revision `9217f5db79a29953eb74d5343926648285ec7e67`, SHA-256 `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`, 2,048-token context, and one sequence. Aperture installed node-llama-cpp 3.20.0 in its isolated home, discovered compatible CUDA 13 libraries in the host's existing Ollama installation, and applied that path only to its child processes.

Before downloading the complete checkpoint, native assessment used bounded model bytes and selected 25 GPU layers. The assessment recorded `checkpointAcquired: false`. Aperture then downloaded all 491,400,032 bytes, verified the provider SHA-256, repeated admission after integrity checking, loaded the model on the selected idle RTX 3090, read back 25 GPU layers and 2,048 context, and generated the requested exact response. A separate ongoing CUDA chat retained a supplied value across two turns and exited with code 0. No Aperture-owned process remained afterward. A workload already running on the host's other RTX 3090 was neither stopped nor moved.

The first detailed Windows inventory attempt exceeded the release's monolithic 25-second PowerShell timeout. NVIDIA inventory remained available and the model passage completed, while a later refresh obtained the full CPU, memory, graphics, NPU, storage, link, and network record. This exposed a first-use presentation defect: one slow extended provider could discard otherwise available core Windows observations.

The unreleased scan candidate splits core and extended Windows inventory into independently bounded concurrent groups, performs one PnP enumeration for NPU and external-link rows, preserves core facts when extended storage or network inventory fails, and reports the whole inventory as unavailable only when both groups fail. All 141 branch source and control tests pass, including three public-receipt controls. On the same host, a subsequent real scan returned the complete inventory in 7.946 seconds with no errors. The providers had already been exercised, so that duration is an observed warm-provider result rather than a clean-machine latency guarantee.

The [public receipt](verification/windows-public-first-use-20260905.json) excludes local paths, prompts, GPU UUIDs, and model weights. The complete records remain in local custody. This passage adds one Windows machine and one supported model to the evidence. It does not establish broad task quality, a decode-only throughput result, native Mac support, NPU execution, or successful inference with a checkpoint larger than the selected GPU's physical capacity.
## 0.4.4 release qualification: bounded Windows scan and CUDA regression

The 0.4.4 candidate separates core Windows CPU, memory, graphics, NPU and external-link discovery from extended disk, volume, partition and network inventory. The bounded groups run concurrently and share one PnP enumeration. A failed extended group now leaves completed core facts visible, while both groups must fail before the operating-system inventory is classified unavailable. On the second Windows host, the repaired scan returned complete observations with no errors in 7.946 seconds after the providers had already been exercised. That duration is a warm-provider observation, not a clean-machine latency guarantee.

A 68,790-byte candidate package with SHA-256 `268aef0268db0cd008678509d1eabed7dd72c432387254c21c8af66a30feb833` was installed through a new npm cache and empty Aperture home. It installed node-llama-cpp 3.20.0 with 123 packages, retained Qwen2.5-0.5B-Instruct Q4_K_M at 491,400,032 bytes and SHA-256 `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`, preserved 2,048 context and one sequence, and initialized CUDA on the selected idle RTX 3090. Native fit selected 25 GPU layers; loading read back CUDA, 25 GPU layers and 2,048 context. A subsequent arithmetic regression generated `42` and exited 0. No Aperture-owned process remained, and the unrelated workload on the other GPU remained in place.

The first operator attempt referenced a stale local model path and exited 2 before runtime installation. After correcting that path, an initial generation completed but did not follow an arbitrary exact-phrase instruction; it remains generated but not task-qualified. The arithmetic regression is the narrow expected-output check. Neither result establishes broad task quality, a decode-only throughput figure, native Mac support, NPU execution, or successful execution above physical GPU capacity. The sanitized release-candidate receipt is retained with the candidate assets; private paths, prompts, GPU UUIDs and weights are excluded.

## System-headroom watchdog and physical-capacity candidate

A Qwen2.5-14B Q4_K_M execution exposed a serving-time policy defect after successful fit, integrity verification, model loading, and context allocation. The worker compared process RSS with the planned CPU allocation. Memory-mapped checkpoint pages therefore appeared to consume the allocation even when Windows still retained the plan's system reserve. The run reached generation and was aborted with the untyped message `RAM watchdog limit`.

The candidate replaces that proxy with a serialized system-headroom monitor. It compares current OS-available physical memory with the plan's explicit reserve; Linux also retains any cgroup-v2 ceiling used at admission. Process RSS is recorded only as diagnostic evidence. Missing required cgroup evidence or actual reserve pressure produces a typed failure. The same guard applies to one-answer workers and persistent chat, while native memory checks, fixed context, and assessed layer readback remain unchanged.

The exact failed 28-layer plan was replayed after the repair. Peak process RSS reached 9,246,138,368 bytes, above the former 7,834,813,235-byte cutoff, while minimum available system memory was 4,643,037,184 bytes against a 1,566,962,647-byte reserve. The RTX 4060 run retained 2,048-token context, 28 observed GPU layers, and returned `42`. A separate pressure control set an intentionally impossible reserve and failed on its first sample with typed `SYSTEM_MEMORY_PRESSURE`.
The complete pinned three-shard checkpoint was then independently SHA-256 verified and run through the ordinary candidate CLI. Its 8,982,142,976-byte tensor payload exceeds the RTX 4060's 8,585,740,288 driver-reported physical bytes by 396,402,688 bytes. Native fit selected 30 of 49 layers for the 4060 and the remainder for CPU execution. The model loaded, preserved one sequence and 2,048-token context, and returned `42`; load was 5.2889 seconds and generation was 1.4034 seconds for three native output tokens.

The run's internal monitor sampled 34 times. Minimum available system memory was 4,188,659,712 bytes against a 1,892,083,630-byte reserve, while peak process RSS was 9,228,959,744 bytes. An independent sampler observed at least 7,304,437,760 bytes of Windows commit headroom, up to 7,144 MiB in use on the 4060, and zero utilization on the separate RTX 3090. This establishes one real CPU/GPU execution above the selected GPU's physical capacity. It does not establish optimal placement, general model compatibility, task quality, or a controlled throughput advantage.

All 154 source/control tests and the clean package-install check passed. A persistent CPU chat also retained the word `ORCHID` across two turns and exited 0 at context 2048. Compact public evidence is in `verification/windows-physical-capacity-20260905.json`.

## Separate Linux public first-use passage

The published 0.4.3 tarball also completed an empty-Aperture-home and empty-npm-cache passage on a separate physical Linux x64 host. Aperture installed its pinned native runtime, downloaded and provider-hash-verified a new copy of the 491,400,032-byte Qwen2.5-0.5B Q4_K_M checkpoint, repeated native fit, and generated `42` on CPU at 2,048-token context. The command exited 0. The host already had Node.js and npm; this is not an unrelated public tester or a clean operating-system image. The path-free receipt is `verification/linux-public-first-use-20260905.json`.
