# English Memory Topography preview

Public URL: <https://gfyh.fun/pottery/memory-topography/>

The published build is the English animated single-vessel artwork, updated on
2026-11-11. A nozzle follows one continuous, rising 64-turn path over 56 seconds.
Newly deposited strands bend and settle, with a final 4.38 seconds for settling,
and the completed vessel slowly rotates. Pause and replay control the animation;
reduced-motion preferences default to a static completed work. The four-region
legend, representative memories, mapping explanations, and complete image/data
downloads remain available. Future local changes are not automatically published.

The current `count-diversity-plump-strand-4` build also supports mouse/touch dragging,
wheel/pinch zoom and Reset view. Manual inspection holds the chosen direction;
resetting restores the front view and allows automatic rotation when playing.
The existing bulbous, folded vessel outline is retained. Individual clay strands
keep full, slightly elliptical cross-sections as they bend: fresh semi-axes are
3.4 by 3.1 mm, and settled minor/major axis ratios stay between 0.84 and 0.88.
Animation rotates each whole section and interpolates its two semi-axes, so the
section also remains elliptical between the fresh and settled states. Depth
shadows follow the same deformation. A softer wet surface accompanies the motion.
The geometry checks support around the whole circumference and propagates
sag into upper strands, including the back of the vessel. Genuine data gaps
interrupt the clay flow; the nozzle keeps moving through those gaps and across
turn boundaries. Bounded thickness correction prioritizes full strands and is
not a claim of exact material-volume conservation.

The dedicated build defaults to `memory-topography` through `VITE_DEFAULT_LAB`.
The existing main studio retains its original default and public route.

```sh
npx tsc -b
VITE_DEFAULT_LAB=memory-topography npx vite build --base=/pottery/memory-topography/ --outDir=.runtime/public-memory-topography/next
```

Verify the staged `next` directory using the dedicated base path before publishing.
Keep the prior hashed assets in the staged build for already-open clients. Stop
the dedicated supervisor and wait for port 5196 to close, archive the current
`site` directory, then rename the verified staging directory to `site` and start
the supervisor. The deployment record identifies the retained previous build for
rollback. Do not build directly into the live directory.

```sh
node scripts/public-topography-forward.mjs start
node scripts/public-topography-forward.mjs status
node scripts/public-topography-forward.mjs stop
```

The preview listens on local loopback port 5196. Its SSH reverse tunnel binds
`127.0.0.1:15176` on `gfyh.fun`; a dedicated Nginx location forwards the public path
to that port. The supervisor restarts failed preview/tunnel processes. Availability
depends on the machine running the supervisor remaining online.

Runtime state and logs are under `.runtime/public-memory-topography/`. The gateway
route has already been installed by `scripts/gateway-topography-route.py`, which
checks the expected configuration, creates a backup, tests Nginx configuration,
and reloads it. Routine service starts do not require changing that route.

Animation validation artifacts are in `artifacts/memory-topography/`, including
desktop/mobile screenshots, the comprehensive browser report, staged-build checks,
`animation-deployment.json`, and exact published asset/data hashes in
`public-animation-assets.json`. The prior static English snapshot's checks remain
in `artifacts/memory-topography-en/`. The original `/pottery/` entry retains its
existing bundle. Animation is a geometric presentation, not a calibrated material
simulation or a physical printing instruction sequence.

The follow-up support/viewing release is recorded in `inspection-deployment.json`,
with exact published bytes in `public-inspection-assets.json`. Its browser check
is `public-inspection-verification.json`; front, side and back crops are
`inspection-front.png`, `inspection-side.png` and `inspection-back.png`.

The continuous-nozzle and rounded-strand release is recorded in
`plump-strand-deployment.json`, including the previous build's backup and exact
published file hashes. The current browser report is `verification.json`; visual
inspection includes `wet-strand-final.png` and `wet-strand-detail-final.png`.
Dedicated-default-route checks are in `staged-plump-strand-verification.json`,
the public smoke check is `public-plump-strand-verification.json`, and cross-section
and support measurements are in `plump-strand-metrics.json`.
