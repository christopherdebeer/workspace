/**
 * ── DOES A CEILING CHANGE THE MIX, AND DOES THE WATER HAVE A SIDE ──
 *
 * Two claims that cannot be heard from this desk and must not be asserted
 * from it, so both halves are measured: the DETECTOR (does the world know
 * where its roofs are) and the MIXER (does knowing change anything).
 *
 * A CAPTURE, NOT THE LIVE PLANET, and the RIGHT one. The first run of this
 * read no ceilings at Vélizy over the network — Overpass served nothing, so
 * the solver had no hints, so there were no decks to find and the detector
 * went untested while the mixer half passed. The second run went to
 * `at-paris-west` believing it was Vélizy: it is SURESNES, a flat suburb of
 * pavements with nothing to drive under, and it read zero for the honest
 * reason. `at-paris-south` is the interchange — the A 86 under the N 118,
 * 44 grade-separated crossings, 21 ways tagged `layer=1 bridge=yes` and 22
 * tagged tunnels, and no network at all.
 *
 *   node devtools/space-audit.mjs
 */
import { openDrive, report } from './harness.mjs';

const errors = [];
const d = await openDrive({
  spot: 'fixture=at-paris-south&cam=chase&wx=clear&time=NOON&nodraw=1',
  tag: 'space', settle: 0, bootTimeout: 240000,
});
d.page.on('pageerror', (e) => errors.push(String(e)));

// THE THREE-SIGNAL GATE, because a stable carve is not a stable road network:
// `dirty` reaches zero minutes before `roadCells` stops moving, and every
// number read at the earlier gate describes a fraction of a world and
// undercounts in the direction of "no problem".
let st = { dirty: -1, seenWays: -1, roadCells: -1 }, held = 0;
for (let i = 0; i < 90; i++) {
  await d.page.waitForTimeout(3000);
  const s = await d.page.evaluate(() => {
    const t = window.__tstats?.() ?? {};
    return { dirty: t.dirty ?? -1, seenWays: t.seenWays ?? -1, roadCells: t.roadCells ?? -1 };
  });
  held = (s.dirty === st.dirty && s.seenWays === st.seenWays && s.roadCells === st.roadCells) ? held + 1 : 0;
  st = s;
  if (held >= 4 && st.roadCells > 0) break;
}
console.log(`settled: ${held >= 4 ? 'yes' : 'NO — the numbers below are a partial world'}`,
  `dirty ${st.dirty} ways ${st.seenWays} roadCells ${st.roadCells}`);
console.log('arm:', await d.page.evaluate(() => window.__armAudio()));

// ── WHERE IS THERE A CEILING AT ALL ──
// Sweep for the DETECTOR'S OWN VERDICT rather than hoping the truck is parked
// under something: the claim is about the mechanism, and a sweep says whether
// the world here even has an overhead to find.
const found = await d.page.evaluate(() => {
  const hits = [];
  const o = window.__drive;
  for (let dx = -300; dx <= 300; dx += 12) {
    for (let dz = -300; dz <= 300; dz += 12) {
      const s = window.__space(o.x + dx, o.z + dz);
      if (s.e > 0) hits.push({ dx, dz, e: s.e, clear: s.clear, buried: s.buried, mouth: s.mouth });
    }
  }
  return hits;
});
const decks = found.filter((h) => !h.buried && !h.mouth);
const bores = found.filter((h) => h.buried);
const mouths = found.filter((h) => h.mouth && !h.buried);
console.log(`enclosed points within 300m: ${found.length}`
  + `  (deck ${decks.length}, bore ${bores.length}, mouth ${mouths.length})`);
for (const h of [...decks.slice(0, 3), ...bores.slice(0, 2), ...mouths.slice(0, 2)]) {
  console.log('   ', JSON.stringify(h));
}

// ── AND WHAT THE MIXER DOES WITH ONE ──
await d.page.evaluate(() => { window.__audioSpace(0); });
await d.page.waitForTimeout(1600);
const mOpen = await d.page.evaluate(() => window.__mix());
await d.page.evaluate(() => { window.__audioSpace(1); });
await d.page.waitForTimeout(1800);
const mShut = await d.page.evaluate(() => window.__mix());
await d.page.evaluate(() => { window.__audioSpace(-1); });
console.log('\nopen sky :', JSON.stringify({ out: mOpen.out, slap: mOpen.slap, muffle: mOpen.muffle }));
console.log('enclosed :', JSON.stringify({ out: mShut.out, slap: mShut.slap, muffle: mShut.muffle }));

let bad = 0;
const ok = (n, c, saw) => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : `\n        saw ${JSON.stringify(saw)}`}`); };
ok('open sky is transparent — the old path exactly',
  mOpen.muffle > 15000 && mOpen.slap < 0.01 && mOpen.out > 0.98, mOpen);
ok('a ceiling muffles the world', mShut.muffle < 3000, mShut.muffle);
ok('…turns it down', mShut.out < 0.6, mShut.out);
ok('…and gives the truck its own noise back', mShut.slap > 0.15, mShut.slap);
ok('the interchange has decks overhead', decks.length > 0, decks.length);
// NOT AN ASSERTION, AND SAYING SO IS THE POINT. `__buried(400)` reports
// `exempt: null` here — the solver marked NO segment `tn` or `pc` at Vélizy,
// because its 23 tagged tunnels are car-park ramps and footway subways whose
// chords are capped at the terrain on flat ground, so nothing ever ends up
// 5.6m under a hill. The bore and mouth branches of `enclosureAt` therefore
// ship unmeasured; no capture in the index has a drivable bore to measure
// them on. Reported rather than asserted, and rather than dressed up with a
// synthetic segment — a test that plants its own witness proves nothing.
console.log(bores.length || mouths.length
  ? `bores/mouths: ${bores.length}/${mouths.length}`
  : 'bores/mouths: NONE HERE — see __buried, this fixture cannot test that branch');

// THE NEGATIVE HALF, and it is the one that would catch a detector that just
// says yes: an interchange is mostly open sky, so most of the sweep must read
// nothing at all. A rule that fires everywhere is not a rule.
const openF = 1 - found.length / 2601;
console.log(`open sky over the sweep: ${(openF * 100).toFixed(1)}%`);
ok('most of an interchange is still open sky', openF > 0.6, +openF.toFixed(3));

const river = await d.page.evaluate(() => ({ at: window.__space().riverAt, mix: window.__mix() }));
console.log('\nriver bearing:', river.at, 'panned to', river.mix.riverAt, 'at level', river.mix.river);
ok('the pan is held short of the hard edge', Math.abs(river.mix.riverAt) <= 0.76, river.mix.riverAt);
await d.close();

// ── AND THE WATER'S SIDE, SOMEWHERE THERE IS WATER ──
//
// Vélizy is dry, so every assertion about the pan there passes on zero and
// none of them can fail — decoration, and this file has a rule about that.
// Camps Bay has the Atlantic in its box.
//
// THE TEST IS THE SAME WATER FROM TWO HEADINGS, which is what makes it an
// assertion rather than a coincidence: park beside a wet point, face so the
// water is off the port beam, read the pan; turn 180 degrees so the SAME water
// is off the starboard beam, read it again. Nothing about where the sea
// actually is has to be assumed, and a pan wired to a constant, to the world
// axes, or to the wrong sign fails one of the two.
const cb = await openDrive({
  spot: 'fixture=at-campsbay&cam=chase&wx=clear&time=NOON&nodraw=1',
  tag: 'space-cb', settle: 0, bootTimeout: 240000,
});
cb.page.on('pageerror', (e) => errors.push(String(e)));
for (let i = 0; i < 40; i++) {
  await cb.page.waitForTimeout(3000);
  if (await cb.page.evaluate(() => window.__tstats().dirty === 0 && window.__tstats().roadCells > 0)) break;
}
await cb.page.evaluate(() => window.__armAudio());

// Find water, and a dry stand 24m off it — the ring's own radius.
const spot = await cb.page.evaluate(() => {
  const o = window.__drive;
  let best = null;
  for (let dx = -600; dx <= 600; dx += 20) for (let dz = -600; dz <= 600; dz += 20) {
    const x = o.x + dx, z = o.z + dz;
    if (!window.__waterinfo(x, z).wet) continue;
    const d = Math.hypot(dx, dz);
    if (!best || d < best.d) best = { x, z, d };
  }
  return best;
});
console.log('nearest water:', JSON.stringify(spot));
let pans = null;
if (spot) {
  pans = await cb.page.evaluate(async ({ wx, wz }) => {
    const o = window.__drive;
    // Stand 16m off the water on the line back toward the spawn, so the truck
    // is on the dry side of it whichever way the coast runs — and inside the
    // ring's own 24m radius rather than exactly on it, because the ring's six
    // probes sit at fixed sixty-degree bearings and only a body the stand is
    // WELL inside of will catch more than one of them.
    const R = 16;
    const bx = o.x - wx, bz = o.z - wz, bl = Math.hypot(bx, bz) || 1;
    const sx = wx + (bx / bl) * R, sz = wz + (bz / bl) * R;
    // The water's direction FROM the stand, as a unit vector.
    const ux = (wx - sx) / R, uz = (wz - sz) / R;
    const read = async (h) => {
      o.x = sx; o.z = sz; o.heading = h;
      await new Promise((r) => setTimeout(r, 3200));
      return { h: +h.toFixed(2), at: window.__space().riverAt,
        pan: window.__mix().riverAt, level: window.__mix().river };
    };
    // right = (cos h, sin h). Water to PORT means right = -u.
    const port = Math.atan2(-uz, -ux);
    return { stand: [Math.round(sx), Math.round(sz)],
      port: await read(port), starboard: await read(port + Math.PI) };
  }, { wx: spot.x, wz: spot.z });
  console.log('pan by heading:', JSON.stringify(pans));
}
ok('Camps Bay has water in its box', !!spot, spot);
if (pans) {
  ok('the river channel opens beside water', pans.port.level > 0.02 && pans.starboard.level > 0.02, pans);
  ok('water off the port beam pans left', pans.port.pan < -0.05, pans.port);
  ok('the same water off the starboard beam pans right', pans.starboard.pan > 0.05, pans.starboard);
  ok('and both are held short of the hard edge',
    Math.abs(pans.port.pan) <= 0.76 && Math.abs(pans.starboard.pan) <= 0.76, pans);
}
await cb.close();
report(errors);
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
