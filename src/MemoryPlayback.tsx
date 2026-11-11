import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { KeyboardEvent } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Info, LockKeyhole, Play, Pause, Upload, X } from "lucide-react";
import {
  MEMORY_PASSAGES,
  memoryIndexAtStep,
  memoryPassageAtStep,
} from "./memoryPlayback";
import type { MemoryEntry } from "./memoryPlayback";
import type { Scores } from "../shared/memoryAnalysis";
import type { ProcessEvent } from "./simulation";
import type { MemorySource, MemorySourceState } from "./memorySource";
import { MemoryEmotionTags } from "./MemoryEmotionTags";
import { MemoryImportDialog } from "./MemoryImportDialog";
import "./memoryPlayback.css";

type Props = {
  memories: MemoryEntry[];
  emotion: string;
  sourceState: MemorySourceState;
  source: MemorySource;
  depositedSteps: number;
  totalSteps: number;
  status: "ready" | "printing" | "paused" | "complete";
  printContribution?: { start: number; end: number };
  printScores?: Scores;
  printEvent?: ProcessEvent;
  printLayer?: number;
  printPlanSource?: "analyzed" | "demo";
  onAnalysisApplied: () => void;
};

type Passage = { memory: MemoryEntry; index: number };

function MemoryCarousel({ memories, index, intent, onHold, onKeyDown }: {
  memories: MemoryEntry[];
  index: number;
  intent: "auto" | "next" | "previous";
  onHold: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);
  const outgoingRef = useRef<HTMLDivElement>(null);
  const lastPassage = useRef<Passage | null>(null);
  const visiblePassage = useRef<Passage>({ memory: memories[index], index });
  const [tagPassage, setTagPassage] = useState(visiblePassage.current);
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
    const visible = visiblePassage.current;
    const scrollTop = (visible === slides.current ? activeRef.current : outgoingRef.current)?.scrollTop ?? 0;
    const next = { memory: memories[index], index };
    if (slides.source !== memories || reducedMotion) {
      visiblePassage.current = next;
      setTagPassage(next);
    } else {
      setTagPassage(visible);
    }
    setSlides({ source: memories, current: next,
      outgoing: slides.source === memories && !reducedMotion ? { ...visible, scrollTop } : undefined,
      intent });
  }, [memories, index, intent, reducedMotion, slides.source, slides.current]);

  useLayoutEffect(() => {
    const active = activeRef.current, outgoing = outgoingRef.current;
    if (!active || slides.source !== memories) return;
    if (lastPassage.current !== slides.current) {
      active.scrollTop = 0;
      lastPassage.current = slides.current;
    }
    if (!slides.outgoing) return;
    if (reducedMotion) {
      visiblePassage.current = slides.current;
      setTagPassage(slides.current);
      setSlides((value) => ({ ...value, outgoing: undefined }));
      return;
    }
    if (outgoing) outgoing.scrollTop = slides.outgoing.scrollTop;
    const automatic = slides.intent === "auto";
    const offset = slides.intent === "previous" ? -12 : 12;
    const incomingTransform = automatic ? "translateY(6px)" : `translateX(${offset}px)`;
    const outgoingTransform = automatic ? "translateY(0)" : `translateX(${-offset}px)`;
    const fadeOut = automatic ? 240 : 180;
    const pause = automatic ? 80 : 30;
    const fadeIn = automatic ? 640 : 420;
    const duration = fadeOut + pause + fadeIn;
    const leaveEnd = fadeOut / duration;
    const enterStart = (fadeOut + pause) / duration;
    const options = { duration, easing: "linear" };
    const entering = active.animate([
      { opacity: 0, transform: incomingTransform, offset: 0 },
      { opacity: 0, transform: incomingTransform, offset: enterStart, easing: "cubic-bezier(.16,1,.3,1)" },
      { opacity: 1, transform: "translate(0,0)", offset: 1 },
    ], options);
    // Keep the new slide frozen at opacity zero until the tag commit. This is
    // important if the document is backgrounded and animation events are delayed.
    entering.pause();
    entering.currentTime = 0;
    const leaving = outgoing?.animate([
      { opacity: 1, transform: "translate(0,0)", offset: 0, easing: "ease-out" },
      { opacity: 0, transform: outgoingTransform, offset: leaveEnd },
      { opacity: 0, transform: outgoingTransform, offset: 1 },
    ], options);
    // This independent WAAPI clock follows the same document timeline as the slides.
    // The 30/80ms gap after it finishes ensures React commits before entrance begins,
    // including when a background tab resumes after both deadlines have passed.
    const clock = active.animate([{}, {}], { duration: fadeOut });
    clock.onfinish = () => {
      visiblePassage.current = slides.current;
      flushSync(() => setTagPassage(slides.current));
      entering.currentTime = fadeOut;
      entering.play();
    };
    entering.onfinish = () => {
      visiblePassage.current = slides.current;
      setTagPassage(slides.current);
      setSlides((value) => value.current === slides.current ? { ...value, outgoing: undefined } : value);
    };
    return () => {
      clock.onfinish = null; clock.cancel();
      entering.onfinish = null;
      entering.cancel(); leaving?.cancel();
    };
    // Removing the outgoing copy must not replay the entrance or reset reading position.
  }, [slides.current, reducedMotion, memories]);

  return <>
    <div className="memory-carousel" role="region" aria-roledescription="carousel" aria-label="Memories">
    {slides.outgoing && <div className="memory-slide memory-outgoing" ref={outgoingRef} aria-hidden="true" inert>
      <div className="memory-passage"><p>{slides.outgoing.memory.text}</p></div>
    </div>}
    <div className="memory-slide memory-active" ref={activeRef} tabIndex={0} role="group"
      aria-roledescription="slide" aria-label={`Memory ${slides.current.index + 1} of ${memories.length}`}
      aria-current="step" data-memory-index={slides.current.index}
      onWheel={onHold} onTouchStart={onHold} onPointerDown={onHold} onKeyDown={onKeyDown}>
      <div className="memory-passage"><p>{slides.current.memory.text}</p></div>
    </div>
    </div>
    <MemoryEmotionTags memory={tagPassage.memory} index={tagPassage.index} />
  </>;
}

export function MemoryPlayback({ memories, sourceState, source, depositedSteps, totalSteps, status, printContribution, printScores, printEvent, printLayer, printPlanSource, onAnalysisApplied }: Props) {
  const locked = status === "printing" || status === "paused";
  const publicDemo = import.meta.env?.VITE_PUBLIC_DEMO_SCORES === "1";
  const publicAnalysis = import.meta.env?.VITE_PUBLIC_ANALYSIS === "1";
  const analysisAvailable = !publicDemo || publicAnalysis;
  const loading = sourceState.phase === "loading";
  const error = sourceState.error;
  const [intent, setIntent] = useState<"auto" | "next" | "previous">("auto");
  const [reading, setReading] = useState({ source: memories, follow: true, index: 0 });
  const autoFollow = reading.source !== memories || reading.follow;
  const readingIndex = reading.source === memories ? reading.index : 0;
  const [infoOpen, setInfoOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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
          {analysisAvailable && memories.length > 0 && <button type="button" aria-label="Replace" title={locked ? "Finish this print to replace memories" : "Replace memories"}
            disabled={locked} onClick={() => setImportOpen(true)}><Upload size={15} /></button>}
          <button type="button" ref={infoButtonRef} aria-label="About memories" title="About memories"
            aria-expanded={infoOpen} aria-controls="memory-information" onClick={() => setInfoOpen(!infoOpen)}><Info size={15} /></button>
        </div>
        {infoOpen && <div ref={infoRef} className="memory-information" id="memory-information" role="region" aria-label="Memory information">
          <p id="memory-privacy">{!analysisAvailable ? "The default collection contains 1,910 public memories. Upload and analysis are unavailable in this public demo." : "The default collection contains 1,910 public memories. If you explicitly analyze your own content, it is sent to this website’s analysis service and configured model gateway. It is not saved with the pottery."}</p>
          <p>Scores are an artistic interpretation, not a diagnosis. Each printed layer blends multiple memories and neighboring layers. The displayed variation and interruption are supply settings, not measured flow; the nozzle keeps moving during interruptions. Browsing memories does not change the print.</p>
          <p>Saved process controls can indirectly reveal information about scores, even though memory text and individual scores are not saved.</p>
          <p>Removing name fields does not make the original text anonymous.</p>
          {analysisAvailable && <p>Paste text or choose TXT, Markdown, JSON, CSV, DOCX or a text-based PDF, up to 8 MiB. Review analysis before replacing the reader.</p>}
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
      {importOpen && <MemoryImportDialog source={source} locked={locked} anonymousPublic={publicAnalysis} onApplied={onAnalysisApplied} onClose={() => setImportOpen(false)} />}
      {memories.length > 0 && sourceState.origin === "analyzed" && <p className="memory-source-status">Your memories · session only</p>}
      {publicDemo && !analysisAvailable && <p className="memory-source-status">Public demo: memory upload and analysis are unavailable.</p>}
      {sourceState.origin === "default" && sourceState.defaultScores === "analyzed" && <p className="memory-source-status">Public memories · analyzed scores</p>}
      {sourceState.origin === "default" && sourceState.defaultScores === "demo" && <p className="memory-source-status">Scores are random, not analyzed.</p>}
      {sourceState.origin === "default" && sourceState.defaultScores === "unavailable" && <p className="memory-source-status" role="alert">Default memory scores could not be verified and are unavailable.</p>}
      {error && <p className="memory-error" role="alert">{error}{memories.length > 0 ? " Existing memories are unchanged." : ""}</p>}
      {loading && memories.length > 0 && <p className="memory-source-status" role="status">Loading memories…</p>}
      {memories.length === 0 ? (
        <div className="memory-empty">
          <p role="status">{loading ? "Loading memories…" : "Load memories to begin."}</p>
          <button type="button" className="memory-retry" disabled={locked || loading}
            aria-label="Reload default memories" onClick={() => void source.loadDefault()}>Reload default memories</button>
          {analysisAvailable && <><button type="button" className="memory-load" disabled={locked} aria-label="Load memories"
            aria-describedby="memory-load-note"
            title={locked ? "Finish this print to load memories" : "Analyze text or a file"}
            onClick={() => setImportOpen(true)}>Analyze text or a file{locked ? <LockKeyhole size={17} /> : <ArrowUpRight size={18} />}</button>
          <small id="memory-load-note">{locked ? "Available after this print" : "Sent only with your consent"}</small></>}
        </div>
      ) : (
        <>
          <MemoryCarousel memories={memories} index={center} intent={autoFollow ? "auto" : intent} onHold={stopFollowing} onKeyDown={handleCarouselKey} />
          {printContribution && printScores && printEvent && <section className="memory-print-contribution" aria-label={`Current print contribution, memories ${printContribution.start + 1} to ${printContribution.end} blended with adjacent layers`}>
            <div className="memory-print-heading"><strong>{status === "complete" ? "Last printed layer" : "Printing now"} · {String(printLayer).padStart(2, "0")}/64</strong><span>{printPlanSource === "demo" ? "Random demo" : "Memory scores"}</span></div>
            <div className="memory-print-controls"><span>Variation <b>{printEvent.fluctuation}</b></span><span>Interruption <b>{printEvent.interruption}</b></span></div>
          </section>}
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
