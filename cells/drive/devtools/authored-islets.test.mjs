// The Apostles as the map draws them: closed natural=cliff rings on closed
// coastline islets. Three things at the live spot, the store stood in with
// page routes:
//   raw map, ?authored=0 — the cliff-ringed islets stand at the mainland's
//     cliff top with NO entry at all (the islet rule), the coastline-only
//     islets stay at the sea;
//   a patch entry — height=45 on the cliff ring 658651384 overrides the probe;
//   a dems entry — one cell on the beach set to 30 m reads back from the
//     ground as 30 m.
import { openDrive, report } from './harness.mjs';
let bad = 0;
const ok = (n, c, saw) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : ' saw ' + JSON.stringify(saw)}`); if (!c) bad++; };
const LAT = -38.66428, LON = 143.10395;
const mLat = 111320, mLon = 111320 * Math.cos((LAT * Math.PI) / 180);
const at = (distM, brg) => { const b = (brg * Math.PI) / 180; return [Math.sin(b) * distM, -Math.cos(b) * distM]; };
// Islets from the live v5 tiles (bbox centres, bearing and range from the lookout).
const ISLETS = {
  'cliff-ringed 658651384': at(424, 298),
  'cliff-ringed 658651379': at(561, 143),
  'cliff-ringed 658651380': at(515, 151),
  'coastline-only 658651383': at(284, 291),
  'coastline-only 284770173': at(610, 294),
};
const TILE = '16/58818/40410';
const REV = 1790000000000;
// A beach cell 60 m along the heading, well below the cliff foot.
const [bx, bz] = at(60, 306);
const beachLat = LAT - bz / mLat, beachLon = LON + bx / mLon;
const entries = {
  none: null,
  patch: { v: 1, tile: TILE, rev: REV, by: 'c15r', ways: [], patch: { '658651384': { height: '45' } }, dems: [] },
  dems: { v: 1, tile: TILE, rev: REV, by: 'c15r', ways: [], patch: {}, dems: [[beachLat, beachLon, 30]] },
};
const routeFor = (entry) => async (page) => {
  await page.route('**/authored', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ v: 1, z: 16, rev: entry ? REV : 0, tiles: entry ? { [TILE]: { rev: REV, n: 1, by: 'c15r' } } : {} }) }));
  await page.route('**/~/authored/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entry ?? {}) }));
};
const boot = async (q, tag, entry) => {
  const d = await openDrive({ spot: `lat=${LAT}&lon=${LON}&h=306&cam=cab&nodraw=1&wx=clear&time=NOON${q}`, tag, bootTimeout: 120000, route: routeFor(entry) });
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const t = await d.page.evaluate(() => window.__tstats?.().dirty);
    if (i > 10 && t === 0) break;
  }
  const out = await d.page.evaluate(({ islets, beach }) => {
    const g = (p) => window.__ground?.(p[0], p[1]);
    const o = { authored: window.__authored?.(), islets: {}, beach: g(beach) };
    for (const [k, p] of Object.entries(islets)) o.islets[k] = g(p);
    return o;
  }, { islets: ISLETS, beach: [bx, bz] });
  report(d.errors);
  await d.close();
  return out;
};
const raw = await boot('&authored=0', 'islets-raw', null);
console.log('raw', JSON.stringify(raw.islets), 'stacks', JSON.stringify(raw.authored?.stacks));
for (const k of Object.keys(ISLETS)) {
  const g = raw.islets[k];
  if (k.startsWith('cliff')) ok(`${k} stands at the mainland's cliff top with no entry (mesh ${g?.mesh}, dem ${g?.dem})`, g && g.mesh - g.dem > 20, g);
  else ok(`${k} stays at the sea with no entry (mesh ${g?.mesh}, dem ${g?.dem})`, g && g.mesh < g.dem + 3, g);
}
const patched = await boot('', 'islets-patch', entries.patch);
const gp = patched.islets['cliff-ringed 658651384'];
console.log('patch', JSON.stringify(patched.authored), JSON.stringify(gp));
// The crown rounds 4 m toward the ring, and an 11 m ring's centre is inside that.
ok('the patched ring takes its stated 45 m over the sea, not the probe', gp && gp.mesh - gp.dem > 40 && gp.mesh - gp.dem < 46.5 && patched.authored?.patched?.[TILE] === 1, gp);
const dems = await boot('', 'islets-dems', entries.dems);
console.log('dems', JSON.stringify(dems.authored), 'beach raw', JSON.stringify(raw.beach), 'beach dems', JSON.stringify(dems.beach));
ok('an authored dem cell is written into the raster and read back', dems.authored?.demCells === 1 && dems.beach && raw.beach && dems.beach.dem > raw.beach.dem + 10, { raw: raw.beach, dems: dems.beach });
console.log(bad ? `${bad} FAILED` : 'authored-islets: all ok');
process.exit(bad ? 1 : 0);
