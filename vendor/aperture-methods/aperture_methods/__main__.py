from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .common import MethodError, emit_error, read_json, write_json


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Choose the exact model; derive and run a bounded method on this machine.")
    root.add_argument("--version", action="version", version=__version__)
    commands = root.add_subparsers(dest="command", required=True)
    p = commands.add_parser("probe", help="Read-only machine observations; no model load, stress test, or upload")
    p.add_argument("--out", required=True)
    p.add_argument("--storage", default=".")
    p = commands.add_parser("fetch", help="Acquire an exact model revision, with explicit download and disk budgets")
    p.add_argument("--repo", required=True)
    p.add_argument("--revision", default="main", help="Resolved to an immutable commit before downloading")
    p.add_argument("--filename", help="Exact GGUF file, including quantization; omit for a standard HF safetensors checkpoint")
    p.add_argument("--directory", required=True)
    p.add_argument("--max-download", required=True, help="Examples: 2GiB, 60GiB")
    p.add_argument("--allow-download", action="store_true")
    p = commands.add_parser("configure", help="Hash the selected artifact and generate a candidate launch method without loading weights")
    p.add_argument("--model", required=True, help="First GGUF shard or local HF safetensors directory")
    p.add_argument("--backend", choices=["auto", "llama", "hf"], default="auto")
    p.add_argument("--runtime", help="Explicit llama-server executable, otherwise PATH")
    p.add_argument("--gpu", default="auto", help="auto, cpu, or one NVIDIA GPU index/UUID")
    p.add_argument("--gpu-memory", help="Total GPU allocation budget, e.g. 20GiB")
    p.add_argument("--ram", help="Sampled process-tree RSS budget; default 70%% of observed available RAM")
    p.add_argument("--reserve", help="Provisional runtime workspace/state reserve; default up to 2GiB")
    p.add_argument("--context", type=int, default=4096, help="Per-sequence context, never silently reduced")
    p.add_argument("--parallel", type=int, default=1)
    p.add_argument("--batch", type=int, default=512)
    p.add_argument("--ubatch", type=int, default=128)
    p.add_argument("--threads", type=int)
    p.add_argument("--gpu-layers", type=int, help="llama.cpp only; omit to ask its native fit planner")
    p.add_argument("--dtype", choices=["float32", "float16", "bfloat16"], help="HF-only explicit conversion; omission preserves homogeneous checkpoint precision")
    p.add_argument("--disk-offload", action="store_true", help="Permit HF disk offload. Does not authorize remote-range streaming.")
    p.add_argument("--out", required=True)
    p = commands.add_parser("explain", help="Explain the hardware, memory route, fixed requirements, and backend arguments")
    p.add_argument("method")
    for name in ["run", "serve"]:
        p = commands.add_parser(name, help="Bounded model execution" if name == "run" else "Verified loopback llama.cpp endpoint; foreground and time-bounded")
        p.add_argument("method")
        p.add_argument("--out", required=True, help="New output directory; existing runs are never overwritten")
        p.add_argument("--seconds", type=float, default=300 if name == "run" else 3600)
        if name == "run":
            p.add_argument("--prompt", required=True)
            p.add_argument("--tokens", type=int, default=64)
            p.add_argument("--chat", action="store_true", help="Use the model's own template, or stop if absent")
    p = commands.add_parser("experiment", help="Opt-in exact-artifact repetitions or llama.cpp GPU-layer sweep")
    p.add_argument("method")
    p.add_argument("--out", required=True)
    p.add_argument("--seconds", type=float, default=120)
    p.add_argument("--repeats", type=int, default=2)
    p.add_argument("--tokens", type=int, default=32)
    p.add_argument("--gpu-layers", help="Explicit comma-separated layer counts; no quant/context/model changes")
    p.add_argument("--chat", action="store_true")
    p.add_argument("--acknowledge-experiment", action="store_true", dest="acknowledge")
    p = commands.add_parser("export", help="Create a whitelisted shareable summary without prompts, outputs, keys, paths, or UUIDs")
    p.add_argument("summary")
    p.add_argument("--out", required=True)
    p = commands.add_parser("_worker", help=argparse.SUPPRESS)
    p.add_argument("request")
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "probe":
            from .probe import probe
            result = probe(Path(args.storage))
            write_json(Path(args.out), result)
        elif args.command == "fetch":
            from .fetch import fetch
            result = fetch(args)
        elif args.command == "configure":
            from .configure import configure
            if args.threads is not None and args.threads <= 0 or args.gpu_layers is not None and args.gpu_layers < 0:
                raise MethodError("INVALID_REQUEST", "Threads must be positive and GPU layer counts non-negative.")
            if Path(args.out).exists():
                raise MethodError("OUTPUT_EXISTS", "Use a new method path; an existing method is not overwritten.")
            result = configure(args)
            write_json(Path(args.out), result)
        elif args.command == "explain":
            from .explain import explain
            print(explain(Path(args.method)), end="")
            return 0
        elif args.command in ("run", "serve"):
            from .execute import execute
            result = execute(Path(args.method), Path(args.out), prompt=getattr(args, "prompt", ""),
                             tokens=getattr(args, "tokens", 1), seconds=args.seconds, serve=args.command == "serve",
                             chat=getattr(args, "chat", False))
            if result.get("result_file"):
                raw = read_json(Path(args.out) / result["result_file"])
                if raw.get("text"):
                    print(raw["text"])
            print(json.dumps(result, indent=2))
            return 0 if result["status"] in ("COMPLETED", "SERVE_BUDGET_COMPLETE") else 2
        elif args.command == "experiment":
            from .experiment import experiment
            result = experiment(args)
        elif args.command == "export":
            from .experiment import export_summary
            result = export_summary(Path(args.summary), Path(args.out))
        else:
            from .execute import worker
            return worker(Path(args.request))
        print(json.dumps(result, indent=2))
        if args.command == "experiment" and result["completed_trials"] != result["requested_trials"]:
            return 2
        return 0
    except (MethodError, OSError, ValueError, KeyError, TypeError, RuntimeError) as e:
        return emit_error(e)


if __name__ == "__main__":
    raise SystemExit(main())
