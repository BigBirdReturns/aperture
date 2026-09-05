# Changelog

## Unreleased

Windows hardware discovery now separates core CPU, memory, graphics, neural-device and external-link observations from extended storage and network inventory. Both groups run concurrently with independent bounds, so a slow extended provider no longer erases core facts. A public 0.4.3 package passage on a separate Windows host also records clean-cache installation, pre-download native fit, provider-hash verification, CUDA generation, two-turn context retention, and clean process release.

Generation and persistent chat now protect the plan's reserved system headroom using current physical memory, plus the admitted cgroup-v2 ceiling on Linux, instead of treating process RSS as allocation pressure. The candidate fixes a reproduced false abort caused by memory-mapped checkpoint pages. Qwen2.5-14B Q4_K_M then generated `42` with 30 of 49 layers on an RTX 4060 at 2,048-token context; its 8,982,142,976-byte tensor payload exceeds the device's reported physical memory. This remains candidate evidence until a successor release is issued.

## 0.4.3

Fix fresh native-runtime installation when the interactive controller owns open stdin. Managed commands receive EOF while preserving stdout/stderr. Two regression controls accompany a verified empty-home and empty-cache Windows download-to-answer run with the fixed 0.5B model and 2048-token context. Existing release assets are unchanged.

## 0.4.2

Native GGUF fit assessment precedes full weight acquisition and repeats after integrity checks before loading. The selected model, context, sequence count, device and assessed GPU layers remain fixed.

## Documentation surface · September 5, 2026

The public site and navigable guides now describe release 0.4.1, with platform-specific commands, source-format guidance, CLI reference, memory and placement explanation, support evidence, troubleshooting, privacy, and release history. A version-bound Pages build and browser checks keep the site separate from the numerical runtime. This documentation change does not release the pending pre-download native-fit repair.

## 0.4.1

Windows CUDA library discovery checks compatible installed toolkit and Ollama directories and applies the selected library path only to child processes. The verification record includes RTX 3090 CUDA generation and two-turn chat at 2,048-token context. No driver, system PATH, model artifact, or requested context was changed by that correction.

## 0.4.0

Hardware inventory, isolated native device selection, shared-memory-aware budgets, explicit backend fallback, and observed layer/context reporting were carried into setup and execution. The recorded 4060 partial-offload trial exceeded available VRAM, not physical GPU capacity.

See [release documentation](docs/pages/releases.md), [native verification](VERIFICATION.md), and [versioned public releases](https://github.com/BigBirdReturns/aperture/releases).
