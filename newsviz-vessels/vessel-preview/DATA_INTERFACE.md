# Country-year data interface

The annual view accepts one JSON object per vessel. [Synthetic example](sample-annual-data.json)

| Field | Required type and validation |
|---|---|
| country | String with nonempty trimmed value |
| year | JavaScript safe integer |
| items | Array of 1–97 observations |
| items[].id | String, nonempty after trimming and unique within this record after trimming. IDs are case-sensitive. |
| items[].score | Finite JSON number from 0 through 1 inclusive |

There are no optional input fields used by the simulator. The parser retains only the fields above. Numeric strings, null scores, duplicate IDs and missing required values are rejected. An invalid submission shows an error and preserves the previous vessel. Convert raw scores upstream. Define polarity (higher means greater anxiety), scaling, aggregation, weighting and missing-value rules consistently across country-years. Keep provenance and publication dates with the source data.

## Severity Ordering

`readDataset` sorts items by increasing score. Ties preserve supplied order. Country and year identify the specimen. Publication time has no role in layer order. Layers 1–3 always deposit the stable solid base. For zero-based position *i* among *n* sorted items, the inclusive wall range is `4 + floor(97*i/n)` through `3 + floor(97*(i+1)/n)`. A single observation occupies layers 4–100.

| Class | Score | Frozen Low → High (site count, coverage %, amplitude) | Sample layers |
|---|---|---|---|
| Stable | [0, .20) | Continuous 2 mm bead | A · 4–22 |
| Gaps | [.20, .40) | (12,15,1) → (12,40,1), interrupted-span fraction | B · 23–41 |
| Bulging | [.40, .60) | (12,40,2) → (12,40,3.5), deposition multiplier | C · 42–61 |
| Misalignment | [.60, .80) | (8,40,2.5) → (12,40,5), requested XY shift in mm | D · 62–80 |
| Sagging | [.80, 1] | (6,40,3) → (6,40,6.5), unsupported XY offset in mm | E · 81–100 |

Internal cutoffs enter the higher class. For failure bin `b = min(4, floor(5*score))`, the within-bin fraction is `5*score-b`. Each parameter is Low plus that fraction of the difference to High. Event count rounds to the nearest integer. Only the last class reaches its High at an inclusive upper endpoint. Staggered cell placement also depends on score. Support conditions can limit the deposited displacement.

## Generate and reproduce a specimen

1. Open `/annual`. Select **Current controls**, click **Import configuration** and choose [the frozen JSON](prototype-c-staggered-mapping-v1.json). This import restores Manual / Sagging.
2. Select **Data-driven**. Expand **Edit annual dataset**, paste the entire country-year JSON object and click **Apply to vase**.
3. Check the country/year heading and band register. Click a band to inspect its middle layer. **Layer debug** shows event windows and deposited sections for layers 1–4. **Full vase** shows the completed deposit.
4. Retain the exact input JSON, item order for ties, configuration and handoff version. The browser persists the configuration for its origin. Reload restores the built-in synthetic dataset, so reapply your record.

For programmatic integration, import `mapAnnualVase` from [src/annualMapping.ts](src/annualMapping.ts) and call `mapAnnualVase(record, frozenConfig)` with parsed objects. Omit the optional manual override. The result includes validated data, bands, layer render moves, rings and the simulated path. [src/behaviourConfig.ts](src/behaviourConfig.ts) implements validation and interpolation. [src/materialPattern.ts](src/materialPattern.ts) supplies the shared grammar. No server or batch API is required for this entry point.
