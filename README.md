# Aperture

Choose the model you want. Aperture inspects your machine, explains a memory-aware configuration, and starts a local session through an existing inference runtime. A checkpoint larger than free VRAM is evaluated for CPU/GPU split execution rather than discarded from a recommendation list.

## Start

```sh
npx --yes github:BigBirdReturns/aperture
```

Requires Node.js 20.11+ and Git. In Windows PowerShell, use `npx.cmd` if execution policy blocks npm's PowerShell shim. No npm account or cloud-model subscription is needed. The initial package has no dependencies or install scripts. npm downloads the CLI; Aperture asks separately before scanning, fetching model metadata, downloading weights, installing its native runtime, or running inference.

The same release is available as a GitHub release tarball for installations without Git:

```sh
npx --yes --package=https://github.com/BigBirdReturns/aperture/releases/download/v0.4.0/bigbirdreturns-aperture-0.4.0.tgz aperture
```

For a reproducible GitHub install, append `#v0.4.0` to the repository specifier. Registry publication is not required by either command. This project is not currently published at `npx @bigbirdreturns/aperture`.

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

Local GGUF files (including extensionless engine blobs identified by their header), complete numbered shard sets, safetensors checkpoint folders, Hugging Face repositories/file links, `hf:owner/repository`, and direct HTTPS GGUF files are accepted for inspection. A numbered shard identifies its complete set. Hugging Face references are resolved to an immutable revision. Exact quantization and requested context are preserved. The program does not silently select a smaller model or shrink an explicit context.

For a scriptable answer without downloading weights or starting inference:

```sh
aperture setup --allow-scan --allow-network --model "https://huggingface.co/owner/repository" --answer-only --out answer.json
```

Omit `--allow-network` for local-only inspection. A repository with multiple representations still requires an explicit selection; use an exact file link for unattended operation.

## Running beyond VRAM

For GGUF execution, the development version performs a pinned-runtime fit assessment before asking to acquire remote weights. Runtime installation still requires separate permission. Header reads are capped at 8 MiB per shard and 64 MiB overall, and may include an initial portion of tensor data; they do not acquire the checkpoint. The assessment preserves context, sequence count, explicit device and explicit GPU-layer requests. Automatic placement searches for the highest estimated fitting layer count, not an optimal-speed configuration. A non-fitting or unavailable assessment stops acquisition with a concrete reason. Fit estimates may use the runtime estimation fallback and do not establish architecture compatibility. After acquisition, the same assessment runs again against current resources before execution, with native memory safety checks still enabled. Shared memory remains non-additive. `--answer-only` remains a lightweight candidate answer without native installation or assessment.

For supported GGUF models, the managed `node-llama-cpp@3.20.0` runtime selects GPU layers for the fixed context and executes remaining layers on the CPU. The complete checkpoint remains on local or mounted storage. Memory mapping does not make storage equivalent to RAM, and ordinary CPU-layer offload is distinct from streaming all model computation through a small GPU window.

The scanner inventories CPU, integrated/discrete graphics, neural accelerator candidates, RAM modules where available, Windows commit headroom, physical disks, volumes, and available link observations. It distinguishes discrete GPU memory from Intel/Apple shared system memory and does not add independent GPUs into a fictional pooled device. This release selects one CUDA or Vulkan device, Apple Metal, or CPU. With the default automatic route, an unavailable CUDA binary can fall back to Vulkan on the selected hardware, or to CPU with a visible explanation. An explicit backend is never silently replaced. `--cpu` forces CPU execution. `--gpu-layers N` pins a layer count for controlled GGUF placement. `--parallel N` preserves a concurrency requirement, but this release's guided runner supports one sequence and reports larger requests as unsupported instead of quietly reducing them.

The printed configuration is a candidate until loading verifies backend and context. Speed is not invented from the GPU name. Models larger than the provisional resident-memory budgets may be slow or fail to load, and the output says so. This release does not implement remote-range numerical streaming, distributed inference, or arbitrary quantized-safetensors kernels. Architecture support ultimately depends on the selected runtime.

## Installation and recovery

The optional native runtime is installed under `~/.aperture/runtimes`, not globally. Installation uses a pinned package, disables install scripts, and permits prebuilt binaries only. Aperture does not install drivers or compile a GPU stack. Missing platform binaries produce an explicit error. Safetensors execution uses the bundled Transformers/Accelerate adapter and requires an existing compatible Python/PyTorch installation; inspecting a model does not require Python.

Downloads are saved under `~/.aperture/models`. Interrupted downloads can resume against a pinned file and a validated byte range; a server that cannot resume may restart that file. Completed files are verified with SHA-256, including the provider hash when available. Repeated selections reuse this cache. Your original model files remain in place. Use `--home /path/to/storage` or set `APERTURE_HOME` to relocate all managed files. The scanner checks that destination filesystem, including the existing parent of a new directory, instead of assuming that the current directory is the download destination.

Removing this CLI does not remove your weights. Delete only the managed model/runtime directories you intend to remove, or set a fresh `APERTURE_HOME` to isolate another installation. Do not delete unrelated Hugging Face or application caches as a troubleshooting step.

## Experiments and privacy

```sh
aperture experiment answer.json
```

Experiments require separate approval and run two bounded generations with the same configuration. Records contain the actual artifact hashes, runtime version, observed device and GPU-layer count, context readback, native token counters, and wall-clock timing. A zero GPU-layer result is CPU execution even when a GPU backend initialized. Token rates include prompt processing and are not decode-only benchmark scores. Output agreement is not task correctness or numerical parity. Local records contain prompts, paths and generated text. They are not automatically uploaded or safe for indiscriminate public sharing. Interactive chat text is not saved by Aperture.

The hardware scan does not traverse personal folders, inspect browser state, or collect credentials. Metadata requests send the selected model identifier, not the hardware profile. Existing `HF_TOKEN` is sent only to `huggingface.co`; it is not copied into configurations or sent to redirected download hosts. Remote model Python code is not executed.

## Verification

```sh
npm test
```

The control suite covers consent, fixed requirements, source inspection, shard selection, resumed acquisition, cache integrity, and native API readback. Test fixtures are explicitly synthetic. Real execution is a separate release check; see `VERIFICATION.md` for actual observed platforms, models and limitations. A passing control suite is not a hardware benchmark.

## Relationship to other work

Aperture is an independent project. Magnitude inspired the compact scan/select/setup experience. The executable in this repository uses its own model-first controller and `node-llama-cpp`; it does not require modifying or waiting for Magnitude's native catalog-import path. The safetensors compatibility adapter comes from Aperture Methods. Neither the Magnitude integration experiments nor a general execution fabric are prerequisites for this command.

Runtime and specification references: [node-llama-cpp](https://node-llama-cpp.withcat.ai/), [llama.cpp](https://github.com/ggml-org/llama.cpp), [Hugging Face Accelerate](https://huggingface.co/docs/accelerate/usage_guides/big_modeling), and [Magnitude](https://github.com/magnitudedev/magnitude). Their licenses and capabilities are separate from Aperture's MIT-licensed controller.

## Device and storage controls in 0.4

The ordinary command remains the guided wizard. A prompt supplied during setup selects one-answer mode, while scan, network, download, installation, and execution permissions remain independent.

```sh
aperture setup --backend vulkan --device Intel --model /models/chosen.gguf
aperture setup --backend vulkan --device 0 --gpu-layers 4 --model /models/chosen.gguf
aperture setup --cpu --threads 4 --home /fast-disk/aperture --model /models/chosen.gguf
```

Vulkan indexes are native-runtime indexes, not NVIDIA indexes. A name matching multiple devices is refused; the error lists initialized devices. Only one device is exposed to a worker. Native name/readback checks precede model loading. NVIDIA free-memory observations bound Vulkan's budget when both observations are available. Unknown or shared memory domains receive conservative, non-additive RAM/GPU budgets.

`--backend npu` preserves an NPU request and explains the missing numerical adapter. It does not silently execute GGUF on the CPU. Intel AI Boost is detected on the tested Core Ultra laptop, but NPU inference is not implemented in this release. The software also does not promise support for every AMD GPU, Intel GPU, Apple model, or model architecture merely because the device is listed.

Native execution has been observed on Windows CPU, Windows Intel UHD 770 through Vulkan, Windows RTX 4060 with partial offload, and Linux CPU. Full inventory was observed on two different Windows hosts and a Linux host. The Linux path was also installed and executed directly through public GitHub `npx` acquisition. macOS adapters are implemented, but a native Mac inference result is not claimed here.

The selected legacy Ollama Qwen3.5 GGUF blob with three RoPE dimension sections was inspected successfully but rejected by the pinned runtime, which expected four. No file was rewritten and no substitute was silently used. A separately selected Qwen2.5-3B Q4_K_M checkpoint completed with four GPU layers on a 4060 while its checkpoint size exceeded the driver's reported free VRAM. This proves that particular CPU/GPU split, not an unrestricted model-compatibility or speed claim.

Automatic fitting is conservative and may select zero GPU layers. Explicit layer placement is available for controlled tuning. Storage bus names and nominal link rates are observations, not measured throughput. Physical RAM, shared graphics allocations, pagefile capacity, separate GPUs, and drives are never presented as one fungible memory pool.

See [VERIFICATION.md](VERIFICATION.md) for the exact native observations and retained limitations.

## Windows CUDA runtime libraries

If the pinned CUDA binary fails to initialize, Aperture checks a bounded set of installed CUDA toolkit and Ollama library directories before the existing automatic Vulkan fallback. A complete CUDA library set must still pass the native runtime compatibility probe on the selected GPU. The successful library directory is applied only to child processes, including resumed chats; no driver, machine PATH, existing engine, model file, or context setting is changed. No DLLs are downloaded or bundled by this correction.

An explicitly trusted local library directory can be selected through `APERTURE_CUDA_LIBRARY_DIR`. Relative paths, UNC paths and multiple-directory PATH strings are excluded from discovery. Existing `CUDA_PATH`/versioned toolkit variables and installed Ollama executable locations are inspected without recursive disk searches. Missing or incompatible libraries remain a visible CUDA initialization failure. NVIDIA hardware detection alone does not prove the required libraries exist.
