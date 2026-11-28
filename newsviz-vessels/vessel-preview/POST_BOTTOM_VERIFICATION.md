# v1.1 verification

**Verdict.** The standalone package accepts normalized country-year records and renders the corresponding digital vessel. Physical printability remains unverified.

| Check | Result |
|---|---|
| Provenance | Original hollow mapping checkpoint `0f4992026c9fddbee4b8f94aef775e0d0fa64b56`, plus the subsequent solid-bottom working implementation. The handoff has its own independent Git checkpoint. |
| Frozen calibration | SHA-256 `7ad42421291f0f155a89f88c70308fe82651f122d004dedc59c8c1041fffed85`. Browser tests exercised all eight saves, import, reload and byte-identical export. |
| Deposited bottom | Exactly three stable 1 mm courses. Each has 26 concentric infill tracks followed by the perimeter. Transfers turn extrusion off. Tests sampled 720 radial directions per course. |
| Wall and rim | Layer 4 returns to a hollow perimeter. No subsequent layer has infill. The top stays open at 100 mm. Failure scores and manual overrides apply only to layers 4–100. |
| Reproducibility | Thirteen score trials and nine rendered specimens matched the post-bottom numerical and visual fixtures. The staggered grammar, score thresholds and endpoint calibration were preserved. |
| Views | Production browser checks passed for Full Vase, orbit below the bed, section views of layers 1–4, event inspection, saved controls, invalid input and mobile layout. |
| Installation | Fresh lockfile installation with Node 26.13.0, npm 12.2.0 and local Chrome. npm reported a blocked optional installation step for esbuild's postinstall script under its script policy. TypeScript and Vite completed successfully. |
| Test suites | Original workspace 80/80 and build passed. Isolated package 71/71 and build passed. Nine tests for excluded machine/G-code experiments stayed in the development workspace. |
| Sample | The dev server accepted the supplied sample through the actual import and dataset controls. All five classes appeared in the expected ranges and the WebGL index count matched the independently generated plan. |

The original [mapping report](docs/MAPPING_FREEZE_V1.md) and [hollow reference measurements](docs/mapping-freeze-v1/measurements.json) are historical evidence. Adding clay to the base and reallocating 97 wall courses changes total volume and event counts. The current verifier reads [post-bottom measurements and matching images](docs/mapping-solid-base-v1/measurements.json). Both reference sets are included deliberately.

**Packaging correction.** A mobile playback-controls overflow in the retained calibration route failed the first standalone browser run. Restoring the working project's existing narrow-screen flex-wrap rule resolved it. The production build and full route browser check passed on rerun. The handoff uses the pre-machine calibration route and its matching tests. No geometry or simulation changes were required.

**Interpretation.** Misalignment High is denser and peaks near 1.55 mm, compared with 2.32 mm at Low. Support-aware sag is a digital approximation. Pneumatic timing, physical support, bonding and executable Delta WASP G-code still require separate validation.
