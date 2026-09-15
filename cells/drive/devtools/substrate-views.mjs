/**
 * ── THE GEOMORPHIC FIELD, ONE CHANNEL AT A TIME, OVER REAL GROUND ──
 *
 *   node cells/drive/devtools/substrate-views.mjs
 *   FIX=at-campsbay CAM=top Z=300 node .../substrate-views.mjs
 *
 * The rule this programme runs on: a rendering claim is unarguable until the
 * field under it can be LOOKED AT. "The scree is in the wrong place" and
 * "there is no scree channel" produce the same frame, and only a view can
 * tell them apart. So this cycles the GROUND chip through its six channels on
 * one settled world and photographs each.
 *
 * It also reports, per channel, how much of the terrain pane the view MOVED
 * against the plain render — because a channel that is constant over a whole
 * fixture paints a flat wash, which looks exactly like a working view of
 * uniform ground and is the failure most worth catching early. The floor is
 * the same frame twice, as always.
 */
import { openDrive, WORK } from './harness.mjs';
import { readPng } from './png-lite.mjs';
import { join } from 'node:path';

const FIX = process.env.FIX ?? 'at-yosemite';
const CAM = process.env.CAM ?? 'top';
const Z = process.env.Z ?? '60';
const CH = (process.env.CH ?? 'exposure,debris,soil,moisture,grass,family').split(',');

const d = await openDrive({
  spot: `fixture=${FIX}&cam=${CAM}&z=${Z}&time=NOON&wx=clear`,
  tag: 'sub-views', settle: 0, bootTimeout: 420000,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
let quiet = 0, pb = -1;
for (let i = 0; i < 70; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.builds === pb) ? quiet + 1 : 0; pb = t.builds;
  if (i % 5 === 0) console.log(`  t+${i * 3}s dirty ${t.dirty} builds ${t.builds}`);
  if (quiet >= 2) break;
}
const shoot = async (name) => {
  await q(() => window.__draw(true));
  const f0 = await q(() => window.__clock().frames);
  for (let i = 0; i < 160; i++) { if ((await q(() => window.__clock().frames)) - f0 >= 4) break; await d.page.waitForTimeout(500); }
  const p = join(WORK, `subview-${name}.png`);
  await d.page.screenshot({ path: p, timeout: 300000 });
  await q(() => window.__draw(false));
  return p;
};
// The plain render, and the same frame again as the floor.
const plain = await shoot('plain');
const plain2 = await shoot('plain2');
const shots = {};
for (const ch of CH) {
  await q((c) => window.__groundview(c), ch);
  shots[ch] = await shoot(ch);
}
await q(() => window.__groundview('off'));

const A = readPng(plain), F = readPng(plain2);
const AW = 148, S = A.w / AW, AH = Math.round(A.h / S);
const px = (p, x, y) => { const i = (y * p.w + x) * p.bpp; return [p.data[i], p.data[i + 1], p.data[i + 2]]; };
const band = (p, q2) => {
  let n = 0, moved = 0, hues = new Set();
  for (let ay = 30; ay < Math.min(AH - 40, 250); ay++) {
    for (let ax = 18; ax < AW - 18; ax++) {
      const x = Math.min(p.w - 1, Math.round(ax * S + S / 2)), y = Math.min(p.h - 1, Math.round(ay * S + S / 2));
      const a = px(p, x, y), b = px(q2, x, y);
      n++;
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 24) moved++;
      hues.add(`${a[0] >> 4},${a[1] >> 4},${a[2] >> 4}`);
    }
  }
  return { moved: +(100 * moved / n).toFixed(1), tones: hues.size };
};
console.log(`\nfloor (the same frame twice): ${band(A, F).moved}% of the pane moved\n`);
console.log('channel     moved vs plain   distinct tones   frame');
for (const ch of CH) {
  const P = readPng(shots[ch]);
  const r = band(P, A);
  console.log(`${ch.padEnd(11)} ${String(r.moved).padStart(12)}%  ${String(r.tones).padStart(14)}   ${shots[ch]}`);
}
console.log(`\nat the truck: ${JSON.stringify(await q(() => window.__substrate()))}`);
console.log(`pageerrors: ${JSON.stringify((await q(() => window.__pageErrors ?? [])).slice(0, 3))}`);
await d.close();
