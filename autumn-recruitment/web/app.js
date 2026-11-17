"use strict";

const $ = (id) => document.getElementById(id);
const ENTRY_TYPES = {post: "Post", story: "Post", comment: "Comment", reply: "Reply", question: "Question", answer: "Answer", video_description: "Video description"};
const PLATFORM_SYMBOLS = {weibo: "W", xiaohongshu: "X", x: "𝕏", nowcoder: "N", bilibili: "B", zhihu: "Z", hackernews: "H", workplace: "W", mastodon: "M", reddit: "R", bluesky: "B"};
const SENTIMENTS = {
  positive: {label: "Positive", color: "#70a997", background: "#edf5f0"},
  negative: {label: "Negative", color: "#da876e", background: "#fcf0eb"},
  neutral: {label: "Neutral", color: "#a1b1c3", background: "#f0f3f7"},
  mixed: {label: "Mixed", color: "#b5a3ca", background: "#f4f0f8"},
  uncertain: {label: "Uncertain", color: "#c3aa80", background: "#f8f4ea"},
};
const EMOTIONS = ["焦虑", "挫败", "愤怒", "失望", "期待", "喜悦", "平静", "不确定", "未明确表达"];
const LABELS = {
  "岗位数量": "Job availability", "竞争程度": "Competition", "简历筛选": "Application screening",
  "笔试面试": "Tests and interviews", "录用与毁约": "Offers and withdrawals", "薪资待遇": "Pay and benefits",
  "行业前景": "Industry outlook", "公司选择": "Employer choice", "求职策略": "Job search strategies",
  "求职进展": "Job search progress", "求职压力与生活安排": "Job search and life pressures",
  "升学与就业选择": "Further study or employment", "其他": "Other",
  "焦虑": "Anxiety", "挫败": "Frustration", "愤怒": "Anger", "失望": "Disappointment",
  "期待": "Anticipation", "喜悦": "Joy", "平静": "Calm", "不确定": "Uncertainty", "未明确表达": "Not expressed",
  "评分结果暂时不可用，请更新评分结果后刷新。": "Scores are temporarily unavailable. Update the scores and refresh.",
  "尚无可用导出，请先执行 sample、analyze 和 export。": "No exports are available. Run sample, analyze and export first.",
  "导出文件暂时无法读取，请完成导出后刷新。": "The export is temporarily unavailable. Finish the export and refresh.",
  "导出文件格式无效，请重新执行 export。": "The export format is invalid. Run export again.",
  "未知数据集。": "Unknown dataset.",
  "统计导出格式无效，请重新执行 export。": "The statistics export is invalid. Run export again.",
  "样本导出格式无效，请重新执行 export。": "The sample export is invalid. Run export again.",
  "尚无可用样本，请先执行 export。": "No samples are available. Run export first.",
  "样本文件暂时无法读取，请完成导出后刷新。": "The sample file is temporarily unavailable. Finish the export and refresh.",
  "每次只能选择一个数据集。": "Choose one dataset at a time.",
  "数据正在更新，请稍后刷新。": "Data is being updated. Refresh shortly.",
  "页面不存在。": "Page not found.",
  "页面资源尚未安装。": "Page assets are not installed.",
};
const DATASET_LABELS = {combined: "All platforms", balanced: "Annual quota sample", "xiaohongshu-available": "Xiaohongshu supplement", "additional-chinese": "Additional Chinese platforms", "overseas-employment": "Overseas employment"};
let englishContent = Object.create(null);
let englishContentPromise;
const englishText = (value) => LABELS[value] || englishContent[value] || (/\p{Script=Han}/u.test(String(value || "")) ? "English translation unavailable." : String(value || ""));
async function loadEnglishContent() {
  if (!englishContentPromise) englishContentPromise = fetch("/content.en.json", {cache: "no-store"}).then(async (response) => {
    if (!response.ok) throw new Error("English content could not be loaded.");
    const content = await response.json();
    if (!content || Array.isArray(content) || typeof content !== "object" || Object.values(content).some((value) => typeof value !== "string" || /\p{Script=Han}/u.test(value))) throw new Error("English content is invalid.");
    englishContent = content;
  }).catch((error) => { englishContentPromise = null; throw error; });
  return englishContentPromise;
}
const state = {data: null, dataset: "combined", platform: "all", year: "all", unit: "percent", query: "", sentiment: "all", relevance: "all", topic: null, emotion: null, page: 1, anxietyMin: 0, anxietyMax: 1, anxietyBin: null, anxietyStatus: "all", sort: "time"};
const PAGE_SIZE = 6;
const PLATFORM_SOURCES = [
  {id: "xiaohongshu", label: "Xiaohongshu", dataset: "balanced"},
  {id: "weibo", label: "Weibo", dataset: "balanced"},
  {id: "hackernews", label: "Hacker News", dataset: "overseas-employment"},
  {id: "workplace", label: "Workplace", dataset: "overseas-employment"},
  {id: "nowcoder", label: "Nowcoder", dataset: "additional-chinese"},
  {id: "mastodon", label: "Mastodon", dataset: "overseas-employment"},
  {id: "x", label: "X / Twitter", dataset: "balanced"},
  {id: "bilibili", label: "Bilibili", dataset: "additional-chinese"},
  {id: "zhihu", label: "Zhihu", dataset: "additional-chinese"},
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
const number = (value) => new Intl.NumberFormat("en-US").format(value);
const percent = (count, total) => total ? `${(100 * count / total).toFixed(1)}%` : "—";
const labelled = (post) => post.analysis && typeof post.analysis.relevant === "boolean";
const relevant = (post) => labelled(post) && post.analysis.relevant;
const list = (value) => Array.isArray(value) ? value : [];
const years = () => state.data?.meta?.years || [...new Set(list(state.data?.posts).map((p) => p.season_year))].sort();
const platforms = () => list(state.data?.meta?.platforms).map((platform) => ({...platform, label: platformName(platform.id)}));
const platformName = (id) => PLATFORM_SOURCES.find((platform) => platform.id === id)?.label || id;
const defaultPlatform = () => state.dataset === "xiaohongshu-available" ? "xiaohongshu" : "all";
const isOverseas = () => state.dataset === "overseas-employment" || state.data?.summary?.study_scope === "overseas_employment";
const isCombined = () => state.dataset === "combined";
const publicationYear = () => isCombined() || isOverseas();
const defaultRelevance = () => isCombined() ? "all" : "relevant";
const ANXIETY_STATUS = {scored: "Scored", unassessable: "Unassessable", pending: "Pending", error: "Failed"};
const anxietyOf = (post) => {
  const value = post.anxiety;
  if (value?.status === "scored" && typeof value.score === "number" && Number.isFinite(value.score) && value.score >= 0 && value.score <= 1) return value;
  return {status: ["unassessable", "pending", "error"].includes(value?.status) ? value.status : "pending", score: null, evidence: [], reason: value?.reason || "", confidence: typeof value?.confidence === "number" ? value.confidence : null, model: value?.model || "", prompt_version: value?.prompt_version || ""};
};
const anxietyNumber = (value) => typeof value === "number" ? value.toFixed(2) : "—";
const yearLabel = () => state.year === "all" ? "All years" : String(state.year);
const platformLabel = () => state.platform === "all"
  ? DATASET_LABELS[state.dataset] || "All platforms"
  : platformName(state.platform);
const scope = (includeYear = true) => state.data.posts.filter((p) => (state.platform === "all" || p.platform === state.platform) && (!includeYear || state.year === "all" || p.season_year === state.year));
const relatedInYear = (year) => scope(false).filter((p) => p.season_year === year && relevant(p));
const countTags = (posts, field) => posts.reduce((counts, post) => {
  for (const tag of list(post.analysis?.[field])) counts[tag] = (counts[tag] || 0) + 1;
  return counts;
}, {});
const dateLabel = (value, includeTime = false) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-GB", {timeZone: "Asia/Shanghai", year: "numeric", month: "short", day: "2-digit", ...(includeTime ? {hour: "2-digit", minute: "2-digit", hour12: false} : {})}).format(date);
};
const studyWindow = () => {
  const window = state.data?.meta?.window || {};
  const startMonth = window.start_month || 8, startDay = window.start_day || 1;
  const end = new Date(Date.UTC(2000, (window.end_month || 11) - 1, window.end_day || 18) - 86400000);
  const endMonth = end.getUTCMonth() + 1, endDay = end.getUTCDate();
  const pad = (value) => String(value).padStart(2, "0");
  const monthName = (month) => new Intl.DateTimeFormat("en-US", {month: "short", timeZone: "UTC"}).format(new Date(Date.UTC(2000, month - 1, 1)));
  return {short: `${pad(startMonth)}.${pad(startDay)} — ${pad(endMonth)}.${pad(endDay)}`, long: `${monthName(startMonth)} ${startDay} to ${monthName(endMonth)} ${endDay}`};
};
const entryLabel = (post) => ENTRY_TYPES[post.entry_type] || post.entry_type || "Post";
const languageLabel = (language) => language === "en" ? "English original" : language === "zh" || language?.startsWith("zh-") ? "Chinese original" : language ? `${language} original` : "";
const regionLabel = (region) => ({China: "China", china: "China", international_unspecified: "International (unspecified)", overseas_unspecified: "Overseas (unspecified)"}[region] || region || "");

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
  $("platforms").innerHTML = `<button type="button" data-platform="all" aria-pressed="false" title="View all platforms">All platforms</button>${ordered.map((platform) => `<button type="button" data-platform="${platform.id}" aria-pressed="false">${escapeHTML(platform.label)}</button>`).join("")}`;
}

function renderSampleMode() {
  const mode = $("xhs-sample-mode"), balanced = state.dataset === "balanced";
  mode.hidden = state.platform !== "xiaohongshu";
  mode.textContent = "Annual sample";
  mode.classList.toggle("active", balanced);
  mode.setAttribute("aria-pressed", String(balanced));
  mode.title = balanced ? "Switch to all available samples" : "Switch to the annual quota sample";
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
    const [response] = await Promise.all([fetch(`/api/dashboard?dataset=${encodeURIComponent(state.dataset)}`, {signal: controller.signal, cache: "no-store"}), loadEnglishContent()]);
    const data = await response.json();
    if (controller !== requestController) return;
    if (!response.ok) throw new Error(typeof data.error === "string" ? englishText(data.error) : "Could not read the data. Export the samples first.");
    if (!Array.isArray(data.posts) || !Array.isArray(data.summary?.groups)) throw new Error("The export is incomplete. Export the samples again and refresh.");
    if (data.dataset !== state.dataset) throw new Error("The returned dataset does not match your selection. Refresh to try again.");
    state.data = data;
    if (isCombined()) renderPlatformNavigation();
    state.page = 1;
    state.topic = null;
    state.emotion = null;
    if (state.platform !== "all" && !platforms().some((item) => item.id === state.platform)) state.platform = defaultPlatform();
    if (state.year !== "all" && !years().includes(state.year)) state.year = "all";
    $("years").innerHTML = `<button data-year="all" aria-pressed="false">All years</button>${years().map((year) => `<button data-year="${year}" aria-pressed="false">${year}</button>`).join("")}`;
    $("updated-at").textContent = `Updated ${dateLabel(data.meta.updated_at, true)}`;
    $("footer-updated").textContent = `Data snapshot · ${dateLabel(data.meta.updated_at, true)}`;
    $("limitations").innerHTML = list(data.summary.limitations).map((item) => `<li>${escapeHTML(englishText(item))}</li>`).join("");
    $("model-note").textContent = `Annotation model: ${data.summary.model} · Prompt version: ${data.summary.prompt_version}. Evidence is checked against the original text; annotations have not all been reviewed by a human.`;
    const annualYears = years(), heading = isCombined() ? "Anxiety in employment discussions" : isOverseas() ? "Voices on employment" : "Voices on autumn recruitment";
    $("study-scope").textContent = isCombined() ? "All platforms · Deduplicated" : isOverseas() ? "Overseas employment discussions" : "Autumn campus recruitment";
    $("page-title").innerHTML = `${heading}<span>${annualYears.length ? `${annualYears[0]}—${annualYears.at(-1)}` : "No years available"}</span>`;
    $("page-intro").textContent = data.summary.description ? englishText(data.summary.description) : (isOverseas() ? "Explore English-language employment discussions while preserving their original context." : "Explore topics and emotions across years through real discussions.");
    document.title = "Recruitment Observatory · Anxiety and annual topics";
    const studyDates = studyWindow();
    $("window-label").innerHTML = `${studyDates.short} <span>· UTC+8</span>`;
    $("method-scope").textContent = isCombined()
      ? `Years use original publication dates. The annual window is ${studyDates.long}, UTC+8. Posts from six platforms are deduplicated by ID, preserving their source, entry type and original language.`
      : isOverseas()
      ? `Years use original publication dates. The annual window is ${studyDates.long}, UTC+8. This separate sample of English-language employment discussions includes posts, comments, questions and answers. It does not represent Chinese autumn campus recruitment.`
      : `Recruitment years use original publication dates, with an annual window of ${studyDates.long}, UTC+8. The main and supplementary Xiaohongshu samples overlap. Additional Chinese platforms are shown separately; do not add the sample groups together.`;
    $("dashboard").hidden = false;
    render(historyMode);
  } catch (error) {
    if (error.name === "AbortError") return;
    $("error").textContent = `${englishText(error.message)} Click “Refresh” to try again.`;
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
  $("metric-labelled").textContent = `${number(posts.filter(labelled).length)} / ${number(posts.length)} annotated`;
  $("metric-relevant").textContent = number(related.length);
  $("metric-negative").innerHTML = related.length ? `${(100 * negative / related.length).toFixed(1)}<small>%</small>` : "—";
  $("metric-denominator").textContent = related.length ? `${negative} negative / ${related.length} relevant posts` : "No relevant posts to calculate a share";
  const covered = new Set(posts.map((p) => p.season_year)).size;
  $("metric-years").innerHTML = `${covered}<small>/ ${state.year === "all" ? years().length : 1}</small>`;
  $("metric-year-detail").textContent = state.year === "all" ? "By original publication year" : `${state.year} · ${new Set(posts.map((p) => p.published_at.slice(0, 10))).size} publication dates`;
  const groups = state.data.summary.groups;
  const context = [];
  const weiboDates = groups.filter((g) => g.platform === "weibo" && g.selected && Number.isFinite(g.publication_date_count)).map((g) => g.publication_date_count);
  if (weiboDates.length) {
    const minimum = Math.min(...weiboDates), maximum = Math.max(...weiboDates);
    context.push(`Weibo covers ${minimum === maximum ? minimum : `${minimum}–${maximum}`} publication dates per year`);
  }
  if (groups.some((g) => g.platform === "xiaohongshu" && g.shortfall > 0)) context.push("Xiaohongshu has historical quota shortfalls");
  if (groups.some((g) => g.platform === "x") && !groups.some((g) => g.platform === "x" && g.selected)) context.push("X has no samples yet");
  const contextPrefix = context.length ? `${context.join("; ")}. ` : "";
  const largest = [...groups].sort((a, b) => b.selected - a.selected)[0];
  const latestYear = years().at(-1);
  if (isCombined()) {
    $("context-title").textContent = "All platforms · Deduplicated sample";
    $("context-text").textContent = `${state.data.summary.selected} entries from six platforms include posts, comments, questions and answers, grouped by original publication year. Each post is counted once; original relevance and classification labels are preserved.`;
    $("coverage-note").textContent = "Actual entries by platform and publication year, without applying the original annual quotas.";
    $("method-specific").textContent = "This combined sample includes Chinese campus job searches and general overseas employment discussions. Platform and content context are preserved. The charts describe collected entries and do not represent the overall employment market.";
  } else if (state.dataset === "balanced") {
    $("context-title").textContent = "Sample context";
    $("context-text").textContent = `${contextPrefix}These charts describe collected discussions and do not represent the overall market.`;
    $("coverage-note").textContent = `Meeting a candidate quota does not mean the relevant-post quota is met. Missing years remain gaps${latestYear ? `; ${latestYear} is a partial-year sample` : ""}.`;
    $("method-specific").textContent = `${contextPrefix}Convenience samples cannot estimate overall market sentiment.`;
  } else if (state.dataset === "xiaohongshu-available") {
    $("context-title").textContent = "Supplement · Uneven year coverage";
    $("context-text").textContent = `${largest?.selected || 0} of ${state.data.summary.selected} candidates are from ${largest?.season_year || "—"}. This supplement overlaps the annual sample; read them separately without adding their counts.`;
    $("coverage-note").textContent = "The supplement retains available entries and may exceed the original quota. Historical gaps remain unfilled by recent posts.";
    const emptyYears = groups.filter((group) => !group.selected).map((group) => group.season_year);
    $("method-specific").textContent = `The Xiaohongshu supplement is concentrated in ${largest?.season_year || "—"}${emptyYears.length ? `, with no samples in ${emptyYears.join(", ")}` : ""}. It overlaps the main sample. Keep the year distribution and gaps in mind when comparing years.`;
  } else if (isOverseas()) {
    $("context-title").textContent = state.data.summary.study_name ? englishText(state.data.summary.study_name) : "Overseas employment · Separate comparison";
    $("context-text").textContent = `${state.data.summary.selected} candidates from English-language employment discussions span different regions and career stages. Interpret them separately from Chinese campus recruitment; original English text is preserved.`;
    $("coverage-note").textContent = "Coverage counts discussion entries; a thread may contain multiple comments or answers. Empty samples and quota shortfalls remain visible.";
    $("method-specific").textContent = "English-language topics may cover hiring, layoffs or workplace experiences, which differ from Chinese campus recruitment. Multiple entries in a thread are not independent respondents. Platform and year shares do not represent the overall market.";
  } else {
    $("context-title").textContent = state.data.summary.study_name ? englishText(state.data.summary.study_name) : "Additional Chinese platforms · Separate sample";
    $("context-text").textContent = `${state.data.summary.selected} candidates from ${platforms().map((platform) => platform.label).join(", ")}. Read this supplementary sample separately, preserving historical gaps and source differences.`;
    $("coverage-note").textContent = "Posts, questions and video descriptions retain their entry types. Meeting a candidate quota does not mean enough relevant posts were found; missing years remain gaps.";
    $("method-specific").textContent = "Additional Chinese platforms are a separate sample with different users and content formats. Year and platform differences may reflect visibility and collection methods, rather than the overall recruitment market.";
  }
  const targets = [...new Set(groups.map((group) => group.target).filter((target) => Number.isFinite(target) && target > 0))];
  $("coverage-target").textContent = isCombined() ? "Actual entries" : targets.length === 1 ? `${targets[0]} / platform / year` : "Quota by group";
  $("coverage-subtitle").textContent = isCombined() ? "By platform and publication year; click to filter" : "Candidates / original quota; click to filter";
  $("coverage-key").innerHTML = isCombined() ? `<span><i class="key-dot complete"></i>Available</span><span><i class="key-dot empty"></i>No samples</span>` : `<span><i class="key-dot complete"></i>Quota met</span><span><i class="key-dot partial"></i>Shortfall</span><span><i class="key-dot empty"></i>No samples</span>`;
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
  let svg = `<svg class="annual-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Annual sentiment for ${escapeHTML(platformLabel())}, ${state.unit === "percent" ? "percentages" : "counts"}. Select a year to filter.">`;
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
        svg += `<rect class="chart-cell" tabindex="0" role="button" aria-label="${entry.year}, ${value.label}: ${count} posts, ${percent(count, entry.n)} of relevant posts" data-chart-sentiment="${key}" data-chart-year="${entry.year}" data-tooltip="${escapeHTML(`${entry.year} · ${value.label}|${count} posts · ${percent(count, entry.n)}|Base: ${entry.n} relevant posts`)}" x="${x - barWidth / 2}" y="${y}" width="${barWidth}" height="${h}" fill="${value.color}" opacity="${state.year === "all" || active ? 1 : .48}"/>`;
        stacked += amount;
      }
      const topY = bottom - plotHeight * (state.unit === "percent" ? 100 : entry.n) / maximum;
      svg += `<text x="${x}" y="${topY - 12}" text-anchor="middle" font-size="9" fill="#89a095">n=${entry.n}</text>`;
    } else {
      svg += `<rect x="${x - barWidth / 2}" y="${bottom - 16}" width="${barWidth}" height="16" rx="3" fill="#f5f7f7" stroke="#e2e9e6" stroke-dasharray="3 3"/><text x="${x}" y="${bottom - 30}" text-anchor="middle" font-size="9" fill="#b3bfbc">No relevant data</text>`;
    }
    svg += `<text class="year-label" tabindex="0" role="button" aria-label="Select ${entry.year}" data-chart-year="${entry.year}" x="${x}" y="${bottom + 24}" text-anchor="middle" font-size="11" fill="${active ? "#17766b" : "#8b9c99"}" font-weight="${active ? 700 : 400}">${entry.year}</text>`;
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
      const coverageDescription = isCombined() ? `${count} collected entries` : `${count} candidates / ${target} quota`;
      content += `<button class="coverage-cell ${status}${selected ? " selected" : ""}" data-coverage-platform="${escapeHTML(platform)}" data-coverage-year="${year}" aria-label="${escapeHTML(label)} ${year}, ${coverageDescription}${!count ? ", no samples" : ""}" data-tooltip="${escapeHTML(`${label} · ${year}|${coverageDescription}|${group?.relevant || 0} model-labelled relevant posts`)}"><strong>${count ? number(count) : "—"}</strong><small>${count ? isCombined() ? "entries" : `/ ${target}` : "No samples"}</small></button>`;
    }
  }
  $("coverage").innerHTML = content;
}

function renderTopics(posts) {
  const counts = Object.entries(countTags(posts, "topics")).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).slice(0, 8);
  $("topics-subtitle").textContent = `${platformLabel()} · ${yearLabel()} · ${posts.length} relevant posts`;
  if (!posts.length) {
    $("topic-chart").innerHTML = `<div class="empty-state"><span class="empty-icon">≋</span><strong>No topics to compare</strong>No relevant posts for this platform and year.<br>Select another year or platform to explore available samples.</div>`;
    return;
  }
  $("topic-chart").innerHTML = counts.map(([name, count], index) => {
    const value = state.unit === "percent" ? percent(count, posts.length) : `${count} posts`;
    const width = state.unit === "percent" ? 100 * count / posts.length : 100 * count / (counts[0]?.[1] || 1);
    const label = englishText(name);
    return `<button class="topic-row${state.topic === name ? " active" : ""}" data-topic="${escapeHTML(name)}" aria-label="Filter topic ${escapeHTML(label)}, ${count} posts" data-tooltip="${escapeHTML(`${label}|${count} posts · ${percent(count, posts.length)}|Base: ${posts.length} relevant posts`)}"><span class="topic-meta"><span class="topic-name"><span>${String(index + 1).padStart(2, "0")}</span>${escapeHTML(label)}</span><span class="topic-value">${value}<small>${state.unit === "percent" ? `${count} posts` : percent(count, posts.length)}</small></span></span><span class="topic-track"><span class="topic-fill" style="width:${width}%"></span></span></button>`;
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
    const label = englishText(emotion);
    html += `<div class="emotion-name${emotion === "未明确表达" ? " missing" : ""}">${label}</div>`;
    for (const entry of data) {
      const n = entry.posts.length, count = emotionCount(entry.posts, emotion);
      const intensity = n ? Math.min(1, state.unit === "percent" ? count / n / .6 : count / maxCount) : 0;
      const background = `rgb(${Math.round(244 - 191 * intensity)},${Math.round(248 - 113 * intensity)},${Math.round(245 - 134 * intensity)})`;
      const active = state.year === entry.year && state.emotion === emotion;
      html += `<button class="heat-cell${!n ? " no-data" : ""}${active ? " active" : ""}" data-emotion="${emotion}" data-emotion-year="${entry.year}" ${!n ? "disabled" : ""} style="background:${n ? background : "#f5f7f8"};color:${n ? intensity > .66 ? "#fff" : "#86a291" : "#bdc6ca"}" aria-label="${entry.year}, ${label}: ${n ? `${count} posts, ${percent(count,n)}` : "no relevant samples"}" data-tooltip="${escapeHTML(`${entry.year} · ${label}|${n ? `${count} posts · ${percent(count, n)}` : "No relevant samples"}|${n ? `Base: ${n} relevant posts` : "No share available"}`)}">${!n ? "—" : state.unit === "percent" ? `${Math.round(100 * count / n)}%` : count}</button>`;
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
  $("anxiety-scope").textContent = `${platformLabel()} · ${yearLabel()} · Current filters`;
  $("anxiety-progress").textContent = `${scores.length + unknown} / ${posts.length}`;
  $("anxiety-progress-detail").textContent = `${scores.length} scored, ${unknown} unassessable`;
  $("anxiety-mean").textContent = anxietyNumber(scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null);
  $("anxiety-median").textContent = anxietyNumber(median);
  $("anxiety-denominator").textContent = `Base: ${scores.length} valid scores, including zeros`;
  $("anxiety-unknown").textContent = number(unknown);
  $("anxiety-pending").textContent = `${pending} pending, ${failed} failed`;
  $("anxiety-min").value = state.anxietyMin;
  $("anxiety-max").value = state.anxietyMax;
  $("anxiety-status").value = state.anxietyStatus;
  $("post-sort").value = state.sort;
  const bins = Array(10).fill(0);
  for (const score of scores) bins[Math.min(9, Math.floor(score * 10))]++;
  const width = 600, height = 235, left = 40, right = 580, top = 26, bottom = 190;
  const maximum = Math.max(1, ...bins), plotHeight = bottom - top, step = (right - left) / 10;
  let histogram = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Anxiety distribution of ${scores.length} valid scores under the current filters">`;
  for (let i = 0; i <= 4; i++) {
    const y = bottom - plotHeight * i / 4;
    histogram += `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#e8efeb"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${Number((maximum * i / 4).toFixed(1))}</text>`;
  }
  bins.forEach((n, i) => {
    const x = left + i * step + 5, h = n / maximum * plotHeight, label = `${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}${i < 9 ? " (upper bound excluded)" : " (including 1)"}`;
    histogram += `<g role="button" tabindex="0" data-anxiety-bin="${i}" aria-label="Anxiety ${label}, ${n} posts. Click to filter." data-tooltip="${escapeHTML(`Anxiety ${label}|${n} posts|Base: ${scores.length} valid scores`)}"><rect class="anxiety-bin-hit" x="${left + i * step}" y="${top}" width="${step}" height="${bottom - top}" fill="transparent"/><rect x="${x}" y="${bottom - h}" width="${step - 10}" height="${h}" rx="3" fill="${state.anxietyBin === i ? "#17766b" : "#86b29e"}"/><text x="${x + (step - 10) / 2}" y="${bottom - h - 5}" text-anchor="middle">${n || ""}</text></g>`;
  });
  for (let i = 0; i <= 10; i += 2) histogram += `<text x="${left + i * step}" y="${bottom + 22}" text-anchor="middle">${(i / 10).toFixed(1)}</text>`;
  if (!scores.length) histogram += `<text x="${width / 2}" y="${top + 55}" text-anchor="middle">No valid scores for these filters</text>`;
  $("anxiety-histogram").innerHTML = histogram + "</svg>";
  const series = years().map((year) => {
    const values = posts.filter((post) => post.season_year === year).map(anxietyOf).filter((value) => value.status === "scored").map((value) => value.score);
    return {year, n: values.length, mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null};
  });
  const yearStep = (right - left) / Math.max(series.length, 1);
  let annual = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Mean anxiety by publication year under the current filters, on a fixed 0 to 1 scale">`;
  for (let i = 0; i <= 4; i++) {
    const y = bottom - plotHeight * i / 4;
    annual += `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#e8efeb"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${(i / 4).toFixed(2)}</text>`;
  }
  let previous = null;
  series.forEach((entry, i) => {
    const x = left + yearStep * (i + .5), y = entry.mean === null ? null : bottom - entry.mean * plotHeight;
    if (previous && y !== null) annual += `<line x1="${previous.x}" y1="${previous.y}" x2="${x}" y2="${y}" stroke="#86b29e" stroke-width="2"/>`;
    if (y !== null) {
      annual += `<g tabindex="0" role="button" data-anxiety-year="${entry.year}" aria-label="${entry.year}, mean anxiety ${entry.mean.toFixed(2)}, ${entry.n} valid scores" data-tooltip="${escapeHTML(`${entry.year}|Mean anxiety ${entry.mean.toFixed(2)}|Base: ${entry.n} valid scores`)}"><circle cx="${x}" cy="${y}" r="15" fill="transparent"/><circle cx="${x}" cy="${y}" r="5" fill="#17766b"/><text x="${x}" y="${y - 14}" text-anchor="middle">${entry.mean.toFixed(2)}</text><text x="${x}" y="${bottom + 17}" text-anchor="middle">${entry.year}</text><text x="${x}" y="${bottom + 34}" text-anchor="middle">n=${entry.n}</text></g>`;
      previous = {x, y};
    } else {
      annual += `<text x="${x}" y="${bottom - 15}" text-anchor="middle">No scores</text><text x="${x}" y="${bottom + 17}" text-anchor="middle">${entry.year}</text><text x="${x}" y="${bottom + 34}" text-anchor="middle">n=0</text>`;
      previous = null;
    }
  });
  $("anxiety-annual").innerHTML = annual + "</svg>";
}

function anxietyCard(post) {
  const anxiety = anxietyOf(post), scored = anxiety.status === "scored";
  return `<div class="post-anxiety" data-anxiety-status="${anxiety.status}"><div class="post-anxiety-label"><span>Anxiety</span><strong>${scored ? anxiety.score.toFixed(2) : ANXIETY_STATUS[anxiety.status]}</strong><span class="post-anxiety-track" aria-hidden="true">${scored ? `<i style="width:${anxiety.score * 100}%"></i>` : ""}</span><small>${scored ? "0–1" : "Excluded from mean"}</small></div>${anxiety.reason || list(anxiety.evidence).length ? `<details class="anxiety-evidence"><summary>Score evidence and explanation</summary>${list(anxiety.evidence).map((quote) => `<blockquote>${escapeHTML(quote)}</blockquote>`).join("")}${anxiety.reason ? `<p>${escapeHTML(englishText(anxiety.reason))}</p>` : ""}<p class="anxiety-model">${escapeHTML(anxiety.model || "")}${anxiety.prompt_version ? ` · ${escapeHTML(anxiety.prompt_version)}` : ""}${typeof anxiety.confidence === "number" ? ` · Model-assessed interpretability ${Math.round(anxiety.confidence * 100)}%` : ""}</p></details>` : ""}</div>`;
}

function renderPosts() {
  const posts = matchingPosts(), pages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  $("voice-count").textContent = `${posts.length} posts`;
  $("sentiment-filter").value = state.sentiment;
  $("relevance-filter").value = state.relevance;
  const chips = [];
  if (state.topic) chips.push(`<button class="filter-tag" data-clear="topic">Topic · ${escapeHTML(englishText(state.topic))}<span>×</span></button>`);
  if (state.emotion) chips.push(`<button class="filter-tag" data-clear="emotion">Emotion · ${escapeHTML(englishText(state.emotion))}<span>×</span></button>`);
  if (state.anxietyMin > 0 || state.anxietyMax < 1 || state.anxietyBin !== null) chips.push(`<button class="filter-tag" data-anxiety-reset="true">Anxiety · ${state.anxietyMin.toFixed(2)}–${state.anxietyMax.toFixed(2)}${state.anxietyBin !== null && state.anxietyBin < 9 ? " (upper bound excluded)" : ""}<span>×</span></button>`);
  $("active-tags").innerHTML = chips.join("");
  $("active-tags").hidden = !chips.length;
  const pagePosts = posts.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  $("post-list").innerHTML = pagePosts.length ? pagePosts.map((post, index) => {
    const analysis = post.analysis;
    const sentiment = analysis && relevant(post) ? SENTIMENTS[analysis.sentiment] : null;
    const label = sentiment?.label || (labelled(post) ? "Not relevant" : "Unlabelled");
    const statusStyle = `color:${sentiment?.color || "#9ba9a3"};background:${sentiment?.background || "#f3f6f4"}`;
    const symbol = PLATFORM_SYMBOLS[post.platform] || platformName(post.platform).slice(0, 1);
    const metadata = [dateLabel(post.published_at), `${post.season_year}${publicationYear() ? "" : " recruitment"}`, entryLabel(post), languageLabel(post.language), regionLabel(post.market_region)].filter(Boolean).join(" · ");
    return `<article class="post-card" data-entry-type="${escapeHTML(post.entry_type || "post")}"><div class="post-header"><span class="platform-badge ${escapeHTML(post.platform)}"><i>${escapeHTML(symbol)}</i>${escapeHTML(platformName(post.platform))}</span><span class="post-date">${escapeHTML(metadata)}</span><span class="post-sentiment" style="${statusStyle}">${label}</span>${analysis ? `<span class="post-confidence">Label confidence ${Math.round(analysis.confidence * 100)}%</span>` : ""}</div><p class="post-body" id="post-body-${index}" lang="${escapeHTML(post.language || (isOverseas() ? "en" : "zh-CN"))}">${escapeHTML(post.text)}</p><button class="expand-button" data-expand="post-body-${index}" aria-expanded="false">Read more ↓</button>${analysis && list(analysis.evidence).length ? `<p class="post-evidence" title="${escapeHTML(analysis.evidence.join(" / "))}"><span>Evidence</span>${escapeHTML(analysis.evidence.map((s) => `“${s}”`).join(" · "))}</p>` : ""}${anxietyCard(post)}<div class="post-bottom">${list(analysis?.topics).map((topic) => `<button class="post-tag" data-topic="${escapeHTML(topic)}">${escapeHTML(englishText(topic))}</button>`).join("")}${list(analysis?.emotions).map((emotion) => `<button class="post-tag emotion" data-emotion="${escapeHTML(emotion)}">${escapeHTML(englishText(emotion))}</button>`).join("")}${post.url ? `<a class="source-link" href="${escapeHTML(post.url)}" target="_blank" rel="noopener noreferrer">View source ↗</a>` : ""}</div></article>`;
  }).join("") : `<div class="empty-state"><span class="empty-icon">◌</span><strong>${scope().length ? "No matching discussions" : "No samples in this selection"}</strong>${scope().length ? "Try another keyword or clear the topic and emotion filters." : "Historical gaps are preserved. Select another year or platform to explore available data."}</div>`;
  $("pagination-info").textContent = posts.length ? `Showing ${(state.page - 1) * PAGE_SIZE + 1}–${Math.min(state.page * PAGE_SIZE, posts.length)} of ${posts.length} posts` : "0 matching posts";
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
  const columns = ["Platform", publicationYear() ? "Publication year" : "Recruitment year", "Published at", "Text", "Relevance", "Topics", "Sentiment", "Emotions", "Confidence", "Evidence", "Source URL", "Entry type", "Language", "Market region", "Thread ID", "Parent ID", "Anxiety score", "Anxiety status", "Anxiety evidence", "Anxiety reason", "Anxiety model", "Anxiety prompt version", "Anxiety confidence"];
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/u.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = posts.map((p) => [platformName(p.platform), p.season_year, p.published_at, p.text, labelled(p) ? p.analysis.relevant ? "Relevant" : "Not relevant" : "Unlabelled", list(p.analysis?.topics).map(englishText).join("; "), SENTIMENTS[p.analysis?.sentiment]?.label || "", list(p.analysis?.emotions).map(englishText).join("; "), p.analysis?.confidence, list(p.analysis?.evidence).join("; "), p.url, entryLabel(p), languageLabel(p.language), regionLabel(p.market_region), p.thread_id, p.parent_id, anxietyOf(p).score, ANXIETY_STATUS[anxietyOf(p).status], list(anxietyOf(p).evidence).join("; "), englishText(anxietyOf(p).reason), anxietyOf(p).model, anxietyOf(p).prompt_version, anxietyOf(p).confidence]);
  const csv = "\ufeff" + [columns, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `employment_discussions_${state.dataset}_${state.platform}_${state.year}_${posts.length}_posts.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(`Exported ${posts.length} matching posts`);
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
    target.textContent = expanded ? "Show less ↑" : "Read more ↓";
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
