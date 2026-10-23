import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Camera,
  CameraOff,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { GestureController, readHands } from "./gestures";
import { acquireHandDetector, useHandModel } from "./handModel";
import type { GestureUpdate, PrintStatus, TrackedHand } from "./gestures";

type Props = {
  status: PrintStatus;
  suspended: boolean;
  onUpdate: (update: GestureUpdate) => void;
  onUnavailable: (message: string) => void;
  onClose: () => void;
};

const CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

function drawHands(canvas: HTMLCanvasElement, hands: TrackedHand[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const hand of hands) {
    ctx.strokeStyle = hand.side === "left" ? "#ff9479" : "#75e1cc";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(
        hand.points[a].x * canvas.width,
        hand.points[a].y * canvas.height,
      );
      ctx.lineTo(
        hand.points[b].x * canvas.width,
        hand.points[b].y * canvas.height,
      );
      ctx.stroke();
    }
    for (const p of hand.points) {
      ctx.beginPath();
      ctx.arc(p.x * canvas.width, p.y * canvas.height, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function cameraError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "摄像头权限未开启";
  if (name === "NotFoundError") return "未找到摄像头";
  if (name === "NotReadableError") return "摄像头正在被占用";
  return "手势识别暂不可用";
}

export function GestureCamera(props: Props) {
  const model = useHandModel();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [phase, setPhase] = useState<
    "permission" | "loading" | "tracking" | "error"
  >("permission");
  const [error, setError] = useState("");
  const [hands, setHands] = useState<TrackedHand[]>([]);
  const [feedback, setFeedback] = useState<GestureUpdate>({
    values: {},
    hold: 0,
    intent: null,
  });
  const [attempt, setAttempt] = useState(0);
  const [swap, setSwap] = useState(false);
  const swapRef = useRef(swap);
  swapRef.current = swap;
  const controller = useRef(new GestureController());

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let detector: HandLandmarker | null = null;
    let timer = 0;
    let watchdog = 0;
    let freshAt = performance.now();
    let stalled = false;
    let previousVideoTime = -1;
    let videoCallback = 0;
    let pendingFrame = false;
    let removeTrackListeners = () => {};
    const video = videoRef.current!;
    const input = document.createElement("canvas");
    const ctx = input.getContext("2d")!;
    controller.current.reset();
    setPhase("permission");
    setError("");

    function release() {
      clearTimeout(timer);
      clearInterval(watchdog);
      if (videoCallback) video.cancelVideoFrameCallback(videoCallback);
      removeTrackListeners();
      stream?.getTracks().forEach((track) => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
      detector?.close();
      detector = null;
    }
    function fail(message: string) {
      if (cancelled) return;
      release();
      setPhase("error");
      setError(message);
      setHands([]);
      setFeedback({ values: {}, hold: 0, intent: null });
      latest.current.onUnavailable(message);
    }
    function tick() {
      if (cancelled || !detector) return;
      try {
        const hasFrame =
          typeof video.requestVideoFrameCallback === "function"
            ? pendingFrame
            : video.currentTime !== previousVideoTime;
        if (!document.hidden && video.readyState >= 2 && hasFrame) {
          pendingFrame = false;
          previousVideoTime = video.currentTime;
          freshAt = performance.now();
          stalled = false;
          input.width = 480;
          input.height = Math.round(
            (480 * video.videoHeight) / video.videoWidth,
          );
          ctx.drawImage(video, 0, 0, input.width, input.height);
          const result = detector.detectForVideo(input, performance.now());
          const nextHands = readHands(
            result,
            input.width / input.height,
            swapRef.current,
          );
          const overlay = overlayRef.current;
          if (overlay) {
            if (overlay.width !== input.width) overlay.width = input.width;
            if (overlay.height !== input.height) overlay.height = input.height;
            drawHands(overlay, nextHands);
          }
          setHands(nextHands);
          if (latest.current.suspended) {
            controller.current.reset();
            setFeedback({ values: {}, hold: 0, intent: null });
          } else {
            const update = controller.current.update(
              nextHands,
              performance.now(),
              latest.current.status,
            );
            setFeedback(update);
            latest.current.onUpdate(update);
          }
        }
        timer = window.setTimeout(tick, 80);
      } catch {
        fail("手势识别已中断");
      }
    }
    function onHidden() {
      if (document.hidden) {
        controller.current.reset();
        latest.current.onUnavailable("已暂停，等待返回工坊");
      }
    }

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        fail(
          window.isSecureContext
            ? "此浏览器不支持摄像头"
            : "摄像头需要 HTTPS 或本机地址",
        );
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24, max: 30 },
          },
          audio: false,
        });
        if (cancelled) {
          release();
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) {
          release();
          return;
        }
        if (typeof video.requestVideoFrameCallback === "function") {
          const onFrame = () => {
            freshAt = performance.now();
            stalled = false;
            pendingFrame = true;
            videoCallback = video.requestVideoFrameCallback(onFrame);
          };
          videoCallback = video.requestVideoFrameCallback(onFrame);
        }
        setPhase("loading");
        detector = await acquireHandDetector();
        if (cancelled) {
          release();
          return;
        }
        const ended = () => fail("摄像头连接已断开");
        stream
          .getVideoTracks()
          .forEach((track) => track.addEventListener("ended", ended));
        removeTrackListeners = () =>
          stream
            ?.getVideoTracks()
            .forEach((track) => track.removeEventListener("ended", ended));
        setPhase("tracking");
        freshAt = performance.now();
        watchdog = window.setInterval(() => {
          if (
            !stalled &&
            !document.hidden &&
            performance.now() - freshAt > 2000
          ) {
            stalled = true;
            controller.current.reset();
            setHands([]);
            setFeedback({ values: {}, hold: 0, intent: null });
            latest.current.onUnavailable("摄像头画面已停止更新，打印已暂停");
          }
        }, 250);
        tick();
      } catch (error) {
        fail(cameraError(error));
      }
    }
    document.addEventListener("visibilitychange", onHidden);
    void start();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onHidden);
      release();
    };
  }, [attempt]);

  const label =
    phase === "permission"
      ? "等待摄像头授权"
      : phase === "loading"
        ? model.phase === "error" ? "模型加载失败" : "模型准备中"
        : phase === "error"
          ? error
          : props.suspended
            ? "控制已锁定"
            : hands.length
              ? `已识别 ${hands.length} 只手`
              : "等待手部进入";
  const commandLabel =
    feedback.intent === "pause"
      ? "暂停打印"
      : props.status === "paused"
        ? "继续打印"
        : "开始打印";

  return (
    <section className={`gesture-console ${phase}`} aria-label="手势识别控制台">
      <div className="gesture-heading">
        <Camera size={13} />
        <span>手势输入</span>
        <button
          aria-label="交换左右手"
          title="交换左右手"
          aria-pressed={swap}
          onClick={() => {
            controller.current.reset();
            setSwap(!swap);
          }}
        >
          <ArrowLeftRight size={13} />
        </button>
        <button
          aria-label="关闭摄像头"
          title="关闭摄像头"
          onClick={props.onClose}
        >
          <CameraOff size={13} />
        </button>
      </div>
      <div className="gesture-feed">
        <video ref={videoRef} playsInline muted aria-label="摄像头镜像预览" />
        <canvas ref={overlayRef} aria-label="手部骨架" />
        {(phase === "permission" || phase === "loading") && (
          <LoaderCircle className="gesture-spinner" size={20} />
        )}
        {phase === "error" && (
          <button
            className="gesture-retry"
            aria-label="重试手势识别"
            title="重试手势识别"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RotateCcw size={22} />
          </button>
        )}
      </div>
      <div className="gesture-state" role="status">
        {feedback.intent ? commandLabel : label}
      </div>
      <div
        className="gesture-hold"
        role="progressbar"
        aria-label="手势确认"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(feedback.hold * 100)}
      >
        <i style={{ width: `${feedback.hold * 100}%` }} />
      </div>
      <div className="gesture-channels">
        <span
          className={
            hands.some((h) => h.side === "left") ? "connected left" : ""
          }
        >
          <i />左 · 波动
        </span>
        <span
          className={
            hands.some((h) => h.side === "right") ? "connected right" : ""
          }
        >
          <i />右 · 中断
        </span>
      </div>
    </section>
  );
}
