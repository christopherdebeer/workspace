// The legs, measured and filmed: why the running reads as a robot or a drunk rather than an athlete. Each scene is run
// as the page runs it (scenes.ts), the rig's bones taken every 1/120 s, and the legs measured stride by stride against
// what running people do: how bent the knee is as the foot lands, at its deepest under load, at its deepest in the
// swing; how long a foot is down (the duty factor); where each foot lands across the line of travel (crossing over
// reads as drunk); how the hips sway side to side and bob; how the foot is moving the moment it lands (a stamp, or
// pawed back); the sole's angle at touchdown; slips. Then, with --film, the same moments as fine strips (every 1/40 s)
// from the side and from behind, zoomed to the legs; and charts of the knees, the feet's heights and the footfalls.
//
//   node cells/lab/devtools/roofjumps-legs.mjs [scene keys…] [--film]
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname, OUT = new URL('./out/legs/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './scenes'; export * from './city'; export * from './runner'; export * from './rig'; export * from './m4';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const args = process.argv.slice(2), film = args.includes('--film'), keys = args.filter((a) => !a.startsWith('--'));
const KEYS = keys.length ? keys : ['gait-walk', 'gait-jog', 'gait-run', 'sharp-turns', 'edge-stop', 'transfer-clean'];
const MIN = 0.6, DT = 1 / 120, deg = (r) => (r * 180) / Math.PI;
const axis = (m, i) => { const v = [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]], l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

/** a scene run with the legs recorded each frame */
function record(sc) {
  const city = new M.City(1, false, sc.course), r = new M.Runner(city), rig = new M.Rig(); rig.update(1, r);
  const mem = {}, F = [];
  for (let i = 0; i < sc.seconds / DT; i++) {
    const t = i * DT; r.step(DT, sc.input(t, r, mem)); rig.update(DT, r);
    const b = rig.bones(r), at = (n) => b.find((o) => o.name === n).m, pel = at('pelvis');
    const f = { t, state: r.state, move: r.move, speed: r.speed, heading: Math.atan2(r.vx, r.vz) || r.heading, x: r.x, z: r.z, ground: r.state === 'ground', pelvis: [pel[12], pel[13], pel[14]] };
    for (const s of ['L', 'R']) {
      const th = at('thigh' + s), sh = at('shin' + s), ft = at('foot' + s), sole = rig.soles[s];
      const ball = M.point(ft, 0, -rig.body.sole, rig.body.ball);
      // (the knee's bend: 0 straight; the sole's pitch: + toe up; the foot's speed)
      const knee = deg(angle(axis(th, 1), axis(sh, 1))), z = axis(ft, 2), pitch = deg(Math.asin(Math.max(-1, Math.min(1, z[1]))));
      f[s] = { knee, pitch, ball, planted: !!(s === 'L' ? r.reach.fl : r.reach.fr) && sole.w > 0.9, hip: [th[12], th[13], th[14]], kneeP: [sh[12], sh[13], sh[14]], groundY: city.heightAt(ball[0], ball[2]) };
    }
    F.push(f);
  }
  return F;
}
/** the legs measured: per footfall and over the run (the ground frames at speed only) */
function measure(F) {
  const run = F.filter((f) => f.ground && f.speed > MIN), out = { frames: run.length, speed: run.length ? run.reduce((s, f) => s + f.speed, 0) / run.length : 0, feet: {} };
  const falls = [];
  for (const s of ['L', 'R']) {
    const side = s === 'L' ? 1 : -1, steps = [];
    for (let i = 1; i < F.length; i++) {
      const a = F[i - 1], b = F[i];
      if (!(b.ground && b.speed > MIN)) continue;
      if (b[s].planted && !a[s].planted) {
        // (a footfall: where across the line it lands (+ its own side), the knee and sole as it lands, how fast the foot was
        // going along the ground just before (a stamp is still going forward; a good one is pawed back near the ground's speed))
        const h = b.heading, right = [-Math.cos(h), 0, Math.sin(h)], fwd = [Math.sin(h), 0, Math.cos(h)];
        const rel = [b[s].ball[0] - b.pelvis[0], 0, b[s].ball[2] - b.pelvis[2]], lat = -dot(rel, right) * side, ahead = dot(rel, fwd);
        const p = F[Math.max(0, i - 3)], v = [(b[s].ball[0] - p[s].ball[0]) / (3 * DT), (b[s].ball[2] - p[s].ball[2]) / (3 * DT)], vf = v[0] * fwd[0] + v[1] * fwd[2];
        const vy = (b[s].ball[1] - p[s].ball[1]) / (3 * DT);
        // (through the stance that follows: the knee at its deepest, the slip, how long)
        let j = i, kneeMax = 0, slip = 0; while (j < F.length && F[j][s].planted) { kneeMax = Math.max(kneeMax, F[j][s].knee); if (j > i) slip += Math.hypot(F[j][s].ball[0] - F[j - 1][s].ball[0], F[j][s].ball[2] - F[j - 1][s].ball[2]); j++; }
        // (the swing after: the knee at its deepest, the foot's highest above the ground)
        let k = j, swingKnee = 0, lift = 0, cross = 1; while (k < F.length && !F[k][s].planted) { swingKnee = Math.max(swingKnee, F[k][s].knee); lift = Math.max(lift, F[k][s].ball[1] - F[k][s].groundY); const hk = F[k].heading, rk = [-Math.cos(hk), 0, Math.sin(hk)]; cross = Math.min(cross, -((F[k][s].ball[0] - F[k].pelvis[0]) * rk[0] + (F[k][s].ball[2] - F[k].pelvis[2]) * rk[2]) * side); k++; }
        // (the foot's angle just before it lands; the jump of the foot in the frame it plants, beyond what its motion explains
        // (a snap onto the footfall); the heel rising before push-off: the most toe-down the sole gets late in the stance)
        const pre = F[Math.max(0, i - 4)][s].pitch, q = F[i - 2] ?? a, step = Math.hypot(b[s].ball[0] - a[s].ball[0], b[s].ball[1] - a[s].ball[1], b[s].ball[2] - a[s].ball[2]), was = Math.hypot(a[s].ball[0] - q[s].ball[0], a[s].ball[1] - q[s].ball[1], a[s].ball[2] - q[s].ball[2]);
        let heel = 0; { let e = i; while (e < F.length && F[e][s].planted) e++; for (let g = Math.floor(i + (e - i) * 0.6); g < e; g++) heel = Math.min(heel, F[g][s].pitch); }
        steps.push({ t: +b.t.toFixed(3), lat, ahead, swingLat: cross, kneeTD: b[s].knee, pitch: pre, ground: vf, snap: Math.max(0, step - was), heel: -heel, vdown: vy, stance: (j - i) * DT, kneeStance: kneeMax, slip, swingKnee, lift, speed: b.speed });
        falls.push({ s, t: b.t, x: b[s].ball[0], z: b[s].ball[2], lat });
      }
    }
    out.feet[s] = steps;
  }
  // (the hips: side to side off the smoothed path, and up and down, over the run)
  if (run.length > 30) {
    const lat = [], ys = [];
    for (let i = 15; i < run.length - 15; i++) {
      const w = run.slice(i - 15, i + 15), cx = w.reduce((s, f) => s + f.pelvis[0], 0) / w.length, cz = w.reduce((s, f) => s + f.pelvis[2], 0) / w.length, cy = w.reduce((s, f) => s + f.pelvis[1], 0) / w.length;
      const h = run[i].heading, right = [-Math.cos(h), 0, Math.sin(h)];
      lat.push((run[i].pelvis[0] - cx) * right[0] + (run[i].pelvis[2] - cz) * right[2]); ys.push(run[i].pelvis[1] - cy);
    }
    const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    out.hips = { swayRms: rms(lat), swayPeak: Math.max(...lat.map(Math.abs)), bobPeakToPeak: Math.max(...ys) - Math.min(...ys) };
  }
  out.falls = falls;
  return out;
}
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
/** typical running, for comparison (jog to fast run): from the gait literature, rounded */
const REF = {
  kneeTD: [10, 25, 'knee bend as the foot lands (°)'], kneeStance: [35, 50, 'knee bend at its deepest under load (°)'], swingKnee: [80, 130, 'knee bend at its deepest in the swing (°; more with speed)'],
  swingLat: [-0.03, 0.1, 'swing foot nearest the far side of the line in its swing (m; below 0 sweeps across behind the other leg)'],
  lat: [-0.02, 0.08, 'footfall across the line, toward its own side (m; below 0 crosses over)'], ahead: [-0.05, 0.3, 'footfall ahead of the hips (m)'], pitch: [-12, 15, 'sole just before touchdown (°; + toe up, a heel strike; − toe down, the forefoot)'],
  ground: [-0.5, 2.5, 'foot\'s speed along the ground as it lands (m/s; pawed back, near still: a foot still flying forward is a stamp)'],
  snap: [0, 0.02, 'the foot\'s jump in the frame it plants, beyond its motion (m: a snap onto the footfall)'],
  heel: [15, 40, 'heel raised before push-off: the sole\'s most toe-down late in the stance (°)'],
  stanceDuty: [0.3, 0.45, 'share of a stride a foot is down (duty factor)'], lift: [0.15, 0.6, 'swing foot\'s highest above the ground (m)'],
};
const rows = [];
const films = [];
mkdirSync(OUT, { recursive: true });
for (const key of KEYS) {
  const sc = M.sceneByKey(key); if (!sc) { console.log(`no scene ${key}`); continue; }
  const F = record(sc), m = measure(F), all = [...m.feet.L, ...m.feet.R];
  const sum = (k) => ({ mean: mean(all.map((x) => x[k])), sd: sd(all.map((x) => x[k])), L: mean(m.feet.L.map((x) => x[k])), R: mean(m.feet.R.map((x) => x[k])) });
  const strideT = mean(m.feet.L.slice(1).map((x, i) => x.t - m.feet.L[i].t)), duty = mean(all.map((x) => x.stance)) / strideT;
  const r = { key, speed: m.speed, steps: all.length, strideT, duty, hips: m.hips, crossings: all.filter((x) => x.lat < -0.01).length };
  for (const k of ['kneeTD', 'kneeStance', 'swingKnee', 'lat', 'swingLat', 'ahead', 'pitch', 'ground', 'snap', 'heel', 'lift', 'slip', 'vdown']) r[k] = sum(k);
  rows.push(r);
  const f2 = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : '—');
  console.log(`\n${key}: ${all.length} footfalls at ${f2(m.speed, 1)} m/s, stride ${f2(strideT)} s, duty ${f2(duty)}; crossings ${r.crossings}; hips sway rms ${f2((m.hips?.swayRms ?? NaN) * 100, 1)} cm (peak ${f2((m.hips?.swayPeak ?? NaN) * 100, 1)}), bob ${f2((m.hips?.bobPeakToPeak ?? NaN) * 100, 1)} cm`);
  for (const k of ['kneeTD', 'kneeStance', 'swingKnee', 'lat', 'swingLat', 'ahead', 'pitch', 'ground', 'snap', 'heel', 'lift']) {
    const v = r[k], ref = REF[k], bad = ref && (v.mean < ref[0] || v.mean > ref[1]);
    console.log(`  ${bad ? '✗' : '✓'} ${k.padEnd(10)} ${f2(v.mean).padStart(7)} ±${f2(v.sd)}  (L ${f2(v.L)}, R ${f2(v.R)})${ref ? `  typical ${ref[0]}…${ref[1]}: ${ref[2]}` : ''}`);
  }
  // (charts: the knees over time with each foot's stance shaded; the feet's heights; the footfalls from above)
  const t0 = F[0].t, t1 = F[F.length - 1].t, W = 900, H = 150, X = (t) => ((t - t0) / (t1 - t0)) * W;
  const path = (get, y0, y1) => F.map((f, i) => `${i ? 'L' : 'M'}${X(f.t).toFixed(1)},${(H - ((get(f) - y0) / (y1 - y0)) * H).toFixed(1)}`).join('');
  const shade = (s, cls) => { const o = []; let a = null; F.forEach((f, i) => { if (f[s].planted && a === null) a = f.t; if ((!f[s].planted || i === F.length - 1) && a !== null) { o.push(`<rect class="${cls}" x="${X(a)}" y="0" width="${Math.max(1, X(f.t) - X(a))}" height="${H}"/>`); a = null; } }); return o.join(''); };
  const svgKnees = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${key}: knee bend over time, left and right">${shade('L', 'sl')}${shade('R', 'sr')}<path class="l" d="${path((f) => f.L.knee, 0, 140)}"/><path class="r" d="${path((f) => f.R.knee, 0, 140)}"/></svg>`;
  const svgFeet = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${key}: each foot's height above the ground, and the hips' height">${shade('L', 'sl')}${shade('R', 'sr')}<path class="l" d="${path((f) => f.L.ball[1] - f.L.groundY, -0.05, 1.0)}"/><path class="r" d="${path((f) => f.R.ball[1] - f.R.groundY, -0.05, 1.0)}"/><path class="h" d="${path((f) => f.pelvis[1] - f.L.groundY - 0.4, -0.05, 1.0)}"/></svg>`;
  const xs = m.falls.map((f) => f.x), zs = m.falls.map((f) => f.z), cx = mean(xs), z0 = Math.min(...zs, 0), z1 = Math.max(...zs, 1);
  const svgFalls = `<svg viewBox="0 0 ${W} 120" role="img" aria-label="${key}: footfalls from above along the run, left feet and right">${m.falls.map((f) => `<circle class="${f.s === 'L' ? 'l' : 'r'}f" cx="${(((f.z - z0) / (z1 - z0)) * (W - 20) + 10).toFixed(1)}" cy="${(60 - (f.x - cx) * 300).toFixed(1)}" r="4"/>`).join('')}<line class="mid" x1="0" y1="60" x2="${W}" y2="60"/></svg>`;
  r.svg = { knees: svgKnees, feet: svgFeet, falls: svgFalls };
  // (the moments to film: a stretch of steady running; and the scene's own events)
  const steady = m.feet.L[Math.min(2, m.feet.L.length - 1)]?.t ?? 1;
  films.push({ key, t: Math.max(0, steady - 0.05), label: 'a stride, steady' });
}
writeFileSync(OUT + 'report.json', JSON.stringify(rows.map(({ svg, ...r }) => r), null, 1));

if (film) {
  process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
  const { withWood } = await import('./harness.mjs');
  await withWood(async (w) => {
    for (const fl of films) for (const [view, extra] of [['side', '&side=90&zoom=1.7'], ['behind', '&side=0&zoom=1.7'], ['front', '&side=180&zoom=1.7']]) {
      const file = `${fl.key}-${view}.png`, p = await w.open(`scene=${fl.key}${process.env.MOCAP === '0' ? '&mocap=0' : ''}&strip=${fl.t.toFixed(4)}&frames=16&every=0.025&cols=8&holds=0&marks=0&look=clay${extra}`, { width: 1600, height: 520, dpr: 1 });
      for (let k = 0; k < 80 && (await p.evaluate(() => window.__roofjumps.probe().pending)) > 0; k++) await p.waitForTimeout(250);
      await p.waitForTimeout(500); await p.screenshot({ path: OUT + file }); await p.close(); fl[view] = file; console.log(`filmed ${fl.key} ${view}`);
    }
  });
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const f2 = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : '—');
writeFileSync(OUT + 'report.html', `<title>Roof Jumps Legs</title>
<style>
:root { --bg: #f2f1ee; --panel: #fbfbfa; --ink: #1d1d1b; --muted: #66645e; --rule: #d8d6d0; --l: #2f6fb0; --r: #c4561f; --bad: #b3261e; --ok: #2e7d32; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #161615; --panel: #1f1f1d; --ink: #ebeae6; --muted: #a3a19a; --rule: #34332f; --l: #6aa6e6; --r: #f08a55; --bad: #ff8a80; --ok: #81c784; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #161615; --panel: #1f1f1d; --ink: #ebeae6; --muted: #a3a19a; --rule: #34332f; --l: #6aa6e6; --r: #f08a55; --bad: #ff8a80; --ok: #81c784; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; padding: 24px 16px 48px; max-width: 1640px; }
h1 { font-size: 1.6rem; margin: 0 0 6px; } h2 { font-size: 1.15rem; margin: 36px 0 8px; } .lede { color: var(--muted); max-width: 85ch; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; margin: 8px 0; } th, td { padding: 4px 10px; border-bottom: 1px solid var(--rule); text-align: right; } th:first-child, td:first-child { text-align: left; }
td.bad { color: var(--bad); font-weight: 600; } td.ok { color: var(--ok); }
svg { width: 100%; height: auto; background: var(--panel); border: 1px solid var(--rule); border-radius: 4px; margin: 4px 0; display: block; }
svg .l, svg .r, svg .h { fill: none; stroke-width: 1.6; } svg .l { stroke: var(--l); } svg .r { stroke: var(--r); } svg .h { stroke: var(--muted); stroke-dasharray: 3 3; }
svg .sl { fill: var(--l); opacity: 0.1; } svg .sr { fill: var(--r); opacity: 0.1; } svg .lf { fill: var(--l); } svg .rf { fill: var(--r); } svg .mid { stroke: var(--muted); stroke-dasharray: 4 4; }
img { width: 100%; display: block; border-radius: 4px; margin: 4px 0; } .k { color: var(--muted); font-size: 0.85rem; } .key b { color: var(--l); } .key i { color: var(--r); font-style: normal; font-weight: 600; }
</style>
<h1>Roof Jumps legs, measured and filmed</h1>
<p class="lede">Each scene run as the page runs it, the rig's bones every 1/120 s, the legs measured footfall by footfall on the ground at speed and set against typical running (red: outside it). With the strips from the side, from behind and from in front, every 1/40 s, zoomed to the legs. <span class="key"><b>left</b> and <i>right</i> legs; shading, each foot's time on the ground; dashed, the hips.</span> Re-run: <code>node cells/lab/devtools/roofjumps-legs.mjs --film</code>.</p>
${rows.map((r) => `<h2>${esc(r.key)} <span class="k">${f2(r.speed, 1)} m/s · ${r.steps} footfalls · stride ${f2(r.strideT)} s · duty ${f2(r.duty)} · crossings ${r.crossings} · hips sway ${f2((r.hips?.swayRms ?? NaN) * 100, 1)} cm rms, bob ${f2((r.hips?.bobPeakToPeak ?? NaN) * 100, 1)} cm</span></h2>
<table><thead><tr><th>measure</th><th>mean</th><th>± sd</th><th>left</th><th>right</th><th>typical</th></tr></thead><tbody>
${Object.entries(REF).filter(([k]) => r[k]).map(([k, ref]) => { const v = r[k], bad = v.mean < ref[0] || v.mean > ref[1]; return `<tr><td>${esc(ref[2])}</td><td class="${bad ? 'bad' : 'ok'}">${f2(v.mean)}</td><td>${f2(v.sd)}</td><td>${f2(v.L)}</td><td>${f2(v.R)}</td><td>${ref[0]} … ${ref[1]}</td></tr>`; }).join('')}
</tbody></table>
<p class="k">Knee bend over time (0 straight, top 140°)</p>${r.svg.knees}
<p class="k">Each foot's height above the ground (0 to 1 m), and the hips (dashed)</p>${r.svg.feet}
<p class="k">Footfalls from above, along the run (the dashed line: the run's middle; across exaggerated ×3)</p>${r.svg.falls}
${(() => { const fl = films.find((x) => x.key === r.key); return fl && fl.side ? `<p class="k">${esc(fl.label)}, from ${f2(fl.t)} s, every 1/40 s: from the side, from behind, from in front</p><img src="${fl.side}" alt="${esc(r.key)} from the side"><img src="${fl.behind}" alt="${esc(r.key)} from behind"><img src="${fl.front}" alt="${esc(r.key)} from in front">` : ''; })()}`).join('\n')}`);
console.log(`→ ${OUT}report.html`);
