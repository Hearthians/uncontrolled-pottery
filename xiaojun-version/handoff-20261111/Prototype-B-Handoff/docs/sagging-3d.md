# Milestone 3D — Support-aware Sagging

This records the original 3D calibration. See [3D.1 activation and the current freeze](sagging-3d1.md).

Select **Manual Test → Sagging**, choose Failure Intensity and Failure Seed, and
apply the result. For a studio demo, choose Bulbous with Spiral / Twisted,
shape seed 7, sculptural intensity 1, height 20 mm and radius 15 mm. Then apply
Sagging at intensity 1 with failure seed 42.

The studio reports measured sagging regions, maximum drop,
hanging spans and slumps. A supported shape can finish with zero deformation.

## Support and deposition

`simulateSagging(geometry, intensity, seed)` takes a validated canonical geometry.
The nominal path and executed nozzle path share the same XYZ, timing, extrusion
and travel commands. Sagging adds per-move endpoint drops to the deposited clay.
The renderer interpolates those drops on the currently printing bead and reveals
completed beads from the same precomputed material buffers. All commanded clay is
retained. Export Parameters includes the executed path and separate region metrics.

The Gaps support engine samples each bead at three longitudinal positions and
three points across its width. The support factor is the fraction of those samples
with a surface within 0.2 bead heights below them. A spatial grid stores actual
bead surfaces from earlier layers, including their settled drops. Nearby XY
material outside the contact tolerance contributes no support. Adjacent weak
deposition moves form a region, with a smooth taper onto nearby supported chords.

## Intensity and secondary effects

- Intensity zero takes the stable material path directly. Positive intensity raises
  the weak-coverage cutoff from 0.67 toward 0.80. A hash of the first move and failure
  seed admits a fraction of eligible regions, rising from 0.30 toward 1.0.
- A region's proposed depth is intensity times its support deficiency times the
  smaller of 0.4 times its arc length and a bead-height cap. Ordinary droops use a
  cap of 1.5 bead heights and a squared sine profile.
- At intensity 0.75 or above and average coverage at most 0.45, a span 2–6 bead
  widths long with supported shoulders can use a narrower fourth-power sine
  profile and a 3.4-height cap. Up to three such candidates are considered. A
  hanging span is counted only if the realized drop reaches 0.8 bead heights.
- A weak span at least six bead widths long can use a broader slump with a
  2.5-height cap. A slump is counted only if three or more chords deform and the
  realized drop reaches 0.55 bead heights. This brings adjacent beads closer by
  lowering their sweeps while preserving each cross-section.

The shared contact solver limits each drop against earlier bead surfaces and the
build plate. Shared endpoints keep the sweep continuous, and a slope cap of 1.25 mm
per millimetre of chord length limits stretch. The final bead buffer also passes
the cylindrical machine envelope check with the configured safety margin. More
intensity increases the proposed depth and eligibility. Earlier settled layers can
change support for later layers, so realized region counts and contact-limited
depths need not increase at every setting.

## Controlled comparisons

The fixtures use 20 one-millimetre layers, radius 15 mm, geometry seed 123 and
failure seed 42. Their resolved parameters are in the shared comparison fixture.

| Geometry | Intensity | Sagging regions | Maximum drop (mm) | Hanging spans | Slumps |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cylinder | 1 | 0 | 0 | 0 | 0 |
| Twisted bulbous | 0.4 | 32 | 0.548 | 0 | 0 |
| Folded bulbous | 1 | 16 | 1.298 | 0 | 6 |
| Strong twisted overhang | 1 | 64 | 2.485 | 2 | 34 |

Run `node scripts/compare-sagging.mjs` for the matched stable/deformed views in
`artifacts/sagging-comparison.png` and measured values in
`artifacts/sagging-metrics.json`. The strong fixture already has overhang openings
at intensity zero. The comparison shows the additional downward bends and areas
where nearby deposited layers settle closer together.

## Files and handoff

Verification passed all 168 automated tests, `npx tsc --noEmit`, `npm run build`,
and the production Chromium regression. The browser checks cover live deposition,
nozzle position, executed-path export, pause and resume, comparison, regeneration,
zero intensity, and the earlier failure modes. The first browser run timed out
while loading the Sagging test fixture. The passing rerun generated its fixture
through the studio controls and compared the executed path against a zero-intensity
export from the same browser. No lint script is configured. Vite reports its existing
bundle size advisory.

- `src/sagging.ts` defines the versioned operator, seeded response and diagnostics.
- `src/support.ts` provides an optional response policy through the shared contact solver.
- `src/ClayScene.tsx` accepts the per-move displacement interface for progressive clay.
- `src/App.tsx` integrates manual selection, diagnostics and executed path export.
- `tests/sagging.test.mjs` covers stable identity, support-gated deformation, envelope
  limits, deterministic selection, continuous joins and partial bead interpolation.
- `scripts/fixtures/sagging.mjs`, `scripts/compare-sagging.mjs` and
  `scripts/verify-browser.mjs` provide reproducible visual and playback checks.
- `README.md` links this handoff guide.

The standalone v1.0.0 Sagging result is ready to freeze for Prototype B. Schedule execution and
composition with Gaps, Bulges and Layer Offsets are deferred. The Gaps solver already
settles material over missing extrusion, so any future composition must avoid
applying the same drop twice. The nozzle uses the canonical commands for this mode.
Contact is a sampled, vertical geometric approximation. Clamping can create angular
bends, and large gaps may leave hanging beads above the plate. Time-dependent flow,
self-contact and clay adhesion require a separate model and hardware validation.
