// Gestures as a hand might make them, for reading intent (node cells/lab/devtools/labyrinth-intent.mjs --out=DIR):
// on several seeds of land (and the bare stone), random organic strokes (taps, sweeps, loops, meanders, strokes with a
// pause, strokes from a top), each pictured twice: before, with the stroke drawn over the world as the hand
// will make it (start ring, end arrow, pauses dotted) and nothing built yet; and after, let go and settled. And a log of what each was read as. The before picture is for guessing the
// intent from; the after, for comparing.
//   --cases=a,b   just these (by name)   --n=3   gestures per case
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'labyrinth';
process.env.READY = '__labyrinth';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
const OUT = opt.out ?? 'intent-out';
mkdirSync(OUT, { recursive: true });
const N = Number(opt.n) || 3;

const CASES = [
  { name: 'land3', q: 'land=3&zoom=0.62', seed: 31 },
  { name: 'land5', q: 'land=5&zoom=0.62&turn=1', seed: 52 },
  { name: 'land8', q: 'land=8&zoom=0.62', seed: 83 },
  { name: 'land11', q: 'land=11&zoom=0.62&turn=2', seed: 114, intent: 'mass' },
  { name: 'stone', q: 'ops=[]&zoom=0.55', seed: 7 },
  { name: 'story12', q: 'story=12&zoom=0.62', seed: 12 },
].filter((c) => !opt.cases || opt.cases.split(',').includes(c.name));

const rng = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SAFE = { x0: 24, x1: 406, y0: 120, y1: 730 };
const safe = ([x, y]) => x > SAFE.x0 && x < SAFE.x1 && y > SAFE.y0 && y < SAFE.y1;
/** a smooth curve through the points (Catmull-Rom), n samples a span */
const spline = (P, n = 14) => {
  const out = [];
  for (let s = 0; s < P.length - 1; s++) {
    const p0 = P[Math.max(0, s - 1)], p1 = P[s], p2 = P[s + 1], p3 = P[Math.min(P.length - 1, s + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  out.push(P[P.length - 1]);
  return out;
};

await withWood(async (lab) => {
  const log = [];
  for (const cs of CASES) {
    const R = rng(cs.seed);
    const p = await lab.open(cs.q, { width: 430, height: 900 });
    await p.evaluate(() => { try { localStorage.removeItem('labyrinth.intent'); } catch { /* */ } });
    await p.waitForTimeout(2500);
    if (cs.intent) { await p.evaluate((i) => window.__labyrinth.setIntent(i), cs.intent); await p.waitForTimeout(300); }
    // (the view settled: nothing gliding under the hand when the picture's taken)
    // (and drawn: frames counted by the guide layer's clearing, once a frame; a slow (software) renderer can take
    // seconds over one after a build, and a picture taken before then shows the last one)
    await p.evaluate(() => { const C = CanvasRenderingContext2D.prototype, cr = C.clearRect; window.__frames = 0; C.clearRect = function (...a) { window.__frames++; return cr.apply(this, a); }; });
    const frames = async (n) => { const f0 = await p.evaluate(() => window.__frames); for (let t = 0; t < 240; t++) { await p.waitForTimeout(250); if ((await p.evaluate(() => window.__frames)) - f0 >= n) return; } };
    const settle = async () => { let a = null; for (let t = 0; t < 60; t++) { await frames(2); const b = await p.evaluate(() => window.__labyrinth.screenOf(0, 0, 0)); if (a && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.3) return; a = b; } };
    for (let n = 1; n <= N; n++) {
      await settle();
      // (what's there to touch: each cell's top, where it is on the screen)
      const cells = await p.evaluate(() => {
        const L = window.__labyrinth, w = L.world, e = w.extent(), out = [];
        for (let i = e.i0; i <= e.i1; i++) for (let j = e.j0; j <= e.j1; j++) {
          const g = w.ground(i, j); let k = g; while (w.stone(k, i, j) || w.stair(k, i, j) >= 0) k++;
          out.push({ i, j, g, top: k, built: k > g, s: L.screenOf(i, j, k) });
        }
        return out;
      });
      const ok = cells.filter((c) => safe(c.s)), built = ok.filter((c) => c.built);
      const pickC = (from = ok) => from[Math.floor(R() * from.length)];
      const near = (c, d0, d1) => ok.filter((q) => { const d = Math.hypot(q.i - c.i, q.j - c.j); return d >= d0 && d <= d1; });
      // (the kind of gesture: weighted, and from a top only if there's one)
      const kinds = [['tap', 2], ['sweep', 3], ['meander', 1.5], ['loop', 1.5], ['pause', 1], ...(built.length ? [['tapTop', 1.5], ['fromTop', 2.5]] : [])];
      let r = R() * kinds.reduce((a, k) => a + k[1], 0), kind = kinds[0][0];
      for (const [k, wgt] of kinds) { if ((r -= wgt) <= 0) { kind = k; break; } }
      let pts = [], pauses = [], tap = null, desc = '';
      const jitter = (s, a) => [s[0] + (R() - 0.5) * a, s[1] + (R() - 0.5) * a];
      if (kind === 'tap' || kind === 'tapTop') {
        const c = pickC(kind === 'tapTop' ? built : ok); tap = jitter(c.s, 10); desc = `tap at ${c.i},${c.j}`;
      } else if (kind === 'loop') {
        const c = pickC(ok), rad = 1.6 + R() * 1.6, m = 7, a0 = R() * 6.28, close = R() < 0.6 ? 0.95 + R() * 0.12 : 0.8;
        const ring = [];
        for (let q = 0; q <= m; q++) { const a = a0 + (q / m) * 6.28 * close, rr = rad * (0.8 + R() * 0.4); ring.push(await p.evaluate(([i, j, y]) => window.__labyrinth.screenOf(i, j, y), [c.i + Math.cos(a) * rr, c.j + Math.sin(a) * rr, c.top])); }
        pts = spline(ring, 8); desc = `loop round ${c.i},${c.j} r~${rad.toFixed(1)} ${close >= 0.95 ? 'closed' : 'left open'}`;
      } else {
        const a = kind === 'fromTop' ? pickC(built) : pickC(ok);
        const far = near(a, kind === 'meander' ? 4 : 2.5, kind === 'meander' ? 9 : 7);
        const b = far.length ? pickC(far) : pickC(ok);
        const A = a.s, B = b.s, L = Math.hypot(B[0] - A[0], B[1] - A[1]), nx = -(B[1] - A[1]) / (L || 1), ny = (B[0] - A[0]) / (L || 1);
        const mids = kind === 'meander' ? 3 : 1 + (R() < 0.5 ? 1 : 0), ctl = [A];
        for (let q = 1; q <= mids; q++) { const t = q / (mids + 1), off = (R() - 0.5) * L * (kind === 'meander' ? 0.5 : 0.22); ctl.push([A[0] + (B[0] - A[0]) * t + nx * off, A[1] + (B[1] - A[1]) * t + ny * off]); }
        ctl.push(B);
        pts = spline(ctl, 10);
        if (kind === 'pause') pauses = [Math.floor(pts.length * (0.35 + R() * 0.3))];
        desc = `${kind} from ${a.i},${a.j} (top ${a.top}) to ${b.i},${b.j} (top ${b.top})`;
      }
      // (a hand's tremor, and kept on the screen)
      pts = pts.map((s, q) => [Math.min(SAFE.x1, Math.max(SAFE.x0, s[0] + Math.sin(q * 1.7 + R()) * 1.2)), Math.min(SAFE.y1, Math.max(SAFE.y0, s[1] + Math.cos(q * 1.3 + R()) * 1.2))]);
      const id = `${cs.name}-${n}`, f = (s) => join(OUT, `${id}-${s}.jpg`);
      // (before: the world, and the stroke over it as it will be made)
      await p.evaluate(({ pts, tap, pauses }) => {
        const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
        svg.id = 'intent-overlay'; svg.setAttribute('style', 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:99');
        const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
        if (tap) { el('circle', { cx: tap[0], cy: tap[1], r: 9, fill: 'none', stroke: '#c0392b', 'stroke-width': 2.5 }); el('circle', { cx: tap[0], cy: tap[1], r: 2.5, fill: '#c0392b' }); }
        else {
          el('polyline', { points: pts.map((q) => q.join(',')).join(' '), fill: 'none', stroke: '#c0392b', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.85 });
          el('circle', { cx: pts[0][0], cy: pts[0][1], r: 7, fill: '#fff', stroke: '#c0392b', 'stroke-width': 2.5 });
          const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          el('polygon', { points: [[12, 0], [-6, -7], [-6, 7]].map(([x, y]) => [b[0] + x * Math.cos(ang) - y * Math.sin(ang), b[1] + x * Math.sin(ang) + y * Math.cos(ang)].join(',')).join(' '), fill: '#c0392b' });
          for (const q of pauses) { el('circle', { cx: pts[q][0], cy: pts[q][1], r: 6, fill: '#c0392b' }); el('circle', { cx: pts[q][0], cy: pts[q][1], r: 11, fill: 'none', stroke: '#c0392b', 'stroke-dasharray': '3 3' }); }
        }
        document.body.appendChild(svg);
      }, { pts, tap, pauses });
      await p.screenshot({ path: f('a-before'), type: 'jpeg', quality: 80 });
      await p.evaluate(() => document.getElementById('intent-overlay')?.remove());
      const ops0 = await p.evaluate(() => window.__labyrinth.world.ops.length);
      let during = null;
      if (tap) { await p.mouse.click(tap[0], tap[1]); }
      else {
        await p.mouse.move(pts[0][0], pts[0][1]); await p.mouse.down();
        const pace = 8 + R() * 14;
        for (let q = 1; q < pts.length; q++) {
          await p.mouse.move(pts[q][0], pts[q][1]);
          await p.waitForTimeout(pace * (0.6 + 0.8 * Math.sin((q / pts.length) * Math.PI)));
          if (pauses.includes(q)) await p.waitForTimeout(560);
        }
        await p.waitForTimeout(60);
        during = await p.evaluate(() => ({ hint: document.getElementById('hint')?.textContent ?? '', fan: window.__labyrinth.fan() }));
        await p.mouse.up();
      }
      await p.waitForTimeout(400);
      const said = await p.evaluate(() => document.getElementById('hint')?.textContent ?? '');
      await p.waitForTimeout(1500); await frames(3); await settle();
      await p.screenshot({ path: f('c-after'), type: 'jpeg', quality: 80 });
      const res = await p.evaluate((ops0) => { const L = window.__labyrinth, w = L.world; return { built: w.ops.length > ops0, why: w.ops.slice(ops0).map((o) => o.why ?? ''), rests: w.ops.slice(ops0).map((o) => o.connect?.rest?.length ?? 0), note: w.ops.slice(ops0).map((o) => o.note ?? ''), alts: L.alts(), declines: L.declines().slice(-1), intent: L.intent }; }, ops0);
      const entry = { id, kind, desc, ...res, said, during, errors: p.errors.slice() };
      log.push(entry);
      console.log(`${id.padEnd(10)} ${desc.padEnd(52)} → ${res.why.join(',') || '(nothing)'} · "${said}"`);
    }
    await p.close();
  }
  writeFileSync(join(OUT, 'log.json'), `${JSON.stringify(log, null, 1)}\n`);
});
