# Privacy and local data

Aperture's permission boundaries are separate operations, not one blanket approval. The public site is a static guide; it does not inspect your machine, request your model files, or execute terminal commands. Search runs against a first-party documentation index.

## What the application reads

The approved hardware scan observes operating-system device inventory, memory and allocation headroom, storage, available link information, and selected runtime locations. It does not traverse personal folders, inspect browser state, retrieve credentials, stress-test hardware, or stop other model servers.

A local model inspection reads the path you select. A remote inspection contacts the model host for bounded metadata. That host receives the selected model identifier, not your hardware profile. Installation and downloads still use their respective network services; local inference does not mean the initial acquisition is offline.

## Approval boundaries

| Operation | Effect |
| --- | --- |
| Hardware scan | Read local inventory and selected-path observations. |
| Model metadata | Contact the chosen model host for metadata/header information. |
| Weight acquisition | Download or reuse exact selected files in the managed cache. |
| Native runtime installation | Install the pinned, prebuilt runtime under Aperture's own storage. |
| Model execution | Consume local computation and memory for your selected configuration. |
| Experiment | Run two separately approved bounded trials and retain local results. |

The first CLI package has no dependencies or install scripts. The optional native runtime installation disables lifecycle scripts and does not compile drivers or change the machine's system PATH. Windows library discovery is applied only to child processes. No model-provided Python code is executed.

## Local data locations

The default root is `~/.aperture`, or your chosen `--home` / `APERTURE_HOME`.

| Directory | Contents |
| --- | --- |
| `models` | Managed downloaded checkpoints and acquisition records. |
| `runtimes` | Isolated native-runtime installations. |
| `answers` | Saved model requests, hardware observations, and proposed configurations. |
| `runs` | Run and experiment records, including generated text where recorded. |

Original local model files stay in place. Aperture does not save the text of an interactive chat as a transcript. Saved configuration and generated-run files are different: they can contain local paths, hardware identifiers, prompts, and output. Terminal tools or other software may maintain their own history independently.

## Tokens and trust

An existing `HF_TOKEN` is used only for requests to `huggingface.co` and is not forwarded to redirected download hosts or written to answers. Do not put secrets inside a model URL. Treat saved answer files as trusted local instructions, not harmless attachments to execute from strangers.

## Run an experiment deliberately

Use `aperture experiment ANSWER.json` with the package prefix from [Get started](quickstart.md). The controller requests separate experiment approval. It runs two bounded generations using the same configuration, records what completed or failed, and keeps the result local. It does not enroll the computer into a continuing campaign or upload results automatically.

Recorded metrics include model-file hashes, runtime version, backend/device and GPU-layer readback, context, native token counters, and wall-clock timing. Those timings can include prompt processing and warm-cache effects. Output agreement is not ground truth, numerical parity, or task-quality qualification.

## Share the smallest useful report

Review any record before publishing it. Remove private prompts and outputs, tokens, usernames, personal paths, internal hostnames, and unnecessary hardware identifiers. There is no automatic public-result upload or redaction command in the released CLI. [Issue templates](https://github.com/BigBirdReturns/aperture/issues/new/choose) ask for minimal information so a report does not depend on exposing your working environment.
