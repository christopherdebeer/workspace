// THE DECK: SIX HUD LAYOUTS, ONE AT A TIME, AND THE DOCK IS THE CAMERA.
//
//   node cells/drive/devtools/hud-deck.test.mjs
//
// The deck (client/hud-deck.ts) was a launcher first — tabs that moved the
// camera, opened settings sheets and a door into the menu — and the seat's
// review replaced it with rules this test holds:
//
//   - a tab is a LAYOUT and one is up at a time, or none (the baseline, where
//     AUTO and HOLD live); tapping the lit tab lowers it;
//   - no tab moves the camera except DRONE, whose tap IS the launch; the dock
//     is the chart↔seat switch and its corner chip picks the seat;
//   - controls are exclusive, effects persist: a drone keeps flying with its
//     tab down, the band keeps its scale; VIEW's inspection is the exception
//     and stands down on leave, so the chart never wears the tile grid;
//   - the gauges stand only in RIG, and the edges carry a layout's rails.
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
    dock: rects.dock, box: rects.deck, W: innerWidth, H: innerHeight,
    tabs: [...document.querySelectorAll('[data-deck-tab]')].map((b) => b.dataset.deckTab) };
});
check(geo.tabs.join() === 'view,map,rig,drone,cam,sys', 'six layout tabs, DRONE where DRIVE was', geo.tabs);
check(Math.abs(geo.row.x - geo.box.x * geo.s) <= 1 && Math.abs(geo.row.w - geo.box.w * geo.s) <= 1,
  'the row is laid on the strait the HUD computes', { row: geo.row, box: geo.box, s: geo.s });
for (const t of geo.tabs) {
  const r = await page.evaluate((x) => { const b = window.__deckrect(x); const e = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2); return e?.closest('[data-deck-tab]')?.dataset.deckTab; }, t);
  check(r === t, `the ${t.toUpperCase()} tab is under a thumb placed on it`, r);
}

// ── the baseline ──
let s = await deck();
check(s.active === null && s.cam === 'chase', 'boots on the baseline, nothing up, in the chase seat', s);
check(s.tileDbg === true && s.tileDbgOn === false, 'the tile-debug dial is ON and nothing draws it', s);
check(s.rails.left === null && s.rails.right === null, 'the baseline has no rails on its edges', s.rails);
let t = await thumb('auto');
let a = await page.evaluate(() => window.__auto());
check(t.hit && a.on === true, 'AUTO, on the baseline strip where a thumb lands, engages', { t, on: a.on });
await sleep(800);
t = await thumb('auto');
a = await page.evaluate(() => window.__auto());
check(t.hit && a.on === false, '…and the same tap hands it back', { t, on: a.on });
t = await thumb('hold');
await sleep(1200);
const held = await page.evaluate(() => window.__rewind?.().held ?? null);
const back = await page.evaluate(() => !!window.__deckrect('rewind'));
check(t.hit && held === true, 'HOLD stops the world', { t, held });
check(back, 'and a HELD world offers the rewind slider beside it');
await thumb('hold');
await sleep(1200);

// ── a layout lowers the strip, and a lit tab lowers itself ──
s = await tab('rig');
const baseGone = await page.evaluate(() => !window.__deckrect('auto'));
check(s.active === 'rig' && s.cam === 'chase', 'RIG comes up without moving the camera', s);
check(baseGone, 'the baseline strip steps aside while a layout is up');
const menuOpen = await page.evaluate(() => document.body.classList.contains('menu-open'));
check(!menuOpen, 'RIG is a layout, not a door into the menu', menuOpen);
s = await tab('rig');
check(s.active === null, 'tapping the lit tab lowers it, back to the baseline', s);

// ── MAP: its controls, and no camera change ──
s = await tab('map');
check(s.active === 'map' && s.cam === 'chase', 'MAP comes up in the seat — the dock, not the tab, is the chart', s);
t = await thumb('poi:1');
await sleep(800);
const poi = await page.evaluate(() => window.__dial().poi);
check(t.hit && poi === 'PINNED', 'a WAYPOINTS choice sets the dial', { t, poi });
const chips = await page.evaluate(() => window.__chartlayers().rects.map((r) => r.id));
check(chips.includes('cover') && !chips.includes('substrate'), 'the layer key\'s chips are MAP\'s, the debug views are not', chips);

// ── the dock is the camera, and a layout rides across it ──
const dock = await page.evaluate(() => { const r = window.__hudrects().dock, s = window.__hudscale(); return { x: (r.x + r.w / 2) * s, y: (r.y + r.h / 2) * s }; });
await tapAt(dock.x, dock.y);
s = await deck();
check(s.cam === 'top' && s.active === 'map', 'a tap on the dock goes to the chart, and MAP stays up', s);
check(s.tileDbgOn === false, 'THE CHART DOES NOT WEAR THE TILE GRID, with the dial on', s);
await tapAt(dock.x, dock.y);
s = await deck();
check(s.cam === 'chase', '…and the dock takes it back to the seat it previewed', s);
const seat = await page.evaluate(() => { const r = window.__hudrects().seat, s = window.__hudscale(); return r && r.w ? { x: (r.x + r.w / 2) * s, y: (r.y + r.h / 2) * s } : null; });
check(!!seat, 'the dock carries a seat chip');
if (seat) {
  await tapAt(seat.x, seat.y);
  s = await deck();
  check(s.cam === 'cab' && s.lastPov === 'cab', 'the seat chip puts you in the cab', s);
  await tapAt(seat.x, seat.y);
  s = await deck();
  check(s.cam === 'chase', '…and back to chase', s);
}

// ── VIEW: inspection, and only here ──
await page.evaluate(() => window.__setcam('top'));
await sleep(1200);
s = await tab('view');
check(s.active === 'view' && s.cam === 'top', 'VIEW keeps the camera it was given', s);
check(s.tileDbgOn === true, 'the tile grid draws in VIEW', s);
const chip = await page.evaluate(() => [document.getElementById('ov-menu').textContent, document.getElementById('deck-tag').style.display]);
check(chip[0] === 'VIEW' && chip[1] === 'block', 'the chip names the layout and the tagline is up', chip);
t = await thumb('pass:2');
await sleep(1000);
s = await deck();
check(t.hit && s.xray === 'WIRE', 'PASS → WIRE puts the renderer on its wireframe', { t, s });
s = await tab('view');
check(s.active === null && s.xray === 'OFF' && s.tileDbgOn === false, 'lowering VIEW stands the wireframe and the grid down', s);
check((await page.evaluate(() => window.__dial().xray)) === 'WIRE', 'and the rack still remembers WIRE for the next inspection');
check((await page.evaluate(() => document.getElementById('ov-menu').textContent)) === 'MENU', 'the chip reads MENU again');

// ── CAM: the lens rails, and the band persists ──
s = await tab('cam');
check(s.rails.left === 'tilt' && s.rails.right === 'band', 'CAM on the chart puts TILT and BAND on the edges', s.rails);
const band = await page.evaluate(() => { const r = window.__chartlens().rects.band, s = window.__hudscale(); return { x: (r.x + r.w / 2) * s, top: (r.y + 24) * s }; });
await tapAt(band.x, band.top);
s = await deck();
check(s.band > 1.5, 'a tap near the top of the BAND rail widens the band', s.band);
s = await tab('cam');
check(s.active === null && s.band > 1.5 && s.live.includes('cam'), 'CAM lowered, the band stays and its tab wears the dot', s);
check(s.rails.right === null, 'and the edge is clear again', s.rails);
await page.evaluate(() => window.__setcam('chase'));
await sleep(1200);
s = await tab('cam');
check(s.rails.left === null && s.rails.right === 'band', 'CAM in the seat has the band and no chart tilt', s.rails);
await tab('cam');

// ── SYS: a readout ──
s = await tab('sys');
const sys = await page.evaluate(() => document.getElementById('deck-tag').textContent);
check(s.active === 'sys' && /FPS/.test(sys) && /TRIS/.test(sys), 'SYS reads out the frame under the chip', sys);
await tab('sys');

// ── DRONE: the tab is the launch, and the flight outlives it ──
s = await tab('drone');
check(s.active === 'drone' && s.drone.up === true, 'DRONE launches it', s);
for (let i = 0; i < 20 && (await deck()).cam !== 'drone'; i++) await sleep(500);
s = await deck();
check(s.cam === 'drone' && s.rails.left === 'alt' && s.rails.right === 'gimbal', 'its view, with ALT and PITCH on the edges', s);
const alt = await page.evaluate(() => { const s = window.__hudscale(); const r = window.__hudrects().rails.left; return { x: (r.x + r.w / 2) * s, y: (r.y + r.h - 8) * s }; });
await tapAt(alt.x, alt.y);
s = await deck();
check(s.drone.alt < 20, 'a tap near the foot of the ALT rail brings the commanded height down', s.drone);
s = await tab('drone');
check(s.active === null && s.drone.up && s.cam === 'drone' && s.live.includes('drone'),
  'DRONE lowered: still flying, still its view, and the tab wears the dot', s);
await tapAt(dock.x, dock.y);
s = await deck();
check(s.cam === 'top', 'the dock takes a flying view to the chart', s);
await tapAt(dock.x, dock.y);
s = await deck();
check(s.cam === 'drone', '…and back to the drone, the seat you were last in', s);

const pageErrs = await page.evaluate(() => window.__pageErrors ?? []);
check(pageErrs.length === 0 && errors.length === 0, 'no page errors', { pageErrs: pageErrs.slice(0, 2), errors: errors.slice(0, 2) });
await close();
console.log(failures ? `\n${failures} FAILURES` : '\nhud-deck: all ok');
process.exit(failures ? 1 : 0);
