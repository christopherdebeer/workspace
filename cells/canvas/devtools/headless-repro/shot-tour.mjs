/** The full UI tour: every reachable surface/state, one screenshot each.
 *  Run after `npm run build` + `npm run serve`; OUT=dir CHROME=path node shot-tour.mjs */
import { chromium } from 'playwright-core';

const EXE = process.env.CHROME || undefined;
const URL = 'http://127.0.0.1:8787/';
const OUT = process.env.OUT || '/tmp/tour';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.CC && window.CC.canvasState.elements.length >= 3, null, { timeout: 10000 });
  const shot = async (name) => { await sleep(220); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('•', name); };

  // Seed content: edge, html card, img, fact card, nested canvas, error badge later.
  await page.evaluate(() => {
    const cc = window.CC;
    cc.canvasState.edges.push({ id: 'edge-1', source: 'el1', target: 'el2', rel: 'supports', label: 'supports' });
    cc.canvasState.elements.push(
      { id: 'nest1', x: 195, y: 640, width: 300, height: 180, rotation: 0, type: 'canvas-container', content: 'plans', refCanvasId: 'demo-plans' },
      { id: 'fact1', x: 195, y: 120, width: 270, height: 92, rotation: 0, type: 'fact', _factCard: true, _factTitle: 'Tending — daily substrate hygiene', _factIcon: '🔄', _factMeta: 'machine · machine/tending', content: '' },
    );
    cc.requestRender(); cc.requestEdgeUpdate();
  });

  // 01 · navigate idle (viewing mode pill, quiet board)
  await page.evaluate(() => window.CC.switchMode('navigate'));
  await shot('01-navigate-idle');

  // 02 · direct mode, single selection: handles + peek sheet
  await page.evaluate(() => { window.CC.switchMode('direct'); window.CC.selectElement('el1'); });
  await shot('02-selected-peek');

  // 03 · half detent (full action list), Appearance opened
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('parc:element-actions', { detail: { id: 'el1' } }));
  });
  await sleep(150);
  await page.evaluate(() => { document.querySelector('#cmd-palette .cm-appearance')?.setAttribute('open', ''); });
  await shot('03-actions-appearance');

  // 04 · the editor (full detent)
  await page.evaluate(() => { const cc = window.CC; void cc.openEditModal(cc.findElementById('el1')); });
  await shot('04-editor-full');
  await page.evaluate(() => { document.querySelector('#modal-cancel')?.click(); });
  await sleep(150);

  // 05 · edge inspector (endpoints + fields)
  await page.evaluate(() => {
    window.CC.clearSelection();
    window.dispatchEvent(new CustomEvent('parc:edge-tap', { detail: { id: 'edge-1' } }));
  });
  await shot('05-edge-inspector');

  // 06 · multi-select: group box + group actions
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('parc:canvas-deselect'));
    const cc = window.CC;
    cc.selectElement('el1'); cc.selectElement('el2', true);
  });
  await shot('06-group-selected');

  // 07 · lasso visual
  await page.evaluate(() => { const cc = window.CC; cc.clearSelection(); cc.updateSelectionBox(70, 190, 300, 500); });
  await shot('07-lasso');
  await page.evaluate(() => window.CC.removeSelectionBox());

  // 08 · palette: query → sections (commands + board)
  await page.evaluate(() => {
    const inp = document.querySelector('#cmd-palette input');
    inp.focus(); inp.value = 'one';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await shot('08-palette-query');

  // 09 · palette: awaiting input (needsInput command)
  await page.evaluate(() => {
    const inp = document.querySelector('#cmd-palette input');
    inp.value = 'add markdown';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(120);
  await page.evaluate(() => { document.querySelector('#cmd-palette .suggestion')?.click(); });
  await shot('09-palette-awaiting');
  await page.evaluate(() => {
    const inp = document.querySelector('#cmd-palette input');
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  // 10 · toast above the sheet
  await page.evaluate(() => {
    const t = document.createElement('div');
    t.id = 'undo-toast';
    const sheetH = document.getElementById('cmd-palette')?.getBoundingClientRect().height ?? 84;
    t.style.bottom = `calc(${Math.round(sheetH) + 12}px + env(safe-area-inset-bottom))`;
    const m = document.createElement('span'); m.textContent = 'Deleted 2 items';
    const u = document.createElement('button'); u.textContent = 'Undo';
    t.append(m, u);
    document.body.appendChild(t);
  });
  await shot('10-toast');
  await page.evaluate(() => document.getElementById('undo-toast')?.remove());

  // 11 · error badge + salience badge + synthesized outline
  await page.evaluate(() => {
    const cc = window.CC;
    cc._showElementError(cc.elementNodesMap['el2'], 'renderer mermaid: import failed');
    const n1 = cc.elementNodesMap['el1'];
    n1.dataset.salience = 'high';
    cc.elementNodesMap['el3']?.classList.add('synthesized');
  });
  await shot('11-badges');

  // 12 · nested canvas + fact card in frame (scroll camera down)
  await page.evaluate(() => {
    const cc = window.CC;
    cc.viewState.translateX = 0; cc.viewState.translateY = -320; cc.viewState.scale = 1;
    cc.updateCanvasTransform();
  });
  await shot('12-tiles');

  // 13 · drill-up pill visible
  await page.evaluate(() => { document.getElementById('drillUp').style.display = 'block'; });
  await shot('13-drillup');

  await browser.close();
  console.log('tour written to', OUT);
};

main().catch((e) => { console.error(e); process.exit(1); });
