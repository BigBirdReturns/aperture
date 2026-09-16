"""CLI. Plans do not provision resources, change drivers, or send user data."""
from __future__ import annotations
import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

from . import __version__
from .model import Scenario, InputError, strict_loads
from .planner import optimize
from .audit import audit_report, AuditError
from .bench import benchmark, verify_benchmark, replay_local

EXAMPLES = Path(__file__).with_name("examples")


def write_json(path: str | Path, data: dict) -> None:
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Arbitrages: profile-driven placement with auditable costs; no automatic cloud spend.")
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("plan", help="Search and audit a workload; dollar values are modeled")
    p.add_argument("scenario"); p.add_argument("--out", default="arbitrages-output/plan.json")
    p.add_argument("--html", help="Self-contained interactive report path"); p.add_argument("--beam", type=int, default=128)
    p = commands.add_parser("audit", help="Independently check a saved report")
    p.add_argument("report")
    p = commands.add_parser("bench", help="Run measured CPU controls; no GPU or price claims")
    p.add_argument("--out", default="arbitrages-output/cpu"); p.add_argument("--trials", type=int, default=5)
    p.add_argument("--items", type=int, default=40000)
    p = commands.add_parser("verify-bench", help="Verify profile bindings, raw trials and summaries")
    p.add_argument("directory")
    p = commands.add_parser("run-local", help="Execute the selected built-in CPU profiles and verify outputs")
    p.add_argument("directory")
    p = commands.add_parser("demo", help="One command: CPU benchmark, schedule, actual replay and HTML")
    p.add_argument("--out", default="arbitrages-output/demo"); p.add_argument("--trials", type=int, default=5)
    p.add_argument("--items", type=int, default=40000)
    p = commands.add_parser("sweep", help="Modeled stress test, with complete reports for every point")
    p.add_argument("scenario"); p.add_argument("--kind", choices=["bandwidth", "startup", "deadline", "transfer-price"], default="bandwidth")
    p.add_argument("--factors", default="0.25,0.5,1,2,4"); p.add_argument("--out", default="arbitrages-output/sweep.json")
    p = commands.add_parser("measure", help="Profile trusted operator commands with exact-output contracts; opt-in")
    p.add_argument("manifest"); p.add_argument("--out", default="arbitrages-output/measured")
    p.add_argument("--allow-exec", action="store_true")
    p = commands.add_parser("serve", help="Loopback-only calculator; executes no workload code")
    p.add_argument("--port", type=int, default=8765); p.add_argument("--scenario", default=str(EXAMPLES / "pipeline.json"))
    args = parser.parse_args(argv)
    try:
        if args.command == "plan":
            sc = Scenario.read(args.scenario); report = optimize(sc, args.beam)
            proof = audit_report(report); write_json(args.out, report)
            if args.html:
                from .report import render
                path = Path(args.html); path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(render(report), encoding="utf-8")
            best = report["best"]
            print(json.dumps({"status": report["status"], "report": args.out,
                              "modeled_usd": best["cost"]["total_usd"] if best else None,
                              "modeled_completion_s": best["makespan_s"] if best else None,
                              "comparison": report["comparison"], "audit": proof}, indent=2))
            return 0 if best else 2
        if args.command == "audit":
            # Reports can exceed the scenario-size limit because they contain a frontier.
            p = Path(args.report)
            if p.stat().st_size > 32 * 1024 * 1024:
                raise InputError("report exceeds 32 MiB")
            print(json.dumps(audit_report(json.loads(p.read_text(encoding="utf-8"))), indent=2))
        elif args.command in ("bench", "demo"):
            receipt = benchmark(args.out, args.trials, args.items)
            proof = verify_benchmark(args.out)
            print(json.dumps({"benchmark": str(Path(args.out)/"benchmark.json"), "proof": proof,
                              "all_outputs_match": receipt["all_outputs_match"]}, indent=2))
            if args.command == "demo":
                replay = replay_local(args.out)
                from .report import render
                report = json.loads((Path(args.out)/"plan.json").read_text(encoding="utf-8"))
                (Path(args.out)/"report.html").write_text(render(report), encoding="utf-8")
                print(json.dumps({"executed_profiles": [(r["case"], r["variant"]) for r in replay["rows"]],
                                  "actual_cpu_wall_s": replay["elapsed_s"], "outputs_match": replay["all_outputs_match"],
                                  "report_html": str(Path(args.out)/"report.html")}, indent=2))
        elif args.command == "verify-bench":
            print(json.dumps(verify_benchmark(args.directory), indent=2))
        elif args.command == "run-local":
            print(json.dumps(replay_local(args.directory), indent=2))
        elif args.command == "sweep":
            sc = Scenario.read(args.scenario)
            try:
                factors = [float(x) for x in args.factors.split(",")]
            except ValueError as exc:
                raise InputError("factors must be comma-separated numbers") from exc
            if len(factors) > 15 or any(not 0 < f <= 10000 for f in factors):
                raise InputError("supply at most 15 finite factors in (0,10000]")
            results = []
            for factor in factors:
                data = deepcopy(sc.data)
                if args.kind == "deadline":
                    data["deadline_s"] *= factor
                    if data["accounting"] == "committed":
                        data["horizon_s"] = max(data["deadline_s"], data["horizon_s"])
                elif args.kind == "startup":
                    for r in data["resources"]: r["startup_s"] *= factor
                else:
                    key = "bandwidth_gib_s" if args.kind == "bandwidth" else "usd_per_gib"
                    for link in data["links"]: link[key] *= factor
                report = optimize(Scenario.parse(data), 64); audit_report(report)
                results.append({"factor": factor, "report": report})
            write_json(args.out, {"schema": "arbitrages.sweep.v1", "kind": args.kind,
                                 "boundary": "Counterfactual sensitivity scenarios; not measurements", "results": results})
            print(json.dumps({"out": args.out, "points": len(results), "statuses": [r["report"]["status"] for r in results]}, indent=2))
        elif args.command == "measure":
            from .measure import measure
            print(json.dumps(measure(args.manifest, args.out, args.allow_exec), indent=2))
        elif args.command == "serve":
            from .server import serve
            serve(Scenario.read(args.scenario), args.port)
        return 0
    except (InputError, AuditError, OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
