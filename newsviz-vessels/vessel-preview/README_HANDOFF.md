# Prototype C · Behaviour simulation v1.1

Use this package to turn one normalized country-year record into a reproducible digital clay vessel. Geometry, slicing, behaviour mapping, deposited-clay simulation and the annual inspection views are complete. Your integration entry point is the annual dataset JSON.

## First run

1. Extract the entire folder. From the folder containing `package.json`, run the following with Node.js 24 or newer and npm installed.

   ```sh
   npm ci
   npm run dev
   ```

2. Open [Annual vase](http://127.0.0.1:5177/annual). Under **Comparison preset**, select **Current controls**. Click **Import configuration**, choose [the frozen mapping](prototype-c-staggered-mapping-v1.json), then click **Data-driven**.
3. Expand **Edit annual dataset**. Paste the contents of [sample-annual-data.json](sample-annual-data.json) and click **Apply to vase**. Expect **Synthetic Demo / 2025** and five bands. The sample is invented to exercise the interface.
4. Click a band to inspect its layer and events. In **Layer debug**, compare layers 3 and 4. In **Full vase**, orbit below the vessel to inspect the concentric base. Reloading restores the built-in example. Reapply the dataset to reproduce the specimen.

## Package map

| Location | Contents |
|---|---|
| `src/config.ts`, `geometry.ts`, `toolpath.ts` under `src/` | Fixed 100 mm twisted geometry, 100 one-millimetre courses, concentric bottom tracks and nozzle moves |
| `src/annualMapping.ts`, `behaviourConfig.ts`, `materialPattern.ts`, `sagFold.ts` under `src/` | Input validation, band assignment, saved ranges, staggered grammar and deposited-clay prediction |
| `src/AnnualVase.tsx`, `src/ClayScene.tsx` and companion controls | Full Vase, Layer Debug and configuration import/export |
| `src/material/`, `calibration/measurements/`, `fixtures/` | Existing calibration views, templates, and test inputs used by the included routes |
| `tests/`, `scripts/`, `docs/` | Regression suite, browser checks and reference measurements/images |
| `package*.json`, `tsconfig.json`, `index.html` | Locked installation, TypeScript configuration and application entry |

[Data contract](DATA_INTERFACE.md) · [Complete file inventory](FILE_INVENTORY.md) · [Post-bottom verification](POST_BOTTOM_VERIFICATION.md) · [Original mapping audit](docs/MAPPING_FREEZE_V1.md)

## Verification commands

```sh
npm test
npm run build
node scripts/verify-annual.mjs
node scripts/verify-frozen-mapping.mjs
```

The last two commands use locally installed Google Chrome and the production build. They start their own local previews. The historical v1 audit describes the earlier hollow geometry. The current verifier reads the separate solid-base fixtures.

## Integration boundary

The interface handles one country-year per submission and sorts observations by severity. Multi-country selection, persistent annual data and chronological comparison remain future work. Start by transforming one real record into the documented schema, record your normalization and aggregation rules, then compare the resulting band register with the source scores.

Misalignment High places more registration events and reaches a smaller peak displacement than Low. Sagging estimates local support and downward clay settlement. Its predicted drop applies only to the deposited clay. Physical printing, pressure calibration and executable G-code remain separate development work. For that work, create a branch such as `feat/wasp-2040-physical-printing` in the development repository. This handoff and ZIP are independent snapshots.
