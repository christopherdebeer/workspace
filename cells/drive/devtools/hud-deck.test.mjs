// THE DECK: SIX TABS IN THE STRAIT, THREE LAYOUTS, AND DEBUG ONLY IN VIEW.
//
//   node cells/drive/devtools/hud-deck.test.mjs
//
// The control matrix (six canvas cells beside the minimap) and the chart's two
// edge rails became the deck (client/hud-deck.ts): DOM tabs laid on the same
// strait, whose DRIVE / MAP / VIEW tabs switch the HUD's LAYOUT and whose
// sheets carry the old actions. The claim this holds is the one the change was
// for — the tile debug overlay and the other inspection views draw in VIEW and
// nowhere else, so the chart is clean — plus the geometry (the row sits in the
// strait and every tab is reachable where a thumb lands) and the handlers (a
// tap on a sheet's button does what the old cell did).
//
// The tile-debug DIAL is left ON throughout, on purpose: it is the seat's
// default, and the whole point is that the dial saying "on" no longer means
// the chart wears it. A test that switched it off first would pass on the old
// build.
import { openDrive } from './harness.mjs';

let failures = 0;
const check = (ok, msg, extra) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { page, close, errors } = await openDrive({
  spot: 'fixture=at-campsbay&cam=chase&time=NOON&wx=clear&nodraw=1', tag: 'deck', settle: 0, bootTimeout: 120000,
});
const deck = (tab) => page.evaluate((t) => window.__deck(t), tab);
// A frame has to pass for the deck to render what a tap asked for: the sheet
// is described by the frame loop (stepOverlays → stepDeck), not by the tap.
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

for (let i = 0; i < 60; i++) { if (await page.evaluate(() => !!window.__deck)) break; await sleep(500); }
await page.evaluate(() => { window.__dial('tdbg', 1); window.__dial('auto', 1); });
await sleep(1500);

// ── the strait ──
const geo = await page.evaluate(() => {
  const row = document.getElementById('deck-row').getBoundingClientRect();
  const s = window.__hudscale();
  const rects = window.__hudrects();
  return { row: { x: row.x, y: row.y, w: row.width, h: row.height }, s,
    dock: rects.dock, box: rects.deck, W: innerWidth, H: innerHeight,
    tabs: [...document.querySelectorAll('[data-deck-tab]')].map((b) => b.dataset.deckTab) };
});
check(geo.tabs.join() === 'view,map,rig,drive,cam,sys', 'six tabs in the mock\'s order', geo.tabs);
check(Math.abs(geo.row.x - geo.box.x * geo.s) <= 1 && Math.abs(geo.row.w - geo.box.w * geo.s) <= 1,
  'the row is laid on the strait the HUD computes', { row: geo.row, box: geo.box, s: geo.s });
check(geo.row.x >= (geo.dock.x + geo.dock.w) * geo.s - 1, 'the row starts right of the dock', { row: geo.row, dock: geo.dock });
check(geo.row.x + geo.row.w <= geo.W - 56 * geo.s + 1, 'the row stops short of the dial');
for (const t of geo.tabs) {
  const r = await page.evaluate((x) => { const b = window.__deckrect(x); const e = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2); return e?.closest('[data-deck-tab]')?.dataset.deckTab; }, t);
  check(r === t, `the ${t.toUpperCase()} tab is under a thumb placed on it`, r);
}

// ── DRIVE: the old matrix's actions, on its sheet ──
let s = await deck();
check(s.layout === 'drive' && s.cam === 'chase', 'boots in the DRIVE layout, in the chase seat', s);
check(s.tileDbg === true && s.tileDbgOn === false, 'the tile-debug dial is ON and nothing draws it while driving', s);
const noMatrix = await page.evaluate(() => Object.keys(window.__hudrects()));
check(!noMatrix.includes('pov') && !noMatrix.includes('drone'), 'the canvas matrix\'s hit rects are gone', noMatrix);
s = await tab('drive');
check(s.open === 'drive', 'a second tap on the layout you are in opens its sheet', s);
let t = await thumb('auto');
let a = await page.evaluate(() => window.__auto());
check(t.hit && a.on === true, 'AUTOPILOT, tapped where a thumb lands, engages', { t, on: a.on });
await sleep(800);
t = await thumb('auto');
a = await page.evaluate(() => window.__auto());
check(t.hit && a.on === false, '…and the same tap hands it back', { t, on: a.on });
t = await thumb('hold');
await sleep(800);
const held = await page.evaluate(() => window.__rewind?.().held ?? null);
check(t.hit && held === true, 'HOLD stops the world', { t, held });
await thumb('hold');
await sleep(800);
t = await thumb('poi:1');
await sleep(800);
const poi = await page.evaluate(() => window.__dial().poi);
check(t.hit && poi === 'PINNED', 'a WAYPOINTS choice sets the dial', { t, poi });

// ── MAP: the chart, and the chart is clean ──
s = await tab('map');
check(s.layout === 'map' && s.cam === 'top', 'MAP is the chart', s);
check(s.tileDbgOn === false, 'THE CHART DOES NOT WEAR THE TILE GRID, with the dial on', s);
const rails = await page.evaluate(() => window.__chartlens().rects);
check(rails.tilt.w === 0 && rails.band.w === 0, 'the chart\'s TILT and BAND rails are gone from its edges', rails);
s = await tab('map');
check(s.open === 'map', 'a second tap on MAP opens the chart\'s sheet', s);

// ── VIEW: inspection, and only here ──
s = await tab('view');
check(s.layout === 'view' && s.open === 'view' && s.cam === 'top', 'VIEW opens INSPECT and keeps the camera it was given', s);
check(s.tileDbgOn === true, 'the tile grid draws in VIEW', s);
const chip = await page.evaluate(() => [document.getElementById('ov-menu').textContent, document.getElementById('deck-tag').style.display]);
check(chip[0] === 'VIEW' && chip[1] === 'block', 'the chip names the layout and the tagline is up', chip);
t = await thumb('pass:2');
await sleep(1000);
s = await deck();
check(t.hit && s.xray === 'WIRE', 'PASS → WIRE puts the renderer on its wireframe', { t, s });
t = await thumb('cam:chase');
await sleep(1500);
s = await deck();
check(t.hit && s.layout === 'view' && s.cam === 'chase', 'a CAMERA choice in VIEW moves the seat and stays in VIEW', s);

// ── leaving VIEW stands every inspection down ──
s = await tab('drive');
check(s.layout === 'drive' && s.xray === 'OFF' && s.tileDbgOn === false,
  'leaving VIEW turns the wireframe and the tile grid off', s);
const kept = await page.evaluate(() => window.__dial().xray);
check(kept === 'WIRE', 'and the rack still remembers WIRE for the next inspection', kept);
check((await page.evaluate(() => document.getElementById('ov-menu').textContent)) === 'MENU', 'the chip reads MENU again');
s = await tab('view');
check(s.xray === 'WIRE', 're-entering VIEW brings the remembered pass back', s);
await tab('drive');

// ── CAM and SYS are sheets over whatever layout is up ──
s = await tab('cam');
check(s.open === 'cam' && s.layout === 'drive', 'CAM opens a sheet without changing the layout', s);
t = await thumb('cam:cab');
await sleep(1500);
s = await deck();
check(t.hit && s.cam === 'cab', 'CAB from the CAM sheet puts you in the cab', s);
s = await tab('sys');
check(s.open === 'sys', 'SYS opens its sheet', s);
s = await tab('rig');
const menuTab = await page.evaluate(() => document.body.classList.contains('menu-open'));
check(menuTab === true && s.open === null, 'RIG opens the menu\'s RIG screen', { menuTab, s });

const pageErrs = await page.evaluate(() => window.__pageErrors ?? []);
check(pageErrs.length === 0 && errors.length === 0, 'no page errors', { pageErrs: pageErrs.slice(0, 2), errors: errors.slice(0, 2) });
await close();
console.log(failures ? `\n${failures} FAILURES` : '\nhud-deck: all ok');
process.exit(failures ? 1 : 0);
