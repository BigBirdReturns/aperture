# CAIRN Fabric: native runtime adapters over heterogeneous seats

CAIRN Fabric turns a set of unrelated machines into one governed execution surface without pretending their memory is pooled or their runtimes are interchangeable. Aperture selects a native runtime seat for each independent job. CAIRN resolves, hashes, and materializes the admitted artifacts at the selected node. The estate's existing occurrence, lease, and fence mechanism authorizes preparation and launch. WATERLINE carries bytes and control messages without owning placement semantics.

This first implementation adds three executable boundaries:

1. `lib/runtime-adapter.mjs` defines the six-stage adapter contract: `probe`, `fit`, `prepare`, `launch`, `observe`, and `stop`. Qualification is read-only. Preparation and launch require a matching `aperture-runtime-authorization/1` receipt with an occurrence id and fence. Cleanup runs after every admitted launch, including observation failure.
2. `lib/cairn-fabric.mjs` evaluates every allowed adapter against every physical seat, assigns independent jobs deterministically, and emits node-scoped CAIRN materialization intents. It records every rejected candidate. It owns no daemon, lease table, or second scheduler.
3. Two source-pinned adapters prove the extension surface. `sglang/minicpm5-2b-dspark` transcribes SGLang's verified MiniCPM5-2B DSPARK recipe. `mlx-lm/server` transcribes the official MLX-LM server surface and requires an exact seat-bound fit receipt before placement.

## Adapter contract

| Stage | Effect | Required result |
| --- | --- | --- |
| `probe` | Read-only live capability observation | Runtime/build identity, device and current capacity facts, or an explicit HOLD |
| `fit` | Read-only model/workload placement decision | FIT with evidence and artifact intents, or an explicit HOLD |
| `prepare` | Authorized CAIRN materialization | Exact resolved revisions, file byte counts, SHA-256 receipts, and private local paths |
| `launch` | Authorized native runtime start | Shell-free argv, public handle reference, and endpoint |
| `observe` | Runtime readiness or terminal measurement | PASS/RUNNING, HOLD, or FAIL with retained evidence |
| `stop` | Mandatory cleanup | STOPPED or a terminal cleanup failure |

Adapters preserve native semantics. SGLang remains SGLang; MLX-LM remains MLX-LM. Aperture standardizes the admission and evidence envelope rather than flattening runtime-specific controls into a lowest-common-denominator API.

## Source-pinned first adapters

The SGLang adapter pins repository `sgl-project/sglang`, revision `2bf04f3a67edf5f1c43b4f00761f19758346dcf7`, path `docs/src/snippets/configs/openbmb/minicpm5-2b.jsx`. It admits the exact MiniCPM5-2B BF16 + DSPARK recipe on the upstream verified platform set or on another seat carrying an exact local platform-qualification receipt. It preserves the upstream flags, defaults to loopback, requires explicit consent for `--trust-remote-code`, and refuses undocumented hardware fit.

The MLX-LM adapter pins repository `ml-explore/mlx-lm`, revision `7fb4be44d560e5b74595210f83cb6003a57e52a7`, path `mlx_lm/server.py`. It admits Apple-silicon macOS seats only after observing Metal and `mlx_lm.server`, then requires a model-, seat-, adapter-, and source-bound fit receipt. It compares that receipt's working-set bytes against current unified-memory headroom and explicitly treats RAM and GPU memory as one domain.

## Dorm planner demonstration

Run:

```sh
node scripts/dorm-fabric-demo.mjs
```

The checked fixture contains six heterogeneous nodes: Linux/NVIDIA, Apple silicon, Windows/NVIDIA laptop, Linux/AMD, integrated graphics, and a queue head. The planner assigns MiniCPM5-2B to the verified SGLang seat, assigns a prequalified MLX artifact to the Mac seat, and leaves an optional ROCm job unplaced because no ROCm adapter exists. CAIRN emits three node-scoped artifact materializations. No model is downloaded and no process is launched.

The fixture is marked `SYNTHETIC_PLANNER_FIXTURE`. It proves deterministic placement, adapter refusal, artifact-intent generation, authority binding, and separate memory domains. It is not a performance result or a claim that the represented machines were physically connected.

## Live passage

A live dorm or lab result requires all of the following:

- a fresh census from each resident headless worker;
- exact runtime/build identities and current capacity observations;
- a governed authority occurrence bound to the exact plan hash, with lease epoch, fence, and explicit preparation/materialization/launch permissions;
- CAIRN materialization receipts for every selected artifact;
- native launch and readiness receipts from at least two runtime families;
- one seat removed during queued work, followed by fenced reassignment or explicit HOLD;
- terminal cleanup for every launched runtime;
- a reduced public receipt that removes private hostnames, paths, addresses, and device identifiers.

The public claim should report nodes, hardware/runtime families, jobs completed, wall-clock completion, transfer reuse, seat loss/recovery, and terminal failures. It should never add separate VRAM or unified-memory domains into a fictional accelerator capacity.

## Architectural ownership

- **CAIRN** owns artifact identity, custody, resolution, hashing, locality, and reuse.
- **PLOT** owns provenance-preserving transformation from source artifacts into executable material.
- **Aperture** owns fit, native-runtime selection, placement, execution intent, observation, and receipts.
- **WATERLINE** owns replaceable transport.
- **Estate authority** owns occurrences, leases, fences, and terminal state.

The next live integration binds `bindCairnFabricOccurrence()` output to the existing estate worker primitive and supplies concrete CAIRN and process drivers to the adapters. That integration extends the current authority plane; it does not create another scheduler.
