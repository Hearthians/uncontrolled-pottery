# Milestone 3C — Layer Offsets functional prototype

## Pipeline and public boundary

The canonical geometry engine remains `geometry.ts` / `shapes.ts`, with 1 mm slicing
and ordered moves from `toolpath.ts`. `simulateOffsets` copies this validated path,
applies constant XY translations by layer, then uses the existing `beadBuffers`,
`ClayScene` and `Playback`. Neither the canonical contours nor the base shape recipe
are modified. Z coordinates, layer count, contour topology and bead dimensions stay
unchanged. The fixed white Ø200 mm build plate remains separate from all toolpaths.

```ts
simulateOffsets(source: GeometryResult,
  mode: "sudden" | "local" | "combined",
  intensity: number, seed: number): Promise<OffsetsResult>
```

The v1.0.0 result provides a source geometry ID, deterministic derived ID, resolved
calibration, immutable events and per-layer XY states, modified `Toolpath`, final
material buffers, metrics and warnings. The path and buffers are derived mutable
consumer data; treat them as read-only when handing them to another module.
Geometry Schema 1.1.0, Generator 1.1.1 and Failure Schedule 1.0.0 are unchanged.

Each event has an ID, `type`, `startLayerId`, `endLayerIdExclusive` and XY
`displacementMm`. Layer IDs are zero-based; local ranges are half-open. Sudden event
ranges extend to the final layer. At a given layer, the state is the sum of all active
event vectors: cumulative sudden shifts plus any temporary local shift. Local groups
are disjoint and always recover to the persistent baseline before the next slot.

## Intensity and placement

For positive intensity I and bead width W:

- Requested magnitude per event: `W * (0.15 + 0.60 * I)` mm. At I=0, no events are
  generated and path/material data match stable printing exactly.
- Active slots: `min(availableSlots, 1 + floor(2*I))`. There are at most three slots.
  Sudden or Local mode creates one event per active slot; Combined creates two.
- With multiple slots, requested local duration is `1 + floor(9*I)` layers.
  With one slot, the band limit is `max(1, floor(0.15*layerCount))` and the requested
  duration is the ceiling of intensity times that limit, with a minimum of one layer.
  The slot caps either duration to retain a recovery layer.
- The initial `max(1, floor(0.12*layerCount))` layers are stable. The remaining range
  reserves the final layer for local recovery. Every ten available layers provide
  one full slot, up to three. A smaller range can still use one slot if at least
  three layers are available. Below that minimum, the result is stable with a warning.
- A single-slot print places the sudden boundary near one-third of its available
  range and the local band near two-thirds, reserving space for recovery.
  Combined uses the same two events as the standalone modes.
- Seeded directions use a separate deterministic LCG. Sudden increments stay within
  a 45-degree cone around a shared heading; Local events use seeded XY directions.
  Candidate slots and directions do not move when intensity changes. Playback,
  camera changes and rerendering never regenerate events.

Example, W2/H35 mm: I=0.15 / 0.5 / 1 requests 0.48 / 0.90 / 1.50 mm per event,
1 / 2 / 3 active slots and 2 / 5 / 10 local layers. Local-only mode fits 2 / 5 / 9
layers per group after reserving recovery; Combined fits up to eight. At maximum
intensity, cumulative sudden shifts can exceed one event's 1.5 mm displacement.
The initial larger trial magnitude produced wide unsupported openings in renders;
the shipped 0.75W maximum keeps individual shifts below the nominal bead width.
It is a geometric calibration, not a verified layer-contact criterion.

Requested magnitude, duration and frequency are monotonic. Final per-event magnitude
can be limited by clearance saturation as additional events become active; this is
explicitly reported and is not an unqualified monotonic physical-effect claim.

## Frozen 3C.1 calibration

The 20-layer reference previously activated two slots at intensity 0.7. Combined
started its local bands just one layer after each persistent shift. Calibration
1.1.0 caps this case at one slot and separates the step from the band. The operator
result schema stays at 1.0.0 and the derived ID incorporates the new calibration.

The reference is a cylinder of height 20 mm, radius 15 mm and bead width 2 mm.
It uses 1 mm slicing, intensity 0.7 and failure seed 42. Layer ranges below use
zero-based IDs and exclude the end.

| Mode | Shift range | Local range | Events | Affected layers | Non-extruding boundaries |
| --- | --- | --- | ---: | ---: | ---: |
| Stable | — | — | 0 | 0 | 0 |
| Sudden | [7, 20) | — | 1 | 13 | 1 |
| Local | — | [13, 16) | 1 | 3 | 2 |
| Combined | [7, 20) | [13, 16) | 2 | 13 | 3 |

The sudden vector is (+0.346410, +1.086094) mm and the local vector is
(−1.008225, −0.532054) mm. Both retain the 1.140 mm per-event magnitude.
Combined returns to the shifted baseline at layer ID 16. At intensities
0.15, 0.5 and 1, the 20-layer Local mode produces bands of 1, 2 and 3 layers.
The 35-layer fixture retains 1, 2 and 3 active slots as intensity rises.

Run `node scripts/compare-offsets.mjs --short` for the four matched renders in
`artifacts/offsets-short-comparison.png` and the event vectors and envelope
results in `artifacts/offsets-short-metrics.json`. The renders show the
persistent lower step, the narrow upper band, and both features in Combined.

## Transitions, rendering and machine limits

Unchanged frame boundaries preserve the original extruding layer transition. At any
changed frame boundary, the connector becomes explicit non-extruding lift, traverse
and lower moves, using existing 5 mm clearance and 1800 mm/min travel settings.
Lift height is capped at the configured machine safety ceiling. All closed layer
contours still extrude completely; no gaps are inserted into them. There are no
invisible teleports or deposited diagonal bridges across coordinate jumps.
Durations are recomputed from the resulting distances and feedrates, so nozzle and
material animation consume the exact same path as the completed object.

Derived deposition moves include optional `contourOffsetXY` to preserve the original
bead cross-section frame and fine surface variation after translation. This field is
absent from canonical geometry. Full and partial deposition use the same renderer
function. Geometry is precomputed per configuration, not rebuilt per animation frame.

Clearance uses the canonical path's conservative radial swept envelope, including
bead width. A common factor bounds the largest requested layer offset by the remaining
radial room inside radius `100 - safetyMarginMm`. All events are scaled consistently;
the UI reports the reduction percentage. No geometry is clipped or base shape rescaled.
Zero usable clearance rejects the request. The final command envelope and actual
render vertices are checked against Ø200 × H400 mm, with the existing default 5 mm
side/top margin. The 200,000-move limit remains enforced.

## UI, export and integration scope

Manual Test adds Layer Offsets to the existing Failure Type selector and a small
Offset Mode selector. It reuses intensity, seed, regenerate, comparison and playback
controls. Set intensity to zero and apply to return to stable printing. Failed
generation leaves the previously accepted simulation in place.

Export Parameters includes the offset events, layer states, constraints, derived ID
and **modified toolpath**, including actual XYZ moves and extrusion flags. Canonical
Manifest/Full Geometry export remains unchanged and is explicitly labeled as canonical
in the offset UI note. There is no G-code exporter and no claim of machine readiness.

Combined means Sudden + Local offsets only. Offsets, Gaps and Bulges remain exclusive
manual operators; selecting/applying one replaces the previous simulation. The current
schedule executor remains Gaps-only. This milestone does not execute `layer-offset`
schedule entries or combine offsets with Gaps/Bulges. A future composition stage must
apply path offsets first and then apply extrusion/material operators against that
derived path; passing shifted contours off as canonical geometry is unsupported.

The standalone v1.0.0 manual operator and its event/layer/path result are frozen
for handoff at calibration 1.1.0. Schedule adaptation and cross-operator composition are explicitly
outside that frozen functional boundary; coordinate their ownership before integration.

## Verification and files

Run `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run verify:browser` and
`node scripts/compare-offsets.mjs`. No lint script is configured.

3C.1 verification passed **163 automated tests**, the production build with
TypeScript checks, and the production Chromium/WebGL regression. The browser suite
checks all three modes, modified toolpath export, deterministic regeneration, playback,
Gaps and Bulges. The four matched 20-layer renders completed without browser errors.
Vite still reports its bundle size advisory.

For the H35/R15/W2 mm Cylinder, seed 42, Local mode at I=0.15 / 0.5 / 1 produces
1 / 2 / 3 events affecting 2 / 10 / 27 layers, with maximum displacement
0.48 / 0.90 / 1.50 mm. Sudden mode affects the same 31 layers after its first event,
while cumulative maximum displacement rises to 0.48 / 1.797 / 4.491 mm. Combined
mode emits 2 / 4 / 6 events and reaches 0.48 / 2.380 / 4.793 mm. The initial four
layers remain unchanged in every positive-intensity case.

Tests cover stable identity, persistence, local recovery, additive Combined state,
intensity scaling, deterministic results, immutable canonical source, closed contours,
actual translated bead vertices/normals, explicit travel, timing, pause/reset/completion,
short models, machine clearance, JSON path export and absence of the build plate.
Cylinder, Folded, Twisted and Ribbed forms are included. Existing Gaps, Bulges,
serialization and shared-contract tests remain in the same suite.

The comparison script produces 30 fixed-camera completed renders across Cylinder,
Folded and Twisted shapes, all three modes and four intensities, plus 36 metric records:
`artifacts/offsets-comparison.png`, `artifacts/offsets-{shape}-{mode}-{intensity}.png`
and `artifacts/offsets-metrics.json`. Browser regression also checks all mode controls,
modified-path export, identical regeneration, pause/comparison/resume/reset and zero
intensity, saving `artifacts/offsets-ui-{mode}.png`.

Changed files:
- `src/offsets.ts`: deterministic events, layer states, modified paths, clearance and diagnostics.
- `src/toolpath.ts`: optional derived bead-frame translation metadata.
- `src/claySurface.ts`: translated layer frames for full and progressive deposition.
- `src/App.tsx`: mode controls, simulation selection, warnings and derived-path export.
- `tests/offsets.test.mjs`: operator and renderer/playback regression tests.
- `scripts/verify-browser.mjs`: UI integration and export checks.
- `scripts/compare-offsets.mjs`: controlled visual/quantitative comparisons.
- `README.md` and this guide: usage, contract, calibration and handoff limitations.

Remaining limits: clearance scaling is conservative and direction-independent; it
may constrain offsets more than an optimized fit would. Abrupt shifts can still reduce
support or cause collisions. Lifted travel is not collision-solved. Physical support,
adhesion, collapse and sagging are not modeled. Existing open display sweep ends and
layer seam geometry are retained; material meshes are not fabrication-ready solids.
