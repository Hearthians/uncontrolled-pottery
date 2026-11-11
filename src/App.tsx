import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Box,
  Check,
  ChevronDown,
  CircleHelp,
  Expand,
  Eye,
  EyeOff,
  FlaskConical,
  GalleryHorizontalEnd,
  Layers3,
  Maximize2,
  MoveUpRight,
  Pause,
  Play,
  Plus,
  RotateCw,
  Sparkles,
  Square,
  Upload,
  X,
} from "lucide-react";
import { ClayScene } from "./ClayScene";
import type { SceneHandle } from "./ClayScene";
import {
  DURATION,
  LAYERS,
  PRESETS,
  SEGMENTS,
  TOTAL_STEPS,
  isPottery,
  meanSettings,
} from "./pottery";
import type { Pottery } from "./pottery";
import { MATERIAL_TICKS } from "./materialSimulation";
import { PlasticSimulation } from "./plasticSimulation";
import { HeightfieldSimulation } from "./heightfieldSimulation";
import "./studioPhysics.css";
import {
  COLLECTIVE_EMOTION_PLAN,
  emotionPlanToEvents,
} from "./emotionTrajectory";
import { createArchive, MAX_ARCHIVE_BYTES, parseArchive } from "./archive";
import { MemoryPlayback } from "./MemoryPlayback";
import { useMemorySource } from "./useMemorySource";
import { compileMemoryPrintPlan } from "./memoryPrintPlan";
import { validateScores } from "../shared/memoryAnalysis";
import type { Scores } from "../shared/memoryAnalysis";

type Status = "ready" | "printing" | "paused" | "complete";
type Page = "studio" | "gallery";
const STORAGE_KEY = "uncontrolled-pottery-v1";
// Playback speed is presentation-only: archive and simulation timing stay unchanged.
const PRINT_PLAYBACK_SECONDS = 90;
const thumbnailCache = new Map<string, string>();

function readCollection(): Pottery[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(data) ? data.filter(isPottery) : [];
  } catch {
    return [];
  }
}

function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

function IconButton({
  label,
  children,
  onClick,
  active,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${className}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function ProcessChart({
  pottery,
  currentStep,
}: {
  pottery: Pottery;
  currentStep?: number;
}) {
  const step = currentStep ?? pottery.steps;
  return (
    <div className="process-chart" aria-label="Print process parameter history">
      <div className="chart-lines">
        <i />
        <i />
        <i />
      </div>
      <div className="chart-bars">
        {Array.from({ length: 64 }, (_, i) => {
          const point = (i / 64) * TOTAL_STEPS;
          const event =
            [...pottery.events].reverse().find((e) => e.step <= point) ??
            pottery.events[0];
          return (
            <div
              className="chart-column"
              key={i}
              style={{ opacity: point <= step ? 1 : 0.12 }}
            >
              <i
                style={{ height: `${Math.max(3, event.fluctuation * 0.75)}%` }}
              />
              <b
                style={{ height: `${Math.max(2, event.interruption * 0.75)}%` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GalleryItem({
  pottery,
  index,
  onOpen,
}: {
  pottery: Pottery;
  index: number;
  onOpen: () => void;
}) {
  const settings = meanSettings(pottery);
  const [thumbnail, setThumbnail] = useState(
    thumbnailCache.get(pottery.id) ?? "",
  );
  const [visible, setVisible] = useState(false);
  const imageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "150px" },
    );
    if (imageRef.current) observer.observe(imageRef.current);
    return () => observer.disconnect();
  }, []);
  return (
    <button
      className="gallery-item"
      onClick={onOpen}
      aria-label={`View work: ${pottery.title}`}
    >
      <div className="gallery-image" ref={imageRef}>
        {thumbnail ? (
          <img
            className="pottery-thumbnail"
            src={thumbnail}
            alt={pottery.title}
          />
        ) : (
          visible && (
            <ClayScene
              initial={pottery}
              miniature
              onSnapshot={(image) => {
                thumbnailCache.set(pottery.id, image);
                setThumbnail(image);
              }}
            />
          )
        )}
        <span className="specimen-number">
          NO. {String(index + 1).padStart(3, "0")}
        </span>
        <span className="gallery-open">
          <MoveUpRight size={17} />
        </span>
      </div>
      <div className="gallery-item-info">
        <div>
          <h3>{pottery.title}</h3>
          <span>
            {pottery.memoryPrintPlan?.source === "demo" ? "Random demo" : pottery.preset ? "Studio study" : "My collection"} <i />{" "}
            {Math.ceil(pottery.steps / SEGMENTS)} layers
          </span>
        </div>
        <div className="gallery-values">
          <span>Fluctuation {settings.fluctuation}%</span>
          <span>Interruption {settings.interruption}%</span>
        </div>
      </div>
    </button>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("studio");
  const [status, setStatus] = useState<Status>("ready");
  const [physics, setPhysics] = useState<"strand" | "heightfield">(
    new URLSearchParams(location.search).get("physics") === "heightfield" ? "heightfield" : "strand",
  );
  const [selectedPrintMode, setPrintMode] = useState<"collective" | "analyzed" | "demo" | null>(null);
  const [progress, setProgress] = useState(0);
  const [depositedSteps, setDepositedSteps] = useState(0);
  // Session-only text survives studio/gallery navigation, never enters a work record.
  const memorySource = useMemorySource(status === "printing" || status === "paused");
  const { memories } = memorySource;
  const printMode = selectedPrintMode ?? (memorySource.defaultScores === "analyzed" ? "analyzed" : memorySource.defaultScores === "demo" ? "demo" : "collective");
  const hasAnalyzedScores = memories.length > 0 && memories.every(memory => !memory.demoScores && validateScores(memory.scores));
  const hasDemoScores = memories.length > 0 && memories.every(memory => memory.demoScores && validateScores(memory.scores));
  const modeAvailable = printMode === "collective" || (printMode === "analyzed" ? hasAnalyzedScores : hasDemoScores);
  const canStartPrint = memorySource.canStart && modeAvailable;
  const [planned, setPlanned] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [view, setView] = useState<"perspective" | "front" | "top">(
    "perspective",
  );
  const [viewMenu, setViewMenu] = useState(false);
  const [collection, setCollection] = useState<Pottery[]>(readCollection);
  const [selected, setSelected] = useState<Pottery | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [workName, setWorkName] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [webglError, setWebglError] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState<"all" | "mine">("all");
  const sceneRef = useRef<SceneHandle>(null);
  const detailRef = useRef<SceneHandle>(null);
  const studioRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef(new URLSearchParams(location.search).has("profile"));
  const runRef = useRef<{
    pottery: Pottery;
    engine: PlasticSimulation | HeightfieldSimulation;
    elapsed: number;
    contributions?: { start: number; end: number }[];
    blendedScores?: Scores[];
    memorySource?: typeof memories;
  } | null>(null);
  const allWorks = [...collection, ...PRESETS];
  const currentPottery = runRef.current?.pottery ?? PRESETS[0];
  const currentLayer = runRef.current ? Math.min(LAYERS, Math.ceil(currentPottery.steps / SEGMENTS)) : 0;
  const planLayer = Math.max(0, Math.min(LAYERS - 1, Math.floor(Math.max(0, depositedSteps - 1) / SEGMENTS)));
  const isActive = status === "printing" || status === "paused";
  const finishing = !!runRef.current && runRef.current.engine.tick >= runRef.current.engine.stopStep;

  const notify = (message: string) => setNotice(message);
  function closeGuide() {
    setGuideOpen(false);
  }
  useEffect(() => {
    if (notice) {
      const timer = window.setTimeout(() => setNotice(""), 3500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(null);
        closeGuide();
        setProcessOpen(false);
        setNameOpen(false);
        setViewMenu(false);
      }
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);
  useEffect(() => {
    const modalOpen = !!selected || guideOpen || processOpen || nameOpen;
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = 'button, input, [tabindex="0"]';
    dialog?.querySelector<HTMLElement>(focusable)?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(focusable)].filter(
        (el) => !el.hasAttribute("disabled"),
      );
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [selected, guideOpen, processOpen, nameOpen]);

  useEffect(() => {
    if (status !== "printing") return;
    let frame = 0;
    let previous = performance.now();
    let uiTime = 0;
    const tick = (now: number) => {
      const run = runRef.current;
      if (!run) return;
      const delta = Math.min((now - previous) / 1000, 0.15);
      previous = now;
      if (!document.hidden) run.elapsed += delta;
      const engine = run.engine;
      const started = profileRef.current ? performance.now() : 0;
      engine.advanceTo(Math.floor(run.elapsed / PRINT_PLAYBACK_SECONDS * MATERIAL_TICKS), run.pottery.events);
      const simulated = profileRef.current ? performance.now() : 0;
      sceneRef.current?.append(engine.deposits, engine.dirtyStart, engine.nozzle,
        engine instanceof HeightfieldSimulation ? engine.surface : undefined);
      if (profileRef.current) {
        const end = performance.now();
        performance.measure("pottery:simulation", { start: started, end: simulated });
        performance.measure("pottery:geometry", { start: simulated, end });
        performance.measure("pottery:deposition", { start: started, end });
      }
      run.pottery.steps = engine.deposits.length;
      run.pottery.simulation = engine.record();
      run.pottery.duration = engine.tick / MATERIAL_TICKS * DURATION;
      if (now - uiTime > 70 || engine.complete) {
        setProgress(engine.tick / MATERIAL_TICKS);
        setDepositedSteps(engine.deposits.length);
        uiTime = now;
      }
      if (engine.complete) {
        setStatus("complete");
        notify("Print complete");
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [status]);

  function startPrint() {
    if (!memorySource.source.canStart || !modeAvailable) return;
    const plan = printMode === "collective" ? null : compileMemoryPrintPlan(memories, printMode);
    const seed = Math.floor(Math.random() * 100000);
    const engine = physics === "heightfield" ? new HeightfieldSimulation(seed) : new PlasticSimulation(seed);
    const events = plan?.events ?? emotionPlanToEvents();
    const pottery: Pottery = {
      id:
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `pottery-${Date.now()}-${seed}`,
      title: plan ? (printMode === "demo" ? "Random memory demo" : "Memory impressions") : COLLECTIVE_EMOTION_PLAN.title,
      seed,
      steps: 0,
      events,
      createdAt: new Date().toISOString(),
      duration: 0,
      simulation: engine.record(),
      ...(plan ? { memoryPrintPlan: { version: 1 as const, mapping: "memory-supply-1" as const, source: printMode as "demo" | "analyzed", memoryCount: memories.length } }
        : { emotionPlan: structuredClone(COLLECTIVE_EMOTION_PLAN) }),
    };
    runRef.current = { pottery, engine, elapsed: 0, contributions: plan?.contributions, blendedScores: plan?.blendedScores, memorySource: plan ? memories : undefined };
    setProgress(0);
    setDepositedSteps(0);
    setSavedId(null);
    setAutoRotate(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setView("perspective");
    sceneRef.current?.reset(engine.record().version);
    setStatus("printing");
  }

  function pausePrint() {
    setDepositedSteps(runRef.current?.engine.deposits.length ?? 0);
    setStatus("paused");
  }

  function finishPrint() {
    const run = runRef.current;
    if (!run) return;
    run.engine.stop();
    run.pottery.simulation = run.engine.record();
    setStatus("printing");
  }

  function saveWork() {
    const run = runRef.current;
    if (!run || !run.pottery.steps) return;
    const pottery = {
      ...run.pottery,
      events: run.pottery.events.map((event) => ({ ...event })),
      title: workName.trim() || run.pottery.title,
    };
    const next = [pottery, ...collection.filter((p) => p.id !== pottery.id)];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      run.pottery = pottery;
      setCollection(next);
      setSavedId(pottery.id);
      setNameOpen(false);
      notify("Added to the gallery");
    } catch {
      notify("Collection storage is full. Export your work first.");
    }
  }

  function exportWork(pottery: Pottery) {
    const data = createArchive(pottery);
    download(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `${pottery.title}-process.json`,
    );
    notify("Work and process data exported");
  }

  async function importWork(file: File) {
    try {
      if (file.size > MAX_ARCHIVE_BYTES) throw new Error("Archive too large");
      const pottery = parseArchive(await file.text());
      const existing = collection.find((work) => work.id === pottery.id);
      if (existing) {
        setSelected(existing);
        notify("This work is already in your collection");
        return;
      }
      const next = [pottery, ...collection];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setCollection(next);
      setGalleryFilter("mine");
      setSelected(pottery);
      notify("Work imported");
    } catch {
      notify("Import failed. Check the archive version and available storage.");
    }
  }

  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function exportImage() {
    const data = detailRef.current?.capture();
    if (!data) {
      notify("Work is still being reconstructed");
      return;
    }
    const a = document.createElement("a");
    a.href = data;
    a.download = `${selected?.title ?? "pottery"}.webp`;
    a.click();
  }

  function changePage(next: Page) {
    if (next === "gallery" && status === "printing") pausePrint();
    setPage(next);
    setGalleryFilter("all");
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await studioRef.current?.requestFullscreen();
    } catch {
      notify("Fullscreen is unavailable in this browser");
    }
  }

  return (
    <div className="app-shell">
      <aside className="nav-rail">
        <button
          className="brand-symbol"
          aria-label="Back to studio"
          onClick={() => changePage("studio")}
        >
          <Layers3 size={27} strokeWidth={1.6} />
        </button>
        <div className="rail-links">
          <button
            className={page === "studio" ? "rail-item selected" : "rail-item"}
            onClick={() => changePage("studio")}
            aria-label="Print studio"
            title="Print studio"
          >
            <Box size={22} strokeWidth={1.5} />
            <span>Studio</span>
          </button>
          <button
            className={page === "gallery" ? "rail-item selected" : "rail-item"}
            onClick={() => changePage("gallery")}
            aria-label="Gallery"
            title="Gallery"
          >
            <GalleryHorizontalEnd size={22} strokeWidth={1.5} />
            <span>Gallery</span>
          </button>
          <button
            className="rail-item"
            onClick={() => setProcessOpen(true)}
            aria-label="Process history"
            title="Process history"
          >
            <AudioLines size={22} strokeWidth={1.5} />
            <span>History</span>
          </button>
          <a
            className="rail-item lab-link"
            href={`${location.pathname}?lab=deposition`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open physics lab in a new tab"
            title="Physics lab · opens a new tab"
            onClick={() => { if (status === "printing") pausePrint(); }}
          >
            <FlaskConical size={22} strokeWidth={1.5} />
            <span>Lab</span>
          </a>
        </div>
        <div className="rail-bottom">
          <IconButton label="How it works" onClick={() => {
            if (status === "printing") pausePrint();
            setGuideOpen(true);
          }}>
            <CircleHelp size={21} strokeWidth={1.5} />
          </IconButton>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button className="wordmark" onClick={() => changePage("studio")}>
            <span>
              Uncontrolled Studio<span className="brand-dot">.</span>
            </span>
          </button>
          <div className="topbar-tools">
            <IconButton label="How it works" onClick={() => {
              if (status === "printing") pausePrint();
              setGuideOpen(true);
            }}>
              <CircleHelp size={18} />
            </IconButton>
          </div>
        </header>

        {page === "studio" ? (
          <main className="studio-page">
            <div className="page-heading">
              <div className="page-title">
                <h1>Print studio</h1>
              </div>
              <div className="heading-actions">
                <label className="physics-choice">
                  <span>Print behavior</span>
                  <select aria-label="Print behavior" value={printMode} disabled={isActive}
                    onChange={(event) => setPrintMode(event.target.value as "collective" | "analyzed" | "demo")}>
                    <option value="collective">Collective arc</option>
                    <option value="analyzed" disabled={!hasAnalyzedScores}>Memory scores</option>
                    <option value="demo" disabled={!hasDemoScores}>Random scores · demo</option>
                  </select>
                </label>
                <label className="physics-choice">
                  <span>{status === "complete" ? "Next print" : "Physics"}</span>
                  <select aria-label="Print physics model" value={physics} disabled={isActive}
                    onChange={(event) => setPhysics(event.target.value as "strand" | "heightfield")}>
                    <option value="strand">Strand · original</option>
                    <option value="heightfield">Height field · test</option>
                  </select>
                </label>
              </div>
            </div>
            <div
              className="workbench"
              ref={studioRef}
            >
              <section className="viewport">
                <ClayScene
                  ref={sceneRef}
                  initial={currentPottery}
                  initialNozzle={runRef.current?.engine.nozzle}
                  planned={planned}
                  autoRotate={autoRotate && status !== "paused"}
                  printing={isActive}
                  onError={() => setWebglError(true)}
                />
                <div className="viewport-top">
                  <div className="live-status">
                    <span className={`status-dot ${status}`} />
                    <span>
                      {status === "ready"
                        ? "Preview"
                        : status === "printing"
                          ? finishing ? "Finishing" : "Depositing"
                          : status === "paused"
                            ? "Print paused"
                            : "Print complete"}
                    </span>
                  </div>
                  <IconButton label="Fullscreen" onClick={toggleFullscreen}>
                    <Expand size={18} />
                  </IconButton>
                </div>
                {(currentPottery.simulation?.version === 4 || status === "ready" && physics === "heightfield") && (
                  <p className="physics-note">{status === "ready" ? "Next print: " : ""}Experimental height field · no overhangs or fracture</p>
                )}
                {webglError && (
                  <div className="webgl-error">
                    <Box size={30} />
                    <p>Enable WebGL to view the 3D scene</p>
                    <button onClick={() => location.reload()}>Reload</button>
                  </div>
                )}
                {status === "ready" && !webglError && (
                  <button
                    className="scene-start-button"
                    aria-label="Start printing from the workbench"
                    disabled={!canStartPrint}
                    aria-describedby={!canStartPrint ? "memory-start-note" : undefined}
                    onClick={startPrint}
                  >
                    <Play size={16} fill="currentColor" />
                    <span>Create</span>
                    <ArrowRight size={16} />
                  </button>
                )}
                <div className="viewport-bottom">
                  <div className="view-selector">
                    <button
                      onClick={() => setViewMenu(!viewMenu)}
                      aria-expanded={viewMenu}
                    >
                      {view === "perspective"
                        ? "Perspective"
                        : view === "front"
                          ? "Front view"
                          : "Top view"}
                      <ChevronDown size={13} />
                    </button>
                    {viewMenu && (
                      <div className="view-menu">
                        {(["perspective", "front", "top"] as const).map(
                          (option, i) => (
                            <button
                              key={option}
                              onClick={() => {
                                setView(option);
                                sceneRef.current?.setView(option);
                                setViewMenu(false);
                              }}
                            >
                              {["Perspective", "Front view", "Top view"][i]}
                              {view === option && <Check size={13} />}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                  <div className="canvas-tools">
                    <IconButton
                      label={planned ? "Hide reference cylinder" : "Show reference cylinder"}
                      active={planned}
                      onClick={() => setPlanned(!planned)}
                    >
                      {planned ? <Eye size={17} /> : <EyeOff size={17} />}
                    </IconButton>
                    <IconButton
                      label="Auto-rotate"
                      active={autoRotate}
                      onClick={() => setAutoRotate(!autoRotate)}
                    >
                      <RotateCw size={17} />
                    </IconButton>
                    <span />
                    <IconButton
                      label="Reset view"
                      onClick={() => {
                        sceneRef.current?.resetView();
                        setView("perspective");
                      }}
                    >
                      <Maximize2 size={17} />
                    </IconButton>
                  </div>
                </div>
              </section>

              <aside className={`control-panel emotion-panel memory-panel${memories.length ? " has-memories" : ""}`}>
                <div className="memory-panel-scroll">
                  <MemoryPlayback
                    key={runRef.current?.pottery.id ?? "preview"}
                    memories={memories}
                    emotion=""
                    printContribution={runRef.current?.memorySource === memories ? runRef.current?.contributions?.[planLayer] : undefined}
                    printScores={runRef.current?.memorySource === memories ? runRef.current?.blendedScores?.[planLayer] : undefined}
                    printEvent={runRef.current?.memorySource === memories ? runRef.current?.pottery.events[planLayer] : undefined}
                    printLayer={planLayer + 1}
                    printPlanSource={runRef.current?.pottery.memoryPrintPlan?.source}
                    sourceState={memorySource}
                    source={memorySource.source}
                    onAnalysisApplied={() => setPrintMode(current => current ?? "analyzed")}
                    depositedSteps={depositedSteps}
                    totalSteps={TOTAL_STEPS}
                    status={status}
                  />
                </div>
                <div className="print-actions">
                  {!canStartPrint && !isActive && <p id="memory-start-note" className="memory-start-note">
                    {memorySource.analysisPending ? "Finish or cancel memory analysis before printing." : memorySource.phase === "loading" ? "Loading memories before printing…" : !modeAvailable ? "The selected behavior requires matching scores. Choose another behavior or analyze memories." : "Load memories to start printing."}
                  </p>}
                  {status === "ready" && (
                    <button className="primary-button" onClick={startPrint} disabled={!canStartPrint} aria-describedby={!canStartPrint ? "memory-start-note" : undefined}>
                      <Play size={17} fill="currentColor" />
                      <span>Start print</span>
                      <span className="button-time">{PRINT_PLAYBACK_SECONDS} s</span>
                    </button>
                  )}
                  {status === "printing" && (
                    <button
                      className="primary-button"
                      onClick={pausePrint}
                    >
                      <Pause size={17} fill="currentColor" />
                      <span>Pause print</span>
                      <span className="button-time">
                        {Math.max(0, Math.ceil(PRINT_PLAYBACK_SECONDS * (1 - progress)))} s
                      </span>
                    </button>
                  )}
                  {status === "paused" && (
                    <button
                      className="primary-button"
                      onClick={() => setStatus("printing")}
                    >
                      <Play size={17} fill="currentColor" />
                      <span>Resume print</span>
                      <span className="button-time">
                        {Math.max(0, Math.ceil(PRINT_PLAYBACK_SECONDS * (1 - progress)))} s
                      </span>
                    </button>
                  )}
                  {status === "complete" && (
                    <button
                      className="primary-button"
                      disabled={savedId === currentPottery.id}
                      onClick={() => {
                        setWorkName(currentPottery.title);
                        setNameOpen(true);
                      }}
                    >
                      {savedId ? <Check size={17} /> : <Plus size={17} />}
                      <span>{savedId ? "Saved to gallery" : "Save this work"}</span>
                      <GalleryHorizontalEnd size={17} />
                    </button>
                  )}
                  <div className="secondary-actions">
                    {status !== "ready" && (
                      <button
                        disabled={!isActive && !canStartPrint}
                        aria-describedby={!isActive && !canStartPrint ? "memory-start-note" : undefined}
                        onClick={() => {
                          if (isActive) finishPrint();
                          else startPrint();
                        }}
                      >
                        {isActive ? (
                          <Square size={12} />
                        ) : (
                          <Play size={13} />
                        )}
                        {isActive ? "Finish print" : "Print again"}
                      </button>
                    )}
                    {status === "complete" ? (
                      <button onClick={() => exportWork(currentPottery)}>
                        <ArrowDownToLine size={13} />
                        Export record
                      </button>
                    ) : null}
                  </div>
                </div>
              </aside>

              <div className="print-monitor">
                <div className="monitor-status">
                  <span
                    className={`monitor-icon ${status === "printing" ? "printing" : ""}`}
                  >
                    <Layers3 size={19} strokeWidth={1.5} />
                  </span>
                  <div>
                    <span>
                      {status === "ready"
                        ? "Ready"
                        : status === "complete"
                          ? "Complete"
                          : status === "paused"
                            ? "Paused"
                            : "Printing"}
                    </span>
                  </div>
                </div>
                <div className="monitor-progress">
                  <div>
                    <span>
                      <b aria-label="Print progress">
                        {Math.floor(progress * 100)}
                        <small>%</small>
                      </b>
                    </span>
                    <span className="time-code">
                      {timeLabel(progress * PRINT_PLAYBACK_SECONDS)}
                      <i>/</i>
                      {timeLabel(PRINT_PLAYBACK_SECONDS)}
                    </span>
                  </div>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-label="Print progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.floor(progress * 100)}
                  >
                    <i style={{ width: `${progress * 100}%` }} />
                  </div>
                </div>
                <div className="layer-count">
                  <span>Current layer</span>
                  <div>
                    {String(currentLayer).padStart(2, "0")}
                    <small>/ {LAYERS}</small>
                  </div>
                </div>
              </div>
            </div>

            <section className="gallery-band">
              <div className="gallery-heading">
                <div>
                  <h2>Gallery</h2>
                  <span className="collection-count">
                    {allWorks.length.toString().padStart(2, "0")}
                  </span>
                </div>
                <button
                  className="text-button"
                  onClick={() => changePage("gallery")}
                >
                  All works
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="gallery-grid compact">
                {allWorks.slice(0, 3).map((pottery, index) => (
                  <GalleryItem
                    key={pottery.id}
                    pottery={pottery}
                    index={index}
                    onOpen={() => setSelected(pottery)}
                  />
                ))}
              </div>
            </section>
          </main>
        ) : (
          <main className="collection-page">
            <div className="collection-page-heading">
              <div>
                <h1>
                  Gallery
                  <span>{allWorks.length.toString().padStart(2, "0")}</span>
                </h1>
              </div>
              <button
                className="outline-button"
                onClick={() => changePage("studio")}
              >
                <Plus size={16} />
                Back to studio
              </button>
            </div>
            <div className="collection-toolbar">
              <div className="tabs">
                <button
                  className={galleryFilter === "all" ? "selected" : ""}
                  onClick={() => setGalleryFilter("all")}
                >
                  All works <span>{allWorks.length}</span>
                </button>
                <button
                  className={galleryFilter === "mine" ? "selected" : ""}
                  onClick={() => setGalleryFilter("mine")}
                >
                  My collection <span>{collection.length}</span>
                </button>
              </div>
              <IconButton label="Import work archive" onClick={() => importRef.current?.click()}>
                <Upload size={18} />
              </IconButton>
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                aria-label="Work archive file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void importWork(file);
                }}
              />
            </div>
            {galleryFilter === "mine" && !collection.length ? (
              <div className="empty-collection">
                <GalleryHorizontalEnd size={38} strokeWidth={1} />
                <h2>No saved works yet</h2>
                <button
                  className="text-button"
                  onClick={() => changePage("studio")}
                >
                  Enter studio
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <div className="gallery-grid full">
                {(galleryFilter === "mine" ? collection : allWorks).map(
                  (pottery, index) => (
                    <GalleryItem
                      key={pottery.id}
                      pottery={pottery}
                      index={index}
                      onOpen={() => setSelected(pottery)}
                    />
                  ),
                )}
              </div>
            )}
          </main>
        )}
      </div>

      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section
            className="detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label={selected.title}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="detail-scene">
              <ClayScene
                key={selected.id}
                ref={detailRef}
                initial={selected}
                planned={false}
                autoRotate
              />
              <IconButton
                label="Close work"
                className="modal-close"
                onClick={() => setSelected(null)}
              >
                <X size={19} />
              </IconButton>
            </div>
            <div className="detail-info">
              <h2>{selected.title}</h2>
              <div className="detail-metadata">
                <span>{selected.preset ? "Studio study" : "My collection"}</span>
                <span>{Math.ceil(selected.steps / SEGMENTS)} layers</span>
                <span>{selected.duration.toFixed(1)} s</span>
              </div>
              <div className="detail-stats">
                <div>
                  <span>Mean supply fluctuation</span>
                  <b>
                    {meanSettings(selected).fluctuation}
                    <small>%</small>
                  </b>
                </div>
                <div>
                  <span>Mean supply interruption</span>
                  <b>
                    {meanSettings(selected).interruption}
                    <small>%</small>
                  </b>
                </div>
              </div>
              <div className="detail-chart-heading">
                <h3>Deposition history</h3>
                <span>
                  <i />
                  Fluctuation
                  <b />
                  Interruption
                </span>
              </div>
              <ProcessChart pottery={selected} />
              <div className="chart-axis">
                <span>Base / 00:00</span>
                <span>Top / {timeLabel(selected.duration)}</span>
              </div>
              <div className="process-meta">
                <span>Base form</span>
                <b>Cylinder</b>
                <span>Material</span>
                <b>Gray-white wet clay</b>
                <span>Physics</span>
                <b>{selected.simulation?.version === 4 ? "V4 · experimental height field" : `V${selected.simulation?.version ?? 1} · strand`}</b>
                <span>Print behavior</span>
                <b>{selected.memoryPrintPlan ? (selected.memoryPrintPlan.source === "demo" ? "Random scores · demo" : "Memory scores") : "Recorded process"}</b>
                <span>Process events</span>
                <b>{selected.events.length}</b>
              </div>
              <button
                className="primary-button"
                onClick={() => exportWork(selected)}
              >
                <ArrowDownToLine size={16} />
                Export work archive
                <ArrowRight size={16} />
              </button>
              <button
                className="text-button export-image"
                onClick={exportImage}
              >
                Save image
                <ArrowDownToLine size={14} />
              </button>
            </div>
          </section>
        </div>
      )}

      {nameOpen && (
        <div className="modal-backdrop" onClick={() => setNameOpen(false)}>
          <section
            className="small-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-title"
            onClick={(event) => event.stopPropagation()}
          >
            <IconButton
              label="Close save dialog"
              className="modal-close"
              onClick={() => setNameOpen(false)}
            >
              <X size={19} />
            </IconButton>
            <h2 id="save-title">Save work</h2>
            <label htmlFor="work-title">Work title</label>
            <input
              id="work-title"
              maxLength={28}
              value={workName}
              onChange={(event) => setWorkName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveWork();
              }}
            />
            <div className="save-meta">
              <span>{Math.ceil(currentPottery.steps / SEGMENTS)} layers</span>
              <span>{currentPottery.duration.toFixed(1)} s</span>
              <span>Process recorded</span>
            </div>
            <button className="primary-button" onClick={saveWork}>
              <Plus size={16} />
              Add to gallery
              <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}

      {processOpen && (
        <div className="modal-backdrop" onClick={() => setProcessOpen(false)}>
          <section
            className="small-modal process-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="process-title"
            onClick={(event) => event.stopPropagation()}
          >
            <IconButton
              label="Close process history"
              className="modal-close"
              onClick={() => setProcessOpen(false)}
            >
              <X size={19} />
            </IconButton>
            <h2 id="process-title">Process history</h2>
            <div className="detail-chart-heading">
              <h3>{status === "ready" ? `Study / ${currentPottery.title}` : "Current work"}</h3>
              <span>
                <i />
                Fluctuation
                <b />
                Interruption
              </span>
            </div>
            <ProcessChart
              pottery={currentPottery}
              currentStep={
                status === "ready" ? undefined : currentPottery.steps
              }
            />
            <div className="chart-axis">
              <span>Base</span>
              <span>Top</span>
            </div>
            <div className="event-list">
              {currentPottery.events.slice(-8).map((event, i) => (
                <div key={i}>
                  <span>
                    L
                    {String(Math.floor(event.step / SEGMENTS) + 1).padStart(
                      2,
                      "0",
                    )}
                  </span>
                  <span>
                    Fluctuation <b>{event.fluctuation}%</b>
                  </span>
                  <span>
                    Interruption <b>{event.interruption}%</b>
                  </span>
                  {(currentPottery.simulation?.version ?? 1) < 3 && event.sag && <span>Sag</span>}
                </div>
              ))}
            </div>
            <button
              className="primary-button"
              onClick={() => exportWork(currentPottery)}
            >
              <ArrowDownToLine size={16} />
              Export process history
              <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}

      {guideOpen && (
        <div className="modal-backdrop" onClick={closeGuide}>
          <section
            className="small-modal guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            onClick={(event) => event.stopPropagation()}
          >
            <IconButton
              label="Close guide"
              className="modal-close"
              onClick={closeGuide}
            >
              <X size={19} />
            </IconButton>
            <h2 id="guide-title">Memory, into clay.</h2>
            <p className="guide-method-note">Choose the collective arc or blend memory scores across the print. Random scores are a labeled demo, not analysis.</p>
            <ol className="guide-steps">
              <li>
                <div className="guide-symbol"><Sparkles size={26} /></div>
                <div><h3>Memories and scores</h3><p>Use the existing collective arc or let a complete set of memory scores shape the supply.</p></div>
              </li>
              <li>
                <div className="guide-symbol guide-mapping"><span>Base</span><span>Top</span></div>
                <div><h3>From base to rim</h3><p>Emotion changes only supply fluctuation and interruption; material properties stay fixed.</p></div>
              </li>
              <li>
                <div className="guide-symbol"><Pause size={26} /><Play size={26} /></div>
                <div><h3>Automatic printing</h3><p>No manual parameter controls. You can still pause, resume, or finish early.</p></div>
              </li>
            </ol>
            <p className="guide-method-note">The collective arc is a dramatic composition, not a shared chronology or diagnosis. Score-to-supply rules are artistic interpretations. Both physics modes are uncalibrated. The original strand model is V3. Experimental V4 adapts the Lab’s volume-conserving height field to the circular path: pressure spreads clay on a flat substrate, but it cannot represent overhangs, internal voids, fracture, or realistic layer grooves. A tall vessel exceeds its shallow-layer assumptions. Choose before printing; saved works retain their model.</p>
            <div className="guide-actions">
              <button className="primary-button" onClick={closeGuide}>
                <Check size={17} />Enter studio
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
