// Behavioral verification of the DEPLOYED canvas bundle (live-app.js fetched
// from parc.land post-deploy, kernel import stubbed): boots the real parcland
// scene, gesture gate engages, pinch clamps hold, in-stroke cost is sane.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
await page.goto('http://127.0.0.1:8787/parcland?live=1');
await page.waitForFunction(() => window.CC && window.CC.canvasState.elements.length > 100, null, { timeout: 15000 });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });
const pick = (m) => Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));

// 1. gesture gate
await touch('touchStart', [{ x: 200, y: 400, id: 1 }]);
const gestOn = await page.evaluate(() => document.body.classList.contains('gesturing'));
await touch('touchEnd', []);
const gestOff = await page.evaluate(() => !document.body.classList.contains('gesturing'));

// 2. in-stroke pan cost on the deployed bundle
let x = 340, y = 420;
await touch('touchStart', [{ x, y, id: 1 }]);
await touch('touchMove', [{ x: x -= 8, y, id: 1 }]);
const a = pick(await cdp.send('Performance.getMetrics'));
const t0 = Date.now();
while (Date.now() - t0 < 6000) {
  x -= 6; if (x < 40) { x = 340; y = y > 500 ? 420 : y + 30; }
  await touch('touchMove', [{ x, y, id: 1 }]);
}
const b = pick(await cdp.send('Performance.getMetrics'));
await touch('touchEnd', []);
const secs = (Date.now() - t0) / 1000;

// 3. pinch clamp: coincident-start group pinch on a selected element
const c = await page.evaluate(() => {
  const cc = window.CC; cc.switchMode('direct');
  const el = cc.canvasState.elements.find((e) => cc.elementNodesMap[e.id]?.isConnected);
  cc.selectElement(el.id);
  cc.recenterOnElement(el.id);
  return el.id;
});
await new Promise((r) => setTimeout(r, 300));
const c2 = await page.evaluate((id) => {
  const r = window.CC.elementNodesMap[id].getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(Math.min(Math.max(r.top + r.height / 2, 50), 800)) };
}, c);
await touch('touchStart', [{ x: c2.x, y: c2.y, id: 1 }]);
await touch('touchMove', [{ x: c2.x + 12, y: c2.y, id: 1 }]);
await touch('touchStart', [{ x: c2.x + 12, y: c2.y, id: 1 }, { x: c2.x + 12.5, y: c2.y, id: 2 }]);
for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: c2.x + 12 - i * 20, y: c2.y, id: 1 }, { x: c2.x + 12.5 + i * 20, y: c2.y, id: 2 }]);
await touch('touchEnd', []);
await new Promise((r) => setTimeout(r, 200));
const scaleAfter = await page.evaluate((id) => window.CC.findElementById(id).scale ?? 1, c);

console.log(JSON.stringify({
  bootedElements: await page.evaluate(() => window.CC.canvasState.elements.length),
  gesturingOnTouch: gestOn, clearedOnRelease: gestOff,
  strokeTaskMsPerSec: Math.round((b.TaskDuration - a.TaskDuration) * 1000 / secs),
  strokeRecalcMs: Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000),
  pinchedScale: scaleAfter, scaleClampHolds: scaleAfter <= 20,
  pageErrors: errors.slice(0, 3),
}, null, 1));
await browser.close();
