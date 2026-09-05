# Aperture

[![Aperture: configure a chosen model for local inference](docs/assets/social-preview.png)](https://bigbirdreturns.github.io/aperture/)

Aperture inspects your hardware with permission, reads the model link or local files you choose, and explains a memory-aware configuration. For compatible GGUF models, it can start a local chat or bounded experiment using an existing inference runtime, including CPU/GPU split execution when the checkpoint exceeds available VRAM.

**[Website](https://bigbirdreturns.github.io/aperture/)** · **[Get started](https://bigbirdreturns.github.io/aperture/quickstart.html)** · **[Verified support](https://bigbirdreturns.github.io/aperture/support.html)** · **[Release 0.4.5](https://github.com/BigBirdReturns/aperture/releases/tag/v0.4.5)** · [MIT license](LICENSE)

## Start with one command

Install [Node.js LTS](https://nodejs.org/en/download) first. Requires Node.js 20.11 or newer; Node 22 and 24 have release control coverage. The package command does not require Git, an npm account, or a cloud-model subscription.

**Windows PowerShell**

```powershell
npx.cmd --yes --package=https://github.com/BigBirdReturns/aperture/releases/download/v0.4.5/bigbirdreturns-aperture-0.4.5.tgz aperture
```

**Linux / macOS terminal**

```sh
npx --yes --package=https://github.com/BigBirdReturns/aperture/releases/download/v0.4.5/bigbirdreturns-aperture-0.4.5.tgz aperture
```

Windows and Linux have recorded native runs; native Mac inference remains unverified. With Git installed, use `npx --yes github:BigBirdReturns/aperture#v0.4.5` instead. Distribution is through GitHub, not the npm registry namespace.

## The workflow

Approve the read-only scan, paste your model link or drag in a local file, and choose the exact representation when prompted. Review the configuration, then start a local chat, save it for later, generate one answer, or opt into an experiment. Metadata access, weight downloads, native-runtime installation, and execution have separate permissions.

Use `/new` for a fresh chat and `/exit` to release the model. Saved configurations are listed with `aperture list` and reopened with `aperture chat ANSWER.json`; retain the `npx --package=… aperture` prefix when the executable is not installed globally.

## Create a reduced support receipt

Aperture 0.4.5 adds an opt-in hardware receipt for reproducing fit and backend failures without posting the raw scan:

```sh
aperture support --allow-scan --out aperture-support.json
```

The receipt retains CPU topology, RAM and allocation headroom, integrated and discrete graphics, NPU inventory, drivers, storage classes and capacities, available link observations, runtime presence, scan status, and explicit unmeasured fields. It excludes host and user names, paths and mount labels, stable device and partition identifiers, GPU UUIDs, drive product names and serials, network adapter names and addresses, model locations, prompts, generated text, credentials, and environment variables. It is never uploaded automatically.

The file is reduced, not anonymous. Hardware model names, exact capacities, driver versions, and its timestamp can still fingerprint a machine. Inspect the JSON before sharing it.

> ### Native fit before acquisition

Before asking to acquire remote GGUF weights, Aperture obtains permission for the pinned runtime and assesses the complete selected tensor tables. Bounded prefixes are capped at 8 MiB per shard and 64 MiB total. A failed or unavailable assessment stops acquisition with the model, quantization, context, sequence count, and explicit device/layer requirements unchanged. Automatic placement checks layer counts for the highest estimated fitting count, not optimal speed.

After download and complete integrity hashing, generation and chat repeat the assessment against refreshed hardware immediately before loading. Each experiment trial rehashes and reassesses independently. A later refusal preserves earlier trial results. Native memory checks and actual GPU-layer/context readback remain enabled. Shared RAM and independent GPUs are not pooled.

These are pinned-runtime estimates, not architecture or throughput guarantees. Prefixes can include initial tensor bytes but do not acquire the full checkpoint. `--answer-only` remains a lightweight provisional answer without native installation or assessment. See [VERIFICATION.md](VERIFICATION.md) for native observations and retained limits.

## What is available

Local GGUF files and complete shard sets, extensionless GGUF blobs, Hugging Face repository/file links, and direct HTTPS GGUF files are supported for inspection. Safetensors inspection and a Python/Accelerate compatibility route are also present, with separate runtime prerequisites. Model architecture support depends on the pinned runtime.

The managed GGUF path selects one compatible CUDA or Vulkan device, Apple Metal, or CPU. It preserves your selected artifact and explicit context. Independent devices and shared RAM are not pooled into fictitious capacity. NPU inventory is not NPU inference. The guided runner supports one sequence; automatic external-harness connections and distributed execution are not implemented.

## Documentation

| Start here | Continue here |
| --- | --- |
| [Installation and first session](docs/pages/quickstart.md) | [Model links, files, shards, and access](docs/pages/models.md) |
| [Memory and CPU/GPU placement](docs/pages/memory.md) | [Complete command reference](docs/pages/reference.md) |
| [Troubleshooting and recovery](docs/pages/troubleshooting.md) | [Privacy, storage, and support receipts](docs/pages/privacy.md) |
| [Supported paths and native observations](docs/pages/support.md) | [Release history and pending work](docs/pages/releases.md) |

## Verification

[VERIFICATION.md](VERIFICATION.md) records native runs separately from source/control tests. Release 0.4.4 established Qwen2.5-14B Q4_K_M generating `42` through a CPU/RTX 4060 split at 2,048-token context while the 8,982,142,976-byte tensor payload exceeded the device's reported physical memory. Qualified automatic runs selected 27 or 28 of 49 layers as admission-time headroom changed, and the system-headroom watchdog completed the exact plan that the former RSS proxy aborted.

Release 0.4.5 adds the permissioned support-receipt path and exercises it through the installed package on the hosted Windows, Linux, and macOS control matrix. That passage validates command availability and the enforced omission classes; it does not establish anonymity, native inference on hosted runners, or additional backend support.

```sh
npm test
node scripts/package-smoke.mjs
```

No telemetry or automatic result upload is enabled. Raw local run records can contain prompts, output, paths, and hardware identifiers. Use the reduced support command for an initial external report, then inspect the JSON before sharing it. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) for reporting and development.

## Credits and licenses

Aperture is an independent MIT-licensed controller. [Magnitude](https://github.com/magnitudedev/magnitude) inspired the scan/select/setup experience. [node-llama-cpp](https://node-llama-cpp.withcat.ai/), [llama.cpp](https://github.com/ggml-org/llama.cpp), and [Hugging Face Accelerate](https://huggingface.co/docs/accelerate/usage_guides/big_modeling) provide distinct runtime capabilities under their own licenses. Model checkpoints keep their publishers' license and access conditions. No model weights are included here.
