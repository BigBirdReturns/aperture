# Qwen3.8-Flash-Next UD-Q4_K_XL estate benchmark

This candidate freezes a reproducible workload before any Aperture estate result is published.

## Why this exists

The IFA EVO-X5 Pro demonstration is useful but incomplete as a benchmark receipt: it shows roughly 344 tok/s prompt processing and reports double-digit decode, but the public material does not disclose the exact prompt length, exact decode rate, llama.cpp identity, placement or context settings. Those numbers therefore remain reference observations.

A stronger public reference appeared on PC Watch on September 7, 2026. It ran the same Unsloth `UD-Q4_K_XL` Qwen3.8-Flash-Next representation with an RTX 3090 and reported `ctx=131072`, `n-cpu-moe=46`, one slot, `-ub 4096`, `-t 24`, 231.5 tok/s prompt processing and 20.9 tok/s decode. That is a valuable same-model/3090 reference, but the article still does not publish the exact prompt fixture or enough timing-method detail to claim a byte-for-byte benchmark reproduction.

The Aperture result will therefore publish two things separately:

1. the public reference numbers exactly as reported; and
2. an independently reproducible `portable-v1` fixture whose model bytes, llama.cpp commit, workload, topology, placement and measurements are all retained.

## Portable-v1 workload

Use the four exact `UD-Q4_K_XL` files listed in `recipe.json`. Verify every SHA-256 before model admission.

Run `llama-bench` with a fixed 4,096-token prompt-processing test and 256-token generation test at context depths 0, 32,768, 65,536 and 131,072. Use three repetitions, batch and ubatch 4,096, and JSON output. Record the exact llama.cpp commit and build flags rather than referring to `master`.

The conceptual invocation is:

```text
llama-bench \
  -m <first UD-Q4_K_XL shard> \
  -p 4096 \
  -n 256 \
  -d 0,32768,65536,131072 \
  -b 4096 \
  -ub 4096 \
  -r 3 \
  -o json \
  <explicit placement/topology flags>
```

Placement flags are deliberately not frozen in the portable workload. A 192 GB unified-memory APU, one 128 GB host plus a 24 GB 3090, four independent 24 GB GPUs, or a CPU/GPU split are different architectures. The receipt must expose how the same model/workload was placed rather than forcing different machines to pretend they have the same memory topology.

## Aperture estate candidate

The interesting estate configuration is the cursed one: four independent RTX 3090 24 GB memory domains distributed across multiple hosts, coordinated by the estate head. The result must never be summarized as a single `96 GB VRAM` device.

The intended experiment is:

1. prove the model cannot be truthfully admitted as a single-device workload on the available nodes;
2. start headless CUDA RPC workers only through estate control, without opening UI on an occupied seat;
3. expose only the intended 3090 devices, excluding unrelated accelerators;
4. admit the exact model hashes;
5. pass deterministic 2K, 8K and 32K distributed correctness canaries;
6. only then execute the portable-v1 performance fixture;
7. record per-node VRAM, host RAM, link state, model placement, load time, prompt-processing throughput and decode throughput;
8. publish a reduced topology/result receipt without internal hostnames, addresses, paths or credentials.

## Known distributed correctness gate

Current llama.cpp RPC is explicitly described upstream as proof-of-concept, fragile and insecure, and there is a current Qwen3.8-Flash-Next report where a model split across RPC hosts degenerates for prompts above roughly 2K tokens. That report is configuration-specific and does not prove every CUDA RPC topology is broken, but it is enough to require a correctness gate before publishing performance.

A failure here is still a useful result. The public claim would become: exact Qwen3.8 model, exact runtime commit, exact multi-host topology, deterministic failure boundary. Performance numbers after a failed correctness gate are not admitted.

## Publication shape

The useful public table is:

| System | Memory topology | Model | Context/depth | Prompt t/s | Decode t/s | Correctness | Placement |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| EVO-X5 Pro IFA demo | 192 GB unified | UD-Q4_K_XL | undisclosed | ~344 | double-digit, exact rate undisclosed | observed demo | undisclosed |
| PC Watch EVO-X3 + RTX 3090 | 128 GB host + separate 24 GB VRAM | UD-Q4_K_XL | 131072 | 231.5 | 20.9 | observed article | `n-cpu-moe=46`, 1 slot, ubatch 4096, 24 threads |
| Aperture estate | explicit per-device domains | same exact hashes | portable-v1 | measured | measured | canary-gated | fully receipted |

Until the Aperture row has run, it remains blank. No estimate is substituted for a measurement.
