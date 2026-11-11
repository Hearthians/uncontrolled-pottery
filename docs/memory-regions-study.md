# Memory regions — one-dimensional baseline

Open `/?lab=memory-comparison` in the local studio. This earlier study is a static comparison of four
memory-driven works and one continuous-supply control. There are no gesture inputs,
parameter sliders, emotion labels, or automatic model-service calls in this study.

The current single-vessel work is at `/?lab=memory-topography` and
`/?lab=memory-regions`; see [Memory topography](memory-topography.md). It clusters
the full embeddings, then uses group counts and internal diversity to encode one
vessel. The PCA coordinates and coordinate-to-interruption decoder below belong
only to this earlier comparison.

## Reproduce

```sh
npm run study:regions
npm test
npm run build
npm run verify:regions
npm run dev
```

The offline generator reads only `output_1.json` inside the existing
`embeddings_lab_updated.zip`. Its 1,910 text embeddings have 3,072 dimensions; the
archive's generation script identifies `text-embedding-3-large`. Every source text,
after trimming, must match `public/memories.json` at the same index. No new embedding
request is made. Names, raw vectors, credentials, and other archive contents are not
copied to the browser bundle. The generated `public/memory-regions.json` contains
coordinates, membership indices, representative indices, method metadata, and a
SHA-256 binding to the exact public text file. Loading fails if that binding changes.

## Projection and groups

Each original embedding is L2-normalized; the centered vectors are projected onto
their first principal component. The loading with greatest absolute magnitude is
made positive to pin the arbitrary sign. Power iteration must converge with a small
relative eigenvector residual. All coordinates share one corpus-wide min/max scale.

Dynamic programming minimizes the within-region squared error for four contiguous
intervals on that line. Four is a prototype choice, not a discovered number of
semantic categories. Identical coordinates are never separated to fill a quota.
The generated regions retain original corpus order internally, not coordinate order.
Corpus order is a reproducible composition, not a collective chronology.

Initial results:

| Region | Memories | Coordinate span | Mean pairwise cosine in original vector space |
| --- | ---: | --- | ---: |
| R01 | 391 | 0.000–0.282 | 0.273 |
| R02 | 505 | 0.283–0.467 | 0.183 |
| R03 | 601 | 0.469–0.648 | 0.163 |
| R04 | 413 | 0.649–1.000 | 0.233 |

The first component retains **4.22% of vector variance**. This is not semantic
accuracy. Global mean pairwise cosine is 0.171; R03 is less cohesive than that
baseline. Central examples at the extremes include outdoor trips and exam setbacks,
but these examples do not establish exhaustive themes. The page shows the three
members nearest each group's centroid in the original normalized embedding space,
so readers can inspect evidence without preassigned labels. All texts remain
available in the original corpus; group membership is in the downloadable record.

## Decoder and fixed geometry

The existing circular path is fixed: 100 mm diameter, 64 turns, 6 mm nozzle, same
material profile, v3 strand simulation, and Seed 42 for all five works. The first two
layers form a shared continuous foundation. Every group member receives equal
coverage of the active path after that foundation and before the supply stop.
The final layer's shorter active interval is included explicitly; the runout never
silently consumes the final memories' intended coverage. Each layer averages its
overlapping memory coordinates using exact interval weights.

For layer coordinate `s(h)`, the authored decoder is:

```text
interruption(h) = round(90 * s(h)^2)
fluctuation(h) = 0
```

There is no per-group renormalization or separate decoder fit. Higher coordinates
receive higher interruption commands by design, not because they are more negative.
The simulator converts commands into seeded interruptions, pressure response,
remaining flow, deposition, and deformation. The command is not a gap probability,
percentage of wall missing, or measured physical flow. The visual baseline uses zero
interruption throughout. Geometry and material parameters do not depend on memory.

Each sample also reports the fraction of missing-deposition path samples during the
memory-bearing active interval. This excludes the foundation and shared runout, and
is not a projected hole-area fraction. Curves use the same vertical range across
works. Static thumbnails use the same camera and lighting, with orbit controls off.

The first verified run produced missing-deposition sample fractions of 0.07%, 1.16%,
6.31%, and 22.53% for R01–R04; the continuous-supply control measured 0%. This checks
that the fixed decoder changes deposition in the current simulator. It does not
validate the semantic interpretation of the axis or predict physical gap areas.

This closes the experimental mapping loop, not the semantic or fabrication
validation. The low retained variance and mixed middle group are reasons to inspect
another projection before interpreting the four regions as meaningful categories.
The v3 material solver remains an uncalibrated browser prototype.

Browser verification writes desktop/mobile images and a numerical report under
`artifacts/memory-regions/`, including missing-file and mismatched-corpus checks and
the `/pottery/` build base. This local study is not a production deployment.
