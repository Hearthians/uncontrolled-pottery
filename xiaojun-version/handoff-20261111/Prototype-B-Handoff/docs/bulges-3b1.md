# Milestone 3B.1 — dwell-induced material accumulation

> Historical 3B.1 record. Mesh generation, accounting and growth below are superseded by [Milestone 3B.2](bulges-3b2.md); event placement and dwell formulas remain unchanged.

## Public API

`src/bulges.ts` is independent of Gaps, support response, emotion mapping and Three.js:

```ts
simulateBulges(source: GeometryResult, intensity: number, seed: number,
  calibration?: BulgeCalibration): Promise<BulgesResult>
bulgeMesh(event: BulgeEvent): BulgeMesh
bulgeProgress(event: BulgeEvent, time: number): number
bulgeTiming(path: Toolpath, result: BulgesResult): {
  durationS: number; sample(time: number): PathSample
}
```

Use a validated canonical geometry as source. The operator validates intensity,
unsigned 32-bit seed, supported calibration, contours, original machine envelope
and final added-material vertices before publishing the derived result. Failure
throws without replacing the accepted UI state. No global rescaling is performed.

The result records source/derived identities, operator/version, seed/intensity,
calibration, immutable events and ordered motion/dwell instructions, per-event
material buffers, total simulation duration, measurements and warnings. Its identity
includes geometry ID, printing settings, safety margin, calibration, intensity and
failure seed. Metadata is frozen; typed arrays are renderer-owned and should be
treated as read-only. It does not contain altered canonical moves.

## Flow and timing assumptions

Nominal cross-section is the ellipse estimate `A = pi * W * H / 4`; nominal digital
flow is `Q = A * feedrateMmMin / 60`. This is independent of the display bead's
flattened cross-section approximation and is not calibrated clay flow.

Each fixed candidate has seeded amount factor `a` in [0.75,1.25]. At intensity `i`:

- `extraVolume = A * W * 2.5 * a * i` (mm³).
- `dwellSeconds = extraVolume / (Q * flowMultiplier)`.
- During dwell the simulation's nozzle speed is zero; flow is the previously
  resolved nominal Q. There is no division by instantaneous zero speed.

Higher intensity increases volume and duration, not candidate count. Higher nominal
feedrate reduces dwell duration for the same volume. Intensity zero emits no events,
added meshes or timing changes. No stationary-extrusion capability is asserted for
the physical Delta WASP extruder. These are additional **simulation** instructions,
not executable machine commands or G-code.

`Playback` accepts an optional timing adapter. For Bulges the simulation clock
alternates motion and dwell intervals, mapping back onto the unchanged path clock.
The base bead/nozzle remains at the event position during dwell. Added geometry
appears only then and grows with cube-root progress, giving linear gross mesh-volume
growth. No full mesh reconstruction happens each frame; precomputed local meshes
are scaled about the deposition point. After dwell the original motion resumes.
Pause, resume, reset and comparison retain the same event sequence and time.

## Calibration 1.0.0

Only the shipped calibration is accepted in this milestone; no UI calibration sliders.

| Setting | Value |
| --- | --- |
| Arc-length candidate cell | 40 mm (at least one cell per contour) |
| Active-layer probability | 0.45, deterministic LCG from failure seed |
| Candidate location | Seeded 20–80% position inside each equal arc cell |
| Seam guard | 2 bead widths at either contour end |
| Extra-volume reference | 2.5 bead widths of nominal extrusion × seeded amount × intensity |
| Flow multiplier | 1 |
| Lobe tangent aspect | 1.4 |
| Vertical semi-axis | 0.45 bead height |
| Asymmetry | 0.18 longitudinal skew; centre shifted -0.35 tangent / +0.25 outward axes |
| Limits | 4,000 events; total triangle budget equivalent to 200,000 existing bead moves |

Candidates interpolate real deposition-chord arclength; each event records layer,
source move, contour arc position, XYZ, local tangent, source-path time, dwell start/
end, flow, extra volume and stable ID. Travel and layer transitions never host events.
No corner/seam detection or angular placement is used. Locations are stable across
positive intensities. Event records can later feed context-aware placement.

## Geometry and accounting

The added geometry is a flattened asymmetric closed lobe oriented along the local
path tangent. Its origin lies inside both the lobe and the original depositing bead;
tests check containment against the emitted triangles. Geometry is localized and
attached, with no edits to the vessel silhouette outside event neighbourhoods.
The lobe has smooth tapered edges, but it is an overlapping mesh rather than a
boolean-welded or mechanically spread bead junction. This is a foundation limitation.

The closed mesh's signed-triangle volume is measured, and horizontal dimensions are
resolved so its **gross** volume matches the event's simulated extra volume. The
same approved clay material and lighting are used. Every visible added mesh has
exactly one deposition event. Vertices and all intermediate growth scales remain
inside the cylindrical machine envelope and configured margin, or generation rejects.

Accounting separates nominal extrusion estimate, simulated extra-command volume,
and predicted gross added-mesh volume. **Gross volume includes overlap with the base
bead; net union volume is not known.** Do not interpret it as measured additional clay
outside the original surface. Maximum local thickening is the transverse union-width
estimate versus nominal bead width, not a global vessel-radius change.

## Controlled metrics

Cylinder H20/R15 mm, W2/H1 mm, geometry seed 123, failure seed 51, feedrate 600 mm/min.
Nominal volume estimate: 2990.187 mm³. Positive intensities affect the same seven layers.

| Intensity | Events | Extra mm³ | Mean/event mm³ | Max/event mm³ | Dwell s | Max thickening mm |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 0.25 | 14 | 25.845 | 1.846 | 2.445 | 1.645 | 0.232 |
| 0.5 | 14 | 51.690 | 3.692 | 4.890 | 3.291 | 0.790 |
| 0.75 | 14 | 77.534 | 5.538 | 7.335 | 4.936 | 1.417 |
| 1 | 14 | 103.379 | 7.384 | 9.779 | 6.581 | 1.946 |

The gross mesh totals agree with simulated event volumes within 0.0001 mm³.

## UI, compatibility and verification

Manual Test reuses the existing controls with a Gaps / Bulges selector. Bulges exposes
only intensity, seed and Apply/Regenerate. Successful application replaces any prior
Gaps result, and vice versa; operators are never composed. Schedule mode continues
to use the unchanged Gaps pipeline. Schedule-driven Bulges is deferred to 3B.4.
Export Parameters adds a separate Bulges record with events, timing and measurements.
Canonical geometry exports remain unchanged.

Geometry Schema 1.1.0, Generator 1.1.1, Failure Schedule 1.0.0, the Ø200×H400 machine
envelope, default 5 mm margin and separate Ø200 mm plate are preserved. No Gaps
operator or support algorithm was refactored. Prior uncommitted milestone files
were retained. Baseline verification passed 125 tests before implementation.

Run `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run verify:browser`, and
`node scripts/compare-bulges.mjs`. Automated verification passes 136 tests, including
all nine base/modifier combinations, deterministic events/meshes, monotonic volume,
nozzle position during dwell, material containment, event-time visibility, pause/reset,
machine rejection and existing Gaps regressions. TypeScript and production build pass.
The existing bundle-size warning remains (804.29 kB minified JavaScript).

The comparison script generates fixed-camera Cylinder, Bulbous and Twisted prints at
0/0.5/1 in `artifacts/bulges-{family}-{intensity}.png`, plus `bulges-dwell-close.png`.
All five intensity records for each shape are in `artifacts/bulges-metrics.json`.
Browser regression also checks actual UI playback, original/derived comparison,
reset and quantitative export, and captures `artifacts/bulges-ui.png`.
Chromium/WebGL regression passed, including existing Gaps Schedule pixel equivalence.
The Schedule readiness test now permits 30 seconds for the unchanged support solver;
its former five-second wait timed out during the first browser run.

Changed files: `src/bulges.ts`, `src/playback.ts`, `src/App.tsx`, `src/ClayScene.tsx`,
`tests/bulges.test.mjs`, `scripts/compare-bulges.mjs`, `scripts/verify-browser.mjs`,
this document and the README milestone link.

## Limits and recommendation for 3B.2

No independent extruder calibration, boolean union volume, pressure dynamics,
interlayer interaction, contact compression or gravity spreading is modeled.
The added lobe remains distinguishable at its intersection with the normal bead.
Envelope compliance does not establish physical printability or nozzle clearance.
High intensity reports that risk explicitly in exported diagnostics.

For 3B.2, first improve continuous bead-to-accumulation junctions and net-volume
accounting using these fixed events; preserve this milestone's timing and volume
regression fixtures. Calibrate against actual dwell/deposition observations before
claiming physical fidelity. No 3B.2 implementation is included here.
