# Command reference

These commands describe **Aperture 0.4.1**. `aperture` below is the executable name. When it is not installed globally, place the command after this version-pinned package prefix:

```sh
npx --yes --package=https://github.com/BigBirdReturns/aperture/releases/download/v0.4.1/bigbirdreturns-aperture-0.4.1.tgz aperture --help
```

Use `npx.cmd` on Windows PowerShell. The reference is checked against the released command's option names; unsupported commands are not inferred from related projects.

## Commands

| Command | Operation |
| --- | --- |
| `aperture` or `aperture setup` | Permissioned hardware scan, model selection, explanation, optional use. |
| `aperture list` | List locally saved configurations. |
| `aperture chat ANSWER.json` | Resume a GGUF chat; `/new` clears and `/exit` closes. |
| `aperture run ANSWER.json` | Generate one answer and save the run record. |
| `aperture experiment ANSWER.json` | Offer two explicitly approved bounded trials. |
| `aperture --help` | Show commands and flags without scan or model access. |
| `aperture --version` | Print the installed version without scan or model access. |

There is no `serve`, automatic harness-connection, NPU inference, or distributed-run command in this release. The existing terminal chat is the working user interface.

## Model and execution requirements

| Flag | Meaning |
| --- | --- |
| `--model PATH_OR_LINK` | Selected local model or supported remote source. |
| `--context N` | Tokens per sequence; default 4,096. An explicit value is preserved. |
| `--parallel N` | Required sequence count; default 1. The guided runner reports values above 1 as unsupported. |
| `--backend auto\|cpu\|cuda\|vulkan\|metal\|npu` | Requested backend; default `auto`. NPU execution needs an unimplemented adapter. |
| `--cpu` | Explicit CPU-only route. |
| `--device INDEX_OR_NAME` | One device in the selected native backend; ambiguous matches fail. |
| `--gpu-layers N` | Explicit GPU-layer count for compatible GGUF execution. |
| `--threads N` | CPU worker threads. |
| `--home DIRECTORY` | Managed runtime, model, answer, and run storage root. |

Use these during **setup**. Resumed execution refuses flags that would change model, context, parallelism, backend, device, GPU layers, or thread count. Create a new setup instead. Resource changes after setup still affect whether the saved request can run.

## Output and execution controls

| Flag | Meaning |
| --- | --- |
| `--answer-only` | Print the provisional answer without installing a runtime or running inference. |
| `--out FILE` | Save the setup answer to a new JSON file; existing files are not overwritten. |
| `--prompt TEXT` | Supply a prompt. During setup, selects one-answer mode; permissions still apply. |
| `--once` | Exit chat after the supplied `--prompt`; does not make arbitrary operations unattended. |
| `--tokens N` | Generated-token limit; default 128 for a run and 1,024 for chat. |
| `--seconds N` | Single-run timeout; default 600, maximum 3,600 seconds. |
| `--help`, `-h` | Help. |
| `--version`, `-v` | Version. |

## Independent permissions

| Flag | Explicitly approves |
| --- | --- |
| `--allow-scan` | Hardware and selected-path observations. |
| `--allow-network` | Bounded model metadata requests. |
| `--allow-download` | Acquisition or reuse of the exact selected weights. |
| `--allow-install` | Installation of the isolated, pinned native runtime. |
| `--allow-run` | Local execution of the selected configuration. |

Omitting a flag leaves its operation subject to interactive approval. Experiment approval remains separate. A repository with several representations still requires a selection; use an exact artifact for deterministic automation. Never add all permissions merely to dismiss an unexplained error.

## Examples

The paths below are placeholders to replace with your own files. These examples assume the package prefix above, or an installed `aperture` executable.

**Inspect a local model without inference**

```sh
aperture setup --allow-scan --model "/models/chosen.gguf" --context 8192 --answer-only --out answer.json
```

**Use Intel integrated graphics through Vulkan**

```sh
aperture setup --backend vulkan --device Intel --model "/models/chosen.gguf"
```

**Use CPU execution and another storage location**

```sh
aperture setup --cpu --threads 4 --home "/fast-disk/aperture" --model "/models/chosen.gguf"
```

**Run a saved configuration with a bounded prompt**

```sh
aperture run "answer.json" --prompt "Explain a hash table." --tokens 96 --seconds 600
```

## Environment variables

`APERTURE_HOME` changes the managed storage root; `--home` takes precedence. `HF_TOKEN` supplies existing Hugging Face authorization. `APERTURE_CUDA_LIBRARY_DIR` names one explicitly trusted absolute local CUDA library directory. Installed CUDA toolkit variables and Ollama locations can also contribute library candidates. Discovery affects child processes only, not your system PATH.

## Exit behavior

Successful help, version, completed operations, and cancellation can exit with code 0. Errors, unsupported requested configurations, and incomplete execution return code 2. A zero exit alone is not a quality benchmark; inspect the reported operation and run result.
