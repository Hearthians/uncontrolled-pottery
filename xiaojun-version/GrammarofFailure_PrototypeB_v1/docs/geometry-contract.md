# Shared Geometry Contract — Milestone 2B.1

Public entry point: `src/geometry.ts`. Use `await generateBaseGeometry(request)` from a
browser or Node 24. No Three.js objects, memory records or emotion labels cross this
boundary. The existing synchronous `generateToolpath(CylinderParameters, ShapeRequest)`
remains compatible as an internal/legacy adapter. The application now uses the validated public API. It is a mutable legacy API;
the new public API returns a deeply frozen snapshot with TypeScript DeepReadonly types.

## Input and ownership

`GeometryRequest` has four independent groups:

| Group | Fields and conventions |
| --- | --- |
| geometry | heightMm, radiusMm, baseProfile, unsigned 32-bit seed, optional ShapeParameters overrides |
| sampling | layerHeightMm; default application value 1 mm |
| printing | beadWidthMm, feedrateMmMin |
| validation | optional safetyMarginMm (default 5), maxLayerDisplacementMm (default 0.7) |

All required dimensions/settings must be supplied explicitly. `CylinderParameters` is
retained as the intersection of GeometryDimensions, ContourSamplingParameters and
DepositionSettings. The angular sampling policy is recorded in the result: uniform angles with at least
max(32, ceil(2*pi*referenceRadius/1mm)) segments, increased for enabled twist/rib
features as described in the 1.1.0 compatibility note.
This is reference-circle resolution, not an adaptive error guarantee for deformed contours.
The existing travel feedrate (1800 mm/min) and 5 mm clearance are recorded separately
in printing conventions. Layer spacing controls contour Z and bead height; bead width
and feedrate do not control base shape formulas.

## Output

`GeometryResult` extends the existing structures rather than substituting mesh data:

- schemaVersion 1.1.0 and generatorVersion 1.1.1;
- geometryId; geometry with baseProfile, resolved modifier, seed, dimensions and all actual ShapeParameters;
- coordinates with units=mm, Z up, right handed, origin at build-plate centre/surface;
- sampling and printing settings with the actual policies used;
- descriptor: the existing ShapeDescriptor (its nested version remains 2);
- contours: existing Contour data enriched with its descriptor layer metadata;
- toolpath: existing Move[] plus total lengthMm and durationS;
- validation: valid or valid-with-warnings, geometric warnings, nominal machine envelope
  and build-volume validation including safety margin and deposited/nozzle extents.

GeometryLayer combines layerId, zMm, normalizedHeight, contourLengthMm,
maxLateralDisplacementMm, beadHeightMm and ordered points. Layers are zero-indexed,
ascending in Z. Points are nozzle-centreline XYZ tuples, counterclockwise as viewed
from +Z, with the first point repeated exactly at the end. The seam is theta=0/+X.
A 1 mm layer is centred at Z=0.5, 1.5, etc.; the final fractional layer is centred in
its remaining thickness. normalizedHeight = zMm/heightMm, not layerId/(count-1).

Cylinder, Tapered and Bulbous remain the baseProfile identifiers. The optional input modifier defaults to `soft-organic-fold` for old requests.
Its zero intensity produces `none` in the public result. Twisted and ribbed use
sculpturalIntensity, while folds retain foldAmplitude. Twisted and ribbed are additional modifier identifiers in 1.1.0; no failure operators are included. All dimensions/coordinates are machine millimetres;
the renderer's separate scale/axis conversion is never part of this contract.

Invalid input or a volume violation throws before a result is published. Existing
BuildVolumeError distinguishes machine rejection; other validation errors remain Error.
Warnings indicate potential geometric support/curvature issues. Nominal Ø200 x H400 mm
limits and the separate margin are retained; side/top clearance includes travel and
bead extents, with contact allowed at Z=0. The fixed reference plate is absent from
contours and moves. Passing validation is not proof of physical printability.

## Identity and versioning

geometryId is `gof-geometry-<generatorVersion>-<SHA-256>`, hashing canonical resolved
geometry configuration, seed, coordinate conventions and sampling. Parameter keys are
sorted; explicit defaults and omitted defaults give the same identity. Printing,
warning thresholds and machine clearance are excluded: they may change toolpaths,
validation or warnings without changing the base-geometry identity. Compare printing
settings separately when identifying a manufacturing job.

The ID denotes a generation recipe, not equivalence of arbitrary meshes: different
seeds may identify distinct recipes even when zero folds produce identical contours.
It is an identifier, not a digital signature or a verifier of edited JSON coordinates.

Schema uses semantic versioning: increment major for incompatible field/convention
changes, minor for additive fields, patch for compatible documentation/type corrections.
Generator version must change whenever formulas, random resolution, sampling, coordinate
conventions or identity serialization can change results; preserve old fixtures when
changing it. Do not promise replay of old recipes using a new generator. Existing
fixtures pin the initial ID and representative outputs. Serialization preserves the
schema, resolved parameters and sampled points; archive results when exact long-term
coordinates are required. Reproduction is tested in the supported runtime, not as a
bitwise floating-point guarantee across every JavaScript implementation.

Every returned nested object/array is frozen; caller inputs are not frozen or retained.
JSON parsing does not restore immutability or validate data. Use `importFullGeometry`
from `src/serialization.ts` for full exports; see [the handoff guide](team-handoff.md)
for strict version/replay validation. Web Crypto SHA-256 requires a secure browser context
(localhost/HTTPS) or Node 24. This makes the wrapper async, not the existing renderer.

## Data-workstream handoff

For the current team JSON boundary use `ExternalFailureSchedule` v1.0.0 and
`validateFailureSchedule` in `src/failureSchedule.ts`; see the
[2C integration guide](team-handoff.md#milestone-2c--stable-schedule-contract).
It retains the 2B.4 layer references and validates assignments without changing
geometry. The generic schedule below is retained for older consumers, not a second
team interchange requirement.

1. Geometry workstream publishes the immutable result and geometryId.
2. Data workstream reads contours[].layerId, zMm and normalizedHeight. It never needs
   Three.js and never writes to the base geometry.
3. It creates a separate FailureParameterSchedule<TParameters> with schemaVersion,
   geometryId, a namespaced/versioned parameterSchema and entries of layerId/parameters.
4. A future simulator receives (geometry, schedule) and creates a separate output.
   Before applying anything it must check matching geometryId/schema, unique valid
   layer IDs, finite parameter values, and the agreed operator units/ranges. This
   milestone defines the handoff only; it does not implement that simulator.

Sparse schedules are allowed: omitted layers mean no scheduled operator. Duplicate
layer entries are invalid; entries should be sorted by layerId. Parameter names, units,
ranges and interpolation belong to the separately versioned operator schema, not the
base-geometry schema. Reordering or changing layer sampling produces a new geometryId;
never reuse a schedule across IDs without remapping.

A data source with 64 scores does not imply 64 print layers. Use layer centre u=z/H.
For 64 equally spaced height bins [i/64,(i+1)/64), a documented piecewise-constant
adapter can select min(63,floor(64*u)); for point samples, explicitly agree their
sample positions/interpolation instead. All intervals are half-open except the last
which includes 1. No choice of data sampling changes contour generation or layer count.

See `examples/geometry-consumer.ts`: it reads metadata and contour points, then builds
an empty-parameter schedule for u in [0.25,0.75). Empty parameters demonstrate addressing
only, not failure semantics. Run without generated files:

    node --input-type=module -e "import {example} from './examples/geometry-consumer.ts'; console.log(JSON.stringify(await example(), null, 2))"

## Verification and scope

Contract tests cover legacy compatibility, metadata consistency, identity stability,
settings separation, mutation rejection, JSON round-trip, invalid-input rejection and
the consumption example. Compile-only tests ensure nested readonly access.
The 200000-segment limit, single closed polar contour per layer and existing machine
checks remain. A runtime JSON importer, schedule executor, emotion classification,
additional families and physical failure simulation are outside this milestone.


## 1.1.0 compatibility note

The schema and generator are now 1.1.0. Existing request fields, output nesting,
contour conventions and legacy calls remain supported. ShapeDescriptor stays version 2
with an optional additive modifier identifier. ShapeParameters gains resolved numeric
fields. Consumers must accept the new modifier values `twisted` and `ribbed`.
Existing folds/neutral coordinates and the numeric 1.0.0 baseline remain unchanged.
IDs intentionally change because generator version, resolved fields and sampling metadata
changed. The archived 1.0.0 bulbous seed-123 fixture ID was
`gof-geometry-1.0.0-e2f9f7afc01dc157a96b29384af4fa62a427b3dd4b6b6748419b15ba3bab357d`;
its representative point [13.137358317089488,13.356396426590226,17.5], contour length
113.68323423116752 mm and duration 367.29542136067664 s remain regression checks.
Old IDs must not be reused for 1.1.0 schedules. There is no historical generator dispatcher.

New modifier requests use geometry.modifier plus geometry.parameters. No separate mesh
or data format is introduced. Angular samples are max(reference-radius samples,
24*lobeCount) for enabled twists, and max(reference-radius samples,
ribCount*ceil(24*sqrt(ribSharpness))) for enabled ribs. Zero intensity/depth returns
baseline sampling as well as baseline coordinates. All actual counts are recorded.


### Generator 1.1.1: Ribbed defaults only

Schema remains 1.1.0. Generator 1.1.1 changes seeded default Ribbed count/depth/profile/
height-envelope ranges; explicit resolved recipes retain their numeric geometry.
Folded/Twisted recipes and all shared fields/conventions remain unchanged. As required
by versioned identity, IDs change with the generator version. Regenerate schedules
against the new geometryId rather than silently attaching an old ID. No new parameter
fields or consumer adapters are required. Pass the selected modifier when resolving
parameters; omitted modifier continues to use backward-compatible Folded defaults.
The archived 1.1.0 folded fixture ID is
`gof-geometry-1.1.0-3f5c705c321255d3dbaec519e7e9a2626ace77718ea4a753a1ffefd9d2e0927b`;
its representative numeric outputs remain covered by regression tests.


## Milestone 2B.3 — Mandatory validated boundary

Exact public signatures:

```ts
generateBaseGeometry(request: GeometryRequest): Promise<GeometryGeneration>
generateGeometry(request: GeometryRequest): Promise<GeometryResult> // compatibility: throws
geometryToToolpath(result: GeometryResult): Toolpath // defensive legacy adapter
```

`GeometryGeneration` is a readonly discriminated union:
- `{ ok: true, geometry: GeometryResult }` only after mandatory checks;
- `{ ok: false, errors: readonly { code: "invalid-geometry" | "machine-envelope"; message: string }[] }`.

Failed requests carry no partial geometry. Successful results retain `validation.status`
(`valid` or `valid-with-warnings`), warnings and the machine envelope report. Warnings
remain usable results; errors reject. Unexpected generation/runtime errors are also
reported through the failure branch; callers should display the message. They must
not reinterpret `ok:true` as a claim of physical printability.

The previous `generateGeometry` delegates to the same checks but keeps its throwing
signature. Neither public entry point accepts caller-supplied contours, metadata or
validation flags. `generateShape` is explicitly internal/raw: it returns no validated
GeometryResult and is not re-exported by the public library. Keep transformations and
JSON import validation in the separate serialization API; post-transformation certification is a future concern.

Preflight rejects malformed groups, unknown parameters, unsupported modifier values,
and unsupported policy overrides. Numeric ranges reuse existing generators. Optional
`machine` accepts the existing Delta WASP configuration (name, cylindrical volume,
200 mm diameter, 400 mm height, centreXY [0,0], surfaceZMm 0), with optional safetyMarginMm.
Other machines/envelopes are rejected explicitly, never silently substituted. When both
machine and validation specify a margin, they must agree. Otherwise the provided margin
or the existing default 5 mm is used. No path is rescaled.

Sampling accepts layerHeightMm and optional declarations matching the versioned angular
policy. Arbitrary angular policies/tolerances are not yet configurable. Bead height
continues to derive from layer spacing, including a fractional final layer; independent
bead-height overrides are rejected. Nominal bead width, its existing visual allowance,
5 mm lift and 1800 mm/min travel speed remain unchanged.

After generation, an O(points + moves) gate checks finite horizontal XYZ, exact closure,
positive angular wedges, one counterclockwise turn, nondegenerate edges, expected layer
IDs/Z/thickness, segment limit, finite connected move/timing/extrusion sequences. For
these supported polar contours, positive angular wedges covering exactly one turn prove
non-self-intersection; this is not a general arbitrary-mesh intersection validator.
The existing centralized cylindrical envelope validator remains mandatory and unchanged.

The application validates both the live geometry and the neutral comparison before
committing them together. Failed generation preserves the last accepted shape/playback;
configuration controls disable while pending. Deterministic random retries retain the
existing candidate selector, then publish only through generateBaseGeometry. Legacy
renderer/playback inputs are defensively copied once per accepted configuration;
canonical result arrays stay frozen. No validation or copying occurs per animation frame.

Minimal API usage (see the 2B.4 handoff guide for runnable transport examples):

```ts
const outcome = await generateBaseGeometry({
  geometry: { baseProfile: "bulbous", modifier: "ribbed", seed: 123,
    heightMm: 35, radiusMm: 15, parameters: { sculpturalIntensity: 0.7 } },
  sampling: { layerHeightMm: 1 },
  printing: { beadWidthMm: 2, feedrateMmMin: 600 },
});
if (outcome.ok) {
  const { geometryId, contours, validation } = outcome.geometry;
  // 35 layers; contours[0].layerId=0, zMm=0.5, normalizedHeight=0.5/35.
  // Read contours[0].points in order; reference geometryId + layerId in a separate schedule.
} else {
  console.error(outcome.errors); // e.g. machine-envelope for a radius-99 mm vessel
}
```

Schema 1.1.0, generator 1.1.1 and identities remain unchanged for supported existing
requests: no formulas or sampling outputs changed. Previously ignored unknown input
fields now reject intentionally. Milestone 2B.4 adds transport/import and team handoff
in [team-handoff.md](team-handoff.md); schedule execution remains future work. The
existing height mapping conventions above apply independently of any 64-score data source.
