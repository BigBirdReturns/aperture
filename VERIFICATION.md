# Release verification

The release runs three independent checks: source/control tests, installation from the public GitHub package, and real native model execution. Results from the latter two are recorded here after execution; no GPU or throughput claim follows from unit-test success.

The controller preserves a single selected model artifact, an explicit context and backend, and records observed settings after loading. Tests do not establish general model accuracy, multi-GPU support, tool-calling compatibility, or performance parity with another product.
