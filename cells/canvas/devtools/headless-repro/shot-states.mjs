/** Screenshot the shell in its busy states, for the polish pass. */
import { chromium } from 'playwright-core';

const EXE = process.env.CHROME || undefined;
const URL = 'http://127.0.0.1:8787/';
const OUT = process.env.OUT || '/tmp/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.goto(URL);
  await page.waitForFunction(() => window.CC && window.CC.canvasState.elements.length >= 3, null, { timeout: 10000 });

  // Seed an edge + a nested canvas + select an element so everything stacks.
  await page.evaluate(() => {
    const cc = window.CC;
    cc.canvasState.edges.push({ id: 'edge-1', source: 'el1', target: 'el2', rel: 'supports', label: 'supports' });
    cc.canvasState.elements.push({ id: 'nest1', x: 620, y: 300, width: 300, height: 210, rotation: 0, type: 'canvas-container', content: 'plans', refCanvasId: 'demo-plans' });
    cc.requestRender(); cc.requestEdgeUpdate();
  });
  await sleep(250);
  await page.screenshot({ path: `${OUT}/1-idle.png` });

  // Selection (direct mode, handles + sheet at peek).
  await page.evaluate(() => { const cc = window.CC; cc.switchMode('direct'); cc.selectElement('el1'); });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/2-selected.png` });

  // Half detent (full actions).
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('parc:element-actions', { detail: { id: 'el1' } })); });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/3-actions.png` });

  // Edge inspector.
  await page.evaluate(() => {
    window.CC.clearSelection();
    window.dispatchEvent(new CustomEvent('parc:edge-tap', { detail: { id: 'edge-1' } }));
  });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/4-edge.png` });

  // Palette with a query (sections) + save dot + toast, all at once.
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('parc:canvas-deselect'));
    const inp = document.querySelector('#cmd-palette input');
    inp.focus(); inp.value = 'zoom';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new CustomEvent('parc:save-state', { detail: { state: 'saved' } }));
  });
  await sleep(250);
  await page.screenshot({ path: `${OUT}/5-palette.png` });

  // Everything at once: selection + toast + palette query.
  await page.evaluate(() => {
    const cc = window.CC;
    cc.selectElement('el2');
    const t = document.createElement('div'); // simulate the delete toast (styles from main.css)
    t.id = 'undo-toast';
    const sheetH = document.getElementById('cmd-palette')?.getBoundingClientRect().height ?? 84;
    t.style.bottom = `calc(${Math.round(sheetH) + 12}px + env(safe-area-inset-bottom))`;
    const m = document.createElement('span'); m.textContent = 'Deleted 1 item';
    const u = document.createElement('button'); u.textContent = 'Undo';
    t.append(m, u);
    document.body.appendChild(t);
  });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/6-everything.png` });

  await browser.close();
  console.log('shots written to', OUT);
};

main().catch((e) => { console.error(e); process.exit(1); });
