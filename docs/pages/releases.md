# Releases and maintenance

Documentation here targets **Aperture 0.4.5**. The runtime package is versioned separately from documentation-only changes. Updating this website does not retroactively turn a development probe into released functionality.

## 0.4.5: reduced hardware support receipts

A new `aperture support` command turns the approved hardware inventory into a separate `aperture-support/1` JSON receipt. It retains CPU topology, RAM and allocation headroom, integrated and discrete graphics, NPU inventory, drivers, storage classes and capacities, external-link observations, runtime presence, scan status, and explicit unmeasured fields needed to investigate fit and backend failures.

The reduction excludes host and user names, local paths and mount labels, stable device and partition identifiers, GPU UUIDs, drive product names and serials, network adapter names and addresses, model locations, prompts, generated text, credentials, and environment variables. Provider errors are collapsed to bounded classes. Labels shaped like PCI addresses, PnP identifiers, MAC addresses, or absolute paths are withheld. The command accepts scan, destination, and output controls only; it performs no model access, network request, runtime installation, inference, stress test, or automatic upload.

The receipt is not anonymous. Hardware models, exact capacities, drivers, current headroom, scan timing, and its timestamp can still fingerprint a machine. The output therefore carries an explicit review-required classification. The hosted package matrix exercises the installed command on Windows, Linux, and macOS and rejects forbidden identifier fields, host names, home directories, and temporary paths. This qualifies the receipt mechanism, not external native inference or new backend compatibility.

The release process also gains a guarded publisher. Release-branch builds must produce the same npm archive twice. A reviewed publication manifest fixes the expected package SHA-256 and byte count before merge. The main-branch publisher reruns tests and package installation, rebuilds twice, refuses an existing tag or release, creates the versioned assets, and dispatches post-publication documentation verification. Existing release assets remain immutable.

## 0.4.4: bounded Windows hardware discovery

Core Windows observations survive a slow extended storage or network provider. CPU, memory, display, NPU and external-link discovery run separately from disks, volumes, partitions and physical network inventory, with independent bounds and one shared PnP enumeration.

Generation and persistent chat protect the admitted system-memory reserve using current physical availability; Linux also retains an admission-time cgroup-v2 ceiling. Process RSS remains diagnostic, which corrects a reproduced false abort on memory-mapped model pages. The pinned Qwen2.5-14B Q4_K_M tensor payload exceeded the RTX 4060's reported physical memory by 396,402,688 bytes. Qualified automatic CPU/GPU splits selected 27 or 28 of 49 layers as current headroom changed, preserved 2,048-token context and one sequence, and returned `42` without selecting the separate 3090 for model execution.

A separate public-package passage recorded 0.4.3 clean-cache installation, pre-download fit, provider-hash verification, CUDA generation, two-turn context retention and clean exit on an additional Windows host. That observation motivated the scan repair and remains separately attributable. The 0.4.4 physical-capacity result establishes one supported configuration, not broad model compatibility, optimal placement, task quality, or throughput leadership.

## 0.4.3: fresh runtime installation

Managed installation commands receive closed stdin while their output remains visible. This fixes a reproduced Windows first-use stall caused by inheriting the interactive controller input. An empty application home and npm cache completed pinned runtime installation, model acquisition, integrity verification, native assessment and CPU generation at 2048-token context. Existing Windows and Node installations were used; universal clean-machine support is not claimed. See the version-pinned verification record.

## 0.4.2: native fit before download

Remote GGUF execution checks the selected model with the pinned native runtime before asking to download complete weights. Local generation, chat and every experiment trial verify integrity before refreshing native admission. Loaded placement and context are checked, and a failed later trial does not discard earlier results. The original 0.4.1 CUDA discovery repair is retained.

Windows checks preserve the original 0.5B checkpoint and 2,048-token context. The larger pinned 14B checkpoint remains a separately recorded refusal under constrained memory, distinct from the later successful 0.4.4 split.

## 0.4.1 · Windows CUDA library discovery

Released September 5, 2026 UTC. Commit `f6b6e00c4c473d012922f8cdf5d25fe76a476f86`.

This correction discovers compatible installed CUDA libraries from bounded toolkit and Ollama locations, then applies the chosen directory to native child processes. It does not download DLLs, replace drivers, modify the system PATH, or change the selected model or context.

Recorded acceptance includes Qwen2.5-0.5B Q4_K_M generation on RTX 3090 CUDA with 25 GPU layers and 2,048 context, followed by a two-turn chat and clean exit. See [the release](https://github.com/BigBirdReturns/aperture/releases/tag/v0.4.1) and [verification](https://github.com/BigBirdReturns/aperture/blob/v0.4.1/VERIFICATION.md).

## 0.4.0 · Hardware-aware model runner

Released September 5, 2026 UTC. Commit `463aa08a0f70cf9cf34cea92a886aaa2200d1a5b`.

This release brought hardware discovery into model selection and execution, including integrated/discrete graphics, neural-device candidates, RAM and commit observations, storage, and available link information. It added isolated device binding, explicit fallback reporting, non-additive shared-memory budgets, and observed layer/context reporting.

The retained native record includes CPU, Intel Vulkan, NVIDIA Vulkan, Linux acquisition and execution, and a partial-offload trial above the 4060's **available** VRAM. [Versioned release record](https://github.com/BigBirdReturns/aperture/releases/tag/v0.4.0).

## Updating and rolling back

Use a version-pinned command from the release you intend to run. Unpinned GitHub `main` follows development changes. Selecting a different CLI version does not delete model caches or rewrite original model files. Use a fresh `--home` for an isolated evaluation when you do not want to share managed state.

Do not replace an existing release asset with different bytes under the same name. Fixes to executable behavior belong in a new version. Documentation and metadata corrections should identify the runtime version they describe.

## Contributing

Changes should connect a user-visible behavior to a reproducible test. Artifact identity, explicit requirements, permission boundaries, and measured-versus-predicted distinctions must survive the change. Start with [CONTRIBUTING.md](https://github.com/BigBirdReturns/aperture/blob/main/CONTRIBUTING.md). New backends need native evidence before they appear as verified in the support matrix.

The controller is MIT-licensed. Runtime packages and model checkpoints retain their own licenses and access conditions. Magnitude inspired the compact setup experience; Aperture is an independent controller, not a published Magnitude fork or an inheritance of all its integrations.
