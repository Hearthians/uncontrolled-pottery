import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { generateFieldShape } from '../src/scoreFieldTrial.ts';
import { SCORE_STUDY } from '../src/scoreStudyCore.ts';

const root = resolve(import.meta.dirname, '..');
const output = resolve(process.env.SCORE_VIDEO_DIR ?? join(root, 'artifacts/score-study/video'));
const width = 1920, height = 1080, count = 300, fps = 30, turns = 2.5;
const geometryDir = join(output, 'geometry'), frameDir = join(output, 'frames');
const fields = ['x', 'y', 'z', 'width', 'height', 'sourceX', 'sourceY', 'sourceZ', 'gap', 'breakBefore', 'path', 'theta'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const number = value => String(value).padStart(4, '0');
const manifestFile = join(output, 'manifest.json');
const resume = Boolean(process.env.SCORE_VIDEO_RESUME);
const previous = existsSync(manifestFile) ? JSON.parse(await readFile(manifestFile, 'utf8')) : undefined;
if (previous && !resume) throw new Error(`Output already has a manifest. Use a fresh SCORE_VIDEO_DIR, or SCORE_VIDEO_RESUME=1 to resume the same sources: ${output}`);
if (resume && !previous) throw new Error(`Cannot resume without a complete geometry manifest: ${manifestFile}`);
async function saveManifest(value) {
  const temporary = `${manifestFile}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, manifestFile);
}
async function sourceHashes(files) {
  return Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(join(root, file)))])));
}
const geometrySources = await sourceHashes(['src/scoreFieldTrial.ts', 'src/scoreStudyCore.ts']);
const renderSources = await sourceHashes(['scripts/render-score-video.mjs', 'src/scoreStudyRenderer.ts', 'src/scoreStudyMesh.ts',
  'xiaojun-version/GrammarofFailure_PrototypeB_v1/src/clayAppearance.ts', 'package-lock.json']);
const geometryFingerprint = hash(JSON.stringify({ geometrySources, count, fields, seed: SCORE_STUDY.seed }));
const renderFingerprint = hash(JSON.stringify({ renderSources, geometryFingerprint, width, height, fps, turns, browser: chromium.executablePath() }));
if (previous) {
  assert.equal(previous.geometryFingerprint, geometryFingerprint, 'Geometry sources changed; choose a fresh SCORE_VIDEO_DIR to avoid mixing revisions.');
  assert.equal(previous.renderFingerprint, renderFingerprint, 'Rendering sources changed; choose a fresh SCORE_VIDEO_DIR to avoid stale frames.');
  assert.equal(previous.frames?.length, count, 'Cannot resume an incomplete geometry manifest.');
}
await mkdir(geometryDir, { recursive: true }); await mkdir(frameDir, { recursive: true });
const ffmpeg = process.env.SCORE_VIDEO_FFMPEG ?? join(root, '.runtime/score-video-tools/ffmpeg');
const ffprobe = process.env.SCORE_VIDEO_FFPROBE ?? join(dirname(ffmpeg), 'ffprobe');

function caption(score) {
  if (score < .25) return 'One score. Continuous change.';
  if (score < .5) return 'Clay swells and layers drift.';
  if (score < .75) return 'Bulges and bends grow together.';
  return 'The same form, increasingly unstable.';
}
function timestamp(seconds) {
  const ms = Math.round(seconds * 1000);
  return `00:00:${String(Math.floor(ms / 1000)).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
async function command(binary, args) {
  await new Promise((resolveCommand, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = ''; child.stderr.on('data', data => { errors = (errors + data.toString()).slice(-6000); });
    child.on('error', reject); child.on('close', code => code === 0 ? resolveCommand() : reject(new Error(`${binary} exited ${code}: ${errors}`)));
  });
}

// Phase 1 is deliberately completed before any browser is launched. Each record
// is a full C solution at that frame's score; no animated slider is recorded.
let manifest;
if (previous) {
  // Every saved solution is verified before launching the browser. A valid
  // resume retains its original computation and per-frame render timestamps.
  for (const frame of previous.frames) {
    assert.equal(frame.index, previous.frames.indexOf(frame));
    assert.equal(frame.score, frame.index / (count - 1));
    assert.equal(frame.yawRadians, -Math.PI + frame.score * turns * Math.PI * 2);
    assert.equal(hash(await readFile(join(output, frame.geometryFile))), frame.geometrySha256,
      `Saved geometry ${frame.index} changed; use a fresh output directory.`);
  }
  manifest = previous;
  console.log(`Verified all ${count} saved C geometries before resuming rendering.`);
} else {
  const generatedAt = new Date().toISOString(), frames = [], start = performance.now();
  for (let index = 0; index < count; index++) {
    const score = index / (count - 1), yaw = -Math.PI + score * turns * Math.PI * 2;
    const shape = generateFieldShape(score, SCORE_STUDY.seed);
    const values = new Float32Array(shape.points.length * fields.length);
    for (let point = 0; point < shape.points.length; point++) for (let field = 0; field < fields.length; field++) {
      const value = shape.points[point][fields[field]];
      values[point * fields.length + field] = typeof value === 'boolean' ? Number(value) : value ?? 0;
    }
    const data = Buffer.from(values.buffer), file = `geometry/frame-${number(index)}.f32`;
    await writeFile(join(output, file), data);
    frames.push({ index, timeSeconds: index / fps, score, yawRadians: yaw, caption: caption(score),
      geometryFile: file, pointCount: shape.points.length, geometrySha256: hash(data), metrics: shape.metrics });
    if ((index + 1) % 50 === 0) console.log(`Computed ${index + 1}/${count} C geometries.`);
  }
  const computedAt = new Date().toISOString();
  manifest = { version: 'scalar-form-video-2', generatedAt, computedAt, width, height, frameCount: count, fps,
    durationSeconds: count / fps, turns, scoreRange: [0, 1], scoreFormula: 'frameIndex / 299',
    yawFormula: '-pi + score * 2.5 * 2*pi', strategy: 'field', seed: SCORE_STUDY.seed,
    geometryFormat: { storage: 'Float32 little-endian', fields }, geometryComputationMs: performance.now() - start,
    geometrySourceSha256: geometrySources['src/scoreFieldTrial.ts'], geometrySources, renderSources,
    geometryFingerprint, renderFingerprint, uniqueGeometryCount: new Set(frames.map(frame => frame.geometrySha256)).size, frames };
  await saveManifest(manifest);
  console.log(`All ${count} geometries saved before rendering (${Math.round(manifest.geometryComputationMs)} ms).`);
}
const frames = manifest.frames;
function frameFingerprint(frame) {
  return hash(JSON.stringify({ renderFingerprint, geometrySha256: frame.geometrySha256,
    score: frame.score, yaw: frame.yawRadians, caption: frame.caption }));
}
async function assertSourcesUnchanged() {
  assert.deepEqual(await sourceHashes(Object.keys(geometrySources)), geometrySources,
    'Geometry sources changed during this run; restart into a fresh output directory.');
  assert.deepEqual(await sourceHashes(Object.keys(renderSources)), renderSources,
    'Rendering sources changed during this run; restart into a fresh output directory.');
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#eee7dd;color:#382d24;font-family:Arial,sans-serif}
canvas{display:block;width:1920px;height:1080px}.topline{position:absolute;left:76px;right:76px;top:62px;display:flex;justify-content:space-between;align-items:start;pointer-events:none}
.title{font-size:22px;letter-spacing:3.5px;color:#7a4b34}.sub{margin-top:14px;font-size:18px;color:#8b7763;letter-spacing:1.1px}
.score{text-align:right;font-size:20px;color:#816a55;letter-spacing:1px}.score strong{display:block;font-family:Georgia,serif;font-weight:400;font-size:68px;color:#9c5738;letter-spacing:0;margin-top:5px}
.caption{position:absolute;bottom:34px;left:250px;right:250px;text-align:center;font-size:32px;line-height:1.4;letter-spacing:.5px;color:#4a3729}
.caption span{display:inline-block;background:rgba(244,239,230,.94);padding:10px 28px;border:1px solid rgba(130,99,75,.12)}
</style></head><body><canvas id="scene" width="1920" height="1080"></canvas>
<div class="topline"><div><div class="title">GRAMMAR OF FAILURE</div><div class="sub">C / CONTINUOUS DEFORMATION FIELD</div></div><div class="score">INSTABILITY SCORE<strong id="score">0.000</strong></div></div>
<div class="caption"><span id="caption">One score. Continuous change.</span></div>
<script type="module">
import { createScoreRenderer } from '/src/scoreStudyRenderer.ts';
const renderer = createScoreRenderer(document.querySelector('canvas')); renderer.size(${width},${height});
const manifest = await (await fetch('/__video/manifest')).json();
window.renderFrame = async index => {
 const frame = manifest.frames[index];
 const buffer = await (await fetch('/__video/geometry/' + index)).arrayBuffer(), data = new Float32Array(buffer);
 const fields = manifest.geometryFormat.fields, points = Array.from({length:frame.pointCount},(_,i)=>{
  const p={}; for(let j=0;j<fields.length;j++) p[fields[j]]=fields[j]==='gap'||fields[j]==='breakBefore'?!!data[i*fields.length+j]:data[i*fields.length+j]; return p;
 });
 renderer.show({ strategy:'field', score:frame.score, seed:manifest.seed, points },frame.yawRadians);
 document.querySelector('#score').textContent=frame.score.toFixed(3);document.querySelector('#caption').textContent=frame.caption;
 await document.fonts.ready;
 return {score:frame.score,yaw:frame.yawRadians,pointCount:points.length};
};
window.videoReady=true;
</script></body></html>`;

const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'offline-score-video', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/__video') { res.setHeader('content-type', 'text/html'); res.end(html); return; }
      if (url.pathname === '/__video/manifest') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(manifest)); return; }
      const match = /^\/__video\/geometry\/(\d+)$/.exec(url.pathname);
      if (match && Number(match[1]) < count) { res.setHeader('content-type', 'application/octet-stream'); res.end(await readFile(join(output, frames[Number(match[1])].geometryFile))); return; }
      next();
    });
  } }] });
await assertSourcesUnchanged();
await server.listen();
const address = server.httpServer.address(), url = `http://127.0.0.1:${address.port}/__video`;
const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.videoReady);
  for (const frame of frames) {
    const file = join(frameDir, `frame-${number(frame.index)}.png`);
    const fingerprint = frameFingerprint(frame);
    if (resume && existsSync(file) && frame.pngSha256 && frame.pngFingerprint === fingerprint
      && hash(await readFile(file)) === frame.pngSha256) continue;
    const actual = await page.evaluate(index => window.renderFrame(index), frame.index);
    assert.equal(actual.score, frame.score); assert.equal(actual.yaw, frame.yawRadians);
    const image = await page.screenshot({ type: 'png', path: file, animations: 'disabled' });
    frame.pngSha256 = hash(image); frame.pngFingerprint = fingerprint; frame.renderedAt = new Date().toISOString();
    await saveManifest(manifest);
    if ((frame.index + 1) % 25 === 0) console.log(`Rendered ${frame.index + 1}/${count} offline frames.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
await assertSourcesUnchanged();
manifest.renderedAt = frames.map(frame => frame.renderedAt).sort().at(-1);
await saveManifest(manifest);

const segments = [];
for (const frame of frames) {
  const previous = segments.at(-1);
  if (previous?.text === frame.caption) previous.end = (frame.index + 1) / fps;
  else segments.push({ text: frame.caption, start: frame.index / fps, end: (frame.index + 1) / fps });
}
const srt = segments.map((segment, index) => `${index + 1}\n${timestamp(segment.start)} --> ${timestamp(segment.end)}\n${segment.text}\n`).join('\n');
const subtitles = join(output, 'grammar-of-failure-c.en.srt'); await writeFile(subtitles, srt);
const video = join(output, 'grammar-of-failure-c-10s.mp4');
await command(ffmpeg, ['-y', '-framerate', String(fps), '-i', join(frameDir, 'frame-%04d.png'), '-i', subtitles,
  '-map', '0:v:0', '-map', '1:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-metadata', 'title=Grammar of Failure — Continuous Deformation Field',
  '-metadata', 'comment=300 precomputed C geometries; score 0–1; 2.5 rotations in 10 seconds', '-frames:v', String(count),
  '-r', String(fps), '-movflags', '+faststart', '-an', video]);
const probe = await new Promise((resolveProbe, reject) => {
  const child = spawn(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', video]);
  let output = ''; child.stdout.on('data', data => { output += data; }); child.on('error', reject);
  child.on('close', code => code === 0 ? resolveProbe(JSON.parse(output)) : reject(new Error(`ffprobe exited ${code}`)));
});
const stream = probe.streams.find(stream => stream.codec_type === 'video');
assert.equal(Number(stream.nb_read_frames), count); assert.equal(Number(stream.duration), count / fps);
assert.equal(stream.width, width); assert.equal(stream.height, height); assert.equal(stream.codec_name, 'h264');
assert.equal(stream.pix_fmt, 'yuv420p'); assert.equal(stream.avg_frame_rate, '30/1');
const contact = join(output, 'contact-sheet.jpg');
const contactFrames = [0, 33, 66, 99, 132, 165, 198, 231, 264, 299];
await command(ffmpeg, ['-y', '-i', video, '-vf', `select='${contactFrames.map(frame => `eq(n,${frame})`).join('+')}',scale=480:270,tile=5x2`, '-frames:v', '1', contact]);
const bytes = await readFile(video);
manifest.completedAt = new Date().toISOString(); manifest.video = { file: 'grammar-of-failure-c-10s.mp4', sha256: hash(bytes), bytes: (await stat(video)).size,
  codec: stream.codec_name, pixelFormat: stream.pix_fmt, width, height, fps, frames: count, durationSeconds: Number(stream.duration), subtitles: 'grammar-of-failure-c.en.srt' };
await saveManifest(manifest);
await writeFile(join(output, 'ffprobe.json'), JSON.stringify(probe, null, 2));
console.log(`Video verified: ${video} (${count} frames, ${count / fps}s, ${width}×${height}).`);
