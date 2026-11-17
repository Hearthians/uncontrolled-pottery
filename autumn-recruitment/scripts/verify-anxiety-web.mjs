import { chromium, request } from 'playwright';
import { parse } from 'csv-parse/sync';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const baseURL = (process.env.ANXIETY_URL || 'http://127.0.0.1:8766').replace(/\/$/, '');
const allowPending = process.argv.includes('--allow-pending') || process.env.ANXIETY_ALLOW_PENDING === '1';
const output = path.resolve(projectRoot, process.env.ANXIETY_OUTPUT_DIR || 'data/diagnostics/anxiety-web');
await fs.mkdir(output, { recursive: true });
const report = { baseURL, allowPending, startedAt: new Date().toISOString(), checks: [], skipped: [], pageErrors: [], consoleErrors: [], browserHttpErrors: [], dashboardRequests: [], downloads: [] };
const expectedPlatforms = { weibo: 200, xiaohongshu: 207, nowcoder: 141, hackernews: 200, workplace: 200, mastodon: 9 };
const statusNames = ['scored', 'unassessable', 'pending', 'error'];
const publicScoreFields = ['status', 'score', 'evidence', 'reason', 'confidence', 'model', 'prompt_version'];
function check(name, actual, expected = true) {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  report.checks.push({ name, passed, actual, expected });
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}\n`);
  return passed;
}
const counts = posts => Object.fromEntries(statusNames.map(status => [status, posts.filter(post => post.anxiety?.status === status).length]));
const scored = posts => posts.filter(post => post.anxiety?.status === 'scored');
const median = values => values.length ? values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2 : null;
const key = post => `${post.platform}:${post.post_id}`;
const chronological = (a, b) => b.published_at.localeCompare(a.published_at) || a.post_id.localeCompare(b.post_id);
const spreadsheetSafe = value => /^[\s]*[=+@-]/u.test(String(value ?? '')) ? "'" + value : String(value ?? '');
function ordered(posts, direction) {
  return [...posts].sort((a, b) => {
    const first = a.anxiety.status === 'scored', second = b.anxiety.status === 'scored';
    if (first !== second) return first ? -1 : 1;
    if (first && a.anxiety.score !== b.anxiety.score) return (a.anxiety.score - b.anxiety.score) * direction;
    return chronological(a, b);
  });
}
const api = await request.newContext({ baseURL, timeout: 15000 });
let browser;
let page;
try {
  const response = await api.get('/api/dashboard?dataset=combined');
  check('combined API HTTP status', response.status(), 200);
  if (!response.ok()) throw new Error('Combined dataset API unavailable');
  const combined = await response.json();
  check('combined API dataset', combined.dataset, 'combined');
  check('combined API total', combined.posts.length, 957);
  check('combined API unique post identifiers', new Set(combined.posts.map(key)).size, 957);
  for (const [platform, amount] of Object.entries(expectedPlatforms)) check(`${platform} API count`, combined.posts.filter(post => post.platform === platform).length, amount);
  check('combined API six platforms', new Set(combined.posts.map(post => post.platform)).size, 6);
  check('combined API original relevant count', combined.posts.filter(post => post.analysis?.relevant).length, 831);
  check('combined API dashboard groups available', Array.isArray(combined.summary.groups), true);
  check('combined API dataset available', combined.meta.available_datasets.some(dataset => dataset.id === 'combined'), true);
  const statuses = counts(combined.posts);
  report.apiStatuses = statuses;
  check('all API scores have recognized states', Object.values(statuses).reduce((a, b) => a + b, 0), 957);
  check('no failed anxiety scores', statuses.error, 0);
  if (!allowPending) check('all 957 posts finished anxiety processing', statuses.scored + statuses.unassessable, 957);
  let invalidScores = 0, invalidQuotes = 0, leakedFields = 0;
  for (const post of combined.posts) {
    const anxiety = post.anxiety;
    if (!anxiety || Object.keys(anxiety).some(field => !publicScoreFields.includes(field))) leakedFields++;
    if (['raw', 'author_id', '_merge', 'collected_at'].some(field => Object.hasOwn(post, field))) leakedFields++;
    if (!anxiety) { invalidScores++; continue; }
    if (anxiety.status === 'scored') {
      if (typeof anxiety.score !== 'number' || !Number.isFinite(anxiety.score) || anxiety.score < 0 || anxiety.score > 1) invalidScores++;
      if (anxiety.score > 0 && (!Array.isArray(anxiety.evidence) || !anxiety.evidence.length)) invalidScores++;
    } else if (anxiety.score !== null) invalidScores++;
    if (!Array.isArray(anxiety.evidence) || anxiety.evidence.some(quote => typeof quote !== 'string' || !quote || !post.text.includes(quote))) invalidQuotes++;
  }
  check('anxiety numeric bounds and null semantics', invalidScores, 0);
  check('anxiety evidence appears verbatim in original', invalidQuotes, 0);
  check('API exposes display fields only', leakedFields, 0);
  for (const [dataset, total] of [['balanced', 268], ['xiaohongshu-available', 207], ['additional-chinese', 141], ['overseas-employment', 409]]) {
    const result = await api.get(`/api/dashboard?dataset=${dataset}`);
    check(`${dataset} API HTTP status`, result.status(), 200);
    const data = await result.json();
    check(`${dataset} original total unchanged`, data.posts.length, total);
    check(`${dataset} anxiety attached to every post`, data.posts.every(post => statusNames.includes(post.anxiety?.status)), true);
    report[`${dataset}Statuses`] = counts(data.posts);
  }
  for (const url of ['/outputs/combined/sample.jsonl', '/data/study.sqlite3', '/config.json']) check(`private route ${url} stays unavailable`, (await api.get(url)).status(), 404);

  const dependencyPath = '/home/lizd/.local/opt/playwright-deps/usr/lib/x86_64-linux-gnu';
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath(), headless: true, args: ['--no-sandbox'], env: { ...process.env, LD_LIBRARY_PATH: dependencyPath + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '') } });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/dashboard') report.dashboardRequests.push(request.url()); });
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.browserHttpErrors.push({ url: response.url(), status: response.status() }); });
  const initialResponse = page.waitForResponse(response => response.url().includes('/api/dashboard?dataset=combined'));
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  const live = await (await initialResponse).json();
  await page.locator('#dashboard:not([hidden])').waitFor();
  const livePosts = live.posts;
  report.browserStatuses = counts(livePosts);
  async function checkEnglishUI(label) {
    const issues = await page.evaluate(() => {
      const han = /\p{Script=Han}/u;
      const sourceText = element => element.closest('.post-body, .anxiety-evidence blockquote') || (element.closest('.post-evidence') && !element.matches('.post-evidence > span'));
      const results = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, element = node.parentElement;
        if (!element || element.closest('script, style') || sourceText(element)) continue;
        if (han.test(node.textContent)) results.push({ kind: 'text', element: element.id || element.className?.baseVal || element.className || element.tagName, value: node.textContent.trim() });
      }
      for (const element of document.querySelectorAll('[aria-label], [title], [placeholder], [data-tooltip]')) {
        if (sourceText(element) || element.closest('.post-evidence')) continue;
        for (const name of ['aria-label', 'title', 'placeholder', 'data-tooltip']) {
          const value = element.getAttribute(name);
          if (value && han.test(value)) results.push({ kind: name, element: element.id || element.tagName, value });
        }
      }
      return results;
    });
    check(`${label} UI uses English outside original text and quotations`, issues, []);
  }
  check('document language is English', await page.locator('html').getAttribute('lang'), 'en');
  check('browser title is English', /\p{Script=Han}/u.test(await page.title()), false);
  check('homepage defaults to combined dataset', live.dataset, 'combined');
  check('dataset dropdown and category row are absent', await page.locator('#dataset-select, #datasets').count(), 0);
  check('unified navigation exposes eleven platforms and summary', await page.locator('#platforms button').count(), 12);
  check('homepage default includes all 957 posts', await page.locator('#voice-count').innerText(), '957 posts');
  const initialPlatformOrder = await page.locator('#platforms button').evaluateAll(elements => elements.map(element => element.dataset.platform));
  check('all-platform summary remains first', initialPlatformOrder[0], 'all');
  const platformTotals = initialPlatformOrder.slice(1).map(platform => livePosts.filter(post => post.platform === platform).length);
  check('platform navigation follows descending total sample counts', platformTotals.every((amount, index) => index === 0 || platformTotals[index - 1] >= amount), true);
  await checkEnglishUI('homepage');
  check('combined relevance defaults to all', await page.locator('#relevance-filter').inputValue(), 'all');
  check('combined candidate metric', (await page.locator('#metric-selected').innerText()).trim(), '957');
  check('histogram has ten fixed bins', await page.locator('#anxiety-histogram [data-anxiety-bin]').count(), 10);
  check('annual anxiety chart SVG rendered', await page.locator('#anxiety-annual svg').count(), 1);
  const liveScored = scored(livePosts), values = liveScored.map(post => post.anxiety.score).sort((a, b) => a - b);
  const expectedMean = values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : '—';
  const expectedMedian = values.length ? median(values).toFixed(2) : '—';
  check('mean uses scored values and includes real zero', (await page.locator('#anxiety-mean').innerText()).trim(), expectedMean);
  check('median excludes missing scores', (await page.locator('#anxiety-median').innerText()).trim(), expectedMedian);
  check('unknown count is separate', (await page.locator('#anxiety-unknown').innerText()).trim(), String(report.browserStatuses.unassessable));

  const uiCount = async () => Number((await page.locator('#voice-count').innerText()).replace(/[^\d]/g, ''));
  const currentDataset = async () => page.evaluate(() => state.data?.dataset);
  const waitForSelection = async (dataset, platform = 'all') => page.waitForFunction(expected => state.data?.dataset === expected.dataset && state.platform === expected.platform && !document.body.classList.contains('is-loading'), { dataset, platform });
  const clickSummary = async () => { await page.locator('#platforms [data-platform="all"]').click(); await waitForSelection('combined'); };
  const reset = async () => { await page.locator('#reset').click(); await page.waitForFunction(() => document.querySelector('#search').value === ''); };
  const clearAnxiety = async () => { await page.locator('#anxiety-clear').click(); };
  const setNumber = async (id, value) => { await page.locator('#' + id).fill(String(value)); await page.locator('#' + id).dispatchEvent('change'); };
  const bodyTexts = async () => page.locator('.post-body').allTextContents();
  async function download(label, expectedPosts) {
    if (!expectedPosts.length) { check(`${label} CSV disabled for empty results`, await page.locator('#download').isDisabled(), true); return; }
    const wait = page.waitForEvent('download');
    await page.locator('#download').click();
    const file = await wait;
    const destination = path.join(output, label.replace(/[^a-z0-9-]/gi, '-') + '.csv');
    await file.saveAs(destination);
    const rows = parse(await fs.readFile(destination, 'utf8'), { bom: true, columns: true });
    check(`${label} CSV rows match complete UI filter`, rows.length, expectedPosts.length);
    const columns = Object.keys(rows[0] || {});
    check(`${label} CSV keeps all 23 fields`, columns.length, 23);
    check(`${label} CSV headers are English`, columns.every(name => /[A-Za-z]/u.test(name) && !/\p{Script=Han}/u.test(name)), true);
    check(`${label} CSV anxiety headers present`, ['Anxiety score', 'Anxiety status', 'Anxiety evidence', 'Anxiety reason', 'Anxiety prompt version'].every(name => columns.includes(name)), true);
    const translatedFields = ['Platform', 'Relevance', 'Topics', 'Sentiment', 'Emotions', 'Entry type', 'Language', 'Market region', 'Anxiety status', 'Anxiety reason'];
    check(`${label} CSV metadata and explanations are English`, rows.every(row => translatedFields.every(field => !/\p{Script=Han}/u.test(row[field] || ''))), true);
    check(`${label} CSV preserves original source text`, rows.map(row => row.Text).sort(), expectedPosts.map(post => spreadsheetSafe(post.text)).sort());
    check(`${label} CSV preserves original anxiety quotations`, expectedPosts.every(post => rows.some(row => row.Text === spreadsheetSafe(post.text) && row['Source URL'] === post.url && post.anxiety.evidence.every(quote => row['Anxiety evidence'].includes(quote)))), true);
    const zeroPosts = expectedPosts.filter(post => post.anxiety.status === 'scored' && post.anxiety.score === 0);
    if (zeroPosts.length) check(`${label} CSV keeps real zero`, rows.some(row => row['Anxiety score'] === '0'), true);
    const unknownPosts = expectedPosts.filter(post => post.anxiety.status !== 'scored');
    if (unknownPosts.length) check(`${label} CSV missing value remains empty`, rows.filter(row => row['Anxiety score'] === '').length, unknownPosts.length);
    report.downloads.push({ label, filename: file.suggestedFilename(), rows: rows.length, destination });
  }

  await download('combined-all', [...livePosts].sort(chronological));
  const firstPage = await bodyTexts();
  check('reading list first page has six cards', firstPage.length, 6);
  check('reading list preserves original source text', firstPage, [...livePosts].sort(chronological).slice(0, 6).map(post => post.text));
  await page.locator('#next').click();
  check('pagination advances', (await page.locator('#page-number').innerText()).startsWith('2 /'), true);
  check('pagination changes visible original text', JSON.stringify(await bodyTexts()) !== JSON.stringify(firstPage), true);
  await reset();
  await page.locator('#platforms [data-platform="weibo"]').click();
  check('platform filter applies to reading list', await uiCount(), 200);
  check('platform filter applies to anxiety denominator', (await page.locator('#anxiety-denominator').innerText()).includes(String(scored(livePosts.filter(post => post.platform === 'weibo')).length)), true);
  await reset();
  await page.locator('#years [data-year="2022"]').click();
  check('year filter applies to reading list', await uiCount(), livePosts.filter(post => post.season_year === 2022).length);
  await reset();
  await page.locator('#search').fill('秋招');
  const searched = livePosts.filter(post => post.text.toLocaleLowerCase().includes('秋招'));
  check('text search filters original posts', await uiCount(), searched.length);
  await reset();
  await page.locator('#relevance-filter').selectOption('relevant');
  check('relevance filter retains original 831 related', await uiCount(), 831);
  await reset();

  for (const status of statusNames) {
    await page.locator('#anxiety-status').selectOption(status);
    check(`status filter ${status}`, await uiCount(), livePosts.filter(post => post.anxiety.status === status).length);
    check(`status filter ${status} card labels`, await page.locator(`.post-anxiety:not([data-anxiety-status="${status}"])`).count(), 0);
  }
  await clearAnxiety();
  await setNumber('anxiety-min', .25);
  await setNumber('anxiety-max', .75);
  const ranged = livePosts.filter(post => post.anxiety.status === 'scored' && post.anxiety.score >= .25 && post.anxiety.score <= .75);
  check('numeric range filters score inclusively', await uiCount(), ranged.length);
  await download('anxiety-range', ranged);
  await clearAnxiety();
  await setNumber('anxiety-max', 0);
  const zeroRows = livePosts.filter(post => post.anxiety.status === 'scored' && post.anxiety.score === 0);
  check('zero-only range excludes missing values', await uiCount(), zeroRows.length);
  if (zeroRows.length) check('zero-only average remains zero', (await page.locator('#anxiety-mean').innerText()).trim(), '0.00');
  await clearAnxiety();

  if (liveScored.length) {
    const bins = Array(10).fill(0);
    for (const post of liveScored) bins[Math.min(9, Math.floor(post.anxiety.score * 10))]++;
    const bin = bins.indexOf(Math.max(...bins));
    await page.locator(`#anxiety-histogram [data-anxiety-bin="${bin}"]`).click();
    check('histogram click filters exact interval', await uiCount(), bins[bin]);
    await clearAnxiety();
    await page.locator('#post-sort').selectOption('anxiety-desc');
    check('descending score sort matches API scores', await bodyTexts(), ordered(livePosts, -1).slice(0, 6).map(post => post.text));
    await page.locator('#post-sort').selectOption('anxiety-asc');
    check('ascending score sort matches API scores', await bodyTexts(), ordered(livePosts, 1).slice(0, 6).map(post => post.text));
    const year = liveScored[0].season_year;
    await page.locator(`#anxiety-annual [data-anxiety-year="${year}"]`).click();
    check('annual anxiety click scopes publication year', await uiCount(), livePosts.filter(post => post.season_year === year).length);
    await reset();
    await page.locator('#post-sort').selectOption('anxiety-desc');
    const expectedFirst = ordered(livePosts, -1)[0];
    check('card displays model anxiety score', (await page.locator('.post-anxiety-label strong').first().innerText()).trim(), expectedFirst.anxiety.score.toFixed(2));
    const details = page.locator('.anxiety-evidence').first();
    if (await details.count()) {
      await details.locator('summary').click();
      check('score explanation can be expanded', await details.getAttribute('open') !== null, true);
      const quotes = await details.locator('blockquote').allTextContents();
      check('card evidence matches API evidence', quotes, expectedFirst.anxiety.evidence);
      await checkEnglishUI('expanded score explanation');
    }
  } else report.skipped.push('No scored records yet: histogram selection, score order and evidence expansion require completed model results.');

  await reset();
  await page.locator('#search').fill('秋招');
  await setNumber('anxiety-min', .25);
  await setNumber('anxiety-max', .75);
  const filteredCount = await uiCount();
  const beforeHashNavigation = report.dashboardRequests.length;
  await page.locator('a[href="#anxiety"]').first().click();
  await page.locator('#dashboard:not([hidden])').waitFor();
  await page.waitForLoadState('networkidle');
  check('hash navigation keeps current search', await page.locator('#search').inputValue(), '秋招');
  check('hash navigation keeps score minimum', Number(await page.locator('#anxiety-min').inputValue()), .25);
  check('hash navigation keeps score maximum', Number(await page.locator('#anxiety-max').inputValue()), .75);
  check('hash navigation keeps filtered results', await uiCount(), filteredCount);
  check('hash navigation avoids dashboard API reload', report.dashboardRequests.length, beforeHashNavigation);
  await reset();

  const beforePlatformHistory = report.dashboardRequests.length;
  await page.locator('#platforms [data-platform="weibo"]').click();
  await page.locator('#platforms [data-platform="nowcoder"]').click();
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#platforms [data-platform="weibo"]').getAttribute('aria-pressed') === 'true');
  await page.waitForLoadState('networkidle');
  check('back restores same-dataset platform', await uiCount(), 200);
  check('back keeps combined dataset selected', await currentDataset(), 'combined');
  check('same-dataset platform back avoids API reload', report.dashboardRequests.length, beforePlatformHistory);
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('#platforms [data-platform="nowcoder"]').getAttribute('aria-pressed') === 'true');
  await page.waitForLoadState('networkidle');
  check('forward restores same-dataset platform', await uiCount(), 141);
  check('same-dataset platform forward avoids API reload', report.dashboardRequests.length, beforePlatformHistory);
  await reset();

  for (const [platform, amount] of Object.entries(expectedPlatforms)) {
    const before = report.dashboardRequests.length;
    await page.locator(`#platforms [data-platform="${platform}"]`).click();
    await waitForSelection('combined', platform);
    check(`${platform} unified navigation keeps combined data`, await currentDataset(), 'combined');
    check(`${platform} unified navigation includes full platform sample`, await uiCount(), amount);
    check(`${platform} selection within combined avoids API reload`, report.dashboardRequests.length, before);
  }
  check('XHS sample switch appears only for XHS', await page.locator('#xhs-sample-mode').isVisible(), false);
  await page.locator('#platforms [data-platform="xiaohongshu"]').click();
  await waitForSelection('combined', 'xiaohongshu');
  check('XHS combined sample includes 207 posts', (await page.locator('#metric-selected').innerText()).trim(), '207');
  check('XHS sample switch label', (await page.locator('#xhs-sample-mode').innerText()).trim(), 'Annual sample');
  check('XHS full sample leaves annual mode inactive', await page.locator('#xhs-sample-mode').getAttribute('aria-pressed'), 'false');
  await page.locator('#xhs-sample-mode').click();
  await waitForSelection('balanced', 'xiaohongshu');
  check('XHS annual sample keeps 68 candidates', (await page.locator('#metric-selected').innerText()).trim(), '68');
  check('XHS annual sample retains 49 related posts', await uiCount(), 49);
  check('XHS annual sample marks annual mode active', await page.locator('#xhs-sample-mode').getAttribute('aria-pressed'), 'true');
  await page.locator('#xhs-sample-mode').click();
  await waitForSelection('combined', 'xiaohongshu');
  check('XHS switch restores all 207 posts', await uiCount(), 207);
  check('XHS full sample clears annual mode active state', await page.locator('#xhs-sample-mode').getAttribute('aria-pressed'), 'false');
  check('XHS sample switching preserves platform ordering', await page.locator('#platforms button').evaluateAll(elements => elements.map(element => element.dataset.platform)), initialPlatformOrder);
  await clickSummary();
  check('summary restores all 957 posts after XHS sample switching', await uiCount(), 957);

  for (const [platform, dataset] of [['x', 'balanced'], ['bilibili', 'additional-chinese'], ['zhihu', 'additional-chinese'], ['reddit', 'overseas-employment'], ['bluesky', 'overseas-employment']]) {
    await page.locator(`#platforms [data-platform="${platform}"]`).click();
    await waitForSelection(dataset, platform);
    check(`${platform} zero-sample platform uses original dataset`, await currentDataset(), dataset);
    check(`${platform} zero-sample platform keeps the real empty state`, await uiCount(), 0);
    check(`${platform} zero-sample platform hides XHS sample switch`, await page.locator('#xhs-sample-mode').isVisible(), false);
    await checkEnglishUI(`${platform} empty state`);
    await clickSummary();
    check(`summary returns from ${platform} to combined`, await uiCount(), 957);
  }

  async function openDatasetLink(dataset) {
    const reply = page.waitForResponse(response => response.url().includes('/api/dashboard') && new URL(response.url()).searchParams.get('dataset') === dataset);
    await page.goto(`${baseURL}/?dataset=${encodeURIComponent(dataset)}`, { waitUntil: 'networkidle' });
    const result = await (await reply).json();
    await waitForSelection(dataset, dataset === 'xiaohongshu-available' ? 'xiaohongshu' : 'all');
    return result;
  }
  for (const [dataset, total] of [['xiaohongshu-available', 207], ['additional-chinese', 141], ['overseas-employment', 409]]) {
    await openDatasetLink(dataset);
    check(`${dataset} legacy link still loads original dataset`, await currentDataset(), dataset);
    check(`${dataset} legacy link keeps original candidate count`, (await page.locator('#metric-selected').innerText()).trim(), String(total));
    await checkEnglishUI(`${dataset} legacy dataset`);
    await clickSummary();
    check(`summary restores combined from ${dataset} legacy link`, await uiCount(), 957);
  }
  await openDatasetLink('balanced');
  check('old dataset UI keeps original candidate count', (await page.locator('#metric-selected').innerText()).trim(), '268');
  check('old dataset UI retains related default', await page.locator('#relevance-filter').inputValue(), 'relevant');
  await clickSummary();
  check('combined can be restored via summary from old dataset', await uiCount(), 957);
  const beforeDatasetBack = report.dashboardRequests.length;
  const backResponse = page.waitForResponse(response => response.url().includes('/api/dashboard') && new URL(response.url()).searchParams.get('dataset') === 'balanced');
  await page.goBack();
  check('cross-dataset back requests original dataset', (await (await backResponse).json()).dataset, 'balanced');
  await page.waitForFunction(() => document.querySelector('#metric-selected').textContent.trim() === '268');
  await page.waitForLoadState('networkidle');
  check('cross-dataset back restores original dataset', await currentDataset(), 'balanced');
  check('cross-dataset back restores relevance default', await page.locator('#relevance-filter').inputValue(), 'relevant');
  check('cross-dataset back performs one API reload', report.dashboardRequests.length, beforeDatasetBack + 1);
  const beforeDatasetForward = report.dashboardRequests.length;
  const forwardResponse = page.waitForResponse(response => response.url().includes('/api/dashboard') && new URL(response.url()).searchParams.get('dataset') === 'combined');
  await page.goForward();
  check('cross-dataset forward requests combined dataset', (await (await forwardResponse).json()).dataset, 'combined');
  await page.waitForFunction(() => document.querySelector('#metric-selected').textContent.trim() === '957');
  await page.waitForLoadState('networkidle');
  check('cross-dataset forward restores combined dataset', await currentDataset(), 'combined');
  check('cross-dataset forward restores all-post default', await page.locator('#relevance-filter').inputValue(), 'all');
  check('cross-dataset forward restores all posts', await uiCount(), 957);
  check('cross-dataset forward performs one API reload', report.dashboardRequests.length, beforeDatasetForward + 1);
  await page.locator('a[href="#anxiety"]').first().click();
  await page.locator('#dashboard:not([hidden])').waitFor();
  await page.waitForLoadState('networkidle');
  check('anxiety section navigation works', await page.locator('#anxiety').isVisible(), true);
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.locator('#anxiety').screenshot({ path: path.join(output, 'desktop-anxiety.png') });
  check('desktop has no document horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  await page.locator('#anxiety').screenshot({ path: path.join(output, 'mobile-anxiety.png') });
  check('mobile has no document horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  check('mobile anxiety controls visible', await page.locator('#anxiety-status').isVisible(), true);
  await checkEnglishUI('mobile');
  check('browser JavaScript errors', report.pageErrors.length, 0);
  check('browser console errors', report.consoleErrors.length, 0);
  check('browser HTTP errors', report.browserHttpErrors.length, 0);
} catch (error) {
  report.fatalError = error.stack || error.message;
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.stderr.write(`${error.stack || error.message}\n`);
} finally {
  await browser?.close();
  await api.dispose();
  report.finishedAt = new Date().toISOString();
  report.passed = !report.fatalError && report.checks.every(item => item.passed);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.checks.filter(item => !item.passed).length, skipped: report.skipped, report: path.join(output, 'report.json') }, null, 2) + '\n');
  if (!report.passed) process.exitCode = 1;
}
