# Troubleshooting

Keep your selected model identity and the actual error visible while you diagnose the problem. Do not delete shared caches, alter model metadata, or replace drivers merely to make a failed configuration appear successful.

## The command cannot be found

Check `node --version` and `npm --version`. Install [Node.js LTS](https://nodejs.org/en/download) and open a new terminal if the executables are unavailable. In Windows PowerShell, use `npx.cmd` so npm's PowerShell script shim is not blocked by execution policy. Do not lower the machine's execution policy for this command.

A GitHub repository package requires Git. The release-package command in [Get started](quickstart.md) does not. Running through `npx` does not guarantee that a bare `aperture` command is available in a later terminal; retain the package prefix.

## I received an answer, but the model will not load

The setup answer is provisional. In 0.4.4, native GGUF fitting precedes remote-weight acquisition and repeats after integrity checks before loading. Check available RAM, Windows commit headroom, the selected GPU and requested context. A refusal names the estimated resource shortfall without changing the model. A download completing is not successful admission.

Other workloads can change memory availability. Choose whether to close your own applications or use a different explicit configuration. Aperture does not terminate unrelated services. See [memory and placement](memory.md) for the distinction between a physical capacity, current headroom, and reserved budget.

## CUDA reports NoBinaryFoundError

Start by verifying `--version`. Release 0.4.1 adds discovery of compatible installed CUDA libraries in bounded toolkit and Ollama locations. In the recorded Windows case, those libraries existed but were absent from the worker search path. The correction keeps changes inside child processes.

A CUDA device in the scan does not guarantee compatible runtime libraries. The automatic backend may report a Vulkan or CPU fallback; an explicitly selected backend is not silently replaced. Supply `APERTURE_CUDA_LIBRARY_DIR` only when you already have a known compatible, trusted absolute local directory. Do not download individual DLLs from unofficial sites, use a network directory, or change system PATH just to suppress this message.

## Vulkan selects the wrong device

Indexes come from the selected native backend, not another tool's numbering. Use a sufficiently specific device name or the native index reported by that backend. A name matching multiple devices should be refused. A scan listing two GPUs does not mean both are pooled for one model.

## An NPU or another accelerator appears but cannot run

Inventory is not a numerical adapter. `--backend npu` preserves the request and reports the missing execution support. macOS, other graphics devices, and new model architectures likewise need their own observed evidence; consult the [support matrix](support.md).

## Model, RoPE, or quantization compatibility error

Retain the model revision, representation, and complete error. A known legacy Qwen3.5 GGUF with three RoPE dimension sections was rejected by the pinned runtime, which expected four. This is an artifact/runtime compatibility problem, not evidence that every Qwen model is unsupported.

Do not rewrite the original file's headers or silently select a different representation. Report the specific combination for a runtime or adapter change.

## Download stops or a hash does not match

Retry the same pinned selection. Transfers may resume if the server supplies a validated byte range. A server that cannot resume may restart the file. A hash mismatch or changed source should remain an error; do not bypass verification or treat a partial shard as complete.

For a gated Hugging Face repository, ensure your account has the publisher's required access and that an existing `HF_TOKEN` is available to the process. Never include that token in a public issue.

## My drive is full

Select a managed root using `--home` or `APERTURE_HOME` with room for the complete checkpoint and optional runtime. The scan checks that destination. The release does not stream a remote model's numerical work without a local checkpoint.

Identify the exact managed files you no longer need before removing anything. Do not wipe an unrelated Hugging Face, Ollama, or application cache. Your original local model files remain where you supplied them.

## Chat, saved answers, and experiments

Use `/exit` for a clean chat exit and `/new` for a fresh conversation. Saved answers preserve requirements, not the chat transcript. Resume only locally generated answer files you trust. Change requirements with `setup`.

An experiment runs two opt-in generations. Timing includes prompt processing; matching answers do not prove correctness. Local run records can contain prompts, output, device identifiers, and paths. Review them before sharing.

## Report a useful failure

Use the repository's [bug report](https://github.com/BigBirdReturns/aperture/issues/new?template=bug.yml) or [model-support request](https://github.com/BigBirdReturns/aperture/issues/new?template=model-support.yml). Include the release, operating system, selected backend, model publisher/revision/representation, failing stage, and a minimal redacted error. Do not paste a complete machine snapshot or private model URL by default.

Security-sensitive reports belong in the repository's [private security reporting](https://github.com/BigBirdReturns/aperture/security/advisories/new), not a public issue.

## Runtime installation stalls before downloading

Version 0.4.2 can stall on Windows when the installer inherits input already owned by the wizard. Version 0.4.3 closes stdin for managed commands while leaving progress output visible. Use the current versioned command; existing model files do not need to be deleted.
