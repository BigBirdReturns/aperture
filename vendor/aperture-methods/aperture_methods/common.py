from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


class MethodError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def size(value: str) -> int:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)?\s*", str(value), re.I)
    if not match:
        raise MethodError("INVALID_SIZE", f"Use an explicit size such as 8GiB, not {value!r}.")
    units = {"B": 1, "KIB": 1024, "MIB": 1024**2, "GIB": 1024**3, "TIB": 1024**4,
             "KB": 1000, "MB": 1000**2, "GB": 1000**3, "TB": 1000**4}
    result = float(match[1]) * units[(match[2] or "B").upper()]
    if not math.isfinite(result) or result <= 0 or result > 2**53 - 1:
        raise MethodError("INVALID_SIZE", "Size must be positive and exactly representable as an integer.")
    return int(result)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(4 * 1024**2), b""):
            h.update(chunk)
    return h.hexdigest()


def fingerprint(path: Path) -> dict[str, Any]:
    path = path.expanduser().resolve(strict=True)
    before = path.stat()
    h = digest(path)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise MethodError("ARTIFACT_CHANGED", f"File changed while hashing: {path.name}")
    return {"path": str(path), "bytes": after.st_size, "sha256": h}


def verify_fingerprint(record: dict[str, Any]) -> None:
    path = Path(record["path"])
    if not path.is_file() or path.stat().st_size != record["bytes"] or digest(path) != record["sha256"]:
        raise MethodError("ARTIFACT_CHANGED", f"File no longer matches the method: {path.name}")


def canonical_hash(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def read_json(path: Path, limit: int = 32 * 1024**2) -> Any:
    if path.stat().st_size > limit:
        raise MethodError("JSON_TOO_LARGE", f"JSON exceeds {limit} bytes: {path.name}")
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj: Any, *, exclusive: bool = True, private: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
    fd = os.open(path, flags, 0o600 if private else 0o644)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=2, sort_keys=True, allow_nan=False)
        f.write("\n")


def fresh_directory(path: Path) -> Path:
    path = path.expanduser().resolve()
    path.mkdir(parents=True, exist_ok=False)
    return path


def controlled_environment() -> dict[str, str]:
    # Prevent a previous harness or shell from silently overriding this method.
    return {k: v for k, v in os.environ.items() if not k.startswith(("LLAMA_ARG_", "MTMD_"))}


def command_output(argv: list[str], timeout: float = 15, env: dict[str, str] | None = None) -> str:
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           text=True, encoding="utf-8", errors="replace", timeout=timeout,
                           env=env, shell=False)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise MethodError("COMMAND_UNAVAILABLE", f"Could not run {Path(argv[0]).name}: {type(e).__name__}") from e
    if p.returncode:
        raise MethodError("COMMAND_FAILED", f"{Path(argv[0]).name} returned {p.returncode}: {p.stdout[-1500:]}")
    return p.stdout


def read_method(path: Path) -> dict[str, Any]:
    doc = read_json(path)
    bound = dict(doc)
    expected = bound.pop("method_sha256", None)
    if expected != canonical_hash(bound) or doc.get("format") != "aperture-method/1":
        raise MethodError("METHOD_CHANGED", "Method checksum or format does not match; configure again.")
    if doc.get("backend") not in {"llama.cpp", "accelerate"}:
        raise MethodError("BACKEND_UNSUPPORTED", "Unknown execution adapter.")
    return doc


def bind_method(doc: dict[str, Any]) -> dict[str, Any]:
    result = dict(doc)
    result.pop("method_sha256", None)
    result["method_sha256"] = canonical_hash(result)
    return result


def emit_error(error: Exception) -> int:
    obj = {"status": "STOPPED", "code": getattr(error, "code", type(error).__name__), "message": str(error)}
    print(json.dumps(obj, indent=2), file=sys.stderr)
    return 2
