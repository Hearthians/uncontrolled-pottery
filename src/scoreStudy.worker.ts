import { generateSupplyShape } from "./scoreSupplyTrial.ts";
import { generatePathShape } from "./scorePathTrial.ts";
import { generateFieldShape } from "./scoreFieldTrial.ts";
import type { ScoreStrategy } from "./scoreStudyCore.ts";

self.onmessage = (event: MessageEvent<{ request: number; strategy: ScoreStrategy; score: number; seed: number }>) => {
  const { request, strategy, score, seed } = event.data;
  try {
    const start = performance.now();
    const generate = strategy === "supply" ? generateSupplyShape : strategy === "path" ? generatePathShape : generateFieldShape;
    const shape = generate(score, seed);
    self.postMessage({ request, shape, milliseconds: performance.now() - start });
  } catch (error) { self.postMessage({ request, error: error instanceof Error ? error.message : "Could not generate the specimen" }); }
};
