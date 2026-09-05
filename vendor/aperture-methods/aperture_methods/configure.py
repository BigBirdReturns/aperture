from __future__ import annotations

import gc
import os
import re
import shutil
from pathlib import Path
from typing import Any

from .artifacts import gguf_artifact, hf_artifact
from .common import MethodError, bind_method, command_output, controlled_environment, fingerprint, now, size
from .probe import probe

GiB = 1024**3


def choose_gpu(profile: dict[str, Any], selection: str) -> dict[str, Any] | None:
    devices = profile["nvidia"]["devices"]
    if selection == "cpu":
        return None
    if selection == "auto":
        candidates = [d for d in devices if not d["requires_external_capacity_qualification"] and d["free_bytes"]]
        return max(candidates, key=lambda d: d["free_bytes"], default=None)
    found = [d for d in devices if str(d["index"]) == selection or d["uuid"] == selection]
    if len(found) != 1:
        raise MethodError("GPU_NOT_RESOLVED", "Select a GPU index/UUID from this machine's probe, or explicitly select cpu.")
    if found[0]["requires_external_capacity_qualification"]:
        raise MethodError("DEKKER_GATE_REQUIRED", "CMP capacity is not admitted by this companion. Use Dekker's existing HBM gate and numerical-adapter path; no override is provided here.")
    return found[0]


def base_request(args: Any, profile: dict[str, Any]) -> dict[str, Any]:
    if not (args.context > 0 and args.parallel > 0 and args.batch > 0 and args.ubatch > 0 and args.ubatch <= args.batch):
        raise MethodError("INVALID_REQUEST", "Context, parallel, and batch must be positive; ubatch must not exceed batch.")
    gpu = choose_gpu(profile, args.gpu)
    available = profile["ram"]["available_bytes"]
    if available is None:
        raise MethodError("RAM_UNOBSERVED", "RAM headroom could not be observed. Install psutil and rerun the probe.")
    ram = size(args.ram) if args.ram else int(available * 0.70)
    reserve = size(args.reserve) if args.reserve else min(2 * GiB, int(ram * 0.20))
    if not reserve < ram <= available:
        raise MethodError("RAM_BUDGET", "RAM budget must exceed reserve and not exceed currently observed available RAM.")
    gpu_budget = None
    if gpu:
        gpu_budget = size(args.gpu_memory) if args.gpu_memory else gpu["free_bytes"] - max(GiB, gpu["total_bytes"] // 10)
        if gpu_budget <= reserve or gpu_budget > gpu["free_bytes"]:
            raise MethodError("GPU_BUDGET", "GPU budget must exceed the workspace reserve and fit current free memory.")
    elif args.gpu_memory:
        raise MethodError("GPU_NOT_RESOLVED", "A GPU memory budget requires a resolved NVIDIA GPU.")
    return {"context_per_sequence": args.context, "parallel_sequences": args.parallel,
            "batch_tokens": args.batch, "micro_batch_tokens": args.ubatch,
            "gpu": gpu, "gpu_allocation_budget_bytes": gpu_budget, "ram_rss_budget_bytes": ram,
            "runtime_reserve_bytes": reserve, "threads": args.threads or max(1, min(8, os.cpu_count() or 1)),
            "dtype_conversion": args.dtype, "gpu_layers": args.gpu_layers,
            "disk_offload_permitted": args.disk_offload,
            "policy": {"model_substitution": False, "automatic_quantization": False,
                       "context_reduction": False, "concurrency_reduction": False,
                       "remote_code": False, "driver_or_firmware_changes": False}}


def llama_environment(request: dict[str, Any]) -> dict[str, str]:
    env = controlled_environment()
    env["CUDA_VISIBLE_DEVICES"] = request["gpu"]["uuid"] if request["gpu"] else ""
    return env


def configure_llama(args: Any, profile: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    if args.dtype:
        raise MethodError("FORMAT_PRESERVATION", "GGUF is used as provided. A dtype flag would not convert it; choose an explicit artifact instead.")
    artifact = gguf_artifact(Path(args.model))
    arch = artifact["metadata"].get("general.architecture")
    trained = artifact["metadata"].get(f"{arch}.context_length")
    if trained and request["context_per_sequence"] > trained:
        raise MethodError("CONTEXT_EXTENSION_NOT_ADMITTED", f"Requested context exceeds the artifact's declared {trained} tokens; no RoPE change is implicit.")
    exe = args.runtime or shutil.which("llama-server")
    if not exe:
        raise MethodError("RUNTIME_MISSING", "llama-server was not found. Install an official build appropriate to the machine, then supply --runtime /path/to/llama-server. No model was loaded.")
    binary = Path(shutil.which(exe) or exe).expanduser().resolve(strict=True)
    env = llama_environment(request)
    help_text = command_output([str(binary), "--help"], env=env)
    required = ["--model", "--host", "--port", "--ctx-size", "--parallel", "--cache-type-k", "--cache-type-v",
                "--n-gpu-layers", "--device", "--split-mode", "--no-context-shift", "--slots",
                "--api-key-file", "--alias", "--batch-size", "--ubatch-size", "--threads"]
    if request["gpu"] and request["gpu_layers"] is None:
        required += ["--fit", "--fit-target"]
    missing = [flag for flag in required if not re.search(r"(?<![\w-])" + re.escape(flag) + r"(?![\w-])", help_text)]
    if missing:
        raise MethodError("RUNTIME_SURFACE_MISMATCH", "This installed executable lacks required flags: " + ", ".join(missing))
    if request["gpu"]:
        devices = command_output([str(binary), "--list-devices"], env=env)
        if not re.search(r"\bCUDA0\b", devices):
            raise MethodError("CUDA_BACKEND_NOT_OBSERVED", "The selected executable did not expose CUDA0 under the selected GPU UUID mask. No fallback to another backend is assumed.")
    argv = ["--model", artifact["entrypoint"], "--ctx-size", str(request["context_per_sequence"] * request["parallel_sequences"]),
            "--parallel", str(request["parallel_sequences"]), "--batch-size", str(request["batch_tokens"]),
            "--ubatch-size", str(request["micro_batch_tokens"]), "--threads", str(request["threads"]),
            "--cache-type-k", "f16", "--cache-type-v", "f16", "--split-mode", "none", "--no-context-shift", "--slots",
            "--alias", "aperture-" + artifact["content_sha256"][:16]]
    if request["gpu"]:
        layers = "auto" if request["gpu_layers"] is None else str(request["gpu_layers"])
        argv += ["--device", "CUDA0", "--n-gpu-layers", layers]
        if layers == "auto":
            margin = (request["gpu"]["total_bytes"] - request["gpu_allocation_budget_bytes"] + 1024**2 - 1) // 1024**2
            argv += ["--fit", "on", "--fit-target", str(margin)]
        elif "--fit" in help_text:
            argv += ["--fit", "off"]
    else:
        if request["gpu_layers"] not in (None, 0):
            raise MethodError("GPU_NOT_RESOLVED", "Nonzero GPU layers require a selected GPU.")
        argv += ["--device", "none", "--n-gpu-layers", "0"]
        if "--fit" in help_text:
            argv += ["--fit", "off"]
    if "--load-mode" in help_text:
        argv += ["--load-mode", "mmap"]
    if "--no-mmproj" in help_text:
        argv += ["--no-mmproj"]
    if "--no-op-offload" in help_text:
        argv += ["--no-op-offload"]
    return {"backend": "llama.cpp", "artifact": artifact, "runtime": {"executable": fingerprint(binary),
            "version": command_output([str(binary), "--version"], env=env).strip(), "arguments": argv},
            "placement": {"state": "NATIVE_LOAD_FIT_PENDING", "method": "CPU execution plus native GPU layer offload and memory-mapped source",
                          "checkpoint_must_fit_vram": False,
                          "warning": "CPU-resident or paged layers execute on the CPU. This is not a GPU layer-streaming engine, and mapped file size is not a resident-memory guarantee."},
            "runtime_claims": {"model_inference": "NOT_EXECUTED", "harness_tasks": "NOT_TESTED", "performance": "UNMEASURED"}}


def hf_dependencies() -> tuple[Any, Any, Any, Any]:
    try:
        import torch
        from transformers import AutoConfig, AutoModelForCausalLM
        import accelerate
    except ImportError as e:
        raise MethodError("HF_DEPENDENCIES_MISSING", "Install a suitable PyTorch build, then requirements-hf.txt in an isolated environment. This session has not loaded a model.") from e
    return torch, AutoConfig, AutoModelForCausalLM, accelerate


def configure_hf(args: Any, profile: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    if request["parallel_sequences"] != 1:
        raise MethodError("HF_CONCURRENCY_ADAPTER_REQUIRED", "The HF generation adapter admits one sequence; it will not reduce a larger requested concurrency.")
    if request["gpu_layers"] is not None:
        raise MethodError("WRONG_BACKEND_OPTION", "GPU layer counts are llama.cpp options; HF uses a per-module device map.")
    artifact = hf_artifact(Path(args.model))
    if artifact["trained_context"] and request["context_per_sequence"] > artifact["trained_context"]:
        raise MethodError("CONTEXT_EXTENSION_NOT_ADMITTED", "Requested context exceeds the checkpoint's declared maximum.")
    torch, AutoConfig, AutoModel, accelerate = hf_dependencies()
    dtype_map = {"F32": "float32", "F16": "float16", "BF16": "bfloat16"}
    if args.dtype:
        dtype_name = args.dtype
    elif len(artifact["floating_dtypes"]) == 1 and artifact["floating_dtypes"][0] in dtype_map:
        dtype_name = dtype_map[artifact["floating_dtypes"][0]]
    else:
        raise MethodError("MIXED_DTYPE_ADAPTER_REQUIRED", "Mixed/unsupported floating-point storage types require an explicit dtype conversion or a preserving adapter.")
    dtype = getattr(torch, dtype_name)
    gpu_index = None
    if request["gpu"]:
        if not torch.cuda.is_available():
            raise MethodError("TORCH_CUDA_UNAVAILABLE", "The installed PyTorch build has no usable CUDA runtime; no driver change or CPU fallback was performed.")
        for i in range(torch.cuda.device_count()):
            uuid = str(getattr(torch.cuda.get_device_properties(i), "uuid", ""))
            if uuid.removeprefix("GPU-") == request["gpu"]["uuid"].removeprefix("GPU-"):
                gpu_index = i
                break
        if gpu_index is None:
            raise MethodError("GPU_IDENTITY_UNRESOLVED", "PyTorch did not expose a UUID matching the selected physical GPU; ordinal equivalence is not assumed.")
        if dtype_name == "bfloat16":
            with torch.cuda.device(gpu_index):
                if not torch.cuda.is_bf16_supported():
                    raise MethodError("DTYPE_UNSUPPORTED", "BF16 support was not confirmed on the selected device; no silent FP16 conversion is made.")
    config = AutoConfig.from_pretrained(artifact["entrypoint"], local_files_only=True, trust_remote_code=False)
    with accelerate.init_empty_weights():
        model = AutoModel.from_config(config, torch_dtype=dtype, attn_implementation="eager", trust_remote_code=False)
    model.tie_weights()
    no_split = getattr(model, "_no_split_modules", None)
    if not no_split:
        raise MethodError("UNSPLITTABLE_MODULES_UNKNOWN", "The architecture does not declare residual-block boundaries; a safe dispatch map is not assumed.")
    max_memory: dict[Any, int] = {"cpu": request["ram_rss_budget_bytes"] - request["runtime_reserve_bytes"]}
    if gpu_index is not None:
        max_memory[gpu_index] = request["gpu_allocation_budget_bytes"] - request["runtime_reserve_bytes"]
    device_map = accelerate.infer_auto_device_map(model, max_memory=max_memory, no_split_module_classes=no_split,
                                                 dtype=dtype, offload_buffers=True)
    device_map = {k: str(v) for k, v in device_map.items()}
    if set(device_map.values()) == {"disk"}:
        raise MethodError("WHOLE_MODEL_DISK_DISPATCH_UNSUPPORTED", "This backend map leaves no resident module. Increase the allowed working memory or use a separately implemented streaming adapter.")
    if "disk" in device_map.values() and not request["disk_offload_permitted"]:
        raise MethodError("DISK_OFFLOAD_NOT_SELECTED", "This configuration needs disk offload. Rerun with --disk-offload to allow its extra storage and I/O, or choose larger memory budgets.")
    tied = accelerate.utils.find_tied_parameters(model)
    del model
    gc.collect()
    return {"backend": "accelerate", "artifact": artifact,
            "runtime": {"versions": {k: profile["packages"][k] for k in ["torch", "transformers", "accelerate", "safetensors"]},
                        "dtype": dtype_name, "attention": "eager", "no_split_module_classes": no_split, "tied_parameters": tied,
                        "max_memory": {str(k): v for k, v in max_memory.items()}, "device_map": device_map},
            "placement": {"state": "BACKEND_MAP_COMPUTED_NOT_EXECUTED", "checkpoint_must_fit_vram": False,
                          "method": "Accelerate module dispatch with CPU/disk offload",
                          "warning": "max_memory constrains weight placement, not total runtime memory. Runtime/state reserves are provisional and monitored. Full checkpoint source must be locally addressable; this is not Dekker's zero-cache remote-range adapter."},
            "runtime_claims": {"model_inference": "NOT_EXECUTED", "harness_tasks": "NO_HF_SERVING_ADAPTER", "performance": "UNMEASURED"}}


def configure(args: Any) -> dict[str, Any]:
    profile = probe(Path(args.out).parent)
    request = base_request(args, profile)
    path = Path(args.model).expanduser()
    backend = args.backend
    if backend == "auto":
        backend = "llama" if path.suffix.lower() == ".gguf" else "hf" if path.is_dir() else "unknown"
    if backend not in ("llama", "hf"):
        raise MethodError("FORMAT_ADAPTER_REQUIRED", "Select a complete local GGUF artifact or a local safetensors model directory. This format has no implemented adapter here.")
    body = configure_llama(args, profile, request) if backend == "llama" else configure_hf(args, profile, request)
    return bind_method({"format": "aperture-method/1", "created_at": now(), "status": "CANDIDATE_NOT_EXECUTED",
                        "machine_observation": profile, "request": request, **body})
