/**
 * Squishy: the jelly bench's measures. Drops onto the panna cotta, the mango pudding and the konjac, from 10, 25
 * and 50 cm, each dumpling, with and without sprinkles on it: how long it's in contact, how fast it comes in and
 * leaves, how high it comes back up (and so its restitution), how far the jelly gives, how many of its points
 * are pinned, what the jelly's stops took, how far the dumpling deforms.
 *
 *   node cells/lab/devtools/squishy-drops.mjs
 */
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(`../client/squishy/${f}`, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const L = await load('level.ts'), B = await load('body.ts'), C = await load('course.ts');
const DT = 1 / 60;
const names = ['panna cotta', 'mango pudding', 'konjac'];
const rows = [];
for (const kind of ['dough', 'jelly']) for (const sprinkled of [false, true]) for (let j = 0; j < 3; j++) for (const h of [10, 25, 50]) {
  const lv = C.bench('jelly');
  const tw = lv.towers[j + 1], jel = tw.land[0].jel, top = tw.at[1], rest = top + L.REST_H;
  const d = new B.Dumpling([tw.at[0], rest + h, tw.at[2]], kind);
  if (sprinkled) { d.coat.fill(1); d.coatKind.fill(L.DUST.sprinkles); }
  let first = -1, left = -1, apex = -Infinity, dent = 0, pinned = 0, vin = 0, vout = 0, dmax = 0;
  for (let t = 0; t < 2.5; t += DT) {
    const vy0 = d.vcom[1];
    d.step(lv, DT, t);
    dent = Math.min(dent, jel.z[0]); pinned = Math.max(pinned, d.pinned); dmax = Math.max(dmax, d.deform);
    if (first < 0 && d.contacts > 0) { first = t; vin = -vy0; }
    if (first >= 0 && left < 0 && d.contacts === 0 && t > first + DT) { left = t; vout = d.vcom[1]; }
    if (left >= 0) apex = Math.max(apex, d.com[1] - rest);
    if (left >= 0 && d.contacts > 0 && t > left + 0.05) break;
  }
  const reb = left >= 0 ? Math.max(0, apex) : 0;
  rows.push({ kind, sprinkled, jelly: names[j], h, contact: left >= 0 ? +(left - first).toFixed(3) : null, vin: +vin.toFixed(0), vout: +vout.toFixed(0), rebound: +reb.toFixed(1), e: +Math.sqrt(reb / h).toFixed(2), dent: +dent.toFixed(2), pinned, lost: +(jel.lost ?? 0).toFixed(0), deform: +dmax.toFixed(2) });
}
console.table(rows);
