# Contributing to Aperture

Start from a specific user journey, source format, or runtime failure. Include the exact application version and a minimal reproduction without private prompts, credentials, or machine snapshots. Use the issue templates for a bug or model/backend support request.

## Local development

Use Node.js 22 or 24 and Git. The CLI has no initial dependencies or install scripts.

```sh
git clone https://github.com/BigBirdReturns/aperture.git
cd aperture
npm test
node scripts/package-smoke.mjs
node bin/aperture.mjs --help
```

Do not overwrite another working checkout or interfere with its running models. Make changes on a branch. Source/control tests are not native execution qualification.

## Changes that need explicit evidence

Preserve artifact identity, revision, selected representation, explicit context/concurrency, independent consent, and device identity. Never describe zero GPU layers as GPU execution. Do not combine independent memory pools or treat disk and RAM as interchangeable. Report unimplemented adapters as such.

A new native route should name the runtime and model versions, hardware, requested and observed settings, workload, memory observations, outcome, and retained failure cases. Distinguish metadata inspection, admission prediction, successful load, generation, and task validation. Keep a smaller smoke model separate from the actual target.

Public examples must use synthetic or explicitly public content. Do not commit weights, local receipts containing private paths, credentials, complete device snapshots, or private prompts. Runtime licenses and checkpoint licenses are independent from this repository's license.

## Documentation and site

The navigable site is generated from `docs/pages/*.md`; those same Markdown files remain readable on GitHub. Release coordinates are centralized in `docs/site.json`. Edit the version deliberately and run the command-consistency checks. Do not label development probes as released features.

```sh
python -m venv .venv-docs
# Activate the environment using your platform's normal command.
python -m pip install -r docs/requirements.txt
python tools/build_docs.py --out _site
python tools/check_docs.py _site
```

For browser checks, install the optional dependencies in `docs/requirements-browser.txt`, install Playwright Chromium, and run `python tools/check_docs_browser.py _site`. Use `APERTURE_TEST_BROWSER` to select an existing compatible Chromium binary. Screenshots and test reports go outside source by default.

The public interface follows the AXM dark ecosystem family, with readable type roles, restrained teal, explicit states, and keyboard-visible controls. See `docs/STYLE.md`. Do not mix report-poster styling into operational navigation.

## Release checklist

A release needs a fixed source commit, passing controls, a package built from that commit, fresh-cache public installation, observed native support boundaries, a current README/site/reference, and a working recovery path. Upload only reviewed distributables. Keep existing release assets immutable; executable changes require a new version.

New release verification does not overwrite historical observations. Update the support matrix and changelog at the same time as public commands. A documentation-only deployment must not change the native runtime or move an existing release tag.
