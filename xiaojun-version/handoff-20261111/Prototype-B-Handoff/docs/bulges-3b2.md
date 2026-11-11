# Milestone 3B.2 — integrated clay swelling

> Historical 3B.2 record. The outward-only profile is superseded by
> [3B.2b bidirectional swelling](bulges-3b2b.md); dwell events and budgets are unchanged.

## Diagnosis

The 3B.1 ellipsoids genuinely protruded, but their tangent/outward/Z transform had
negative determinant without reversing triangle winding. All 12,960 non-degenerate
faces in the fixed positive-intensity fixture opposed the supplied vertex normals.
The double-sided clay material therefore shaded the exposed surface as a back face.
The ellipsoids also intersected the bead, leaving a sharply delimited oval patch.
The absolute signed-volume calculation concealed the winding error and counted
embedded material as extra volume. There was no actual subtraction of the bead.
Multi-angle close-ups and an actual triangle-plane section confirm this diagnosis;
no separate depth-buffer fault was observed. Changing lighting would not fix it.

## Corrected surface and accounting

`src/beadSwelling.ts` extends the existing bead sweep, using the same indexed surface,
material and cross-section sampling. There are no overlaid ellipsoids, internal
patch caps or extra render triangles. Shared endpoint rings remain coincident.
The original inner surface and Z extents stay unchanged. The inherited renderer
uses radial contour frames; the swelling follows the ordered local contour chords.

Each event affects an already deposited length of approximately three bead widths
behind the nozzle (rounded outward to complete chords, clipped at the layer start).
It ends at the last completed chord, at most one chord behind the dwell point. This
explicit trailing-spread heuristic avoids changing unprinted material or the current
partial chord. It does not claim that the material peak is directly below the nozzle.

For normalized footprint position u, the smooth amplitude envelope is
`16*u²*(1-u)²*(1+0.2*(2*u-1))`. It and its slope vanish at the ends. The outer half of
each section expands by `amplitude * max(0,-cos(angle))² * (1+0.1*sin(angle))`;
the small fixed asymmetry introduces no new randomness. Longitudinal slope enters
the shading normals, including consistent normals at shared rings.

Amplitude is solved numerically against **incremental polygonal sweep volume**:
swollen segment volumes minus their original volumes. Signed tetrahedral volumes
use temporary measurement caps, never rendered caps. Per-event rejection tolerance
is 1% of the unchanged extra-deposition budget. This is an approximation to deposited
clay, not a global solid union or fluid model. Volume as a function of amplitude is
quadratic; inversion makes growth track the event's elapsed dwell fraction. Only
changed footprint segments and their GPU buffer ranges update during playback.
Reset restores the original rings; pause performs no further growth.

`simulateBulges` now returns `patches` and completed `material` buffers instead of
overlay `meshes`. `metrics.predictedExtraVolumeMm3` replaces the misleading
`predictedGrossVolumeMm3`. Operator result/identity version is 1.1.0; separate
`SWELLING_CALIBRATION.version` is 1.0.0. The dwell calibration remains 1.0.0, including
its legacy lobe fields for compatibility (those two fields no longer drive surfaces).
Parameter exports include the swelling calibration. Geometry Schema 1.1.0, Generator
1.1.1 and Failure Schedule 1.0.0 are unchanged. Gaps, canonical generation, nozzle
commands, dwell formulas, event placement, UI, material and lighting are unchanged.

## Controlled verification

Cylinder H35/R15 mm, layer height 1 mm, bead width 2 mm, geometry seed 123,
failure seed 42, feedrate 600 mm/min. The user's 29-event screenshot did not include
its full geometry configuration; this reproducible fixture has 36 positive-intensity
events. SHA-256 regression fixtures prove that every event and complete timing
instruction remains byte-identical to the captured 3B.1 output at all five intensities.

| Intensity | Events | Extra budget / measured mm³ | Dwell s | Max outward thickening mm |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 / 0 | 0 | 0 |
| 0.25 | 36 | 69.758044 / 69.758044 | 4.440935 | 0.746667 |
| 0.5 | 36 | 139.516089 / 139.516089 | 8.881870 | 1.474219 |
| 0.75 | 36 | 209.274133 / 209.274131 | 13.322805 | 2.184052 |
| 1 | 36 | 279.032178 / 279.032179 | 17.763740 | 2.877401 |

Maximum per-event relative error in this fixture is 0.000026%, below the 1% gate.
The controlled views show outward shoulders continuously joined to the beads,
without the old elliptical overlays. High intensity produces wider local shelves;
their subsequent spreading, collision and collapse are deliberately not modeled.

Run `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run verify:browser`, and
`node scripts/compare-swelling.mjs`. The latter retains the old mesh only as a frozen
visual fixture in `scripts/fixtures/bulges-3b1.mjs`; it is not imported by the app.
It renders original, 3B.1 and 3B.2 at identical cameras and completed playback for
all five intensities, plus two close-up angles and measured cross-sections:

- `artifacts/swelling-comparison.png`: five-intensity, three-version overview.
- `artifacts/swelling-close-comparison.png`: matched intensity-0.5 close-ups.
- `artifacts/swelling-cross-section.png`: old intersection versus outward extension.
- `artifacts/swelling-metrics.json`: exact volume, timing and diagnosis results.

Automated suite: 146 passing tests, including intensity 0.5 and 1 on all nine
base/modifier combinations, incremental volume through dwell, shared rings,
outward displacement, consistent normals/winding, source immutability, reset,
machine rejection and existing Gaps/contracts. TypeScript and production build pass;
the existing bundle-size advisory remains (approximately 806 kB minified).
Production Chromium/WebGL regression also passes: Gaps manual/schedule equivalence,
Bulges play/pause/compare/resume/reset and measured-volume export, canonical import/
export, camera framing and mobile layout. No browser errors were reported.

Files changed for 3B.2: `src/beadSwelling.ts`, `src/bulges.ts`, `src/claySurface.ts`,
`src/ClayScene.tsx`, `src/App.tsx` (export calibration only), `tests/bulges.test.mjs`,
`scripts/verify-browser.mjs`, `scripts/compare-bulges.mjs`,
`scripts/compare-swelling.mjs`, `scripts/fixtures/bulges-3b1.mjs`,
`docs/bulges-3b1.md`, this document and `README.md`.

## Limits

The model measures polygonal sweep volume, not a boolean union across self-contact
or adjacent layers. Its predicted surface is not a watertight fabrication export;
the renderer's original open sweep ends and explicit layer-transition geometry remain.
Overlapping event footprints are rejected rather than silently double-counted.
The machine envelope, 5 mm default margin and 200,000-move rendering budget still
apply. Intermediate growth lies between checked baseline and final radial vertices.
Envelope compliance does not verify nozzle clearance, support or physical printability.
No multi-layer accumulation, interlayer compression, spreading physics, combined
Gaps/Bulges or new failure operator has been implemented.
