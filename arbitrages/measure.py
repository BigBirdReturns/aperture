"""Opt-in profiling of operator-supplied commands. Never used by the web server.

Commands run as the caller, without a shell. This is NOT a sandbox. The operator
must trust the command and its data-access/billing behavior. Standard streams
are temporarily spooled, size/time bounded, hashed, and deleted; not published.
"""
from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time

from .model import Scenario, InputError, digest, strict_loads, _object, _number
from .bench import percentile

MAX_STREAM_BYTES = 8 * 1024 * 1024


def _kill(proc):
    if os.name == "posix":
        try: os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError: pass
    elif proc.poll() is None:
        # Kill only this explicitly created child tree, never another workload.
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, check=False)
        if proc.poll() is None: proc.kill()
    proc.wait(timeout=5)


def capture(argv: list[str], cwd: Path, timeout_s: float) -> dict:
    start = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="arbitrages-measure-") as d:
        out, err = Path(d)/"stdout", Path(d)/"stderr"
        with out.open("wb") as of, err.open("wb") as ef:
            try:
                proc = subprocess.Popen(argv, cwd=cwd, stdout=of, stderr=ef, shell=False,
                                        start_new_session=(os.name == "posix"))
            except OSError as exc:
                return {"elapsed_s": time.perf_counter()-start, "returncode": None,
                        "failure": "launch_error", "os_error": exc.errno,
                        "stdout_sha256": None, "stderr_sha256": None}
            failure = None
            try:
                while proc.poll() is None:
                    if time.perf_counter()-start > timeout_s:
                        failure = "timeout"; _kill(proc); break
                    if out.stat().st_size > MAX_STREAM_BYTES or err.stat().st_size > MAX_STREAM_BYTES:
                        failure = "output_limit"; _kill(proc); break
                    try: proc.wait(timeout=.01)
                    except subprocess.TimeoutExpired: pass
            except BaseException:
                _kill(proc); raise
            elapsed = time.perf_counter()-start
        if out.stat().st_size > MAX_STREAM_BYTES or err.stat().st_size > MAX_STREAM_BYTES:
            failure = "output_limit"
        if failure:
            oh = eh = None
        else:
            oh, eh = hashlib.sha256(out.read_bytes()).hexdigest(), hashlib.sha256(err.read_bytes()).hexdigest()
        return {"elapsed_s": elapsed, "returncode": proc.returncode, "failure": failure,
                "stdout_sha256": oh, "stderr_sha256": eh}


def parse_manifest(path: str | Path) -> tuple[dict, Scenario, Path]:
    path = Path(path).resolve()
    data = strict_loads(path.read_text(encoding="utf-8"))
    _object(data, "measurement manifest", {"schema", "scenario_file", "trials", "commands"})
    if data["schema"] != "arbitrages.measure.v1": raise InputError("unsupported measurement manifest")
    if isinstance(data["trials"], bool) or not isinstance(data["trials"], int) or not 3 <= data["trials"] <= 30:
        raise InputError("measurement requires 3..30 trials")
    if not isinstance(data["scenario_file"], str): raise InputError("scenario_file must be a path")
    sc = Scenario.read(path.parent / data["scenario_file"])
    if not isinstance(data["commands"], list) or not 1 <= len(data["commands"]) <= 24:
        raise InputError("commands requires 1..24 explicit stage/profile entries")
    seen, expected = set(), {}
    for c in data["commands"]:
        _object(c, "command", {"stage", "profile", "argv", "expected_stdout_sha256", "timeout_s"})
        if not isinstance(c["stage"], str) or not isinstance(c["profile"], str):
            raise InputError("stage/profile must be identifiers")
        pair = c["stage"], c["profile"]
        if pair in seen: raise InputError("duplicate stage/profile measurement")
        seen.add(pair)
        if c["stage"] not in sc.stages or not any(p["id"] == c["profile"] for p in sc.stages[c["stage"]]["profiles"]):
            raise InputError("measurement references unknown stage/profile")
        if not isinstance(c["argv"], list) or not 1 <= len(c["argv"]) <= 100 or not all(isinstance(x,str) and len(x)<=8000 and '\x00' not in x for x in c["argv"]):
            raise InputError("argv must be a bounded list of strings")
        if not isinstance(c["expected_stdout_sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", c["expected_stdout_sha256"]):
            raise InputError("expected_stdout_sha256 must bind the exact output contract")
        if expected.setdefault(c["stage"],c["expected_stdout_sha256"]) != c["expected_stdout_sha256"]:
            raise InputError("profiles of the same stage must share an output contract")
        _number(c["timeout_s"], "timeout_s", positive=True, maximum=300)
    return data, sc, path.parent


def measure(path: str | Path, out: str | Path, allow_exec: bool = False) -> dict:
    if not allow_exec:
        raise InputError("execution requires --allow-exec; review the manifest and trust its commands first")
    manifest, sc, cwd = parse_manifest(path)
    out = Path(out)
    if out.exists() and any(out.iterdir()):
        raise InputError("measurement output directory must be new or empty")
    out.mkdir(parents=True, exist_ok=True)
    rows, summaries = [], []
    for trial in range(manifest["trials"]):
        commands = manifest["commands"] if trial % 2 == 0 else list(reversed(manifest["commands"]))
        for c in commands:
            argv = [sys.executable if x == "$PYTHON" else x for x in c["argv"]]
            row = capture(argv, cwd, c["timeout_s"])
            row.update(stage=c["stage"], profile=c["profile"], trial=trial,
                       command_sha256=digest(c),
                       output_contract_sha256=c["expected_stdout_sha256"])
            row["contract_pass"] = row["failure"] is None and row["returncode"] == 0 and row["stdout_sha256"] == c["expected_stdout_sha256"]
            rows.append(row)
    raw_text = ''.join(json.dumps(r,sort_keys=True,separators=(',',':'))+'\n' for r in rows)
    raw_sha = hashlib.sha256(raw_text.encode()).hexdigest()
    (out/'measurements.jsonl').write_text(raw_text,encoding='utf-8',newline='\n')
    data = sc.data
    for c in manifest["commands"]:
        group=[r for r in rows if r["stage"]==c["stage"] and r["profile"]==c["profile"]]
        s={"stage":c["stage"],"profile":c["profile"],"trials":len(group),"passed":sum(r["contract_pass"] for r in group),
           "p95_s":percentile([r["elapsed_s"] for r in group],.95),"command_sha256":digest(c)}
        summaries.append(s)
        p=next(p for p in data['stages'] if p['id']==c['stage'])
        p=next(p for p in p['profiles'] if p['id']==c['profile'])
        if s['passed']==s['trials']:
            p['duration_s']=s['p95_s'];p['quality']=1
            p['evidence']={'kind':'measured','source':'measurements.jsonl: complete subprocess wall time plus exact stdout contract. Memory envelope remains operator-declared.','artifact_sha256':raw_sha}
        else:
            p['quality']=0
    receipt={"schema":"arbitrages.measurement.v1","created_at":datetime.now(timezone.utc).isoformat(),
             "input_scenario_sha256":sc.sha256,"manifest_sha256":digest(manifest),
             "measurements_sha256":raw_sha,"summaries":summaries,
             "all_contracts_pass":all(r['contract_pass'] for r in rows),
             "boundary":"Measured command time and exact stdout equality. Hardware assignment and memory remain operator declarations. No invoice, fleet or LLM-quality attestation. Command arguments and output text are not exported."}
    receipt['sha256']=digest(receipt)
    (out/'measurement.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    # Failure never leaves a seemingly usable newly promoted scenario.
    if receipt['all_contracts_pass']:
        (out/'profiled-workload.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
    else:
        raise InputError("measurement contract failed; raw trials retained; no new profiles promoted")
    return receipt
