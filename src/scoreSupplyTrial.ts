import { ClayStrand } from "./plasticSimulation.ts";
import { MATERIAL_PROFILE } from "./materialSimulation.ts";
import {
  SCORE_STUDY, TAU, angleDelta, bell, bodyEnvelope, finishScoreShape,
  makeScoreBase, scoreChannels, seedPhase, type ScoreShape,
} from "./scoreStudyCore.ts";

/**
 * A: change the inlet only; the shared nozzle helix and material stay fixed.
 * The valve schedule is deliberately correlated across neighbouring turns.
 * Pressure and flow lag use the existing pneumatic profile, while the actual
 * deformation is computed by the existing ClayStrand model.
 */
export function generateSupplyShape(score: number, seed: number = SCORE_STUDY.seed): ScoreShape {
  const channels = scoreChannels(score), points = makeScoreBase(seed);
  const scale = MATERIAL_PROFILE.millimetersPerUnit, body = new ClayStrand(() => 0);
  const phase = seedPhase(seed), secondsPerSample = TAU * SCORE_STUDY.radiusMm /
    MATERIAL_PROFILE.speedMmPerSecond / SCORE_STUDY.segments;
  const gapStrength = channels.gaps * (0.7 + 0.3 * score);
  const variation = channels.variation * (0.75 + 0.25 * score);
  const bulging = channels.bulges * (0.65 + 0.35 * score);
  let pressure = 1, flow = 1;
  for (let index = 0; index < points.length; index++) {
    const point = points[index], previous = points[Math.max(0, index - 1)];
    const envelope = bodyEnvelope(point.path);
    const wave = 0.62 * Math.sin(point.theta * 3 + point.path * 0.17 + phase)
      + 0.25 * Math.sin(point.theta * 7 - point.path * 0.21)
      + 0.13 * Math.sin(point.theta * 13 + point.path * 0.63 + phase);
    let interruption = false, accumulation = 0;
    for (let feature = 0; feature < 5; feature++) {
      const layer = 12 + feature * 10;
      const center = -0.65 + phase * 0.11 + feature * 2.37;
      // Keep intact support turns between small defect clusters. The first
      // trial used 9-turn windows and globally collapsed already at score .6.
      const vertical = bell((point.path - layer) / (1.5 + 0.5 * gapStrength));
      const angle = angleDelta(point.theta, center + 0.025 * (point.path - layer));
      if (gapStrength > 0 && vertical > 1 - gapStrength * 0.92 &&
          Math.abs(angle) < 0.3 + 0.9 * gapStrength) interruption = true;
      accumulation = Math.max(accumulation,
        bell((point.path - layer - 3.5) / 3.5) * bell(angleDelta(point.theta, center - 0.8) / 0.7));
    }
    const command = interruption ? 0 : Math.min(1.9, Math.max(0.25,
      1 + envelope * (wave * variation * 0.65 + accumulation * bulging * 1.05)));
    pressure = command + (pressure - command) * Math.exp(-secondsPerSample / MATERIAL_PROFILE.pressureResponseSeconds);
    const equilibrium = Math.min(3.2, Math.pow(Math.max(0, (pressure - 0.16) / 0.84), 1.6));
    flow = equilibrium + (flow - equilibrium) * Math.exp(-secondsPerSample / MATERIAL_PROFILE.flowResponseSeconds);
    // Volume follows distance: same inlet cross-section on a varying-radius path.
    const ds = index ? Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z)
      : TAU * SCORE_STUDY.radiusMm / SCORE_STUDY.segments;
    const volume = flow < 0.085 ? 0 : Math.PI * SCORE_STUDY.widthMm * SCORE_STUDY.halfHeightMm * ds * flow / scale ** 3;
    const deposit = body.add(point.x / scale, point.y / scale, point.z / scale, volume, index);
    deposit.restLength = ds / scale;
    body.step();
  }
  // Same settling duration for every score. There is no score-driven gravity.
  for (let tick = 0; tick < 100; tick++) body.step();
  for (let index = 0; index < points.length; index++) {
    const point = points[index], deposit = body.deposits[index];
    point.x = deposit.x * scale; point.y = deposit.y * scale; point.z = deposit.z * scale;
    point.gap = deposit.gap; point.breakBefore = deposit.breakBefore;
    if (!point.gap) { point.width = deposit.thickness * scale; point.height = deposit.halfHeight * scale; }
  }
  return finishScoreShape("supply", score, seed, points, [
    "The nozzle path is fixed; only supply variation, valve interruptions and local overfeed change.",
    "Uses the existing v3 strand model with a custom correlated valve schedule and distance-based feed, rather than the studio's original random events.",
    "Contact flattening still uses the original v3 layer height, which differs from this specimen's nominal pitch.",
    "Layer offsets and sag arise only from the material response; the score does not directly set their magnitude.",
  ]);
}
