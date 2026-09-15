/**
 * ── DOES A TREE ACQUIRE DETAIL, OR EXISTENCE? ──
 *
 *   node cells/drive/devtools/tree-impostor.mjs
 *   FIX=at-campsbay TRIS=600000 node .../tree-impostor.mjs
 *
 * The impostor tier draws the candidates admission turned down. This measures
 * what it stands up and what it changes on screen.
 *
 * ONE BOOT, INTERLEAVED. `__impostor(on)` re-runs the refresh synchronously, so
 * off / on / off happen on the SAME settled world — the repeat is the noise
 * floor at the same separation as the cross pair, and without it a two-boot
 * comparison carries the wildlife, the sward's phase and the arrival order
 * before it carries the tier. Every other tree switch is read once at boot and
 * forces exactly that; this one does not.
 *
 * `TRIS` is RAW TRIANGLES, which is what `?treetris=` takes — the first two
 * runs of this tool passed 0.35 and 1.2 meaning megatriangles, set the budget
 * to ONE triangle, and admitted no skeletons at all. An A/B between nothing
 * and impostors cannot show a handoff: there is nothing to hand off from.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-yosemite';
const TRIS = Number(process.env.TRIS ?? 900000);
const SECS = Number(process.env.SECS ?? 240);
const OUT = process.env.DRIVE_WORK ?? '/tmp/drive-tools';
mkdirSync(OUT, { recursive: true });

const d = await openDrive({
  spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&treetris=${TRIS}`,
  tag: 'impostor', settle: 0, bootTimeout: 300000,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

let quiet = 0, pp = '';
for (let i = 0; i < SECS / 3; i++) {
  await d.page.waitForTimeout(3000);
  const e = await q(() => window.__ez());
  const n = `${e.tris ?? 0}/${e.impostor?.drawn ?? 0}`;
  quiet = (n === pp && n !== '0/0') ? quiet + 1 : 0; pp = n;
  if (quiet >= 3) break;
}
const settled = quiet >= 3;
await q(() => window.__hud?.(false));

const legs = [];
for (const [tag, on] of [['a1', false], ['b1', true], ['a2', false]]) {
  await q((v) => window.__impostor(v), on);
  await d.page.waitForTimeout(1200);
  await d.page.screenshot({ path: `${OUT}/imp-${tag}.png` });
  legs.push(await q(() => ({ imp: window.__impostor(), ez: window.__ez() })));
}
// Back on, and read the census for an INDEPENDENT witness: `__ez` reports what
// the refresh WROTE, which a staged instance satisfies as well as a drawn one.
// `byTris` is the top twelve by triangle count, so a small tier is absent
// rather than zero — which is a different statement and must be printed as one.
await q(() => window.__impostor(true));
const census = await q(() => window.__census());
const errs = d.errors.slice(0, 4);
await d.close();

// ── CROP TO WHERE THE TIER DRAWS ──
// A frame-wide diff of a chase view is mostly sward and sky, and this tier
// draws in a band at the treeline: read whole, a real change came out at 2.5x
// its floor, and read over the band at eleven times it. A mean over pixels the
// term cannot reach is not a weaker measurement, it is a different one.
// AND THE BAND STOPS ABOVE THE SWARD. Taken 110 rows deep it reached the grass,
// whose own clock moves it between legs: floor 3.203/255, signal 10.4, a ratio
// of three. Seventy rows — the canopy alone — reads floor 0.325 and signal
// 10.673, which is THIRTY-THREE times it. The signal never moved; what changed
// is how much of the measurement was of something else.
const BAND = process.env.BAND ?? '200,300,190,70';
const diff = (a, b, out, crop) => {
  const t = execFileSync('node', [new URL('./imgdiff.mjs', import.meta.url).pathname,
    `${OUT}/imp-${a}.png`, `${OUT}/imp-${b}.png`, `${OUT}/${out}`,
    ...(crop ? [`--crop=${BAND}`, '--zoom=4'] : [])], { encoding: 'utf8' });
  // The last line is the output PATH. The numbers are the line before it, and
  // taking the last one printed a filename where a measurement should be.
  const lines = t.trim().split('\n');
  return lines.find((l) => l.includes('mean luma delta')) ?? lines.pop();
};

console.log(`\n── ${FIX} · budget ${TRIS} tris · ${settled ? 'settled' : 'NOT SETTLED — provisional'}`);
if (errs.length) {
  console.log(`  !! PAGE ERRORS: ${errs.join(' | ')}`);
  console.log('  !! A GLSL link failure logs and throws nothing: the tier would be ABSENT');
  console.log('     while every count below still read correct. Read no further.');
}
const [a1, b1] = legs;
console.log(`  skeletons placed ${b1.ez.placed?.length ?? '—'} logged · ${(b1.ez.tris / 1e6).toFixed(2)}M tris`);
console.log(`  impostors drawn  ${b1.imp.drawn} of ${b1.imp.offered} offered`
  + ` · ${(b1.imp.tris / 1000).toFixed(1)}k tris`
  + ` · ${(b1.imp.tris / (b1.ez.tris + b1.imp.tris) * 100).toFixed(2)}% of the vegetation bill`);
console.log(`  off leg drew ${a1.imp.drawn} (must be 0)`);
console.log(`  edges ${JSON.stringify(b1.ez.edge)}`);
const inScene = census.byTris?.['veg-impostor'];
console.log(`  census: ${inScene === undefined
  ? 'veg-impostor outside the top twelve by triangles — absent from this list is not zero'
  : `veg-impostor ${inScene} tris in the scene`}`);
console.log(`\n  whole frame`);
console.log(`    FLOOR  (off against off) ${diff('a1', 'a2', 'imp-floor.png')}`);
console.log(`    SIGNAL (off against on)  ${diff('a1', 'b1', 'imp-signal.png')}`);
console.log(`  the band the tier draws in (${BAND})`);
console.log(`    FLOOR  (off against off) ${diff('a1', 'a2', 'imp-band-floor.png', true)}`);
console.log(`    SIGNAL (off against on)  ${diff('a1', 'b1', 'imp-band.png', true)}`);
console.log(`\n  Frames in ${OUT}: imp-a1/b1/a2.png, imp-floor.png, imp-signal.png`);
