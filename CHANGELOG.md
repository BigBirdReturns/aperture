# Changelog

## 0.4.5

Add a permissioned `aperture support` command that scans the same CPU, RAM, integrated and discrete graphics, NPU, storage, link, and runtime inventory used by planning, then emits a reduced JSON receipt for external support. The receipt excludes host and user names, local paths and mount labels, stable device and partition identifiers, GPU UUIDs, drive product names and serials, network adapter names and addresses, model locations, prompts, output, credentials, and environment variables. Provider failures are reduced to bounded classes, and identifier-shaped labels are withheld. It retains hardware classes, drivers, capacities, current headroom, scan status, and explicit unmeasured fields. The file is not anonymous and must be reviewed before sharing.

The installed-package smoke path executes the support command across the hosted Windows, Linux, and macOS matrix and rejects forbidden identifier fields, the runner host name, home directory, and temporary paths. A guarded release workflow builds the package twice on the release branch and again before publication, verifies a reviewed package hash and byte count, refuses an existing tag or release, and dispatches post-publication documentation verification.

## 0.4.4

Windows hardware discovery separates core CPU, memory, graphics, neural-device and external-link observations from extended storage and network inventory. Both groups run concurrently with independent bounds, so a slow extended provider no longer erases core facts. A public 0.4.3 package passage on a separate Windows host also records clean-cache installation, pre-download native fit, provider-hash verification, CUDA generation, two-turn context retention, and clean process release.

Generation and persistent chat protect the plan's reserved system headroom using current physical memory, plus the admitted cgroup-v2 ceiling on Linux, instead of treating process RSS as allocation pressure. This fixes a reproduced false abort caused by memory-mapped checkpoint pages. Qwen2.5-14B Q4_K_M then generated `42` through a CPU/RTX 4060 split at 2,048-token context; its 8,982,142,976-byte tensor payload exceeds the device's reported physical memory. Qualified automatic runs selected 27 or 28 of 49 layers as current headroom changed. This establishes one supported configuration, not arbitrary checkpoint compatibility or a speed claim.

## 0.4.3

Fix fresh native-runtime installation when the interactive controller owns open stdin. Managed commands receive EOF while preserving stdout/stderr. Two regression controls accompany a verified empty-home and empty-cache Windows download-to-answer run with the fixed 0.5B model and 2,048-token context. Existing release assets are unchanged.

## 0.4.2

Native GGUF fit assessment precedes full weight acquisition and repeats after integrity checks before loading. The selected model, context, sequence count, device and assessed GPU layers remain fixed.

## Documentation surface · September 5, 2026

The public site and navigable guides described release 0.4.1, with platform-specific commands, source-format guidance, CLI reference, memory and placement explanation, support evidence, troubleshooting, privacy, and release history. A version-bound Pages build and browser checks kept the site separate from the numerical runtime.

## 0.4.1

Windows CUDA library discovery checks compatible installed toolkit and Ollama directories and applies the selected library path only to child processes. The verification record includes RTX 3090 CUDA generation and two-turn chat at 2,048-token context. No driver, system PATH, model artifact, or requested context was changed by that correction.

## 0.4.0

Hardware inventory, isolated native device selection, shared-memory-aware budgets, explicit backend fallback, and observed layer/context reporting were carried into setup and execution. The recorded 4060 partial-offload trial exceeded available VRAM, not physical GPU capacity.

See [release documentation](docs/pages/releases.md), [native verification](VERIFICATION.md), and [versioned public releases](https://github.com/BigBirdReturns/aperture/releases).
