from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from .common import MethodError, bind_method, read_json, read_method, write_json, now
from .execute import execute

PUBLIC_PROMPT = "Write a Python function named add that returns the sum of two integers."


def variant(method: dict[str, Any], layers: int | None) -> dict[str, Any]:
    result = json.loads(json.dumps(method))
    if layers is None:
        return result
    if layers < 0:
        raise MethodError("INVALID_LAYER_COUNT", "GPU layers must be non-negative.")
    if result["backend"] != "llama.cpp":
        raise MethodError("EXPERIMENT_AXIS_UNSUPPORTED", "GPU-layer sweeps apply to llama.cpp. HF supports repetition of the exact configured method in this release.")
    if layers and not result["request"]["gpu"]:
        raise MethodError("GPU_NOT_RESOLVED", "A nonzero layer experiment needs a method configured for a GPU.")
    result["request"]["gpu_layers"] = layers
    argv = result["runtime"]["arguments"]
    i = argv.index("--n-gpu-layers")
    argv[i + 1] = str(layers)
    if "--fit" in argv:
        argv[argv.index("--fit") + 1] = "off"
    if "--fit-target" in argv:
        at = argv.index("--fit-target")
        del argv[at:at + 2]
    result["experiment_delta"] = {"field": "gpu_layers", "value": layers, "parent_method_sha256": method["method_sha256"]}
    return bind_method(result)


def experiment(args: Any) -> dict[str, Any]:
    method = read_method(Path(args.method))
    if not args.acknowledge:
        raise MethodError("EXPERIMENT_NOT_SELECTED", "Experiments are opt-in. Pass --acknowledge-experiment to run the public synthetic prompt within the stated budgets.")
    if not 1 <= args.repeats <= 20 or not 0 < args.seconds <= 3600 or not 1 <= args.tokens <= 1024:
        raise MethodError("EXPERIMENT_BUDGET", "Use 1-20 repetitions, 1-1024 output tokens, and at most 3600 total wall-clock seconds.")
    layers = [int(v) for v in args.gpu_layers.split(",")] if args.gpu_layers else [None]
    if not 1 <= len(layers) <= 16 or len(set(layers)) != len(layers):
        raise MethodError("EXPERIMENT_AXIS", "Use 1-16 unique layer-count settings.")
    variants = [variant(method, n) for n in layers]
    out = Path(args.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=False)
    deadline = time.monotonic() + args.seconds
    results, baseline = [], None
    total_requested = len(variants) * args.repeats
    for vi, choice in enumerate(variants):
        path = out / f"method-{vi}.json"
        write_json(path, choice)
        for repetition in range(args.repeats):
            remaining = deadline - time.monotonic()
            row = {"variant": vi, "gpu_layers": layers[vi], "repetition": repetition,
                   "method_sha256": choice["method_sha256"]}
            if remaining <= 0:
                row["status"] = "NOT_STARTED_TIME_BUDGET"
                results.append(row)
                continue
            run_dir = out / f"run-{vi}-{repetition}"
            summary = execute(path, run_dir, prompt=PUBLIC_PROMPT, tokens=args.tokens, seconds=remaining,
                              chat=args.chat, event_output=False)
            row.update({k: summary[k] for k in ["status", "elapsed_seconds", "peak_process_tree_rss_sampled_bytes", "peak_owned_gpu_memory_sampled_bytes"]})
            if summary["status"] == "COMPLETED" and summary["model_inference"] == "GENERATED_OUTPUT":
                response = read_json(run_dir / "result.json")
                identity = {"input": response["prompt_token_ids_sha256"], "output": response.get("output_token_ids") or response["text"]}
                if baseline is None:
                    baseline = identity
                    row["comparison_to_first_completed_run"] = "REFERENCE_ONLY_NOT_GROUND_TRUTH"
                elif identity["input"] != baseline["input"]:
                    row["comparison_to_first_completed_run"] = "INPUT_TOKENS_DIFFER"
                else:
                    row["comparison_to_first_completed_run"] = "MATCH" if identity["output"] == baseline["output"] else "DIFFERENT"
                row.update({k: response.get(k) for k in ["generated_tokens", "generation_seconds", "ttft_seconds", "cache_condition"]})
                row["comparison_basis"] = "token_ids" if response.get("output_token_ids") else "generated_text_only"
            results.append(row)
    result = {"format": "aperture-experiment/1", "created_at": now(), "artifact_sha256": method["artifact"]["content_sha256"],
              "public_prompt": PUBLIC_PROMPT, "requested_trials": total_requested, "recorded_trials": len(results),
              "completed_trials": sum(r["status"] == "COMPLETED" for r in results), "results": results,
              "scope": "Exact-artifact repetition or single-requested-variable layer-placement comparison. Output matching is not numerical-logit parity or task correctness.",
              "not_performed": ["GPU or OS cache flush", "other-process termination", "hosted benchmark submission", "automatic upload", "harness-task grading"]}
    write_json(out / "experiment.json", result)
    return result


def export_summary(source: Path, out: Path) -> dict[str, Any]:
    """Whitelisted fields only. No prompts from user runs, text, tokens, paths, logs, keys, or UUIDs."""
    if source.name == "experiment.json":
        value = read_json(source)
        if value.get("format") != "aperture-experiment/1":
            raise MethodError("EXPORT_FORMAT", "Expected an experiment summary.")
        fields = ["variant", "gpu_layers", "repetition", "status", "elapsed_seconds", "peak_process_tree_rss_sampled_bytes",
                  "peak_owned_gpu_memory_sampled_bytes", "generated_tokens", "generation_seconds", "ttft_seconds",
                  "comparison_to_first_completed_run", "comparison_basis", "cache_condition"]
        result = {"format": "aperture-share-summary/1", "kind": "experiment", "created_at": value["created_at"],
                  "artifact_sha256": value["artifact_sha256"], "results": [{k: r[k] for k in fields if k in r} for r in value["results"]],
                  "task_correctness": "NOT_GRADED"}
    else:
        value = read_json(source)
        if value.get("format") != "aperture-run/1":
            raise MethodError("EXPORT_FORMAT", "Select run.json or experiment.json, never a raw result or log.")
        fields = ["created_at", "status", "artifact_sha256", "elapsed_seconds", "peak_process_tree_rss_sampled_bytes",
                  "peak_owned_gpu_memory_sampled_bytes", "model_inference", "harness_task_qualification"]
        result = {"format": "aperture-share-summary/1", "kind": "run", **{k: value[k] for k in fields}}
    write_json(out, result)
    return result
