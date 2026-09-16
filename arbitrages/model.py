"""Strict input boundary. Memory pools are separate; profiles are supplied evidence.

All durations are seconds, capacities/data are GiB, bandwidths are GiB/s,
and money is USD. A resource denotes one exclusive execution slot, not a
fungible accelerator label. A profile measures a complete stage implementation.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

MAX_BYTES = 512 * 1024
MAX_STAGES = 24
MAX_PROFILES = 12
MAX_RESOURCES = 16
POOLS = {"ram", "vram", "disk"}
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$")


class InputError(ValueError):
    pass


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def _object(v: Any, path: str, required: set[str], optional: set[str] = frozenset()) -> dict:
    if not isinstance(v, dict):
        raise InputError(f"{path}: expected object")
    missing, extra = required - v.keys(), v.keys() - required - optional
    if missing:
        raise InputError(f"{path}: missing {', '.join(sorted(missing))}")
    if extra:
        raise InputError(f"{path}: unknown fields {', '.join(sorted(extra))}")
    return v


def _text(v: Any, path: str, maximum: int = 1000) -> str:
    if not isinstance(v, str) or not v.strip() or len(v) > maximum:
        raise InputError(f"{path}: expected nonempty text, at most {maximum} characters")
    return v


def _id(v: Any, path: str) -> str:
    if not isinstance(v, str) or not IDENTIFIER.fullmatch(v):
        raise InputError(f"{path}: invalid identifier")
    return v


def _number(v: Any, path: str, *, positive: bool = False, maximum: float = 1e12) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise InputError(f"{path}: expected finite number")
    if v < 0 or (positive and v == 0) or v > maximum:
        raise InputError(f"{path}: outside allowed range")
    return float(v)


def _memory(v: Any, path: str) -> dict[str, float]:
    _object(v, path, set(), POOLS)
    if not v:
        raise InputError(f"{path}: declare at least one memory pool")
    return {k: _number(n, f"{path}.{k}") for k, n in v.items()}


def _evidence(v: Any, path: str) -> None:
    _object(v, path, {"kind", "source"}, {"artifact_sha256", "collected_at"})
    if v["kind"] not in ("assumed", "measured"):
        raise InputError(f"{path}.kind: expected assumed or measured")
    _text(v["source"], f"{path}.source")
    if v["kind"] == "measured" and "artifact_sha256" not in v:
        raise InputError(f"{path}: measured profiles need an artifact_sha256")
    if "artifact_sha256" in v and not re.fullmatch(r"[a-f0-9]{64}", str(v["artifact_sha256"])):
        raise InputError(f"{path}.artifact_sha256: expected SHA-256 hex")
    if "collected_at" in v:
        _text(v["collected_at"], f"{path}.collected_at", 80)


def strict_loads(text: str) -> dict:
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise InputError(f"input exceeds {MAX_BYTES} bytes")
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise InputError(f"duplicate JSON key: {key}")
            result[key] = value
        return result
    try:
        return json.loads(text, object_pairs_hook=pairs,
                          parse_constant=lambda s: (_ for _ in ()).throw(InputError(f"invalid number: {s}")))
    except (json.JSONDecodeError, RecursionError) as exc:
        raise InputError(f"invalid JSON: {exc}") from exc


@dataclass(frozen=True)
class Scenario:
    data: dict
    resources: dict[str, dict]
    stages: dict[str, dict]
    links: dict[tuple[str, str], dict]
    order: tuple[str, ...]
    sha256: str

    @classmethod
    def read(cls, path: str | Path) -> "Scenario":
        with Path(path).open("r", encoding="utf-8") as f:
            text = f.read(MAX_BYTES + 1)
        return cls.parse(strict_loads(text))

    @classmethod
    def parse(cls, data: dict) -> "Scenario":
        # Copy once, both to normalize JSON values and prevent caller mutation.
        try:
            data = strict_loads(canonical(data))
        except (TypeError, ValueError, RecursionError) as exc:
            raise InputError(str(exc)) from exc
        _object(data, "scenario", {"schema", "name", "deadline_s", "min_quality", "quality_contract",
                                   "accounting", "baseline_resource", "resources", "stages", "links"},
                {"notes", "horizon_s"})
        if data["schema"] != "arbitrages.v1":
            raise InputError("unsupported schema; expected arbitrages.v1")
        _text(data["name"], "name", 160)
        _text(data["quality_contract"], "quality_contract", 2000)
        _number(data["deadline_s"], "deadline_s", positive=True, maximum=31536000)
        _number(data["min_quality"], "min_quality", maximum=1)
        if "notes" in data:
            _text(data["notes"], "notes", 4000)
        if data["accounting"] not in ("metered", "committed"):
            raise InputError("accounting: expected metered or committed")
        if data["accounting"] == "committed":
            horizon = _number(data.get("horizon_s"), "horizon_s", positive=True)
            if horizon < data["deadline_s"]:
                raise InputError("committed horizon must cover deadline")
        elif "horizon_s" in data:
            _number(data["horizon_s"], "horizon_s", positive=True)
        resources = {}
        if not isinstance(data["resources"], list) or not 1 <= len(data["resources"]) <= MAX_RESOURCES:
            raise InputError(f"resources: expected 1..{MAX_RESOURCES} resources")
        for r in data["resources"]:
            _object(r, "resource", {"id", "label", "memory_gib", "usd_per_hour", "billing_quantum_s",
                                    "minimum_lease_s", "startup_s", "premium", "price_source", "price_kind"})
            rid = _id(r["id"], "resource.id")
            if rid in resources:
                raise InputError(f"duplicate resource {rid}")
            _text(r["label"], f"{rid}.label", 160)
            _memory(r["memory_gib"], f"{rid}.memory_gib")
            for name in ("usd_per_hour", "minimum_lease_s", "startup_s"):
                _number(r[name], f"{rid}.{name}")
            _number(r["billing_quantum_s"], f"{rid}.billing_quantum_s", positive=True)
            if not isinstance(r["premium"], bool):
                raise InputError(f"{rid}.premium: expected boolean")
            if r["price_kind"] not in ("illustrative", "quote", "invoice", "unpriced"):
                raise InputError(f"{rid}.price_kind: invalid evidence kind")
            _text(r["price_source"], f"{rid}.price_source")
            if r["price_kind"] == "unpriced" and r["usd_per_hour"] != 0:
                raise InputError("unpriced resources must have zero rate; no cost claim is allowed")
            resources[rid] = r
        _id(data["baseline_resource"], "baseline_resource")
        if data["baseline_resource"] not in resources:
            raise InputError("baseline_resource must name a resource")
        if not isinstance(data["stages"], list) or not 1 <= len(data["stages"]) <= MAX_STAGES:
            raise InputError(f"stages: expected 1..{MAX_STAGES} stages")
        stages = {}
        for s in data["stages"]:
            _object(s, "stage", {"id", "deps", "output_gib", "profiles"}, {"colocate"})
            sid = _id(s["id"], "stage.id")
            if sid in stages:
                raise InputError(f"duplicate stage {sid}")
            if not isinstance(s["deps"], list) or not all(isinstance(x, str) for x in s["deps"]):
                raise InputError(f"{sid}.deps: expected identifiers")
            if len(set(s["deps"])) != len(s["deps"]) or sid in s["deps"]:
                raise InputError(f"{sid}: duplicate dependency or self-loop")
            _number(s["output_gib"], f"{sid}.output_gib")
            if "colocate" in s:
                _id(s["colocate"], f"{sid}.colocate")
            if not isinstance(s["profiles"], list) or not 1 <= len(s["profiles"]) <= MAX_PROFILES:
                raise InputError(f"{sid}: expected 1..{MAX_PROFILES} profiles")
            seen = set()
            for p in s["profiles"]:
                _object(p, f"{sid}.profile", {"id", "resource", "duration_s", "memory_gib", "quality", "evidence"},
                        {"description", "local_case", "local_variant"})
                pid = _id(p["id"], "profile.id")
                if pid in seen:
                    raise InputError(f"{sid}: duplicate profile {pid}")
                seen.add(pid)
                _id(p["resource"], "profile.resource")
                if p["resource"] not in resources:
                    raise InputError(f"{sid}/{pid}: unknown resource")
                _number(p["duration_s"], f"{sid}/{pid}.duration_s", positive=True)
                _memory(p["memory_gib"], f"{sid}/{pid}.memory_gib")
                _number(p["quality"], f"{sid}/{pid}.quality", maximum=1)
                _evidence(p["evidence"], f"{sid}/{pid}.evidence")
                for k in ("description", "local_case", "local_variant"):
                    if k in p:
                        _text(p[k], f"{sid}/{pid}.{k}")
            stages[sid] = s
        for s in stages.values():
            unknown = set(s["deps"]) - stages.keys()
            if unknown:
                raise InputError(f"{s['id']}: unknown dependencies {sorted(unknown)}")
        # Stable topological list order is part of this v0.1 search boundary.
        order, remaining = [], set(stages)
        while remaining:
            ready = sorted(s for s in remaining if set(stages[s]["deps"]) <= set(order))
            if not ready:
                raise InputError("dependency cycle")
            order.extend(ready)
            remaining.difference_update(ready)
        links = {}
        if not isinstance(data["links"], list) or len(data["links"]) > MAX_RESOURCES ** 2:
            raise InputError("links: invalid list")
        for link in data["links"]:
            _object(link, "link", {"from", "to", "bandwidth_gib_s", "latency_s", "usd_per_gib", "evidence"})
            a, b = _id(link["from"], "link.from"), _id(link["to"], "link.to")
            if a not in resources or b not in resources or a == b or (a, b) in links:
                raise InputError("link: unknown/identical endpoints or duplicate directed link")
            _number(link["bandwidth_gib_s"], "link.bandwidth_gib_s", positive=True)
            _number(link["latency_s"], "link.latency_s")
            _number(link["usd_per_gib"], "link.usd_per_gib")
            _evidence(link["evidence"], "link.evidence")
            links[a, b] = link
        return cls(data, resources, stages, links, tuple(order), digest(data))


def rejection(scenario: Scenario, profile: dict) -> str | None:
    r = scenario.resources[profile["resource"]]
    for pool, amount in profile["memory_gib"].items():
        if amount > r["memory_gib"].get(pool, 0):
            return f"{pool} requires {amount:g} GiB; {r['id']} has {r['memory_gib'].get(pool, 0):g} GiB"
    if profile["quality"] < scenario.data["min_quality"]:
        return f"quality {profile['quality']:g} below {scenario.data['min_quality']:g}"
    return None
