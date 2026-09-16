"""Independent checks of emitted schedules, including cost and evidence bindings.

This module does not call the planner or its accounting function. A schedule
passing this auditor conforms to the declared model, not to unobserved hardware.
"""
from __future__ import annotations
import math
from .model import Scenario, InputError, digest


class AuditError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise AuditError(message)


def _close(a: float, b: float, message: str) -> None:
    _require(isinstance(a, (int, float)) and not isinstance(a, bool) and math.isfinite(a), message)
    _require(math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-8), f"{message}: {a} != {b}")


def _hash(value: dict) -> None:
    _require(isinstance(value, dict) and "sha256" in value, "missing artifact digest")
    _require(value["sha256"] == digest({k: v for k, v in value.items() if k != "sha256"}), "artifact digest mismatch")


def _bill(duration: float, resource: dict) -> float:
    q = resource["billing_quantum_s"]
    return math.ceil(max(0, max(duration, resource["minimum_lease_s"]) / q - 1e-12)) * q


def audit_plan(sc: Scenario, plan: dict) -> None:
    _hash(plan)
    _require(plan["scenario_sha256"] == sc.sha256, "scenario digest mismatch")
    tasks = plan["tasks"]
    _require([t["stage"] for t in tasks] == list(sc.order), "missing, duplicate, or unordered stage")
    by_stage = {t["stage"]: t for t in tasks}
    groups, per_resource = {}, {}
    for task in tasks:
        sid, rid = task["stage"], task["resource"]
        _require(rid in sc.resources, "unknown resource")
        stage, resource = sc.stages[sid], sc.resources[rid]
        profiles = {p["id"]: p for p in stage["profiles"]}
        _require(task["profile"] in profiles, "unknown profile")
        p = profiles[task["profile"]]
        _require(p["resource"] == rid, "profile/resource mismatch")
        for pool, amount in p["memory_gib"].items():
            _require(amount <= resource["memory_gib"].get(pool, 0), f"memory violation: {sid}/{pool}")
        _require(p["quality"] >= sc.data["min_quality"], f"quality violation: {sid}")
        _close(task["quality"], p["quality"], "quality changed")
        if stage.get("colocate"):
            group = stage["colocate"]
            _require(groups.setdefault(group, rid) == rid, "colocation violation")
        _require(isinstance(task["new_lease"], bool), "invalid lease flag")
        _require(isinstance(task["lease"], int) and not isinstance(task["lease"], bool), "invalid lease index")
        for key in ("acquire_s", "boot_s", "compute_start_s", "end_s"):
            _require(isinstance(task[key], (int, float)) and math.isfinite(task[key]) and task[key] >= 0,
                     "invalid timestamp")
        _close(task["boot_s"], resource["startup_s"] if task["new_lease"] else 0.0, "boot overhead missing")
        _require(task["compute_start_s"] + 1e-8 >= task["acquire_s"] + task["boot_s"], "compute before boot")
        _close(task["end_s"] - task["compute_start_s"], p["duration_s"], "profile duration changed")
        for dep in stage["deps"]:
            _require(task["acquire_s"] + 1e-8 >= by_stage[dep]["end_s"], "dependency violation")
        per_resource.setdefault(rid, []).append(task)
    transfers = plan["transfers"]
    edges = {}
    for tr in transfers:
        pair = tr["parent"], tr["stage"]
        _require(pair not in edges, "duplicate transfer")
        _require(pair[1] in by_stage and pair[0] in sc.stages[pair[1]]["deps"], "spurious transfer")
        parent, child = by_stage[pair[0]], by_stage[pair[1]]
        source, dest = parent["resource"], child["resource"]
        _require((tr["from"], tr["to"]) == (source, dest), "transfer endpoint changed")
        _require((source, dest) in sc.links and source != dest, "missing directed link")
        link = sc.links[source, dest]
        gib = sc.stages[pair[0]]["output_gib"]
        _require(gib > 0, "unnecessary zero-data transfer")
        _close(tr["gib"], gib, "transfer size changed")
        _close(tr["end_s"] - tr["start_s"], link["latency_s"] + gib / link["bandwidth_gib_s"], "transfer duration changed")
        _close(tr["usd"], gib * link["usd_per_gib"], "transfer cost changed")
        _require(tr["start_s"] + 1e-8 >= parent["end_s"], "transfer before source completion")
        _require(tr["start_s"] + 1e-8 >= child["acquire_s"] + child["boot_s"], "transfer before destination boot")
        _require(tr["end_s"] <= child["compute_start_s"] + 1e-8, "compute before data arrival")
        edges[pair] = tr
    for child in tasks:
        for dep in sc.stages[child["stage"]]["deps"]:
            needs = by_stage[dep]["resource"] != child["resource"] and sc.stages[dep]["output_gib"] > 0
            _require(((dep, child["stage"]) in edges) == needs, "missing/extra dependency transfer")
    ordered = sorted(transfers, key=lambda x: x["start_s"])
    for a, b in zip(ordered, ordered[1:]):
        _require(a["end_s"] <= b["start_s"] + 1e-8, "shared fabric double-booked")
    leases = plan["leases"]
    _require(set(leases) == set(per_resource), "unaccounted or unused resource leases")
    for rid, jobs in per_resource.items():
        last_end, current_lease = 0.0, -1
        for job in jobs:
            _require(job["acquire_s"] + 1e-8 >= last_end, "exclusive resource double-booked")
            last_end = job["end_s"]
            if job["new_lease"]:
                current_lease += 1
            _require(current_lease >= 0 and job["lease"] == current_lease, "invalid lease transition")
        _require(len(leases[rid]) == current_lease + 1, "lease count mismatch")
        for i, lease in enumerate(leases[rid]):
            members = [t for t in jobs if t["lease"] == i]
            _require(bool(members), "empty lease")
            _close(lease["start_s"], members[0]["acquire_s"], "lease starts late")
            _close(lease["end_s"], members[-1]["end_s"], "lease ends early")
            if i:
                _require(leases[rid][i-1]["end_s"] <= lease["start_s"] + 1e-8, "overlapping leases")
    elapsed = max(t["end_s"] for t in tasks)
    _close(plan["makespan_s"], elapsed, "makespan changed")
    _require(elapsed <= sc.data["deadline_s"] + 1e-8, "deadline violated")
    _close(plan["min_profile_quality"], min(t["quality"] for t in tasks), "quality summary mismatch")
    totals = {"resource_usd": 0.0, "transfer_usd": sum(t["usd"] for t in transfers),
              "resource_seconds": 0.0, "premium_active_s": 0.0, "premium_leased_s": 0.0}
    rows = plan["cost"]["rows"]
    _require(len(rows) == len(sc.resources) and {r["resource"] for r in rows} == set(sc.resources), "billing rows mismatch")
    for row in rows:
        rid = row["resource"]
        r = sc.resources[rid]
        active = sum(t["end_s"]-t["compute_start_s"] for t in per_resource.get(rid, []))
        spans = leases.get(rid, [])
        leased = sum(s["end_s"]-s["start_s"] for s in spans)
        billed = sum(_bill(s["end_s"]-s["start_s"], r) for s in spans)
        if sc.data["accounting"] == "committed":
            billed = _bill(sc.data["horizon_s"], r)
        charge = billed / 3600 * r["usd_per_hour"]
        for k, value in (("active_s", active), ("leased_s", leased), ("billed_s", billed), ("usd", charge)):
            _close(row[k], value, f"billing mismatch: {rid}/{k}")
        _require(row["lease_count"] == len(spans), "lease count mismatch")
        totals["resource_usd"] += charge
        totals["resource_seconds"] += active
        if r["premium"]:
            totals["premium_active_s"] += active; totals["premium_leased_s"] += leased
    totals["total_usd"] = totals["resource_usd"] + totals["transfer_usd"]
    for key, value in totals.items():
        _close(plan["cost"][key], value, f"cost summary mismatch: {key}")
    _require(plan["cost"]["cash_basis"] == sc.data["accounting"], "accounting basis mismatch")


def audit_report(report: dict) -> dict:
    try:
        _hash(report)
        _require(report["schema"] == "arbitrages.report.v1", "unsupported report schema")
        sc = Scenario.parse(report["scenario"])
        _require(report["scenario_sha256"] == sc.sha256, "scenario mismatch")
        plans = list(report["frontier"]) + list(report["single_resource"]) + [p for p in report["baselines"].values() if p]
        if report["best"]:
            plans.append(report["best"])
        seen = set()
        for plan in plans:
            if plan["sha256"] not in seen:
                audit_plan(sc, plan); seen.add(plan["sha256"])
        best = report["best"]
        _require((best is not None) == (report["status"] == "FEASIBLE"), "status mismatch")
        if best:
            _require(any(p["sha256"] == best["sha256"] for p in report["frontier"]), "best absent from frontier")
            _require(all(best["cost"]["total_usd"] <= p["cost"]["total_usd"] + 1e-8 for p in plans), "best costs more than comparator")
        comp = report["comparison"]
        if comp:
            _require(comp["basis"] in ("baseline_elastic", "best_single_resource"), "invalid comparison basis")
            base = report["baselines"][comp["basis"]]
            _require(best is not None and base is not None, "comparison without valid baseline")
            _require(not any(r["price_kind"] == "unpriced" for r in sc.resources.values()), "comparison with unpriced resource")
            b, c = base["cost"]["total_usd"], best["cost"]["total_usd"]
            _require(b > 0, "invalid denominator")
            _close(comp["savings_fraction"], (b-c)/b, "savings mismatch")
            if c:
                _close(comp["cost_ratio"], b/c, "cost ratio mismatch")
            else:
                _require(comp["cost_ratio"] is None, "zero-cost ratio must be null")
            _close(comp["time_ratio"], base["makespan_s"]/best["makespan_s"], "time ratio mismatch")
            _close(comp["premium_active_seconds_released"], base["cost"]["premium_active_s"]-best["cost"]["premium_active_s"], "premium seconds mismatch")
        _require(report["evidence"]["cash_savings_verified"] is False, "modeled cost mislabeled verified")
        _require(report["evidence"]["gpu_execution_verified"] is False, "planner cannot attest GPU execution")
        return {"ok": True, "scenario_sha256": sc.sha256, "unique_plans_checked": len(seen),
                "boundary": "Model conformance only; does not establish physical performance or invoice savings."}
    except (KeyError, TypeError, IndexError, InputError, OverflowError) as exc:
        raise AuditError(f"malformed report: {exc}") from exc
