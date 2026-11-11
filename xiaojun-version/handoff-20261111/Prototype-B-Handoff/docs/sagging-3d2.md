# Milestone 3D.2 — Dual-mode Sagging

## Gravity refinement in calibration 1.3.0

Expressive strands now use a catenary, the equilibrium curve of a hanging
line under its own weight. The model uses bead width as a tension scale and
intensity times measured support loss as a relative weight. The unsupported
span determines the depth, with a shallow-curve limit for very small loads.
The outer 15% of the curve at each end tapers into the adjoining clay.
Contact, bed and slope limits still apply. Expressive chords can settle to
at most 1.15 times their executed length, a local wet-stretch allowance.

The nozzle now moves outward by up to 1.55 bead widths, scaled by the square
root of intensity. This keeps the full-intensity strands closer to the wall
while letting midrange events clear the support footprint. Lift is capped
at 0.45 bead heights times intensity. Playback follows the executed commands
and progressively renders the clay below them.

For the 20-layer fixtures at intensity 1 and seed 42:

| Vessel | Peak outward offset, before → after | Peak clay drop, before → after |
| --- | ---: | ---: |
| Tapered | 4.469 → 3.079 mm | 2.984 → 3.473 mm |
| Bulbous | 4.479 → 3.086 mm | 3.095 → 3.473 mm |

Run `node scripts/compare-sagging.mjs --gravity` for matched renders at
intensities 0.5 and 1. These are geometric approximations for wet clay. The
load, tension and stretch settings are heuristic and lack hardware calibration.
The sections below document the original 1.2.0 settings and measurements.

In Manual Test, choose **Sagging** and select Reactive, Expressive or Combined.
Expressive is the studio default. For a repeatable demonstration, use a cylinder
with sculptural intensity 0, height 20 mm, centreline radius 15 mm, and failure
seed 42. The measured fixture uses 1 mm layers, a 2 mm bead and 600 mm/min.

## How the modes work

**Reactive** keeps the nominal nozzle commands. The contact grid samples the clay
settled on earlier layers. Weak neighbouring chords form spans, with downward
response scaled by support deficiency, span length and intensity. Two supported
shoulders allow a rounded droop. A span with one supported shoulder biases its
profile toward the weak end while tapering back to the connected contour. The
current vessel paths are closed, so that taper represents a dangling tendency
within a continuous bead rather than a separately fabricated free end.

**Expressive** selects deliberate extrusion windows with supported shoulders.
It preserves the bottom quarter and at least the first three layers, reserves
the final layer, and chooses at most one window per height slot. Nearby events
share a seeded heading and stay at least three layers apart. A squared-sine
nozzle deviation moves out and slightly up, then returns to the original path
through the same sequence of connected deposition moves. The support solver
measures the resulting deficit, then settles the continuous bead into a rounded
U below the executed nozzle trajectory. The existing sweep renders each bead
progressively during extrusion.

**Combined** first measures the natural response to reserve reactive spans and
their shoulders. Expressive placement searches the remaining anchored windows.
One final layer-ordered pass solves material contact on the executed commands.
Each region receives either an expressive profile or a reactive profile. Later
layers sample the same settled material state, which can introduce reactive
deficits above an expressive event. Endpoint contributions use a maximum rather
than adding two drop profiles.

## Intensity and recorded quantities

Zero intensity uses the stable path and surface in all modes. Reactive increases
the coverage cutoff, the seeded share of eligible spans and proposed depth.
Expressive requests `1 + floor(2 × intensity) + floor(layerCount / 40)` windows,
capped at six and by the available layer slots. Its half-span grows from three
toward 5.5 bead widths. Peak XY and Z deviations scale with intensity up to
2.25 bead widths and 0.55 bead heights, respectively. Proposed depth scales with
intensity, measured support deficiency, arc length and a 3.5-bead-height cap.
Anchors, stretch, contact, machine clearance and the slope bound limit the result.
Placement rejection counts appear in Export Parameters if a window cannot fit.

The event record includes the start XYZ and move index, layer and interval,
nominal length, executed length, added command length, settled centreline length,
outward displacement, lift, target and realized drop, anchors and deterministic
event seed. The UI counts a hanging loop when an expressive event settles at least
half a bead height. Command lengths and settled lengths are geometric measures.
The existing extrusion flag and constant bead cross-section model approximate
material delivery along the longer executed path. The solver does not conserve
the exact clay volume when settling stretches the strand further. On the cylinder
at intensity 1, each event adds about 5.253 mm of commanded extrusion path and
settling increases the centreline length by approximately another 0.95 mm.

The nominal path identifies the sliced vessel. The executed path provides XYZ,
feedrate, timing and extrusion flags to playback and Export Parameters. The clay
buffer uses per-endpoint drops from that path. Where paths differ, the export also
includes `nominalToolpath`. The project exports JSON commands and has no G-code or
flow calibration for these events. Fabrication and nozzle-body collision clearance
remain unverified. Extreme geometry can exhaust the available anchored windows.

## Reproducible results

These results use seed 42. All cases have twenty 1 mm layers.

| Fixture and mode | Intensity | Reactive regions | Expressive events | Loops | Max drop |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cylinder, Expressive | 0 | 0 | 0 | 0 | 0 mm |
| Cylinder, Expressive | 0.5 | 0 | 2 | 2 | 1.378 mm |
| Cylinder, Expressive | 1 | 0 | 3 | 3 | 3.039 mm |
| Strong twisted overhang, Reactive | 1 | 68 | 0 | 0 | 2.477 mm |
| Twisted bulbous, Combined | 1 | 6 | 2 | 2 | 3.020 mm |

The supported cylinder in Reactive mode remains identical to stable printing.
The strong overhang also produces two connected reactive hanging spans. Run
`node scripts/compare-sagging.mjs --dual` for six matched renders and exact
metrics in `artifacts/sagging-dual-comparison.png` and `artifacts/sagging-dual-metrics.json`.

## Changed files and freeze boundary

- `src/saggingInstability.ts` schedules anchored windows and builds the executed commands.
- `src/sagging.ts` selects the mode and produces the event records and material state.
- `src/support.ts` supplies the shared contact pass and one-sided profile option.
- `src/App.tsx` provides the mode selector, diagnostics and export fields.
- `tests/sagging.test.mjs`, `scripts/verify-browser.mjs`, `scripts/compare-sagging.mjs`
  and `scripts/fixtures/sagging.mjs` cover the geometry, export and playback fixtures.

Manual Sagging calibration 1.2.0 is the handoff boundary. The prior boolean API
continues to select 3D.1 activation or reactive-only behaviour for existing callers.
Schedule execution and composition with Gaps, Bulges and Layer Offsets remain
separate integration work.

Verification passed all 171 automated tests, the TypeScript production build,
the six matched WebGL renders, and the production Chromium regression. The browser
suite exercised all three Sagging modes, progressive playback, executed-path export,
comparison, regeneration and the existing Gaps, Bulges and Layer Offsets flows.
The initial Combined fixture assertion assumed an isolated reactive drop before
expressive deposition. The final regression checks natural overhang and Combined
support changes on separate fixtures. No lint script is configured.
