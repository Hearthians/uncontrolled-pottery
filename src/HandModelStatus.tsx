import { Check, Hand, RotateCcw } from "lucide-react";
import { preloadHandModel } from "./handModel";
import type { HandModelState } from "./handModel";

export function HandModelStatus({ state }: { state: HandModelState }) {
  if (state.phase === "ready") return (
    <div className="model-ready" aria-label="手势模型就绪" title="手势模型就绪">
      <Hand size={16} /><Check size={12} />
    </div>
  );
  const percent = state.total ? Math.min(100, Math.floor(state.loaded / state.total * 100)) : 0;
  return (
    <div className={`model-loading ${state.phase}`}>
      <div className="model-loading-label" role="status">
        <span>{state.phase === "error" ? "模型加载失败" : state.phase === "initializing" ? "模型初始化" : "手势模型正在加载"}</span>
        {state.phase === "error" ? (
          <button aria-label="重试模型加载" title="重试模型加载" onClick={() => void preloadHandModel().catch(() => {})}>
            <RotateCcw size={15} />
          </button>
        ) : <span>{percent}%</span>}
      </div>
      <div className="model-progress" role="progressbar" aria-label="模型加载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
