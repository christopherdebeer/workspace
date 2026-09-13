/**
 * ── THE FORTH BRIDGE: DOES THE RAIL DECK GET ITS CANTILEVERS? ──
 *
 *   node devtools/forth-rail.mjs            (the fix)
 *   GRADE=0 node devtools/forth-rail.mjs    (the control, ?railgrade=0)
 *
 * The seat's own spot. No fixture carries the Forth, so this is a LIVE run and
 * depends on the cell's banked z16 tiles answering — the tiles were checked by
 * hand before this was written (four `railway=rail bridge=yes layer=1` ways,
 * all named `East Coast (Northern) Line`, in 16/32150/20404-20406), so a run
 * that finds no railway here is a streaming failure and says so rather than
 * reporting the bridge as absent.
 *
 * What it reads: whether the assembly formed at all, which landmark entry (if
 * any) claimed it, what it stood up, and whether the deck is over the water.
 */
import { openDrive } from './harness.mjs';

const GRADE = process.env.GRADE ?? '1';
const SPOT = process.env.SPOT ?? 'lat=56.00616&lon=-3.39142&h=128';
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const d = await openDrive({
  spot: `${SPOT}&cam=chase&time=NOON&wx=clear&nodraw=1&railgrade=${GRADE}`,
  tag: `forth-${GRADE}`, settle: 0, bootTimeout: 300000, dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

// A LIVE WORLD, so the gate waits on the wire as well as the build.
let quiet = 0, pw = -1, pc = -1, pb = -1;
for (let i = 0; i < 110; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc && t.builds === pb && t.seenWays > 0)
    ? quiet + 1 : 0;
  pw = t.seenWays; pc = t.roadCells; pb = t.builds;
  if (quiet >= 5) break;
}
console.log(`[${el()}] settled: ways ${pw}, roadCells ${pc}, builds ${pb}`);

const rw = await q(() => window.__railways());
console.log(`  railways: n=${rw.n} kinds=${JSON.stringify(rw.kinds)}`);
if (!rw.n) console.log('  !! NO RAILWAY STREAMED — this is the wire, not the bridge. The tiles hold four.');
for (const w of (rw.list ?? []).slice(0, 4)) {
  console.log(`    way ${w.id} ${w.kind} ${w.len}m graded=${w.graded} grade=${w.gradeMax}`);
}
const br = await q(() => window.__bridges());
console.log(`  assemblies: ${Array.isArray(br) ? br.length : JSON.stringify(br)}`);
for (const a of (Array.isArray(br) ? br : [])) console.log(`    ${JSON.stringify(a)}`);
const lifts = await q(() => window.__lifts(undefined, undefined, 2500));
console.log(`  lifts within 2.5km: ${lifts.length}`);
for (const l of lifts.slice(0, 6)) console.log(`    ${JSON.stringify(l)}`);
const rg = await q(() => window.__railgrade(2500));
const { rows, profiles, ...sum } = rg;
console.log(`  __railgrade: ${JSON.stringify(sum)}`);
for (const f of profiles ?? []) {
  const pc2 = (v) => `${(v * 100).toFixed(1)}%`;
  console.log(`    fragment ${f.fd} "${f.nm}" ${f.n} bays ${f.lenM}m — deck p95 ${pc2(f.deckG.p95)} · ground p95 ${pc2(f.demG.p95)}`);
}
const dk = await q(() => window.__decks(120));
console.log(`  decks within 120m: ${JSON.stringify(dk).slice(0, 600)}`);
const sp = await q(() => window.__spans?.() ?? null);
if (sp) console.log(`  spans: ${JSON.stringify(sp).slice(0, 300)}`);
const errs = await q(() => window.__errors?.() ?? []);
console.log(`  page errors: ${errs.length}${errs.length ? ' ' + JSON.stringify(errs.slice(0, 3)) : ''}`);

// ── AND A PICTURE, because "does it have cantilevers" is a claim about a frame ──
// `nodraw` is on for the settle (the world build is paced by the frame loop and
// SwiftShader gives three frames a second), so drawing is turned on only once
// everything is home. The camera is aimed from the probe's own answer rather
// than from a typed coordinate: the assembly knows where its towers are.
if (process.env.SHOTS !== '0') {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const OUT = process.env.OUT ?? '/tmp/drive-tools/forth';
  mkdirSync(OUT, { recursive: true });
  await q(() => { window.__draw(true); window.__hud(false); window.__hide('rig'); });
  for (const [name, cam, zoom] of [['chase', 'chase', 0], ['top', 'top', 1.4], ['wide', 'top', 4]]) {
    await q((m) => window.__cam(m), cam);
    if (zoom) await q((z) => window.__zoom(z), zoom);
    await d.page.waitForTimeout(9000);
    writeFileSync(`${OUT}/${name}-${GRADE}.png`, await d.page.screenshot({ timeout: 240000 }));
    console.log(`  shot ${name}`);
  }
  console.log(`  frames in ${OUT}`);
}
await d.close();
