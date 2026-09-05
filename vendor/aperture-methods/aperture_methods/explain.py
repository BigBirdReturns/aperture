from __future__ import annotations

import shlex
from pathlib import Path

from .common import read_method


def gib(value: int | None) -> str:
    return "unobserved" if value is None else f"{value / 1024**3:.2f} GiB"


def explain(path: Path) -> str:
    method = read_method(path)
    request, artifact = method["request"], method["artifact"]
    hardware = method["machine_observation"]
    gpu = request["gpu"]
    lines = [
        f"Selected artifact: {artifact['entrypoint']}",
        f"Checkpoint files: {gib(artifact['checkpoint_bytes'])}; content identity: {artifact['content_sha256']}",
        f"Machine: {hardware['system']['os']} {hardware['system']['architecture']}; {hardware['system']['logical_cpus']} logical CPUs.",
        f"GPU: {gpu['name'] + ' (' + gpu['uuid'] + ')' if gpu else 'CPU-only route'}.",
        f"Allocation budgets: GPU {gib(request['gpu_allocation_budget_bytes'])}; sampled process-tree RAM {gib(request['ram_rss_budget_bytes'])}.",
        f"Context: {request['context_per_sequence']} tokens per sequence; {request['parallel_sequences']} concurrent slots requested.",
        f"Execution method: {method['placement']['method']}.",
        method['placement']['warning'],
    ]
    if method['backend'] == 'llama.cpp':
        lines += ["The complete selected GGUF remains locally addressable. Native fit chooses GPU layers only; model, precision, context, and concurrency are not changed.",
                  "Backend arguments (display only; use the supervised run/serve commands):",
                  shlex.join([method['runtime']['executable']['path'], *method['runtime']['arguments']])]
    else:
        places = sorted(set(method['runtime']['device_map'].values()))
        lines += [f"Module destinations: {', '.join(places)}; floating dtype: {method['runtime']['dtype']}.",
                  "CPU/disk-resident modules are dispatched by Accelerate. This companion requires the full checkpoint source on a local or mounted filesystem; it does not implement Dekker's remote-range numerical engine."]
    lines += ["This is a candidate method. Loading, generation performance, and task correctness require execution on this machine.",
              "Use run for a bounded prompt, serve for the llama.cpp endpoint, or the separately acknowledged experiment command. Existing model/configuration files are not overwritten."]
    return "\n\n".join(lines) + "\n"
