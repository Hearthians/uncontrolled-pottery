import test from "node:test";
import assert from "node:assert/strict";
import {
  COLLECTIVE_EMOTION_PLAN,
  emotionAt,
  emotionAtStep,
  emotionPlanToEvents,
  emotionToSettings,
  isEmotionPlan,
} from "../src/emotionTrajectory.ts";
import { LAYERS, SEGMENTS } from "../src/simulation.ts";

test("the collective plan is valid and spans the complete vessel", () => {
  assert.equal(isEmotionPlan(COLLECTIVE_EMOTION_PLAN), true);
  assert.equal(COLLECTIVE_EMOTION_PLAN.memoryCount, 1910);
  assert.equal(COLLECTIVE_EMOTION_PLAN.mappingVersion, "emotion-behavior-2");
  assert.equal(COLLECTIVE_EMOTION_PLAN.trajectory[0].position, 0);
  assert.equal(COLLECTIVE_EMOTION_PLAN.trajectory.at(-1).position, 1);
});

test("emotion interpolation follows neighboring points without mutating the plan", () => {
  const original = JSON.stringify(COLLECTIVE_EMOTION_PLAN);
  const point = emotionAt(0.135);
  assert.ok(point.valence > 0.8);
  assert.ok(point.arousal > 0.7);
  assert.equal(JSON.stringify(COLLECTIVE_EMOTION_PLAN), original);
});

test("negative high-arousal low-control emotions create stronger disruption", () => {
  const calm = emotionToSettings({ valence: 0.8, arousal: 0.2, dominance: 0.8 });
  const distressed = emotionToSettings({ valence: -0.9, arousal: 0.95, dominance: 0.1 });
  assert.ok(distressed.fluctuation > calm.fluctuation);
  assert.ok(distressed.interruption > calm.interruption);
  assert.equal(calm.sag, true, "emotion must not change the material model");
  assert.equal(distressed.sag, true);
});

test("the deterministic compiler emits one ordered event per layer", () => {
  const events = emotionPlanToEvents();
  assert.equal(events.length, LAYERS);
  assert.deepEqual(events.map((event) => event.step),
    Array.from({ length: LAYERS }, (_, layer) => layer * SEGMENTS));
  assert.ok(events.every((event) =>
    event.fluctuation >= 0 && event.fluctuation <= 100 &&
    event.interruption >= 0 && event.interruption <= 100 && event.sag === true));
});

test("displayed layer emotion matches supply events throughout the original full plan", () => {
  const events = emotionPlanToEvents();
  for (const event of events) {
    const { step, ...settings } = event;
    for (const offset of [0, SEGMENTS - 1]) {
      assert.deepEqual(emotionToSettings(emotionAtStep(step + offset)), settings);
    }
  }
});

test("an early stop freezes its last deposited layer instead of traversing the emotion arc", () => {
  const lastDepositStep = SEGMENTS * 8 + 95;
  const stopped = emotionAtStep(lastDepositStep);
  assert.equal(stopped.position, 8 / (LAYERS - 1));
  assert.ok(stopped.position < 0.15);
  assert.notEqual(stopped.label, COLLECTIVE_EMOTION_PLAN.trajectory.at(-1).label);
  assert.deepEqual(emotionAtStep(-1), emotionAt(0));
  assert.deepEqual(emotionAtStep(LAYERS * SEGMENTS), emotionAt(1));
});
