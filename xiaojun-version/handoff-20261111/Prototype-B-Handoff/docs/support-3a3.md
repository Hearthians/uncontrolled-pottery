# Milestone 3A.3 — Support-aware overprinting

Historical 1.0.0 baseline below. The current **1.2.0 support calibration** retains
material with gravity and earlier-layer contact; see [rules, comparisons and limits](gravity-contact.md).

The 3A.2 baseline passed all 96 tests before implementation. Its residue is actual
derived vertex geometry (`beadBuffers` with a residue plan), not a shader effect.
The canonical geometry, gap events, commanded moves and all shared versions remain
unchanged. The work stays on `feat/failure-simulation`.

## API and ownership

```ts
analyzeSupport(path: Toolpath, residue: ResiduePlan,
  sourceGeometryId: string, sourceDerivedId: string, enabled?: boolean): SupportResult
```

`enabled` defaults to true. False performs analysis without modifying predicted bead
positions, for controlled comparisons. The returned frozen result contains source IDs,
calibration, per-source-move segments, unsupported regions, metrics and warnings.
Each segment records layer ID, coverage, lower supporting move IDs, classification and
start/end downward displacement in millimetres. Travel has no material entry.

The optional third `beadBuffers(path, residue, support.segments)` argument produces the
predicted material surface. `writeBead` uses the same profile for partial playback.
No commanded coordinates, feedrates, time intervals or extrusion flags are rewritten.
The head follows the original move sample; the material can lie below it. Export
Parameters includes the support result separately under `failure.support`; canonical
manifest/full geometry imports and exports retain their previous rules.

## Spatial contact and ordered propagation

For each layer, build a spatial XY grid of triangles from the **actual already
computed lower-layer bead surface**, including its tapered residue and support-induced
displacement. Travel intervals contribute no triangles. No original contour is used
as a substitute supporting wall and no angular layer correspondence is assumed.

For each upper deposition segment, evaluate nine footprint samples: three positions
along its chord and three transverse positions at -60%, 0%, +60% of the actual
residue-refined half-width. A vertical barycentric triangle query tests XY containment
and Z contact. Upper bottom Z also comes from the residue-refined surface. Coverage is
the fraction of successful samples. Supporting triangle source move IDs are recorded.
The first layer uses the plate surface as its supporting plane. Horizontal support from
vertical transition beads is conservatively excluded, though those beads remain visible.

Only after that layer's support responses have been computed are its predicted triangles
inserted as the next supporting surface. Upper layers therefore see actual prior drop,
residue and gaps. The grid holds one preceding layer, not all historical layers. This
does not search for contacts several layers below, integrate forces or simulate recovery.

## Internal heuristic calibration v1.0.0

| Setting | Default |
| --- | --- |
| Contact tolerance | +/-0.2 upper bead heights in Z |
| Supported coverage | At least 0.8 (eight of nine samples) |
| Short region | Contiguous unsupported deposited length <=1.5 bead widths |
| Medium region | >1.5 and <=4 bead widths |
| Long region | >4 bead widths; explicit structural-uncertainty warning |
| Maximum short / medium / long response | 0.12 / 0.35 / 0.5 local bead heights |

Response magnitude is the category bound multiplied by (1 - mean region coverage).
A smooth bell-shaped target is sampled at move endpoints. Where available, one
neighboring deposited segment blends back to zero; no blend crosses non-extruding
travel. Free strand ends may move downward. Shared ring displacement is equalized,
including the existing extruding layer transition. Supported material away from these
short blend neighborhoods remains unchanged. The two-ring mesh linearly interpolates
the sampled response; it is continuous but not a high-order elastic beam solution.

Long regions visibly depart from an ideal stable bridge, but their bounded displacement
does not assert a particular collapse mode. No randomness or failure intensity enters
the support response: the same material configuration gives the same prediction.
Increasing gaps need not monotonically increase each individual span's deformation.

## Bounds, diagnostics and playback

The existing input move/topology and machine validators remain mandatory. Predicted
vertices are checked against the same cylindrical machine limits and safety margin.
Downward displacement cannot exceed half a bead height and is zero on the first layer;
XY is unchanged, so the original radial/model bounds are retained. No geometry is
added across a travel interval. Commanded missing deposition is unaffected.

Diagnostics include region count/length, short/medium/long counts, maximum displacement,
affected layer IDs, contact-query count and five move-count coverage bins:
[0,.2), [.2,.4), [.4,.6), [.6,.8), [.8,1]. Region lengths count complete classified
segments and are an approximation to exact unsupported arc length. Coverage measures
support at the intended deposition height **before** applying the current response;
there is no iterative collision/settling solve after downward adjustment.

The 200,000-move limit remains. A 20-million triangle-test budget rejects excessive
work explicitly. Grid cell size is max(1 mm, bead width, layer height), a performance
choice rather than a physical threshold. Analysis is performed once per apply, not
per animation frame. It still runs on the main thread and can briefly block large
models. Final geometry buffers and the pre-existing small partial buffer drive playback.
No material is revealed before its associated depositing move.

## Controlled verification

`node scripts/compare-support.mjs` generates 36 paired full/close PNGs and
`artifacts/support-metrics.json`. It compares Cylinder, Bulbous and Bulbous+Twisted
at intensity 0/.5/1, H20/R15 mm, geometry seed 123, failure seed 51, bead width 2 mm,
layer height 1 mm. Each on/off pair uses identical material, seed, lighting, camera
and close-up target. Full-view framing is shared across all intensities. Close views
target a long detected region and may differ between configurations, never within a pair.

The isolated comparison uses production material/buffer functions; the full application's
browser checks separately cover head, playback, pause/resume, original/derived comparison,
gap permanence and exported support diagnostics. All nine base/modifier combinations
are exercised by automated tests. A twisted case with zero gaps still detects support
loss from spatial misalignment; a continuous cylinder remains exactly unchanged.

Run `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run verify:browser`.

Verified 2026-11-10: 107/107 automated tests, TypeScript, production build and Chromium/
WebGL application regressions passed. All 36 controlled screenshots completed; cylinder
and twisted close-up pairs were visually reviewed. The existing bundle-size warning
remains (789.05 kB minified JS, 217.08 kB gzip). No dependencies were added.

Support-enabled controlled results (all material values are heuristic):

| Shape | Intensity | Gap count | Missing % | Regions | Unsupported mm | Short/medium/long | Max drop mm |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Cylinder | 0 | 0 | 0 | 0 | 0 | 0/0/0 | 0 |
| Cylinder | .5 | 138 | 16.268 | 232 | 848.800 | 125/85/22 | .500 |
| Cylinder | 1 | 273 | 32.621 | 324 | 1032.516 | 152/171/1 | .494 |
| Bulbous | 0 | 0 | 0 | 12 | 1171.832 | 0/0/12 | .167 |
| Bulbous | .5 | 153 | 16.318 | 183 | 1492.325 | 44/80/59 | .499 |
| Bulbous | 1 | 299 | 32.368 | 316 | 1259.756 | 94/220/2 | .497 |
| Twisted | 0 | 0 | 0 | 71 | 1336.800 | 3/5/63 | .471 |
| Twisted | .5 | 154 | 16.234 | 202 | 1480.823 | 58/81/63 | .500 |
| Twisted | 1 | 303 | 32.490 | 321 | 1284.255 | 92/225/4 | .496 |

All nonzero-intensity cases affect layers 1–19. Zero-intensity Bulbous affects 12 layers;
Twisted affects 19, because lateral profile change itself can exceed the conservative
contact threshold. A region can have partial support; "unsupported length" is not wholly
absent material. Higher intensity also removes upper deposition that otherwise would be
counted as unsupported, so unsupported length and long-region count are not monotonic.
`artifacts/support-metrics.json` includes both enabled/disabled measurements, coverage
histograms and query counts. All gap counts/ratios are identical between each on/off pair.

Limitations: sparse footprint sampling, immediate-previous-layer contact only,
conservative exclusion of transition support, coarse bead surfaces/approximate normals,
no volumetric union, self-collision solve, volume conservation, strength, time-dependent
creep or physically calibrated rheology. Model geometry remains bounded, but physical
printability is not established. No standalone sagging operator, other failure operator,
emotion integration or G-code has been added.
