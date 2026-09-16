"""Real subprocess timings and exact-output checks, plus a replayable local run.

All CPU variants include interpreter startup, data generation/loading, index
construction and result serialization in the parent-observed duration. No paid
service, model download, network access, or hidden simulated GPU execution.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import time

from .model import Scenario, InputError, canonical, digest, _number
from .workloads import CASES
from .planner import optimize
from .audit import audit_report

ROOT = Path(__file__).resolve().parent.parent


def percentile(values: list[float], p: float) -> float:
    # Nearest-rank estimator; small samples are not production tail evidence.
    values = sorted(values)
    return values[max(0, math.ceil(len(values) * p) - 1)]


def _trial(case: str, variant: str, n: int) -> dict:
    start = time.perf_counter()
    proc = subprocess.run([sys.executable, "-S", "-m", "arbitrages.workloads", case, variant, str(n)],
                          cwd=ROOT, capture_output=True, timeout=60, check=False)
    elapsed = time.perf_counter() - start
    if proc.returncode != 0:
        return {"case": case, "variant": variant, "n": n, "elapsed_s": elapsed,
                "ok": False, "error": proc.stderr.decode(errors="replace")[-1000:]}
    row = json.loads(proc.stdout)
    row.update({"elapsed_s": elapsed, "ok": bool(row["invariant_pass"])})
    return row


def benchmark(out: str | Path, trials: int = 5, n: int = 40000) -> dict:
    if not 3 <= trials <= 30 or not 100 <= n <= 200000:
        raise InputError("benchmark requires 3..30 trials and 100..200000 items")
    out = Path(out)
    if out.exists() and any(out.iterdir()):
        raise InputError("benchmark output directory must be new or empty")
    out.mkdir(parents=True, exist_ok=True)
    raw, references = [], {}
    # Alternate order between trials to reduce systematic warm-cache ordering.
    for trial in range(trials):
        for case, variants in CASES.items():
            for variant in (variants if trial % 2 == 0 else tuple(reversed(variants))):
                row = _trial(case, variant, n)
                row["trial"] = trial
                if row["ok"]:
                    pair = row["workload_sha256"], row["output_sha256"]
                    references.setdefault(case, pair)
                    row["ok"] = references[case] == pair
                raw.append(row)
    raw_text = "".join(canonical(row) + "\n" for row in raw)
    raw_path = out / "trials.jsonl"
    raw_path.write_text(raw_text, encoding="utf-8", newline="\n")
    raw_sha = hashlib.sha256(raw_text.encode()).hexdigest()
    summaries = []
    for case, variants in CASES.items():
        for variant in variants:
            rows = [r for r in raw if r["case"] == case and r["variant"] == variant]
            times = [r["elapsed_s"] for r in rows]
            summaries.append({"case": case, "variant": variant, "trials": trials,
                              "passed": sum(r["ok"] for r in rows), "mean_s": statistics.mean(times),
                              "median_s": statistics.median(times), "p95_s": percentile(times, .95),
                              "min_s": min(times), "max_s": max(times),
                              "max_peak_rss_bytes": max((r.get("peak_rss_bytes") or 0 for r in rows), default=0) or None,
                              "workload_sha256": references.get(case, (None, None))[0],
                              "output_sha256": references.get(case, (None, None))[1]})
    receipt = {"schema": "arbitrages.benchmark.v1", "created_at": datetime.now(timezone.utc).isoformat(),
               "host": {"os": platform.system(), "architecture": platform.machine(),
                        "python": platform.python_version(), "logical_cpus": os.cpu_count()},
               "child_python_flags": ["-S"],
               "harness_source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               "workload_source_sha256": hashlib.sha256((Path(__file__).with_name("workloads.py")).read_bytes()).hexdigest(),
               "trials_sha256": raw_sha, "n": n, "summaries": summaries,
               "all_outputs_match": all(row["ok"] for row in raw),
               "boundary": "Measured CPU algorithm/control-path comparison on one host. No GPU experiment, heterogeneous-fleet execution, market price, or paid savings measurement."}
    receipt["sha256"] = digest(receipt)
    (out / "benchmark.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    if not receipt["all_outputs_match"]:
        raise InputError("benchmark failed; complete trial evidence retained; no planner profiles promoted")
    max_mem = max((s["max_peak_rss_bytes"] or 0 for s in summaries), default=0)
    # A conservative declared envelope derived from observed process RSS; never
    # claim this is device VRAM or a measurement of free machine capacity.
    envelope = max(.25, 1.25 * max_mem / 2**30)
    scenario = {"schema": "arbitrages.v1", "name": "Measured CPU control suite",
                "deadline_s": max(10, 5 * sum(s["p95_s"] for s in summaries)), "min_quality": 1,
                "quality_contract": "Exact output digest equality across implementations and trials for each seeded CPU case; no LLM quality claim.",
                "accounting": "metered", "baseline_resource": "local-cpu",
                "notes": "Local execution only. Zero price means unpriced, not free infrastructure. Sequential independent control cases. Duration is observed subprocess p95 from a small sample, not an end-to-end percentile guarantee. RAM envelope is max observed RSS plus 25%, at least 0.25 GiB.",
                "resources": [{"id": "local-cpu", "label": "Measured local CPU process slot",
                    "memory_gib": {"ram": max(1, envelope)}, "usd_per_hour": 0, "billing_quantum_s": 1,
                    "minimum_lease_s": 0, "startup_s": 0, "premium": False,
                    "price_kind": "unpriced", "price_source": "No local hardware invoice or allocation rate supplied."}],
                "links": [], "stages": []}
    previous = []
    for case in CASES:
        profiles = []
        for s in [x for x in summaries if x["case"] == case]:
            profiles.append({"id": s["variant"], "resource": "local-cpu", "duration_s": s["p95_s"],
                "memory_gib": {"ram": envelope}, "quality": 1, "local_case": case, "local_variant": s["variant"],
                "evidence": {"kind": "measured", "source": "benchmark.json and trials.jsonl; same local host, complete subprocess duration",
                             "artifact_sha256": raw_sha, "collected_at": receipt["created_at"]}})
        scenario["stages"].append({"id": case, "deps": previous, "output_gib": 0, "profiles": profiles})
        previous = [case]
    (out / "profiled-workload.json").write_text(json.dumps(scenario, indent=2) + "\n", encoding="utf-8")
    return receipt


def verify_benchmark(out: str | Path) -> dict:
    out = Path(out)
    receipt = json.loads((out / "benchmark.json").read_text(encoding="utf-8"))
    if receipt["sha256"] != digest({k:v for k,v in receipt.items() if k != "sha256"}):
        raise InputError("benchmark receipt digest mismatch")
    raw = (out / "trials.jsonl").read_bytes()
    if hashlib.sha256(raw).hexdigest() != receipt["trials_sha256"]:
        raise InputError("trial artifact digest mismatch")
    rows = [json.loads(line) for line in raw.splitlines()]
    expected_pairs = {(case, variant) for case, variants in CASES.items() for variant in variants}
    summary_pairs = [(s["case"], s["variant"]) for s in receipt["summaries"]]
    if set(summary_pairs) != expected_pairs or len(summary_pairs) != len(expected_pairs):
        raise InputError("incomplete/duplicate summary universe")
    if set((r["case"], r["variant"]) for r in rows) != expected_pairs or len(rows) != sum(s["trials"] for s in receipt["summaries"]):
        raise InputError("trial universe mismatch")
    if receipt["all_outputs_match"] is not True or any(r["n"] != receipt["n"] for r in rows):
        raise InputError("workload size or acceptance mismatch")
    for case in CASES:
        pairs = {(s["output_sha256"], s["workload_sha256"]) for s in receipt["summaries"] if s["case"] == case}
        if len(pairs) != 1:
            raise InputError("cross-variant output mismatch")
    for row in rows:
        _number(row["elapsed_s"], "trial elapsed_s", positive=True)
    for summary in receipt["summaries"]:
        group = [r for r in rows if r["case"] == summary["case"] and r["variant"] == summary["variant"]]
        if len(group) != summary["trials"] or not all(r["ok"] and r["invariant_pass"] for r in group):
            raise InputError("missing/failed trials")
        if {r["trial"] for r in group} != set(range(summary["trials"])):
            raise InputError("duplicate/missing trial numbers")
        if any(r["output_sha256"] != summary["output_sha256"] or r["workload_sha256"] != summary["workload_sha256"] for r in group):
            raise InputError("output/workload mismatch")
        times = [r["elapsed_s"] for r in group]
        for key, expected in (("median_s", statistics.median(times)), ("p95_s", percentile(times, .95)), ("mean_s", statistics.mean(times))):
            if not math.isclose(summary[key], expected, rel_tol=1e-12):
                raise InputError("timing summary mismatch")
    scenario = Scenario.read(out / "profiled-workload.json")
    profile_pairs = [(p.get("local_case"), p.get("local_variant")) for s in scenario.stages.values() for p in s["profiles"]]
    if set(profile_pairs) != expected_pairs or len(profile_pairs) != len(expected_pairs):
        raise InputError("profile universe mismatch")
    for sid in scenario.order:
        for p in scenario.stages[sid]["profiles"]:
            matching = [s for s in receipt["summaries"] if s["case"] == p["local_case"] and s["variant"] == p["local_variant"]]
            if len(matching) != 1 or p["duration_s"] != matching[0]["p95_s"] or p["evidence"]["artifact_sha256"] != receipt["trials_sha256"]:
                raise InputError("profile is not bound to measured trials")
    return {"ok": True, "trials_verified": len(rows), "artifact_sha256": receipt["trials_sha256"],
            "boundary": "Integrity and internal consistency, not independent attestation of host identity."}


def replay_local(out: str | Path) -> dict:
    verify_benchmark(out)
    out = Path(out)
    receipt = json.loads((out / "benchmark.json").read_text(encoding="utf-8"))
    source_hash = hashlib.sha256(Path(__file__).with_name("workloads.py").read_bytes()).hexdigest()
    if source_hash != receipt["workload_source_sha256"]:
        raise InputError("workload implementation changed; profile again before replay")
    sc = Scenario.read(out / "profiled-workload.json")
    report = optimize(sc); audit_report(report)
    references = {s["case"]: s["output_sha256"] for s in receipt["summaries"]}
    rows = []
    start = time.perf_counter()
    for task in report["best"]["tasks"]:
        p = next(p for p in sc.stages[task["stage"]]["profiles"] if p["id"] == task["profile"])
        # This executor supports these built-ins only. A JSON file is never
        # interpreted as permission to execute arbitrary code or launch a GPU.
        row = _trial(p["local_case"], p["local_variant"], receipt["n"])
        row["planned_duration_s"] = p["duration_s"]
        row["contract_pass"] = row["ok"] and row.get("output_sha256") == references[p["local_case"]]
        rows.append(row)
        if not row["contract_pass"]:
            break
    replay = {"schema": "arbitrages.replay.v1", "scenario_sha256": sc.sha256,
              "plan_sha256": report["best"]["sha256"], "elapsed_s": time.perf_counter()-start,
              "all_outputs_match": len(rows) == len(sc.stages) and all(r["contract_pass"] for r in rows),
              "rows": rows, "boundary": "Actual local CPU execution of the selected profiles; no fleet or GPU dispatch."}
    replay["sha256"] = digest(replay)
    (out / "replay.json").write_text(json.dumps(replay, indent=2) + "\n", encoding="utf-8")
    (out / "plan.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if not replay["all_outputs_match"]:
        raise InputError("local replay failed; evidence retained")
    return replay
