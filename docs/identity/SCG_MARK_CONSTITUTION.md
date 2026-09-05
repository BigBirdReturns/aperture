# SCG MARK CONSTITUTION

**Status:** RATIFIED · v1.0 · frozen with `SCG Identity v3.0`
**Scope:** custody control for the pixel-dandelion mark and its sanctioned SCG derivative.
**This is not a brand essay. It is provenance law.** If a rendering cannot be traced to a map and a transform declared below, it is not the mark.

---

## 0. The one line

There is ONE root glyph (the AXM-WORLD runtime dandelion, 16×16) and ONE sanctioned public-practice derivative (the SCG mark, 16×18). Everything else — especially the smooth vector "mature" redraw — is deprecated and out of custody.

---

## 1. Lineage hierarchy

Resolve by lineage, not winner-take-all. Both maps are canonical **inside their own layer**; only the runtime glyph is the **root**.

| Role | Layer / context | Grid | Palette | Source of truth |
|---|---|---|---|---|
| **ROOT GLYPH** | AXM-WORLD runtime (RODOH shell) | **16 × 16** | cream `#fffdf5` bloom · moss `#6B784D` stem/seeds · field `#1B1818` charcoal | `axm-world/js/sprites.jsx` → `SPRITES.dandelion` |
| **PRACTICE DERIVATIVE** | SCG public / buyer-facing identity | **16 × 18** | bone `#ECE7D8` bloom · olive `#7C7F57` stem/seeds · field `#0D0C09` void | `scg-identity/scg-pixel-mark.js` → `SCGPX.MAP` (also `axm-tools-repo/scg-pixel-mark.js`) |

**SCG does not own the origin.** SCG stewards the public derivative. The runtime glyph is the parent map. The derivative is a taller (16×18), re-palettised, hand-set descendant — a licensed practice mark, not a second origin.

> **Reconciliation note (must be fixed in-file, does not change this ruling):** the header comment in `scg-pixel-mark.js` ("AXM-WORLD borrows this mark; it originates here") and the SCG v3 footer ("MARK ORIGIN SCG · LICENSED TO AXM-WORLD RUNTIME") assert SCG as origin. Under this constitution that is inverted: the **runtime 16×16 glyph is root**; the SCG 16×18 is the derivative. Those two annotations should be edited to read "practice derivative of the AXM-WORLD root glyph" so the files stop contradicting the ledger. Until edited, THIS document governs.

---

## 2. Coordinate ledger — ROOT GLYPH (AXM-WORLD, 16×16)

Legend: `W` = cream `#fffdf5` · `M` = moss `#6B784D` (CSS `--moss`, re-skins per cartridge) · `.` = transparent (renders on `--charcoal #1B1818`).

```
row  0123456789012345
 0   ....W..W........
 1   ..W..WW..W..W...
 2   ...W.WWW.W.W....
 3   ..W.WWWWW.WW....
 4   ...WWWWWWW.W....
 5   ..W.WWWWW..W....
 6   ....WWWWW.......
 7   .....MWM........
 8   ......M.........
 9   ......M.....W...
10   ....M.M..W......
11   ...M..M.M.......
12   ...M..M.........
13   ......M.........
14   .....MMM........
15   ....MMMMM.......
```

Dimensions 16w × 16h. Rendered by `PixelSprite` at integer `scale`. Colors resolve live from RODOH CSS tokens, so the glyph re-skins when a cartridge swaps `--moss`/`--cream`; the MAP never changes.

---

## 3. Coordinate ledger — SCG DERIVATIVE (16×18)

Legend: `W` = bone `#ECE7D8` · `o` = olive `#7C7F57` · `.` = void `#0D0C09`.

```
row  0123456789012345
 0   ....W.....W.....
 1   ................
 2   ..W....W.....WW.
 3   .W..WW.WW..W..W.
 4   ..WWWWWWWW..W...
 5   .WWWWWWWWWW.....
 6   ..WWWWWWWWW.....
 7   ..WWWWWWWW......
 8   ...WWWWWW.o.....
 9   .....WWW........
10   ......o.......W.
11   ......o.........
12   ...o..o..o......
13   ..o...o..o......
14   ......o.........
15   .....oo.........
16   .....oo.........
17   ...oooooo.......
```

Dimensions 16w × 18h. Rendered by `SCGPX.mark(cell)` as `<rect>` cells with `shape-rendering:crispEdges`. On light/print, invert bloom to `#0D0C09` and keep olive (`SCGPX.mark(cell,{colors:{W:'#0D0C09',o:'#7C7F57'}})`); the bloom stays void-dark.

---

## 4. Fourth color

`Ember #C24B2C` exists in the SCG palette for **findings / flags only**. It is **never** placed in the mark, at any size, in either layer. A rust/ember pixel inside the bloom is a custody violation.

---

## 5. Allowed transformations

Only these four. Anything else is a redraw.

1. **Integer scale.** Cell size ∈ {1,2,3,…}. Nearest-neighbor only. Same input → same pixels, every render.
2. **Context palette swap.** Substitute the declared tokens for the layer (root: cream/moss on charcoal; derivative: bone/olive on void; print-invert: void-bloom/olive on bone). Hex values are locked in §1–§3.
3. **Declared crop padding.** Add integer padding cells around the map for avatars/favicons/covers. Padding is transparent or the layer field color. The map itself is not re-centered or nudged.
4. **Threshold simplification for favicons (≤16px only).** At ≤16px an isolated sub-pixel may be dropped to survive rasterization. Permitted ONLY at ≤16px, ONLY by removing whole cells, never by adding or moving them. (Current 32/48/64/128/256 exports use full-map integer scale and need no simplification.)

---

## 6. Banned transformations

Named, because the failure mode is now known. Each is provenance breakage, not a taste disagreement.

- **Smoothing / anti-aliasing** the pixels.
- **Radial rebalancing** — making the bloom symmetric or "tidying" the drift.
- **Botanical redrawing** — turning it into an illustrated flower.
- **Decorative drift** — inventing, multiplying, or re-scattering seeds.
- **Generic dot-cluster substitution** — concentric rings of solid circles standing in for the hand-set bloom.
- **Any "mature" / vector redraw** that does not render the exact MAP above.
- **Re-centering** — the mark sits offset (rule 02A: "never center it"); do not equalize the negative space.

---

## 7. Rejected variant (DEPRECATED — do not resurrect)

**The sterile dot-cluster dandelion.** Source: `scg-identity/SCG Mature Identity.html` → `buildDandelionSVG()`. A smooth **vector** mark: concentric rings of solid circles, ink/paper/**rust** palette, Archivo type, resolved and symmetric.

It is **not an alternate direction.** It is deprecated. It breaks provenance because it is a from-scratch drawing with no coordinate map — it cannot be audited cell-by-cell, it introduces rust into the mark, and it reads as a generic consultancy icon. Any future designer or model reading this file should treat that variant, and any child of it, as out of custody. The LinkedIn export set built from it (rust/ink) has been removed and replaced by the derivative in §3.

---

## 8. Source vs application

- **Source of truth:** the two `.map`/sprite files in §1, plus this constitution.
- **Applications (NOT source):** LinkedIn avatar, favicon ramp, covers, the v3 identity sheet, the AXM-WORLD splash, the live axm.tools footer. These are outputs. If an application disagrees with the ledger, the application is wrong.

> **Deployment-scope note (string-only, does not change this ruling):** the application list above and the deploy pointers named in this document — a root-level `scg-pixel-mark.js`, `/public/assets/scg/`, "the live axm.tools footer", and the `scg-identity/` / `axm-world/` sibling paths — describe AXM surfaces on the full **axm.tools** site. In the standalone **axm-tools** repo that carries this `identity/` tree, those deployed copies do not exist; surfaces there reference the canonical `source/` file directly (see `identity/scg/README.md` → "Deployment scope"). The ledger still governs every rendering; only the deploy paths are environment-specific.

---

## 9. Change control

- The MAPs are frozen. A change to either map is a new constitution version and a new `SCG Identity vX` freeze — not an edit in place.
- Palette hex values are frozen (§1–§4).
- Adding a **new** context (e.g. a monochrome stamp) = add a palette-swap row to §5.2; it does not touch the maps.
- This file supersedes conflicting mark annotations elsewhere in the repo (see §1 reconciliation note).

---

*Ratified with `SCG Identity v3.0`. Root glyph: AXM-WORLD runtime, 16×16, cream/moss. Practice derivative: SCG, 16×18, bone/olive. The sterile redraw is deprecated by name.*
