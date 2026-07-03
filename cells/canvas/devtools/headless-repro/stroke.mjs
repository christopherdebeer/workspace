// Measure cost INSIDE one continuous pan stroke (finger held down throughout),
// and count how often element-script loops actually ran during it.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await page.goto('http://127.0.0.1:8787/parcland');
await page.waitForFunction(() => window.CC && window.CC.canvasState.elements.length > 100, null, { timeout: 15000 });
await page.evaluate(async () => {
  const scene = await (await fetch('/parcland-scene.json')).json();
  window.CC.canvasState.edges = scene.edges.map((e) => ({ id: `lnk:el:${e.source}|${e.rel}|el:${e.target}`, source: e.source, target: e.target, rel: e.rel, label: e.rel }));
  window.CC.requestEdgeUpdate();
});
await new Promise(r => setTimeout(r, 500));
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const pick = (m) => Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });

let x = 340, y = 420;
await touch('touchStart', [{ x, y, id: 1 }]);
await touch('touchMove', [{ x: x -= 8, y, id: 1 }]); // past deadzone -> panCanvas
const a = pick(await cdp.send('Performance.getMetrics'));
const t0 = Date.now();
let moves = 0;
while (Date.now() - t0 < 8000) { // 8s continuous stroke, snaking around
  x -= 6; if (x < 40) { x = 340; y = y > 500 ? 420 : y + 30; }
  await touch('touchMove', [{ x, y, id: 1 }]);
  moves++;
}
const b = pick(await cdp.send('Performance.getMetrics'));
const gest = await page.evaluate(() => document.body.classList.contains('gesturing'));
await touch('touchEnd', []);
const secs = (Date.now() - t0) / 1000;
console.log(JSON.stringify({
  moves, secs: +secs.toFixed(1), gesturingDuringStroke: gest,
  layoutsPerSec: +((b.LayoutCount - a.LayoutCount) / secs).toFixed(1),
  recalcsPerSec: +((b.RecalcStyleCount - a.RecalcStyleCount) / secs).toFixed(1),
  layoutMs: Math.round((b.LayoutDuration - a.LayoutDuration) * 1000),
  recalcMs: Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000),
  scriptMs: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000),
  taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000),
  heapMB: +((b.JSHeapUsedSize - a.JSHeapUsedSize) / 1048576).toFixed(1),
}));
await browser.close();
