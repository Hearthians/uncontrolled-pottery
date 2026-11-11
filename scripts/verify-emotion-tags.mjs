// Local-only isolated component fixture: no real memory corpus or backend is read.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.env.POTTERY_TAGS_URL || 'http://127.0.0.1:5173';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only a local test server is allowed');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
const fixture = `
import React from '/node_modules/.vite/deps/react.js';
const {useState} = React;
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {MemoryPlayback} from '/src/MemoryPlayback.tsx';
const e=React.createElement;
const original=[
 {text:'Same fabricated passage',scores:{calm:0,anxiety:1,anger:2,stress:3,sadness:4}},
 {text:'Same fabricated passage',scores:{calm:5,anxiety:4,anger:3,stress:2,sadness:1}},
 {text:'Unscored fabricated passage'}
];
function Fixture(){
 const [memories,setMemories]=useState(original), [step,setStep]=useState(0);
 window.fixture={setStep,replace:()=>setMemories([{text:'Replacement',scores:{calm:2,anxiety:2,anger:2,stress:2,sadness:2}}]),clear:()=>setMemories([])};
 return e('div',{className:'control-panel memory-panel has-memories',style:{width:'248px',height:'700px'}},e(MemoryPlayback,{memories,emotion:'obsolete',sourceState:{phase:'ready',error:''},source:{clear:()=>setMemories([]),loadDefault:()=>{},importFile:()=>{}},depositedSteps:step,totalSteps:300,status:'ready'}));
}
ReactDOM.createRoot(document.getElementById('root')).render(e(Fixture));`;
async function open(reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport: { width: 320, height: 900 }, reducedMotion });
  page.on('pageerror', error => console.error('Browser error:', error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
  await page.goto(base);
  await expect(page.locator('.memory-emotion-tag')).toHaveCount(5);
  return page;
}
const tags = page => page.locator('.memory-emotion-tags');
const index = (page, value) => expect(tags(page)).toHaveAttribute('data-tag-memory-index', String(value));
try {
  const page = await open();
  await index(page, 0);
  await expect(tags(page)).toContainText('Calm0');
  await expect(tags(page).locator('[aria-label="Sadness: 4 out of 5"]')).toHaveCount(1);
  await expect(page.locator('.memory-carousel .memory-emotion-tags')).toHaveCount(0);
  assert.equal(await page.locator('.memory-playback').evaluate(n => n.scrollWidth <= n.clientWidth), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  // Pause all freshly created WAAPI animations before their first frame and seek
  // their shared document timeline, so the exit/handoff checks are deterministic.
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) { const animation = animate.apply(this, args); animation.pause(); return animation; };
  });
  await page.getByRole('button', { name: 'Read next memory' }).click();
  await expect(page.locator('.memory-outgoing')).toHaveCount(1);
  await index(page, 0);
  const seek = time => page.locator('.memory-carousel').evaluate((node, ms) => {
    for (const a of node.getAnimations({subtree:true})) {
      const duration = Number(a.effect.getTiming().duration);
      if (ms >= duration) a.finish(); else a.currentTime = ms;
    }
  }, time);
  await seek(179);
  await index(page, 0);
  await expect(page.locator('.memory-active')).toHaveCSS('opacity', '0');
  await seek(180);
  await index(page, 1);
  await expect(tags(page)).toContainText('Calm5');
  await seek(630);
  await expect(page.locator('.memory-outgoing')).toHaveCount(0);
  // Rapid navigation before handoff retains the actual outgoing passage.
  await page.getByRole('button', { name: 'Read previous memory' }).click();
  await seek(50);
  await page.getByRole('button', { name: 'Read next memory' }).click();
  await index(page, 1);
  await expect(page.locator('.memory-outgoing p')).toHaveText('Same fabricated passage');
  await seek(630);
  await page.getByRole('button', { name: 'Read next memory' }).click();
  await seek(180);
  await index(page, 2);
  await expect(tags(page).locator('[aria-label$="score unavailable"]')).toHaveCount(5);
  await page.evaluate(() => window.fixture.replace());
  await index(page, 0);
  await expect(tags(page)).toContainText('Calm2');
  await expect(page.locator('.memory-outgoing')).toHaveCount(0);
  await page.evaluate(() => window.fixture.clear());
  await expect(tags(page)).toHaveCount(0);
  await page.close();

  const auto = await open();
  await auto.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) { const a = animate.apply(this, args); a.pause(); return a; };
    window.fixture.setStep(100);
  });
  await expect(auto.locator('.memory-outgoing')).toHaveCount(1);
  await index(auto, 0);
  await auto.locator('.memory-carousel').evaluate(n => n.getAnimations({subtree:true}).forEach(a => {a.currentTime=239;}));
  await index(auto, 0);
  await auto.locator('.memory-carousel').evaluate(n => n.getAnimations({subtree:true}).forEach(a => {if (a.effect.getTiming().duration === 240) a.finish(); else a.currentTime=240;}));
  await index(auto, 1);
  await auto.emulateMedia({ forcedColors: 'active' });
  const forced = await tags(auto).locator('span.memory-emotion-tag').first().evaluate(n => {const s=getComputedStyle(n); return [s.color,s.backgroundColor,s.borderTopColor];});
  assert.equal(forced[0], forced[2]);
  await auto.close();
  const reduced = await open('reduce');
  await reduced.getByRole('button', { name: 'Read next memory' }).click();
  await index(reduced, 1);
  await expect(reduced.locator('.memory-outgoing')).toHaveCount(0);
  await reduced.close();
  const flow = await browser.newPage({ viewport: { width: 1000, height: 900 }, reducedMotion: 'reduce' });
  let posts = 0, deletes = 0, polls = 0;
  const scores = { calm: 5, anxiety: 0, anger: 1, stress: 2, sadness: 3 };
  await flow.route('**/memories.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(['Previous fabricated memory']) }));
  await flow.route('**/api/memories/jobs**', async route => {
    const method = route.request().method();
    if (method === 'POST') {
      posts++;
      assert.equal(route.request().headers()['x-memory-access-code'], 'test-code');
      assert.deepEqual(route.request().postDataJSON(), {input:{kind:'text',text:'Fabricated new memory'}});
      await route.fulfill({status:202, json:{id:'test-job',token:'secret-token'}});
    } else if (method === 'DELETE') {
      deletes++;
      assert.equal(route.request().headers()['x-memory-job-token'], 'secret-token');
      await route.fulfill({json:{id:'test-job',status:'cancelled',progress:{completed:0,total:0}}});
    } else {
      polls++;
      assert.equal(route.request().headers()['x-memory-access-code'], 'test-code');
      assert.equal(route.request().headers()['x-memory-job-token'], 'secret-token');
      await route.fulfill({json:{id:'test-job',status:'completed',progress:{completed:1,total:1},entries:[{id:'entry-1',text:'Fabricated new memory',scores,status:'analyzed',source:{block:0,start:0,end:21}}]}});
    }
  });
  await flow.goto(base);
  await expect(flow.locator('.memory-active p')).toHaveText('Previous fabricated memory');
  await flow.getByRole('button', { name: 'Replace', exact: true }).click();
  const dialog = flow.getByRole('dialog', {name:'Analyze memories'});
  await dialog.getByLabel('Paste text').fill('Fabricated new memory');
  await dialog.getByLabel('Analysis access code (if required)').fill('test-code');
  assert.equal(posts, 0, 'pasting does not send');
  await expect(dialog.getByRole('button', {name:'Analyze memories'})).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', {name:'Analyze memories'}).click();
  await expect(dialog.getByText('Review 1 memory')).toBeVisible();
  await expect(flow.locator('.memory-active p')).toHaveText('Previous fabricated memory');
  await expect(flow.locator('.print-actions .primary-button')).toBeDisabled();
  await dialog.getByRole('button', {name:'Use these memories'}).click();
  await expect(flow.locator('.memory-active p')).toHaveText('Fabricated new memory');
  await expect(flow.locator('.memory-emotion-tags')).toContainText('Calm5');
  assert.equal(posts, 1); assert.ok(polls >= 1); await expect.poll(() => deletes).toBe(1);
  await flow.close();
  console.log('Emotion tags and mocked analysis workflow passed.');
} finally { await browser.close(); }
