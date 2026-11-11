# Grammar of Failure — Prototype B v1

Milestone 2A: seeded parametric vessels, retaining Milestone 1 contour-based printing. Derived from
`Prototype A/uncontrolled-pottery-main`; both original prototypes remain unchanged.
Reuses its React/Vite/TypeScript/Three.js stack, studio styling, OrbitControls,
lighting, materials, platform and nozzle. No new dependencies.

## Run

Node 24 or later (Node's built-in TypeScript stripping runs the tests).

```sh
npm ci
npm run dev
npm test
npm run build
```

Open the local URL printed by Vite. Configure height, centreline radius and
feedrate; Apply resets the print. Play/Pause/Continue/Reset control the print.
Camera views, orbit/zoom, contour overlay, automatic rotation, fullscreen,
PNG capture and JSON parameter-record export are available. Playback speed is
an explicit 1×/5×/20× multiplier, independent of physical feedrate.
Changing tabs pauses the print. Returning requires Continue.

## Coordinates and contours

- Core coordinates: right-handed XYZ in **millimetres**, **Z up**. Origin at
  the centre of the build plate, plate surface Z=0. Radius describes the bead
  centreline; outer material radius is radius + beadWidth/2.
- Layer IDs are zero-based. Layer count is `ceil(heightMm / layerHeightMm)`
  (with 1e-10 quotient tolerance for decimal floating-point roundoff).
- For layer i: bottom=i×layerHeightMm, thickness=min(layerHeightMm, height-bottom),
  and centreline Z=bottom+thickness/2. At 1 mm, Z is 0.5, 1.5, …, 19.5 for a
  20 mm object. The bead envelope reaches Z=20. A non-integer height ends in
  a thinner layer, e.g. 20.3 mm gives 21 contours, last Z=20.15, thickness=0.3.
- UI fixes layer height at 1 mm and bead width at 2 mm. Height and radius are
  configurable. The pure core also accepts a layer height for tests.
- Counterclockwise circles begin at +X, sampled into chords no longer than
  approximately 1 mm (`max(32, ceil(2πr/1))` segments). The last point is an
  exact copy of the first. Every point within a contour has identical Z.
- No randomness is used: equal inputs produce equal contours and moves.

## Contour-to-toolpath conversion

1. Start 5 mm above the first contour's seam, travel down without extrusion.
2. Deposit each closed horizontal contour in point order.
3. Insert an explicit vertical **extruding transition** at +X from the closed
   contour to the next centreline. Extrusion stays on across layer boundaries.
4. After the last contour, stop extrusion and travel upward 5 mm.

Each move records start/end XYZ, kind, layer ID (destination layer for a
transition), feedrate in mm/min, extrusion state, bead width/height in mm,
length and cumulative start/end time. Travel feedrate is 1800 mm/min;
deposition and transitions use the configured feedrate. There are no implicit
repositioning moves. Reset clears material and restores the initial state;
it is a simulation reset, not a fabricated reverse motion.

## Module boundaries / parallel development

- `src/toolpath.ts`: cylinder parameters → horizontal contours → ordered moves;
  cumulative duration = sum(length / (feedrate / 60)); binary-search sampling.
- `src/playback.ts`: elapsed simulation time and play/pause/reset. No DOM/renderer.
- `src/beadGeometry.ts`: pure typed-array bead meshing; travel has no triangles.
- `src/ClayScene.tsx`: Three.js adapter. Geometry is allocated once per path;
  completed moves use draw ranges, only the current segment's endpoint ring
  changes per frame. No full geometry reconstruction during playback.
- `src/App.tsx`: input validation, playback clock, controls and exports.

The renderer maps (X,Y,Z) mm to (X,Z,-Y)/10 scene units. The LDM head's
outlet is at its local origin and follows that transformed position exactly.
The old display-only tip offset has been removed; no commanded coordinates changed.
One teammate
can work on the pure path contract/tests and another on rendering/UI without
sharing Three.js objects. No data mapping or emotion module is included yet.

## Checks

`npm test` covers 20/35 layers, closure, Z, fractional layers, determinism,
explicit continuity, continuous extrusion at transitions, feedrate timing,
travel without geometry, partial mesh/nozzle agreement, pause/resume/reset,
invalid inputs and renderer independence.

For browser verification, run `npm run build`, then `npm run verify:browser`.
The script serves local production files via Playwright request interception
(no network or running server required), uses the existing Playwright dependency
and an installed Chromium/Chrome/Edge, and stores screenshots in `artifacts/`.
Set `POTTERY_URL` to test an already running local server instead.

## Limits

This is a single-wall open cylinder, without a printed floor, infill or caps.
The extruding vertical seam is an explicit geometric approximation, may form
local excess material, and is not a validated machine strategy. Bead segment
joints overlap and are not a watertight manufacturing mesh. No acceleration,
pressure, flow calibration, collision checks, gravity, failure behaviours,
memory analysis or G-code export. The nozzle remains illustrative; the build plate has the fixed nominal machine diameter.
Core limits: nominal machine height ≤400 mm (including nozzle travel), layer height ≥0.1 mm, at most
200000 contour segments. Existing gesture/emotion controls and the old
fixed-layer gallery are excluded; old saved pottery records are not imported.


## Visual fidelity update

- `src/claySurface.ts` builds display-only 16-sided beads with flattened contact
  surfaces, continuous radial frames and deterministic 0.6% width variation.
  The layer envelope and centreline stay unchanged. These buffers must never be
  used as fabrication paths. `toolpath.ts`, `playback.ts`, `beadGeometry.ts` and
  `App.tsx` are unchanged by this update.
- `src/clayAppearance.ts` provides terracotta MeshStandardMaterial with object-space
  procedural colour/roughness and derivative-based micro-bump shading. No textures
  download, dependencies or animated noise; paused geometry and appearance stay fixed.
- Completed surfaces are built once per path. Only two rings of the active segment
  are updated each frame. Even hemisphere/key/fill illumination, a warm neutral background and a faint grid
  provide an editorial material view. Shadow maps are disabled. Clay roughness is
  0.98 with zero metalness, earthy brown terracotta colour, and fine-grain
  micro-bump shading. Subpixel pore contrast fades with distance to reduce shimmer; the UI is unchanged.
- Visual palette reference: `02_AI Generated/Grammar of Failure_ Poster_v2-02.png`.
- Head reference: [WASP 2040 Clay official 2019 manual, page 33, extruder cleaning drawing](https://www.3dwasp.com/wp-content/uploads/2019/09/Manual-Delta-WASP-2040-Clay.pdf).
  Visible barrel, outlet, mounting plate, motor, side inlet and fan inform the model.
  This represents the documented older LDM silhouette, not a certified 3.0 CAD model.
  [Current LDM product information](https://www.3dwasp.shop/en/prodotto/ceramic-extruder-ldm-wasp-extruder/)
  confirms interchangeable outlets and screw-controlled extrusion, but no internal
  mechanism is modeled. Dimensions are illustrative; hose routing, fasteners and
  delta arms are omitted where this reference does not establish their placement.
- `tests/rendering.test.mjs` checks finite deterministic display buffers, immutable
  paths, travel without material, layer envelope, partial growth, seamless contour
  joins, outward triangle winding, PBR properties and tip alignment.
- Surface contact is geometric, not clay rheology; seam joins are not watertight.
  Microtexture is shader shading only. Exact machine proportions require measured
  CAD or additional calibrated photographs. Original prototypes are untouched.


### Deposition contact and seam correction

The display surface uses a rounded compressed profile with a broad planar contact
patch, retaining the exact nominal Z envelope and deterministic 0.6% width variation.
Neighbouring contours meet at the same height; radial endpoint frames remain aligned.

The +X seam is real: each layer closes and then extrudes vertically to the next layer.
The previous visual sweep additionally used bead width for both axes of a vertical
segment, making a default 2 by 2 mm section instead of 2 by 1 mm. Vertical display
segments now retain the declared thickness as their second transverse dimension.
This removes exaggerated overlap but deliberately preserves the commanded seam.
The new contact/seam regression tests run alongside all existing tests.

Only display buffers changed. No changes to path points, extrusion commands, layer
height, feedrate, palette, lighting/shadow state, nozzle model, playback or UI.
The surface remains an overlapping segment approximation, not a watertight union or
volume-conserving material solver; some visible seam and intersection artifacts remain.


## Milestone 2A — Base Shapes and Soft Organic Folds

`src/shapes.ts` implements a renderer-independent `vesselPoint(theta, zMm, dimensions,
parameters)`. Cylinder, Tapered and Bulbous are presets of one continuous polar profile:
`R(u) = radiusMm * (1 + taper * (2*smoothstep(u)-1) + bulge*sin(pi*u)^2)`, where
`u=zMm/heightMm`. Cylinder has no taper/bulge; Tapered defaults to taper=0.2 (negative
values narrow upwards); Bulbous defaults to bulge=0.2. Twisted and ribbed modifiers are added in Milestone 2B.2 below.

A shared smooth fold modifier multiplies R by a bounded sinusoidal deformation with
an asymmetric angular component and a Gaussian height envelope, fading at both ends.
`foldAmplitude` is dimensionless 0–1; `foldCount` is 2–4; `foldPosition` is angular
(radians); `foldHeight` and `foldSpread` use normalized height. `asymmetry` is 0–0.6.
The unsigned 32-bit seed resolves the internal fold parameters deterministically.
Amplitude zero exactly recovers the neutral contour and toolpath, independently of
seed/asymmetry. Deformation is at most 18% of the neutral local radius, further damped
for short, wide forms. It does not represent a printing failure.

Contours use millimetres, Z up and the unchanged layer convention: 1 mm layers have
centreline Z = 0.5, 1.5, ... mm. Layer count is ceil(height/layerHeight); a fractional
last layer is centred within its remaining thickness. Every closed contour has the
same ordered angular samples as the baseline cylinder. Positive polar radii and
monotonically ordered angular wedges guarantee non-self-intersection. Closed contours
are deposited in increasing Z order, with explicit extruding connectors at theta=0;
initial/final travel never extrudes. Timing remains true path length/feedrate.

### Controls and comparison

Choose Base Shape, Model Height, Shape Seed and Soft Fold Intensity, then Apply and
Reset. Existing radius/feedrate controls remain. Initial load obtains a random seed;
`shapeFromSeed(seed)` deterministically selects the base family and initial intensity
0.6. Randomize Shape generates a new seed with currently applied dimensions and
discards unapplied edits. Play/Pause/Reset do not randomize. Configuration inputs are
disabled during printing. Reload intentionally selects a new configuration.

Show Base displays a complete neutral clay preview using the same material, bead
profile and camera. Show Modified Form returns to the live deposited form. The preview
is labelled; the printing head and actual path are hidden during comparison. Switching
does not change saved parameters, elapsed time, playback state or deposited geometry;
printing continues if playing. Comparison buffers are built once per configuration,
not per frame. Export Parameters always records the applied modified configuration.

### Shared descriptor contract

Call `generateToolpath(dimensions, shapeRequest)` and consume `result.shape` as the
exported TypeScript `ShapeDescriptor`. Export Parameters includes `shapeDescriptor`:

- version=2, family, seed, fully resolved actual shape parameters;
- heightMm, radiusMm, layerHeightMm, layerCount, maxLayerDisplacementMm;
- layers: layerId, zMm, normalizedHeight=zMm/heightMm, contourLengthMm and
  maxLateralDisplacementMm;
- warnings: code, layerId, measuredMm, limitMm and an English message.

Replay uses the same dimensions, family, seed, resolved parameters and displacement
threshold. Feedrate and bead dimensions remain in exported machine-independent
parameters. Future height-based mapping should consume actual layer centres; it must
not assume a fixed layer count. Geometry and future data/printing behaviours stay separate.

### Constraints and limitations

Positive dimensions, finite coordinates and bounded shape parameters are validated.
Adjacent-layer XY displacement at matching angular samples warns above a configurable
0.7 mm default. Additional warnings flag radii below bead width and local curvature
radii below half bead width. Warnings never alter geometry or extrusion. These are
conservative geometric checks, not verified physical printability: material rheology,
nozzle collision, buckling, gravity and machine limits are not simulated. Very short,
wide shapes can warn even without folds. Open single walls, the real extruding seam
and overlapping display beads remain; no base infill, G-code or failure operators.
The existing 200000-segment limit remains. Neutral preview adds one static bead buffer.

Verification covers 60 seeded shape cases, exact neutral recovery, distinct silhouettes,
increasing bounded folds, deterministic descriptor replay, 20/35 layer counts, valid
contours, continuous moves, no travel deposition and full playback. Browser checks
exercise comparison in paused/playing/completed states and verify exact image recovery,
shape persistence through reset, initial selection, randomization and exports.


## Fixed build plate and machine volume

`src/machine.ts` is the single machine definition: Delta WASP 2040 Clay, cylindrical
Ø200 × H400 mm, XY centre (0,0), build surface Z=0. `src/buildPlate.ts` creates the
separate, fixed display-only platform; it never enters contours, moves or exports.
The renderer retains its original conversion of 10 mm per scene unit and Y-up display
coordinates: the plate radius is 10 scene units = 100 mm, with top at machine Z=0.
Its original material and 0.13-scene-unit thickness (1.3 mm) are preserved.

Default framing is Fit Build Plate; Fit Vessel changes the orthographic camera only.
A 30 mm centreline-diameter test cylinder is correctly 15% of the plate diameter.

`validateBuildVolume(moves, safetyMarginMm)` is renderer-independent and reusable for
future post-processing/export. `requireBuildVolume` throws `BuildVolumeError` on
rejection. Every `generateToolpath(dimensions, shape, safetyMarginMm)` call validates
before returning. Default margin is 5 mm, configurable through these APIs or the
central default. It reserves clearance at sides and top, yielding radius 95 mm and
Z maximum 395 mm; no bottom margin is imposed because deposition must touch Z=0.
Nominal violations and safety-margin violations have distinct messages. Failed UI
edits leave the last accepted shape and playback intact; the status identifies the
applied shape. Shape dimensions report a conservative deposited W/D/H envelope.

Validation checks radial distance from the machine centre, not rectangular XY limits.
All move endpoints (including travel) are checked; convex cylindrical envelopes bound
entire linear segments. Extrusion additionally includes bead half-width/half-height,
the shared 0.6% visual width-variation allowance, and tilted transition cross-sections.
The radial envelope is conservative: near a boundary it may reject geometry whose
exact mesh would fit. XY offsets are evaluated from actual coordinates. No coordinates,
fold parameters, extrusion flags or feedrates are changed by validation.

The existing final 5 mm lift counts against the limits: e.g. a 395 mm cylinder with
1 mm layers reaches nozzle Z=399.5 mm; it fits nominal limits with margin 0 but fails
the default 5 mm margin. A 400 mm model is rejected because the unchanged lift exceeds
400 mm. No automatic trimming or rescaling occurs. The 200000-segment interactive
allocation limit remains independent of machine compliance.

`randomValidShape` tries at most 24 seeds using a deterministic LCG sequence, keeping
dimensions and the existing shape formulas unchanged. Initial load and Randomize Shape
both use it. The returned accepted family/seed reproduces the geometry. If no candidate
fits, the UI reports rejection and keeps the previous shape. Exports revalidate the
actual moves and record the validation result, never the platform mesh.

Volume compliance is not evidence of physical printability. Validation does not model
head-body collisions, material flow, unsupported overhang stability or printer dynamics.


## Milestone 2B.1 — Shared geometry library contract

The public, immutable API is `generateGeometry` in `src/geometry.ts`. See
[the contract and integration conventions](docs/geometry-contract.md) and
[the consumption example](examples/geometry-consumer.ts). Existing UI/toolpath APIs
remain compatible. No failure simulation or emotion processing is implemented.


## Milestone 2B.2 — Sculptural modifiers

Three modifiers share `vesselPoint(theta,z)` and the same closed-contour/toolpath pipeline.
The original Cylinder/Tapered/Bulbous profiles and folded formula are unchanged.
Select Sculptural Family and Sculptural Intensity, then Apply and Reset. Randomize Shape
keeps the selected base/modifier and resolves a new deterministic seed (bounded retries).
Initial load chooses both base and modifier from the seed. Show Base disables all modifiers.

Twisted uses radial lobes `cos(lobeCount*(theta-phase(z)))`, with phase equal to
`twistPhase + twistDirection*twistAngle*(u + twistVariation*sin(2*pi*u)/(2*pi))`.
This rotates actual lobes, not circular slices. Ribbed uses
`2*((1+cos(ribCount*(theta-ribPhase)))/2)^ribSharpness-1`, multiplied by a smooth
height envelope. Both are actual radial displacements, damped for short/wide vessels.
Only the selected modifier is applied; no uncontrolled stacking of deformations.

| Modifier | Advanced API parameters (angles in radians; amplitudes relative to local radius) |
| --- | --- |
| Folded | foldAmplitude 0–1, foldCount 2–4, foldPosition ±2pi, foldHeight 0.2–0.8, foldSpread 0.2–0.4, asymmetry 0–0.6 |
| Twisted | sculpturalIntensity 0–1, twistAngle 0–2pi, twistDirection -1/+1, twistVariation -0.8–0.8, lobeCount 2–6, twistAmplitude 0–0.18, twistPhase ±2pi |
| Ribbed | sculpturalIntensity 0–1, ribCount 4–24, ribDepth 0–0.15, ribSharpness 1–4, ribPhase ±2pi, ribHeightVariation 0–1 |

Seed resolution varies these geometric parameters within family-specific bounds. Explicit
resolved parameters override defaults. Zero intensity exactly restores the selected base
including its sampling. Ribs receive 24–48 angular samples per rib, with the highest
frequency/profile tested against analytic midpoint chord error. The 200000-segment cap
still applies before allocating deformed contours. Machine violations reject without
rescaling; displacement/curvature warnings do not claim physical printability.

The shared contract remains structurally compatible, with schema/generator 1.1.0 and
new modifier enum values; see docs/geometry-contract.md for identity migration.
Sampling is feature-aware, not a universal tolerance-controlled slicer. High-frequency
relief on small radii may overlap deposited beads and trigger curvature warnings. Large
height/feature combinations can exceed the interactive segment limit. No failure
behaviours, memory/emotion processing or G-code were added.


## Ribbed visual refinement — generator 1.1.1

Only seeded Ribbed defaults changed; the radial formula, Folded/Twisted defaults,
lighting, material, UI and validation thresholds remain unchanged. Schema stays 1.1.0.
Generator 1.1.1 marks the changed default recipe/IDs. Explicit resolved parameters
still reproduce their previous coordinates. Non-Ribbed default resolution is unchanged.

| Seeded Ribbed parameter | Previous range | Refined range |
| --- | --- | --- |
| ribCount | 8–16 | 8–12 |
| ribDepth (local-radius fraction) | 0.06–0.12 | 0.10–0.12 |
| ribSharpness | 1–3 | 1.1–1.5 |
| ribHeightVariation | 0.2–0.7 | 0.05–0.15 |
| ribPhase | 0–2pi | unchanged |

Diagnosis: seed 123 originally resolved to 16 ribs, depth 0.106066, sharpness 2.917367,
and height variation 0.622232. At intensity 0.7 and Bulbous H90/R30 mm, mid-height
radial displacement already spanned -2.672 to +2.661 mm, but the first layer only
-0.842 to +0.838 mm. Dense, narrow peaks and strong end attenuation let the horizontal
beads dominate. In the prior H60/R18 mm example, end relief was only about +/-0.50 mm.
The weakness was not absence of coordinate displacement or solely inadequate lighting.

Refined seed 123 resolves to 12 ribs, depth 0.115355, sharpness 1.483473 and height
variation 0.134446. H90/R30 at intensity 0.7 now has mid-height displacement
-2.907 to +2.900 mm and first-layer displacement -2.097 to +2.092 mm. It uses
360 segments per layer versus 656 before. This case has no geometric warnings,
compared with 46 tight-curvature warnings previously. At H60/R18 the new end relief
is about +/-1.26 mm, middle +/-1.74 mm, also with no warnings at intensity 0.7.

After building, run `node scripts/compare-ribbed.mjs` for four completed Bulbous prints:
base, Folded 0.7, Twisted 0.7, Ribbed 0.7; all use H90/R30, seed 123, identical
perspective camera and fixed-plate framing. Images are saved as artifacts/relief-*.png.
The additional Ribbed top view uses Fit Vessel to inspect the real contour relief.
No visual-only inspection shaders or application UI were added.

The 24-rib/depth-0.15/sharpness-4 extreme still triggers tight-curvature/bead-overlap
warnings. Small radii and short/wide forms can remain unsuitable: local curvature
below half bead width and adjacent-layer displacement above 0.7 mm are reported.
Machine limits are checked independently and invalid paths reject. No warning is
suppressed, and absence of warnings does not establish physical printability.


## Milestone 2B.3 — Validated API

Use `generateBaseGeometry` from `src/geometry.ts`; check `ok` before consuming the
immutable result. The application uses this boundary for live and comparison geometry.
See [contract documentation](docs/geometry-contract.md#milestone-2b3--mandatory-validated-boundary)
for exact signatures, errors/warnings, supported configuration and downstream conventions.
Existing geometry IDs, shapes, machine envelope and rendering are preserved.

## Milestone 2B.4 — Serialization and team handoff

See [the teammate guide](docs/team-handoff.md) for public types, signatures, exact
version compatibility, import validation, examples and verification commands.
`src/serialization.ts` exports a lightweight manifest and a full contour archive;
the existing panel now offers both exports and validated full-geometry import.
Rejected imports preserve the current scene; successful imports reset playback.

Workstream A owns immutable validated geometry. Workstream B reads the manifest's
geometry ID and normalized layer heights, then returns a separate parameter schedule.
The [runnable example](examples/serialization-handoff.ts) and
[small JSON fixtures](examples/handoff/) demonstrate this without Three.js, emotion
processing or failure simulation. A 64-sample source never determines layer count.
Transport version is 1.0.0; geometry schema 1.1.0 and generator 1.1.1 are unchanged.
Imports currently require an exact canonical export of that generator, not arbitrary
edited coordinates. Machine compliance remains a geometric check, not printability proof.

## Milestone 2C — Team integration checkpoint

The existing layer-addressed schedule JSON remains v1.0.0.
`src/failureSchedule.ts` validates identity, versions, types, intensities and layer
references, and reports immutable assignments including stable defaults. Its optional
height-interval adapter converts a 64-bin source to actual layer-centre references;
it does not change geometry or implement failures. See the
[team integration guide](docs/team-handoff.md#milestone-2c--stable-schedule-contract)
for ownership, the JSON reference and independent mock commands.
`examples/mock-integration.ts` and `tests/failure-schedule.test.mjs` exercise the same
64 source bins against 20- and 35-layer geometries without an emotion system or renderer.

## Milestone 3A.1 — Gaps / interrupted extrusion

`src/gaps.ts` derives actual non-extruding moves from the unchanged canonical path.
Seeded arc-length candidates activate monotonically with intensity. The existing viewer
now offers minimal Gaps controls and original/derived comparison; Export Parameters
includes gap diagnostics. Canonical full-geometry export/import remains unchanged.
See [the operator API, calibration measurements and limitations](docs/gaps-3a1.md).

## Milestone 3A.2 — Material edges and residue

Gap-boundary clay now receives localized taper, irregular ends, thin lifted tips and
restart shoulders using a separately versioned display calibration. Commands and gap
metrics are unchanged. See [calibration, comparisons and limitations](docs/residue-3a2.md).

## Milestone 3A.3 — Support-aware overprinting

The derived viewer now evaluates spatial contact against the preceding layer's actual
predicted material surface, including gaps and residue. Bounded support response changes
material positions only; commands and gap metrics stay unchanged. Export Parameters
includes support classifications and diagnostics. See [the API, heuristic assumptions
and controlled verification](docs/support-3a3.md).

## Milestone 3A.4 — Schedule-driven Gaps

Manual Test and local Failure Schedule JSON now use the same `simulateGaps` pipeline,
including residue and support-adjusted material. The existing schedule v1.0.0 and
canonical geometry formats are unchanged. See [the API, Gaps-only fixture and 64-bin
integration example](docs/team-handoff.md#milestone-3a4--schedule-driven-gaps-simulation).
