"use strict";

const $ = (id) => document.getElementById(id);
const ENTRY_TYPES = {post: "原帖", story: "原帖", comment: "评论", reply: "回复", question: "问题", answer: "回答", video_description: "视频简介"};
const PLATFORM_SYMBOLS = {weibo: "微", xiaohongshu: "红", x: "𝕏", nowcoder: "牛", bilibili: "哔", zhihu: "知", hackernews: "H", workplace: "W", mastodon: "M", reddit: "R", bluesky: "B"};
const SENTIMENTS = {
  positive: {label: "正面", color: "#70a997", background: "#edf5f0"},
  negative: {label: "负面", color: "#da876e", background: "#fcf0eb"},
  neutral: {label: "中性", color: "#a1b1c3", background: "#f0f3f7"},
  mixed: {label: "混合", color: "#b5a3ca", background: "#f4f0f8"},
  uncertain: {label: "不确定", color: "#c3aa80", background: "#f8f4ea"},
};
const EMOTIONS = ["焦虑", "挫败", "愤怒", "失望", "期待", "喜悦", "平静", "不确定", "未明确表达"];
const state = {data: null, dataset: "combined", platform: "all", year: "all", unit: "percent", query: "", sentiment: "all", relevance: "all", topic: null, emotion: null, page: 1, anxietyMin: 0, anxietyMax: 1, anxietyBin: null, anxietyStatus: "all", sort: "time"};
const PAGE_SIZE = 6;
const PLATFORM_SOURCES = [
  {id: "xiaohongshu", label: "小红书", dataset: "balanced"},
  {id: "weibo", label: "微博", dataset: "balanced"},
  {id: "hackernews", label: "Hacker News", dataset: "overseas-employment"},
  {id: "workplace", label: "The Workplace", dataset: "overseas-employment"},
  {id: "nowcoder", label: "牛客", dataset: "additional-chinese"},
  {id: "mastodon", label: "Mastodon", dataset: "overseas-employment"},
  {id: "x", label: "X / Twitter", dataset: "balanced"},
  {id: "bilibili", label: "哔哩哔哩", dataset: "additional-chinese"},
  {id: "zhihu", label: "知乎", dataset: "additional-chinese"},
  {id: "reddit", label: "Reddit", dataset: "overseas-employment"},
  {id: "bluesky", label: "Bluesky", dataset: "overseas-employment"},
];
const COMBINED_PLATFORMS = new Set(["weibo", "xiaohongshu", "nowcoder", "hackernews", "workplace", "mastodon"]);
const sourceForPlatform = (platform, preferred = state.dataset) => preferred === "combined" && (platform === "all" || COMBINED_PLATFORMS.has(platform)) ? "combined" : platform === "all" ? preferred
  : platform === "xiaohongshu" && preferred === "xiaohongshu-available" ? preferred
  : PLATFORM_SOURCES.find((item) => item.id === platform)?.dataset || preferred;
const navigationFromURL = () => {
  const query = new URL(window.location.href).searchParams;
  const requested = query.get("platform");
  const dataset = query.get("dataset") || "combined";
  const platform = requested === "all" ? "all" : PLATFORM_SOURCES.some((item) => item.id === requested) ? requested
    : dataset === "xiaohongshu-available" ? "xiaohongshu" : "all";
  return {dataset: sourceForPlatform(platform, dataset), platform};
};
let requestController = null;
let toastTimer;
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const number = (value) => new Intl.NumberFormat("zh-CN").format(value);
const percent = (count, total) => total ? `${(100 * count / total).toFixed(1)}%` : "—";
const labelled = (post) => post.analysis && typeof post.analysis.relevant === "boolean";
const relevant = (post) => labelled(post) && post.analysis.relevant;
const list = (value) => Array.isArray(value) ? value : [];
const years = () => state.data?.meta?.years || [...new Set(list(state.data?.posts).map((p) => p.season_year))].sort();
const platforms = () => list(state.data?.meta?.platforms);
const platformName = (id) => PLATFORM_SOURCES.find((platform) => platform.id === id)?.label || id;
const defaultPlatform = () => state.dataset === "xiaohongshu-available" ? "xiaohongshu" : "all";
const isOverseas = () => state.dataset === "overseas-employment" || state.data?.summary?.study_scope === "overseas_employment";
const isCombined = () => state.dataset === "combined";
const publicationYear = () => isCombined() || isOverseas();
const defaultRelevance = () => isCombined() ? "all" : "relevant";
const ANXIETY_STATUS = {scored: "已评分", unassessable: "无法判断", pending: "待评分", error: "评分失败"};
const anxietyOf = (post) => {
  const value = post.anxiety;
  if (value?.status === "scored" && typeof value.score === "number" && Number.isFinite(value.score) && value.score >= 0 && value.score <= 1) return value;
  return {status: ["unassessable", "pending", "error"].includes(value?.status) ? value.status : "pending", score: null, evidence: [], reason: value?.reason || "", confidence: typeof value?.confidence === "number" ? value.confidence : null, model: value?.model || "", prompt_version: value?.prompt_version || ""};
};
const anxietyNumber = (value) => typeof value === "number" ? value.toFixed(2) : "—";
const yearLabel = () => state.year === "all" ? "全部年份" : `${state.year} 年`;
const platformLabel = () => state.platform === "all"
  ? state.data?.meta?.available_datasets?.find((item) => item.id === state.dataset)?.label || "汇总"
  : platformName(state.platform);
const scope = (includeYear = true) => state.data.posts.filter((p) => (state.platform === "all" || p.platform === state.platform) && (!includeYear || state.year === "all" || p.season_year === state.year));
const relatedInYear = (year) => scope(false).filter((p) => p.season_year === year && relevant(p));
const countTags = (posts, field) => posts.reduce((counts, post) => {
  for (const tag of list(post.analysis?.[field])) counts[tag] = (counts[tag] || 0) + 1;
  return counts;
}, {});
const dateLabel = (value, includeTime = false) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期未知";
  return new Intl.DateTimeFormat("zh-CN", {timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", ...(includeTime ? {hour: "2-digit", minute: "2-digit", hour12: false} : {})}).format(date);
};
const studyWindow = () => {
  const window = state.data?.meta?.window || {};
  const startMonth = window.start_month || 8, startDay = window.start_day || 1;
  const end = new Date(Date.UTC(2000, (window.end_month || 11) - 1, window.end_day || 18) - 86400000);
  const endMonth = end.getUTCMonth() + 1, endDay = end.getUTCDate();
  const pad = (value) => String(value).padStart(2, "0");
  return {short: `${pad(startMonth)}.${pad(startDay)} — ${pad(endMonth)}.${pad(endDay)}`, long: `${startMonth} 月 ${startDay} 日至 ${endMonth} 月 ${endDay} 日`};
};
const entryLabel = (post) => ENTRY_TYPES[post.entry_type] || post.entry_type || "原帖";
const languageLabel = (language) => language === "en" ? "英文原文" : language === "zh" || language?.startsWith("zh-") ? "中文原文" : language ? `${language} 原文` : "";
const regionLabel = (region) => ({China: "中国", china: "中国", international_unspecified: "国际（地区未明确）", overseas_unspecified: "海外（地区未明确）"}[region] || region || "");

function notify(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 2800);
}

function renderPlatformNavigation() {
  const counts = {};
  if (isCombined() && state.data) {
    for (const post of state.data.posts) counts[post.platform] = (counts[post.platform] || 0) + 1;
  }
  const ordered = [...PLATFORM_SOURCES].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
  $("platforms").innerHTML = `<button type="button" data-platform="all" aria-pressed="false" title="查看当前样本范围汇总">汇总</button>${ordered.map((platform) => `<button type="button" data-platform="${platform.id}" aria-pressed="false">${escapeHTML(platform.label)}</button>`).join("")}`;
}

function renderSampleMode() {
  const mode = $("xhs-sample-mode"), balanced = state.dataset === "balanced";
  mode.hidden = state.platform !== "xiaohongshu";
  mode.textContent = "按年样本";
  mode.classList.toggle("active", balanced);
  mode.setAttribute("aria-pressed", String(balanced));
  mode.title = balanced ? "切换至完整可用样本" : "切换至按年配额样本";
}

function updateNavigationURL(historyMode = "replace") {
  if (historyMode === "none") return;
  const url = new URL(window.location.href);
  if (state.dataset === "combined") url.searchParams.delete("dataset");
  else url.searchParams.set("dataset", state.dataset);
  if (state.platform === "all" && state.dataset !== "xiaohongshu-available") url.searchParams.delete("platform");
  else url.searchParams.set("platform", state.platform);
  if (historyMode === "push" && url.href !== window.location.href) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

async function loadData(dataset = state.dataset, historyMode = "replace", platform = state.platform) {
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  const datasetChanged = dataset !== state.dataset;
  state.dataset = dataset;
  if (datasetChanged) Object.assign(state, {relevance: defaultRelevance(), anxietyMin: 0, anxietyMax: 1, anxietyBin: null, anxietyStatus: "all", sort: "time"});
  state.platform = platform;
  state.data = null;
  $("download").disabled = true;
  $("error").hidden = true;
  $("loading").hidden = false;
  $("dashboard").hidden = true;
  document.body.classList.add("is-loading");
  $("main").setAttribute("aria-busy", "true");
  updatePressed("platforms", "data-platform", state.platform);
  renderSampleMode();
  try {
    const response = await fetch(`/api/dashboard?dataset=${encodeURIComponent(state.dataset)}`, {signal: controller.signal, cache: "no-store"});
    const data = await response.json();
    if (controller !== requestController) return;
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "本地数据读取失败，请先完成样本导出。");
    if (!Array.isArray(data.posts) || !Array.isArray(data.summary?.groups)) throw new Error("导出数据格式不完整，请重新导出后刷新。");
    if (data.dataset !== state.dataset) throw new Error("返回的数据范围不匹配，请刷新后重试。");
    state.data = data;
    if (isCombined()) renderPlatformNavigation();
    state.page = 1;
    state.topic = null;
    state.emotion = null;
    if (state.platform !== "all" && !platforms().some((item) => item.id === state.platform)) state.platform = defaultPlatform();
    if (state.year !== "all" && !years().includes(state.year)) state.year = "all";
    $("years").innerHTML = `<button data-year="all" aria-pressed="false">全部年份</button>${years().map((year) => `<button data-year="${year}" aria-pressed="false">${year}</button>`).join("")}`;
    $("updated-at").textContent = `数据更新于 ${dateLabel(data.meta.updated_at, true)}`;
    $("footer-updated").textContent = `数据快照 · ${dateLabel(data.meta.updated_at, true)}`;
    $("limitations").innerHTML = list(data.summary.limitations).map((item) => `<li>${escapeHTML(item)}</li>`).join("");
    $("model-note").textContent = `自动标注模型：${data.summary.model} · 提示版本：${data.summary.prompt_version} · 原文依据经逐字校验，未全量人工复核。`;
    const annualYears = years(), heading = isCombined() ? "就业讨论里的焦虑" : isOverseas() ? "海外就业里的声音" : "秋招里的声音";
    $("study-scope").textContent = isCombined() ? "全平台就业讨论 · 合并去重" : isOverseas() ? "海外英文就业讨论" : "秋季校园招聘";
    $("page-title").innerHTML = `${heading}<span>${annualYears.length ? `${annualYears[0]}—${annualYears.at(-1)}` : "暂无年份"}</span>`;
    $("page-intro").textContent = data.summary.description || (isOverseas() ? "独立观察英文就业讨论，保留来源语境与英文原文。" : "从真实讨论出发，观察不同年份的话题与情绪。");
    document.title = `${isCombined() ? "就业讨论观察" : isOverseas() ? "海外就业观察" : "秋招观察"} · 焦虑程度与年度话题`;
    const studyDates = studyWindow();
    $("window-label").innerHTML = `${studyDates.short} <span>· 北京时间</span>`;
    $("method-scope").textContent = isCombined()
      ? `按原始发表时间划分发表年份，窗口为北京时间 ${studyDates.long}。六个平台已按帖子 ID 合并去重，保留来源、内容类型和原文语言。`
      : isOverseas()
      ? `按原始发表时间划分年份，窗口为北京时间 ${studyDates.long}。这是独立的英文就业讨论样本，包含原帖、评论、问题与回答，不代表中国秋季校园招聘。`
      : `按原始发表时间划分秋招年份，窗口为北京时间 ${studyDates.long}。主样本与小红书补充集有重叠；国内补充来源单独展示，各范围不相加。`;
    $("dashboard").hidden = false;
    render(historyMode);
  } catch (error) {
    if (error.name === "AbortError") return;
    $("error").textContent = `${error.message} 可点击“刷新数据”重试。`;
    $("error").hidden = false;
  } finally {
    if (controller === requestController) {
      $("loading").hidden = true;
      document.body.classList.remove("is-loading");
      $("main").setAttribute("aria-busy", "false");
    }
  }
}

function updatePressed(container, attribute, value) {
  for (const button of $(container).querySelectorAll(`[${attribute}]`)) {
    const active = button.getAttribute(attribute) === String(value);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function render(historyMode = "replace") {
  if (!state.data) return;
  hideTooltip();
  updateNavigationURL(historyMode);
  renderSampleMode();
  updatePressed("platforms", "data-platform", state.platform);
  updatePressed("years", "data-year", state.year);
  updatePressed("units", "data-unit", state.unit);
  $("scope-label").textContent = `${platformLabel()} · ${yearLabel()}`;
  const posts = scope(), related = posts.filter(relevant), negative = related.filter((p) => p.analysis.sentiment === "negative").length;
  $("metric-selected").textContent = number(posts.length);
  $("metric-labelled").textContent = `已标注 ${number(posts.filter(labelled).length)} / ${number(posts.length)} 条`;
  $("metric-relevant").textContent = number(related.length);
  $("metric-negative").innerHTML = related.length ? `${(100 * negative / related.length).toFixed(1)}<small>%</small>` : "—";
  $("metric-denominator").textContent = related.length ? `${negative} 条负面 / ${related.length} 条相关讨论` : "暂无相关讨论，无法计算比例";
  const covered = new Set(posts.map((p) => p.season_year)).size;
  $("metric-years").innerHTML = `${covered}<small>/ ${state.year === "all" ? years().length : 1}</small>`;
  $("metric-year-detail").textContent = state.year === "all" ? "按原始发表年份归属" : `${state.year} 年 · 共 ${new Set(posts.map((p) => p.published_at.slice(0, 10))).size} 个发表日期`;
  const groups = state.data.summary.groups;
  const context = [];
  const weiboDates = groups.filter((g) => g.platform === "weibo" && g.selected && Number.isFinite(g.publication_date_count)).map((g) => g.publication_date_count);
  if (weiboDates.length) {
    const minimum = Math.min(...weiboDates), maximum = Math.max(...weiboDates);
    context.push(`微博各年覆盖 ${minimum === maximum ? minimum : `${minimum}—${maximum}`} 个日期`);
  }
  if (groups.some((g) => g.platform === "xiaohongshu" && g.shortfall > 0)) context.push("小红书历史配额不足");
  if (groups.some((g) => g.platform === "x") && !groups.some((g) => g.platform === "x" && g.selected)) context.push("X 尚无样本");
  const contextPrefix = context.length ? `${context.join("；")}。` : "";
  const largest = [...groups].sort((a, b) => b.selected - a.selected)[0];
  const latestYear = years().at(-1);
  if (isCombined()) {
    $("context-title").textContent = "全平台合并集 · 同帖去重";
    $("context-text").textContent = `${state.data.summary.selected} 条记录来自六个平台，原帖、评论、问题与回答按原始发表时间归年。相同帖子仅计一次，原有相关性和分类标签均保留。`;
    $("coverage-note").textContent = "显示各平台各发表年份实际收录条数，不套用原始样本的年度配额。";
    $("method-specific").textContent = "合并集包含中文校园求职与海外一般就业讨论，保留平台和内容语境；当前图表描述已收录记录，不能代表整个就业市场。";
  } else if (state.dataset === "balanced") {
    $("context-title").textContent = "先看样本，再看变化";
    $("context-text").textContent = `${contextPrefix}图表描述已采讨论，不能代表整个市场。`;
    $("coverage-note").textContent = `数量达到配额，也不等于相关讨论已足额。空缺年份保留缺口${latestYear ? `，${latestYear} 年为阶段样本` : ""}。`;
    $("method-specific").textContent = `${contextPrefix}方便样本不能用来估计整体市场情绪。`;
  } else if (state.dataset === "xiaohongshu-available") {
    $("context-title").textContent = "补充集 · 年份分布不均衡";
    $("context-text").textContent = `${state.data.summary.selected} 条候选中有 ${largest?.selected || 0} 条来自 ${largest?.season_year || "—"} 年；本集与按年样本有重叠，请分别阅读，不相加计数。`;
    $("coverage-note").textContent = "补充集保留可用条目，可以超过原定配额。历史缺口仍保留，不以近期帖子补齐。";
    const emptyYears = groups.filter((group) => !group.selected).map((group) => group.season_year);
    $("method-specific").textContent = `小红书补充集偏重 ${largest?.season_year || "—"} 年${emptyYears.length ? `，${emptyYears.join("、")} 年没有样本` : ""}；与主样本重叠。历史比较请保留年份分布与缺口。`;
  } else if (isOverseas()) {
    $("context-title").textContent = state.data.summary.study_name || "海外英文就业讨论 · 独立比较";
    $("context-text").textContent = `${state.data.summary.selected} 条候选来自海外平台的英文就业讨论，包含不同地区与职业阶段；与中国秋招样本分开解读，英文原文保持原样。`;
    $("coverage-note").textContent = "覆盖数按讨论条目计；同一主题内可有多条评论或回答。零样本与配额缺口均如实保留。";
    $("method-specific").textContent = "英文就业话题可能涉及招聘、裁员、在职经历等；不等同于中国秋招。同一主题的多条发言不视为相互独立的受访者，平台与年份占比不能代表总体市场。";
  } else {
    $("context-title").textContent = state.data.summary.study_name || "国内平台补充 · 独立样本";
    $("context-text").textContent = `${state.data.summary.selected} 条候选来自${platforms().map((platform) => platform.label).join("、")}。作为国内平台补充集独立阅读，保留各年缺口与来源差异。`;
    $("coverage-note").textContent = "原帖、问题与视频简介按各自内容类型保留；候选足额不等于相关讨论足额，未采到的年份不作补齐。";
    $("method-specific").textContent = "国内补充来源采用独立数据范围，平台的用户群体与内容形式不同。年份和平台差异可能来自可见性与采集方式，不能据此推断整体秋招市场。";
  }
  const targets = [...new Set(groups.map((group) => group.target).filter((target) => Number.isFinite(target) && target > 0))];
  $("coverage-target").textContent = isCombined() ? "实际收录条数" : targets.length === 1 ? `每年 ${targets[0]} 条 / 平台` : "配额按分组显示";
  $("coverage-subtitle").textContent = isCombined() ? "按平台与发表年份统计，点击可筛选" : "候选条数 / 原定配额，点击可筛选";
  $("coverage-key").innerHTML = isCombined() ? `<span><i class="key-dot complete"></i>已有样本</span><span><i class="key-dot empty"></i>尚无样本</span>` : `<span><i class="key-dot complete"></i>配额已满</span><span><i class="key-dot partial"></i>存在缺口</span><span><i class="key-dot empty"></i>尚无样本</span>`;
  renderAnnual();
  renderCoverage();
  renderTopics(related);
  renderEmotions();
  renderAnxiety();
  renderPosts();
}

function renderAnnual() {
  $("sentiment-legend").innerHTML = Object.values(SENTIMENTS).map((value) => `<span><i style="background:${value.color}"></i>${value.label}</span>`).join("");
  const series = years().map((year) => {
    const posts = relatedInYear(year);
    return {year, n: posts.length, counts: Object.fromEntries(Object.keys(SENTIMENTS).map((key) => [key, posts.filter((p) => p.analysis.sentiment === key).length]))};
  });
  const width = 660, height = 279, left = 45, top = 32, bottom = 237, plotHeight = bottom - top;
  const maximum = state.unit === "percent" ? 100 : Math.max(4, Math.ceil(Math.max(...series.map((s) => s.n), 1) / 4) * 4);
  const step = (width - left - 15) / series.length, barWidth = Math.min(53, step * .45);
  let svg = `<svg class="annual-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(platformLabel())}年度情感分布，${state.unit === "percent" ? "占比" : "条数"}，点击年份筛选">`;
  for (let i = 0; i <= 4; i++) {
    const value = maximum * i / 4, y = bottom - plotHeight * i / 4;
    svg += `<line x1="${left}" y1="${y}" x2="${width - 10}" y2="${y}" stroke="#edf1ef" stroke-dasharray="${i ? "3 5" : "none"}"/><text x="${left - 12}" y="${y + 3}" text-anchor="end" fill="#a4b1b0" font-size="9">${state.unit === "percent" ? `${value}%` : Number(value.toFixed(1))}</text>`;
  }
  for (const [index, entry] of series.entries()) {
    const x = left + step * (index + .5), active = state.year === entry.year;
    if (active) svg += `<rect x="${x - step * .43}" y="${top - 22}" width="${step * .86}" height="${plotHeight + 59}" rx="8" fill="#e9f2ed" opacity=".55"/>`;
    let stacked = 0;
    if (entry.n) {
      for (const [key, value] of Object.entries(SENTIMENTS)) {
        const count = entry.counts[key];
        if (!count) continue;
        const amount = state.unit === "percent" ? 100 * count / entry.n : count;
        const h = plotHeight * amount / maximum, y = bottom - plotHeight * stacked / maximum - h;
        svg += `<rect class="chart-cell" tabindex="0" role="button" aria-label="${entry.year}年${value.label} ${count}条，占相关讨论${percent(count, entry.n)}" data-chart-sentiment="${key}" data-chart-year="${entry.year}" data-tooltip="${escapeHTML(`${entry.year} 年 · ${value.label}|${count} 条 · ${percent(count, entry.n)}|分母：${entry.n} 条相关讨论`)}" x="${x - barWidth / 2}" y="${y}" width="${barWidth}" height="${h}" fill="${value.color}" opacity="${state.year === "all" || active ? 1 : .48}"/>`;
        stacked += amount;
      }
      const topY = bottom - plotHeight * (state.unit === "percent" ? 100 : entry.n) / maximum;
      svg += `<text x="${x}" y="${topY - 12}" text-anchor="middle" font-size="9" fill="#89a095">n=${entry.n}</text>`;
    } else {
      svg += `<rect x="${x - barWidth / 2}" y="${bottom - 16}" width="${barWidth}" height="16" rx="3" fill="#f5f7f7" stroke="#e2e9e6" stroke-dasharray="3 3"/><text x="${x}" y="${bottom - 30}" text-anchor="middle" font-size="9" fill="#b3bfbc">无相关数据</text>`;
    }
    svg += `<text class="year-label" tabindex="0" role="button" aria-label="选择${entry.year}年" data-chart-year="${entry.year}" x="${x}" y="${bottom + 24}" text-anchor="middle" font-size="11" fill="${active ? "#17766b" : "#8b9c99"}" font-weight="${active ? 700 : 400}">${entry.year}</text>`;
  }
  $("sentiment-chart").innerHTML = svg + "</svg>";
}

function renderCoverage() {
  let content = `<div></div>${years().map((year) => `<div class="coverage-year">${year}</div>`).join("")}`;
  for (const {id: platform, label} of platforms()) {
    content += `<div class="coverage-platform" title="${escapeHTML(label)}"><i class="platform-dot ${escapeHTML(platform)}"></i>${escapeHTML(platform === "x" ? "X" : label)}</div>`;
    for (const year of years()) {
      const group = state.data.summary.groups.find((g) => g.platform === platform && g.season_year === year);
      const count = group?.selected || 0, target = group?.target || 40;
      const status = !count ? "empty" : isCombined() || count >= target ? "complete" : "partial";
      const selected = state.platform === platform && state.year === year;
      const coverageDescription = isCombined() ? `实际收录 ${count} 条` : `候选 ${count} / 原定 ${target} 条`;
      content += `<button class="coverage-cell ${status}${selected ? " selected" : ""}" data-coverage-platform="${escapeHTML(platform)}" data-coverage-year="${year}" aria-label="${escapeHTML(label)} ${year}年，${coverageDescription}${!count ? "，无样本" : ""}" data-tooltip="${escapeHTML(`${label} · ${year}|${coverageDescription}|模型判相关 ${group?.relevant || 0} 条`)}"><strong>${count ? number(count) : "—"}</strong><small>${count ? isCombined() ? "条" : `/ ${target}` : "无样本"}</small></button>`;
    }
  }
  $("coverage").innerHTML = content;
}

function renderTopics(posts) {
  const counts = Object.entries(countTags(posts, "topics")).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).slice(0, 8);
  $("topics-subtitle").textContent = `${platformLabel()} · ${yearLabel()} · ${posts.length} 条相关讨论`;
  if (!posts.length) {
    $("topic-chart").innerHTML = `<div class="empty-state"><span class="empty-icon">≋</span><strong>暂无可比较的话题</strong>当前平台与年份没有相关讨论。<br>可切换年份或平台查看已有样本。</div>`;
    return;
  }
  $("topic-chart").innerHTML = counts.map(([name, count], index) => {
    const value = state.unit === "percent" ? percent(count, posts.length) : `${count} 条`;
    const width = state.unit === "percent" ? 100 * count / posts.length : 100 * count / (counts[0]?.[1] || 1);
    return `<button class="topic-row${state.topic === name ? " active" : ""}" data-topic="${escapeHTML(name)}" aria-label="筛选话题${escapeHTML(name)}，${count}条" data-tooltip="${escapeHTML(`${name}|${count} 条 · ${percent(count, posts.length)}|分母：${posts.length} 条相关讨论`)}"><span class="topic-meta"><span class="topic-name"><span>${String(index + 1).padStart(2, "0")}</span>${escapeHTML(name)}</span><span class="topic-value">${value}<small>${state.unit === "percent" ? `${count} 条` : percent(count, posts.length)}</small></span></span><span class="topic-track"><span class="topic-fill" style="width:${width}%"></span></span></button>`;
  }).join("");
}

function emotionCount(posts, emotion) {
  return posts.filter((p) => emotion === "未明确表达" ? list(p.analysis.emotions).length === 0 : list(p.analysis.emotions).includes(emotion)).length;
}

function renderEmotions() {
  const data = years().map((year) => ({year, posts: relatedInYear(year)}));
  const maxCount = Math.max(...data.flatMap((entry) => EMOTIONS.map((emotion) => emotionCount(entry.posts, emotion))), 1);
  let html = `<div class="heatmap"><div></div>${years().map((year) => `<div class="heatmap-year">${year}</div>`).join("")}`;
  for (const emotion of EMOTIONS) {
    html += `<div class="emotion-name${emotion === "未明确表达" ? " missing" : ""}">${emotion}</div>`;
    for (const entry of data) {
      const n = entry.posts.length, count = emotionCount(entry.posts, emotion);
      const intensity = n ? Math.min(1, state.unit === "percent" ? count / n / .6 : count / maxCount) : 0;
      const background = `rgb(${Math.round(244 - 191 * intensity)},${Math.round(248 - 113 * intensity)},${Math.round(245 - 134 * intensity)})`;
      const active = state.year === entry.year && state.emotion === emotion;
      html += `<button class="heat-cell${!n ? " no-data" : ""}${active ? " active" : ""}" data-emotion="${emotion}" data-emotion-year="${entry.year}" ${!n ? "disabled" : ""} style="background:${n ? background : "#f5f7f8"};color:${n ? intensity > .66 ? "#fff" : "#86a291" : "#bdc6ca"}" aria-label="${entry.year}年${emotion}，${n ? `${count}条，占${percent(count,n)}` : "无相关样本"}" data-tooltip="${escapeHTML(`${entry.year} 年 · ${emotion}|${n ? `${count} 条 · ${percent(count, n)}` : "暂无相关样本"}|${n ? `分母：${n} 条相关讨论` : "无法计算比例"}`)}">${!n ? "—" : state.unit === "percent" ? `${Math.round(100 * count / n)}%` : count}</button>`;
    }
  }
  $("emotion-chart").innerHTML = html + "</div>";
}

function filteredPosts() {
  let posts = scope();
  if (state.relevance === "relevant") posts = posts.filter(relevant);
  if (state.relevance === "review") posts = posts.filter((p) => !labelled(p) || p.analysis.confidence < .7 || p.analysis.sentiment === "uncertain");
  if (state.sentiment !== "all") posts = posts.filter((p) => p.analysis?.sentiment === state.sentiment);
  if (state.topic) posts = posts.filter((p) => list(p.analysis?.topics).includes(state.topic));
  if (state.emotion) posts = posts.filter((p) => labelled(p) && (state.emotion === "未明确表达" ? !list(p.analysis.emotions).length : list(p.analysis.emotions).includes(state.emotion)));
  const query = state.query.trim().toLocaleLowerCase();
  if (query) posts = posts.filter((p) => `${p.text} ${list(p.analysis?.evidence).join(" ")} ${list(anxietyOf(p).evidence).join(" ")}`.toLocaleLowerCase().includes(query));
  if (state.anxietyStatus !== "all") posts = posts.filter((p) => anxietyOf(p).status === state.anxietyStatus);
  if (state.anxietyMin > 0 || state.anxietyMax < 1 || state.anxietyBin !== null) posts = posts.filter((p) => {
    const anxiety = anxietyOf(p);
    return anxiety.status === "scored" && anxiety.score >= state.anxietyMin && (state.anxietyBin !== null && state.anxietyBin < 9 ? anxiety.score < state.anxietyMax : anxiety.score <= state.anxietyMax);
  });
  return posts;
}

function matchingPosts() {
  return filteredPosts().sort((a, b) => {
    if (state.sort !== "time") {
      const first = anxietyOf(a), second = anxietyOf(b);
      if (first.status === "scored" && second.status !== "scored") return -1;
      if (second.status === "scored" && first.status !== "scored") return 1;
      if (first.status === "scored" && second.status === "scored" && first.score !== second.score) return (first.score - second.score) * (state.sort === "anxiety-desc" ? -1 : 1);
    }
    return b.published_at.localeCompare(a.published_at) || String(a.post_id).localeCompare(String(b.post_id));
  });
}

function renderAnxiety() {
  const posts = filteredPosts(), scored = posts.map(anxietyOf).filter((value) => value.status === "scored");
  const scores = scored.map((value) => value.score).sort((a, b) => a - b);
  const count = (status) => posts.filter((post) => anxietyOf(post).status === status).length;
  const unknown = count("unassessable"), pending = count("pending"), failed = count("error");
  const middle = Math.floor(scores.length / 2);
  const median = scores.length ? scores.length % 2 ? scores[middle] : (scores[middle - 1] + scores[middle]) / 2 : null;
  $("anxiety-scope").textContent = `${platformLabel()} · ${yearLabel()} · 当前筛选`;
  $("anxiety-progress").textContent = `${scores.length + unknown} / ${posts.length}`;
  $("anxiety-progress-detail").textContent = `已评分 ${scores.length} 条，无法判断 ${unknown} 条`;
  $("anxiety-mean").textContent = anxietyNumber(scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null);
  $("anxiety-median").textContent = anxietyNumber(median);
  $("anxiety-denominator").textContent = `分母：${scores.length} 条有效评分，含零分`;
  $("anxiety-unknown").textContent = number(unknown);
  $("anxiety-pending").textContent = `待评分 ${pending} 条，失败 ${failed} 条`;
  $("anxiety-min").value = state.anxietyMin;
  $("anxiety-max").value = state.anxietyMax;
  $("anxiety-status").value = state.anxietyStatus;
  $("post-sort").value = state.sort;
  const bins = Array(10).fill(0);
  for (const score of scores) bins[Math.min(9, Math.floor(score * 10))]++;
  const width = 600, height = 235, left = 40, right = 580, top = 26, bottom = 190;
  const maximum = Math.max(1, ...bins), plotHeight = bottom - top, step = (right - left) / 10;
  let histogram = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="当前筛选中${scores.length}条有效评分的焦虑程度分布">`;
  for (let i = 0; i <= 4; i++) {
    const y = bottom - plotHeight * i / 4;
    histogram += `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#e8efeb"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${Number((maximum * i / 4).toFixed(1))}</text>`;
  }
  bins.forEach((n, i) => {
    const x = left + i * step + 5, h = n / maximum * plotHeight, label = `${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}${i < 9 ? "（不含右端）" : "（含1）"}`;
    histogram += `<g role="button" tabindex="0" data-anxiety-bin="${i}" aria-label="焦虑${label}，${n}条，点击筛选" data-tooltip="${escapeHTML(`焦虑 ${label}|${n} 条|分母：${scores.length} 条有效评分`)}"><rect class="anxiety-bin-hit" x="${left + i * step}" y="${top}" width="${step}" height="${bottom - top}" fill="transparent"/><rect x="${x}" y="${bottom - h}" width="${step - 10}" height="${h}" rx="3" fill="${state.anxietyBin === i ? "#17766b" : "#86b29e"}"/><text x="${x + (step - 10) / 2}" y="${bottom - h - 5}" text-anchor="middle">${n || ""}</text></g>`;
  });
  for (let i = 0; i <= 10; i += 2) histogram += `<text x="${left + i * step}" y="${bottom + 22}" text-anchor="middle">${(i / 10).toFixed(1)}</text>`;
  if (!scores.length) histogram += `<text x="${width / 2}" y="${top + 55}" text-anchor="middle">当前筛选没有有效评分</text>`;
  $("anxiety-histogram").innerHTML = histogram + "</svg>";
  const series = years().map((year) => {
    const values = posts.filter((post) => post.season_year === year).map(anxietyOf).filter((value) => value.status === "scored").map((value) => value.score);
    return {year, n: values.length, mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null};
  });
  const yearStep = (right - left) / Math.max(series.length, 1);
  let annual = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="当前筛选各发表年份的平均焦虑程度，固定0到1尺度">`;
  for (let i = 0; i <= 4; i++) {
    const y = bottom - plotHeight * i / 4;
    annual += `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#e8efeb"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${(i / 4).toFixed(2)}</text>`;
  }
  let previous = null;
  series.forEach((entry, i) => {
    const x = left + yearStep * (i + .5), y = entry.mean === null ? null : bottom - entry.mean * plotHeight;
    if (previous && y !== null) annual += `<line x1="${previous.x}" y1="${previous.y}" x2="${x}" y2="${y}" stroke="#86b29e" stroke-width="2"/>`;
    if (y !== null) {
      annual += `<g tabindex="0" role="button" data-anxiety-year="${entry.year}" aria-label="${entry.year}年，平均焦虑${entry.mean.toFixed(2)}，${entry.n}条有效评分" data-tooltip="${escapeHTML(`${entry.year} 年|平均焦虑 ${entry.mean.toFixed(2)}|分母：${entry.n} 条有效评分`)}"><circle cx="${x}" cy="${y}" r="15" fill="transparent"/><circle cx="${x}" cy="${y}" r="5" fill="#17766b"/><text x="${x}" y="${y - 14}" text-anchor="middle">${entry.mean.toFixed(2)}</text><text x="${x}" y="${bottom + 17}" text-anchor="middle">${entry.year}</text><text x="${x}" y="${bottom + 34}" text-anchor="middle">n=${entry.n}</text></g>`;
      previous = {x, y};
    } else {
      annual += `<text x="${x}" y="${bottom - 15}" text-anchor="middle">无有效评分</text><text x="${x}" y="${bottom + 17}" text-anchor="middle">${entry.year}</text><text x="${x}" y="${bottom + 34}" text-anchor="middle">n=0</text>`;
      previous = null;
    }
  });
  $("anxiety-annual").innerHTML = annual + "</svg>";
}

function anxietyCard(post) {
  const anxiety = anxietyOf(post), scored = anxiety.status === "scored";
  return `<div class="post-anxiety" data-anxiety-status="${anxiety.status}"><div class="post-anxiety-label"><span>焦虑程度</span><strong>${scored ? anxiety.score.toFixed(2) : ANXIETY_STATUS[anxiety.status]}</strong><span class="post-anxiety-track" aria-hidden="true">${scored ? `<i style="width:${anxiety.score * 100}%"></i>` : ""}</span><small>${scored ? "0–1" : "未计入均值"}</small></div>${anxiety.reason || list(anxiety.evidence).length ? `<details class="anxiety-evidence"><summary>查看评分依据与说明</summary>${list(anxiety.evidence).map((quote) => `<blockquote>${escapeHTML(quote)}</blockquote>`).join("")}${anxiety.reason ? `<p>${escapeHTML(anxiety.reason)}</p>` : ""}<p class="anxiety-model">${escapeHTML(anxiety.model || "")}${anxiety.prompt_version ? ` · ${escapeHTML(anxiety.prompt_version)}` : ""}${typeof anxiety.confidence === "number" ? ` · 模型自评可判读程度 ${Math.round(anxiety.confidence * 100)}%` : ""}</p></details>` : ""}</div>`;
}

function renderPosts() {
  const posts = matchingPosts(), pages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  $("voice-count").textContent = `${posts.length} 条`;
  $("sentiment-filter").value = state.sentiment;
  $("relevance-filter").value = state.relevance;
  const chips = [];
  if (state.topic) chips.push(`<button class="filter-tag" data-clear="topic">话题 · ${escapeHTML(state.topic)}<span>×</span></button>`);
  if (state.emotion) chips.push(`<button class="filter-tag" data-clear="emotion">情绪 · ${escapeHTML(state.emotion)}<span>×</span></button>`);
  if (state.anxietyMin > 0 || state.anxietyMax < 1 || state.anxietyBin !== null) chips.push(`<button class="filter-tag" data-anxiety-reset="true">焦虑 · ${state.anxietyMin.toFixed(2)}–${state.anxietyMax.toFixed(2)}${state.anxietyBin !== null && state.anxietyBin < 9 ? "（不含右端）" : ""}<span>×</span></button>`);
  $("active-tags").innerHTML = chips.join("");
  $("active-tags").hidden = !chips.length;
  const pagePosts = posts.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  $("post-list").innerHTML = pagePosts.length ? pagePosts.map((post, index) => {
    const analysis = post.analysis;
    const sentiment = analysis && relevant(post) ? SENTIMENTS[analysis.sentiment] : null;
    const label = sentiment?.label || (labelled(post) ? "不相关" : "待标注");
    const statusStyle = `color:${sentiment?.color || "#9ba9a3"};background:${sentiment?.background || "#f3f6f4"}`;
    const symbol = PLATFORM_SYMBOLS[post.platform] || platformName(post.platform).slice(0, 1);
    const metadata = [dateLabel(post.published_at), `${post.season_year} ${publicationYear() ? "年" : "秋招"}`, entryLabel(post), languageLabel(post.language), regionLabel(post.market_region)].filter(Boolean).join(" · ");
    return `<article class="post-card" data-entry-type="${escapeHTML(post.entry_type || "post")}"><div class="post-header"><span class="platform-badge ${escapeHTML(post.platform)}"><i>${escapeHTML(symbol)}</i>${escapeHTML(platformName(post.platform))}</span><span class="post-date">${escapeHTML(metadata)}</span><span class="post-sentiment" style="${statusStyle}">${label}</span>${analysis ? `<span class="post-confidence">原标签置信度 ${Math.round(analysis.confidence * 100)}%</span>` : ""}</div><p class="post-body" id="post-body-${index}" lang="${escapeHTML(post.language || (isOverseas() ? "en" : "zh-CN"))}">${escapeHTML(post.text)}</p><button class="expand-button" data-expand="post-body-${index}" aria-expanded="false">展开全文 ↓</button>${analysis && list(analysis.evidence).length ? `<p class="post-evidence" title="${escapeHTML(analysis.evidence.join(" / "))}"><span>标注依据</span>${escapeHTML(analysis.evidence.map((s) => `「${s}」`).join(" · "))}</p>` : ""}${anxietyCard(post)}<div class="post-bottom">${list(analysis?.topics).map((topic) => `<button class="post-tag" data-topic="${escapeHTML(topic)}">${escapeHTML(topic)}</button>`).join("")}${list(analysis?.emotions).map((emotion) => `<button class="post-tag emotion" data-emotion="${escapeHTML(emotion)}">${escapeHTML(emotion)}</button>`).join("")}${post.url ? `<a class="source-link" href="${escapeHTML(post.url)}" target="_blank" rel="noopener noreferrer">${["post", "story"].includes(post.entry_type || "post") ? "查看原帖" : "查看原文"} ↗</a>` : ""}</div></article>`;
  }).join("") : `<div class="empty-state"><span class="empty-icon">◌</span><strong>${scope().length ? "没有匹配的讨论" : "这个范围还没有样本"}</strong>${scope().length ? "试试其他关键词，或清除话题、情绪筛选。" : "已保留真实缺口，可切换年份或平台查看已有数据。"}</div>`;
  $("pagination-info").textContent = posts.length ? `显示 ${(state.page - 1) * PAGE_SIZE + 1}—${Math.min(state.page * PAGE_SIZE, posts.length)} 条，共 ${posts.length} 条` : "0 条匹配结果";
  $("page-number").textContent = `${state.page} / ${pages}`;
  $("previous").disabled = state.page <= 1;
  $("next").disabled = state.page >= pages;
  $("download").disabled = !posts.length;
}

function changeScope(platform, year) {
  if (platform !== undefined) state.platform = platform;
  if (year !== undefined) state.year = year;
  state.page = 1;
  const dataset = platform === undefined ? state.dataset : sourceForPlatform(state.platform, "combined");
  if (dataset !== state.dataset || !state.data) return loadData(dataset, "push", state.platform);
  render(platform !== undefined ? "push" : "replace");
}

function resetFilters() {
  Object.assign(state, {platform: defaultPlatform(), year: "all", query: "", sentiment: "all", relevance: defaultRelevance(), topic: null, emotion: null, page: 1, anxietyMin: 0, anxietyMax: 1, anxietyBin: null, anxietyStatus: "all", sort: "time"});
  $("search").value = "";
  render();
}

function downloadCSV() {
  if (!state.data || state.data.dataset !== state.dataset || document.body.classList.contains("is-loading")) return;
  const posts = matchingPosts();
  if (!posts.length) return;
  const columns = ["平台", publicationYear() ? "发表年份" : "秋招年份", "发表时间", "正文", "相关性", "话题", "情感", "情绪", "置信度", "依据", "原文链接", "内容类型", "语言", "市场范围", "主题ID", "父级ID", "焦虑程度", "焦虑评分状态", "焦虑评分依据", "焦虑评分说明", "焦虑评分模型", "焦虑评分版本", "焦虑评分可判读程度"];
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/u.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = posts.map((p) => [platformName(p.platform), p.season_year, p.published_at, p.text, labelled(p) ? p.analysis.relevant ? "相关" : "不相关" : "待标注", list(p.analysis?.topics).join("；"), SENTIMENTS[p.analysis?.sentiment]?.label || "", list(p.analysis?.emotions).join("；"), p.analysis?.confidence, list(p.analysis?.evidence).join("；"), p.url, entryLabel(p), languageLabel(p.language), regionLabel(p.market_region), p.thread_id, p.parent_id, anxietyOf(p).score, ANXIETY_STATUS[anxietyOf(p).status], list(anxietyOf(p).evidence).join("；"), anxietyOf(p).reason, anxietyOf(p).model, anxietyOf(p).prompt_version, anxietyOf(p).confidence]);
  const csv = "\ufeff" + [columns, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${isCombined() ? "全平台就业讨论" : isOverseas() ? "海外就业讨论" : "秋招讨论"}_${state.dataset}_${state.platform}_${state.year}_${posts.length}条.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(`已导出 ${posts.length} 条筛选样本`);
}

function showTooltip(target, event) {
  if (!target?.dataset.tooltip || target.disabled) return;
  const [title, value, note] = target.dataset.tooltip.split("|");
  $("chart-tooltip").innerHTML = `<strong>${escapeHTML(title)}</strong>${escapeHTML(value)}${note ? `<br><small>${escapeHTML(note)}</small>` : ""}`;
  $("chart-tooltip").hidden = false;
  const bounds = target.getBoundingClientRect();
  const x = event?.clientX || bounds.x + bounds.width / 2, y = event?.clientY || bounds.y;
  const box = $("chart-tooltip").getBoundingClientRect();
  $("chart-tooltip").style.left = `${Math.max(8, Math.min(x + 12, window.innerWidth - box.width - 12))}px`;
  $("chart-tooltip").style.top = `${Math.max(8, Math.min(y + 14, window.innerHeight - box.height - 12))}px`;
}
function hideTooltip() { $("chart-tooltip").hidden = true; }

$("refresh").addEventListener("click", () => loadData());
$("xhs-sample-mode").addEventListener("click", () => loadData(state.dataset === "balanced" ? "combined" : "balanced", "push", "xiaohongshu"));
$("reset").addEventListener("click", resetFilters);
$("download").addEventListener("click", downloadCSV);
const renderFiltered = () => { if (state.data) { renderAnxiety(); renderPosts(); } };
$("search").addEventListener("input", (event) => { state.query = event.target.value; state.page = 1; renderFiltered(); });
$("sentiment-filter").addEventListener("change", (event) => { state.sentiment = event.target.value; state.page = 1; renderFiltered(); });
$("relevance-filter").addEventListener("change", (event) => { state.relevance = event.target.value; state.page = 1; renderFiltered(); });
$("anxiety-status").addEventListener("change", (event) => { state.anxietyStatus = event.target.value; state.page = 1; renderFiltered(); });
$("post-sort").addEventListener("change", (event) => { state.sort = event.target.value; state.page = 1; renderPosts(); });
for (const [id, key] of [["anxiety-min", "anxietyMin"], ["anxiety-max", "anxietyMax"]]) $(id).addEventListener("change", (event) => {
  const value = Number(event.target.value);
  state[key] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : key === "anxietyMin" ? 0 : 1;
  if (state.anxietyMin > state.anxietyMax) state[key === "anxietyMin" ? "anxietyMax" : "anxietyMin"] = state[key];
  state.anxietyBin = null;
  state.page = 1;
  renderFiltered();
});
function clearAnxietyFilters() {
  Object.assign(state, {anxietyMin: 0, anxietyMax: 1, anxietyBin: null, anxietyStatus: "all", page: 1});
  renderFiltered();
}
$("anxiety-clear").addEventListener("click", clearAnxietyFilters);
for (const [id, delta] of [["previous", -1], ["next", 1]]) $(id).addEventListener("click", () => { state.page += delta; renderPosts(); $("voices").scrollIntoView({behavior: "smooth", block: "start"}); });

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-platform], [data-year], [data-unit], [data-coverage-platform], [data-chart-year], [data-topic], [data-emotion], [data-clear], [data-expand], [data-anxiety-bin], [data-anxiety-year], [data-anxiety-reset]");
  if (!target || target.disabled) return;
  if (target.dataset.platform !== undefined) return changeScope(target.dataset.platform);
  if (!state.data) return;
  if (target.dataset.anxietyReset) return clearAnxietyFilters();
  if (target.dataset.anxietyBin !== undefined) {
    const bin = Number(target.dataset.anxietyBin);
    Object.assign(state, {anxietyMin: bin / 10, anxietyMax: (bin + 1) / 10, anxietyBin: bin, anxietyStatus: "scored", page: 1});
    renderFiltered();
    $("voices").scrollIntoView({behavior: "smooth", block: "start"});
    return;
  }
  if (target.dataset.anxietyYear) return changeScope(undefined, Number(target.dataset.anxietyYear));
  if (target.dataset.year !== undefined) return changeScope(undefined, target.dataset.year === "all" ? "all" : Number(target.dataset.year));
  if (target.dataset.unit) { state.unit = target.dataset.unit; render(); return; }
  if (target.dataset.coveragePlatform) return changeScope(target.dataset.coveragePlatform, Number(target.dataset.coverageYear));
  if (target.dataset.chartYear) {
    if (target.dataset.chartSentiment) state.sentiment = target.dataset.chartSentiment;
    return changeScope(undefined, Number(target.dataset.chartYear));
  }
  if (target.dataset.topic) { state.topic = state.topic === target.dataset.topic ? null : target.dataset.topic; state.page = 1; render(); return; }
  if (target.dataset.emotion) {
    state.emotion = state.emotion === target.dataset.emotion && (!target.dataset.emotionYear || Number(target.dataset.emotionYear) === state.year) ? null : target.dataset.emotion;
    if (target.dataset.emotionYear) state.year = Number(target.dataset.emotionYear);
    state.page = 1; render(); return;
  }
  if (target.dataset.clear) { state[target.dataset.clear] = null; state.page = 1; render(); return; }
  if (target.dataset.expand) {
    const expanded = $(target.dataset.expand).classList.toggle("expanded");
    target.setAttribute("aria-expanded", String(expanded));
    target.textContent = expanded ? "收起全文 ↑" : "展开全文 ↓";
  }
});
document.addEventListener("keydown", (event) => {
  if (["Enter", " "].includes(event.key) && event.target.matches("svg [role='button']")) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent("click", {bubbles: true})); }
  if (event.key === "Escape") hideTooltip();
});
document.addEventListener("pointerover", (event) => showTooltip(event.target.closest("[data-tooltip]"), event));
document.addEventListener("pointermove", (event) => { const target = event.target.closest("[data-tooltip]"); if (target) showTooltip(target, event); else hideTooltip(); });
document.addEventListener("pointerout", (event) => { if (!event.relatedTarget?.closest?.("[data-tooltip]")) hideTooltip(); });
document.addEventListener("focusin", (event) => showTooltip(event.target.closest("[data-tooltip]")));
document.addEventListener("focusout", hideTooltip);
window.addEventListener("scroll", hideTooltip, {passive: true});
window.addEventListener("popstate", () => {
  const navigation = navigationFromURL();
  if (navigation.dataset !== state.dataset) return loadData(navigation.dataset, "none", navigation.platform);
  if (navigation.platform === state.platform) return;
  state.platform = navigation.platform;
  state.page = 1;
  render("none");
});

const navigationObserver = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
  if (visible[0]) for (const link of document.querySelectorAll(".nav-links a")) link.classList.toggle("active", link.hash === `#${visible[0].target.id}`);
}, {rootMargin: "-5% 0px -65% 0px", threshold: 0});
for (const id of ["overview", "anxiety", "topics", "voices", "method"]) navigationObserver.observe($(id));

renderPlatformNavigation();
const initialNavigation = navigationFromURL();
loadData(initialNavigation.dataset, "replace", initialNavigation.platform);
