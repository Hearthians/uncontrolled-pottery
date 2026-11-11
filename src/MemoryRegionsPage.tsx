import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ClayScene } from "./ClayScene";
import { loadMaterial } from "./depositLoader";
import { SEGMENTS } from "./simulation";
import type { Pottery } from "./pottery";
import {
  REGION_EXPERIMENT, compileRegionLayers, loadRegionStudy, regionPottery,
  type RegionLayer, type RegionStudy, type MemoryRegion,
} from "./memoryRegions";
import "./memoryRegions.css";

const COLORS = ["#95704b", "#6f8169", "#647e8b", "#a86450"];
const pct = (value: number) => `${(value * 100).toFixed(2)}%`;

function PotteryStill({ pottery, label }: { pottery: Pottery; label: string }) {
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  const [missing, setMissing] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    loadMaterial(pottery).then(({ deposits }) => {
      const body = deposits.slice(REGION_EXPERIMENT.foundationLayers * SEGMENTS, pottery.simulation!.stopStep);
      if (active) setMissing(body.filter(point => point.gap).length / body.length);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [pottery]);
  return <figure className="region-still" data-pottery-id={pottery.id} data-ready={image ? "true" : "false"}>
    <div className="region-object">
      {image ? <img src={image} alt={label} width="400" height="400" />
        : failed ? <p role="alert">试样预览生成失败。</p>
          : <><div aria-hidden="true"><ClayScene initial={pottery} miniature onSnapshot={setImage} onError={() => setFailed(true)} /></div>
            <p className="region-rendering" role="status">正在生成试样…</p></>}
    </div>
    <figcaption>{missing === null ? "计算沉积结果…" : <>欠料采样率 <strong>{pct(missing)}</strong></>}</figcaption>
  </figure>;
}

function AxisOverview({ study }: { study: RegionStudy }) {
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(280, element.clientWidth)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const x = (value: number) => 24 + value * (width - 48);
  const boundaries = [0, ...study.regions.slice(1).map((region, index) => (study.regions[index].max + region.min) / 2), 1];
  return <svg ref={svg} className="region-axis" viewBox={`0 0 ${width} 160`} role="img" aria-label="全部记忆在一维语义轴上的分布，四组由聚类边界分隔">
    {study.regions.map((region, i) => <g key={region.id}>
      <rect x={x(boundaries[i])} y="38" width={x(boundaries[i + 1]) - x(boundaries[i])} height="72" fill={COLORS[i % COLORS.length]} opacity="0.1" />
      {region.indices.map(index => <line key={index} x1={x(study.positions[index])} x2={x(study.positions[index])}
        y1="58" y2="102" stroke={COLORS[i % COLORS.length]} strokeOpacity="0.19" />)}
      <line x1={x(region.center)} x2={x(region.center)} y1="47" y2="111" stroke={COLORS[i % COLORS.length]} strokeWidth="2" />
      <text x={x((boundaries[i] + boundaries[i + 1]) / 2)} y={width < 640 ? 17 : 24} textAnchor="middle" fill={COLORS[i % COLORS.length]}>
        R{String(i + 1).padStart(2, "0")}{width < 640
          ? <tspan x={x((boundaries[i] + boundaries[i + 1]) / 2)} dy="17">{region.indices.length}</tspan>
          : ` · ${region.indices.length}`}
      </text>
    </g>)}
    {[0, 0.25, 0.5, 0.75, 1].map(value => <g key={value}>
      <line x1={x(value)} x2={x(value)} y1="112" y2="118" stroke="#aaa89e" />
      <text x={x(value)} y="139" textAnchor="middle">{value.toFixed(2)}</text>
    </g>)}
  </svg>;
}

function LayerTrace({ layers }: { layers: RegionLayer[] }) {
  const x = (layer: number) => 12 + layer / (layers.length - 1) * 276;
  const y = (value: number) => 76 - value * 65;
  const position = layers.filter(layer => layer.position !== null).map((layer, i) => `${i ? "L" : "M"}${x(layer.layer).toFixed(2)},${y(layer.position!).toFixed(2)}`).join(" ");
  const command = layers.map((layer, i) => `${i ? "L" : "M"}${x(layer.layer).toFixed(2)},${y(layer.interruption / 100).toFixed(2)}`).join(" ");
  return <svg className="region-trace" viewBox="0 0 300 100" role="img" aria-label="从底部到顶部的语义位置与断料指令，所有作品使用同一零到一刻度">
    {[0, 0.5, 1].map(value => <line key={value} x1="12" x2="288" y1={y(value)} y2={y(value)} stroke="#e4e2d9" strokeDasharray="2 3" />)}
    <path d={position} fill="none" stroke="var(--region-color)" strokeWidth="1.7" />
    <path d={command} fill="none" stroke="#454c45" strokeWidth="1.5" strokeDasharray="4 3" />
    <text x="12" y="96">底部</text><text x="288" y="96" textAnchor="end">顶部</text>
  </svg>;
}

function RegionWork({ region, index, study }: { region: MemoryRegion; index: number; study: RegionStudy }) {
  const layers = useMemo(() => compileRegionLayers(region.indices, study.positions), [region, study]);
  const pottery = useMemo(() => regionPottery(region.id, layers), [region.id, layers]);
  const average = layers.reduce((sum, layer) => sum + layer.interruption * layer.activeSteps, 0) /
    layers.reduce((sum, layer) => sum + layer.activeSteps, 0);
  return <article className="region-work" style={{ "--region-color": COLORS[index % COLORS.length] } as CSSProperties}>
    <header><h2>R{String(index + 1).padStart(2, "0")}</h2><span>{region.indices.length} 条记忆</span></header>
    <PotteryStill pottery={pottery} label={`第 ${index + 1} 组记忆生成的固定圆筒试样`} />
    <div className="region-work-meta"><span>s = {region.min.toFixed(3)}–{region.max.toFixed(3)}</span><span>平均指令 {average.toFixed(1)} / 100</span></div>
    <LayerTrace layers={layers} />
    <div className="region-trace-key"><span>语义位置 s</span><span>断料指令 I / 100</span></div>
  </article>;
}

function Study({ study, texts }: { study: RegionStudy; texts: string[] }) {
  const control = useMemo(() => regionPottery("control"), []);
  const retained = pct(study.projection.explainedVariance);
  return <>
    <header className="regions-topline"><a href={location.pathname}>← 失控陶坊</a><span>MEMORY STUDY / 01</span><span>一维分组 · 固定基形</span></header>
    <section className="regions-intro">
      <div><p className="regions-eyebrow">从原文出发</p><h1>记忆，在一条线上。</h1><p className="regions-description">{study.count.toLocaleString()} 条记忆，{study.regions.length} 个区域，{study.regions.length} 件试样。<br />同一个圆筒，记忆只改变供料的连续性。</p></div>
      <dl className="regions-facts"><div><dt>文本向量</dt><dd>{study.embedding.dimensions.toLocaleString()} → 1 <small>维</small></dd></div>
        <div><dt>保留的向量方差</dt><dd>{retained}</dd></div><div><dt>共同条件</dt><dd>Ø 100 <small>mm</small><span>64 层 · Seed {REGION_EXPERIMENT.seed}</span></dd></div></dl>
    </section>
    <section className="regions-distribution" aria-labelledby="regions-axis-title">
      <div className="regions-section-line"><h2 id="regions-axis-title">01 / 记忆的位置</h2><p>每条细线是一条记忆，深色线为组中心。</p></div>
      <AxisOverview study={study} />
      <p className="regions-axis-note">坐标两端没有预设情绪含义。4 组是本轮实验设定；一维投影保留 {retained} 的向量方差，分组仍需结合原文判断。</p>
    </section>
    <section className="regions-works" aria-labelledby="regions-works-title">
      <div className="regions-section-line"><h2 id="regions-works-title">02 / 同一基形的四次沉积</h2><p>固定视角 · 固定材料 · 同一断料规则</p></div>
      <div className="regions-work-grid">{study.regions.map((region, index) => <RegionWork key={region.id} region={region} index={index} study={study} />)}</div>
      <p className="regions-axis-note">曲线横轴是打印进度，纵轴统一为 0–1。欠料采样率统计记忆承载段中未沉积材料的路径采样，排除基底与停料收尾；它不是孔洞面积比。</p>
    </section>
    <section className="regions-decoder" aria-labelledby="regions-decoder-title">
      <div className="region-control"><span className="regions-eyebrow">CONTROL / 连续供料对照</span><PotteryStill pottery={control} label="同一圆筒、同一 Seed、不施加断料指令的对照试样" /></div>
      <div className="regions-decoder-copy"><p className="regions-eyebrow">一维坐标如何留下痕迹</p><h2 id="regions-decoder-title">一条规则，贯穿所有区域。</h2>
        <p className="regions-formula">I(h) = round(90 × s(h)²)</p>
        <p>每组保留语料文件中的顺序，将记忆等长铺到基底之后、停料之前的打印路径，重叠部分按比例汇总为 s(h)。前两层使用连续供料。所有组共用全体记忆的坐标范围。</p>
        <p>断料指令 I 进入现有供料模型，再经过气压和余流响应形成实际沉积。基础路径、材料与随机 Seed 固定；曲线不是孔洞比例的直接预测。</p>
        <p className="regions-method-note">这是人工设定的 decoder，不是训练出的物理规律。轴的正负方向按固定算法约定，较大的坐标不代表更负面。语料顺序用于复现编排，不代表共同时间线。</p>
      </div>
    </section>
    <section className="regions-originals" aria-labelledby="regions-originals-title">
      <div className="regions-section-line"><h2 id="regions-originals-title">03 / 回到原文</h2><p>每组展示最接近原始向量中心的 3 条记忆。</p></div>
      <div className="regions-original-grid">{study.regions.map((region, index) => <article key={region.id} style={{ "--region-color": COLORS[index % COLORS.length] } as CSSProperties}>
        <header><h3>R{String(index + 1).padStart(2, "0")}</h3><p>组内平均余弦相似度 {region.meanPairwiseCosine.toFixed(3)}<br /><span>全体基线 {study.baselineMeanCosine.toFixed(3)}{region.meanPairwiseCosine < study.baselineMeanCosine ? " · 低于基线，组内较混杂" : ""}</span></p></header>
        {region.representatives.map(memoryIndex => <blockquote key={memoryIndex}><p>{texts[memoryIndex]}</p><cite>原文 #{memoryIndex + 1} · s = {study.positions[memoryIndex].toFixed(3)}</cite></blockquote>)}
      </article>)}</div>
    </section>
    <footer className="regions-footer"><p>方法：已有文本向量 → L2 归一化 → PCA 第一主成分 → 最优一维 k-means（k = 4）→ 全局断料映射 → v3 材料原型。</p>
      <p>原文与坐标已通过 SHA-256 匹配。此试验使用近似材料模拟，尚未经实体打印验证。</p>
      <a href={`${import.meta.env.BASE_URL}memory-regions.json`} download>分组与坐标记录 ↓</a>
    </footer>
  </>;
}

export default function MemoryRegionsPage() {
  const [data, setData] = useState<{ study: RegionStudy; texts: string[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    loadRegionStudy(controller.signal).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "实验载入失败。"); });
    return () => controller.abort();
  }, []);
  return <main className="memory-regions-page" lang="zh-CN">
    {data ? <Study {...data} /> : <div className="regions-loading"><a href={location.pathname}>← 失控陶坊</a><h1>记忆，在一条线上。</h1>
      <p role={error ? "alert" : "status"}>{error || "正在载入原文与一维坐标…"}</p></div>}
  </main>;
}
