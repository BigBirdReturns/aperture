from __future__ import annotations

import json
import re
import struct
from pathlib import Path
from typing import Any, BinaryIO

from .common import MethodError, canonical_hash, fingerprint, read_json


class GGUFReader:
    """Read metadata, not weights. Bounds prevent unbounded allocations from malformed headers."""
    scalar = {0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i", 6: "f", 7: "?", 10: "Q", 11: "q", 12: "d"}

    def __init__(self, f: BinaryIO):
        self.f = f
        self.end = f.seek(0, 2)
        f.seek(0)

    def read(self, n: int) -> bytes:
        if n < 0 or n > 16 * 1024**2 or self.f.tell() + n > self.end:
            raise MethodError("GGUF_INVALID", "Invalid or oversized GGUF metadata field.")
        data = self.f.read(n)
        if len(data) != n:
            raise MethodError("GGUF_INVALID", "Truncated GGUF metadata.")
        return data

    def unpack(self, fmt: str) -> Any:
        return struct.unpack("<" + fmt, self.read(struct.calcsize("<" + fmt)))[0]

    def string(self, keep: bool = True) -> str | None:
        n = self.unpack("Q")
        if n > 16 * 1024**2 or self.f.tell() + n > self.end:
            raise MethodError("GGUF_INVALID", "Invalid GGUF string size.")
        if keep:
            return self.read(n).decode("utf-8", errors="strict")
        self.f.seek(n, 1)
        return None

    def value(self, kind: int, keep: bool, depth: int = 0) -> Any:
        if depth > 1:
            raise MethodError("GGUF_INVALID", "Nested metadata arrays are unsupported.")
        if kind in self.scalar:
            return self.unpack(self.scalar[kind])
        if kind == 8:
            return self.string(keep)
        if kind == 9:
            sub, count = self.unpack("I"), self.unpack("Q")
            if count > 2_000_000 or sub == 9:
                raise MethodError("GGUF_INVALID", "GGUF array exceeds parser bounds.")
            if sub in self.scalar:
                n = count * struct.calcsize("<" + self.scalar[sub])
                if self.f.tell() + n > self.end:
                    raise MethodError("GGUF_INVALID", "Truncated metadata array.")
                self.f.seek(n, 1)
            else:
                for _ in range(count):
                    self.value(sub, False, depth + 1)
            return None
        raise MethodError("GGUF_INVALID", f"Unknown GGUF metadata type {kind}.")


def gguf_metadata(path: Path) -> dict[str, Any]:
    with path.open("rb") as f:
        reader = GGUFReader(f)
        if reader.read(4) != b"GGUF" or reader.unpack("I") not in (2, 3):
            raise MethodError("GGUF_INVALID", "Only little-endian GGUF v2/v3 is accepted by this adapter.")
        tensors, count = reader.unpack("Q"), reader.unpack("Q")
        if tensors > 2_000_000 or count > 100_000:
            raise MethodError("GGUF_INVALID", "GGUF header count exceeds parser bounds.")
        metadata = {}
        for _ in range(count):
            key = reader.string()
            if key in metadata:
                raise MethodError("GGUF_INVALID", "Duplicate retained metadata key.")
            keep = key in {"general.architecture", "general.name", "general.file_type", "split.count", "split.no"} or key.endswith(".context_length")
            value = reader.value(reader.unpack("I"), keep)
            if keep:
                metadata[key] = value
        return {"tensor_count": tensors, "metadata": metadata}


def gguf_artifact(path: Path) -> dict[str, Any]:
    path = path.expanduser().resolve(strict=True)
    first = gguf_metadata(path)
    count = first["metadata"].get("split.count", 1)
    if type(count) is not int or not 1 <= count <= 10000:
        raise MethodError("GGUF_SHARDS", "Invalid split count.")
    paths = [path]
    if count > 1:
        match = re.fullmatch(r"(.+)-(\d{5})-of-(\d{5})\.gguf", path.name)
        if not match or int(match[2]) != 1 or int(match[3]) != count:
            raise MethodError("GGUF_SHARDS", "Select the first shard using the standard -00001-of-NNNNN.gguf filename.")
        paths = [path.with_name(f"{match[1]}-{i:05d}-of-{count:05d}.gguf") for i in range(1, count + 1)]
        for i, shard in enumerate(paths):
            if not shard.is_file():
                raise MethodError("GGUF_SHARDS", f"Required shard is missing: {shard.name}")
            meta = gguf_metadata(shard)["metadata"]
            if meta.get("split.no") != i or meta.get("split.count") != count:
                raise MethodError("GGUF_SHARDS", f"Shard identity mismatch: {shard.name}")
    files = [fingerprint(p) for p in paths]
    return {"kind": "gguf", "entrypoint": str(path), "files": files,
            "content_sha256": canonical_hash([{k: f[k] for k in ("bytes", "sha256")} for f in files]),
            "checkpoint_bytes": sum(f["bytes"] for f in files), **first}


def safe_relative(root: Path, name: str) -> Path:
    p = Path(name)
    if p.is_absolute() or ".." in p.parts or "\\" in name or ":" in name:
        raise MethodError("UNSAFE_ARTIFACT_PATH", "Artifact paths must stay within the selected directory.")
    target = (root / p).resolve(strict=True)
    # HF snapshot files can be symlinks into its blob store. Relative index *names*
    # are contained; content is resolved and hashed separately, never executed.
    if not target.is_file():
        raise MethodError("ARTIFACT_MISSING", f"Required file is missing: {name}")
    return root / p


def hf_artifact(root: Path) -> dict[str, Any]:
    root = root.expanduser().resolve(strict=True)
    config_path = safe_relative(root, "config.json")
    config = read_json(config_path)
    if config.get("quantization_config"):
        raise MethodError("QUANTIZED_HF_ADAPTER_REQUIRED", "This HF adapter does not silently dequantize a quantized checkpoint. Use its supported native runtime or an explicitly chosen GGUF artifact.")
    indices = sorted(root.glob("*.safetensors.index.json"))
    if len(indices) > 1:
        raise MethodError("AMBIGUOUS_CHECKPOINT", "Multiple safetensors indexes; select a directory containing one checkpoint.")
    if indices and indices[0].name != "model.safetensors.index.json":
        raise MethodError("CHECKPOINT_FILENAME", "Use the standard model.safetensors.index.json entrypoint expected by this loader.")
    if indices:
        index = read_json(indices[0])
        names = sorted(set(index.get("weight_map", {}).values()))
        if not names or any(not isinstance(x, str) or not x.endswith(".safetensors") for x in names):
            raise MethodError("CHECKPOINT_INDEX", "Invalid safetensors weight map.")
        weights = [safe_relative(root, name) for name in names]
    else:
        weights = sorted(root.glob("*.safetensors"))
        if len(weights) != 1:
            raise MethodError("CHECKPOINT_INDEX", "Provide one safetensors file or a complete indexed safetensors checkpoint.")
        if weights[0].name != "model.safetensors":
            raise MethodError("CHECKPOINT_FILENAME", "This loader expects model.safetensors or its standard index; no file rename is performed.")
    dtypes, tensor_names, tensor_bytes = set(), set(), 0
    for path in weights:
        with path.open("rb") as f:
            raw = f.read(8)
            if len(raw) != 8:
                raise MethodError("SAFETENSORS_INVALID", "Truncated header.")
            n = struct.unpack("<Q", raw)[0]
            if n > 64 * 1024**2 or n + 8 > path.stat().st_size:
                raise MethodError("SAFETENSORS_INVALID", "Invalid safetensors header size.")
            header = json.loads(f.read(n))
            for name, t in header.items():
                if name == "__metadata__":
                    continue
                if name in tensor_names:
                    raise MethodError("DUPLICATE_TENSOR", f"Tensor appears in multiple shards: {name}")
                tensor_names.add(name)
                begin, end = t["data_offsets"]
                if not (type(begin) is int and type(end) is int and 0 <= begin <= end <= path.stat().st_size - n - 8):
                    raise MethodError("SAFETENSORS_INVALID", "Invalid tensor offset.")
                tensor_bytes += end - begin
                if t["dtype"].startswith(("F", "BF")):
                    dtypes.add(t["dtype"])
    if indices and set(index["weight_map"]) != tensor_names:
        raise MethodError("CHECKPOINT_INDEX", "The tensor denominator differs from the index.")
    auxiliary = {"config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
                 "tokenizer.model", "vocab.json", "merges.txt", "added_tokens.json", "chat_template.jinja"}
    paths = weights + indices + [p for p in sorted(root.iterdir()) if p.name in auxiliary and p.is_file()]
    files = [fingerprint(p) for p in paths]
    return {"kind": "hf-safetensors", "entrypoint": str(root), "files": files,
            "content_sha256": canonical_hash([{k: f[k] for k in ("bytes", "sha256")} for f in files]),
            "checkpoint_bytes": sum(p.stat().st_size for p in weights), "tensor_payload_bytes": tensor_bytes,
            "floating_dtypes": sorted(dtypes), "tensor_names": sorted(tensor_names),
            "model_type": config.get("model_type"), "trained_context": config.get("max_position_embeddings")}
