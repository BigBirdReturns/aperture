# Get started

Aperture is a terminal application. It inspects your hardware with permission, reads the model you choose, explains a provisional configuration, and can start a local session. This website does not scan your computer or run a model.

## Install and open

Install a current [Node.js LTS release](https://nodejs.org/en/download) first. Aperture requires Node.js 20.11 or newer; the release control matrix covers Node 22 and 24. You do not need Git for the package command below, an npm account, or a cloud-model subscription.

**Windows PowerShell**

```powershell
npx.cmd --yes --package=https://github.com/BigBirdReturns/aperture/releases/download/v0.4.3/bigbirdreturns-aperture-0.4.3.tgz aperture
```

**Linux or macOS terminal**

```sh
npx --yes --package=https://github.com/BigBirdReturns/aperture/releases/download/v0.4.3/bigbirdreturns-aperture-0.4.3.tgz aperture
```

Windows and Linux have recorded native runs. The macOS adapter is implemented, but native Mac inference has not been verified by this project. Check the [support matrix](support.md) before selecting a platform or model.

With Git installed, the shorter, version-pinned equivalent is:

```sh
npx --yes github:BigBirdReturns/aperture#v0.4.3
```

Use `npx.cmd` instead of `npx` in Windows PowerShell. The package is distributed through GitHub, **not the npm registry**. Do not use `npx @bigbirdreturns/aperture` for this release.

## Approve the hardware scan

The first question asks permission to inspect CPU, graphics devices, neural accelerator candidates, RAM and allocation headroom, storage, available link observations, and runtime locations. It does not search your personal folders, load a model, or enroll the machine in experiments.

The initial CLI has no dependencies or install scripts. Installing its optional native inference runtime is a later, separate operation. You can decline the scan and exit.

## Supply your model

Paste an exact Hugging Face GGUF file link, a repository link, or a local model path. Dragging a file into a terminal usually inserts its path. When a source has several representations, select the exact one you intend to run. [Source formats and examples](models.md) explain shards, folders, and gated access.

A small, previously exercised example is:

```text
https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/blob/main/qwen2.5-0.5b-instruct-q4_k_m.gguf
```

This example is approximately 491 MB. It is a setup smoke test, not a recommendation for demanding work. Aperture does not substitute it for your chosen model. Remote metadata access has its own permission prompt.

## Read the configuration before proceeding

The answer identifies your selected artifact, hardware observations, context, session count, candidate backend, memory budgets, and any known missing adapter. Context defaults to 4,096 tokens and the guided runner supports one sequence. Explicit requirements are retained.

> **Native assessment in 0.4.3:** before asking to download remote GGUF weights, Aperture checks bounded model prefixes using the pinned runtime. A failed assessment stops acquisition without changing your model or context. Full integrity hashing is followed by a fresh assessment before loading. Runtime installation, metadata access, downloads and execution retain separate permissions. `--answer-only` remains provisional. [How memory is assessed](memory.md).

## Start useful work

Choose **Start a local chat**, **Save this configuration**, **Run a bounded experiment**, or **Generate one answer**. Press Enter at that menu to finish without downloading weights or running inference. A selected model download, optional runtime installation, and local execution each have separate approval boundaries.

In a GGUF chat, `/new` clears the current conversation and `/exit` releases the model. Chat sessions are limited to one hour. The Python/safetensors route does not provide the same managed ongoing-chat experience. Existing model services are not stopped to make room.

## Return to a saved configuration

Aperture prints the path of the saved answer. Use the same package prefix on a later terminal invocation:

```sh
npx --yes --package=https://github.com/BigBirdReturns/aperture/releases/download/v0.4.3/bigbirdreturns-aperture-0.4.3.tgz aperture list
```

```sh
npx --yes --package=https://github.com/BigBirdReturns/aperture/releases/download/v0.4.3/bigbirdreturns-aperture-0.4.3.tgz aperture chat "/path/to/answer.json"
```

Replace the quoted path with the path Aperture printed. Resume only answer files you trust. To change the model, context, device, or layer count, use a new `setup` command rather than editing a saved answer to imply a previously verified configuration.

## A first-use problem

Keep the error message and consult [troubleshooting](troubleshooting.md). A device appearing in the scan does not establish that a numerical adapter exists for it. A successful download does not establish memory fit. You can report a minimal, redacted failure without uploading your private prompts or complete machine snapshot.
