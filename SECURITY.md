# Security reporting

Report a potential security defect through [GitHub private vulnerability reporting](https://github.com/BigBirdReturns/aperture/security/advisories/new). Do not open a public issue containing credentials, private URLs, prompts, model files, or complete hardware snapshots. Describe the affected version, the boundary involved, and a minimal benign reproduction.

This is an early release. There is no promised response-time service level. Use a version-pinned package from the public release and inspect its published checksums.

## Relevant boundaries

The CLI asks separately before hardware inspection, metadata access, weight acquisition, runtime installation, and execution. Model artifacts are data, not permission to run publisher-provided Python. Optional native runtimes are trusted executable dependencies; their licenses and compatibility remain independent.

Answer JSON files should be treated as trusted local configuration. Do not execute a stranger's saved answer. Only point CUDA library discovery at trusted installed directories. Do not supply access tokens inside URLs, bypass checksums, or disable operating-system protections to work around an error.

Local run records can include sensitive data. No automated upload is enabled. The documentation site is static and has no model-upload facility. Site search is local to the published documentation; theme preferences remain in browser storage.

See the [privacy guide](docs/pages/privacy.md) for the current data and consent model. A successful security or control test is not certification of every runtime, driver, checkpoint, or environment.
