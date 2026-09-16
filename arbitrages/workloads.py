"""Small deterministic CPU controls. Deliberately no model or GPU claims."""
from __future__ import annotations
from collections import Counter
import ctypes
import hashlib
import json
import os
import platform
import random
import sqlite3
import sys
import time

from .model import canonical, digest

CASES = {"aggregate": ("python", "sqlite"), "membership": ("scan", "set"), "retrieval": ("scan", "index")}


def peak_rss_bytes() -> int | None:
    if os.name == "nt":
        class Counters(ctypes.Structure):
            _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong)] + [
                (name, ctypes.c_size_t) for name in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]
        counters = Counters(); counters.cb = ctypes.sizeof(counters)
        kernel = ctypes.windll.kernel32
        kernel.GetCurrentProcess.restype = ctypes.c_void_p
        get = ctypes.windll.psapi.GetProcessMemoryInfo
        get.argtypes = [ctypes.c_void_p, ctypes.POINTER(Counters), ctypes.c_ulong]
        if get(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            return int(counters.PeakWorkingSetSize)
        return None
    try:
        import resource
        value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(value if sys.platform == "darwin" else value * 1024)
    except (ImportError, OSError):
        return None


def run(case: str, variant: str, n: int) -> dict:
    if case not in CASES or variant not in CASES[case] or not 100 <= n <= 200000:
        raise ValueError("unknown workload/variant or size outside 100..200000")
    rng = random.Random(47291)
    t0 = time.perf_counter()
    if case == "aggregate":
        rows = [(rng.randrange(256), rng.randrange(-1000, 10001)) for _ in range(n)]
        workload_hash = digest(rows)
        if variant == "python":
            totals = {}
            for key, amount in rows:
                totals[key] = totals.get(key, 0) + amount
            output = sorted(totals.items())
        else:
            with sqlite3.connect(":memory:") as db:
                db.execute("create table entries (account integer, cents integer)")
                db.executemany("insert into entries values (?, ?)", rows)
                output = list(db.execute("select account, sum(cents) from entries group by account order by account"))
        # An independent conserved quantity catches accidental filtering.
        valid = sum(x[1] for x in output) == sum(x[1] for x in rows) and len(output) == len(set(x[0] for x in rows))
    elif case == "membership":
        rows = [rng.randrange(1024) for _ in range(n)]
        workload_hash = digest(rows)
        if variant == "scan":
            values = []
            for key in rows:
                if key not in values:
                    values.append(key)
            output = sorted(values)
        else:
            output = sorted(set(rows))
        valid = output == sorted(Counter(rows))
    else:
        docs = [" ".join(f"w{rng.randrange(512)}" for _ in range(12)) for _ in range(max(100, n // 8))]
        queries = [(f"w{rng.randrange(512)}", f"w{rng.randrange(512)}") for _ in range(48)]
        workload_hash = digest([docs, queries])
        if variant == "scan":
            output = [[i for i, doc in enumerate(docs) if all(w in doc.split() for w in query)] for query in queries]
        else:
            index = {}
            for i, doc in enumerate(docs):
                for word in doc.split():
                    index.setdefault(word, set()).add(i)
            output = [sorted(index.get(a, set()) & index.get(b, set())) for a, b in queries]
        valid = all(all(all(w in docs[i].split() for w in query) for i in found) for query, found in zip(queries, output))
    return {"case": case, "variant": variant, "n": n, "workload_sha256": workload_hash,
            "output_sha256": digest(output), "invariant_pass": valid,
            "inner_elapsed_s": time.perf_counter() - t0, "peak_rss_bytes": peak_rss_bytes()}


if __name__ == "__main__":
    print(canonical(run(sys.argv[1], sys.argv[2], int(sys.argv[3]))))
