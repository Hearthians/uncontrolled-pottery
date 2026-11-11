import type { MemoryEntry } from "./memoryPlayback";
import "./memoryEmotionTags.css";

type Scores = { calm: number; anxiety: number; anger: number; stress: number; sadness: number };
// The source owns score validation. Treat missing or malformed values as unknown,
// never as zero, including while older unscored collections are being read.
const labels = [
  ["calm", "Calm"], ["anxiety", "Anxiety"], ["anger", "Anger"],
  ["stress", "Stress"], ["sadness", "Sadness"],
] as const;

export function MemoryEmotionTags({ memory, index }: { memory: MemoryEntry; index: number }) {
  const scores = (memory as MemoryEntry & { scores?: Scores }).scores;
  return <div className="memory-emotion-block">
    <span className="memory-demo-note">This memory{memory.demoScores ? " · random demo" : ""}</span>
    <div className="memory-emotion-tags" role="group" aria-label="Emotion scores for the displayed memory" data-tag-memory-index={index} tabIndex={0}>
    {labels.map(([key, label]) => {
      const value = scores?.[key];
      const known = typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 5;
      return <span key={key} className={`memory-emotion-tag level-${known ? value : "unknown"}`}
        aria-label={`${label}: ${known ? `${value} out of 5` : "score unavailable"}`}>
        <span aria-hidden="true">{label}</span><b aria-hidden="true">{known ? value : "—"}</b>
      </span>;
    })}
    </div>
  </div>;
}
