/**
 * Drive the real canvas client in headless Chromium with CDP touch events,
 * reproducing the mobile-Safari gesture paths and recording what explodes.
 */
import { chromium } from 'playwright-core';

const EXE = process.env.CHROME || undefined; // undefined → playwright-managed chromium
const URL = 'http://127.0.0.1:8787/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type, // touchStart | touchMove | touchEnd
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
  });
}

async function vitals(page) {
  return page.evaluate(() => {
    const cc = window.CC;
    const els = cc.canvasState.elements.map((e) => ({
      id: e.id, scale: e.scale, x: Math.round(e.x), y: Math.round(e.y),
      w: e.width, h: e.height,
    }));
    const nodes = Object.fromEntries(
      Object.entries(cc.elementNodesMap).map(([id, n]) => {
        const r = n.getBoundingClientRect();
        return [id, { cssWidthVar: n.style.getPropertyValue('--width'), rectW: Math.round(r.width), rectH: Math.round(r.height) }];
      }),
    );
    const mem = performance.memory
      ? { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576) }
      : {};
    return { view: { ...cc.viewState }, els, nodes, mem, undoDepth: cc._undo.length };
  });
}

async function main() {
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), headless: true, args: ['--enable-precise-memory-info'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.CC && window.CC.canvasState.elements.length >= 3, null, { timeout: 10000 });
  const cdp = await page.context().newCDPSession(page);

  console.log('== baseline ==');
  console.log(JSON.stringify(await vitals(page), null, 1));

  // -- Scenario A: canvas pinch (should stay clamped 0.1..10) ------------------
  await touch(cdp, 'touchStart', [{ x: 150, y: 400, id: 1 }, { x: 240, y: 400, id: 2 }]);
  for (let i = 1; i <= 10; i++) {
    await touch(cdp, 'touchMove', [{ x: 150 - i * 5, y: 400, id: 1 }, { x: 240 + i * 5, y: 400, id: 2 }]);
  }
  await touch(cdp, 'touchEnd', []);
  await sleep(150);
  console.log('== after canvas pinch (expect view.scale <= 10) ==');
  console.log(JSON.stringify((await vitals(page)).view));

  // reset camera
  await page.evaluate(() => { const cc = window.CC; cc.viewState.scale = 1; cc.viewState.translateX = 0; cc.viewState.translateY = 0; cc.updateCanvasTransform(); });

  // -- Scenario B: group pinch with fingers starting CLOSE together ------------
  // direct mode + selection, one finger drags past the deadzone (moveGroup),
  // second finger lands 8px away (capGroupPinch: startDist=8), spread to ~300px.
  await page.evaluate(() => { const cc = window.CC; cc.switchMode('direct'); cc.selectElement('el1'); });
  await sleep(100);
  const el1 = await page.evaluate(() => {
    const r = window.CC.elementNodesMap.el1.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  // the element node's on-screen center (content-sized, not el.height)
  const sx = Math.round(el1.x), sy = Math.round(el1.y);

  for (let round = 1; round <= 3; round++) {
    await touch(cdp, 'touchStart', [{ x: sx, y: sy, id: 1 }]);
    await touch(cdp, 'touchMove', [{ x: sx + 12, y: sy, id: 1 }]);       // beyond 5px deadzone -> moveGroup
    await touch(cdp, 'touchMove', [{ x: sx + 14, y: sy, id: 1 }]);
    await touch(cdp, 'touchStart', [{ x: sx + 14, y: sy, id: 1 }, { x: sx + 22, y: sy, id: 2 }]); // second finger 8px away -> pinchGroup
    for (let i = 1; i <= 12; i++) { // spread to ~300px
      await touch(cdp, 'touchMove', [{ x: sx + 14 - i * 12, y: sy, id: 1 }, { x: sx + 22 + i * 12, y: sy, id: 2 }]);
    }
    await touch(cdp, 'touchEnd', []);
    await sleep(120);
    const v = await vitals(page);
    console.log(`== after group pinch round ${round} ==`);
    console.log(JSON.stringify({ el1: v.els.find((e) => e.id === 'el1'), node: v.nodes.el1, mem: v.mem, undoDepth: v.undoDepth }));
  }

  // -- Scenario C: second finger lands EXACTLY on the first (startDist = 0) ----
  const c2 = await page.evaluate(() => {
    const cc = window.CC; const e = cc.findElementById('el1');
    e.scale = 1; e.x = 195; e.y = 300; cc.renderElementsImmediately();
    cc.selectElement('el1');
    const r = cc.elementNodesMap.el1.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await sleep(100);
  await touch(cdp, 'touchStart', [{ x: c2.x, y: c2.y, id: 1 }]);
  await touch(cdp, 'touchMove', [{ x: c2.x + 12, y: c2.y, id: 1 }]);
  await touch(cdp, 'touchStart', [{ x: c2.x + 12, y: c2.y, id: 1 }, { x: c2.x + 12.5, y: c2.y, id: 2 }]); // ~coincident
  for (let i = 1; i <= 6; i++) {
    await touch(cdp, 'touchMove', [{ x: c2.x + 12 - i * 20, y: c2.y, id: 1 }, { x: c2.x + 12.5 + i * 20, y: c2.y, id: 2 }]);
  }
  await touch(cdp, 'touchEnd', []);
  await sleep(120);
  const v = await vitals(page);
  console.log('== after near-coincident-start pinch (startDist ~0.5px) ==');
  console.log(JSON.stringify({ el1: v.els.find((e) => e.id === 'el1'), node: v.nodes.el1, mem: v.mem }));

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
