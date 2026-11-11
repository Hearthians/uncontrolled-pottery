# Milestone 3D.1 — Sagging activation

This records calibration 1.1.0. The current studio modes are described in [3D.2 Dual-mode Sagging](sagging-3d2.md).

## Reproduction and cause

The reported recipe specified failure seed 45, intensity 1, 1 mm layers, a 2 mm
bead and a gently twisted vessel. The exact shape recipe was unavailable. The
representative reproduction uses Bulbous, Spiral / Twisted, shape seed 123,
sculptural intensity 0.65, height 20 mm and centreline radius 15 mm. Generate it
through the studio controls or `scripts/fixtures/sagging.mjs`.

The nominal-path pass detected 3,319 weak-support samples across 81 candidate
regions at intensity 1. All 81 were selected, with a largest sampled proposed
drop of 0.711 mm. All retained positive drop after the plate limit. Earlier bead
contact then reduced all 81 to zero. A footprint can have many unsupported samples
while a portion of its underside is already touching clay. Lowering the whole bead
would penetrate that contact. There was no timing, rendering or unit conversion error.

## Response and executed path

The nine-point support samples and coverage thresholds stay as calibrated in 3D.
For an interior contact limit, the Sagging policy reduces both endpoint drops by
the same ratio until the weighted interpolation meets clearance. It previously
capped both endpoints to the point's clearance, even if one endpoint had little
weight. Zero clearance still pins the affected nodes. One conservative smoothing
pass reduces isolated peaks before the existing slope limit. Gaps retains its
original response policy.

If the natural maximum drop is below a quarter of the layer height and weak spans
exist, seeded selection tries bounded nozzle deviations on those spans. The
instability option is enabled in Manual Test and can be disabled in the operator's
fourth argument. Intensity zero takes the stable path and bypasses both passes.

The fallback applies up to `1 + floor(2 × intensity)` events, at least three layers
apart. A squared sine envelope over a nominal arc window returns to the original
path at both ends. Target half-span grows from two toward 3.5 bead widths. At the
peak, the nozzle moves outward along the polar contour's exterior ray by up to
1.05 bead widths times intensity and lifts by up to 0.8 bead heights times intensity.
Span, stretch and cylindrical envelope checks reject unsuitable events. All affected
moves remain connected extrusion commands with their original feedrate. Timing
is recomputed from executed distances. Travel and layer transitions keep their
original coordinates and extrusion states.

The same support solver then evaluates actual earlier deposits under the executed
path. Weak regions overlapping a deviation skip the random selection gate and
still require measured support deficiency and clearance. Material follows its
settled drop profile during deposition, while the nozzle follows executed XYZ.
Export Parameters records the executed `toolpath`, the `nominalToolpath` when they
differ, local instability events, and separate nominal/executed diagnostics.
Each candidate includes its span length and, if selected, the proposed peak and
the peaks after bed, contact and slope checks. The trace counts selection, sampled
profile, bed, contact, slope and event placement rejections, plus committed regions.

## Measured results and verification

| Intensity | Nozzle events | Committed regions | Maximum drop below executed path | Hanging spans | Slumps |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 mm | 0 | 0 |
| 0.5 | 2 | 3 | 0.356 mm | 0 | 0 |
| 1 | 3 | 6 | 0.944 mm | 0 | 2 |

Run `node scripts/compare-sagging.mjs --activation` for matched full views and a
close comparison at the largest drop. The exports are in `artifacts/` under
`sagging-activation-*`. The close view shows the bead lowering and settling toward
earlier layers. The strong overhang fixture still exercises connected hanging
spans, while the gentle fixture produces droops and slumps.

Changed modules are `src/saggingInstability.ts` for path events, `src/sagging.ts`
for pass orchestration and diagnostics, `src/support.ts` for stage traces and the
Sagging-only contact response, and `src/App.tsx` for diagnostics and export. The
Sagging tests, studio regression, fixture and comparison script cover the fix.

All 169 automated tests, the TypeScript production build and the Chromium regression
passed. Browser playback compared the live nozzle position to the executed export,
then checked pause, resume, final preview, regeneration and intensity zero. The
Gaps, Bulges and Layer Offsets regressions passed in the same run.

The freeze boundary is standalone Sagging calibration 1.1.0. The geometry uses
discrete bead samples and can still show faceting at tight contact. The fallback
only runs when weak spans exist and natural drop is small. Clearance-limited cases
may still report zero. The solver estimates bead contact rather than nozzle body
collisions or physical printability. Schedule execution and behaviour composition
are outside this freeze.
