# Gaps support correction — gravity and contact 1.2.0

## Diagnosis

Support 1.1.0 explicitly set `omitted` for long spans and unanchored fragments.
The renderer correctly excluded those beads; the contact index then excluded them
from the next layer's support. This cascaded upwards. It was algorithmic loss, not
disabled upper extrusion, changed Gaps or an independent rendering bug.

The saved pre-edit baseline is `artifacts/support-gravity-before.json` (including
source, exact command/material hashes and segment states). Per-layer accounting for
off / previous / corrected is in `artifacts/support-gravity-metrics.json`.
For the H20/R15 cylinder, shape seed 123, failure seed 51, full-height intensity 0.5:

| Quantity (mm of extrusion-equivalent length) | Off | Previous | Corrected |
| --- | ---: | ---: | ---: |
| Original intended extrusion | 1903.612 | 1903.612 | 1903.612 |
| Original Gap interruptions | 309.681 | 309.681 | 309.681 |
| Remaining commanded extrusion | 1593.931 | 1593.931 | 1593.931 |
| Predicted material retained | 1593.931 | 318.540 | 1593.931 |
| Support removal | 0 | 1275.391 | 0 |
| Additional renderer omission | 0 | 0 | 0 |
| Gravity-affected input length | 0 | 126.678 | 779.174 |

Accounting also reports deformed centreline length: corrected 1630.283 mm. This
increase is geometric stretching, not additional commanded extrusion. Length
accounting does not assert volume conservation; this is not a rheological model.

## Corrected response

No support warning or low-coverage condition removes geometry. All commanded
extruding segments are retained. No loss or detachment rule is implemented.

The short/medium boundaries remain 0.75 W and 1.75 W (W = bead width). Desired
short-span drop is at most 0.15 H. Medium and long amplitudes use 0.4 and 0.6 times
span length respectively, weighted by missing support coverage. A smooth span
envelope blends into adjacent supported endpoints. The search/deformation reach is
bounded by `4 H + 3 W` and the bed, rather than a sub-layer drop cap. At W2/H1 this
permits 10 mm reach; material beyond reach remains present and uncertain.

`supportContact.ts` accumulates actual predicted top triangles across **all earlier
layers** in an XY spatial index. Queries use spatial intersections, not equal angles
or matching contour indices. Local coverage uses nine footprint probes. Deformation
is additionally limited by projected triangle/triangle overlap: linear clearance is
checked at overlap vertices against earlier material and the bed. Shared ring drops
are decreased conservatively to satisfy these constraints, retaining connected joins.
Limits can make deformation smaller than the desired smooth envelope. Completed
surfaces are checked before publication. Contact relationships include earlier move
and layer IDs, point and clearance; adhesion tolerance is 0.002 mm. The settled
surface is then available to later layers. The 20-million narrow-phase triangle-query
budget, 200,000-move guard and machine-envelope validation remain enforced.

Segments record initial/final coverage, drops, contacts, `materialState` and
`uncertain`. Contact does not imply adequate coverage or mechanical stability:
partially attached material can remain uncertain. The bed is contact ID -1.
Transitions retain their commanded semantics and follow adjacent endpoint drops;
they are not treated as horizontal support beds. Only completed earlier layers
enter the contact index; no future geometry is used.

Geometry Schema 1.1.0, Generator 1.1.1, Failure Schedule 1.0.0, the unified manual/
schedule pipeline, Gap commands and residue calibration are unchanged. Support
calibration advances to 1.2.0, which changes simulation identity through the existing
calibration hash. No public UI redesign, physics dependency or independent Sagging
operator was added. Export Parameters includes per-layer accounting automatically.

## Results and reproduction

| Corrected 20-layer case | Intensity 0.5 | Intensity 1 |
| --- | ---: | ---: |
| Initially unsupported regions | 232 | 307 |
| Gravity-deformed segments | 879 | 1356 |
| Earlier-material contact pairs | 1499 | 1306 |
| Deformed segments contacting earlier material | 405 | 645 |
| Deformed segments contacting >=2 layers below | 39 | 35 |
| Max / mean drop (mm) | 2.000 / 0.1123 | 2.8828 / 0.4916 |
| Remaining uncertain regions | 213 | 300 |
| Explicit material losses / renderer omissions | 0 / 0 | 0 / 0 |

Means are commanded-length-weighted centreline drops. Contact-pair counts include
stable material; gravity-contact counts isolate deformed material. Exact Gap counts
and ratios remain **138 / 16.2681%** and **273 / 32.6209%**, respectively.

Run `node scripts/compare-gravity.mjs` using the retained local baseline JSON. It
compares identical commands, seed, camera and completed playback, and writes twelve
full/close-up screenshots named `support-gravity-{intensity}-{off|previous|revised}-*`.
The 1.1.0 baseline can only be captured with that older calibration; normal tests
and application runtime do not depend on this ignored local artifact.

`examples/gravity-contact.ts` provides a separate controlled 20-layer case: only
layer ID 1 has three 8 mm Gaps, while layer ID 2 extrudes normally. It settles by
1 mm onto layer ID 0. The example records 21 segments with deeper-layer contacts
over the complete print. `gravity-contact-example.json` contains the exact relation
and per-layer accounting. `gravity-contact-{off|corrected}-close.png` displays the
first three layers at the same camera so the attachment is visible; these inspection
views intentionally exclude later occluding layers. Full comparisons include all 20.

Verification: 125 automated tests passed, TypeScript and production build passed.
Chromium/WebGL regressions passed, including manual/schedule pixel equivalence,
pause/resume, rejected imports and completed playback. Fourteen comparison PNGs were generated.
Tests cover deterministic commands/material, no deletion, all nine shape combinations,
spatially offset contact queries, two-layer contact, independent rechecking of
completed collision constraints, continuous joins, partial buffers, and playback.

## Limits

This is a geometric gravity/adhesion approximation, not validated clay mechanics.
There is no force, pressure, friction, volume-conservation, same-layer self-collision
or debris simulation. Clearance constraints are conservative and depend on contour
sampling; partial growing beads interpolate a precomputed completed-layer response.
No deformation is animated after deposition. Surface normals retain the existing
cross-section approximation. The solver runs on the main thread; large cases can
block interaction or hit the existing query budget. The bundle-size warning remains.
