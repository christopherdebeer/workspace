import { chromium } from 'playwright-core';
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await page.goto('http://127.0.0.1:8787/');
await page.waitForFunction(() => window.CC && window.CC.canvasState.elements.length >= 4, null, { timeout: 10000 });
console.log(await page.evaluate(() => {
  const e = window.CC.findElementById('poisoned');
  const n = window.CC.elementNodesMap.poisoned;
  const r = n && n.getBoundingClientRect();
  return JSON.stringify({ scale: e.scale, width: e.width, paintW: r && Math.round(r.width) });
}));
await browser.close();
