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
const a = pick(await cdp.send('Performance.getMetrics'));
await new Promise(r => setTimeout(r, 10000)); // idle, no input at all
const b = pick(await cdp.send('Performance.getMetrics'));
console.log(JSON.stringify({
  idleSeconds: 10,
  layoutsPerSec: +((b.LayoutCount - a.LayoutCount) / 10).toFixed(1),
  recalcsPerSec: +((b.RecalcStyleCount - a.RecalcStyleCount) / 10).toFixed(1),
  layoutMs: Math.round((b.LayoutDuration - a.LayoutDuration) * 1000),
  recalcMs: Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000),
  scriptMs: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000),
  taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000),
}));
// Which elements carry animations?
console.log(await page.evaluate(() => {
  const hits = [];
  document.querySelectorAll('.canvas-element').forEach((n) => {
    const html = n.innerHTML;
    if (/animation|@keyframes|<animate|transition/i.test(html)) hits.push({ id: n.dataset.elId, len: html.length, sample: (html.match(/animation[^;"]{0,60}/i) || [''])[0] });
  });
  return JSON.stringify(hits.slice(0, 10));
}));
await browser.close();
