// Piste's body motion, judged (node cells/lab/devtools/piste-motion.mjs): one fencer stands, advances twice, extends and
// lunges, recovers, retreats and stands again, run twice: rigid (every dial of client/piste/motion.ts at zero) and with
// the body's own motion. Plots the pelvis, the trunk's sway, the head and the eye, and the rear hand against time, and
// side-on onion skins of the body through the sequence. Writes devtools/out/motion.png.
process.env.EXPERIMENT = 'piste';
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './bout'; export * from './weapons'; export * from './intent'; export * from './motion';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { Bout, EPEE, idle, MOTION } = M;
const live = structuredClone(MOTION);
const rigid = () => Object.assign(MOTION, structuredClone(live), {
  trunk: { ...live.trunk, gain: 0 }, legs: { ...live.legs, gain: 0, lift: 0 }, ready: { ...live.ready, bob: 0, shift: 0 },
  breath: { ...live.breath, lift: 0, tiredLift: 0 }, profile: 0, rear: { ...live.rear, hz: 80, zeta: 1, lead: 0, ext: 0, swing: 0 },
});

// the sequence: [from s, what the thumbs do]
const SEQ = [[0, {}], [1.2, { step: 'advance' }], [1.75, { step: 'advance' }], [2.35, { extend: 1 }], [2.6, { extend: 1, lunge: true }],
  [3.15, { extend: 0.45 }], [3.8, { step: 'retreat' }], [4.3, {}]];
const T = 6, DT = 1 / 60;
function run() {
  const b = new Bout({ weapon: EPEE, to: 5, referee: false }); b.place(4);
  const f = b.fencers[0], rows = [];
  let k = 0;
  for (let n = 0; n * DT < T; n++) {
    const t = n * DT;
    while (k + 1 < SEQ.length && t >= SEQ[k + 1][0]) { k++; if (SEQ[k][1].step) f.intent = { ...idle(), extend: f.intent.extend, step: SEQ[k][1].step }; }
    const want = SEQ[k][1];
    f.intent = { ...idle(), extend: want.extend ?? (k >= 5 ? 0.45 : 0.4), lunge: !!want.lunge, step: f.intent.step ?? null };
    b.fencers[1].intent = idle();
    b.advance(DT);
    const F = f.frame, c = f.capsules, loc = (p) => [(p[0] - F.o[0]) * F.f[0], p[1]];
    rows.push({ t, s: f.s * f.facing, pelvis: loc(c[0].a), chest: loc(c[0].b), neck: loc(c[1].b), head: loc(c[2].a), eye: loc(f.eye),
      sh: loc(f.shoulder), rsh: loc(c[7].a), rel: loc(c[7].b), rha: loc(c[8].b), el: loc(f.elbow), ha: loc(f.hand),
      hipF: loc(c[9].a), knF: loc(c[9].b), ftF: loc(c[10].b), hipB: loc(c[11].a), knB: loc(c[11].b), ftB: loc(c[12].b) });
  }
  return rows;
}
rigid(); const A = run();
Object.assign(MOTION, structuredClone(live)); const B = run();

// ── the plot ─────────────────────────────────────────────────────────────────────────────────────────────────────
const W = 1100, lanes = [
  ['pelvis height (cm)', (r) => r.pelvis[1] * 100],
  ['trunk sway: neck ahead of pelvis (cm)', (r) => (r.neck[0] - r.pelvis[0]) * 100],
  ['eye height (cm)', (r) => r.eye[1] * 100],
  ['rear hand behind pelvis (cm)', (r) => (r.pelvis[0] - r.rha[0]) * 100],
  ['rear hand height (cm)', (r) => r.rha[1] * 100],
];
const LH = 120, top = 30;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${top + lanes.length * LH + 330}" font-family="sans-serif"><rect width="100%" height="100%" fill="#fbfaf7"/>`;
const x = (t) => 70 + (W - 90) * t / T;
svg += `<text x="70" y="20" font-size="14"><tspan fill="#9a9a9a">━ rigid</tspan>   <tspan fill="#c4532d">━ with the body's own motion</tspan></text>`;
for (const [i, [s]] of SEQ.entries()) { const lbl = ['stand', 'advance', 'advance', 'extend', 'lunge', 'recover', 'retreat', 'stand'][i]; svg += `<line x1="${x(s)}" x2="${x(s)}" y1="${top}" y2="${top + lanes.length * LH}" stroke="#e5e2da"/><text x="${x(s) + 3}" y="${top + 12}" font-size="10" fill="#888">${lbl}</text>`; }
lanes.forEach(([name, fn], i) => {
  const y0 = top + i * LH, vals = [...A, ...B].map(fn), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.1 + 0.2;
  const y = (v) => y0 + LH - 14 - (LH - 34) * (v - lo + pad) / (hi - lo + 2 * pad);
  svg += `<text x="70" y="${y0 + 26}" font-size="11" fill="#333">${name}</text><text x="64" y="${y(hi) + 4}" font-size="9" text-anchor="end" fill="#999">${hi.toFixed(1)}</text><text x="64" y="${y(lo) + 4}" font-size="9" text-anchor="end" fill="#999">${lo.toFixed(1)}</text>`;
  for (const [rows, col, w] of [[A, '#9a9a9a', 1.5], [B, '#c4532d', 1.8]]) svg += `<polyline fill="none" stroke="${col}" stroke-width="${w}" points="${rows.map((r) => `${x(r.t).toFixed(1)},${y(fn(r)).toFixed(1)}`).join(' ')}"/>`;
});
// ── onion skins: side on, every 0.1 s through advance–lunge–recover ────────────────────────────────────────────
const oy = top + lanes.length * LH + 10;
const skin = (rows, ox, label, col) => {
  let g = `<text x="${ox}" y="${oy + 14}" font-size="12" fill="#333">${label}</text>`;
  const sc = 150, base = oy + 300, t0 = 1.6, t1 = 3.9;
  rows.filter((r) => r.t >= t0 && r.t <= t1 && Math.round(r.t / DT) % 6 === 0).forEach((r) => {
    const a = 0.18 + 0.6 * (r.t - t0) / (t1 - t0), P = (p) => `${(ox + 120 + sc * (r.s - rows[0].s + p[0] - 0.9) * 0.55).toFixed(1)},${(base - sc * p[1]).toFixed(1)}`;
    const line = (pts, w = 1.4, c = col) => `<polyline fill="none" stroke="${c}" stroke-opacity="${a.toFixed(2)}" stroke-width="${w}" stroke-linejoin="round" points="${pts.map(P).join(' ')}"/>`;
    g += line([r.ftB, r.knB, r.hipB, r.pelvis, r.hipF, r.knF, r.ftF]) + line([r.pelvis, r.chest, r.neck, r.head], 2) + line([r.sh, r.el, r.ha], 1.2, '#555') + line([r.rsh, r.rel, r.rha], 1.6, '#2d6fc4');
    g += `<circle cx="${P(r.head).split(',')[0]}" cy="${P(r.head).split(',')[1]}" r="${(sc * 0.12 * 0.55).toFixed(1)}" fill="none" stroke="${col}" stroke-opacity="${a.toFixed(2)}"/>`;
  });
  return g;
};
svg += skin(A, 40, 'rigid (rear arm in blue)', '#8a8a8a') + skin(B, W / 2 + 10, 'with the body’s own motion', '#c4532d') + '</svg>';
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const svgPath = new URL('./out/motion.svg', import.meta.url).pathname;
writeFileSync(svgPath, svg);
const { chromium } = await import('playwright');
const { existsSync } = await import('node:fs');
const br = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }), pg = await br.newPage({ viewport: { width: W, height: top + lanes.length * LH + 330 } });
await pg.setContent(svg); const png = svgPath.replace(/svg$/, 'png'); await pg.screenshot({ path: png }); await br.close();
const peak = (rows, fn) => Math.max(...rows.map(fn)) - Math.min(...rows.map(fn));
for (const [name, fn] of lanes) console.log(name.padEnd(40), 'range rigid', peak(A, fn).toFixed(2), '→', peak(B, fn).toFixed(2));
console.log(png);
