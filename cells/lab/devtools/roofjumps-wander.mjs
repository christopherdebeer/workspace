// The legs at a slow, changing pace (scenes.ts `gait-wander`, or any scene): what a semi-random wander about a rooftop
// shows that steady running hides. Every step on the ground at any speed, measured: where the toes point against where
// the body faces as the foot goes down (a foot planted skew reads drunk); a planted foot turning or sliding on the spot;
// both feet off the ground at a walking pace (a hop); a foot landing across the line of travel, or the swinging foot
// sweeping across behind the other; the sole's angle changing in the frame it lands (a slap); the foot's speed along the
// ground as it lands (a stamp); the knee as it lands; how evenly the steps come. By speed band (standing about, a walk,
// a jog), with the worst moments of each kind listed by time and, with --film, filmed: strips round each from the chase
// eye and the side, every 1/30 s.
//
//   node cells/lab/devtools/roofjumps-wander.mjs [scene key] [--film]
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname, OUT = new URL('./out/wander/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './scenes'; export * from './city'; export * from './runner'; export * from './rig'; export * from './m4';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const args = process.argv.slice(2), film = args.includes('--film'), key = args.find((a) => !a.startsWith('--')) ?? 'gait-wander';
const DT = 1 / 120, deg = (r) => (r * 180) / Math.PI, wrap = (a) => { a %= 2 * Math.PI; return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a; };
const axis = (m, i) => { const v = [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]], l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sc = M.sceneByKey(key), city = new M.City(1, false, sc.course), r = new M.Runner(city), rig = new M.Rig(); rig.update(1, r);
const F = [], mem = {};
for (let i = 0; i < sc.seconds / DT; i++) {
  const t = i * DT, inp = sc.input(t, r, mem); r.step(DT, inp); rig.update(DT, r);
  const b = rig.bones(r), at = (n) => b.find((o) => o.name === n).m, pel = at('pelvis');
  const f = { t, ask: Math.hypot(inp.x, inp.z), state: r.state, move: r.move, speed: r.speed, facing: r.heading, pelvis: [pel[12], pel[13], pel[14]] };
  for (const s of ['L', 'R']) {
    const th = at('thigh' + s), sh = at('shin' + s), ft = at('foot' + s), sole = rig.soles[s], z = axis(ft, 2);
    f[s] = { knee: deg(Math.acos(Math.max(-1, Math.min(1, dot(axis(th, 1), axis(sh, 1)))))), pitch: deg(Math.asin(Math.max(-1, Math.min(1, z[1])))), yaw: Math.atan2(z[0], z[2]), ball: M.point(ft, 0, -rig.body.sole, rig.body.ball), planted: !!(s === 'L' ? r.reach.fl : r.reach.fr) && sole.w > 0.9, y: city.heightAt(ft[12], ft[14]) };
  }
  F.push(f);
}
const band = (sp) => (sp < 0.35 ? 'standing about' : sp < 2 ? 'walking' : 'jogging');
const events = [], steps = [];
// (the hop at a walk: both feet off the ground, on the ground, under two metres a second)
let hopFrom = -1;
for (let i = 1; i < F.length; i++) {
  const a = F[i - 1], b = F[i];
  const both = b.state === 'ground' && !b.L.planted && !b.R.planted && b.speed < 2 && b.speed > 0.1;
  if (both && hopFrom < 0) hopFrom = b.t; if (!both && hopFrom >= 0) { if (b.t - hopFrom > 0.04) events.push({ kind: 'hop at a walk', t: hopFrom, v: b.t - hopFrom, unit: 's', say: `both feet off the ground ${((b.t - hopFrom) * 1000).toFixed(0)} ms at ${a.speed.toFixed(1)} m/s` }); hopFrom = -1; }
  for (const s of ['L', 'R']) {
    const side = s === 'L' ? 1 : -1;
    // (a planted foot turning or sliding on the spot, frame to frame)
    if (a[s].planted && b[s].planted) {
      const turn = Math.abs(wrap(b[s].yaw - a[s].yaw)), slide = Math.hypot(b[s].ball[0] - a[s].ball[0], b[s].ball[2] - a[s].ball[2]);
      if (turn > 0.02) events.push({ kind: 'planted foot twisting', t: b.t, v: deg(turn) / DT, unit: '°/s', say: `${s} foot turning on the spot at ${(deg(turn) / DT).toFixed(0)}°/s` });
      if (slide > 0.004) events.push({ kind: 'planted foot sliding', t: b.t, v: slide / DT, unit: 'm/s', say: `${s} foot sliding ${(slide / DT * 100).toFixed(0)} cm/s` });
    }
    if (b[s].planted && !a[s].planted && b.state === 'ground') {
      // (a footfall: toes against facing; across the line; the slap; the stamp; the knee)
      const h = b.facing, right = [-Math.cos(h), 0, Math.sin(h)], fwd = [Math.sin(h), 0, Math.cos(h)], rel = [b[s].ball[0] - b.pelvis[0], 0, b[s].ball[2] - b.pelvis[2]];
      const lat = -dot(rel, right) * side, p = F[Math.max(0, i - 3)], gv = [(b[s].ball[0] - p[s].ball[0]) / (3 * DT), (b[s].ball[2] - p[s].ball[2]) / (3 * DT)];
      const toe = deg(wrap(b[s].yaw - h)) * side, slap = Math.abs(b[s].pitch - F[Math.max(0, i - 2)][s].pitch), ground = Math.hypot(gv[0], gv[1]);
      const st = { t: b.t, s, speed: b.speed, band: band(b.speed), lat, toe, slap, ground, knee: b[s].knee };
      steps.push(st);
      if (lat < -0.01) events.push({ kind: 'footfall across the line', t: b.t, v: -lat, unit: 'm', say: `${s} foot down ${(-lat * 100).toFixed(0)} cm over on the other side, at ${b.speed.toFixed(1)} m/s` });
      if (Math.abs(toe) > 25) events.push({ kind: 'toes off where it faces', t: b.t, v: Math.abs(toe), unit: '°', say: `${s} foot down pointing ${Math.abs(toe).toFixed(0)}° ${toe > 0 ? 'out' : 'in'} from where it faces, at ${b.speed.toFixed(1)} m/s` });
      if (slap > 8) events.push({ kind: 'slap', t: b.t, v: slap, unit: '°', say: `${s} sole turned ${slap.toFixed(0)}° in the landing frame` });
      if (ground > Math.max(1.5, 1.5 * b.speed)) events.push({ kind: 'stamp', t: b.t, v: ground, unit: 'm/s', say: `${s} foot still moving ${ground.toFixed(1)} m/s along the ground as it lands (body ${b.speed.toFixed(1)})` });
    }
    // (the swinging foot sweeping across behind the other)
    if (!b[s].planted && b.state === 'ground' && b.speed > 0.3) {
      const h = b.facing, right = [-Math.cos(h), 0, Math.sin(h)], lat = -((b[s].ball[0] - b.pelvis[0]) * right[0] + (b[s].ball[2] - b.pelvis[2]) * right[2]) * side;
      if (lat < -0.04) events.push({ kind: 'swing foot across', t: b.t, v: -lat, unit: 'm', say: `${s} swing foot ${(-lat * 100).toFixed(0)} cm across the line` });
    }
  }
}
// (how evenly the steps come, within each spell of steady asking)
const gaps = steps.slice(1).map((x, i) => ({ dt: x.t - steps[i].t, band: x.band, alt: x.s !== steps[i].s }));
const same = gaps.filter((g) => !g.alt).length;
// (each kind: how often, its worst; the worst moments, merged where they're within a quarter second)
const kinds = {}; for (const e of events) (kinds[e.kind] ??= []).push(e);
const summary = Object.entries(kinds).map(([k, es]) => { es.sort((a, b) => b.v - a.v); const times = []; for (const e of es) if (!times.some((t) => Math.abs(t - e.t) < 0.25)) times.push(e.t); return { kind: k, count: es.length, moments: times.length, worst: es[0], top: es.filter((e, i, a) => a.findIndex((x) => Math.abs(x.t - e.t) < 0.25) === i).slice(0, 4) }; }).sort((a, b) => b.moments - a.moments);
const byBand = {}; for (const st of steps) (byBand[st.band] ??= []).push(st);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
console.log(`${key}: ${sc.seconds} s, ${steps.length} footfalls (${Object.entries(byBand).map(([b, a]) => `${a.length} ${b}`).join(', ')}); ${same} times the same foot stepped twice running`);
for (const [b, a] of Object.entries(byBand)) console.log(`  ${b.padEnd(15)} knee at touchdown ${mean(a.map((x) => x.knee)).toFixed(0)}°, toes ${mean(a.map((x) => Math.abs(x.toe))).toFixed(0)}° off facing, landing ${mean(a.map((x) => x.ground)).toFixed(1)} m/s along the ground, slap ${mean(a.map((x) => x.slap)).toFixed(0)}°, across the line ${a.filter((x) => x.lat < -0.01).length}`);
for (const k of summary) console.log(`  ${k.kind}: ${k.moments} moments (${k.count} frames); worst ${k.worst.say} at ${k.worst.t.toFixed(2)} s`);
mkdirSync(OUT, { recursive: true });
writeFileSync(OUT + 'report.json', JSON.stringify({ key, steps, summary: summary.map(({ top, ...k }) => ({ ...k, top })) }, null, 1));

// (the moments to film: the worst of each kind, a few, spread out)
const moments = []; for (const k of summary) for (const e of k.top.slice(0, 2)) if (!moments.some((m) => Math.abs(m.t - e.t) < 0.6)) moments.push({ t: e.t, kind: k.kind, say: e.say });
moments.sort((a, b) => a.t - b.t);
if (film) {
  process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
  const { withWood } = await import('./harness.mjs');
  await withWood(async (w) => {
    for (const m of moments.slice(0, 8)) for (const [view, extra] of [['chase', '&zoom=1.6'], ['side', '&side=90&zoom=2.2'], ['front', '&side=180&zoom=2.2']]) {
      const file = `${key}-${m.t.toFixed(2)}-${view}.png`, p = await w.open(`scene=${key}${process.env.MOCAP === '0' ? '&mocap=0' : ''}&strip=${Math.max(0, m.t - 0.25).toFixed(4)}&frames=16&every=${(1 / 30).toFixed(4)}&cols=8&holds=0&marks=0&look=clay${extra}`, { width: 1600, height: 520, dpr: 1 });
      for (let k = 0; k < 80 && (await p.evaluate(() => window.__roofjumps.probe().pending)) > 0; k++) await p.waitForTimeout(250);
      await p.waitForTimeout(400); await p.screenshot({ path: OUT + file }); await p.close(); m[view] = file; console.log(`filmed ${m.t.toFixed(2)} s ${view}`);
    }
  });
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// (the run from above: the path, each footfall with its toe direction, the flagged moments)
const xs = F.map((f) => f.pelvis[0]), zs = F.map((f) => f.pelvis[2]), x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, z0 = Math.min(...zs) - 1, z1 = Math.max(...zs) + 1, S = 640 / Math.max(x1 - x0, z1 - z0);
const P = (x, z) => [((x - x0) * S).toFixed(1), ((z1 - z) * S).toFixed(1)];
const map = `<svg viewBox="0 0 ${((x1 - x0) * S).toFixed(0)} ${((z1 - z0) * S).toFixed(0)}" role="img" aria-label="The wander from above: the hips' path, each footfall with the way its toes point; flagged moments ringed">
<path class="path" d="${F.filter((_, i) => i % 3 === 0).map((f, i) => `${i ? 'L' : 'M'}${P(f.pelvis[0], f.pelvis[2]).join(',')}`).join('')}"/>
${steps.map((st) => { const f = F.find((g) => g.t === st.t), b = f[st.s].ball, y = f[st.s].yaw, [px, pz] = P(b[0], b[2]), [qx, qz] = P(b[0] + Math.sin(y) * 0.22, b[2] + Math.cos(y) * 0.22); return `<line class="${st.s === 'L' ? 'l' : 'r'}" x1="${px}" y1="${pz}" x2="${qx}" y2="${qz}"/><circle class="${st.s === 'L' ? 'l' : 'r'}f" cx="${px}" cy="${pz}" r="2.6"/>`; }).join('')}
${moments.map((m) => { const f = F.find((g) => Math.abs(g.t - m.t) < DT / 2) ?? F[0], [px, pz] = P(f.pelvis[0], f.pelvis[2]); return `<circle class="flag" cx="${px}" cy="${pz}" r="9"/><text x="${+px + 11}" y="${+pz + 4}">${m.t.toFixed(1)}</text>`; }).join('')}
</svg>`;
writeFileSync(OUT + 'report.html', `<title>Roof Jumps Wander</title>
<style>
:root { --bg: #f2f1ee; --panel: #fbfbfa; --ink: #1d1d1b; --muted: #66645e; --rule: #d8d6d0; --l: #2f6fb0; --r: #c4561f; --flag: #b3261e; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #161615; --panel: #1f1f1d; --ink: #ebeae6; --muted: #a3a19a; --rule: #34332f; --l: #6aa6e6; --r: #f08a55; --flag: #ff8a80; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #161615; --panel: #1f1f1d; --ink: #ebeae6; --muted: #a3a19a; --rule: #34332f; --l: #6aa6e6; --r: #f08a55; --flag: #ff8a80; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; padding: 24px 16px 48px; max-width: 1640px; }
h1 { font-size: 1.6rem; margin: 0 0 6px; } h2 { font-size: 1.1rem; margin: 30px 0 6px; } .lede, .k { color: var(--muted); } .lede { max-width: 85ch; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; } th, td { padding: 4px 10px; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: top; }
svg { width: 100%; max-width: 640px; height: auto; background: var(--panel); border: 1px solid var(--rule); border-radius: 4px; display: block; }
svg .path { fill: none; stroke: var(--muted); stroke-width: 1; } svg .l { stroke: var(--l); stroke-width: 1.5; } svg .r { stroke: var(--r); stroke-width: 1.5; } svg .lf { fill: var(--l); } svg .rf { fill: var(--r); }
svg .flag { fill: none; stroke: var(--flag); stroke-width: 1.5; } svg text { fill: var(--flag); font-size: 11px; font-family: ui-monospace, monospace; }
img { width: 100%; display: block; border-radius: 4px; margin: 4px 0; }
</style>
<h1>Roof Jumps legs, wandering at a slow, changing pace</h1>
<p class="lede"><code>?scene=${esc(key)}</code>: ${esc(sc.asks)} Every footfall at any speed measured; the moments where something reads wrong listed and filmed (chase eye, and side), every 1/30 s from a quarter second before. Re-run: <code>node cells/lab/devtools/roofjumps-wander.mjs --film</code>.</p>
<h2>By speed</h2>
<table><thead><tr><th>pace</th><th>footfalls</th><th>knee at touchdown</th><th>toes off facing</th><th>foot along the ground as it lands</th><th>slap</th><th>across the line</th></tr></thead><tbody>
${Object.entries(byBand).map(([b, a]) => `<tr><td>${b}</td><td>${a.length}</td><td>${mean(a.map((x) => x.knee)).toFixed(0)}°</td><td>${mean(a.map((x) => Math.abs(x.toe))).toFixed(0)}°</td><td>${mean(a.map((x) => x.ground)).toFixed(1)} m/s</td><td>${mean(a.map((x) => x.slap)).toFixed(0)}°</td><td>${a.filter((x) => x.lat < -0.01).length}</td></tr>`).join('')}
</tbody></table>
<h2>What reads wrong, how often</h2>
<table><thead><tr><th>kind</th><th>moments</th><th>worst</th></tr></thead><tbody>
${summary.map((k) => `<tr><td>${esc(k.kind)}</td><td>${k.moments}</td><td>${esc(k.worst.say)} at ${k.worst.t.toFixed(2)} s</td></tr>`).join('')}
</tbody></table>
<h2>From above</h2><p class="k">The hips' path; each footfall a dot with a tick the way its toes point (left blue, right orange); the filmed moments ringed, by time.</p>${map}
${moments.filter((m) => m.chase).map((m) => `<h2>${m.t.toFixed(2)} s: ${esc(m.kind)}</h2><p class="k">${esc(m.say)}</p><img src="${m.chase}" alt="${m.t.toFixed(2)} s from the chase eye"><img src="${m.side}" alt="${m.t.toFixed(2)} s from the side"><img src="${m.front}" alt="${m.t.toFixed(2)} s from in front">`).join('\n')}`);
console.log(`→ ${OUT}report.html`);
