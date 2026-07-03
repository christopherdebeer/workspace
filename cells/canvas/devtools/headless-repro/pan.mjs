/**
 * Pan profiler: drives navigate-mode one-finger pans over the REAL parcland
 * board and reports what each pointermove costs (layouts, style recalcs,
 * script time, heap, nodes) via CDP Performance metrics.
 */
import { chromium } from 'playwright-core';

const EXE = process.env.CHROME || undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
  });
}

const pick = (m, names) => Object.fromEntries(m.metrics.filter((x) => names.includes(x.name)).map((x) => [x.name, x.value]));
const METRICS = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration', 'JSHeapUsedSize', 'Nodes'];

async function main() {
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), headless: true, args: ['--enable-precise-memory-info'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://127.0.0.1:8787/parcland');
  await page.waitForFunction(() => window.CC && window.CC.canvasState.elements.length > 100, null, { timeout: 15000 });

  // Edges aren't in the hydrate payload — inject the real 346 from the scene.
  await page.evaluate(async () => {
    const scene = await (await fetch('/parcland-scene.json')).json();
    const cc = window.CC;
    cc.canvasState.edges = scene.edges.map((e, i) => ({
      id: `lnk:el:${e.source}|${e.rel}|el:${e.target}`,
      source: e.source, target: e.target, rel: e.rel, label: e.rel,
    }));
    cc.requestEdgeUpdate();
  });
  await sleep(400);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  const svgNodes = await page.evaluate(() => document.querySelectorAll('#edges-layer *').length);
  const domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);
  console.log('board ready:', JSON.stringify({
    els: await page.evaluate(() => window.CC.canvasState.elements.length),
    edges: await page.evaluate(() => window.CC.canvasState.edges.length),
    svgNodes, domNodes,
  }));

  // ── sustained one-finger panning: STROKES strokes × MOVES moves of STEP px ──
  const STROKES = 12, MOVES = 30, STEP = 14;
  const before = pick(await cdp.send('Performance.getMetrics'), METRICS);
  const t0 = Date.now();
  for (let s = 0; s < STROKES; s++) {
    const dir = s % 4; // pan around: left, up, right, down
    const [dx, dy] = [[-STEP, 0], [0, -STEP], [STEP, 0], [0, STEP]][dir];
    let x = 195, y = 420;
    await touch(cdp, 'touchStart', [{ x, y, id: 1 }]);
    for (let i = 0; i < MOVES; i++) {
      x += dx; y += dy;
      await touch(cdp, 'touchMove', [{ x, y, id: 1 }]);
    }
    await touch(cdp, 'touchEnd', []);
  }
  const wallMs = Date.now() - t0;
  await sleep(300);
  const after = pick(await cdp.send('Performance.getMetrics'), METRICS);

  const moves = STROKES * MOVES;
  const d = {};
  for (const k of METRICS) d[k] = after[k] - before[k];
  console.log(`\n== pan cost over ${moves} pointermoves (${wallMs}ms wall) ==`);
  console.log(JSON.stringify({
    layoutsPerMove: +(d.LayoutCount / moves).toFixed(2),
    recalcsPerMove: +(d.RecalcStyleCount / moves).toFixed(2),
    layoutMsTotal: Math.round(d.LayoutDuration * 1000),
    recalcMsTotal: Math.round(d.RecalcStyleDuration * 1000),
    scriptMsTotal: Math.round(d.ScriptDuration * 1000),
    taskMsTotal: Math.round(d.TaskDuration * 1000),
    heapGrowthMB: +(d.JSHeapUsedSize / 1048576).toFixed(1),
    nodeGrowth: d.Nodes,
  }, null, 1));

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
