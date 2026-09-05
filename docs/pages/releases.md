# Releases and maintenance

Documentation here targets **Aperture 0.4.1**. The runtime package is versioned separately from documentation-only changes. Updating this website does not retroactively turn a development probe into released functionality.

## 0.4.1 · Windows CUDA library discovery

Released September 5, 2026 UTC. Commit `f6b6e00c4c473d012922f8cdf5d25fe76a476f86`.

This correction discovers compatible installed CUDA libraries from bounded toolkit and Ollama locations, then applies the chosen directory to native child processes. It does not download DLLs, replace drivers, modify the system PATH, or change the selected model or context.

Recorded acceptance includes Qwen2.5-0.5B Q4_K_M generation on RTX 3090 CUDA with 25 GPU layers and 2,048 context, followed by a two-turn chat and clean exit. See [the release](https://github.com/BigBirdReturns/aperture/releases/tag/v0.4.1) and [verification](https://github.com/BigBirdReturns/aperture/blob/v0.4.1/VERIFICATION.md).

## 0.4.0 · Hardware-aware model runner

Released September 5, 2026 UTC. Commit `463aa08a0f70cf9cf34cea92a886aaa2200d1a5b`.

This release brought hardware discovery into model selection and execution, including integrated/discrete graphics, neural-device candidates, RAM and commit observations, storage, and available link information. It added isolated device binding, explicit fallback reporting, non-additive shared-memory budgets, and observed layer/context reporting.

The retained native record includes CPU, Intel Vulkan, NVIDIA Vulkan, Linux acquisition and execution, and a partial-offload trial above the 4060's **available** VRAM. [Versioned release record](https://github.com/BigBirdReturns/aperture/releases/tag/v0.4.0).

## In development · Native fit before acquisition

The next admission change moves exact native fitting ahead of the complete remote-weight download. A metadata-only probe has identified a genuine first-use failure under constrained memory budgets. The ordinary 0.4.1 command does not yet perform that probe before downloading.

The intended acceptance is an admitted small checkpoint and a correctly explained resource shortfall for the larger target under the constrained conditions, followed by rechecking resources at actual load time. This is a release requirement, not a feature currently promised by the install command.

## Updating and rolling back

Use a version-pinned command from the release you intend to run. Unpinned GitHub `main` follows development changes. Selecting a different CLI version does not delete model caches or rewrite original model files. Use a fresh `--home` for an isolated evaluation when you do not want to share managed state.

Do not replace an existing release asset with different bytes under the same name. Fixes to executable behavior belong in a new version. Documentation and metadata corrections should identify the runtime version they describe.

## Contributing

Changes should connect a user-visible behavior to a reproducible test. Artifact identity, explicit requirements, permission boundaries, and measured-versus-predicted distinctions must survive the change. Start with [CONTRIBUTING.md](https://github.com/BigBirdReturns/aperture/blob/main/CONTRIBUTING.md). New backends need native evidence before they appear as verified in the support matrix.

The controller is MIT-licensed. Runtime packages and model checkpoints retain their own licenses and access conditions. Magnitude inspired the compact setup experience; Aperture is an independent controller, not a published Magnitude fork or an inheritance of all its integrations.
