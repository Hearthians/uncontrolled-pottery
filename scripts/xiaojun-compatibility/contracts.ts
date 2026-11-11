import type { GeometryResult as PreviousGeometry } from '../../xiaojun-version/GrammarofFailure_PrototypeB_v1/src/geometry.ts';
import type { GeometryResult as HandoffGeometry } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/geometry.ts';
import { simulateSagging } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/sagging.ts';
import { simulateBulges } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/bulges.ts';
import { simulateOffsets } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/offsets.ts';

// Compile-only proof of the cross-snapshot structural boundary. No app imports change.
export function checkBoundary(previous: PreviousGeometry, latest: HandoffGeometry) {
  const forward: HandoffGeometry = previous;
  const backward: PreviousGeometry = latest;
  return { forward, backward,
    sagging: () => simulateSagging(previous, 1, 42, 'reactive'),
    bulges: () => simulateBulges(previous, 0.7, 42),
    offsets: () => simulateOffsets(previous, 'combined', 0.7, 42),
  };
}
