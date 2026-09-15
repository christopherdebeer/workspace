/**
 * ── DOES A TREE ACQUIRE DETAIL, OR EXISTENCE? ──
 *
 *   node cells/drive/devtools/tree-impostor.mjs
 *   FIX=at-campsbay TRIS=0.4 node .../tree-impostor.mjs
 *
 * The impostor tier draws the candidates admission turned down. This boots the
 * same world twice with `?impostor=` the only difference and reports what the
 * tier stands up, what it costs in triangles, and — the reason the frames are
 * taken — what the ground past the geometry's edge LOOKS like either way.
 *
 * `TRIS=` squeezes the triangle budget so the cap bites hard and the tier has
 * something to do: at the shipped budget on a fixture only one family is cut,
 * and a measurement of a tier at the setting where it barely fires is a
 * measurement of nothing. The seat's own rack (`range 2800m · pop 2x`) is the
 * case this stands in for — 54,815 of 57,112 candidates cut.
 */
import { openDrive } from './harness.mjs';
import { mkdirSync } from 'node:fs';

const FIX = process.env.FIX ?? 'at-yosemite';
const TRIS = process.env.TRIS ?? '0.35';
const SECS = Number(process.env.SECS ?? 150);
const OUT = process.env.DRIVE_WORK ?? '/tmp/drive-tools';
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function run(on) {
  const d = await openDrive({
    spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&treetris=${TRIS}&impostor=${on}`,
    tag: `impostor-${on}`, settle: 0, bootTimeout: 300000,
  });
  const q = (f, ...a) => d.page.evaluate(f, ...a);
  let quiet = 0, pp = -1;
  for (let i = 0; i < SECS / 3; i++) {
    await d.page.waitForTimeout(3000);
    const n = (await q(() => window.__ez())).tris ?? 0;
    quiet = (n === pp && n > 0) ? quiet + 1 : 0; pp = n;
    if (quiet >= 3) break;
  }
  // The HUD off, so a frame is the world and not the instruments.
  await q(() => window.__hud?.(false));
  await d.page.waitForTimeout(1500);
  await d.page.screenshot({ path: `${OUT}/impostor-${on}.png` });
  const r = await q(() => ({ ez: window.__ez(), census: window.__census?.() ?? null }));
  const errs = d.errors.slice(0, 4);
  await d.close();
  return { ...r, settled: quiet >= 3, errs };
}

const off = await run(0);
console.log(`[${el()}] impostor off`);
const on = await run(1);
console.log(`[${el()}] impostor on\n`);

console.log(`── ${FIX} · budget ${TRIS}M · ${off.settled && on.settled ? 'settled' : 'NOT SETTLED — provisional'}`);
for (const [name, r] of [['off', off], ['on', on]]) {
  if (r.errs.length) console.log(`  !! ${name} page errors: ${r.errs.join(' | ')}`);
}
const row = (k, a, b) => console.log(`  ${k.padEnd(20)} ${String(a).padStart(10)} ${String(b).padStart(10)}`);
console.log(`  ${''.padEnd(20)} ${'off'.padStart(10)} ${'on'.padStart(10)}`);
row('skeletons placed', off.ez.placed, on.ez.placed);
row('skeleton triangles', off.ez.tris, on.ez.tris);
row('impostors drawn', off.ez.impostor?.drawn ?? '—', on.ez.impostor?.drawn ?? '—');
row('of offered', off.ez.impostor?.offered ?? '—', on.ez.impostor?.offered ?? '—');
row('impostor triangles', off.ez.impostor?.tris ?? '—', on.ez.impostor?.tris ?? '—');
for (const f of Object.keys(on.ez.edge ?? {})) row(`${f} edge`, off.ez.edge[f], on.ez.edge[f]);
const share = on.ez.impostor?.tris && on.ez.tris
  ? ((on.ez.impostor.tris / (on.ez.tris + on.ez.impostor.tris)) * 100).toFixed(2) : '—';
console.log(`\n  The tier stands up ${on.ez.impostor?.drawn ?? 0} trees for ${share}% of the`
  + ` vegetation triangle bill — that ratio IS the argument.`);
console.log(`  Frames: ${OUT}/impostor-0.png and impostor-1.png`);
