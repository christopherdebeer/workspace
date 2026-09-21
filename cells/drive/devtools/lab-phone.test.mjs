// The world lab on a phone: the viewport is the world and a bar, not a panel
// over a menu. Opens on the chart with the raster's data showing; 3D is one
// tap; one finger paints, a second pans; the game's chrome is off while the
// lab is up and back when it folds.
import { openDrive, report } from './harness.mjs';
let bad = 0;
const ok = (n, c, saw) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : ' saw ' + JSON.stringify(saw)}`); if (!c) bad++; };
const d = await openDrive({ pagePath: '/lab/world-edit?fixture=tee&time=MORNING&cam=chase', tag: 'lab-phone', settle: 6000, bootTimeout: 60000,
  viewport: { width: 390, height: 844 }, dpr: 2 });
await d.page.waitForFunction(() => typeof window.__worldedit === 'function' && window.__worldedit().tiles > 0, null, { timeout: 45000 });
await d.page.waitForTimeout(2000);
const rect = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, shown: b.width > 0 && b.height > 0 }; };
const first = await d.page.evaluate((rectSrc) => {
  const rect = eval(rectSrc);
  const uiShown = [...document.querySelectorAll('.ui')].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0).length;
  return { report: window.__worldedit(), bar: rect('world-authoring'), sheet: getComputedStyle(document.querySelector('#world-authoring .sheet')).display,
    menuOpen: document.body.classList.contains('menu-open'), clean: document.body.classList.contains('clean'), uiShown, vh: innerHeight };
}, rect.toString());
console.log(JSON.stringify(first));
ok('the lab opens on the chart with the raster data view', first.report.chart === true && first.report.view === 'data', first.report);
ok('the game menu is closed and its chrome hidden', !first.menuOpen && first.clean && first.uiShown === 0, first);
ok('the bar is a strip along the bottom, under a sixth of the screen', first.bar && first.bar.shown && first.bar.h < first.vh / 6 && first.bar.y + first.bar.h >= first.vh - 2, first.bar);
ok('the sheet is closed', first.sheet === 'none', first.sheet);
await d.page.screenshot({ path: '/tmp/drive-tools/lab-phone-new-chart.png', timeout: 120000 });

const toggled = await d.page.evaluate(() => { document.getElementById('world-authoring-cam').click(); return window.__worldedit(); });
ok('3D is one tap and brings the game view back', toggled.chart === false && toggled.view === 'game', toggled);
await d.page.waitForTimeout(1500);
await d.page.screenshot({ path: '/tmp/drive-tools/lab-phone-new-seat.png', timeout: 120000 });
const back = await d.page.evaluate(() => { document.getElementById('world-authoring-cam').click(); return window.__worldedit(); });
ok('…and 2D again with the data', back.chart === true && back.view === 'data', back);

// One finger paints.
const painted = await d.page.evaluate(async () => {
  const before = window.__worldedit();
  document.getElementById('world-authoring-arm').click();
  // The brush chip cycles the class: off GRASS, which the fixture already is.
  document.getElementById('world-authoring-brush').click();
  const c = document.getElementById('scene');
  const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true, isPrimary: id === 1 }));
  ev('pointerdown', 1, 195, 400); ev('pointermove', 1, 200, 405); ev('pointermove', 1, 210, 410);
  const during = window.__worldedit();
  ev('pointerup', 1, 210, 410);
  await new Promise((r) => setTimeout(r, 300));
  return { before, during, after: window.__worldedit() };
});
ok('the PAINT chip arms the lab', painted.before.armed === false && painted.during.armed === true, painted.before);
ok('one finger paints', painted.during.editedCells > 0 || painted.after.editedCells > 0, painted.after);
await d.page.screenshot({ path: '/tmp/drive-tools/lab-phone-new-paint.png', timeout: 120000 });

// A second finger turns the gesture into a pan: the stroke is cancelled,
// nothing more paints, and the chart moves.
const panned = await d.page.evaluate(async () => {
  const c = document.getElementById('scene');
  const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true, isPrimary: id === 1 }));
  const focus0 = window.__worldedit().focusElevationM;
  const cells0 = window.__worldedit().editedCells;
  ev('pointerdown', 1, 150, 420);
  ev('pointerdown', 2, 250, 420);
  const two = window.__worldedit();
  for (let i = 1; i <= 8; i++) { ev('pointermove', 1, 150 + i * 6, 420 + i * 10); ev('pointermove', 2, 250 + i * 6, 420 + i * 10); }
  await new Promise((r) => setTimeout(r, 400));
  const moved = window.__worldedit();
  ev('pointerup', 1, 198, 500); ev('pointerup', 2, 298, 500);
  await new Promise((r) => setTimeout(r, 200));
  return { cells0, two, moved, after: window.__worldedit(), focus0 };
});
ok('a second finger hands the gesture to the chart', panned.two.panning === true && panned.after.panning === false, { two: panned.two.panning, after: panned.after.panning });
ok('…and the stroke it interrupted does not go on painting', panned.moved.editedCells === panned.two.editedCells, { two: panned.two.editedCells, moved: panned.moved.editedCells });
ok('…while the lab stays armed', panned.after.armed === true, panned.after.armed);

// Fold: the game's chrome comes back; unfold: it goes again.
const folded = await d.page.evaluate(() => {
  document.getElementById('world-authoring-more').click();
  document.getElementById('world-authoring-fold').click();
  const clean = document.body.classList.contains('clean');
  const armed = window.__worldedit().armed;
  document.getElementById('world-authoring-unfold').click();
  return { clean, armed, cleanAgain: document.body.classList.contains('clean') };
});
ok('FOLD gives the game its chrome and its input back', folded.clean === false && folded.armed === false && folded.cleanAgain === true, folded);
report(d.errors);
await d.close();
console.log(bad ? `${bad} FAILED` : 'lab-phone: all ok');
process.exit(bad ? 1 : 0);
