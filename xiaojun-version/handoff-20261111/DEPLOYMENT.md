# Xiaojun Milestone 3E deployment — 2026-11-11

- Public URL: https://gfyh.fun/xiaojun-version/
- Source snapshot: `Prototype-B-Handoff/` in this directory, extracted from the supplied ZIP without application-source edits.
- ZIP SHA-256: `3a2a42ad7586120287379b4c0ff76eca8237334d70a9f13a2e6e709dc1106f52`.
- Build: Node.js 24; `npm ci --ignore-scripts --no-audit --no-fund`, then `npm run build -- --base=/xiaojun-version/`.
- Published entry SHA-256: `11198e17f2aa2b4e5cd78d7093195cd93dbb07b54fa50690351c41c520b1a0ec`.
- New JavaScript: `assets/index-ClOx6zKB.js` (SHA-256 `e186bcb51fcb297e97fd323cee11db7570c17a082f2e9b41d68af45fde1e2b7b`).

## Hosting and rollback

The public gateway remains forwarding-only. No application files were uploaded to it and no gateway configuration was changed in this update.

Existing chain: gateway Nginx `/xiaojun-version/` → gateway loopback `15175` → SSH reverse tunnel → HPC2 `mgmt-5`, account `zli760`, loopback `5191`.

HPC2 paths under `/hpc2hdd/home/zli760/work/uncontrolled-pottery/`:

- Live files: `xiaojun-public-20261110/xiaojun-version/`.
- Immutable new release copy: `xiaojun-releases-20261111/milestone-3e/`.
- Previous release backup: `xiaojun-releases-20261111/previous/`.
- Logs: `xiaojun-public-20261110/server.log` and `xiaojun-public-20261110/tunnel.log`.

Service PID `115294`, tunnel PID `115295` were confirmed before deployment. Existing tmux sessions `xiaojun-public-20261110` and `xiaojun-tunnel-20261110` were reused; neither was restarted. They retry after process exits but are not configured to recover after a node reboot.

New hashed assets were installed first and `index.html` was switched by same-directory rename. Old hashed assets remain available for already-open clients. Rollback can restore the backed-up `previous/index.html` using the same temporary-file-and-rename method after checking the live version; no Nginx or tunnel change is needed.

## Verification

- Production build and TypeScript build: passed; Vite emitted its >500 kB JavaScript advisory (new bundle about 827.5 kB).
- Automated tests: 171 passed, 0 failed.
- Supplied executable demo: Stable, Gaps, Bulges, Combined Offsets and Expressive Sagging passed.
- Supplied full browser script: did NOT pass. It timed out at `scripts/verify-browser.mjs:233`, waiting for a disabled Resume button in the Gaps case. The cause was not established; do not report this suite as passing.
- Separate targeted browser checks passed against both the local production preview and the public URL: Gaps, Bulges, Combined Offsets and Expressive Sagging generation, play, pause, original/derived comparison, resume and reset; Expressive Sagging also completed. No browser or failed-resource errors were observed. Completed screenshots were visually inspected.
- Public entry matched the new local build byte-for-byte. New and old JavaScript assets and shared CSS returned HTTP 200.
- `/pottery/` returned HTTP 200 and its entry was byte-for-byte unchanged by this deployment.

## Main differences from the previous upload

- Bulges: timed nozzle dwells and progressive inward/outward bead swelling.
- Layer Offsets: sudden shifts, local misalignment and combined mode, with connected retimed executed paths.
- Sagging: reactive, expressive and combined modes, including deliberate path deviations and hanging clay loops.
- Richer parameter export for events, timing, material metrics and executed paths; expanded tests and handoff examples.

These are independent manual operators, not arbitrary composition of all four behaviours. External Failure Schedule execution still supports only stable/Gaps assignments. Material response remains a geometric heuristic, not validated clay physics. The update does not establish that the previously reported nozzle smoothness concern is fixed.
