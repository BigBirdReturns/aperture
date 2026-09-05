# SCG practice identity

Aperture uses the approved Sandhu Consulting Group practice identity for its public website. The separate AXM operational theme is not used here.

The frozen source in `docs/identity/` comes from the SCG identity directory in `BigBirdReturns/axm-tools`. Its original Git blob identities are checked by `tools/scg_identity.py` during every build. The derived SVG retains the 16-column, 18-row bitmap and all 79 occupied cells. The header uses one mark; the footer is wordmark-only.

The palette is bone (#ECE7D8), olive (#7C7F57), and void (#0D0C09). Ember (#C24B2C) marks findings and limitations, never the dandelion. Supporting neutral surfaces preserve readable contrast.

Display uses IBM Plex Sans with system sans-serif fallbacks. Text and metadata use IBM Plex Mono with local monospace fallbacks. No font files are distributed or downloaded. The original mark is not redrawn, smoothed, or recentered.

Installation must remain visible, prerequisites must accompany the command, and the documentation must remain readable without JavaScript. Search and clipboard are optional conveniences. Retain keyboard focus, a skip link, mobile navigation, reduced-motion support, print styling, and clipboard-denied recovery.

Use complete explanatory sentences and accurate versioned claims. Do not describe source inspection as inference or preliminary memory estimates as a successful load. The website does not scan the visitor's computer.

The shared social-preview image is evergreen and carries no release number. Versions and package coordinates belong in the live HTML and release record, because previously shared images can remain cached across releases. Regenerate the image with `python tools/render_docs_asset.py` after editing its source, and preserve its 1200 by 630 canvas and canonical mark.
