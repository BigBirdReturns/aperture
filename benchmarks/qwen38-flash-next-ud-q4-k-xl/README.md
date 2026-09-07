# Qwen3.8-Flash-Next UD-Q4_K_XL estate benchmark

This candidate freezes a reproducible workload before any Aperture estate result is published.

## Why this exists

The IFA EVO-X5 Pro demonstration is useful but incomplete as a benchmark receipt: it shows roughly 344 tok/s prompt processing and reports double-digit decode, but the public material does not disclose the exact prompt length, exact decode rate, llama.cpp identity, placement or context settings. Those numbers therefore remain reference observations.

A stronger public reference appeared on PC Watch on September 7, 2026. It ran the same Unsloth `UD-Q4_K_XL` Qwen3.8-Flash-Next representation with an RTX 3090 and reported `ctx=131072`, `n-cpu-moe=46`, one slot, `-ub 4096`, `-t 24`, 231.5 tok/s prompt processing and 20.9 tok/s decode. That is a valuable same-model/3090 reference, but the article still does not publish the exact prompt fixture or enough timing-method detail to claim a byte-for-byte benchmark reproduction.

The Aperture result will therefore publish two things separately:

1. the public reference numbers exactly as reported; and
2. an independently reproducible `portable-v1` fixture whose model bytes, runtime commit, workload, topology, placement and measurements are all retained.

## Portable-v1 workload

Use the four exact `UD-Q4_K_XL` files listed in `recipe.json`. Verify every SHA-256 before model admission.

The portable numerical workload is a fixed 4,096-token prompt-processing test and 256-token generation test at context depths 0, 32,768, 65,536 and 131,072, with three repetitions, batch and ubatch 4,096, and machine-readable output. The exact runtime commit and build flags must be recorded rather than referring to a moving branch.

A direct `llama-bench` invocation is useful only as the portable workload definition and as an external control. It is not the Aperture estate execution path.

Placement flags are deliberately not frozen in the portable workload. A 192 GB unified-memory APU, one 128 GB host plus a 24 GB 3090, four independent 24 GB GPUs, or a CPU/GPU split are different architectures. The receipt must expose how the same model/workload was placed rather than forcing different machines to pretend they have the same memory topology.

## Aperture Fabric is the loader

The interesting estate configuration is the cursed one: four independent RTX 3090 24 GB memory domains distributed across multiple hosts, coordinated by the estate head. The result must never be summarized as a single `96 GB VRAM` device.

Aperture owns the distributed load transaction. Runtime mechanisms such as llama.cpp CUDA/RPC, a future native transport, or another admitted backend are implementation adapters underneath the fabric. They do not own topology, placement authority, artifact admission, worker identity, measurement attribution or the public claim.

The Fabric transaction must:

1. discover the available estate devices through the governed estate surface;
2. retain each GPU as a separate physical memory domain with its own node, free capacity and link observations;
3. admit the four exact model shard hashes before any load;
4. construct an explicit placement plan covering weights, CPU-resident state, GPU-resident state and KV/cache ownership;
5. select the smallest admitted runtime adapter capable of realizing that placement;
6. start worker-side runtime components headlessly without opening UI on an occupied seat;
7. fence the occurrence so stale or disconnected workers cannot commit an authoritative result after reassignment;
8. prove a deterministic 2K correctness canary, followed by 8K and 32K canaries, before admitting performance measurements;
9. execute the portable-v1 workload through the same admitted Fabric placement;
10. capture per-node VRAM, host RAM, link state, model placement, load/transfer time, prompt-processing throughput, decode throughput and correctness evidence;
11. publish a reduced topology/result receipt without internal hostnames, addresses, paths or credentials.

No direct hand-written RPC launch, SSH fan-out or per-worker model invocation qualifies as an Aperture estate result. Those mechanisms may be used by a Fabric adapter, but the user-facing transaction remains one Aperture load plan and one Aperture receipt.

## What is missing today

Aperture 0.4.7 ships the source-pinned Recipe Lab and existing single-device/native fit paths. It does not yet ship a distributed Fabric loader. This benchmark is therefore the acceptance workload for that next layer rather than a reason to bypass it.

The minimum Fabric implementation needed for this benchmark is:

- estate capability discovery;
- explicit multi-domain placement planning;
- worker/runtime adapter lifecycle;
- model-shard custody and integrity admission;
- occurrence/lease/fence binding for the distributed load;
- correctness canaries before throughput;
- topology and measurement receipts;
- fail-closed cleanup and reconciliation.

The first adapter may use llama.cpp RPC if it survives qualification. Aperture must be able to replace that adapter later without changing the benchmark identity, public receipt schema or model-placement semantics.

## Known distributed correctness gate

Current llama.cpp RPC is explicitly described upstream as proof-of-concept, fragile and insecure, and there is a current Qwen3.8-Flash-Next report where a model split across RPC hosts degenerates for prompts above roughly 2K tokens. That report is configuration-specific and does not prove every CUDA RPC topology is broken, but it is enough to require a correctness gate before publishing performance.

A failure here is still a useful result. The public claim would become: exact Qwen3.8 model, exact Fabric placement, exact runtime adapter commit, exact multi-host topology, deterministic failure boundary. Performance numbers after a failed correctness gate are not admitted.

## Publication shape

The useful public table is:

| System | Memory topology | Model | Context/depth | Prompt t/s | Decode t/s | Correctness | Placement |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| EVO-X5 Pro IFA demo | 192 GB unified | UD-Q4_K_XL | undisclosed | ~344 | double-digit, exact rate undisclosed | observed demo | undisclosed |
| PC Watch EVO-X3 + RTX 3090 | 128 GB host + separate 24 GB VRAM | UD-Q4_K_XL | 131072 | 231.5 | 20.9 | observed article | `n-cpu-moe=46`, 1 slot, ubatch 4096, 24 threads |
| Aperture Fabric estate | explicit per-device domains | same exact hashes | portable-v1 | measured | measured | canary-gated | fully receipted |

Until the Aperture row has run, it remains blank. No estimate is substituted for a measurement.
