// Boot the LIVE deployed canvas against parc.land in headless Chrome:
// no page errors, the app boots, and the new gesture gate engages on touch.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), headless: true, proxy: { server: process.env.HTTPS_PROXY } });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
const logs = [];
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[canvas]')) logs.push(t.slice(0, 120)); });
await page.goto('https://parc.land/@c15r/canvas/parcland', { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(6000);
const state = await page.evaluate(() => ({
  booted: document.body.classList.contains('booted'),
  cull: document.body.classList.contains('cull'),
  hasCC: !!window.CC,
  els: window.CC ? window.CC.canvasState.elements.length : null,
}));
// touch down anywhere → the new body.gesturing gate must engage, and clear on up
const cdp = await page.context().newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400, id: 1 }] });
const gestOn = await page.evaluate(() => document.body.classList.contains('gesturing'));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const gestOff = await page.evaluate(() => document.body.classList.contains('gesturing'));
console.log(JSON.stringify({ ...state, gesturingOnTouch: gestOn, clearedOnRelease: !gestOff, pageErrors: errors }, null, 1));
console.log('boot logs:', JSON.stringify(logs.slice(0, 6), null, 1));
await browser.close();
