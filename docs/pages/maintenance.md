# Maintenance and releases

The documentation and numerical runtime have separate release paths. Publishing these pages does not change a model, an installed runtime, or an existing release tag. The release record in `docs/site.json` binds the website to the executable it describes.

## Build the documentation

Use a separate checkout and a local Python environment. Source pages remain readable as Markdown on GitHub. The static build uses no external fonts, analytics, or third-party JavaScript.

```sh
python -m venv .venv-docs
# Activate the environment using your platform's normal command.
python -m pip install -r docs/requirements.txt -r docs/requirements-browser.txt
python -m playwright install chromium
python tools/build_docs.py --out _site
python tools/check_docs.py _site
python tools/check_docs_browser.py _site
```

Set `APERTURE_TEST_BROWSER` to an existing compatible Chromium executable when needed. Browser evidence is written outside the published directory. `--base-url` runs the same checks against a deployed site. Copy, navigation, search, mobile layout, and missing-page recovery require actual browser checks, not only string matching.

## Preserve the public identity

`docs/identity/` contains the frozen SCG source files and their Git blob identities. The build validates all three and derives the exact 16-column, 18-row, 79-cell pixel dandelion. The header uses one mark; the footer is wordmark-only. Bone, olive, and void are the practice palette; ember is reserved for findings. Fonts are local stacks, not distributed files.

## Update a release coherently

Resolve the exact release commit and actual package asset first. Update the version, tag, package URL, and support boundaries together. Keep historical observations distinct from new measurements. The validation checks package versions, the executable's help flags, local links, search coverage, and canonical identity.

## Publish and check the hosted site

The documentation workflow builds and checks the site on a branch and pull request. Only a non-pull-request run on `main` uploads the reviewed `_site` directory to GitHub Pages. Runtime checks run separately. Do not publish worktree contents, raw local receipts, model weights, credentials, or font files.

After deployment, inspect the actual HTTPS site, package link and checksum, search index, command clipboard, and a missing URL. Set the repository homepage to the site only once the site responds correctly. The website's social-preview metadata is separate from GitHub's repository social-preview upload setting.

## Report an issue

Use [the repository's issue templates](https://github.com/BigBirdReturns/aperture/issues/new/choose) for a minimal redacted reproduction. Use [private vulnerability reporting](https://github.com/BigBirdReturns/aperture/security/advisories/new) for sensitive defects. See [contributing](https://github.com/BigBirdReturns/aperture/blob/main/CONTRIBUTING.md), [security policy](https://github.com/BigBirdReturns/aperture/security/policy), and [release history](releases.md).
