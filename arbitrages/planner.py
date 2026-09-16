"""Profile-driven, deterministic DAG placement and resource lease search.

Searches assignments and warm/restart lease choices in one declared stable
list order. Shared transfer fabric is serialized. Resources are exclusive;
there is no invented memory pooling, speedup, cloud provisioning, or spot fill.
"""
from __future__ import annotations

from copy import deepcopy
import math
from .model import Scenario, InputError, digest, rejection

EPS = 1e-9


def billed_seconds(seconds: float, resource: dict) -> float:
    q = resource["billing_quantum_s"]
    seconds = max(seconds, resource["minimum_lease_s"])
    return math.ceil(max(0, seconds / q - 1e-12)) * q


def empty_state() -> dict:
    return {"tasks": [], "transfers": [], "leases": {}, "available": {}, "fabric_free": 0.0, "groups": {}}


def accounting(sc: Scenario, st: dict) -> dict:
    rows = []
    execution_s = premium_s = leased_premium_s = compute_cost = 0.0
    for rid, resource in sc.resources.items():
        leases = st["leases"].get(rid, [])
        active = sum(t["end_s"] - t["compute_start_s"] for t in st["tasks"] if t["resource"] == rid)
        leased = sum(x["end_s"] - x["start_s"] for x in leases)
        billed = sum(billed_seconds(x["end_s"] - x["start_s"], resource) for x in leases)
        if sc.data["accounting"] == "committed":
            billed = billed_seconds(sc.data["horizon_s"], resource)
        charge = billed / 3600 * resource["usd_per_hour"]
        compute_cost += charge
        execution_s += active
        if resource["premium"]:
            premium_s += active
            leased_premium_s += leased
        rows.append({"resource": rid, "active_s": active, "leased_s": leased, "billed_s": billed,
                     "lease_count": len(leases), "usd": charge})
    transfer_cost = sum(t["usd"] for t in st["transfers"])
    return {"resource_usd": compute_cost, "transfer_usd": transfer_cost,
            "total_usd": compute_cost + transfer_cost, "resource_seconds": execution_s,
            "premium_active_s": premium_s, "premium_leased_s": leased_premium_s,
            "rows": rows, "cash_basis": sc.data["accounting"]}


def finish(st: dict) -> float:
    return max((t["end_s"] for t in st["tasks"]), default=0.0)


def place(sc: Scenario, state: dict, sid: str, profile: dict, restart: bool) -> dict | None:
    if rejection(sc, profile):
        return None
    stage, rid = sc.stages[sid], profile["resource"]
    group = stage.get("colocate")
    if group and state["groups"].get(group, rid) != rid:
        return None
    r = sc.resources[rid]
    previous = {t["stage"]: t for t in state["tasks"]}
    ready = max((previous[d]["end_s"] for d in stage["deps"]), default=0.0)
    acquire = max(ready, state["available"].get(rid, 0.0))
    new_lease = restart or not state["leases"].get(rid)
    boot = r["startup_s"] if new_lease else 0.0
    cursor = acquire + boot
    new = deepcopy(state)
    if group:
        new["groups"][group] = rid
    for dep in sorted(stage["deps"]):
        source = previous[dep]["resource"]
        data = sc.stages[dep]["output_gib"]
        if source == rid or data == 0:
            continue
        link = sc.links.get((source, rid))
        if not link:
            return None
        start = max(cursor, new["fabric_free"], previous[dep]["end_s"])
        end = start + link["latency_s"] + data / link["bandwidth_gib_s"]
        new["transfers"].append({"parent": dep, "stage": sid, "from": source, "to": rid,
                                 "gib": data, "start_s": start, "end_s": end,
                                 "usd": data * link["usd_per_gib"]})
        new["fabric_free"] = cursor = end
    end = cursor + profile["duration_s"]
    if end > sc.data["deadline_s"] + EPS:
        return None
    leases = new["leases"].setdefault(rid, [])
    if new_lease:
        leases.append({"start_s": acquire, "end_s": end})
    else:
        leases[-1]["end_s"] = end
    new["available"][rid] = end
    new["tasks"].append({"stage": sid, "profile": profile["id"], "resource": rid,
                          "acquire_s": acquire, "boot_s": boot, "new_lease": new_lease,
                          "compute_start_s": cursor, "end_s": end, "lease": len(leases) - 1,
                          "quality": profile["quality"]})
    return new


def _prune(sc: Scenario, states: list[dict], width: int) -> list[dict]:
    # Keep both cheap and fast partial schedules. Cost-only pruning can discard
    # the only route that eventually satisfies the deadline.
    seen, unique = set(), []
    for st in states:
        key = digest(st)
        if key not in seen:
            unique.append(st)
            seen.add(key)
    if len(unique) <= width:
        return unique
    scored = [(accounting(sc, s)["total_usd"], finish(s), digest(s), s) for s in unique]
    cost_order = sorted(scored, key=lambda x: (x[0], x[1], x[2]))
    time_order = sorted(scored, key=lambda x: (x[1], x[0], x[2]))
    result, selected = [], set()
    for a, b in zip(cost_order, time_order):
        for row in (a, b):
            if row[2] not in selected:
                selected.add(row[2]); result.append(row[3])
                if len(result) == width:
                    return result
    return result


def _search(sc: Scenario, width: int, only_resource: str | None = None,
            keep_warm: bool | None = None) -> tuple[list[dict], dict]:
    states = [empty_state()]
    expanded = 0
    truncated = False
    failure = None
    for sid in sc.order:
        candidates = []
        for st in states:
            for p in sc.stages[sid]["profiles"]:
                rid = p["resource"]
                if only_resource and rid != only_resource:
                    continue
                choices = [False] if not st["leases"].get(rid) else (
                    [not keep_warm] if keep_warm is not None else [False, True])
                for restart in choices:
                    expanded += 1
                    candidate = place(sc, st, sid, p, restart)
                    if candidate is not None:
                        candidates.append(candidate)
        if not candidates:
            failure = sid
            states = []
            break
        if len(candidates) > width:
            truncated = True
        states = _prune(sc, candidates, width)
    return states, {"expanded": expanded, "pruned": truncated, "blocked_at": failure}


def result(sc: Scenario, state: dict, name: str) -> dict:
    cost = accounting(sc, state)
    result = {"name": name, "scenario_sha256": sc.sha256, "makespan_s": finish(state),
              "tasks": state["tasks"], "transfers": state["transfers"], "leases": state["leases"],
              "cost": cost, "min_profile_quality": min(t["quality"] for t in state["tasks"])}
    result["sha256"] = digest(result)
    return result


def pareto(plans: list[dict]) -> list[dict]:
    unique = {}
    for p in plans:
        key = (round(p["cost"]["total_usd"], 12), round(p["makespan_s"], 9))
        if key not in unique or p["sha256"] < unique[key]["sha256"]:
            unique[key] = p
    ranked = sorted(unique.values(), key=lambda p: (p["cost"]["total_usd"], p["makespan_s"]))
    kept, fastest = [], math.inf
    for p in ranked:
        if p["makespan_s"] < fastest - EPS:
            kept.append(p); fastest = p["makespan_s"]
    return kept


def optimize(sc: Scenario, beam_width: int = 128) -> dict:
    if isinstance(beam_width, bool) or not isinstance(beam_width, int) or not 1 <= beam_width <= 1024:
        raise InputError("beam_width must be an integer in 1..1024")
    baselines, fallback, details = {}, [], {}
    rid = sc.data["baseline_resource"]
    # Two fair baselines: premium held, and premium allowed to release/restart.
    # The latter prevents presenting ordinary idle shutdown as heterogeneity.
    for label, warm in (("baseline_held", True), ("baseline_elastic", None)):
        states, info = _search(sc, beam_width, rid, warm)
        details[label] = info
        if states:
            st = min(states, key=lambda s: (accounting(sc, s)["total_usd"], finish(s), digest(s)))
            baselines[label] = result(sc, st, label)
            fallback.append(st)
        else:
            baselines[label] = None
    # Each feasible single-resource alternative is also a comparator/candidate.
    single = []
    for resource in sorted(sc.resources):
        states, info = _search(sc, beam_width, resource)
        details[f"single:{resource}"] = info
        if states:
            st = min(states, key=lambda s: (accounting(sc, s)["total_usd"], finish(s), digest(s)))
            single.append(result(sc, st, f"single:{resource}")); fallback.append(st)
    held_states, details["mixed_held"] = _search(sc, beam_width, keep_warm=True)
    if held_states:
        held = min(held_states, key=lambda s: (accounting(sc, s)["total_usd"], finish(s), digest(s)))
        baselines["mixed_held"] = result(sc, held, "mixed_held")
        fallback.append(held)
    else:
        baselines["mixed_held"] = None
    baselines["best_single_resource"] = min(single, key=lambda p: (p["cost"]["total_usd"], p["makespan_s"])) if single else None
    states, details["mixed"] = _search(sc, beam_width)
    states.extend(fallback)
    plans = [result(sc, st, "candidate") for st in states]
    frontier = pareto(plans)
    best = frontier[0] if frontier else None
    blockers = []
    for sid in sc.order:
        for p in sc.stages[sid]["profiles"]:
            why = rejection(sc, p)
            if why:
                blockers.append({"stage": sid, "profile": p["id"], "reason": why})
    assumed = [f"{sid}/{p['id']}" for sid in sc.order for p in sc.stages[sid]["profiles"]
               if p["evidence"]["kind"] == "assumed"]
    report = {"schema": "arbitrages.report.v1", "scenario": sc.data, "scenario_sha256": sc.sha256,
              "status": "FEASIBLE" if best else "NO_FEASIBLE_PLAN_FOUND", "best": best,
              "baselines": baselines, "single_resource": single, "frontier": frontier,
              "rejected_profiles": blockers, "search": {"beam_width": beam_width,
              "order": list(sc.order), "runs": details,
              "guarantee": "Best retained feasible plan for a fixed topological list order; not a global optimum."},
              "evidence": {"assumed_profiles": assumed,
              "cash_savings_verified": False, "gpu_execution_verified": False,
              "boundary": "Schedules and dollar costs are modeled. A measured label is a supplied trace claim, not independent attestation. Profile quality is not an end-to-end quality proof."},
              "comparison": {}}
    if best:
        base = baselines["best_single_resource"] or baselines["baseline_elastic"]
        unpriced = any(r["price_kind"] == "unpriced" for r in sc.resources.values())
        if base and not unpriced and base["cost"]["total_usd"] > 0:
            b, c = base["cost"]["total_usd"], best["cost"]["total_usd"]
            report["comparison"] = {"basis": "best_single_resource" if baselines["best_single_resource"] else "baseline_elastic", "savings_fraction": (b - c) / b,
                                      "cost_ratio": b / c if c else None,
                                      "time_ratio": base["makespan_s"] / best["makespan_s"],
                                      "premium_active_seconds_released": base["cost"]["premium_active_s"] - best["cost"]["premium_active_s"]}
    report["sha256"] = digest(report)
    return report
