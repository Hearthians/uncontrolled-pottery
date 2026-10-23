export type PrintStatus = "ready" | "printing" | "paused" | "complete";
export type HandSide = "left" | "right";
export type HandPoint = { x: number; y: number; z?: number };
export type TrackedHand = {
  side: HandSide;
  points: HandPoint[];
  amount: number;
  pose: "open" | "fist" | "adjust";
};
export type HandResult = {
  landmarks: HandPoint[][];
  handedness: { categoryName: string; score: number }[][];
};
export type GestureUpdate = {
  values: { fluctuation?: number; interruption?: number };
  command?: "run" | "pause";
  reason?: "gesture" | "lost";
  hold: number;
  intent: "run" | "pause" | null;
};

export const HOLD_MS = 1000;
export const LOST_MS = 2000;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function readHands(
  result: HandResult,
  aspect = 4 / 3,
  swap = false,
): TrackedHand[] {
  const hands = new Map<HandSide, { hand: TrackedHand; score: number }>();
  result.landmarks.forEach((points, index) => {
    const category = result.handedness[index]?.[0];
    if (
      !category ||
      category.score < 0.65 ||
      points.length !== 21 ||
      !["Left", "Right"].includes(category.categoryName) ||
      points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
    )
      return;
    const distance = (a: number, b: number) =>
      Math.hypot(
        (points[a].x - points[b].x) * aspect,
        points[a].y - points[b].y,
      );
    const palm = distance(5, 17);
    if (palm < 0.035) return;
    const gap = distance(4, 8) / palm;
    const extended = [8, 12, 16, 20].filter(
      (tip) => distance(0, tip) > distance(0, tip - 2) * 1.15,
    ).length;
    let side: HandSide = category.categoryName === "Left" ? "left" : "right";
    if (swap) side = side === "left" ? "right" : "left";
    const hand: TrackedHand = {
      side,
      points,
      amount: clamp((gap - 0.12) / 1.2) * 100,
      pose:
        extended === 4 && gap > 0.5
          ? "open"
          : extended === 0 && gap < 0.65
            ? "fist"
            : "adjust",
    };
    if ((hands.get(side)?.score ?? 0) < category.score)
      hands.set(side, { hand, score: category.score });
  });
  return [...hands.values()].map(({ hand }) => hand);
}

type Channel = {
  value: number;
  since: number;
  sent: number | null;
};

export class GestureController {
  private channels = new Map<HandSide, Channel>();
  private candidate: GestureUpdate["intent"] = null;
  private heldSince = 0;
  private fired = false;
  private samples = 0;
  private lastSeen: number | null = null;
  private lastFrame: number | null = null;
  private lossFired = false;

  reset() {
    this.channels.clear();
    this.candidate = null;
    this.fired = false;
    this.samples = 0;
    this.lastSeen = null;
    this.lastFrame = null;
    this.lossFired = false;
  }

  update(
    hands: TrackedHand[],
    now: number,
    status: PrintStatus,
  ): GestureUpdate {
    const output: GestureUpdate = { values: {}, hold: 0, intent: null };
    const delta =
      this.lastFrame === null ? 80 : Math.max(0, now - this.lastFrame);
    if (delta > 1000) {
      this.candidate = null;
      this.channels.clear();
      this.fired = false;
      this.samples = 0;
    }
    this.lastFrame = now;
    this.lastSeen ??= now;
    if (hands.length) {
      this.lastSeen = now;
      this.lossFired = false;
    } else if (
      now - this.lastSeen >= LOST_MS &&
      status === "printing" &&
      !this.lossFired
    ) {
      output.command = "pause";
      output.reason = "lost";
      this.lossFired = true;
    }

    // Command poses reserve both hands until released, including after firing.
    const poseIntent =
      hands.length === 2 && hands.every((h) => h.pose === "open")
        ? "run"
        : hands.length === 2 && hands.every((h) => h.pose === "fist")
          ? "pause"
          : null;
    const intent =
      poseIntent === "run" && status === "printing" && !this.fired
        ? null
        : poseIntent;
    if (intent !== this.candidate) {
      this.candidate = intent;
      this.heldSince = now;
      this.fired = false;
      this.samples = 0;
    }
    const applicable =
      (intent === "run" && (status === "ready" || status === "paused")) ||
      (intent === "pause" && status === "printing");
    if (intent) {
      this.samples++;
      this.channels.clear();
      if (applicable) {
        output.intent = intent;
        output.hold = Math.min(
          this.samples < 3 ? 0.95 : 1,
          clamp((now - this.heldSince) / HOLD_MS),
        );
        if (output.hold === 1 && !this.fired) {
          this.fired = true;
          output.command = intent;
          output.reason = "gesture";
        }
      }
      return output;
    }

    for (const side of ["left", "right"] as const) {
      const hand = hands.find((h) => h.side === side);
      if (!hand) {
        this.channels.delete(side);
        continue;
      }
      let channel = this.channels.get(side);
      if (!channel) {
        channel = { value: hand.amount, since: now, sent: null };
        this.channels.set(side, channel);
      }
      channel.value +=
        (hand.amount - channel.value) * (1 - Math.exp(-delta / 180));
      const value = Math.round(channel.value);
      if (now - channel.since < 180 || status === "complete") continue;
      if (channel.sent === null || Math.abs(value - channel.sent) >= 2) {
        output.values[side === "left" ? "fluctuation" : "interruption"] = value;
        channel.sent = value;
      }
    }
    return output;
  }
}
