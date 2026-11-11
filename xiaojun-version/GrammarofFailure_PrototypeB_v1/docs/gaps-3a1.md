# Milestone 3A.1 — Interrupted extrusion

Branch: `feat/failure-simulation`. Implementation: `src/gaps.ts`. This module consumes
validated canonical geometry and the existing Failure Schedule 1.0.0, producing a
separate frozen derived result. Geometry schema 1.1.0 / generator 1.1.1, original
contours, canonical import/export and the sculptural generators remain unchanged.

## API

```ts
applyGaps(source: GeometryResult, schedule: unknown, seed: number,
  settings?: GapSettings): Promise<GapResult>
gapResultToToolpath(result: GapResult): Toolpath
```

`schedule` accepts JSON text or a parsed schedule. The existing validator checks IDs,
versions, layer references and intensities. Only `stable` and `gaps` are accepted;
all other types reject, even at zero intensity. There is no multi-failure composition.
Errors throw without publishing a partial result. The explicit unsigned 32-bit seed
controls the pattern; schedule `mappingSeed` remains independent producer metadata.
Use `scheduleFromHeightIntervals` to address normalized heights; never assume 64 layers.

`GapSettings` contains `version: "1.0.0"`, `spacingMm`, `minLengthMm`, `maxLengthMm`.
Version 1.0.0 identifies this operator/calibration algorithm. Defaults are 6, 1.5,
and 3 mm. Values must be finite and positive, spacing at least 1 mm and twice maximum
length. Changes to candidate placement, PRNG, activation or splitting require a version
bump. Explicit numeric settings and the version are included in the derived identity.

`GapResult` records source geometry ID, SHA-256 derived ID, failure type, failure seed,
resolved settings, per-layer applied intensities, events and the derived toolpath.
Each event records layer ID, candidate ID, start/end arc length in mm and applied
intensity. Metrics report event count, interrupted layers, commanded interrupted mm,
total originally extruding mm (including transitions), missing ratio and average/max
event length. Validation includes the machine report on `toolpath.buildVolume`, source
warnings and explicit warnings about missing physical support/flow modelling. The
derived ID also includes source printing settings and safety margin; it is not a
canonical geometry ID or an authenticity signature.

## Candidate events and intensity

For each physical contour of length L, an avalanched layer/seed key initializes an LCG
that selects a density factor
in [0.8,1), then creates floor(L/spacingMm * factor) cells of equal **arc length**.
The LCG places a candidate centre at 27–73% of its cell, samples
its length uniformly within the configured range, and assigns an activation threshold
in [0.05,0.95). Candidate generation is independent of intensity. Activate when the
scheduled intensity reaches that threshold. Each layer has its own random sequence.
Cells bound placement but their jitter, lengths and activation create irregular
interruptions; this remains a stratified approximation, not measured starvation data.

With fixed source, seed, scope and settings, increasing each layer's intensity gives
a nested event set. Positions and lengths never move; event count and missing length
are **nondecreasing**, not strictly increasing at every infinitesimal intensity change.
Below the lowest candidate threshold a positive intensity can yield zero events.
Intensity zero exactly preserves the original path. Contours shorter than one spacing
cell have no candidates. At intensity one all candidates are active.

Candidates cannot overlap or touch: centres stay inside their cells and maximum length
is at most half a cell. Consequently event count equals the number of interrupted
intervals, not the number of split travel moves. No overlap merging is needed. The
first and last cells leave at least 2% of a cell clear of the contour seam. This
deliberately protects the real extruding transition; no wrap-around gap crosses it.
Transitions and initial/final travel are untouched. Seam-spanning interruption is a
future calibration decision, not a hidden mesh repair.

Each selected interval splits the original deposition polyline at its arc-length
boundaries. Inside the interval `kind="travel"`, `extrude=false`; the original
deposition feedrate is retained. Travel does not imply a speed change. Endpoints are
interpolated on the original chords and original per-move times, so nozzle trajectory,
path length and duration are retained. Cuts within 1e-9 mm of an existing vertex snap
to that vertex to avoid numerical zero-length segments. There is no angular-distance
assumption, contour deformation, skipped nozzle movement or mesh deletion.

The existing topology/move validator and cylindrical envelope validator check both the
input and derived path. The derived **move count** additionally cannot exceed 200,000;
excessive splitting rejects instead of silently dropping events. The original contour
segment cap remains intact. Machine dimensions, bead widths and safety margins are
unchanged. Removing deposition does not prove remaining spans are physically supported.

## Rendering and UI

The existing `claySurface` buffers already skip non-extruding moves, and the partial
bead is hidden on travel. Gaps therefore remain absent after completion without a new
renderer, shader effect or per-frame reconstruction. Bead cut ends retain the existing
uncapped segment approximation; no residue, smoothing or physics is added.

The research controls are Enable Gaps, Failure Intensity, Failure Seed and Apply Gaps /
Regenerate. They are drafts until applied. Apply resets playback; invalid settings
retain the previous accepted result. Disabling and applying restores canonical
printing. Shape regeneration/import clears the applied failure result; apply the
failure controls again for the new geometry. Play/Pause/Reset never change the seed.

With a derived path active, the existing comparison switches between Show Original
(full undeformed-deposition snapshot of the same sculptural shape) and Show Derived.
Comparison does not change elapsed time or the deposited state. Without a derived
path, the existing neutral-base comparison remains available. Camera, clay, lighting,
nozzle and plate are unchanged.

Export Parameters includes derived identity, settings, applied intensities, gap events,
metrics and warnings. Full Geometry / Manifest exports still refer exclusively to the
canonical base; the derived path is not fed into canonical full-geometry import.

## Controlled measurements

Cylinder H20 / R15 mm, 1 mm layers, bead width 2 mm, 600 mm/min; geometry seed 123,
failure seed 42, all layers addressed, default calibration. Intended extrusion length:
1903.612051 mm including unchanged interlayer transitions.

| Intensity | Events | Interrupted layers | Missing mm | Missing ratio | Mean gap mm | Max gap mm |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 0% | 0 | 0 |
| 0.25 | 69 | 20 | 161.520 | 8.485% | 2.341 | 2.997 |
| 0.50 | 145 | 20 | 331.754 | 17.428% | 2.288 | 2.999 |
| 0.75 | 223 | 20 | 507.510 | 26.660% | 2.276 | 2.999 |
| 1 | 269 | 20 | 612.648 | 32.183% | 2.278 | 2.999 |

These measure commanded absence of deposition, not actual material loss. The browser
comparison uses H35 / R15, the same source shape and camera before/after, intensity 1
and seed 42. Screenshots: `artifacts/gaps-before.png`, `artifacts/gaps-after.png`.

## Verification and next checkpoint

Run `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run verify:browser`.
Tests cover nested intensity sweeps, immutability, all nine profile/modifier combinations,
schedule scope, exact connectivity, timing and positions, no material during travel,
playback completion/pause, machine rejection and derived segment limits. Browser checks
also exercise apply/disable, original/derived comparison, paused state, visible completed
gaps, exported diagnostics and the existing regression suite.

Verified 2026-11-09: 86/86 automated tests passed; standalone TypeScript check,
production build and Chromium/WebGL browser regressions passed. Final screenshots
were visually reviewed. Vite's existing large-bundle warning remains (781.08 kB JS,
213.98 kB gzip). No dependencies were added. Changes are on the requested feature
branch; no canonical geometry, schedule or full-import contract was changed.

3A.2 should first measure real strand lengths, interruption frequency and restart lag
against these diagnostics. Agree how to handle seam transitions and whether short
residue tails consume deposited material before adding any edge-drag representation.
Keep residue output derived and separately versioned. Support response, sagging,
multi-failure composition and G-code remain outside 3A.1 and are not implemented.
