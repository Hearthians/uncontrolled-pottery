import { DURATION, LAYERS, SEGMENTS, TOTAL_STEPS, isPottery } from "./pottery.ts";
import type { Pottery } from "./pottery.ts";
import { MATERIAL_DT, MATERIAL_PROFILE, MATERIAL_TICKS } from "./materialSimulation.ts";

export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;

export function createArchive(pottery: Pottery) {
  return {
    format: "uncontrolled-pottery",
    version: pottery.simulation ? 2 : 1,
    shape: "cylinder",
    simulation: {
      layers: LAYERS,
      segmentsPerLayer: SEGMENTS,
      durationSeconds: DURATION,
      model: "material-inspired-approximation",
      ...(pottery.simulation ? {
        ...MATERIAL_PROFILE,
        fixedStepSeconds: MATERIAL_DT,
        fullSimulationSeconds: MATERIAL_DT * MATERIAL_TICKS,
        playbackRate: MATERIAL_DT * MATERIAL_TICKS / DURATION,
      } : {}),
    },
    pottery,
  };
}

export function parseArchive(text: string): Pottery {
  if (text.length > MAX_ARCHIVE_BYTES) throw new Error("Archive too large");
  const archive: unknown = JSON.parse(text);
  if (!archive || typeof archive !== "object") throw new Error("Invalid archive");
  const data = archive as ReturnType<typeof createArchive>;
  if (data.format !== "uncontrolled-pottery" || data.shape !== "cylinder" ||
    ![1, 2].includes(data.version) || !isPottery(data.pottery) ||
    data.version !== (data.pottery.simulation ? 2 : 1)) throw new Error("Unsupported archive");
  const pottery = data.pottery;
  if (!pottery.steps || pottery.id.length > 200 || pottery.title.length > 200 ||
    pottery.events.length > TOTAL_STEPS + 1) throw new Error("Invalid pottery");
  return { ...pottery, preset: false };
}
