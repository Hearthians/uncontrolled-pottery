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
import {
  COLLECTIVE_EMOTION_PLAN,
  emotionAtStep,
  emotionPlanToEvents,
} from "./emotionTrajectory";
import { createArchive, MAX_ARCHIVE_BYTES, parseArchive } from "./archive";

type Status = "ready" | "printing" | "paused" | "complete";
type Page = "studio" | "gallery";
const STORAGE_KEY = "uncontrolled-pottery-v1";
const GUIDE_KEY = "uncontrolled-pottery-guide-v1";
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
    <div className="process-chart" aria-label="打印过程参数记录">
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
      aria-label={`查看作品：${pottery.title}`}
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
            {pottery.preset ? "工坊试作" : "我的收藏"} <i />{" "}
            {Math.ceil(pottery.steps / SEGMENTS)} 层
          </span>
        </div>
        <div className="gallery-values">
          <span>波动 {settings.fluctuation}%</span>
          <span>中断 {settings.interruption}%</span>
        </div>
      </div>
    </button>
  );
}

export default function App() {
  const initialEmotion = COLLECTIVE_EMOTION_PLAN.trajectory[0];
  const [page, setPage] = useState<Page>("studio");
  const [status, setStatus] = useState<Status>("ready");
  const [currentEmotion, setCurrentEmotion] = useState(initialEmotion);
  const [progress, setProgress] = useState(0);
  const [planned, setPlanned] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [view, setView] = useState<"perspective" | "front" | "top">(
    "perspective",
  );
  const [viewMenu, setViewMenu] = useState(false);
  const [collection, setCollection] = useState<Pottery[]>(readCollection);
  const [selected, setSelected] = useState<Pottery | null>(null);
  const [guideOpen, setGuideOpen] = useState(() => {
    try { return localStorage.getItem(GUIDE_KEY) !== "seen"; }
    catch { return true; }
  });
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
    engine: PlasticSimulation;
    elapsed: number;
  } | null>(null);
  const allWorks = [...collection, ...PRESETS];
  const currentPottery = runRef.current?.pottery ?? PRESETS[0];
  const currentLayer = runRef.current ? Math.min(LAYERS, Math.ceil(currentPottery.steps / SEGMENTS)) : 0;
  const isActive = status === "printing" || status === "paused";
  const finishing = !!runRef.current && runRef.current.engine.tick >= runRef.current.engine.stopStep;

  const notify = (message: string) => setNotice(message);
  function closeGuide() {
    setGuideOpen(false);
    try { localStorage.setItem(GUIDE_KEY, "seen"); } catch {}
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
      engine.advanceTo(Math.floor(run.elapsed / DURATION * MATERIAL_TICKS), run.pottery.events);
      // Match the last deposited layer's event on the original 64-layer plan.
      // Neither early-stop runout nor settling should fast-forward the emotion arc.
      const emotion = emotionAtStep(Math.max(0, engine.deposits.length - 1), run.pottery.emotionPlan);
      const simulated = profileRef.current ? performance.now() : 0;
      sceneRef.current?.append(engine.deposits, engine.dirtyStart, engine.nozzle);
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
        setCurrentEmotion(emotion);
        uiTime = now;
      }
      if (engine.complete) {
        setStatus("complete");
        notify("打印完成");
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [status]);

  function startPrint() {
    const seed = Math.floor(Math.random() * 100000);
    const engine = new PlasticSimulation(seed);
    const events = emotionPlanToEvents();
    setCurrentEmotion(COLLECTIVE_EMOTION_PLAN.trajectory[0]);
    const pottery: Pottery = {
      id:
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `pottery-${Date.now()}-${seed}`,
      title: COLLECTIVE_EMOTION_PLAN.title,
      seed,
      steps: 0,
      events,
      createdAt: new Date().toISOString(),
      duration: 0,
      simulation: engine.record(),
      emotionPlan: structuredClone(COLLECTIVE_EMOTION_PLAN),
    };
    runRef.current = { pottery, engine, elapsed: 0 };
    setProgress(0);
    setSavedId(null);
    setAutoRotate(false);
    setView("perspective");
    sceneRef.current?.reset();
    setStatus("printing");
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
      notify("已加入作品画廊");
    } catch {
      notify("收藏空间已满，请先导出作品记录。");
    }
  }

  function exportWork(pottery: Pottery) {
    const data = createArchive(pottery);
    download(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `${pottery.title}-过程.json`,
    );
    notify("作品与参数记录已导出");
  }

  async function importWork(file: File) {
    try {
      if (file.size > MAX_ARCHIVE_BYTES) throw new Error("Archive too large");
      const pottery = parseArchive(await file.text());
      const existing = collection.find((work) => work.id === pottery.id);
      if (existing) {
        setSelected(existing);
        notify("作品已在收藏中");
        return;
      }
      const next = [pottery, ...collection];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setCollection(next);
      setGalleryFilter("mine");
      setSelected(pottery);
      notify("作品已导入");
    } catch {
      notify("无法导入，请检查记录版本与收藏空间");
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
      notify("作品正在重建");
      return;
    }
    const a = document.createElement("a");
    a.href = data;
    a.download = `${selected?.title ?? "陶器"}.webp`;
    a.click();
  }

  function changePage(next: Page) {
    if (next === "gallery" && status === "printing") setStatus("paused");
    setPage(next);
    setGalleryFilter("all");
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await studioRef.current?.requestFullscreen();
    } catch {
      notify("当前浏览器未开启全屏模式");
    }
  }

  return (
    <div className="app-shell">
      <aside className="nav-rail">
        <button
          className="brand-symbol"
          aria-label="返回工坊"
          onClick={() => changePage("studio")}
        >
          <Layers3 size={27} strokeWidth={1.6} />
        </button>
        <div className="rail-links">
          <button
            className={page === "studio" ? "rail-item selected" : "rail-item"}
            onClick={() => changePage("studio")}
            aria-label="打印工坊"
            title="打印工坊"
          >
            <Box size={22} strokeWidth={1.5} />
            <span>工坊</span>
          </button>
          <button
            className={page === "gallery" ? "rail-item selected" : "rail-item"}
            onClick={() => changePage("gallery")}
            aria-label="作品画廊"
            title="作品画廊"
          >
            <GalleryHorizontalEnd size={22} strokeWidth={1.5} />
            <span>画廊</span>
          </button>
          <button
            className="rail-item"
            onClick={() => setProcessOpen(true)}
            aria-label="过程记录"
            title="过程记录"
          >
            <AudioLines size={22} strokeWidth={1.5} />
            <span>记录</span>
          </button>
        </div>
        <div className="rail-bottom">
          <IconButton label="操作引导" onClick={() => {
            if (status === "printing") setStatus("paused");
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
              失控陶坊<span className="brand-dot">.</span>
            </span>
          </button>
          <div className="topbar-tools">
            <IconButton label="操作引导" onClick={() => {
              if (status === "printing") setStatus("paused");
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
                <h1>打印工坊</h1>
              </div>
              <div className="heading-actions">
                <span className="session-label">
                  {COLLECTIVE_EMOTION_PLAN.memoryCount} 条集体记忆
                </span>
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
                  autoRotate={autoRotate}
                  printing={isActive}
                  onError={() => setWebglError(true)}
                />
                <div className="viewport-top">
                  <div className="live-status">
                    <span className={`status-dot ${status}`} />
                    <span>
                      {status === "ready"
                        ? "预览"
                        : status === "printing"
                          ? finishing ? "正在收尾" : "正在沉积"
                          : status === "paused"
                            ? "打印已暂停"
                            : "打印完成"}
                    </span>
                  </div>
                  <IconButton label="全屏" onClick={toggleFullscreen}>
                    <Expand size={18} />
                  </IconButton>
                </div>
                {webglError && (
                  <div className="webgl-error">
                    <Box size={30} />
                    <p>三维画面需要启用 WebGL</p>
                    <button onClick={() => location.reload()}>重新加载</button>
                  </div>
                )}
                {status === "ready" && !webglError && (
                  <button
                    className="scene-start-button"
                    aria-label="从工作台开始打印"
                    onClick={startPrint}
                  >
                    <Play size={16} fill="currentColor" />
                    <span>开始创作</span>
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
                        ? "透视视图"
                        : view === "front"
                          ? "正面视图"
                          : "俯视视图"}
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
                              {["透视视图", "正面视图", "俯视视图"][i]}
                              {view === option && <Check size={13} />}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                  <div className="canvas-tools">
                    <IconButton
                      label={planned ? "隐藏原始路径" : "显示原始路径"}
                      active={planned}
                      onClick={() => setPlanned(!planned)}
                    >
                      {planned ? <Eye size={17} /> : <EyeOff size={17} />}
                    </IconButton>
                    <IconButton
                      label="自动旋转"
                      active={autoRotate}
                      onClick={() => setAutoRotate(!autoRotate)}
                    >
                      <RotateCw size={17} />
                    </IconButton>
                    <span />
                    <IconButton
                      label="重置视角"
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

              <aside className="control-panel emotion-panel">
                <div className="panel-heading">
                  <div>
                    <Sparkles size={17} />
                    <h2>记忆轨迹</h2>
                  </div>
                  <span>AGENT DIRECTED</span>
                </div>
                <div className="emotion-plan-copy">
                  <span>{COLLECTIVE_EMOTION_PLAN.memoryCount} 条集体记忆</span>
                  <h3>{COLLECTIVE_EMOTION_PLAN.title}</h3>
                  <p>{COLLECTIVE_EMOTION_PLAN.summary}</p>
                </div>
                <div className="emotion-stage" aria-live="polite">
                  <span>{status === "ready" ? "起始阶段" : "当前情绪"}</span>
                  <h3>{currentEmotion.label}</h3>
                  <div>
                    <i style={{ "--emotion-value": `${(currentEmotion.valence + 1) * 50}%` } as React.CSSProperties} />
                    <i style={{ "--emotion-value": `${currentEmotion.arousal * 100}%` } as React.CSSProperties} />
                    <i style={{ "--emotion-value": `${currentEmotion.dominance * 100}%` } as React.CSSProperties} />
                  </div>
                  <small>效价 · 唤醒 · 控制</small>
                </div>
                <div className="emotion-timeline" aria-label="十二阶段情绪轨迹">
                  {COLLECTIVE_EMOTION_PLAN.trajectory.map((point) => (
                    <i
                      key={point.position}
                      className={point.position <= currentEmotion.position ? "passed" : ""}
                      style={{ left: `${point.position * 100}%` }}
                      title={point.label}
                    />
                  ))}
                </div>
                <div className="print-actions">
                  {status === "ready" && (
                    <button className="primary-button" onClick={startPrint}>
                      <Play size={17} fill="currentColor" />
                      <span>开始打印</span>
                      <span className="button-time">55 s</span>
                    </button>
                  )}
                  {status === "printing" && (
                    <button
                      className="primary-button"
                      onClick={() => setStatus("paused")}
                    >
                      <Pause size={17} fill="currentColor" />
                      <span>暂停打印</span>
                      <span className="button-time">
                        {Math.max(0, Math.ceil(DURATION * (1 - progress)))} s
                      </span>
                    </button>
                  )}
                  {status === "paused" && (
                    <button
                      className="primary-button"
                      onClick={() => setStatus("printing")}
                    >
                      <Play size={17} fill="currentColor" />
                      <span>继续打印</span>
                      <span className="button-time">
                        {Math.max(0, Math.ceil(DURATION * (1 - progress)))} s
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
                      <span>{savedId ? "已加入画廊" : "收藏这件作品"}</span>
                      <GalleryHorizontalEnd size={17} />
                    </button>
                  )}
                  <div className="secondary-actions">
                    {status !== "ready" && (
                      <button
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
                        {isActive ? "结束本次" : "再次打印"}
                      </button>
                    )}
                    {status === "complete" ? (
                      <button onClick={() => exportWork(currentPottery)}>
                        <ArrowDownToLine size={13} />
                        导出记录
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
                        ? "就绪"
                        : status === "complete"
                          ? "已完成"
                          : status === "paused"
                            ? "已暂停"
                            : "打印中"}
                    </span>
                  </div>
                </div>
                <div className="monitor-progress">
                  <div>
                    <span>
                      打印进度{" "}
                      <b>
                        {Math.floor(progress * 100)}
                        <small>%</small>
                      </b>
                    </span>
                    <span className="time-code">
                      {timeLabel(progress * DURATION)}
                      <i>/</i>
                      {timeLabel(DURATION)}
                    </span>
                  </div>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-label="打印进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.floor(progress * 100)}
                  >
                    <i style={{ width: `${progress * 100}%` }} />
                  </div>
                </div>
                <div className="layer-count">
                  <span>当前层数</span>
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
                  <h2>作品画廊</h2>
                  <span className="collection-count">
                    {allWorks.length.toString().padStart(2, "0")}
                  </span>
                </div>
                <button
                  className="text-button"
                  onClick={() => changePage("gallery")}
                >
                  全部作品
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
                  作品画廊
                  <span>{allWorks.length.toString().padStart(2, "0")}</span>
                </h1>
              </div>
              <button
                className="outline-button"
                onClick={() => changePage("studio")}
              >
                <Plus size={16} />
                回到工坊
              </button>
            </div>
            <div className="collection-toolbar">
              <div className="tabs">
                <button
                  className={galleryFilter === "all" ? "selected" : ""}
                  onClick={() => setGalleryFilter("all")}
                >
                  全部作品 <span>{allWorks.length}</span>
                </button>
                <button
                  className={galleryFilter === "mine" ? "selected" : ""}
                  onClick={() => setGalleryFilter("mine")}
                >
                  我的收藏 <span>{collection.length}</span>
                </button>
              </div>
              <IconButton label="导入作品记录" onClick={() => importRef.current?.click()}>
                <Upload size={18} />
              </IconButton>
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                aria-label="作品记录文件"
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
                <h2>暂无收藏</h2>
                <button
                  className="text-button"
                  onClick={() => changePage("studio")}
                >
                  进入工坊
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
                label="关闭作品"
                className="modal-close"
                onClick={() => setSelected(null)}
              >
                <X size={19} />
              </IconButton>
            </div>
            <div className="detail-info">
              <h2>{selected.title}</h2>
              <div className="detail-metadata">
                <span>{selected.preset ? "工坊试作" : "我的收藏"}</span>
                <span>{Math.ceil(selected.steps / SEGMENTS)} 层</span>
                <span>{selected.duration.toFixed(1)} s</span>
              </div>
              <div className="detail-stats">
                <div>
                  <span>平均供料波动</span>
                  <b>
                    {meanSettings(selected).fluctuation}
                    <small>%</small>
                  </b>
                </div>
                <div>
                  <span>平均供料中断</span>
                  <b>
                    {meanSettings(selected).interruption}
                    <small>%</small>
                  </b>
                </div>
              </div>
              <div className="detail-chart-heading">
                <h3>沉积过程</h3>
                <span>
                  <i />
                  波动
                  <b />
                  中断
                </span>
              </div>
              <ProcessChart pottery={selected} />
              <div className="chart-axis">
                <span>底部 / 00:00</span>
                <span>顶部 / {timeLabel(selected.duration)}</span>
              </div>
              <div className="process-meta">
                <span>基础形态</span>
                <b>圆筒</b>
                <span>材料</span>
                <b>灰白湿泥</b>
                <span>过程节点</span>
                <b>{selected.events.length} 次</b>
              </div>
              <button
                className="primary-button"
                onClick={() => exportWork(selected)}
              >
                <ArrowDownToLine size={16} />
                导出作品记录
                <ArrowRight size={16} />
              </button>
              <button
                className="text-button export-image"
                onClick={exportImage}
              >
                保存作品图像
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
              label="关闭收藏"
              className="modal-close"
              onClick={() => setNameOpen(false)}
            >
              <X size={19} />
            </IconButton>
            <h2 id="save-title">收藏作品</h2>
            <label htmlFor="work-title">作品名称</label>
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
              <span>{Math.ceil(currentPottery.steps / SEGMENTS)} 层</span>
              <span>{currentPottery.duration.toFixed(1)} s</span>
              <span>过程已记录</span>
            </div>
            <button className="primary-button" onClick={saveWork}>
              <Plus size={16} />
              加入作品画廊
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
              label="关闭过程记录"
              className="modal-close"
              onClick={() => setProcessOpen(false)}
            >
              <X size={19} />
            </IconButton>
            <h2 id="process-title">过程记录</h2>
            <div className="detail-chart-heading">
              <h3>{status === "ready" ? "试作 / 秩序之外" : "当前作品"}</h3>
              <span>
                <i />
                波动
                <b />
                中断
              </span>
            </div>
            <ProcessChart
              pottery={currentPottery}
              currentStep={
                status === "ready" ? undefined : currentPottery.steps
              }
            />
            <div className="chart-axis">
              <span>底部</span>
              <span>顶部</span>
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
                    波动 <b>{event.fluctuation}%</b>
                  </span>
                  <span>
                    中断 <b>{event.interruption}%</b>
                  </span>
                  {currentPottery.simulation?.version !== 3 && event.sag && <span>下垂</span>}
                </div>
              ))}
            </div>
            <button
              className="primary-button"
              onClick={() => exportWork(currentPottery)}
            >
              <ArrowDownToLine size={16} />
              导出过程记录
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
              label="关闭引导"
              className="modal-close"
              onClick={closeGuide}
            >
              <X size={19} />
            </IconButton>
            <h2 id="guide-title">让集体记忆留下形状</h2>
            <ol className="guide-steps">
              <li>
                <div className="guide-symbol"><Sparkles size={26} /></div>
                <div><h3>Agent 编排记忆</h3><p>1910 条匿名记忆被整理为十二段情绪轨迹</p></div>
              </li>
              <li>
                <div className="guide-symbol guide-mapping"><span>底</span><span>顶</span></div>
                <div><h3>轨迹从底部走向顶部</h3><p>情绪只改变供料波动与中断；材料性质始终相同</p></div>
              </li>
              <li>
                <div className="guide-symbol"><Pause size={26} /><Play size={26} /></div>
                <div><h3>系统自动打印</h3><p>创作参数不需手动控制；仍可暂停、继续或结束</p></div>
              </li>
            </ol>
            <p className="guide-method-note">{COLLECTIVE_EMOTION_PLAN.methodNote}</p>
            <div className="guide-actions">
              <button className="primary-button" onClick={closeGuide}>
                <Check size={17} />进入工坊
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
