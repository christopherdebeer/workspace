import { chromium } from 'playwright-core';
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await page.addInitScript(() => {
  const counts = {};
  const real = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    const name = cb.name || (cb.toString().slice(0, 60).replace(/\s+/g, ' '));
    counts[name] = (counts[name] ?? 0) + 1;
    return real(cb);
  };
  window.__rafCensus = () => counts;
});
await page.goto('http://127.0.0.1:8787/parcland');
await page.waitForFunction(() => window.CC && window.CC.canvasState.elements.length > 100, null, { timeout: 15000 });
await page.evaluate(() => { window.__rafBase = JSON.parse(JSON.stringify(window.__rafCensus())); });
await new Promise(r => setTimeout(r, 5000));
console.log(await page.evaluate(() => {
  const base = window.__rafBase, now = window.__rafCensus(), out = {};
  for (const k of Object.keys(now)) { const d = now[k] - (base[k] ?? 0); if (d > 10) out[k] = Math.round(d / 5) + '/s'; }
  return JSON.stringify(out, null, 1);
}));
// also: how many timers fire? count setInterval/setTimeout callbacks for 5s
await browser.close();
