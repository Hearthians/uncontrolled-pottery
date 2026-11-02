# Deposition lab

The small lab cases remain separate from the v3 pottery solver and its saved records. Open `/?lab=deposition` on the Vite server. The studio now offers an explicitly experimental v4 adaptation on its circular path; neither is a validated replacement for the v3 model or a claim of deployment.

## Three cases

- **One strand:** a 6 mm nozzle travels at 10 mm/s across a 36 mm line. Compare 1.5, 2 and 3 mm nozzle-clearance settings at fixed supply.
- **Three layers:** three aligned passes with the same material law; earlier-pass volume can move under later-pass pressure. All passes share a supported height field, so contact continuity is assumed, not an experimentally demonstrated bond.
- **Stop and restart:** a one-second commanded feed stop with a 0.12 s response while travel continues. Material is deposited continuously as supply decays/recovers, rather than accumulating a reservoir for one sudden thick segment.

The right panel controls experiments only; it does not restore manual creative control to the studio.

## Model and rendering

`src/depositionLab.ts` stores material volume per grid cell on a flat substrate. Pressure is the sum of hydrostatic pressure and a local penalty where material exceeds the moving nozzle clearance. Face-to-face lateral flux uses the shallow-layer Bingham mobility formula, a local pressure-response stabilization and a donor limiter. Every transfer is subtracted from one cell and added to its neighbor. Per-pass volume amounts are advected with the same flux. The fixed time step is 5 ms; default spacing is 0.5 mm. The grid has closed boundaries and the deposition path is kept well away from them.

The nozzle footprint, penalty stiffness, yield stress, viscosity and timing are illustrative. This is not OpenFOAM, MPM, a solved nozzle flow field, or a fitted clay law. Pressure stabilization improves numerical behavior but also affects rate accuracy; passing a mass check does not establish time-step convergence. Under the finite penalty, a deposited ridge can remain taller than the nominal nozzle-clearance setting.

The 3D mesh is the **direct cell-height surface** with computed normals, cropped below a 0.005 mm display threshold. There is no added noise, tube capping, hidden interior meshes, aesthetic smoothing or smooth-union bridge filling. The numerical data table and JSON export include all volume, including material below the display threshold. The plot shows the center column, not an idealized ellipse.

## Observations, not calibration

Default single-pass volume is 432 mm³. At 0.5 mm grid spacing and fixed supply:

| Nominal clearance | Center occupied width (>0.05 mm) | Center peak height |
| --- | --- | --- |
| 1.5 mm | 6 mm | about 2.40 mm |
| 2.0 mm | 5 mm | about 2.62 mm |
| 3.0 mm | 5 mm | about 3.24 mm |

This has the expected direction of greater lateral spreading under more compression, but the absolute values are **not validated**. The apparent width changes by about 1 mm when the single-strand grid is coarsened from 0.5 to 1 mm; peak height changes by a few percent. This is sensitivity evidence, not a convergence study.

The three-pass result still resembles a smooth ridge rather than a realistically layered clay wall. A height field cannot represent an overhang, a closed internal void, multiple vertical interfaces or the side grooves of independently deposited layers accurately. Moving it to a circular path does not remedy these limitations or validate a tall vessel. An appropriate next step remains reference measurements plus a cross-sectional/free-surface method capable of resolving those interfaces.

## Experimental studio integration (V4)

Choose **Physics → Height field · test** before printing, or open `/?physics=heightfield`. The selector is locked while printing or paused and applies to the next print after completion. The original V3 remains the default; selecting a model never converts an existing work. Archives, gallery thumbnails, exports and worker reconstruction dispatch on V4's own record/profile. The same original emotion/supply trajectory drives either model; the default public memories and privately imported text are reading material, not material parameters.

`heightfieldSimulation.ts` adapts the lab algorithm on a 128 × 128 mm, 64 × 64 Cartesian grid (2 mm spacing). Sixteen fixed substeps span each original material tick (about 4.91 ms each). The source follows the original 100 mm spiral, distributes its tracked volume among cells below the nozzle, and uses the same seeded pressure/flow law as V3. Hydrostatic and local nozzle-penalty pressure redistribute material laterally; no strand mesh is used for the clay surface. The fine-grid lab and historical V1–V3 computations are unchanged.

The source assumes instantaneous arrival at the column below the nozzle. As the printed surface falls below the planned spiral height, **there is no simulated free fall, airborne strand or bridge**. The substrate covers the whole square and boundaries are closed; `boundaryVolumeMm3` reports outer-cell material, which would be artificially confined rather than falling off the plate. The mesh uses cell-center heights, so it is a sampled visualization of conservative cell volumes, not an exact watertight volume reconstruction. No synthetic grooves disguise the height-field limitation.

A local stable-supply full run took about 12.4 CPU seconds for 10,480 ticks in Node, with peak height about 47.24 mm, volume balance error about 2.5e-8 mm³ and no boundary accumulation. This is a performance/conservation probe, not browser frame-rate or physical validation. The resulting broad ring is not the planned 123 mm-tall vessel: steep walls violate the shallow-layer approximation. An emotion-driven browser run is checked separately with `npm run verify:heightfield`. The checked 10,240-step browser run produced a 45.95 mm peak and approximately 166,334 mm³ of material for that random seed; the mean live simulation-plus-mesh update was 23.0 ms and its 95th percentile 34.6 ms under software-rendered Chromium. These timings exclude the separate render pass and are not a 60 fps guarantee. The screenshots still show conspicuous grid-aligned vertical facets, not measured clay layer texture. Reports and fictional-memory screenshots are in `artifacts/heightfield-studio-report.json` and `artifacts/heightfield-studio-{desktop,phone}.png`.

## Checks

```sh
node --test tests/deposition-lab.test.mjs
npm run verify:lab
```

Tests cover nonnegative finite amounts, conservation per pass and overall, exact fixed-step replay, nozzle-clearance response, no forced connection through an interruption, and a coarse-grid sensitivity bound. The browser verifier exercises all samples, pause, export, phone/tablet layouts and a dark chart theme; outputs go to `artifacts/clay-lab-*.png` and `artifacts/clay-lab-metrics.json`.

See [wet-clay research references](wet-clay-simulation-references.md) for the physical motivation and limits of transferring results from other paste materials.
