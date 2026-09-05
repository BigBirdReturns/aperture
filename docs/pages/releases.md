# Releases and maintenance

Documentation here targets **Aperture 0.4.4**. The runtime package is versioned separately from documentation-only changes. Updating this website does not retroactively turn a development probe into released functionality.


## 0.4.4: bounded Windows hardware discovery

Core Windows observations now survive a slow extended storage or network provider. CPU, memory, display, NPU and external-link discovery run separately from disks, volumes, partitions and physical network inventory, with independent bounds and one shared PnP enumeration. The release retains the selected model, native-fit, download, integrity, CUDA and chat behavior from 0.4.3.

A separate public-package passage recorded 0.4.3 clean-cache installation, pre-download fit, provider-hash verification, CUDA generation, two-turn context retention and clean exit on an additional Windows host. That observation motivated the scan repair and remains separately attributable.

## 0.4.3: fresh runtime installation

Managed installation commands now receive closed stdin while their output remains visible. This fixes a reproduced Windows first-use stall caused by inheriting the interactive controller input. An empty application home and npm cache completed pinned runtime installation, model acquisition, integrity verification, native assessment and CPU generation at 2048-token context. Existing Windows and Node installations were used; universal clean-machine support is not claimed. See the version-pinned verification record.

## 0.4.2: native fit before download

Remote GGUF execution now checks the selected model with the pinned native runtime before asking to download complete weights. Local generation, chat and every experiment trial verify integrity before refreshing native admission. Loaded placement and context are checked, and a failed later trial does not discard earlier results. The original 0.4.1 CUDA discovery repair is retained.

Windows checks preserve the original 0.5B checkpoint and 2,048-token context. The larger pinned 14B checkpoint remains a separately recorded refusal under constrained memory, not a successful beyond-physical-VRAM run.

## 0.4.1 · Windows CUDA library discovery

Released September 5, 2026 UTC. Commit `f6b6e00c4c473d012922f8cdf5d25fe76a476f86`.

This correction discovers compatible installed CUDA libraries from bounded toolkit and Ollama locations, then applies the chosen directory to native child processes. It does not download DLLs, replace drivers, modify the system PATH, or change the selected model or context.

Recorded acceptance includes Qwen2.5-0.5B Q4_K_M generation on RTX 3090 CUDA with 25 GPU layers and 2,048 context, followed by a two-turn chat and clean exit. See [the release](https://github.com/BigBirdReturns/aperture/releases/tag/v0.4.1) and [verification](https://github.com/BigBirdReturns/aperture/blob/v0.4.1/VERIFICATION.md).

## 0.4.0 · Hardware-aware model runner

Released September 5, 2026 UTC. Commit `463aa08a0f70cf9cf34cea92a886aaa2200d1a5b`.

This release brought hardware discovery into model selection and execution, including integrated/discrete graphics, neural-device candidates, RAM and commit observations, storage, and available link information. It added isolated device binding, explicit fallback reporting, non-additive shared-memory budgets, and observed layer/context reporting.

The retained native record includes CPU, Intel Vulkan, NVIDIA Vulkan, Linux acquisition and execution, and a partial-offload trial above the 4060's **available** VRAM. [Versioned release record](https://github.com/BigBirdReturns/aperture/releases/tag/v0.4.0).

## In development: physical-capacity execution

The pinned 14B Q4_K_M checkpoint has now completed candidate execution on the RTX 4060 at 2,048-token context and one sequence. Its 8,982,142,976-byte tensor payload exceeded the device's reported physical memory; native fit placed 30 of 49 layers on the 4060 and the model returned `42`. The separate 0.4.2 refusal under constrained budgets remains valid evidence of pre-download admission.

The run also exposed and repaired an RSS-based watchdog false positive. The candidate now protects the plan's system-memory reserve using current physical availability, and Linux retains cgroup-v2 headroom when it controlled admission. This code and evidence remain unreleased until a successor versioned package is issued.

## Updating and rolling back

Use a version-pinned command from the release you intend to run. Unpinned GitHub `main` follows development changes. Selecting a different CLI version does not delete model caches or rewrite original model files. Use a fresh `--home` for an isolated evaluation when you do not want to share managed state.

Do not replace an existing release asset with different bytes under the same name. Fixes to executable behavior belong in a new version. Documentation and metadata corrections should identify the runtime version they describe.

## Contributing

Changes should connect a user-visible behavior to a reproducible test. Artifact identity, explicit requirements, permission boundaries, and measured-versus-predicted distinctions must survive the change. Start with [CONTRIBUTING.md](https://github.com/BigBirdReturns/aperture/blob/main/CONTRIBUTING.md). New backends need native evidence before they appear as verified in the support matrix.

The controller is MIT-licensed. Runtime packages and model checkpoints retain their own licenses and access conditions. Magnitude inspired the compact setup experience; Aperture is an independent controller, not a published Magnitude fork or an inheritance of all its integrations.
