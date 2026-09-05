# Aperture

Choose the model you want. Aperture inspects your machine, explains a memory-aware configuration, and starts a local session through an existing inference runtime. A checkpoint larger than free VRAM is evaluated for CPU/GPU split execution rather than discarded from a recommendation list.

## Start

```sh
npx --yes github:BigBirdReturns/aperture
```

Requires Node.js 20.11+ and Git. In Windows PowerShell, use `npx.cmd` if execution policy blocks npm's PowerShell shim. No npm account or cloud-model subscription is needed. The initial package has no dependencies or install scripts. npm downloads the CLI; Aperture asks separately before scanning, fetching model metadata, downloading weights, installing its native runtime, or running inference.

The same release is available as a GitHub release tarball for installations without Git:

```sh
npx --yes --package=https://github.com/BigBirdReturns/aperture/releases/download/v0.3.0/bigbirdreturns-aperture-0.3.0.tgz aperture
```

For a reproducible GitHub install, append `#v0.3.0` to the repository specifier. Registry publication is not required by either command. This project is not currently published at `npx @bigbirdreturns/aperture`.

## The interaction

Approve the read-only hardware scan, paste a Hugging Face model/file link or drop in a local model file/folder, and select a representation when the source contains several. Aperture displays the selected artifact, actual hardware observations, requested context, provisional memory budgets, CPU/GPU route, and any missing adapter. The answer appears before downloading weights or loading a model.

Choose **Start a local chat**, **Save this configuration**, **Run a bounded experiment**, or **Generate one answer**. In chat, `/new` clears the conversation and `/exit` releases the model. A session can remain open for up to one hour. Existing models and services are not stopped. Saved configurations are listed with `aperture list` and resumed with `aperture chat ANSWER.json`.

A useful model link for a small initial run is:

```text
https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/blob/main/qwen2.5-0.5b-instruct-q4_k_m.gguf
```

That is an example selected by the user, not an automatic replacement for their target. It downloads approximately 491 MB when approved.

## Model-first configuration

```sh
npx --yes github:BigBirdReturns/aperture setup --model /models/chosen.gguf --context 8192
```

Local GGUF files, complete numbered shard sets, safetensors checkpoint folders, Hugging Face repositories/file links, `hf:owner/repository`, and direct HTTPS GGUF files are accepted for inspection. A numbered shard identifies its complete set. Hugging Face references are resolved to an immutable revision. Exact quantization and requested context are preserved. The program does not silently select a smaller model or shrink an explicit context.

For a scriptable answer without downloading weights or starting inference:

```sh
aperture setup --allow-scan --allow-network --model "https://huggingface.co/owner/repository" --answer-only --out answer.json
```

Omit `--allow-network` for local-only inspection. A repository with multiple representations still requires an explicit selection; use an exact file link for unattended operation.

## Running beyond VRAM

For supported GGUF models, the managed `node-llama-cpp@3.20.0` runtime selects GPU layers for the fixed context and executes remaining layers on the CPU. The complete checkpoint remains on local or mounted storage. Memory mapping does not make storage equivalent to RAM, and ordinary CPU-layer offload is distinct from streaming all model computation through a small GPU window.

The scanner distinguishes discrete GPU memory from Apple Silicon unified memory and does not add independent GPUs into a fictional pooled device. This release selects one NVIDIA accelerator, Apple Metal, or CPU. `--cpu` forces CPU execution. `--gpu-layers N` pins a layer count for controlled GGUF placement. `--parallel N` preserves a concurrency requirement, but this release's guided runner supports one sequence and reports larger requests as unsupported instead of quietly reducing them.

The printed configuration is a candidate until loading verifies backend and context. Speed is not invented from the GPU name. Models larger than the provisional resident-memory budgets may be slow or fail to load, and the output says so. This release does not implement remote-range numerical streaming, distributed inference, or arbitrary quantized-safetensors kernels. Architecture support ultimately depends on the selected runtime.

## Installation and recovery

The optional native runtime is installed under `~/.aperture/runtimes`, not globally. Installation uses a pinned package, disables install scripts, and permits prebuilt binaries only. Aperture does not install drivers or compile a GPU stack. Missing platform binaries produce an explicit error. Safetensors execution uses the bundled Transformers/Accelerate adapter and requires an existing compatible Python/PyTorch installation; inspecting a model does not require Python.

Downloads are saved under `~/.aperture/models`. Interrupted downloads can resume against a pinned file and a validated byte range; a server that cannot resume may restart that file. Completed files are verified with SHA-256, including the provider hash when available. Repeated selections reuse this cache. Your original model files remain in place. Set `APERTURE_HOME` to relocate all managed files.

Removing this CLI does not remove your weights. Delete only the managed model/runtime directories you intend to remove, or set a fresh `APERTURE_HOME` to isolate another installation. Do not delete unrelated Hugging Face or application caches as a troubleshooting step.

## Experiments and privacy

```sh
aperture experiment answer.json
```

Experiments require separate approval and run two bounded generations with the same configuration. Records contain the actual artifact hashes, runtime version, observed GPU-layer count, context readback and wall-clock timing. Output agreement is not task correctness or numerical parity. Local records contain prompts, paths and generated text. They are not automatically uploaded or safe for indiscriminate public sharing. Interactive chat text is not saved by Aperture.

The hardware scan does not traverse personal folders, inspect browser state, or collect credentials. Metadata requests send the selected model identifier, not the hardware profile. Existing `HF_TOKEN` is sent only to `huggingface.co`; it is not copied into configurations or sent to redirected download hosts. Remote model Python code is not executed.

## Verification

```sh
npm test
```

The control suite covers consent, fixed requirements, source inspection, shard selection, resumed acquisition, cache integrity, and native API readback. Test fixtures are explicitly synthetic. Real execution is a separate release check; see `VERIFICATION.md` for actual observed platforms, models and limitations. A passing control suite is not a hardware benchmark.

## Relationship to other work

Aperture is an independent project. Magnitude inspired the compact scan/select/setup experience. The executable in this repository uses its own model-first controller and `node-llama-cpp`; it does not require modifying or waiting for Magnitude's native catalog-import path. The safetensors compatibility adapter comes from Aperture Methods. Neither the Magnitude integration experiments nor a general execution fabric are prerequisites for this command.

Runtime and specification references: [node-llama-cpp](https://node-llama-cpp.withcat.ai/), [llama.cpp](https://github.com/ggml-org/llama.cpp), [Hugging Face Accelerate](https://huggingface.co/docs/accelerate/usage_guides/big_modeling), and [Magnitude](https://github.com/magnitudedev/magnitude). Their licenses and capabilities are separate from Aperture's MIT-licensed controller.
