# Verification ledger · Arbitrages 0.1.0 candidate

Observed 2026-09-16. These are bounded implementation results, not GPU-economics
claims. The tests and code were authored in the same implementation session;
passing them is not third-party validation.

## Linux source and actual CPU path

Python 3.13.5. `python -m unittest discover -s arbitrages/tests -v` passed
80 tests. Tests exercise data validation, placement/billing constraints, independent
schedule auditing, rehashed semantic tampering, small exhaustive comparison
controls, real subprocess workloads, profiling consent/failure behavior, and HTTP
Host/Origin/input limits. The microcases do not prove global optimizer correctness.

A separate `demo --trials 5 --items 40000` completed 30 subprocess trials. Every
paired implementation produced identical output hashes. Selected local replay
ran dictionary aggregation, set membership, and inverted-index retrieval; all
three exact-output contracts passed. The measured replay took 0.335988155 seconds
on this host. This is one CPU control run, not a fleet benchmark or service SLO.

Raw-trial SHA-256:
`be9b511d78ee5052107088ec3d15b71bc09ab7bd8f6d30a36370f1dd63f7d328`.

The separate trusted-command example completed six trials with exact stdout
contracts. Its output profiles are unpriced. No model, API, GPU or cloud was used.

## Modeled controls

| Illustrative case | Best single resource | Selected | Observation |
| --- | ---: | ---: | --- |
| Mixed pipeline | $0.2235 | $0.1713 | 23.36% modeled reduction; 431.095 s modeled completion. The $0.52 premium-held comparison would produce a much more flattering roughly 3x ratio. |
| High transfer overhead | $0.2235 | $0.2235 | Chooses the single-resource fallback; moving data earns no savings. |
| Committed fleet, 24 hours | $224.64 | $224.64 | Idle/released capacity does not remove the commitment charge. |
| 60-second deadline | No plan found | No plan found | Refuses a saving claim when no retained schedule meets the deadline. |

Prices, stage durations, quality scores, memory envelopes, and transfer parameters
in these fixtures are deliberately invented scenario inputs. They have never
been presented as vendor performance or market pricing. Six bandwidth-sensitivity
points also produced complete, independently audited counterfactual reports.

## Browser surface

Chromium rendered the desktop (1440 px) and mobile (390 px) layouts, with no outer
horizontal overflow on mobile and no JavaScript errors. Nine checks covered
initial values, baseline selection, deadline refusal, reset, committed accounting,
JSON download, mobile overflow, and offline control behavior.

The container's managed browser disallowed direct HTTP navigation. Tests left
that policy intact and used a Playwright transport binding into the actual
loopback HTTP server. This tests the UI plus real planning endpoint, but does
not qualify direct browser networking in that environment. Separate socket-level
HTTP tests exercised Host, Origin, content type, path and body limits. Desktop
and mobile screenshots were visually inspected.

## Remaining unverified boundaries

No physical GPU workload, cross-host data transfer, cloud lifecycle, model quality,
GPU-memory allocator, demand trace, billing invoice, production load, or capacity
increase has been measured. The actual execution path is local CPU; the broader
mixed-resource schedule remains a model. The standalone auditor checks consistency
under that declared model, not the truth of user-supplied measurements.

Aperture's existing release and native-runtime claims remain untouched. This
module requires a source checkout and is not part of the v0.4.7 executable package.

## Native Windows observations

The actual 30-trial CPU suite also passed on Windows, with the same three
implementations selected and all replayed output contracts satisfied. The
observed replay duration was 0.276336900 seconds; raw-trial SHA-256 was
`436bb0727e387feaf1c4b62f04ea599f73828e78678f8119dfc24b1389d5ea8a`.
Existing Aperture controls passed 190/190 before and after adding the module,
and its clean-package install/support/Recipe Lab smoke passed.

Native testing caught newline translation changing raw artifact hashes and a
Windows socket-reset behavior when replying before consuming a bounded request
body. The code now preserves LF in raw trace files and consumes bounded bodies
before early HTTP error responses. Fresh cross-platform controls must validate
these repairs; the PR records the final run states.
