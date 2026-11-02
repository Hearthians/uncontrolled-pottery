import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Info, LockKeyhole, Play, Pause, Upload, X } from "lucide-react";
import {
  MEMORY_PASSAGES,
  memoryIndexAtStep,
  memoryPassageAtStep,
} from "./memoryPlayback";
import type { MemoryEntry } from "./memoryPlayback";
import type { MemorySource, MemorySourceState } from "./memorySource";
import "./memoryPlayback.css";

type Props = {
  memories: MemoryEntry[];
  emotion: string;
  sourceState: MemorySourceState;
  source: MemorySource;
  depositedSteps: number;
  totalSteps: number;
  status: "ready" | "printing" | "paused" | "complete";
};

type Passage = { memory: MemoryEntry; index: number };

function MemoryCarousel({ memories, emotion, index, intent, onHold, onKeyDown }: {
  memories: MemoryEntry[];
  emotion: string;
  index: number;
  intent: "auto" | "next" | "previous";
  onHold: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);
  const outgoingRef = useRef<HTMLDivElement>(null);
  const lastPassage = useRef<Passage | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [slides, setSlides] = useState<{
    source: MemoryEntry[];
    current: Passage;
    outgoing?: Passage & { scrollTop: number };
    intent: "auto" | "next" | "previous";
  }>(() => ({ source: memories, current: { memory: memories[index], index }, intent }));

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useLayoutEffect(() => {
    if (slides.source === memories && slides.current.index === index) return;
    const scrollTop = activeRef.current?.scrollTop ?? 0;
    setSlides({ source: memories, current: { memory: memories[index], index },
      outgoing: slides.source === memories && !reducedMotion ? { ...slides.current, scrollTop } : undefined,
      intent });
  }, [memories, index, intent, reducedMotion, slides.source, slides.current]);

  useLayoutEffect(() => {
    const active = activeRef.current, outgoing = outgoingRef.current;
    if (!active) return;
    if (lastPassage.current !== slides.current) {
      active.scrollTop = 0;
      lastPassage.current = slides.current;
    }
    if (!slides.outgoing) return;
    if (reducedMotion) {
      setSlides((value) => ({ ...value, outgoing: undefined }));
      return;
    }
    if (outgoing) outgoing.scrollTop = slides.outgoing.scrollTop;
    const automatic = slides.intent === "auto";
    const offset = slides.intent === "previous" ? -16 : 16;
    const incomingTransform = automatic ? "translateY(8px)" : `translateX(${offset}px)`;
    const outgoingTransform = automatic ? "translateY(0)" : `translateX(${-offset}px)`;
    const duration = automatic ? 780 : 650;
    const split = automatic ? 280 / duration : .35;
    const options = { duration, easing: "linear" };
    const entering = active.animate([
      { opacity: 0, transform: incomingTransform, offset: 0 },
      { opacity: 0, transform: incomingTransform, offset: split, easing: "cubic-bezier(.2,.7,.2,1)" },
      { opacity: 1, transform: "translate(0,0)", offset: 1 },
    ], options);
    const leaving = outgoing?.animate([
      { opacity: 1, transform: "translate(0,0)", offset: 0, easing: "ease-out" },
      { opacity: 0, transform: outgoingTransform, offset: split },
      { opacity: 0, transform: outgoingTransform, offset: 1 },
    ], options);
    entering.onfinish = () => setSlides((value) => value.current === slides.current ? { ...value, outgoing: undefined } : value);
    return () => {
      entering.onfinish = null;
      entering.cancel(); leaving?.cancel();
    };
    // Removing the outgoing copy must not replay the entrance or reset reading position.
  }, [slides.current, reducedMotion]);

  return <div className="memory-carousel" role="region" aria-roledescription="carousel" aria-label="Memories">
    {slides.outgoing && <div className="memory-slide memory-outgoing" ref={outgoingRef} aria-hidden="true" inert>
      <div className="memory-passage">
        <p>{slides.outgoing.memory.text}</p>
        <div className="emotion-stage"><h3>{emotion}</h3></div>
      </div>
    </div>}
    <div className="memory-slide memory-active" ref={activeRef} tabIndex={0} role="group"
      aria-roledescription="slide" aria-label={`Memory ${slides.current.index + 1} of ${memories.length}`}
      aria-current="step" data-memory-index={slides.current.index}
      onWheel={onHold} onTouchStart={onHold} onPointerDown={onHold} onKeyDown={onKeyDown}>
      <div className="memory-passage">
        <p>{slides.current.memory.text}</p>
        <div className="emotion-stage" aria-live="polite" aria-label="Current emotion"><h3>{emotion}</h3></div>
      </div>
    </div>
  </div>;
}

export function MemoryPlayback({ memories, emotion, sourceState, source, depositedSteps, totalSteps, status }: Props) {
  const locked = status === "printing" || status === "paused";
  const loading = sourceState.phase === "loading";
  const error = sourceState.error;
  const [intent, setIntent] = useState<"auto" | "next" | "previous">("auto");
  const [reading, setReading] = useState({ source: memories, follow: true, index: 0 });
  const autoFollow = reading.source !== memories || reading.follow;
  const readingIndex = reading.source === memories ? reading.index : 0;
  const [infoOpen, setInfoOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const currentIndex = memoryIndexAtStep(depositedSteps, memories.length, totalSteps);
  const passageIndex = memoryPassageAtStep(depositedSteps, memories.length, totalSteps);
  const center = Math.min(memories.length - 1, autoFollow ? passageIndex : readingIndex);

  useEffect(() => {
    if (!infoOpen) return;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setInfoOpen(false); infoButtonRef.current?.focus(); }
    };
    const outside = (event: PointerEvent) => {
      if (!infoRef.current?.contains(event.target as Node) && !infoButtonRef.current?.contains(event.target as Node)) setInfoOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", outside); };
  }, [infoOpen]);

  function stopFollowing() {
    if (!autoFollow) return;
    setReading({ source: memories, follow: false, index: passageIndex });
  }
  function readNext(direction: number) {
    setIntent(direction < 0 ? "previous" : "next");
    setReading({ source: memories, follow: false, index: Math.max(0, Math.min(memories.length - 1, center + direction)) });
  }
  function handleCarouselKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); readNext(event.key === "ArrowRight" ? 1 : -1);
    } else if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) stopFollowing();
  }

  return (
    <section className={`memory-playback${memories.length ? " is-loaded" : ""}`} aria-label="Memories"
      data-current-index={currentIndex} data-displayed-index={center} data-source-state={sourceState.phase}>
      <div className="memory-heading">
        <span className="memory-eyebrow">{memories.length ? "Fragments" : "A place for memory"}</span>
        <div className="memory-tools">
          {memories.length > 0 && <button type="button" aria-label="Replace" title={locked ? "Finish this print to replace memories" : "Replace memories"}
            disabled={locked} onClick={() => fileRef.current?.click()}><Upload size={15} /></button>}
          <button type="button" ref={infoButtonRef} aria-label="About memories" title="About memories"
            aria-expanded={infoOpen} aria-controls="memory-information" onClick={() => setInfoOpen(!infoOpen)}><Info size={15} /></button>
        </div>
        {infoOpen && <div ref={infoRef} className="memory-information" id="memory-information" role="region" aria-label="Memory information">
          <p id="memory-privacy">The default collection contains 1,910 public memories. Your imported JSON stays in your browser; it is not uploaded or saved with the work.</p>
          <p>Preset collective arc; file-order passages sampled as printing progresses. Import changes the reader, not the print plan. A passage is not an individual emotion classification.</p>
          <p>Removing name fields does not make the original text anonymous.</p>
          <p>JSON: strings, or activity / content objects. Up to 2,000 entries and 8 MiB. Names and dates are not shown.</p>
          <p>{memories.length > MEMORY_PASSAGES
            ? "A selection of passages follows the print. Use the arrows to read every memory."
            : "Memories follow the print in file order. Use the arrows to linger."}</p>
          {locked && <p>Import and clear are locked until this print finishes, including while paused.</p>}
          {(memories.length > 0 || loading) && <button type="button" disabled={locked} aria-label="Clear memories"
            onClick={() => { source.clear(); setInfoOpen(false); }}><X size={13} />Clear memories</button>}
          {memories.length > 0 && <button type="button" disabled={locked || loading} aria-label="Reload default memories"
            onClick={() => { void source.loadDefault(); setInfoOpen(false); }}>Reload default memories</button>}
        </div>}
      </div>
      <input ref={fileRef} type="file" accept=".json,application/json" aria-label="Memories JSON file" disabled={locked} hidden
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) { setInfoOpen(false); void source.importFile(file); } }} />
      {error && <p className="memory-error" role="alert">{error}{memories.length > 0 ? " Existing memories are unchanged." : ""}</p>}
      {loading && memories.length > 0 && <p className="memory-source-status" role="status">Loading memories…</p>}
      {memories.length === 0 ? (
        <div className="memory-empty">
          <p role="status">{loading ? "Loading memories…" : "Load memories to begin."}</p>
          <button type="button" className="memory-retry" disabled={locked || loading}
            aria-label="Reload default memories" onClick={() => void source.loadDefault()}>Reload default memories</button>
          <button type="button" className="memory-load" disabled={locked} aria-label="Load memories"
            aria-describedby="memory-load-note"
            title={locked ? "Finish this print to load memories" : "Choose a local JSON file"}
            onClick={() => fileRef.current?.click()}>Choose a JSON file{locked ? <LockKeyhole size={17} /> : <ArrowUpRight size={18} />}</button>
          <small id="memory-load-note">{locked ? "Available after this print" : "Private · on your device"}</small>
        </div>
      ) : (
        <>
          <MemoryCarousel memories={memories} emotion={emotion} index={center} intent={autoFollow ? "auto" : intent} onHold={stopFollowing} onKeyDown={handleCarouselKey} />
          <div className="memory-reader-controls">
            <span className="memory-counter" aria-label={`Memory ${center + 1} of ${memories.length}`}>
              {String(center + 1).padStart(2, "0")}<i>/</i>{memories.length}
            </span>
            <div>
              <button type="button" aria-label="Read previous memory" title="Previous memory" disabled={center <= 0} onClick={() => readNext(-1)}><ChevronLeft size={15} /></button>
              <button type="button" className="memory-follow" aria-label={`Auto-follow ${autoFollow ? "on" : "off"}`}
                title={autoFollow ? "Hold this memory" : "Follow the print"} aria-pressed={autoFollow}
                onClick={() => { if (autoFollow) stopFollowing(); else setReading({ source: memories, follow: true, index: passageIndex }); }}>{autoFollow ? <Pause size={12} /> : <Play size={12} />}</button>
              <button type="button" aria-label="Read next memory" title="Next memory" disabled={center >= memories.length - 1} onClick={() => readNext(1)}><ChevronRight size={15} /></button>
            </div>
          </div>
          {memories.length > MEMORY_PASSAGES && <span className="memory-selection-note">Selected passages</span>}
        </>
      )}
    </section>
  );
}
