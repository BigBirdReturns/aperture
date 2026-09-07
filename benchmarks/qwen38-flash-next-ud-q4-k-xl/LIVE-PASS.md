# Aperture Fabric live passage: Qwen3.8-Flash-Next UD-Q4_K_XL

This is the activation checklist for the first live Aperture Fabric distributed-load passage. It is intentionally stricter than the offline planner tests. A blank or failed gate stops the transaction; no benchmark number is substituted.

## 0. Authority and seat boundary

Required before any model acquisition, worker launch, or load:

- N01 is the reachable estate authority head.
- The controlling occurrence is admitted by N01, not by a worker or direct remote shell.
- W01/L01 are not addressed through Remote Desktop Commander for this passage.
- Each participating worker is reachable through the governed estate/headless-worker path.
- If W01 is interactively occupied, its headless worker may use only the admitted GPU resource. It may not open windows, browsers, credential prompts, terminals in the desktop session, or change focus.
- No fallback promotes an independently reachable worker to authority if N01 becomes unavailable.

If N01 is unavailable, status is `HOLD_AUTHORITY_HEAD`. Stop.

## 1. Live census

Collect a fresh `aperture-scan/1` snapshot from each participating node through its resident headless worker. Convert the node observations with `makeFabricCensus()`.

The accepted census must show:

- exactly four eligible canonical `RTX 3090` devices;
- four distinct physical memory domains;
- each domain's physical and currently free bytes separately;
- authority-host allocation headroom;
- worker readiness independently from machine reachability;
- occupied-seat state where applicable;
- observed local PCIe information when available;
- observed estate transport class/rate when available, without inventing a link rate from hardware marketing.

`NVIDIA RTX 3090` and `NVIDIA GeForce RTX 3090` canonicalize to the same model. `RTX 3090 Ti`, `RTX 5090`, and other devices do not satisfy this fixture.

## 2. Runtime-adapter qualification

The first candidate adapter is `llama.cpp-rpc` over estate-LAN TCP. Before it can enter the Fabric census as `QUALIFIED`, retain:

- exact 40-hex llama.cpp commit;
- exact build identity and CUDA build flags;
- native CUDA support observed;
- `rpc-server` capability observed;
- `llama-bench` capability observed;
- worker-local device selection verified;
- LAN-only bind/endpoint policy verified;
- no browser, desktop, or interactive-auth dependency.

If the candidate cannot satisfy this contract, status is `HOLD_ADAPTER`. Aperture may later use another adapter without changing this benchmark identity.

## 3. Model custody and admission

Do not infer model identity from the repository or filename alone. The four local shards must match all pinned SHA-256 values in `recipe.json` before placement or execution is admitted.

Retain:

- exact local byte count for every shard;
- exact SHA-256 for every shard;
- exact aggregate byte count computed from the admitted local files;
- source/revision coordinates from `recipe.json`;
- whether the bytes were already present or required an explicitly approved acquisition.

This live passage does not itself grant download permission. If any shard is absent, stop at `HOLD_MODEL_BYTES` until acquisition is separately authorized.

## 4. Fabric placement

Map `fabric-spec.json` through `fabricPolicyFromSpec()` and call `makeFabricPlan()` with the live census and exact local model byte count.

The plan must be `READY_TO_CANARY` and must retain:

- four independent RTX 3090 domains;
- current free-memory-derived usable bytes for each domain after the 2 GiB reserve;
- explicit per-domain model weight bytes;
- explicit residual CPU-resident model bytes;
- authority-host budget after the 4 GiB reserve;
- `pooled: false`;
- exact runtime-adapter identity;
- occurrence ID, lease epoch, and fence;
- canaries `[2048, 8192, 32768]`;
- portable-v1 benchmark identity.

A planning total may sum physical/usable bytes for accounting. It is never represented as a single 96 GiB device or addressable VRAM pool.

## 5. Worker preparation

Use the estate's existing authoritative occurrence/lease/worker mechanism. Do not create another daemon, another independent SQLite authority ledger, or ad hoc SSH/RDC fan-out for this benchmark.

Translate the Aperture Fabric worker intents into the existing estate primitive only after inspecting the live/current schema on N01. Every worker preparation receipt must bind:

- occurrence ID;
- lease epoch;
- exact fence;
- node and device assignment;
- exact runtime commit/build identity;
- worker-local device selector;
- allocated estate-LAN endpoint reference;
- READY or explicit HOLD status.

`admitPreparedRpcTransaction()` must accept the full preparation set before model load.

## 6. Fenced distributed load

The adapter may now realize the placement. The load receipt must return the exact occurrence fence and `LOADED` state. Record:

- start/end time;
- per-domain loaded model bytes;
- CPU-resident model bytes;
- per-node VRAM before/after;
- authority-host memory before/after;
- model transfer/cache behavior;
- endpoint/transport class and measured transfer timing;
- exact loaded model identity.

A stale fence, missing worker, mismatched placement, or unexpected device causes immediate cleanup and HOLD.

## 7. Correctness canaries

Run in order through the same admitted Fabric placement:

1. 2,048-token context;
2. 8,192-token context;
3. 32,768-token context.

Each result must bind the occurrence fence and independently return `PASS`. Preserve the deterministic fixture, generated output or comparison digest, and runtime observations sufficient to reproduce the verdict.

Any failure sets `HOLD_CORRECTNESS`. Do not run or publish performance results after a failed canary.

## 8. Portable-v1 benchmark

Only after all canaries pass, execute:

- prompt processing: 4,096 tokens;
- generation: 256 tokens;
- context depths: 0, 32,768, 65,536, 131,072;
- batch: 4,096;
- ubatch: 4,096;
- three repetitions;
- machine-readable JSON output.

Retain the individual trials, averages, variance/standard deviation, prompt tokens/s, decode tokens/s, load/transfer time, per-domain memory state, authority-host state, and transport observations. Do not mix prompt processing and decode into one throughput number.

The public comparison may repeat the separately sourced reference observations, but the Aperture row contains only measurements from this exact passage.

## 9. Cleanup and reconciliation

Cleanup is mandatory whether preparation, load, canary, or benchmark succeeds or fails. The final evidence must show:

- all Fabric-owned runtime workers stopped or returned to their admitted resident state;
- ephemeral adapter endpoints closed;
- no Fabric occurrence retains an obsolete writable lease;
- stale workers cannot commit after fence/epoch change;
- model files remain under their admitted custody rules;
- W01 occupied desktop/session was not altered by the passage;
- authoritative occurrence reaches a terminal state;
- cleanup receipt is retained even after an earlier failure.

## 10. Public receipt

Generate `aperture-fabric-receipt/1` only after reconciliation. The reduced receipt must remove internal hostnames, addresses, paths, credentials, GPU UUIDs, and private endpoint references while retaining:

- model shard names/hashes and aggregate bytes;
- four separate memory domains and their capacities;
- per-domain placement bytes;
- residual authority-host placement;
- canonical GPU model and observed compute/link facts;
- runtime adapter commit/build identity;
- canary verdicts;
- benchmark fixture and measured results if admitted;
- explicit `pooled: false` claim boundary.

## Terminal classifications

- `HOLD_AUTHORITY_HEAD`
- `HOLD_CENSUS`
- `HOLD_ADAPTER`
- `HOLD_MODEL_BYTES`
- `HOLD_PLACEMENT`
- `HOLD_PREPARATION`
- `HOLD_LOAD`
- `HOLD_CORRECTNESS`
- `MEASURED_AND_RECONCILED`

Only `MEASURED_AND_RECONCILED` may populate the Aperture performance row in the public comparison table.
