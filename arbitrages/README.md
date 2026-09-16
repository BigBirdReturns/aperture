# Arbitrages · experimental reference implementation

A profile-driven workload planner, command profiler, independent schedule auditor,
and local calculator. Given a task DAG, per-stage hardware profiles, separate
memory budgets, prices, transfer paths, and a completion deadline, it produces a
costed schedule that a second code path checks.

**Status: experimental source module, version 0.1.0.** This directory does not
change Aperture's released local-inference runner. No cloud resources are
provisioned. The included executor runs three deterministic CPU workloads; it
does not dispatch a GPU fleet. Dollar results are modeled, even when timings
come from measurements. The four example scenarios are explicitly illustrative.

## Run it

Python 3.11 or newer. No third-party Python packages, API keys, model downloads,
accounts, or install steps. Run commands from the repository root.

```sh
# Actual CPU timings, output checks, schedule, replay, and offline HTML report.
python -m arbitrages demo --out arbitrages-output/demo

# Data-only local calculator. Open http://127.0.0.1:8765 in a browser.
python -m arbitrages serve

# Costed placement for the illustrative mixed-resource pipeline.
python -m arbitrages plan arbitrages/examples/pipeline.json \
  --out arbitrages-output/pipeline.json --html arbitrages-output/pipeline.html

# Independent recomputation of constraints and every billing total.
python -m arbitrages audit arbitrages-output/pipeline.json

# Tests include real child-process work, mutation attacks, and HTTP controls.
python -m unittest discover -s arbitrages/tests -v
```

Use `python3` where that is the installed executable. PowerShell supports each
command on one line; the backslash continuation above is a POSIX shell convention.
The demo's output directory must be new or empty. Keep prior runs rather than
silently overwriting evidence. Saved HTML reports work offline for inspection;
changing inputs requires the local server. The server has no execution endpoint.

## What the implementation actually optimizes

**Fit:** select only supplied profiles whose RAM, VRAM, and disk requirements
fit their separate resource budgets and whose quality score passes the stated
contract. A RAM surplus never fills a VRAM deficit. A different representation,
offload layout, batch size, or implementation needs its own measured profile.
The planner does not automatically invent one.

**Temporal:** choose between keeping an already-acquired resource warm or closing
its lease and paying cold-start/minimum-billing costs again later. Leased idle
time, startup, inbound transfer waits, billing quanta, and minimum lease duration
are charged. This is a bounded single-DAG lease model, not a demand forecaster.

**Heterogeneous:** assign stages to different exclusive execution slots, subject
to dependencies, optional co-location constraints, memory, quality, and deadline.
Cross-resource dependency edges require a declared directed link, take time,
occupy a serialized shared transfer fabric, and incur per-GiB cost.

Four baselines remain inspectable: the named baseline resource held warm; that
same resource allowed to release/restart; the best retained complete
single-resource alternative across **every** supplied resource; and mixed
placement with leases held warm. The headline comparison uses the best feasible
single-resource alternative, not whichever premium machine makes savings look
largest. Complete comparator plans remain candidates even if beam pruning is
aggressive. A no-op result is a valid result.

The search is deterministic beam search over a fixed, stable topological list
order, not a proof of globally optimal DAG scheduling. The CLI defaults to a
128-state beam; `--beam` accepts 1 through 1024. A retained frontier shows cost
versus modeled completion time. `NO_FEASIBLE_PLAN_FOUND` means this search found
none under these inputs. It is not a theorem about every possible schedule.

## Prices, invoices, and the denominator

`metered` charges rounded leases actually present in the plan, plus transfers.
`committed` charges the entire declared fleet for the same declared horizon in
every candidate, plus transfers. Releasing a reserved machine may free capacity
but does not by itself reduce its invoice. Capital expenditure, depreciation,
energy, staffing, storage retention, interruption probabilities, and demand
elasticity are not silently filled in. A supplied hourly rate must state which
costs it represents.

Every rate has a `price_kind` and `price_source`. `illustrative` means scenario
assumption, `quote` means a user-supplied quote, `invoice` means a user-supplied
invoice allocation, and `unpriced` blocks percentage savings claims. An unpriced
local CPU has a zero arithmetic rate, **not** a claim that computing is free.
Entering a new UI price relabels that field as an illustrative user assumption.

The report separates cost ratio, completion-time ratio, premium active seconds,
and billed seconds. It emits no "effective capacity multiplier": lower cost is
not proof of higher throughput, freed HBM, eliminated procurement, or reduced
aggregate market demand. `cash_savings_verified` and `gpu_execution_verified`
remain false. A pricing source or trace hash does not turn a model into an invoice.

## Evidence you can produce now

```sh
python -m arbitrages bench --out arbitrages-output/cpu --trials 5 --items 40000
python -m arbitrages verify-bench arbitrages-output/cpu
python -m arbitrages run-local arbitrages-output/cpu
```

The three CPU controls compare dictionary/SQLite aggregation, scan/set membership,
and scan/inverted-index retrieval. All use seeded, generated records, with exact
output hashes and independent output invariants. The harness includes interpreter
startup, input generation/loading, index construction, and serialization in
parent-observed wall time. Child Python uses `-S` to exclude unrelated site startup.
Variant order alternates by trial. Peak process RSS is measured where the OS
supports it; the generated RAM envelope adds 25% headroom and is explicitly not
a measurement of free machine memory.

`trials.jsonl` preserves every attempt. `benchmark.json` records source hashes,
trial hash, sample statistics, and reduced OS/Python/architecture metadata.
`profiled-workload.json` admits timings only after every comparison passes.
`verify-bench` checks summary completeness, trial counts, sizes, exact-output
consistency, percentiles, and bindings to the generated profiles. `run-local`
executes the selected built-in implementations and produces `replay.json`.
Hashes protect identity and internal consistency; they do not attest to an
untrusted submitter's hardware or honesty.

A five-sample p95 is the nearest-rank sample statistic, not a production latency
SLO. Composing stage p95s does not establish an end-to-end p95. Actual replay
and the predicted schedule are recorded separately. These tests verify the
CPU control path; they provide no measurement of B200 versus another GPU.

## Bring actual stage measurements

The opt-in profiler runs trusted operator commands without a shell. Review the
manifest first: this is **not a sandbox**, and the command runs with your user's
permissions. It can access whatever your account can access. The calculator
never calls this path. No automatic upload occurs.

A complete portable example ships here:

```sh
python -m arbitrages measure arbitrages/examples/measure-local.json \
  --allow-exec --out arbitrages-output/measured
python -m arbitrages plan arbitrages-output/measured/profiled-workload.json \
  --out arbitrages-output/measured/plan.json
```

A manifest supplies a scenario file, 3–30 trials, and an argv list per stage/profile,
with a timeout and a predeclared exact stdout SHA-256. `$PYTHON` selects the current
Python executable. Profiles of the same stage must share their output contract.
Commands run relative to the manifest directory; no string shell evaluation occurs.
Time and standard-stream limits stop the created child process tree. Output is
temporarily spooled, hashed, and discarded rather than included in public receipts.
Command arguments are represented by a hash, not copied into the receipt.
Failures are retained and prevent publication of a new profiled scenario.

For a real accelerator experiment, use this interface to call your own pinned,
trusted benchmark script on each actual host/runtime. Include loading, input/output
materialization, synchronization, and teardown in the stage boundary. Bind the
model revision, precision, batch, context, kernel/runtime versions, output contract,
and measured device in your separately retained benchmark artifact. Supply measured
memory and transfer profiles. This profiler measures time and exact output; it
does **not** prove GPU identity, memory sufficiency, LLM semantic quality, or a
cross-host execution route. Non-deterministic model quality needs a task-specific
validator and a separate retained evaluation, not a convenient score of one.

## Input contract

See `examples/pipeline.json` for a fully runnable, annotated-by-fields scenario.
Unknown fields, duplicate JSON keys, non-finite numbers, cycles, duplicate IDs,
missing resources, invalid profiles, and inconsistent declared accounting fail
closed. Scenario input is bounded to 512 KiB, 24 stages, 16 resources, and 12
profiles per stage. The interactive endpoint has smaller 12-stage/8-resource limits.

| Object | Required meaning |
| --- | --- |
| Scenario | Name, completion deadline in seconds, quality contract and minimum score, accounting basis, baseline resource, resources, stages, links. Committed mode adds a horizon. |
| Resource | One exclusive execution slot, separate memory pools in GiB, USD/hour, startup seconds, billing quantum and minimum lease, premium flag, price provenance. |
| Stage | Dependencies, output volume in GiB, implementation profiles, optional co-location group. |
| Profile | Resource identity, complete duration, separate memory requirements, quality score, source and assumed/measured evidence class. Measured entries require an artifact hash. |
| Link | Directed source/destination, effective GiB/s, latency seconds, USD/GiB, and evidence. Missing links are not free links. |

Outputs are assumed durable in a **resource-affine staging store** before a stage
completes. The supplied profile must include writing that output and reading its
local inputs, including any rehydration after a lease restart. Staging survives
lease release. Every cross-resource consumer is charged a copy. The model does
not price storage retention separately or emulate cache eviction, live KV migration,
link contention beyond its single fabric, concurrent tenants, tensor parallelism,
spot interruption, speculative execution, or a multi-request inference queue.
Profile envelopes include all buffers and resident input/output memory. Persistent
state not captured by that assumption requires a different model or co-location.

## Stress the claim rather than choosing the flattering chart

```sh
python -m arbitrages plan arbitrages/examples/transfer-trap.json
python -m arbitrages plan arbitrages/examples/committed.json
python -m arbitrages plan arbitrages/examples/infeasible.json
python -m arbitrages sweep arbitrages/examples/pipeline.json \
  --kind bandwidth --factors 0.1,0.25,0.5,1,2,4
```

The transfer trap is designed to make moving work uneconomic. The committed-fleet
case preserves the invoice despite changed assignments. The infeasible case exits
with code 2 while saving the refusal report. Sweeps return complete, independently
audited reports for each counterfactual, not a chart of invented measurements.

## Architecture and trust boundaries

`model.py` validates and hashes inputs. `planner.py` searches placements and leases.
`audit.py` independently replays dependencies, profiles, capacity gates, leases,
transfers, deadline, billing, and summaries without importing the planner's
accounting implementation. `bench.py` and `workloads.py` supply the actual CPU
path. `measure.py` profiles explicitly authorized commands. `report.py` and
`ui.html` produce self-contained inspection; `server.py` is a loopback data-only
calculator with Host/Origin guards, bounded JSON, no filesystem-serving endpoint,
and no code-execution endpoint.

No runtime dependency, external font, telemetry collector, analytics pixel, cloud
SDK, credential reader, model download, or market-pricing scraper is included.
Keep inputs, receipts, and command manifests local until reviewed for disclosure.
Use a new output directory for every measurement campaign.

## Relationship to existing work

This packages an inspectable decision and falsification workflow; it does not
claim to have invented heterogeneous scheduling, offload, or cost optimization.
Aperture already performs consented local model/hardware fit assessment. Its
published native support and release boundaries remain authoritative. This lab
uses supplied stage profiles and does not bypass those boundaries.

SkyPilot already provides compute orchestration and resource/cost selection:
<https://docs.skypilot.co/en/latest/sky-computing.html>.
FlexGen studies throughput-oriented GPU/CPU/disk offload with real tradeoffs:
<https://arxiv.org/abs/2303.06865>.
vLLM provides actual model-serving benchmark interfaces:
<https://docs.vllm.ai/>.
These are references, not implemented integrations or reproduced performance claims.

MIT, under the repository's existing license. Source and evidence limitations are
part of the product: a trustworthy "no saving" is preferable to an invented win.
