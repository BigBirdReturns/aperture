from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .common import MethodError, canonical_hash, controlled_environment, now, read_json, read_method, verify_fingerprint, write_json
from .configure import hf_dependencies, llama_environment
from .probe import probe


def terminate_owned(proc: subprocess.Popen) -> None:
    """Stop a process launched by this supervisor, including its POSIX session.

    A worker may exit before its child server. Its original process group must
    still be cleaned up. Call only for a Popen created with start_new_session.
    Windows uses the owned PID tree while its root remains alive; Job Object
    containment is not implemented and abrupt-root-crash cleanup is unqualified.
    """
    if os.name == "nt":
        if proc.poll() is None:
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, timeout=10, shell=False)
        proc.wait(timeout=10)
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        proc.wait(timeout=10)
        return
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        proc.poll()  # reap the group leader if it has exited
        try:
            os.killpg(proc.pid, 0)
        except ProcessLookupError:
            return
        time.sleep(.05)
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    proc.wait(timeout=10)


def fresh_headroom(method: dict[str, Any], directory: Path) -> dict[str, Any]:
    current = probe(directory)
    previous = method["machine_observation"]["system"]
    if any(current["system"][k] != previous[k] for k in ("os", "architecture")):
        raise MethodError("MACHINE_CHANGED", "Operating-system/architecture changed; configure on the intended machine.")
    needed = method["request"]["ram_rss_budget_bytes"]
    available = current["ram"]["available_bytes"]
    if available is None or available < needed:
        raise MethodError("RAM_HEADROOM_CHANGED", "Current free RAM is below the selected run budget; no other processes are stopped.")
    gpu = method["request"]["gpu"]
    if gpu:
        matches = [d for d in current["nvidia"]["devices"] if d["uuid"] == gpu["uuid"]]
        if not matches or not matches[0]["free_bytes"] or matches[0]["free_bytes"] < method["request"]["gpu_allocation_budget_bytes"]:
            raise MethodError("GPU_HEADROOM_CHANGED", "The selected physical GPU is absent or no longer has the requested free memory.")
    return current


def verify_method_inputs(method: dict[str, Any]) -> None:
    for record in method["artifact"]["files"]:
        verify_fingerprint(record)
    if method["backend"] == "llama.cpp":
        verify_fingerprint(method["runtime"]["executable"])
    else:
        import importlib.metadata
        for package, expected in method["runtime"]["versions"].items():
            try:
                actual = importlib.metadata.version(package)
            except importlib.metadata.PackageNotFoundError:
                actual = None
            if actual != expected:
                raise MethodError("RUNTIME_CHANGED", f"{package} differs from configuration time. Configure again with this environment.")


def tree_memory(pid: int) -> tuple[int, list[int]]:
    import psutil
    try:
        parent = psutil.Process(pid)
        processes = [parent] + parent.children(recursive=True)
    except psutil.Error:
        return 0, []
    total, ids = 0, []
    for process in processes:
        try:
            total += process.memory_info().rss
            ids.append(process.pid)
        except psutil.Error:
            pass
    return total, ids


def gpu_process_memory(ids: list[int], uuid: str) -> int | None:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        result = subprocess.run([exe, "--query-compute-apps=pid,gpu_uuid,used_gpu_memory", "--format=csv,noheader,nounits"],
                                capture_output=True, text=True, timeout=3, shell=False)
        if result.returncode:
            return None
        total = 0
        for line in result.stdout.splitlines():
            row = [x.strip() for x in line.split(",")]
            if len(row) == 3 and row[0].isdigit() and int(row[0]) in ids and row[1] == uuid:
                if not row[2].isdigit():
                    return None
                total += int(row[2]) * 1024**2
        return total
    except (OSError, subprocess.TimeoutExpired):
        return None


def execute(method_path: Path, out: Path, *, prompt: str, tokens: int, seconds: float, serve: bool = False,
            chat: bool = False, event_output: bool = True) -> dict[str, Any]:
    try:
        import psutil  # noqa: F401
    except ImportError as e:
        raise MethodError("WATCHDOG_DEPENDENCY", "Install requirements-base.txt; psutil is required for process-tree memory monitoring.") from e
    if tokens <= 0 or not 0 < seconds <= 7 * 24 * 3600:
        raise MethodError("INVALID_RUN_BUDGET", "Tokens and duration must be positive; duration is bounded to seven days.")
    method = read_method(method_path)
    if serve and method["backend"] != "llama.cpp":
        raise MethodError("SERVING_ADAPTER_REQUIRED", "The HF adapter performs bounded generation only; it is not a harness server.")
    out = out.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=False, mode=0o700)
    started = time.monotonic()
    process = None
    log = None
    peak_rss, peak_gpu, gpu_observed = 0, 0, False
    status = "FAILED"
    reason: str | None = None
    try:
        fresh = fresh_headroom(method, out)
        write_json(out / "machine-before.json", fresh)
        # Full content verification is inside the supervised worker so the wall-clock
        # budget also bounds verification of terabyte-scale inputs.
        work = {"method_path": str(method_path.resolve()), "out": str(out), "prompt": prompt, "tokens": tokens,
                "serve": serve, "chat": chat}
        write_json(out / "request.private.json", work, private=True)
        log = (out / "worker.log").open("wb")
        env = controlled_environment()
        package_root = str(Path(__file__).resolve().parent.parent)
        env["PYTHONPATH"] = package_root + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
        process = subprocess.Popen([sys.executable, "-m", "aperture_methods", "_worker", str(out / "request.private.json")],
                                   stdout=log, stderr=subprocess.STDOUT, env=env, shell=False,
                                   start_new_session=os.name != "nt",
                                   creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
        ready_announced = False
        last_gpu_sample = 0.0
        while process.poll() is None:
            elapsed = time.monotonic() - started
            if elapsed >= seconds:
                status, reason = ("SERVE_BUDGET_COMPLETE" if serve and ready_announced else "TIME_BUDGET_EXCEEDED"), "wall_clock_budget"
                break
            rss, ids = tree_memory(process.pid)
            peak_rss = max(peak_rss, rss)
            if rss > method["request"]["ram_rss_budget_bytes"]:
                status, reason = "RAM_BUDGET_EXCEEDED", "sampled_process_tree_rss"
                break
            gpu = method["request"]["gpu"]
            if gpu and elapsed - last_gpu_sample >= 1.0:
                last_gpu_sample = elapsed
                used = gpu_process_memory(ids, gpu["uuid"])
                if used is not None:
                    gpu_observed = True
                    peak_gpu = max(peak_gpu, used)
                    if used > method["request"]["gpu_allocation_budget_bytes"]:
                        status, reason = "GPU_BUDGET_EXCEEDED", "sampled_owned_process_gpu_memory"
                        break
            ready = out / "ready.json"
            if ready.exists() and not ready_announced:
                try:
                    info = read_json(ready)
                except (OSError, json.JSONDecodeError):
                    time.sleep(.05)
                    continue
                ready_announced = True
                if event_output:
                    print(f"Verified endpoint: {info['base_url']}  API key file: {out / 'api-key.private.txt'}", file=sys.stderr, flush=True)
            time.sleep(.05)
        if process.poll() is None:
            terminate_owned(process)
        elif process.returncode == 0:
            status = "COMPLETED"
        else:
            reason = f"worker_exit_{process.returncode}"
    except KeyboardInterrupt:
        status, reason = "CANCELLED", "operator_interrupt"
    except Exception as e:
        status, reason = "FAILED", getattr(e, "code", type(e).__name__) + ": " + str(e)
    finally:
        if process is not None:
            terminate_owned(process)
        if log is not None:
            log.close()
    result = None
    try:
        result = read_json(out / "result.json") if (out / "result.json").exists() else None
    except (OSError, ValueError, MethodError):
        status, reason = "FAILED", "RESULT_UNREADABLE"
    if status == "COMPLETED" and not serve and (not result or result.get("status") != "GENERATED"):
        status, reason = "FAILED", "GENERATION_NOT_CONFIRMED"
    if result and result.get("status") == "FAILED":
        status, reason = "FAILED", result.get("code")
    summary = {"format": "aperture-run/1", "created_at": now(), "status": status, "reason": reason,
               "method_sha256": method["method_sha256"], "artifact_sha256": method["artifact"]["content_sha256"],
               "elapsed_seconds": time.monotonic() - started, "peak_process_tree_rss_sampled_bytes": peak_rss,
               "peak_owned_gpu_memory_sampled_bytes": peak_gpu if gpu_observed else None,
               "sampling_caveat": "Sampled termination is not an OS-enforced allocation limit; transient peaks may be missed. GPU memory may be unavailable under WDDM.",
               "model_inference": "GENERATED_OUTPUT" if result and result.get("status") == "GENERATED" else "NOT_CONFIRMED",
               "harness_task_qualification": "NOT_PERFORMED", "result_file": "result.json" if result else None}
    write_json(out / "run.json", summary)
    return summary


def local_request(base: str, key: str, path: str, payload: Any = None, timeout: float = 30) -> Any:
    headers = {"Authorization": "Bearer " + key}
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode()
    # Do not send local prompts through an inherited HTTP proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(base + path, data=body, headers=headers)
    with opener.open(request, timeout=timeout) as response:
        data = response.read(16 * 1024**2 + 1)
    if len(data) > 16 * 1024**2:
        raise MethodError("ENDPOINT_RESPONSE_TOO_LARGE", "Local response exceeds the bounded reader.")
    return json.loads(data)


def check_readback(method: dict[str, Any], props: Any, slots: Any, models: Any) -> dict[str, Any]:
    if not isinstance(props, dict) or not isinstance(slots, list) or not isinstance(models, dict):
        raise MethodError("READBACK_INCOMPLETE", "Unexpected runtime readback structure.")
    wanted = method["request"]
    if props.get("total_slots") != wanted["parallel_sequences"] or len(slots) != wanted["parallel_sequences"]:
        raise MethodError("CONCURRENCY_CHANGED", "Runtime slot count does not match requested concurrency.")
    if not slots or any(slot.get("n_ctx") != wanted["context_per_sequence"] for slot in slots):
        raise MethodError("CONTEXT_CHANGED", "Runtime per-slot context is absent or differs from the requested value.")
    actual_path = props.get("model_path")
    if not actual_path or Path(actual_path).resolve() != Path(method["artifact"]["entrypoint"]).resolve():
        raise MethodError("MODEL_READBACK_MISMATCH", "Runtime did not report the selected model path.")
    alias = "aperture-" + method["artifact"]["content_sha256"][:16]
    if alias not in [m.get("id") for m in models.get("data", [])]:
        raise MethodError("MODEL_READBACK_MISMATCH", "Runtime model alias differs from the bound artifact.")
    return {"model_path": actual_path, "model_alias": alias, "context_per_sequence": wanted["context_per_sequence"],
            "slots": len(slots), "build_info": props.get("build_info"),
            "verified": ["artifact_sha256_before_load", "model_path", "model_alias", "context_per_sequence", "slot_count"],
            "not_independently_read_back": ["every tensor placement", "KV precision", "complete shared-library/driver identity"]}


def llama_worker(method: dict[str, Any], work: dict[str, Any]) -> dict[str, Any]:
    out = Path(work["out"])
    key = secrets.token_urlsafe(32)
    keyfile = out / "api-key.private.txt"
    fd = os.open(keyfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(key)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    argv = [method["runtime"]["executable"]["path"], *method["runtime"]["arguments"],
            "--host", "127.0.0.1", "--port", str(port), "--api-key-file", str(keyfile)]
    server_log = (out / "server.log").open("wb")
    # Inherit the worker's process group; the supervisor owns this whole tree.
    proc = subprocess.Popen(argv, stdout=server_log, stderr=subprocess.STDOUT, env=llama_environment(method["request"]), shell=False)
    load_started = time.monotonic()
    try:
        while True:
            if proc.poll() is not None:
                raise MethodError("BACKEND_LOAD_FAILED", f"llama-server exited {proc.returncode}; inspect server.log.")
            try:
                health = local_request(base, key, "/health", timeout=1)
                if health.get("status") == "ok":
                    break
            except (OSError, ValueError):
                pass
            time.sleep(.1)
        props = local_request(base, key, "/props")
        slots = local_request(base, key, "/slots")
        models = local_request(base, key, "/v1/models")
        readback = check_readback(method, props, slots, models)
        if proc.poll() is not None:
            raise MethodError("BACKEND_EXITED", "Backend exited during readback.")
        write_json(out / "runtime-readback.json", readback)
        write_json(out / "ready.json", {"base_url": base + "/v1", "api_key_file": keyfile.name, "model": readback["model_alias"]})
        if work["serve"]:
            while proc.poll() is None:
                time.sleep(.25)
            raise MethodError("BACKEND_EXITED", f"Backend exited with {proc.returncode}.")
        prompt = work["prompt"]
        if work["chat"]:
            formatted = local_request(base, key, "/apply-template", {"messages": [{"role": "user", "content": prompt}], "add_generation_prompt": True})
            prompt = formatted["prompt"]
        tokenized = local_request(base, key, "/tokenize", {"content": prompt, "add_special": not work["chat"]})["tokens"]
        if len(tokenized) + work["tokens"] > method["request"]["context_per_sequence"]:
            raise MethodError("CONTEXT_OVERFLOW", "Prompt plus requested output exceeds admitted context; nothing is truncated.")
        began = time.monotonic()
        response = local_request(base, key, "/completion", {"prompt": tokenized, "n_predict": work["tokens"],
                                 "temperature": 0, "seed": 0, "stream": False, "cache_prompt": False,
                                 "return_tokens": True}, timeout=7 * 24 * 3600)
        elapsed = time.monotonic() - began
        if response.get("truncated"):
            raise MethodError("PROMPT_TRUNCATED", "Runtime reported truncation despite admitted input size.")
        if not isinstance(response.get("content"), str) or response.get("tokens_predicted", 0) <= 0:
            raise MethodError("GENERATION_NOT_CONFIRMED", "No generated token count was reported.")
        return {"status": "GENERATED", "backend": "llama.cpp", "text": response["content"],
                "output_token_ids": response.get("tokens") if isinstance(response.get("tokens"), list) else None,
                "prompt_token_ids_sha256": canonical_hash(tokenized), "prompt_tokens": len(tokenized),
                "generated_tokens": response["tokens_predicted"], "generation_seconds": elapsed,
                "load_and_readback_seconds": began - load_started,
                "server_timings": response.get("timings"), "ttft_seconds": None,
                "correctness": "OUTPUT_OBSERVED_NOT_TASK_GRADED", "readback": readback,
                "cache_condition": "new_process_filesystem_cache_uncontrolled"}
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        server_log.close()


def hf_worker(method: dict[str, Any], work: dict[str, Any]) -> dict[str, Any]:
    torch, _, AutoModel, _ = hf_dependencies()
    from transformers import AutoTokenizer
    out = Path(work["out"])
    runtime = method["runtime"]
    device_map = {k: int(v) if str(v).isdigit() else v for k, v in runtime["device_map"].items()}
    dtype = getattr(torch, runtime["dtype"])
    torch.set_num_threads(method["request"]["threads"])
    if "disk" in device_map.values():
        free = shutil.disk_usage(out).free
        # Source plus materialized offload may coexist; budget conservatively.
        if free < 2 * method["artifact"]["checkpoint_bytes"] + 1024**3:
            raise MethodError("DISK_HEADROOM", "Disk offload requires conservative additional room for converted weights and staging; the source checkpoint is not deleted.")
    gpu_indices = sorted({v for v in device_map.values() if isinstance(v, int)})
    for index in gpu_indices:
        torch.cuda.reset_peak_memory_stats(index)
    started = time.monotonic()
    model, loading = AutoModel.from_pretrained(method["artifact"]["entrypoint"], local_files_only=True, trust_remote_code=False,
                                               use_safetensors=True, torch_dtype=dtype, attn_implementation=runtime["attention"],
                                               device_map=device_map, offload_folder=str(out / "offload"),
                                               offload_state_dict=True, offload_buffers=True, output_loading_info=True)
    unexpected = loading.get("unexpected_keys", [])
    missing = set(loading.get("missing_keys", []))
    source_names = set(method["artifact"]["tensor_names"])
    for group in runtime["tied_parameters"]:
        if source_names.intersection(group):
            missing.difference_update(group)
    if missing or unexpected or loading.get("mismatched_keys") or loading.get("error_msgs"):
        raise MethodError("WEIGHT_LOADING_MISMATCH", "Loader reported missing, unexpected, or mismatched weights; no initialized fallback is admitted.")
    actual = {k: str(v) for k, v in getattr(model, "hf_device_map", {}).items()}
    if actual != runtime["device_map"]:
        raise MethodError("PLACEMENT_CHANGED", "Loaded module device map differs from the admitted map.")
    if model.dtype != dtype:
        raise MethodError("DTYPE_CHANGED", "The model-reported floating dtype differs from the admitted dtype.")
    model.eval()
    tokenizer = AutoTokenizer.from_pretrained(method["artifact"]["entrypoint"], local_files_only=True, trust_remote_code=False)
    if work["chat"]:
        if not tokenizer.chat_template:
            raise MethodError("CHAT_TEMPLATE_MISSING", "The tokenizer has no chat template; no substitute template is invented.")
        text = tokenizer.apply_chat_template([{"role": "user", "content": work["prompt"]}], tokenize=False, add_generation_prompt=True)
        batch = tokenizer(text, add_special_tokens=False, return_tensors="pt")
    else:
        batch = tokenizer(work["prompt"], return_tensors="pt")
    prompt_length = batch["input_ids"].shape[1]
    if prompt_length + work["tokens"] > method["request"]["context_per_sequence"]:
        raise MethodError("CONTEXT_OVERFLOW", "Prompt plus requested output exceeds admitted context; no truncation is performed.")
    destinations = list(device_map.values())
    first_gpu = next((v for v in destinations if isinstance(v, int)), None)
    device = torch.device("cpu" if first_gpu is None else f"cuda:{first_gpu}")
    batch = {k: v.to(device) for k, v in batch.items()}
    class TokenClock:
        def __init__(self):
            self.first_call = True
            self.first_generated_at = None
        def put(self, value):
            if self.first_call:
                self.first_call = False
            elif self.first_generated_at is None:
                self.first_generated_at = time.monotonic()
        def end(self):
            pass
    clock = TokenClock()
    generation_started = time.monotonic()
    with torch.inference_mode():
        output = model.generate(**batch, max_new_tokens=work["tokens"], do_sample=False, num_beams=1,
                                streamer=clock, use_cache=True,
                                pad_token_id=tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id)
    for index in gpu_indices:
        torch.cuda.synchronize(index)
    generation_seconds = time.monotonic() - generation_started
    output_tokens = output[0, prompt_length:].tolist()
    if not output_tokens:
        raise MethodError("GENERATION_NOT_CONFIRMED", "Model returned no output tokens.")
    readback = {"device_map": actual, "dtype": str(model.dtype), "context_admission": method["request"]["context_per_sequence"],
                "prompt_tokens": prompt_length, "parallel_sequences": 1,
                "state_allocation": "dynamic_backend_cache_with_provisional_reserve", "loading_issues": []}
    write_json(out / "runtime-readback.json", readback)
    return {"status": "GENERATED", "backend": "accelerate", "text": tokenizer.decode(output_tokens, skip_special_tokens=True),
            "output_token_ids": output_tokens, "prompt_token_ids_sha256": canonical_hash(batch["input_ids"][0].tolist()),
            "prompt_tokens": prompt_length, "generated_tokens": len(output_tokens),
            "load_and_tokenize_seconds": generation_started - started, "generation_seconds": generation_seconds,
            "ttft_seconds": None if clock.first_generated_at is None else clock.first_generated_at - generation_started,
            "cuda_peak_scope": "load_and_generation_in_this_worker",
            "cuda_peak_allocated_bytes": {str(i): torch.cuda.max_memory_allocated(i) for i in gpu_indices},
            "cuda_peak_reserved_bytes": {str(i): torch.cuda.max_memory_reserved(i) for i in gpu_indices},
            "readback": readback, "correctness": "OUTPUT_OBSERVED_NOT_TASK_GRADED",
            "cache_condition": "new_process_filesystem_cache_uncontrolled"}


def worker(request_path: Path) -> int:
    work = read_json(request_path)
    out = Path(work["out"])
    try:
        method = read_method(Path(work["method_path"]))
        verify_method_inputs(method)
        # Apply-time checks occur again after potentially long file verification.
        fresh_headroom(method, out)
        if method["backend"] == "accelerate":
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
            result = hf_worker(method, work)
        else:
            result = llama_worker(method, work)
        write_json(out / "result.json", result, private=True)
        return 0
    except Exception as e:
        write_json(out / "result.json", {"status": "FAILED", "code": getattr(e, "code", type(e).__name__), "message": str(e)}, private=True)
        return 2
