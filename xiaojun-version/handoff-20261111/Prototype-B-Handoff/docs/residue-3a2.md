# Milestone 3A.2 — Local material edge refinement

The gap operator, events, schedules, geometry versions, nozzle trajectory and commands
are unchanged. `src/clayResidue.ts` creates a separate deterministic display plan for
the derived path; `claySurface.ts` applies it to actual bead vertex positions. This is
a geometric material approximation, not measured rheology or additional commanded flow.

## Algorithm and calibration

Consecutive deposited moves form a strand. Only ends adjacent to horizontal gap travel
receive a profile; transitions and initial/final nozzle lifts are excluded. A hash of
the failure seed and boundary XYZ selects the edge profile. Thus an existing boundary
keeps its material profile when higher intensity adds other interruptions. The plan
does not depend on intensity. Within the boundary region, smoothstep weights taper the
cross-section, perturb its outline asymmetrically, and occasionally lift a thin terminal
tip. Restart shoulders swell relative to the tapered region. A thin terminal part of
the existing strand represents short attached residue; no separate fibre spans a gap.

Internal `RESIDUE_CALIBRATION` version **1.0.0**:

| Parameter | Default | Meaning at bead width 2 mm / layer height 1 mm |
| --- | ---: | --- |
| taperBeadWidths | 0.65 | 1.3 mm influence, capped at half the strand length |
| probability | 0.38 | Probability of a thin lifted termination |
| sizeBeadWidths | 0.16 | Base tip diameter fraction; seeded variation adds 0–0.15 (0.32–0.62 mm diameter) |
| liftLayerHeights | 0.28 | Lifted centre rises 0.14–0.28 mm |
| irregularity | 0.07 | Up to 7% localized cross-section outline variation |
| restartSwell | 0.08 | Small shoulder fullness relative to the tapered cross-section |

The radial scale never exceeds the existing bead envelope. Upward centre displacement
is accompanied by sufficient vertical shrinkage to stay within the original bead's
top/bottom bounds, including partial playback. This deliberately limits accumulation
to shoulder redistribution rather than a separate excess-material operator. There is
no tangential extension into the gap and no new connecting triangles. Original strand
ends remain uncapped, as in 3A.1; the result is not a watertight or volume-conserving mesh.

`createResiduePlan(path: Toolpath, seed: number): ResiduePlan` returns readonly per-move
profiles. `beadBuffers(path, plan?)` produces full derived surface buffers and checks
finite vertices against the central machine envelope and current margin. The existing
`writeBead` accepts an optional profile and evaluates it at the actual partial endpoint.
The viewer reveals only completed move buffers plus the currently depositing move.
Nothing is shown during ordinary travel or before its associated deposition.

Full buffers are built only when applying/changing a path. Playback updates the same
small 32-vertex partial-bead buffer as before. Apply pre-validates the candidate material
surface before replacing the accepted scene; the renderer then builds its retained
buffers. This performs two full buffer builds per apply, not per frame. No dependencies,
material sliders, lighting or nozzle changes were introduced.

Export Parameters records `failure.materialCalibration` separately. The existing
derived ID identifies commanded gap instructions; material appearance is identified by
that ID plus material calibration version and failure seed. Canonical JSON exports and
their import rules remain unchanged.

## Controlled measurements and screenshots

`node scripts/compare-residue.mjs` renders the production buffer and clay material
functions through Chromium/WebGL. It produces before/after full and close views for
intensities 0, .25, .5, .75, 1: twenty PNGs and `artifacts/residue-metrics.json`.
Geometry is a neutral Cylinder H20/R15, geometry seed 123, 1 mm layers, 2 mm bead width,
600 mm/min, failure seed 51. All comparisons keep source, camera target, seed and light
settings fixed. The close-up target is a lifted termination selected from intensity 1.
These isolated inspection renders omit the head/plate; application browser regressions
separately verify the unchanged full viewer and playback.

| Intensity | Gaps (before = after) | Commanded missing fraction (before = after) |
| --- | ---: | ---: |
| 0 | 0 | 0% |
| .25 | 65 | 7.4846% |
| .5 | 138 | 16.2681% |
| .75 | 212 | 25.1700% |
| 1 | 273 | 32.6209% |

The brief reports 143/275 interruptions for an observed vessel. That does not fully
specify its profile/radius/modifier; this fixed cylinder produces the values above with
the untouched 3A.1 operator. No algorithm was tuned to force those measurements.
Material taper redistributes visible clay, so commanded missing path length must not
be interpreted as physical missing volume or a prediction of extrusion loss.

Close-up references: `residue-0-before-close.png` (continuous),
`residue-1-before-close.png` (clean cuts), `residue-1-after-close.png` (refined).
Full-vessel references: `residue-0-after-full.png`, `residue-0.5-after-full.png`,
`residue-1-after-full.png`. Additional .25/.75 renders use the same naming scheme.

## Verification and scope

Run `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run verify:browser` and
`node scripts/compare-residue.mjs`. Tests cover all nine shape combinations, unchanged
canonical/result data, exact zero baseline, deterministic profiles, unchanged buffers
away from edges, partial/full buffer consistency, continuous strand joints, machine
limits and absence of geometry during non-extruding moves.

Verified 2026-11-09: 96/96 tests passed; TypeScript check, production build and application
Chromium/WebGL regression checks passed. All 20 controlled renders completed; before/
after close-ups and completed vessels were visually inspected. The existing Vite chunk
size warning remains (783.36 kB minified JS, 214.89 kB gzip). Added joint/seed assertions
also pass in the targeted material suite. No dependency or UI control was added.

Remaining limitations: coarse two-ring segment surfaces, approximate shading normals,
uncapped tips, no volume conservation, measured stickiness, restart delay or collision/
support response. Lift is intentionally contained within the original bead envelope.
No overprinting, compression, collapse, sagging or other failure operator is included.
