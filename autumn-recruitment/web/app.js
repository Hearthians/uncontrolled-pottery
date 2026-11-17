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
const state = {data: null, dataset: "balanced", platform: "all", year: "all", unit: "percent", query: "", sentiment: "all", relevance: "relevant", topic: null, emotion: null, page: 1};
const PAGE_SIZE = 6;
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
const platformName = (id) => platforms().find((platform) => platform.id === id)?.label || id;
const defaultPlatform = () => state.dataset === "xiaohongshu-available" ? "xiaohongshu" : "all";
const isOverseas = () => state.dataset === "overseas-employment" || state.data?.summary?.study_scope === "overseas_employment";
const yearLabel = () => state.year === "all" ? "全部年份" : `${state.year} 年`;
const platformLabel = () => state.platform === "all" ? "全部平台" : platformName(state.platform);
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

async function loadData() {
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  state.dataset = $("dataset").value;
  state.data = null;
  $("download").disabled = true;
  $("error").hidden = true;
  $("loading").hidden = false;
  $("dashboard").hidden = true;
  document.body.classList.add("is-loading");
  $("main").setAttribute("aria-busy", "true");
  try {
    const response = await fetch(`/api/dashboard?dataset=${encodeURIComponent(state.dataset)}`, {signal: controller.signal, cache: "no-store"});
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "本地数据读取失败，请先完成样本导出。");
    if (!Array.isArray(data.posts) || !Array.isArray(data.summary?.groups)) throw new Error("导出数据格式不完整，请重新导出后刷新。");
    if (data.dataset !== state.dataset) throw new Error("返回的数据范围不匹配，请刷新后重试。");
    if (controller !== requestController) return;
    state.data = data;
    state.page = 1;
    state.topic = null;
    state.emotion = null;
    const available = list(data.meta.available_datasets);
    $("dataset").innerHTML = available.map((dataset) => `<option value="${escapeHTML(dataset.id)}">${escapeHTML(dataset.label)}</option>`).join("");
    $("dataset").value = state.dataset;
    if (state.dataset === "xiaohongshu-available" || !platforms().some((platform) => platform.id === state.platform)) state.platform = defaultPlatform();
    $("platforms").innerHTML = `<button data-platform="all" aria-pressed="false" ${state.dataset === "xiaohongshu-available" ? "disabled" : ""}>全部平台</button>${platforms().map((platform) => `<button data-platform="${escapeHTML(platform.id)}" aria-pressed="false">${escapeHTML(platform.label)}</button>`).join("")}`;
    if (state.year !== "all" && !years().includes(state.year)) state.year = "all";
    $("years").innerHTML = `<button data-year="all" aria-pressed="false">全部年份</button>${years().map((year) => `<button data-year="${year}" aria-pressed="false">${year}</button>`).join("")}`;
    $("updated-at").textContent = `数据更新于 ${dateLabel(data.meta.updated_at, true)}`;
    $("footer-updated").textContent = `数据快照 · ${dateLabel(data.meta.updated_at, true)}`;
    $("limitations").innerHTML = list(data.summary.limitations).map((item) => `<li>${escapeHTML(item)}</li>`).join("");
    $("model-note").textContent = `自动标注模型：${data.summary.model} · 提示版本：${data.summary.prompt_version} · 原文依据经逐字校验，未全量人工复核。`;
    const annualYears = years(), heading = isOverseas() ? "海外就业里的声音" : "秋招里的声音";
    $("study-scope").textContent = isOverseas() ? "海外英文就业讨论" : "秋季校园招聘";
    $("page-title").innerHTML = `${heading}<span>${annualYears.length ? `${annualYears[0]}—${annualYears.at(-1)}` : "暂无年份"}</span>`;
    $("page-intro").textContent = data.summary.description || (isOverseas() ? "独立观察英文就业讨论，保留来源语境与英文原文。" : "从真实讨论出发，观察不同年份的话题与情绪。");
    document.title = `${isOverseas() ? "海外就业观察" : "秋招观察"} · 年度话题与情绪`;
    const window = studyWindow();
    $("window-label").innerHTML = `${window.short} <span>· 北京时间</span>`;
    $("method-scope").textContent = isOverseas()
      ? `按原始发表时间划分年份，窗口为北京时间 ${window.long}。这是独立的英文就业讨论样本，包含原帖、评论、问题与回答，不代表中国秋季校园招聘。`
      : `按原始发表时间划分秋招年份，窗口为北京时间 ${window.long}。主样本与小红书补充集有重叠；国内补充来源单独展示，各范围不相加。`;
    $("dashboard").hidden = false;
    render();
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

function render() {
  if (!state.data) return;
  hideTooltip();
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
  if (state.dataset === "balanced") {
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
  $("coverage-target").textContent = targets.length === 1 ? `每年 ${targets[0]} 条 / 平台` : "配额按分组显示";
  renderAnnual();
  renderCoverage();
  renderTopics(related);
  renderEmotions();
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
      const status = !count ? "empty" : count >= target ? "complete" : "partial";
      const selected = state.platform === platform && state.year === year;
      content += `<button class="coverage-cell ${status}${selected ? " selected" : ""}" data-coverage-platform="${escapeHTML(platform)}" data-coverage-year="${year}" aria-label="${escapeHTML(label)} ${year}年，${count}条候选，原定${target}条${!count ? "，无样本" : ""}" data-tooltip="${escapeHTML(`${label} · ${year}|候选 ${count} / 原定 ${target} 条|模型判相关 ${group?.relevant || 0} 条`)}"><strong>${count ? number(count) : "—"}</strong><small>${count ? `/ ${target}` : "无样本"}</small></button>`;
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

function matchingPosts() {
  let posts = scope();
  if (state.relevance === "relevant") posts = posts.filter(relevant);
  if (state.relevance === "review") posts = posts.filter((p) => !labelled(p) || p.analysis.confidence < .7 || p.analysis.sentiment === "uncertain");
  if (state.sentiment !== "all") posts = posts.filter((p) => p.analysis?.sentiment === state.sentiment);
  if (state.topic) posts = posts.filter((p) => list(p.analysis?.topics).includes(state.topic));
  if (state.emotion) posts = posts.filter((p) => labelled(p) && (state.emotion === "未明确表达" ? !list(p.analysis.emotions).length : list(p.analysis.emotions).includes(state.emotion)));
  const query = state.query.trim().toLocaleLowerCase();
  if (query) posts = posts.filter((p) => `${p.text} ${list(p.analysis?.evidence).join(" ")}`.toLocaleLowerCase().includes(query));
  return posts.sort((a, b) => b.published_at.localeCompare(a.published_at) || a.post_id.localeCompare(b.post_id));
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
  $("active-tags").innerHTML = chips.join("");
  $("active-tags").hidden = !chips.length;
  const pagePosts = posts.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  $("post-list").innerHTML = pagePosts.length ? pagePosts.map((post, index) => {
    const analysis = post.analysis;
    const sentiment = analysis && relevant(post) ? SENTIMENTS[analysis.sentiment] : null;
    const label = sentiment?.label || (labelled(post) ? "不相关" : "待标注");
    const statusStyle = `color:${sentiment?.color || "#9ba9a3"};background:${sentiment?.background || "#f3f6f4"}`;
    const symbol = PLATFORM_SYMBOLS[post.platform] || platformName(post.platform).slice(0, 1);
    const metadata = [dateLabel(post.published_at), `${post.season_year} ${isOverseas() ? "年" : "秋招"}`, entryLabel(post), languageLabel(post.language), regionLabel(post.market_region)].filter(Boolean).join(" · ");
    return `<article class="post-card" data-entry-type="${escapeHTML(post.entry_type || "post")}"><div class="post-header"><span class="platform-badge ${escapeHTML(post.platform)}"><i>${escapeHTML(symbol)}</i>${escapeHTML(platformName(post.platform))}</span><span class="post-date">${escapeHTML(metadata)}</span><span class="post-sentiment" style="${statusStyle}">${label}</span>${analysis ? `<span class="post-confidence">置信度 ${Math.round(analysis.confidence * 100)}%</span>` : ""}</div><p class="post-body" id="post-body-${index}" lang="${escapeHTML(post.language || (isOverseas() ? "en" : "zh-CN"))}">${escapeHTML(post.text)}</p><button class="expand-button" data-expand="post-body-${index}" aria-expanded="false">展开全文 ↓</button>${analysis && list(analysis.evidence).length ? `<p class="post-evidence" title="${escapeHTML(analysis.evidence.join(" / "))}"><span>标注依据</span>${escapeHTML(analysis.evidence.map((s) => `「${s}」`).join(" · "))}</p>` : ""}<div class="post-bottom">${list(analysis?.topics).map((topic) => `<button class="post-tag" data-topic="${escapeHTML(topic)}">${escapeHTML(topic)}</button>`).join("")}${list(analysis?.emotions).map((emotion) => `<button class="post-tag emotion" data-emotion="${escapeHTML(emotion)}">${escapeHTML(emotion)}</button>`).join("")}${post.url ? `<a class="source-link" href="${escapeHTML(post.url)}" target="_blank" rel="noopener noreferrer">${["post", "story"].includes(post.entry_type || "post") ? "查看原帖" : "查看原文"} ↗</a>` : ""}</div></article>`;
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
  render();
}

function resetFilters() {
  Object.assign(state, {platform: defaultPlatform(), year: "all", query: "", sentiment: "all", relevance: "relevant", topic: null, emotion: null, page: 1});
  $("search").value = "";
  render();
}

function downloadCSV() {
  if (!state.data || state.data.dataset !== state.dataset || document.body.classList.contains("is-loading")) return;
  const posts = matchingPosts();
  if (!posts.length) return;
  const columns = ["平台", isOverseas() ? "发表年份" : "秋招年份", "发表时间", "正文", "相关性", "话题", "情感", "情绪", "置信度", "依据", "原文链接", "内容类型", "语言", "市场范围", "主题ID", "父级ID"];
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/u.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = posts.map((p) => [platformName(p.platform), p.season_year, p.published_at, p.text, labelled(p) ? p.analysis.relevant ? "相关" : "不相关" : "待标注", list(p.analysis?.topics).join("；"), SENTIMENTS[p.analysis?.sentiment]?.label || "", list(p.analysis?.emotions).join("；"), p.analysis?.confidence, list(p.analysis?.evidence).join("；"), p.url, entryLabel(p), languageLabel(p.language), regionLabel(p.market_region), p.thread_id, p.parent_id]);
  const csv = "\ufeff" + [columns, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${isOverseas() ? "海外就业讨论" : "秋招讨论"}_${state.dataset}_${state.platform}_${state.year}_${posts.length}条.csv`;
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

$("dataset").addEventListener("change", loadData);
$("refresh").addEventListener("click", loadData);
$("reset").addEventListener("click", resetFilters);
$("download").addEventListener("click", downloadCSV);
$("search").addEventListener("input", (event) => { state.query = event.target.value; state.page = 1; renderPosts(); });
$("sentiment-filter").addEventListener("change", (event) => { state.sentiment = event.target.value; state.page = 1; renderPosts(); });
$("relevance-filter").addEventListener("change", (event) => { state.relevance = event.target.value; state.page = 1; renderPosts(); });
for (const [id, delta] of [["previous", -1], ["next", 1]]) $(id).addEventListener("click", () => { state.page += delta; renderPosts(); $("voices").scrollIntoView({behavior: "smooth", block: "start"}); });

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-platform], [data-year], [data-unit], [data-coverage-platform], [data-chart-year], [data-topic], [data-emotion], [data-clear], [data-expand]");
  if (!target || target.disabled || !state.data) return;
  if (target.dataset.platform !== undefined) return changeScope(target.dataset.platform);
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

const navigationObserver = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
  if (visible[0]) for (const link of document.querySelectorAll(".nav-links a")) link.classList.toggle("active", link.hash === `#${visible[0].target.id}`);
}, {rootMargin: "-5% 0px -65% 0px", threshold: 0});
for (const id of ["overview", "topics", "voices", "method"]) navigationObserver.observe($(id));

loadData();
