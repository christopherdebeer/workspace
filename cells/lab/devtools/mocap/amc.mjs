// CMU ASF/AMC reader and forward kinematics, and the same leg measures as devtools/roofjumps-legs.mjs, to see whether
// the data is usable and what real gait looks like by the numbers we've been using.
//   node amc.mjs <subject.asf> <clip.amc>... [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
const deg = Math.PI / 180;
const mm = (a, b) => { const o = new Array(9).fill(0); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]; return o; };
const mv = (a, v) => [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]];
const tr = (a) => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
const rx = (t) => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const ry = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rz = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
/** rotations about fixed X, then Y, then Z (ASF "XYZ") */
const eul = (x, y, z) => mm(rz(z * deg), mm(ry(y * deg), rx(x * deg)));

export function readAsf(text) {
  const lines = text.split('\n').map((l) => l.trim()), bones = { root: { name: 'root', dir: [0, 0, 0], len: 0, axis: [0, 0, 0], dof: [], children: [] } };
  let unit = 1, i = 0, cur = null, sec = '';
  for (; i < lines.length; i++) {
    const l = lines[i]; if (!l || l.startsWith('#')) continue;
    if (l.startsWith(':')) { sec = l.split(/\s+/)[0]; continue; }
    const w = l.split(/\s+/);
    if (sec === ':units' && w[0] === 'length') unit = +w[1];
    if (sec === ':root' && w[0] === 'order') bones.root.order = w.slice(1).map((s) => s.toLowerCase());
    if (sec === ':root' && w[0] === 'axis') bones.root.axisOrder = w[1];
    if (sec === ':bonedata') {
      if (w[0] === 'begin') cur = { dir: [0, 0, 0], len: 0, axis: [0, 0, 0], dof: [], children: [] };
      else if (w[0] === 'name') cur.name = w[1];
      else if (w[0] === 'direction') cur.dir = w.slice(1, 4).map(Number);
      else if (w[0] === 'length') cur.len = +w[1];
      else if (w[0] === 'axis') cur.axis = w.slice(1, 4).map(Number);
      else if (w[0] === 'dof') cur.dof = w.slice(1).map((s) => s.toLowerCase());
      else if (w[0] === 'end') bones[cur.name] = cur;
    }
    if (sec === ':hierarchy' && w[0] !== 'begin' && w[0] !== 'end') for (const c of w.slice(1)) { bones[w[0]].children.push(c); bones[c].parent = w[0]; }
  }
  // (lengths to metres: CMU's are inches scaled by the file's `length`)
  const toM = 0.0254 / unit;
  for (const b of Object.values(bones)) { b.len *= toM; b.C = eul(...b.axis); b.Ci = tr(b.C); }
  return { bones, toM };
}
export function readAmc(text) {
  const frames = []; let f = null;
  for (const raw of text.split('\n')) {
    const l = raw.trim(); if (!l || l.startsWith('#') || l.startsWith(':')) continue;
    if (/^\d+$/.test(l)) { f = {}; frames.push(f); continue; }
    const w = l.split(/\s+/); f[w[0]] = w.slice(1).map(Number);
  }
  return frames;
}
/** every joint's end in world space for one frame (y up, metres) */
export function pose(sk, fr) {
  const { bones, toM } = sk, out = {}, R = {};
  const r = fr.root, o = bones.root.order, val = (k) => r[o.indexOf(k)] ?? 0;
  R.root = mm(bones.root.C, mm(eul(val('rx'), val('ry'), val('rz')), bones.root.Ci));
  out.root = [val('tx') * toM, val('ty') * toM, val('tz') * toM];
  const walk = (name) => {
    for (const c of bones[name].children) {
      const b = bones[c], m = fr[c] ?? [], a = { rx: 0, ry: 0, rz: 0 }; b.dof.forEach((d, k) => (a[d] = m[k] ?? 0));
      R[c] = mm(R[name], mm(b.C, mm(eul(a.rx, a.ry, a.rz), b.Ci)));
      const d = mv(R[c], b.dir); out[c] = [out[name][0] + d[0] * b.len, out[name][1] + d[1] * b.len, out[name][2] + d[2] * b.len];
      walk(c);
    }
  };
  walk('root');
  return out;
}

/** the leg measures, from joint positions alone (120 fps) */
export function measure(P) {
  const DT = 1 / 120, n = P.length, ground = Math.min(...P.flatMap((p) => [p.ltoes[1], p.rtoes[1], p.lfoot[1], p.rfoot[1]]));
  const knee = (p, s) => { const h = p[s + 'femur'], hip = p[s === 'l' ? 'lhipjoint' : 'rhipjoint'], a = p[s + 'tibia']; const u = [hip[0] - h[0], hip[1] - h[1], hip[2] - h[2]], v = [a[0] - h[0], a[1] - h[1], a[2] - h[2]]; const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v)); return 180 - Math.acos(Math.max(-1, Math.min(1, c))) / deg; };
  const ball = (p, s) => p[s + 'foot'];
  const speedOf = (i) => { const a = P[Math.max(0, i - 6)].root, b = P[Math.min(n - 1, i + 6)].root; return Math.hypot(b[0] - a[0], b[2] - a[2]) / ((Math.min(n - 1, i + 6) - Math.max(0, i - 6)) * DT); };
  // (a foot down: its ball near the ground and nearly still)
  const down = (i, s) => { const b = ball(P[i], s), q = ball(P[Math.max(0, i - 1)], s); return b[1] - ground < 0.06 && Math.hypot(b[0] - q[0], b[2] - q[2]) / DT < 0.6; };
  const steps = [];
  for (const s of ['l', 'r']) for (let i = 2; i < n; i++) if (down(i, s) && !down(i - 1, s) && !down(i - 2, s)) {
    let j = i; while (j < n && down(j, s)) j++;
    const p = P[i], fwdV = [P[Math.min(n - 1, i + 6)].root[0] - P[Math.max(0, i - 6)].root[0], P[Math.min(n - 1, i + 6)].root[2] - P[Math.max(0, i - 6)].root[2]], fl = Math.hypot(...fwdV) || 1;
    const rel = [ball(p, s)[0] - p.root[0], ball(p, s)[2] - p.root[2]], ahead = (rel[0] * fwdV[0] + rel[1] * fwdV[1]) / fl;
    const pre = P[Math.max(0, i - 3)], gv = Math.hypot(ball(p, s)[0] - ball(pre, s)[0], ball(p, s)[2] - ball(pre, s)[2]) / (3 * DT);
    let kmax = 0; for (let k = i; k < j; k++) kmax = Math.max(kmax, knee(P[k], s));
    steps.push({ s, t: i * DT, speed: speedOf(i), kneeTD: knee(p, s), kneeStance: kmax, ahead, ground: gv, stance: (j - i) * DT });
  }
  steps.sort((a, b) => a.t - b.t);
  const strides = steps.filter((x) => x.s === 'l').map((x) => x.t), strideT = strides.length > 1 ? (strides.at(-1) - strides[0]) / (strides.length - 1) : NaN;
  const hip = P.map((p) => p.root[1]), bob = (() => { const m = []; for (let i = 30; i < n - 30; i++) { const w = hip.slice(i - 30, i + 30); m.push(hip[i] - w.reduce((a, b) => a + b, 0) / w.length); } return m.length ? Math.max(...m) - Math.min(...m) : NaN; })();
  const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  return { seconds: n * DT, speed: mean(steps.map((x) => x.speed)), steps: steps.length, strideT, duty: mean(steps.map((x) => x.stance)) / strideT, kneeTD: mean(steps.map((x) => x.kneeTD)), kneeStance: mean(steps.map((x) => x.kneeStance)), ahead: mean(steps.map((x) => x.ahead)), ground: mean(steps.map((x) => x.ground)), bob };
}

if (process.argv[1].endsWith('amc.mjs')) {
  const args = process.argv.slice(2), jsonAt = args.indexOf('--json'), json = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
  const sk = readAsf(readFileSync(args[0], 'utf8')), dump = {};
  for (const f of args.slice(1)) {
    const P = readAmc(readFileSync(f, 'utf8')).map((fr) => pose(sk, fr)), m = measure(P);
    console.log(f.split('/').pop().padEnd(12), Object.entries(m).map(([k, v]) => `${k} ${typeof v === 'number' ? v.toFixed(2) : v}`).join('  '));
    if (json) dump[f.split('/').pop()] = P.filter((_, i) => i % 4 === 0).map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.map((x) => +x.toFixed(3))])));
  }
  if (json) writeFileSync(json, JSON.stringify(dump));
}
