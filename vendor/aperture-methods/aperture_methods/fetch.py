from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from .common import MethodError, fingerprint, now, read_json, size, write_json


def validate_name(name: str) -> str:
    if not isinstance(name, str) or name.startswith(("/", "\\")) or "\\" in name or ":" in name or ".." in name.split("/"):
        raise MethodError("UNSAFE_ARTIFACT_PATH", "Unsafe model-repository filename.")
    return name


def fetch(args: Any) -> dict[str, Any]:
    try:
        from huggingface_hub import HfApi, hf_hub_download
    except ImportError as e:
        raise MethodError("FETCH_DEPENDENCY_MISSING", "Install huggingface-hub to acquire a checkpoint. Local model paths do not need this dependency.") from e
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo):
        raise MethodError("INVALID_REPO", "Use a Hugging Face owner/repository identifier.")
    api = HfApi()
    info = api.model_info(args.repo, revision=args.revision, files_metadata=True)
    commit = info.sha
    if not commit or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise MethodError("REVISION_UNRESOLVED", "The provider did not return an immutable revision.")
    siblings = {s.rfilename: s for s in info.siblings}
    output = Path(args.directory).expanduser().resolve()
    if output.exists() and any(output.iterdir()):
        raise MethodError("ACQUISITION_DESTINATION_NOT_EMPTY", "Use a new/empty destination; no existing model directory is overwritten.")
    def download(name: str) -> Path:
        validate_name(name)
        if not args.allow_download:
            raise MethodError("DOWNLOAD_NOT_APPROVED", "Pass --allow-download and an explicit --max-download budget to acquire bytes.")
        return Path(hf_hub_download(args.repo, filename=name, revision=commit, local_dir=str(output)))
    if args.filename:
        name = validate_name(args.filename)
        if not name.endswith(".gguf") or name not in siblings:
            raise MethodError("EXACT_GGUF_REQUIRED", "--filename must select an existing exact GGUF artifact; no quantization is chosen for you.")
        match = re.fullmatch(r"(.+)-00001-of-(\d{5})\.gguf", name)
        names = [f"{match[1]}-{i:05d}-of-{int(match[2]):05d}.gguf" for i in range(1, int(match[2]) + 1)] if match else [name]
        entrypoint = name
    else:
        auxiliary = [n for n in ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
                                    "tokenizer.model", "vocab.json", "merges.txt", "added_tokens.json", "chat_template.jinja"] if n in siblings]
        if "config.json" not in auxiliary:
            raise MethodError("MODEL_FORMAT_UNSUPPORTED", "A config.json plus safetensors checkpoint is required by this acquisition route.")
        if "model.safetensors" in siblings:
            names = auxiliary + ["model.safetensors"]
        elif "model.safetensors.index.json" in siblings:
            index_name = "model.safetensors.index.json"
            # A tiny index is needed to select exact shards. It is part of the same
            # approved byte budget, never a model load or remote-code execution.
            index_size = siblings[index_name].size
            if index_size is None or index_size > min(size(args.max_download), 16 * 1024**2):
                raise MethodError("INDEX_SIZE_UNRESOLVED", "Checkpoint index is unbounded or exceeds the selected budget.")
            if not args.allow_download:
                return {"status": "PREVIEW_REQUIRES_INDEX_METADATA", "repo": args.repo, "revision": commit,
                        "index": index_name, "index_bytes": index_size, "download_bytes": None,
                        "message": "No local files written. Exact shard selection requires reading the small index; rerun with --allow-download and the same explicit byte ceiling."}
            index = read_json(download(index_name))
            shards = sorted(set(index.get("weight_map", {}).values()))
            if not shards or any(not isinstance(n, str) or not n.endswith(".safetensors") for n in shards):
                raise MethodError("CHECKPOINT_INDEX", "Empty or non-safetensors checkpoint shard list.")
            names = auxiliary + [index_name] + shards
        else:
            raise MethodError("MODEL_FORMAT_UNSUPPORTED", "No standard safetensors checkpoint. Select a supported runtime or an explicit GGUF filename.")
        entrypoint = "."
    names = sorted(set(validate_name(n) for n in names))
    if any(n not in siblings or siblings[n].size is None for n in names):
        raise MethodError("ACQUISITION_SIZE_UNRESOLVED", "Some required files are missing or lack provider sizes; no unbounded download is admitted.")
    total = sum(siblings[n].size for n in names)
    limit = size(args.max_download)
    if total > limit:
        raise MethodError("DOWNLOAD_BUDGET", f"The exact selection is {total} bytes, above the {limit}-byte download budget. No smaller artifact was substituted.")
    parent = output
    while not parent.exists():
        parent = parent.parent
    available = shutil.disk_usage(parent).free
    if total + 1024**3 > available:
        raise MethodError("LOCAL_SOURCE_SPACE", "This whole-file acquisition route needs more disk space. Use an existing mounted source or the separate bounded-range adapter; this is not a verdict on model executability.")
    if not args.allow_download:
        return {"status": "PREVIEW_ONLY", "repo": args.repo, "revision": commit, "files": names, "download_bytes": total}
    records = []
    for name in names:
        path = output / name
        if not path.exists():
            path = download(name)
        actual = fingerprint(path)
        if actual["bytes"] != siblings[name].size:
            raise MethodError("SOURCE_SIZE_CHANGED", f"Provider and downloaded sizes differ for {name}.")
        lfs = siblings[name].lfs
        expected = (lfs.get("sha256") if isinstance(lfs, dict) else getattr(lfs, "sha256", None)) if lfs else None
        if expected and expected != actual["sha256"]:
            raise MethodError("SOURCE_DIGEST_MISMATCH", f"Provider LFS SHA-256 does not match {name}.")
        records.append({"name": name, **actual, "upstream_lfs_sha256_verified": bool(expected)})
    receipt = {"status": "ACQUIRED_NOT_EXECUTED", "created_at": now(), "repo": args.repo, "revision": commit,
               "files": records, "download_bytes": total, "entrypoint": str(output if entrypoint == "." else output / entrypoint),
               "remote_code": False, "claim": "Content is locally hashed; upstream LFS identity is checked when supplied. No inference is implied."}
    write_json(output / "acquisition.json", receipt)
    return receipt
