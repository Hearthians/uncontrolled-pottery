# Milestone 3B.2b — bidirectional bead accumulation

## Diagnosis and change

3B.2 already deformed the original bead sweep, rather than attaching separate meshes.
Its displacement profile selected only the exterior half of each section; the inner
wall could not expand. It used the vector from the vessel axis to each contour point
as its outward direction. Canonical centreline coordinates, bead dimensions and
baseline render buffers remained accessible. Added volume was the difference between
closed polygonal sweep volumes before and after swelling.

3B.2b preserves that volume solver, connectivity and dwell timing. It expands both
halves of the same cross-section. The additional displacement now follows an outward
normal perpendicular to the average of adjacent unit contour tangents. Neighboring
chords share the same endpoint normal. The normal must point toward the exterior
of the existing simple polar contour; inward growth uses its negative. The original
radial bead frames are retained for the baseline surface, so zero intensity and
unaffected beads remain unchanged. This supports all nine base/modifier combinations.

An internal FNV-1a hash of the event ID (including its failure seed) sets the inward
amplitude share in [0.35, 0.50]; outward share is its complement. These are displacement
weights, **not exact volume fractions**. One amplitude is solved against the total
event budget after both displacements are applied. No second inward budget is added.
The placement RNG is never advanced by distribution sampling. The small existing
cross-section asymmetry and smooth longitudinal envelope remain deterministic.

The trailing footprint is four bead widths, rounded to completed chords and clipped
at the layer start. The earlier three-width footprint produced a local fold on a
maximum-intensity tapered/ribbed fixture when displacement followed its actual normal.
The broader footprint preserves the volume budget while reducing peak expansion.
The current partial chord and all future deposition remain untouched. Growth begins
only at its recorded dwell, and quadratic volume inversion tracks dwell progress.

Vertical distribution is deliberately zero in this milestone. The cross-section's
existing upper/lower contact surfaces remain at their original Z; no extra interlayer
overlap or contact response is introduced. There are no new UI controls or dependencies.

## Validation and compatibility

- Reconstruct incremental polygonal volume with the existing signed-tetrahedron
  method. Reject error above 1% per event; temporary measurement caps are not rendered.
- Check final deposited vertices against the cylindrical machine envelope and safety
  margin. The original toolpath validator and 200,000-move budget remain in force.
- Reject local angular reversals or inward axis crossings, conservatively keeping the
  supported horizontal sections in the simple polar-contour class. For example,
  an R1.5 mm cylinder with W2 mm bead at intensity 1 is rejected, without rescaling.
- Preserve shared rings and triangle indices. Tests check finite coordinates,
  consistent face winding/normals, smooth shared normals, genuine movement of both
  surfaces, intermediate growth volumes and exact reset restoration.
- All nonzero results warn that inner/outer accumulation may collide with neighboring
  beads or future nozzle paths. Clearance and interlayer interaction are not simulated.

Bulges result/identity version is now **1.2.0**; swelling calibration is **1.1.0**.
The unchanged dwell calibration remains 1.0.0. Geometry Schema 1.1.0, Generator 1.1.1
and Failure Schedule 1.0.0 are unchanged. Existing event/timing hashes still match
3B.1 byte-for-byte at intensities 0, 0.25, 0.5, 0.75 and 1. Canonical geometry, Gaps,
nozzle commands, material, lighting, build plate and playback controls are unchanged.

Exports add measured `maximumInwardDisplacementMm`, `maximumOutwardDisplacementMm`,
`maximumVerticalAccumulationMm` and signed `volumeErrorMm3` (reconstructed minus
expected). Directional displacements are projected onto each ring's local outward
normal; their separate maxima need not occur at the same event or ring.

## Controlled measurements and visual evidence

Cylinder H35/R15 mm, W2/H1 mm, geometry seed 123, failure seed 42, feedrate 600 mm/min.
All positive intensities retain 36 events across 18 layers. Vertical accumulation is
0 mm in every case; expected volume and dwell duration are unchanged from 3B.2.

| Intensity | Max inward mm | Max outward mm | Expected mm³ | Reconstructed mm³ | Difference mm³ |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 0 | 0 |
| 0.25 | 0.273512 | 0.389340 | 69.758044 | 69.758046 | +0.00000117 |
| 0.5 | 0.546196 | 0.776106 | 139.516089 | 139.516087 | -0.00000186 |
| 0.75 | 0.818058 | 1.160347 | 209.274133 | 209.274132 | -0.00000111 |
| 1 | 1.089106 | 1.542110 | 279.032178 | 279.032176 | -0.00000197 |

Maximum per-event relative volume error across these cases: **0.000024%**, below
the 1% acceptance tolerance. Full precision is in `artifacts/bidirectional-metrics.json`.
Matched exterior/interior and event close-ups show reduced exterior prominence and
new interior thickening. The actual shared cross-section confirms that both surfaces
change; the difference does not depend on shading or an overlay.

Run `node scripts/compare-bidirectional.mjs` for the same geometry/events at five
intensities, complete playback, 18 matched renders and a common-plane section:

- `artifacts/bidirectional-comparison.png`: original / outward 3B.2 / bidirectional
  3B.2b, at intensity 0.5, exterior, interior and both close views.
- `artifacts/bidirectional-cross-section.png`: actual polygon coordinates at the same
  ring and event, using equal millimetre scale.
- `artifacts/bidirectional-*-1-{exterior,interior}.png`: intensity-1 comparisons.

The old solver is frozen in `scripts/fixtures/swelling-3b2.ts` for comparisons only.
It is not imported by the application. No per-frame full-vessel reconstruction occurs;
the existing renderer updates only affected footprint segments and GPU buffer ranges.

## Verification and limits

`npm test`: 147 tests pass. `npx tsc --noEmit` and `npm run build` pass. The existing
bundle-size advisory remains (approximately 808 kB minified). The comparison browser
run completes without browser errors. `npm run verify:browser` also passes:
Gaps manual/schedule equivalence, Bulges play/pause/compare/resume/reset, measured
inward/outward export fields, geometry import/export and mobile layout.

This is a bounded geometric redistribution heuristic, not calibrated clay rheology.
The volume approximation is per-bead polygonal sweep volume, not a global union of
contacting solids. Conservative polar-order validation may reject geometry that a
more general contact solver could represent. No interlayer collision resolution,
vertical growth, adhesion, gravity spreading or multi-layer accumulation is implemented.
Machine-envelope compliance does not establish physical printability.

Changed runtime files: `src/beadSwelling.ts`, `src/claySurface.ts`, `src/bulges.ts`.
Verification: `tests/bulges.test.mjs`, `scripts/verify-browser.mjs`,
`scripts/compare-bidirectional.mjs`, `scripts/fixtures/swelling-3b2.ts`.
Documentation: this file, the 3B.2 historical note and `README.md`.
