# Changelog

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
