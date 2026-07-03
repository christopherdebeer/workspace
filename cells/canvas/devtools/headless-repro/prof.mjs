import { chromium } from 'playwright-core';
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await page.goto('http://127.0.0.1:8787/parcland');
await page.waitForFunction(() => window.CC && window.CC.canvasState.elements.length > 100, null, { timeout: 15000 });
await new Promise(r => setTimeout(r, 500));
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await new Promise(r => setTimeout(r, 5000));
const { profile } = await cdp.send('Profiler.stop');
// aggregate self time per function
const byFn = new Map();
const total = profile.samples?.length ?? 0;
const nodeById = new Map(profile.nodes.map((n) => [n.id, n]));
for (const s of profile.samples ?? []) {
  const n = nodeById.get(s);
  const f = n.callFrame;
  const key = `${f.functionName || '(anon)'} @ ${(f.url || '').split('/').pop()}:${f.lineNumber}`;
  byFn.set(key, (byFn.get(key) ?? 0) + 1);
}
const top = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [k, v] of top) console.log(`${((v / total) * 100).toFixed(1)}%  ${k}`);
await browser.close();
