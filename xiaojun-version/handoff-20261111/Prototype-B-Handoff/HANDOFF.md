# Prototype B handoff — Milestone 3E

Grammar of Failure is a React, TypeScript and Three.js studio for exploring
clay-printing behaviours. The reviewed working tree supports Stable printing
and four independent manual behaviours. Use this guide for the current
application and [the shared geometry and schedule contract](docs/team-handoff.md)
for the teammate JSON boundary.

## Install and run

Extract `Prototype-B-Handoff.zip` and open a terminal in the
`Prototype-B-Handoff` folder, where `package.json` lives. Use Node.js 24.
The review used Node 24.19.0 and npm 12.2.0. Run:

```sh
npm ci
npm run dev
```

Open the local Vite URL printed in the terminal. The lockfile resolves
dependencies from the public npm registry. For verification, run:

```sh
npm run build
npx --no-install tsc --noEmit
npm test
node examples/handoff/prototype-b-demo.mjs
npm run verify:browser
```

The browser check uses the built files and an installed Chromium browser.
Set `BROWSER_PATH` to its executable if automatic detection fails, or
install Playwright Chromium with `npx playwright install chromium`.
The project has no lint script.

## Data flow and ownership

1. `src/shapes.ts`, `src/geometry.ts` and `src/toolpath.ts` resolve the
   shape recipe, sample horizontal contours, and produce the validated
   canonical geometry and nominal nozzle commands. The geometry engine
   is independent of Three.js.
2. `src/App.tsx` selects one operator and replaces the prior derived result
   only after generation succeeds. The canonical source stays available
   for comparison and export.
3. Operators resolve executed moves, timing and/or material. `src/claySurface.ts`
   builds bead buffers from the moves and optional material displacements.
   `src/support.ts` and `src/supportContact.ts` provide the sampled clay
   support model used by Gaps and Sagging.
4. `src/playback.ts` samples the executed moves or the Bulges dwell timeline.
   `src/ClayScene.tsx` moves the nozzle, draws finished beads and interpolates
   the current bead using the same material rules.
5. `src/serialization.ts` handles canonical JSON. `src/App.tsx` assembles
   the separate study export from the active result.

Coordinates use mm and Z-up. The studio defaults to 1 mm slicing and a
2 mm bead. Layer count follows physical height and the final layer can be
thinner. The pale Ø200 mm reference plate comes from `src/buildPlate.ts`,
with its top at Z=0. `src/machine.ts` checks the Ø200 × H400 mm cylindrical
envelope with a default 5 mm side and top safety margin. Display framing
changes the camera. Plate geometry stays outside the toolpaths.

## Operators and demo

In the studio, choose Cylinder, Soft Organic Folded, shape seed 123 and
sculptural intensity 0. Set height to 20 mm, centreline radius to 15 mm and
feedrate to 600 mm/min. Use the studio defaults for layer and bead dimensions.
Click **Apply and Reset**, select **Fit Vessel**, and use **Manual Test**
with failure seed 42. Apply the selected behaviour, then Play. Reset before
replaying. The [executable demo recipe](examples/handoff/prototype-b-demo.mjs)
runs the same settings twice per scenario and checks the path, material
buffers, identity, envelope, and playback completion.

| Scenario and demo input | Nozzle commands and material output | Verified demo result |
| --- | --- | --- |
| Stable. Select Gaps with Enable Gaps unchecked and apply. | Nominal commands and original bead sweep. | 20 layers, 0 events |
| Gaps. Enable Gaps, intensity 0.7. `gapsSimulation.ts` / `gaps.ts` | A validated schedule and explicit failure seed produce split moves with extrusion interruptions. Residue and support can also change clay. | 212 interruptions |
| Bulges. Intensity 0.5. `bulges.ts` / `beadSwelling.ts` | Intensity and seed produce dwell instructions on the same nominal XYZ path and bidirectional bead swelling. | 22 dwells |
| Layer Offsets. Combined, intensity 0.7. `offsets.ts` | Mode, intensity and seed translate selected layers, retime moves and insert non-extruding travel at changed alignments. Clay follows the executed path. | 1 sudden shift and 1 local band |
| Sagging. Expressive, intensity 1. `sagging.ts` / `saggingInstability.ts` | Mode, intensity and seed can produce deliberate nozzle deviations and clay that settles beneath them. Reactive uses nominal commands and changes clay only. | 3 expressive events and 3 hanging loops |

The shape seed and failure seed are separate unsigned 32-bit values.
Keep geometry, mode, intensity, calibration and seed fixed to regenerate
a case. The baseline recipe produces contours centred at Z=0.5 through
19.5 mm. The regression suite also exercises 35 mm slicing, fractional
top layers, stable shape edits, envelope rejection and the fixed plate.

## Export and integration boundary

| Studio action | What the file contains |
| --- | --- |
| Export Geometry Manifest | Canonical geometry identity, resolved recipe and layer metadata. |
| Export / Import Full Geometry | Canonical recipe, validation and ordered XYZ contours. Import regenerates and checks the recipe before replacing the accepted geometry. |
| Export Parameters → `contour-study.json` | Active study metadata. Gaps includes its schedule, events and support data. Bulges includes dwells and metrics. Offsets and Sagging include the executed `toolpath`. Sagging also includes `nominalToolpath` when it differs. |

Parameter export is a diagnostic JSON record. Gaps and Bulges currently
require their simulation APIs to reconstruct the full executed command
stream. Geometry exports always describe the source vessel. The project
has no G-code generator or hardware print verification.

Manual mode runs one operator at a time. Offsets Combined means sudden
shift plus temporary misalignment. Sagging Combined means reactive plus
expressive response, settled once on the executed path. The modes do not
compose Gaps, Bulges, Offsets and Sagging with one another. Failure
Schedule v1.0.0 can describe other types, but the current executor supports
Gaps and stable assignments. Unsupported assignments are rejected.

## Teammate next steps

1. Use the exported manifest as the input contract. Match geometry ID,
   schema 1.1.0 and generator 1.1.1. Emit Schedule v1.0.0 and validate it
   with `src/failureSchedule.ts`. If the source has 64 bins, use normalized
   height to address real layers. The [handoff fixtures](examples/handoff)
   and `examples/mock-emotion-mapping.ts` demonstrate the mapping.
2. Keep mapping seed as provenance and pass the separate failure seed
   when simulating. Start with Gaps to verify the complete JSON round-trip.
3. Agree on a shared executed-path, timing and material result before
   extending schedule dispatch. Specify behaviour order and ownership of
   gravity so a composed run cannot settle the same bead twice. Treat G-code
   and hardware checks as separate work.
4. Use this ZIP as the source snapshot. It includes the working-tree
   operator files and fixtures added after base commit `c75327f`. For
   integration, copy the reviewed changes into a separate workspace or
   branch in your own project and rerun the verification commands.

## Known limitations

Clay response uses geometric heuristics. Contact, flow, and machine or
nozzle collision behaviour require physical validation. Tight clearance
can reduce effects or leave no expressive window. The production build
reports a bundle size advisory. The recipient installs dependencies from
`package-lock.json` with `npm ci` after extraction.

## 3E verification

The production build and standalone TypeScript check passed. All 171
automated tests and all five demo smoke cases passed. The production
Chromium run covered manual Gaps and schedule equivalence, Bulges,
all Offsets and Sagging modes, seed regeneration, playback and reset,
camera framing, canonical import and export, and derived-path export.
No runnable check failed. Vite reported a minified JavaScript bundle of
about 828 kB, above its advisory threshold.
