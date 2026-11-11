# Geometry library and team integration handoff — Milestones 2B.4 / 2C / 3A.4

The public generation API remains in `src/geometry.ts`. Transport types/functions
live in `src/serialization.ts`; both are independent of Three.js. No installation,
new dependencies or emotion processing is required. The optional Gaps simulation
entry point is documented in the 3A.4 section below; generation/transport remain independent.

## Public API and types

```ts
// Existing generation API, unchanged:
generateBaseGeometry(request: GeometryRequest): Promise<GeometryGeneration>
generateGeometry(request: GeometryRequest): Promise<GeometryResult> // throws on failure
geometryToToolpath(result: GeometryResult): Toolpath // defensive mutable copy

// New transport API:
createGeometryManifest(geometry: GeometryResult): GeometryManifest
serializeGeometryManifest(geometry: GeometryResult): string
serializeFullGeometry(geometry: GeometryResult): string
importFullGeometry(input: unknown): Promise<GeometryGeneration>
```

Generation and import return `{ok:true, geometry}` or `{ok:false, errors}`. Error
entries have `code` (`invalid-geometry` or `machine-envelope`) and an English
`message`; rejected results contain no geometry. Successful canonical objects are
deeply frozen and typed `DeepReadonly`. Use the adapter only when a mutable legacy
toolpath is needed. JSON parsing alone neither validates nor freezes data.

`GeometryManifest`, `FullGeometryExport` and `ExternalFailureSchedule` are exported
TypeScript types. They reuse the existing `GeometryResult`, `ShapeDescriptor` and
layer fields; there is no alternative coordinate or parameter naming scheme.

| Format | Contents |
| --- | --- |
| `gof-geometry-manifest` | `schemaVersion`, `generatorVersion`, `geometryId`, `coordinates`, `geometry` (baseProfile, modifier, seed, heightMm, reference radiusMm, resolved parameters), `layerCount`, `layers`, validation status/warnings. No XYZ arrays or moves. |
| `gof-geometry-full` | All GeometryResult fields except `toolpath`. Complete ordered `contours[].points` appear once; includes descriptor, sampling, printing conventions, machine envelope and safety report. No moves or renderer meshes. |

Both add `format` and `formatVersion`. Native JSON number serialization preserves
finite JavaScript numeric values without rounding coordinates. The existing repeated
closing point is intentional. Small descriptor metadata is retained for compatibility;
large arrays are not duplicated for export. The fixed reference plate is never data.
`radiusMm` is the profile reference radius, not a maximum deformed radius; the full
validation report contains deposited extents.

## Import and compatibility

Current supported versions are transport **1.0.0**, geometry schema **1.1.0**,
generator **1.1.1**. This milestone changes neither the generator nor existing IDs.
Unknown versions reject explicitly; there is no automatic migration.

Import accepts a JSON string or a plain parsed object. It bounds traversal, rejects
nonfinite numbers, malformed records, accessors and unsafe keys, and enforces:

- 32 MiB UTF-8 limit for JSON text/files and exports;
- 200,000 contour segments, at most 4,000 layers;
- object traversal limits of 24 levels and 1,500,000 values, plus bounded arrays/strings.

The importer replays the saved **resolved recipe** through the existing mandatory
geometry and machine validators, then compares **every field and coordinate** with
the supplied full export. This independently recomputes topology, layer metadata,
identity, warnings, bead/travel extents and safety checks. Only an exact match returns
the new immutable snapshot. It never repairs edited points, trusts saved flags, or
silently substitutes a different shape. A mismatch rejects the entire input.

This deliberately supports canonical exports of this generator only. Arbitrary meshes,
hand-edited contours, future deformed outputs and older generator versions require
separate future validators/migrations. Cross-engine floating-point differences may
cause rejection; exact numerical replay is not promised across all JavaScript engines.
IDs are recipe identifiers, not signatures or authentication. Transport authentication
remains the caller's responsibility. The 2C schedule boundary below validates schedule
contents and the manifest addressing fields it consumes, not the geometry's physical
validity. Workstream A checks incoming schedules against its own authoritative manifest.

Version policy: transport uses semver independently of the geometry schema. Breaking
field/convention changes require a major version; additive fields a minor version;
compatible corrections a patch. Generator changes that alter coordinates, sampling,
seed resolution or identity require a generator version change. Add explicit importer
support and round-trip fixtures before accepting any additional version. Preserve
archived exports; do not reinterpret old coordinates using new formulas.

## Two independent workstreams

1. **Geometry/fabrication** generates and validates a base, retains its immutable full
   snapshot and publishes the manifest.
2. **Data/emotion** reads manifest identity and `layers[].layerId`, `zMm`,
   `normalizedHeight`, optionally contour length/warnings. It does not import Three.js
   or construct meshes. It returns a separate `ExternalFailureSchedule`:

   ```ts
   {
     schemaVersion: "1.0.0",
     geometryId: manifest.geometryId,
     geometrySchemaVersion: manifest.schemaVersion,
     generatorVersion: manifest.generatorVersion,
     mappingSeed: 42, // optional, independent of the shape seed
     entries: [{ layerId: 1, failureType: "example/unimplemented", intensity: 0.25 }]
   }
   ```

3. Workstream A calls `validateFailureSchedule(scheduleJson, authoritativeManifest)`
   before handing anything to a future simulator. It checks identity/versions, existing
   layer IDs, finite intensity in [0,1], supported types and unique `(layerId, failureType)`
   entries, then returns immutable assignments for every physical layer. No execution
   occurs. Multiple distinct failure types can address a layer; composition semantics
   still require agreement before simulation. The older generic
   `FailureParameterSchedule<TParameters>` remains available unchanged for legacy code;
   the teammate JSON boundary is the existing `ExternalFailureSchedule` v1.0.0.

Layers are zero-indexed, ordered upward in millimetres. XYZ is right-handed Z-up,
and closed contours are CCW viewed from +Z. Layer Z is bead centre: 0.5, 1.5, ... for
1 mm layers. `normalizedHeight = zMm / heightMm`, including fractional final layers.

**64 source samples never imply 64 geometry layers.** For samples representing 64
equal height bins, select `min(63, floor(64 * normalizedHeight))` at each layer centre.
For point samples instead, agree sample positions and interpolation explicitly. Height
intervals are half-open except the last includes 1. Changing geometry/sampling requires
a new ID and remapping; it must not change the base contours. This is a convention,
not an emotion-mapping implementation.

## Runnable example and fixtures

`examples/serialization-handoff.ts` generates a 3 mm-high, radius-8 mm Bulbous/Ribbed
fixture, exports both formats, calls the independent metadata-only
`examples/manifest-consumer.ts`, imports the full export, checks identical contours,
and converts to the existing toolpath pipeline. The example schedule selects the
middle height interval as dummy data; `example/unimplemented` has no operator.

From the project directory with Node 24:

```sh
node --input-type=module -e "import('./examples/serialization-handoff.ts').then(async m => { const r = await m.handoffExample(); console.log(r.geometryId, r.layerCount, r.moveCount); })"
```

Checked-in examples (tests keep them synchronized):

- `examples/handoff/manifest.json` — small teammate-facing metadata;
- `examples/handoff/full-geometry.json` — canonical contour archive;
- `examples/handoff/schedule.json` — independent dummy schedule.

For source transfer, include the public modules and their relative geometry/toolpath/
machine dependencies unchanged. Node 24 or a modern secure browser context
(localhost/HTTPS) supplies Web Crypto; the renderer is optional.

## Application behavior and limits

Export Geometry Manifest / Export Full Geometry save the applied geometry, even while
playing. Import Full Geometry is available when stopped/paused. Invalid imports display
an error and retain the accepted scene and playback. Successful imports reset playback
to Ready, retaining camera/material/view settings. Import preserves all resolved
parameters; explicitly choosing another family/modifier/seed resolves a new seeded
recipe while retaining intensity. Dimension/feedrate edits preserve resolved overrides.
Non-default imported layer/bead dimensions and validation thresholds are retained.

The existing cylindrical Ø200 × H400 mm envelope, default 5 mm side/top margin,
separate fixed Ø200 mm plate and travel conventions are unchanged. Bead extents and
the final nozzle lift count against the limits. Support/curvature warnings are retained,
including warnings in the intentionally small fixture. Compliance is not evidence of
physical clay printability; collision, rheology and stability are not simulated.

Import holds parsed coordinates and one validated replay temporarily; it creates no
exported move arrays or per-frame copies. It runs on the main thread, so large files
can briefly block the browser. No worker, new package or arbitrary mesh importer is
included. Existing rendering remains an approximate bead surface.

## Verification

Run `npm test`, `npx tsc --noEmit`, `npm run build`, then `npm run verify:browser`.
The browser script uses built production files and an installed Chromium browser;
set `BROWSER_PATH` if needed. Tests cover all nine combinations, immutable exact round
trips, custom settings, fixture consistency, tampering, version/size rejection and the
legacy toolpath adapter. Browser checks cover accepted/rejected imports, exports,
playback, comparisons, existing geometry families and responsive layout.

Verified on 2026-11-09: **67/67 tests passed**, TypeScript and production build passed,
and Chromium/WebGL browser regressions passed. The existing large-bundle warning
remains (770.02 kB minified JS; 210.77 kB gzip).

A Node 24 near-limit check (Cylinder H380/R80, 191,140 segments) round-tripped exactly:
8,716,129 JSON bytes, 63 ms serialization, about 520 ms import plus final comparison.
Peak process RSS was about 374 MiB while retaining original and imported results.
These are local observations, not performance guarantees; large imports can briefly
block the main thread and require substantial transient memory.

## Milestone 2C — Stable schedule contract

The existing **schedule schema 1.0.0 and field names are retained**. Its canonical
definition now lives in `src/failureSchedule.ts`, with a type re-export from
`src/serialization.ts` so existing consumers continue to compile. No geometry/import
format, algorithm, rendering or playback change is required. The new module has only
type imports, with no runtime dependency on the generator, Three.js or emotion tools.

```ts
validateFailureSchedule(input: unknown, manifest: GeometryManifest): FailureScheduleValidation
scheduleFromHeightIntervals(manifest: GeometryManifest,
  intervals: readonly HeightFailureInterval[], mappingSeed?: number): ExternalFailureSchedule
```

Validation accepts JSON text or a parsed object. Success is
`{ok:true, schedule, assignments}`; failure is `{ok:false, errors: readonly string[]}`
with no partial assignments. The accepted schedule and assignments are independent,
frozen copies. Entries are sorted by layer ID then failure type; caller input is never
sorted or frozen. Each assignment contains `layerId`, `zMm`, `normalizedHeight` and a
`failures` array of `{failureType, intensity}`. This reports addressing only, not moves,
deformation or an execution order. Bounds are 4 MiB JSON, 24,000 entries and 4,000
manifest layers, consistent with the existing layer allocation limit.

Required matching fields: `geometryId`, `geometrySchemaVersion` = manifest
`schemaVersion`, and `generatorVersion`. Schedule schema must be `1.0.0`; this release
supports manifest format `1.0.0`, geometry schema `1.1.0`, generator `1.1.1`. Unknown
versions/fields/types reject. Layer IDs must exist in the authoritative manifest.
Optional `mappingSeed` is an unsigned 32-bit integer, independent of the shape seed.

| failureType | Contract meaning; no behaviour is executed |
| --- | --- |
| `stable` | No scheduled failure; intensity must be 0. |
| `gaps` | Future interrupted-deposition control. |
| `material-accumulation` | Future excess-material control. |
| `layer-offset` | Future lateral layer-displacement control. |
| `sagging` | Future sagging control. |

Failure intensity is finite and dimensionless in [0,1]; zero means zero requested
effect. It is unrelated to `sculpturalIntensity` or `foldAmplitude`; those parameters
never appear in a schedule. Omitted layers resolve to stable/0. An explicit stable
entry cannot coexist with any other entry on that layer. Duplicate layer/type pairs
reject. Distinct failure types may coexist, but this checkpoint defines no blending,
priority, displacement in mm, gap length, flow multiplier or physical effect at 1.
Those operator calibrations and composition decisions must be agreed before simulation.

`example/unimplemented` remains a recognized inert placeholder solely for the shipped
2B.4 fixture. Existing arbitrary string fields still compile, but unknown strings
reject at the new runtime boundary. New producers should use the five identifiers
above. There is no automatic aliasing of names such as `bulge` or emotion labels.

### 64 intervals to physical layer references

Keep the existing layer-addressed wire format. The optional adapter accepts ordered,
non-overlapping `{start, end, failureType, intensity}` intervals over [0,1]. These are
adapter inputs in Workstream B, not a second schedule format. Every interval is checked,
including bins that no physical layer samples; invalid/overlapping intervals throw.
Uncovered heights remain stable. Multiple simultaneous types can instead be written
directly as separate entries in the standard layer-addressed schedule.

For 64 bins, use `start=i/64`, `end=(i+1)/64`. The adapter selects at the bead centre
`u=zMm/heightMm`, equivalently `min(63, floor(64*u))`. Bins are [start,end), with the
last endpoint 1 included. A boundary belongs to the following bin. No interpolation
or averaging is implied. A fractional final layer uses its actual centre, never
`layerId/(layerCount-1)`. For fewer than 64 layers some source bins are unsampled;
for more, multiple layers can reference the same bin. Re-run the mapping for each
geometry ID; reusing a schedule on another height is rejected.

### Compact teammate output reference

This JSON is valid against the existing `examples/handoff/manifest.json` fixture.
The complete file is `examples/handoff/failure-schedule.json`; the older dummy schedule
is retained unchanged.

```json
{
  "schemaVersion": "1.0.0",
  "geometryId": "gof-geometry-1.1.1-1fdf629ecac53bee575c99527a36d02013e581478ec8551ad71ed6cd35226a66",
  "geometrySchemaVersion": "1.1.0",
  "generatorVersion": "1.1.1",
  "mappingSeed": 42,
  "entries": [
    {"layerId": 0, "failureType": "stable", "intensity": 0},
    {"layerId": 1, "failureType": "gaps", "intensity": 0.25},
    {"layerId": 1, "failureType": "layer-offset", "intensity": 0.5},
    {"layerId": 1, "failureType": "material-accumulation", "intensity": 0.5},
    {"layerId": 2, "failureType": "sagging", "intensity": 0.75}
  ]
}
```

### Module ownership and independent testing

| Owner | Provides / consumes |
| --- | --- |
| Geometry workstream | `src/geometry.ts` and `src/serialization.ts`: validated canonical geometry and manifest JSON. Retains authoritative geometry; receives schedule JSON and calls the shared validator. |
| Shared boundary | `src/failureSchedule.ts`: v1.0.0 types, validation and optional height-bin adapter. Changes require agreement and compatibility tests; no failure executor. |
| Emotion workstream | Reads only manifest metadata; returns schedule JSON. `examples/mock-emotion-mapping.ts` demonstrates synthetic 64-bin output with no classification or memory processing. May implement its own adapter using the documented convention. |
| Integration harness | `examples/mock-integration.ts`: generates geometry, exchanges JSON, validates assignments, checks canonical geometry is unchanged. |

Workstream B can use the saved manifest independently of the generator and renderer,
then check its output with `validateFailureSchedule`. Workstream A can consume the
saved schedule fixture or synthetic JSON without any emotion implementation. Compare
IDs against A's original manifest, not a manifest echoed back by an external producer.
The metadata checks are not authentication or revalidation of arbitrary contour data.

Run the mock for both 20 and 35 physical layers (Node 24, from the project directory):

```sh
node --input-type=module -e "import('./examples/mock-integration.ts').then(async m => { for (const h of [20,35]) { const r=await m.mockIntegration(h); console.log(JSON.stringify({geometryId:r.geometryId,sourceStepCount:r.sourceStepCount,layerCount:r.layerCount,assignments:r.assignments},null,2)); } })"
node --test tests/failure-schedule.test.mjs
```

The mock's 64 values are a fixed synthetic pattern, not emotion analysis. Its seed 42
is metadata, not an instruction to generate randomness or a printing effect. Contract
tests cover both layer counts, boundaries/fractional layers, reproducibility, identity
and version mismatches, invalid intervals/types/intensities, stable defaults,
immutability, multiple types and backward compatibility with the old dummy fixture.

2C verification on 2026-11-09: **75/75 tests passed** (67 existing plus 8 integration
tests), TypeScript checks and production build passed. The mock produced 20 assignments
from 64 bins (4 layers per type), and 35 assignments (7 per type), without modifying
canonical geometry. The production JS/CSS hashes are unchanged; browser checks were
not rerun for this metadata-only checkpoint. The existing bundle-size warning remains.

## Milestone 3A.4 — Schedule-driven Gaps simulation

`src/gapsSimulation.ts` is the single manual/external execution boundary:

```ts
simulateGaps(source: GeometryResult, schedule: unknown, seed: number,
  settings?: GapSettings): Promise<GapsSimulationResult>
```

Keep a validated canonical result from `generateBaseGeometry` or `importFullGeometry`.
Publish `serializeGeometryManifest(source)` to the teammate. The teammate returns
v1.0.0 schedule JSON with **matching geometryId, geometrySchemaVersion and
generatorVersion**, targeting existing layer IDs. Pass that JSON (or a plain object)
and an explicit unsigned 32-bit **failure seed** to `simulateGaps`. The function
validates against the retained source's manifest and rejects the entire request on
error; no partial result is published. No geometry, serialization or schedule versions
changed: geometry 1.1.0, generator 1.1.1, transport/schedule 1.0.0.

The existing `scheduleFromHeightIntervals` adapter resolves height bins *before*
serialization. Intervals are not a second schedule wire format. Use `u=zMm/heightMm`
at bead centres; intervals are ordered, disjoint, half-open, with the last including 1.
An uncovered layer is stable. For 64 equal bins, sample `min(63,floor(64*u))`:
20 and 35 physical layers remain 20 and 35 layers. Overlaps reject; duplicate
`(layerId,failureType)` entries reject; stable and nonstable entries on one layer
conflict. The executor accepts only `stable` and `gaps`, rejecting every other type
even at zero intensity. The wider metadata contract still supports future types;
no simultaneous composition is implemented.

Manual Test uses this same adapter and pipeline with one full-height interval.
Failure Schedule mode imports local JSON (up to the existing 4 MiB limit) and applies
it atomically. Invalid JSON, identity/version mismatches or unsupported types retain
the accepted simulation and paused playback. Successful Apply resets playback to
Ready; simply switching modes does not. Changing base geometry clears derived output
and requires a newly matched schedule. A retained schedule for another geometry
rejects explicitly. The UI reports the accepted schedule, targeted layers, events,
missing-deposition ratio and support diagnostics. Export Parameters includes the
accepted schedule and simulation ID; full geometry/manifest exports stay canonical.

The explicit failure seed controls interruptions and residue. `mappingSeed` remains
optional provenance for the external mapper and is **not** an implicit failure seed.
Shape/sculptural intensity is unrelated to scheduled failure intensity. Intensity 0
produces no gaps; increasing intensity activates a nested subset of fixed candidates
for a given layer/seed, using existing 6 mm spacing and 1.5–3 mm interruption lengths.
Values below the minimum candidate threshold (0.05) can target a layer without an
actual event. The gap fraction is measured commanded missing extrusion, not physical
material loss. Transitions and the contour-seam guard remain extruding as before.

The result contains:

| Field | Meaning |
| --- | --- |
| `version`, `operatorVersion`, `simulationId`, `sourceGeometryId` | Pipeline/operator versions and source/derived identities. |
| `schedule`, `assignments`, `targetedLayerCount` | Validated source schedule, all physical layer assignments, count with Gaps intensity > 0. |
| `gaps` | Frozen commanded moves, applied intensities, events, measurements, seed, versioned calibration and command ID. |
| `residue`, `materialCalibration` | Existing deterministic edge/residue response and calibration. |
| `support` | Existing actual-surface contact analysis, displacement plan, metrics, warnings and calibration. |
| `material` | Final XYZ positions/normals, indices and per-move draw offsets consumed directly by Three.js. |
| `warnings` | Command/fabrication warnings plus material-support warnings. |

Command/support/schedule records remain frozen. Typed material buffers are fresh,
renderer-owned arrays, not canonical data or a JSON transport contract. Consumers
must treat them as read-only; clone before editing. The UI uploads them once and
updates only the current partial bead during playback. Support-aware material
coordinates never rewrite nozzle coordinates, timing or Gap events. Stable scheduled
layers retain continuous commands but can experience predicted support loss caused
by lower missing material, or by an unsupported base shape.

`simulationId` hashes the effective command identity plus pipeline/material/support
calibration versions and values. Schedule entry ordering, omitted stable entries and
mapping provenance do not change the identity when the effective assignments,
failure seed and calibration match. The complete accepted schedule is retained for
traceability. Changes to execution/material semantics require an appropriate operator
or pipeline/calibration version bump; they do not alter the canonical generator.

### Minimal executable fixture

First import `examples/handoff/full-geometry.json` in the UI, set Failure Seed to 42,
then select Failure Schedule and import `examples/handoff/gaps-schedule.json`:

```json
{
  "schemaVersion": "1.0.0",
  "geometryId": "gof-geometry-1.1.1-1fdf629ecac53bee575c99527a36d02013e581478ec8551ad71ed6cd35226a66",
  "geometrySchemaVersion": "1.1.0",
  "generatorVersion": "1.1.1",
  "mappingSeed": 42,
  "entries": [
    {"layerId": 0, "failureType": "stable", "intensity": 0},
    {"layerId": 1, "failureType": "gaps", "intensity": 0.5},
    {"layerId": 2, "failureType": "gaps", "intensity": 1}
  ]
}
```

This small canonical fixture has existing curvature/support warnings; it is an
interface example, not a printable fabrication recommendation. Old multi-failure
and `example/unimplemented` fixtures remain valid metadata fixtures and are explicitly
rejected by this Gaps-only executor.

### Reproducible full mock and independent workstreams

`examples/mock-emotion-mapping.ts` retains its existing default multi-type pattern.
Its explicit `gapsOnly=true` option emits 64 synthetic bins: stable, 0.25 Gaps,
0.5 Gaps, 1.0 Gaps in successive height quarters. `examples/gaps-integration.ts`
generates Bulbous/Ribbed geometry, exchanges manifest/schedule JSON, runs the shared
pipeline and completes actual path-length/feedrate Playback without a renderer.
It returns the full simulation, events and diagnostics for inspection.

```sh
node --input-type=module -e "import('./examples/gaps-integration.ts').then(async m => { for(const h of [20,35]) {const r=await m.gapsIntegration(h); console.log(JSON.stringify({layers:h,completed:r.completed,id:r.simulation.simulationId,events:r.simulation.gaps.events,metrics:r.simulation.gaps.metrics,support:r.simulation.support.metrics,warnings:r.simulation.warnings},null,2));} })"
node --test tests/gaps-simulation.test.mjs
npm test
npx tsc --noEmit
npm run build
npm run verify:browser
```

The teammate can develop using only manifest JSON and `failureSchedule.ts`, returning
Gaps/stable entries without changing the simulator. The geometry workstream can use
the mock or fixture independently. No memory processing or real emotion mapping is
performed. Browser regressions check manual/schedule pixel equivalence, complete
upper-only/varying-height playback and rejected imports preserving the paused image,
time and nozzle position. Screenshots are written to `artifacts/schedule-upper.png`
and `artifacts/schedule-varying.png` at the same geometry, camera and failure seed.

### Remaining limits

The support response uses the 3A.3 contact heuristic with the subsequent
[1.2.0 gravity/contact correction](gravity-contact.md): bounded downward deformation,
contact with accumulated earlier surfaces, no support-driven deletion, and unchanged residue calibration. It
does not predict clay rheology, drying, pressure, collision, long-span collapse or
verified stability. Command-only warnings inside `gaps.validation` describe the
operator; material-support diagnostics are separately in `support`. Side/top safety
margin, actual deposited-vertex validation, 200,000 derived moves and 20 million
contact-query budget remain enforced. Simulation runs on the main thread and large
models can pause interaction or be rejected by those guards. No new physics engine,
failure operator, schedule composition or G-code exporter is included.

3A.4 verification on 2026-11-10: **122/122 tests passed** (15 new pipeline tests),
`npx tsc --noEmit`, production build and Chromium/WebGL regression passed. The mock
targeted 15/20 layers (80 events, 13.54% commanded missing deposition) and 26/35
layers (134 events, 13.43%), with complete playback and unchanged canonical geometry.
Equivalent manual/imported schedules produced identical command events, material
buffers, support diagnostics, IDs and completed browser pixels. Upper-only and
varying-intensity screenshots show the requested height targeting; no support
calibration increase was needed. The existing bundle-size warning remains
(790.99 kB minified JS, 217.58 kB gzip). These checks complete the Milestone 3A
integration scope, not physical validation of clay behaviour.
