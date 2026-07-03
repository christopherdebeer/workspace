/**
 * Verify the edge-bug fixes against the real bundled client:
 *   1. similarTo edges render faint (1px, no arrowhead, 10px hit band)
 *   2. tapping an edge opens an inspector that names BOTH endpoints
 *   3. a navigate-mode pan that STARTS on an edge hit line still pans
 *   4. pinch-zoom keeps the --zoom writes quantized + settles exact
 */
import { chromium } from 'playwright-core';

const EXE = process.env.CHROME || undefined;
const URL = 'http://127.0.0.1:8787/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
  });
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function main() {
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.CC && window.CC.canvasState.elements.length >= 3, null, { timeout: 10000 });
  const cdp = await page.context().newCDPSession(page);

  // Inject one inferred similarTo edge (el1→el2) and one authored edge (el2→el3).
  await page.evaluate(() => {
    const cc = window.CC;
    cc.canvasState.edges.push(
      { id: 'lnk:el:el1|similarTo|el:el2', source: 'el1', target: 'el2', rel: 'similarTo', label: 'similarTo' },
      { id: 'edge-authored', source: 'el2', target: 'el3', rel: 'supports', label: 'supports' },
    );
    cc.requestEdgeUpdate();
  });
  await sleep(200);

  // -- 1: faint constellation styling ---------------------------------------
  const styles = await page.evaluate(() => {
    const cc = window.CC;
    const sim = cc.edgeNodesMap['lnk:el:el1|similarTo|el:el2'];
    const simHit = cc.edgeHitNodesMap['lnk:el:el1|similarTo|el:el2'];
    const auth = cc.edgeNodesMap['edge-authored'];
    const authHit = cc.edgeHitNodesMap['edge-authored'];
    return {
      simWidth: sim?.getAttribute('stroke-width'),
      simMarker: sim?.getAttribute('marker-end'),
      simStroke: sim?.getAttribute('stroke'),
      simHitWidth: simHit?.getAttribute('stroke-width'),
      authWidth: auth?.getAttribute('stroke-width'),
      authMarker: auth?.getAttribute('marker-end'),
      authHitWidth: authHit?.getAttribute('stroke-width'),
    };
  });
  check('similarTo edge is 1px', styles.simWidth === '1', JSON.stringify(styles));
  check('similarTo edge has no arrowhead', !styles.simMarker);
  check('similarTo edge is translucent', /rgba/.test(styles.simStroke || ''));
  check('similarTo hit band narrowed to 10', styles.simHitWidth === '10');
  check('authored edge keeps 2px + arrowhead', styles.authWidth === '2' && !!styles.authMarker);
  check('authored hit band stays 16', styles.authHitWidth === '16');

  // -- 3: navigate-mode pan starting ON an edge ------------------------------
  // el1 (195,300) → el2 (195,520): the gap between their boxes is y 360..460,
  // so (195, 410) hits only the edge's hit line. Camera starts at identity.
  const before = await page.evaluate(() => ({ ...window.CC.viewState, mode: window.CC.mode }));
  await touch(cdp, 'touchStart', [{ x: 195, y: 410, id: 1 }]);
  for (let i = 1; i <= 12; i++) {
    await touch(cdp, 'touchMove', [{ x: 195 + i * 8, y: 410 + i * 6, id: 1 }]);
  }
  await touch(cdp, 'touchEnd', []);
  await sleep(150);
  const after = await page.evaluate(() => ({ ...window.CC.viewState }));
  check('mode is navigate', before.mode === 'navigate');
  check('drag from edge PANNED the canvas',
    Math.abs(after.translateX - before.translateX) > 50 && Math.abs(after.translateY - before.translateY) > 30,
    `t ${before.translateX},${before.translateY} → ${after.translateX},${after.translateY}`);

  // Reset camera for the tap test.
  await page.evaluate(() => {
    const cc = window.CC;
    cc.viewState.scale = 1; cc.viewState.translateX = 0; cc.viewState.translateY = 0;
    cc.updateCanvasTransform();
  });
  await sleep(120);

  // -- 2: edge tap opens inspector with endpoints -----------------------------
  await touch(cdp, 'touchStart', [{ x: 195, y: 410, id: 1 }]);
  await sleep(60);
  await touch(cdp, 'touchEnd', []);
  await sleep(250);
  const inspector = await page.evaluate(() => {
    const hosts = [document.querySelector('#cmd-palette .cmd-context'), document.getElementById('inspector-fallback')];
    for (const h of hosts) {
      if (h && h.style.display !== 'none' && h.textContent.trim()) return h.textContent;
    }
    return null;
  });
  check('edge tap opened the inspector', !!inspector);
  check('inspector names the SOURCE endpoint', !!inspector && inspector.includes('# One'), inspector?.slice(0, 120));
  check('inspector names the TARGET endpoint', !!inspector && inspector.includes('# Two'));
  check('inspector names the relation', !!inspector && inspector.includes('similarTo'));
  const selected = await page.evaluate(() => [...(window.CC.selectedEdgeIds ?? [])]);
  check('edge is selected', selected.length === 1 && selected[0].startsWith('lnk:'));

  // Close the inspector (its bottom sheet overlays the lower canvas): blank tap.
  await touch(cdp, 'touchStart', [{ x: 350, y: 100, id: 1 }]);
  await sleep(40);
  await touch(cdp, 'touchEnd', []);
  await sleep(150);

  // -- 4: pinch zoom — camera sane, --zoom settles to the exact scale ---------
  await touch(cdp, 'touchStart', [{ x: 140, y: 410, id: 1 }, { x: 250, y: 410, id: 2 }]);
  for (let i = 1; i <= 20; i++) {
    await touch(cdp, 'touchMove', [{ x: 140 - i * 3, y: 410, id: 1 }, { x: 250 + i * 3, y: 410, id: 2 }]);
  }
  await touch(cdp, 'touchEnd', []);
  await sleep(400); // > the 120ms trailing --zoom settle
  const zoom = await page.evaluate(() => ({
    scale: window.CC.viewState.scale,
    zoomVar: document.getElementById('canvas-container').style.getPropertyValue('--zoom'),
  }));
  check('pinch zoom moved the scale', zoom.scale > 1.2 && zoom.scale <= 10, `scale=${zoom.scale}`);
  check('--zoom settled to the exact scale', parseFloat(zoom.zoomVar) === zoom.scale, `var=${zoom.zoomVar}`);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
