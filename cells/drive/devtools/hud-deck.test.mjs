// THE DECK: SIX HUD LAYOUTS, ONE AT A TIME, AND THE DOCK IS THE CAMERA.
//
//   node cells/drive/devtools/hud-deck.test.mjs
//
// The deck (client/hud-deck.ts) was a launcher first — tabs that moved the
// camera, opened settings sheets and a door into the menu — and the seat's
// review replaced it with rules this test holds:
//
//   - four tabs are LAYOUTS (VIEW, MAP, RIG, CAM), one up at a time or none;
//     two are MODES (DRONE, AUTO) that run beside any layout, a tap to start
//     and a tap to end;
//   - a tab is an icon, its state and one signal — no words on it;
//   - the dock is the chart↔seat switch, bare; the seat is CAM's;
//   - controls are exclusive, effects persist; VIEW's inspection stands down
//     on leave, so the chart never wears the tile grid; SYS became VIEW's
//     readout layers;
//   - the chip at the top right always says MENU.
//
// The tile-debug DIAL is left ON throughout, on purpose: the whole point is
// that the dial saying "on" no longer means the chart wears it.
import { openDrive } from './harness.mjs';

let failures = 0;
const check = (ok, msg, extra) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { page, close, errors } = await openDrive({
  spot: 'fixture=at-campsbay&cam=chase&time=NOON&wx=clear', tag: 'deck', settle: 0, bootTimeout: 120000,
});
const deck = () => page.evaluate(() => window.__deck());
// The deck is described by the frame loop (stepOverlays → stepDeck), so a frame
// has to pass for a tap's result to reach the DOM.
const tab = async (t) => { await page.evaluate((x) => document.querySelector(`[data-deck-tab="${x}"]`).click(), t); await sleep(1500); return deck(); };
/** Click the element under the CENTRE of a deck control — so a control
 *  something else covers is reported as unreachable, not clicked through. */
const thumb = (id) => page.evaluate((i) => {
  const r = window.__deckrect(i);
  if (!r) return { hit: false, why: 'not on the glass' };
  const el = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);
  const own = el?.closest('[data-deck-item],[data-deck-tab]');
  const hit = !!own && (own.dataset.deckItem === i || own.dataset.deckTab === i);
  if (hit) own.click();
  return { hit, at: el?.tagName };
}, id);
/** A real pointer on a canvas control, in client px. */
const tapAt = async (x, y) => {
  await page.mouse.click(x, y);
  await sleep(1500);
};

for (let i = 0; i < 60; i++) { if (await page.evaluate(() => !!window.__deck)) break; await sleep(500); }
await page.evaluate(() => { window.__dial('tdbg', 1); window.__dial('auto', 1); document.querySelector('.m-x, .m-close')?.click(); });
await sleep(2000);

// ── the strait ──
const geo = await page.evaluate(() => {
  const row = document.getElementById('deck-row').getBoundingClientRect();
  const s = window.__hudscale();
  const rects = window.__hudrects();
  return { row: { x: row.x, y: row.y, w: row.width, h: row.height }, s,
    dock: rects.dock, box: rects.deck, seat: rects.seat,
    tabs: [...document.querySelectorAll('[data-deck-tab]')].map((b) => b.dataset.deckTab),
    words: [...document.querySelectorAll('[data-deck-tab]')].map((b) => b.textContent.trim()).join('') };
});
check(geo.tabs.join() === 'view,map,rig,cam,drone,auto', 'four layouts and two modes, AUTO where SYS was', geo.tabs);
check(geo.words === '', 'no words on the tabs — icon, state and signal only', geo.words);
check(Math.abs(geo.row.x - geo.box.x * geo.s) <= 1 && Math.abs(geo.row.w - geo.box.w * geo.s) <= 1,
  'the row is laid on the strait the HUD computes', { row: geo.row, box: geo.box, s: geo.s });
check(!geo.seat || geo.seat.w === 0, 'the dock is bare: no seat chip on it', geo.seat);
for (const t of geo.tabs) {
  const r = await page.evaluate((x) => { const b = window.__deckrect(x); const e = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2); return e?.closest('[data-deck-tab]')?.dataset.deckTab; }, t);
  check(r === t, `the ${t.toUpperCase()} tab is under a thumb placed on it`, r);
}
const menuChip = () => page.evaluate(() => document.getElementById('ov-menu').textContent);

// ── the baseline, and HOLD ──
let s = await deck();
check(s.active === null && s.cam === 'chase', 'boots on the baseline, nothing up, in the chase seat', s);
check(s.tileDbg === true && s.tileDbgOn === false, 'the tile-debug dial is ON and nothing draws it', s);
let t = await thumb('hold');
await sleep(1200);
check(t.hit && (await page.evaluate(() => window.__rewind?.().held)) === true, 'HOLD, on the baseline strip, stops the world', t);
check(await page.evaluate(() => !!window.__deckrect('rewind')), 'and a held world offers the rewind slider');
await thumb('hold');
await sleep(1200);

// ── AUTO is a mode, and a layout rides beside it ──
s = await tab('auto');
check(s.auto === true && s.modes.includes('auto') && s.active === null, 'AUTO starts the autopilot and raises no layout', s);
s = await tab('map');
check(s.active === 'map' && s.auto === true, 'MAP comes up with the autopilot still driving', s);
check((await menuChip()) === 'MENU', 'and the chip still says MENU');
s = await tab('auto');
check(s.auto === false && s.active === 'map', 'AUTO again hands the wheel back and leaves MAP up', s);

// ── MAP: dense toggles and radios ──
t = await thumb('wp:peaks');
s = await deck();
check(t.hit && s.wp.peaks === false && s.sup.map?.dot === 'gold', 'PEAKS off, and MAP wears the effect dot', s.wp);
t = await thumb('wpall:none');
s = await deck();
check(t.hit && !s.wp.pinned && !s.wp.peaks && !s.wp.scenery, 'NONE turns every waypoint layer off', s.wp);
t = await thumb('wpall:all');
s = await deck();
check(t.hit && s.wp.pinned && s.wp.peaks && s.wp.scenery, 'ALL turns them back on', s.wp);
t = await thumb('layer:cover');
const cover = await page.evaluate(() => window.__chartlayers().layers.find((l) => l.id === 'cover').on);
check(t.hit && cover === true, 'a LAYERS toggle switches the cover layer on', cover);
await thumb('layer:cover');
const chips = await page.evaluate(() => window.__chartlayers().rects.length);
check(chips === 0, 'the layer switches live in the tray, not on the glass', chips);

// ── the dock is the camera ──
const dock = await page.evaluate(() => { const r = window.__hudrects().dock, s = window.__hudscale(); return { x: (r.x + r.w / 2) * s, y: (r.y + r.h / 2) * s }; });
await tapAt(dock.x, dock.y);
s = await deck();
check(s.cam === 'top' && s.active === 'map', 'a tap on the dock goes to the chart, and MAP stays up', s);
check(s.tileDbgOn === false, 'THE CHART DOES NOT WEAR THE TILE GRID, with the dial on', s);
await tapAt(dock.x, dock.y);
s = await deck();
check(s.cam === 'chase', '…and back to the seat it previewed', s);

// ── CAM: the seat and the lens ──
s = await tab('cam');
check(s.rails.left === null && s.rails.right === 'band', 'CAM in the seat: the BAND rail and no chart tilt', s.rails);
t = await thumb('seat:cab');
s = await deck();
check(t.hit && s.cam === 'cab' && s.lastPov === 'cab', 'the CAB radio puts you in the cab', s);
t = await thumb('seat:chase');
s = await deck();
check(t.hit && s.cam === 'chase', 'the CHASE radio puts you back', s);
await page.evaluate(() => window.__setcam('top'));
await sleep(1200);
s = await deck();
check(s.rails.left === 'tilt' && s.rails.right === 'band', 'CAM on the chart: TILT and BAND', s.rails);
const band = await page.evaluate(() => { const r = window.__chartlens().rects.band, s = window.__hudscale(); return { x: (r.x + r.w / 2) * s, top: (r.y + 24) * s }; });
await tapAt(band.x, band.top);
s = await tab('cam');
check(s.active === null && s.band > 1.5 && s.sup.cam?.dot === 'gold', 'CAM lowered, the band stays and its tab wears the dot', s);

// ── VIEW: inspection stands down; readouts stay ──
s = await tab('view');
check(s.active === 'view' && s.tileDbgOn === true, 'VIEW draws the tile grid', s);
t = await thumb('pass:2');
await sleep(1000);
check(t.hit && (await deck()).xray === 'WIRE', 'PASS → WIRE');
t = await thumb('ro:gpu');
await sleep(1200);
check(t.hit && /TRIS/.test(await page.evaluate(() => document.getElementById('deck-tag').textContent)), 'the GPU readout reads out under the chip');
await thumb('ro:fps');
await sleep(1200);
const fpsGone = await page.evaluate(() => window.__fpsTap().w === 0);
check(fpsGone, 'FPS is a readout layer: off, it leaves the glass');
await thumb('ro:fps');
s = await tab('view');
check(s.active === null && s.xray === 'OFF' && s.tileDbgOn === false, 'lowering VIEW stands the wireframe and the grid down', s);
check(/TRIS/.test(await page.evaluate(() => document.getElementById('deck-tag').textContent)), '…and the GPU readout stays on the glass');
check((await page.evaluate(() => window.__dial().xray)) === 'WIRE', 'the rack still remembers WIRE');
check((await menuChip()) === 'MENU', 'the chip says MENU');
await page.evaluate(() => window.__setcam('chase'));
await sleep(1200);

// ── DRONE: a mode — launch, fly, raise a layout, recall ──
s = await tab('drone');
check(s.drone.up === true && s.active === null && s.modes.includes('drone'), 'DRONE launches it and raises no layout', s);
for (let i = 0; i < 20 && (await deck()).cam !== 'drone'; i++) await sleep(500);
s = await deck();
check(s.cam === 'drone' && s.rails.left === 'alt' && s.rails.right === 'gimbal', 'flying from its view: ALT and PITCH on the edges', s);
check(!(await page.evaluate(() => document.getElementById('deck-sheet').offsetParent)), 'and no tray — the tab is its control');
const alt = await page.evaluate(() => { const s = window.__hudscale(); const r = window.__hudrects().rails.left; return { x: (r.x + r.w / 2) * s, y: (r.y + r.h - 8) * s }; });
await tapAt(alt.x, alt.y);
check((await deck()).drone.alt < 20, 'a tap near the foot of the ALT rail brings the commanded height down');
s = await tab('cam');
check(s.active === 'cam' && s.drone.up && s.rails.right === 'band' && s.rails.left === null, 'CAM raised while flying takes the edges for the lens', s);
t = await thumb('seat:cab');
s = await deck();
check(t.hit && s.cam === 'drone' && s.lastPov === 'cab', 'NOSE picks the drone\'s nose camera and keeps its view', s);
s = await tab('cam');
check(s.rails.left === 'alt', 'CAM lowered, the drone has its rails back', s.rails);
await tapAt(dock.x, dock.y);
check((await deck()).cam === 'top', 'the dock takes a flying view to the chart');
await tapAt(dock.x, dock.y);
check((await deck()).cam === 'drone', '…and back to the drone');
s = await tab('drone');
check(s.drone.up === true && s.sup.drone?.dot === 'gold', 'DRONE again recalls it, and its tab says so', s);

const pageErrs = await page.evaluate(() => window.__pageErrors ?? []);
check(pageErrs.length === 0 && errors.length === 0, 'no page errors', { pageErrs: pageErrs.slice(0, 2), errors: errors.slice(0, 2) });
await close();
console.log(failures ? `\n${failures} FAILURES` : '\nhud-deck: all ok');
process.exit(failures ? 1 : 0);
