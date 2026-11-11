# Gaps support calibration fix — 1.1.0

The former support 1.0.0 classified spans up to four bead widths as medium and
always emitted a complete bead. Even its long spans only received a maximum
0.5-layer-height drop. That preserved implausibly intact suspended strands.

## Revised rules

All dimensions refer to the current commanded bead width W and layer height H.

| Unsupported span length | Class | Maximum drop before coverage weighting |
| --- | --- | --- |
| <= 0.75 W | Short | 0.25 H |
| > 0.75 W and <= 1.75 W | Medium | 0.60 H |
| > 1.75 W | Long | 0.90 H, with predicted continuity loss |

At W=2 mm/H=1 mm, the thresholds are 1.5 and 3.5 mm. The existing 0.8 coverage
threshold, nine footprint samples, 0.2 H contact tolerance and smooth displacement
envelope remain. Actual amplitude is multiplied by `(1 - meanCoverage)`.

Long spans lose at least their central 40% of predicted material. Each end can
retain at most `min(0.3 * spanLength, 0.75 W)`, and only beside a directly adjacent
supported deposition move. A long span with neither anchor is omitted entirely.
The missing interval is rounded outward to existing move boundaries, so it can be
larger than 40%; commands are never split to perform this material-only operation.
Remaining break tips taper to 22% cross-section scale over the adjacent retained
move. This response composes with the unchanged residue plan.

Short and medium supported-end spans remain continuous. A fully unanchored
fragment with zero detected contact is omitted regardless of size: keeping such
fragments would leave detached pieces suspended after surrounding material is lost.
No particle, falling-debris or mass-conservation model is implied by omission.

Removed segments contribute neither triangles nor contact support to subsequent
layers. The same omission predicate is used for static buffers and partial-bead
playback. The nozzle continues along its original commanded path, including when
predicted material is absent. Supported joins retain matching rings and transitions
keep their existing semantics. There is no per-frame full geometry reconstruction.

## Contracts and diagnostics

Only support calibration advances to **1.1.0**. Geometry Schema 1.1.0, Generator
1.1.1, Schedule 1.0.0, Gaps placement/intensity/calibration and residue are unchanged.
The unified pipeline already hashes support calibration; revised material therefore
gets a different simulation ID while its commanded Gap result ID remains identical.
The public UI is unchanged; Export Parameters includes the new support metrics.

`SupportSegment` adds optional `omitted`, `startScale`, `endScale` fields describing
predicted material only. `continuityChangedSegments` counts commanded extruding
moves omitted from material buffers, including wholly unanchored fragments.
`maximumDisplacementMm` and `averageDisplacementMm` describe **vertical centreline
drop of retained material**. The average is move-length-weighted (including
transitions), not an average over removed geometry; tip thinning is excluded.

## Controlled comparison

Cylinder H20/R15 mm, W2/H1 mm, geometry seed 123, failure seed 51, full-height
Gaps schedules at intensity 0.5 and 1. Exact original commands, events, schedule,
support 1.0.0 results, material hashes and source were captured before editing in
`artifacts/support-calibration-before.json`. The comparison refuses to overwrite
that baseline using the new calibration.

`node scripts/compare-support.mjs` verifies the same command hash and exact old
material hash, then renders off / previous / revised at matched cameras and completed
Playback. The close-up selects a formerly long unsupported bridge, preferring one
with surviving ends; the same target is used in all three modes. An assertion checks
that the selected former bridge now loses predicted continuity. Whole-vessel renders
also show cumulative loss, so the close-up does not conceal its extent.

| Intensity | Response | Long spans | Omitted segments | Max drop mm | Mean drop mm |
| --- | --- | ---: | ---: | ---: | ---: |
| 0.5 | Off | 44 | 0 | 0 | 0 |
| 0.5 | Previous | 22 | 0 | 0.5000 | 0.1225 |
| 0.5 | Revised | 116 | 1393 | 0.7425 | 0.1008 |
| 1.0 | Off | 42 | 0 | 0 | 0 |
| 1.0 | Previous | 1 | 0 | 0.4942 | 0.1558 |
| 1.0 | Revised | 183 | 1317 | 0.7172 | 0.1171 |

Off uses the new span thresholds without applying any response. Previous uses the
old thresholds. Counts also differ because later contact depends on actual retained
lower-layer material. A lower mean drop in the revised result is expected: severely
unsupported segments are removed rather than counted as displaced surviving material.

Commanded Gap metrics are identical across all three modes: **138 events / 16.2681%**
missing deposition at 0.5, and **273 events / 32.6209%** at 1.0. Canonical geometry,
residue, feedrate, nozzle trajectory and playback duration are unchanged.

Outputs: `artifacts/support-calibration-metrics.json` and twelve PNGs named
`support-calibration-{0.5|1}-{off|previous|revised}-{full|close}.png`.
Retain the baseline JSON with these artifacts to rerun the comparison; it is an
ignored local verification artifact, not a required runtime file or test dependency.

## Verification and limits

2026-11-10: **124/124 automated tests**, TypeScript checks, production build and
Chromium/WebGL UI regression passed. Tests cover long-span removal, retained-end
limits, short/medium continuity, deterministic buffers, no support from removed
material, matching joins and partial/full buffers, machine limits, all nine shape
combinations, canonical immutability and manual/schedule equivalence. Twelve matched
comparison screenshots were generated; close-ups and whole-vessel views were inspected. The existing large-bundle
warning remains (792.16 kB minified JS).

This is a deliberately conservative fabrication-informed heuristic, not measured
clay rheology. Cumulative support loss can erase substantial upper regions. No
dynamic collapse, collisions, debris settling or mass conservation is simulated;
protected extruding transitions remain represented and can appear as residual seam
material. Missing-region edges are quantized to contour sampling, and contact still
uses a finite footprint stencil. Material loss must not be exported as altered
extrusion commands. Further tuning needs actual extrusion experiments.
