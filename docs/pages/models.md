# Choose a model source

Aperture starts from the artifact you select. Model names, representations, revisions, and context requirements are separate facts. A successful inspection means the source can be described; it does not mean every architecture in that container can execute through the pinned runtime.

## Accepted inputs

| Input | Example | What to expect |
| --- | --- | --- |
| Local GGUF | `/models/chosen.gguf` | Header inspection; your original file stays in place. |
| Extensionless GGUF blob | `/model-cache/blobs/sha256-…` | Recognized by its GGUF header, not its filename extension. |
| Local model folder | `/models/my-model` | Available representations are inspected; choose explicitly when needed. |
| Numbered GGUF shard | `model-00001-of-00003.gguf` | The complete numbered set is required, including the first shard. |
| Hugging Face repository | `hf:owner/repository` | Metadata permission, then representation selection. |
| Hugging Face file link | `https://huggingface.co/owner/repository/blob/REVISION/model.gguf` | Resolves the selected representation and immutable revision. |
| Direct HTTPS GGUF | `https://example.org/model.gguf` | Bounded header reads; availability depends on the host's behavior. |
| Safetensors folder | A folder with model configuration and all indexed shards | Inspection is supported; execution needs a compatible existing Python/PyTorch environment. |

The sample domains and placeholder paths above illustrate syntax, not downloadable models. Do not supply a private access token inside a URL.

## Repository versus file link

Use a repository when you want to compare the variants actually present in it. Use an exact file link for an unambiguous representation, especially in automation. Choosing Q4 rather than Q8 is a change in the model representation; Aperture does not authorize that change on your behalf.

Hugging Face selections resolve to a commit so a later update to `main` does not silently change the selected model. Downloaded bytes receive SHA-256 checks, including comparison with provider hashes when available. Local header inspection by itself is not a full-file content verification.

## Split files and required components

A split GGUF is one model spread across multiple files, not several interchangeable models. Preserve all numbered shards from the same revision. A missing shard or contradictory header is an incomplete package, not evidence that the hardware is too small.

A safetensors model may depend on its configuration, tokenizer, and all files named in its shard index. A `.safetensors` filename does not establish that a specialized quantization kernel is supported. Aperture does not run model-provided Python code to manufacture compatibility.

## Gated repositories

The application can use an existing `HF_TOKEN` for Hugging Face access. Obtain the required model access from the publisher before retrying. The token is sent only to `huggingface.co`, is not stored in answer files, and is not forwarded to a redirected download host. Do not paste tokens into public issues, command examples, or screenshots.

## Storage and resumption

Managed downloads live under `~/.aperture/models`. Repeated selections reuse the managed cache. Interrupted transfers can resume when the pinned source supports a valid byte range; a server that cannot resume may require a file restart.

Choose another managed destination with `--home` or `APERTURE_HOME`. Aperture checks the selected destination filesystem, including the parent of a new directory. Local files that you supplied are not moved into that cache. Keep sufficient space for the complete checkpoint; this release does not implement remote-range numerical streaming.

## Unsupported architecture

Keep the exact error, artifact revision, and runtime version. Inspection and execution are different support levels. The known legacy Qwen3.5 RoPE-layout mismatch is documented under [verified support](support.md). Renaming a file or rewriting its metadata does not supply a missing runtime implementation.
