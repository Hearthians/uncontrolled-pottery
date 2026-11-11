# Xiaojun source snapshots

This directory keeps two source snapshots as ordinary repository files, so a
fresh clone includes the geometry library required by Memory Topography.
Dependencies, builds, local Git metadata and uploaded ZIP files are not included.

- `GrammarofFailure_PrototypeB_v1/` is the existing working-tree snapshot used by
  `src/topographyForm.ts` and `src/TopographyScene.tsx`. Its original repository
  base is `c75327f`; the snapshot also includes its subsequent local Gaps/support
  work. It is not a pristine copy of that commit.
- `handoff-20261111/Prototype-B-Handoff/` is the supplied Milestone 3E handoff.
  Its new operators have been assessed, but are not substituted into the current
  artwork. The supplied deployment record remains in `handoff-20261111/DEPLOYMENT.md`.

The nested repository metadata in the original local workspace is not needed to
build this project. Neither snapshot is a Git submodule. Upstream changes should
be reviewed explicitly against these snapshots.

See [the compatibility assessment](../docs/xiaojun-compatibility-assessment.md)
for the tested boundaries and integration requirements.
