// Blind review workflow: see labyrinth-intent.md. Capture requires GL; review uses saved images only.
// Capture seeded gestures to a fresh directory, withholding outcomes from console and review packets.
// node cells/lab/devtools/labyrinth-intent.mjs --out=DIR --cases=land3,stone --n=3
// Then: node cells/lab/devtools/labyrinth-intent-review.mjs next DIR
// See labyrinth-intent.md for the expectation -> reveal -> delta critique workflow.
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { digest, writeJSON } from './labyrinth-intent-review.mjs';
import { join } from 'node:path';
process.env.EXPERIMENT = 'labyrinth';
process.env.READY = '__labyrinth';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
// Load the browser harness only for browser capture; headless mode has no GL dependencies.
if (opt.headless) {
  process.argv = [process.argv[0], new URL('./labyrinth-intent-headless.mjs', import.meta.url).pathname, String(opt.headless), String(opt.out ?? 'intent-headless'), ...(opt.spec ? [String(opt.spec)] : [])];
  await import('./labyrinth-intent-headless.mjs');
  process.exit(0);
}
const { withWood } = await import('./harness.mjs');
const OUT = opt.out ?? 'intent-out';
if (existsSync(OUT) && readdirSync(OUT).length) throw new Error('Use a fresh --out directory: never mix blind captures or overwrite reviews');
mkdirSync(OUT, { recursive: true });
const manifest = { schema: 'labyrinth-intent/2', createdAt: new Date().toISOString(), complete: false, ids: [], captureSourceHash: digest(readFileSync(new URL(import.meta.url))) };
writeJSON(join(OUT, 'manifest.json'), manifest, true);
writeFileSync(join(OUT, 'README.md'), '# Blind intent review\n\nDo not inspect sealed/ before committing expectations. It contains results and subsequent scenes which can reveal earlier outcomes.\n\nUse `node devtools/labyrinth-intent-review.mjs next OUT`, then expect, reveal, critique, next. The review CLI needs only Node and saved images; WebGL is needed only for capture.\n');
const N = opt.n === undefined ? 3 : Number(opt.n);
if (!Number.isInteger(N) || N < 1 || N > 100) throw new Error('--n must be an integer from 1 to 100');

const SETS = {};
SETS[1] = [
  { name: 'land3', q: 'land=3&zoom=0.62', seed: 31 },
  { name: 'land5', q: 'land=5&zoom=0.62&turn=1', seed: 52 },
  { name: 'land8', q: 'land=8&zoom=0.62', seed: 83 },
  { name: 'land11', q: 'land=11&zoom=0.62&turn=2', seed: 114, intent: 'mass' },
  { name: 'stone', q: 'ops=[]&zoom=0.55', seed: 7 },
  { name: 'story12', q: 'story=12&zoom=0.62', seed: 12 },
];
// (a second set, unseen by the first round's readings: other lands, the slope, and longer runs, so the later gestures
// are made on what the earlier ones built; --set=2)
SETS[2] = [
  { name: 'land4', q: 'land=4&zoom=0.62', seed: 41, n: 4 },
  { name: 'land9', q: 'land=9&zoom=0.62&turn=1', seed: 93, n: 4 },
  { name: 'land13', q: 'land=13&zoom=0.62', seed: 137, intent: 'mass', n: 4 },
  { name: 'flat', q: 'ops=[]&zoom=0.55', seed: 77, n: 5 },
  { name: 'story15', q: 'story=15&zoom=0.5', seed: 15, n: 3 },
];
// (a third, on the continuous hillside (stage 21 on): lands no earlier round has seen, each a run of gestures so the later
// ones are made on what the earlier built; three rounds, by --cases)
SETS[3] = [
  { name: 'land6', q: 'land=6&zoom=0.62', seed: 601, n: 3 },
  { name: 'land10', q: 'land=10&zoom=0.62&turn=1', seed: 1001, intent: 'mass', n: 3 },
  { name: 'land14', q: 'land=14&zoom=0.62&turn=2', seed: 1401, n: 3 },
  { name: 'land17', q: 'land=17&zoom=0.62', seed: 1701, n: 4 },
  { name: 'land19', q: 'land=19&zoom=0.62&turn=3', seed: 1901, intent: 'mass', n: 4 },
  { name: 'land22', q: 'land=22&zoom=0.62&turn=1', seed: 2201, n: 4 },
  { name: 'land25', q: 'land=25&zoom=0.62', seed: 2501, n: 4 },
];
// (a fourth, after the first fixes from set 3's reviews: lands again unseen, the same mix)
SETS[4] = [
  { name: 'land7', q: 'land=7&zoom=0.62', seed: 701, n: 3 },
  { name: 'land12', q: 'land=12&zoom=0.62&turn=1', seed: 1201, intent: 'mass', n: 3 },
  { name: 'land20', q: 'land=20&zoom=0.62&turn=2', seed: 2001, n: 3 },
  { name: 'land23', q: 'land=23&zoom=0.62&turn=3', seed: 2301, n: 4 },
  { name: 'land27', q: 'land=27&zoom=0.62', seed: 2701, intent: 'mass', n: 4 },
  { name: 'land29', q: 'land=29&zoom=0.62&turn=1', seed: 2901, n: 4 },
  { name: 'land31', q: 'land=31&zoom=0.62&turn=2', seed: 3101, n: 4 },
];
// (a fifth: intent first (after critique-001). Each gesture is drawn for an intent written down beforehand, from what
// the land offers (its stream, its slopes, what's been built), and that intent is sealed with it: the reviewer reads the
// gesture blind as before, then, the critique locked, is shown what it was drawn for. Two questions kept apart: did the
// gesture say it (legibility), and did the toy build it (interpretation). The view held still (`held`))
const AUTHORED = ['block', 'down-to-water', 'pair-a', 'pair-b', 'link', 'climb', 'cross', 'yard', 'winding'];
SETS[5] = [
  { name: 'land33', q: 'land=33&zoom=0.62&held', seed: 3301, script: AUTHORED },
  { name: 'land35', q: 'land=35&zoom=0.62&turn=1&held', seed: 3501, script: AUTHORED },
  { name: 'land37', q: 'land=37&zoom=0.62&turn=2&held', seed: 3701, script: AUTHORED },
  { name: 'land39', q: 'land=39&zoom=0.62&turn=3&held', seed: 3901, script: AUTHORED },
];
const INTENTS = {
  block: 'Raise a single block here.',
  'down-to-water': 'A way down from the top of the block I just raised to the water\'s edge.',
  'pair-a': 'Raise a block here, the first of two I mean to join.',
  'pair-b': 'Raise a second block here, at the same ground level, to be joined to the first.',
  link: 'A walkway joining the tops of the two blocks, at their height.',
  climb: 'A path up the slope from here to the higher ground where I stop.',
  cross: 'A way across the stream, from one bank to the other.',
  yard: 'A walled yard enclosing this patch of ground.',
  winding: 'A winding path on the ground that keeps the zigzags I drew.',
};
/** a gesture for an intent, from what the land offers now (null if it offers nowhere for it) */
function authored(recipe, cells, stream, mem, R) {
  const at = new Map(cells.map((c) => [`${c.i}.${c.j}`, c])), C = (i, j) => at.get(`${i}.${j}`);
  const clear = (c) => c && !c.wet && !c.built && [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].every(([a, b]) => !C(c.i + a, c.j + b)?.built);
  const wetD = (c) => Math.min(...cells.filter((q) => q.wet).map((q) => Math.abs(q.i - c.i) + Math.abs(q.j - c.j)), 99);
  const mid = (c) => Math.hypot(c.i - 5.5, c.j - 5.5);
  const shuffle = (xs) => xs.map((x) => [R(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const best = (xs, score) => shuffle(xs).sort((a, b) => score(a) - score(b))[0] ?? null;
  const line = (a, b, mids = 1, off = 0.1) => { const A = [a.i, a.j], B = [b.i, b.j], L = Math.hypot(B[0] - A[0], B[1] - A[1]), nx = -(B[1] - A[1]) / (L || 1), ny = (B[0] - A[0]) / (L || 1), ctl = [A]; for (let q = 1; q <= mids; q++) { const t = q / (mids + 1), o = (R() - 0.5) * off; ctl.push([A[0] + (B[0] - A[0]) * t + nx * o, A[1] + (B[1] - A[1]) * t + ny * o]); } ctl.push(B); return spline(ctl, 10); };
  const tapAt = (c) => ({ kind: c.built ? 'tapTop' : 'tap', wpts: [[c.i + (R() - 0.5) * 0.2, c.j + (R() - 0.5) * 0.2]], desc: `tap at ${c.i},${c.j}` });
  if (recipe === 'block') { const c = best(cells.filter((c) => clear(c) && wetD(c) >= 3 && wetD(c) <= 4), mid); if (!c) return null; mem.block = c; return tapAt(c); }
  if (recipe === 'down-to-water') {
    const b = mem.block && C(mem.block.i, mem.block.j); if (!b || !b.built) return null;
    const bank = best(cells.filter((c) => !c.wet && !c.built && wetD(c) === 1 && c.g < b.top), (c) => Math.hypot(c.i - b.i, c.j - b.j)); if (!bank) return null;
    return { kind: 'fromTop', wpts: line(b, bank), desc: `fromTop from ${b.i},${b.j} (top ${b.top}) to ${bank.i},${bank.j} (top ${bank.top})` };
  }
  if (recipe === 'pair-a') { const c = best(cells.filter((c) => clear(c) && wetD(c) >= 2 && cells.some((d) => clear(d) && d.g === c.g && wetD(d) >= 2 && Math.hypot(d.i - c.i, d.j - c.j) >= 3 && Math.hypot(d.i - c.i, d.j - c.j) <= 4)), mid); if (!c) return null; mem.x = c; return tapAt(c); }
  if (recipe === 'pair-b') { const x = mem.x; if (!x) return null; const c = best(cells.filter((d) => clear(d) && d.g === x.g && wetD(d) >= 2 && Math.hypot(d.i - x.i, d.j - x.j) >= 3 && Math.hypot(d.i - x.i, d.j - x.j) <= 4), mid); if (!c) return null; mem.y = c; return tapAt(c); }
  if (recipe === 'link') { const x = mem.x && C(mem.x.i, mem.x.j), y = mem.y && C(mem.y.i, mem.y.j); if (!x?.built || !y?.built) return null; return { kind: 'fromTop', wpts: line(x, y), desc: `fromTop from ${x.i},${x.j} (top ${x.top}) to ${y.i},${y.j} (top ${y.top})` }; }
  if (recipe === 'climb') {
    const pairs = []; for (const a of cells) if (clear(a)) for (const b of cells) { const d = Math.hypot(b.i - a.i, b.j - a.j); if (clear(b) && b.g - a.g >= 2 && d >= 4 && d <= 6) pairs.push([a, b]); }
    const pr = best(pairs, ([a, b]) => mid(a) + mid(b)); if (!pr) return null;
    return { kind: 'sweep', wpts: line(pr[0], pr[1], 1, 0.3), desc: `sweep from ${pr[0].i},${pr[0].j} (top ${pr[0].top}) to ${pr[1].i},${pr[1].j} (top ${pr[1].top})` };
  }
  if (recipe === 'cross') {
    const opts = [];
    for (const [si, sj] of stream) { const s = C(si, sj); if (!s) continue; for (const [a, b] of [[1, 0], [0, 1]]) {
      const ends = [-1, 1].map((sg) => { for (let k = 1; k <= 2; k++) { const c = C(si + a * sg * k, sj + b * sg * k); if (c && !c.wet) { const o = C(c.i + a * sg, c.j + b * sg); return o && !o.wet && !o.built ? o : null; } } return null; });
      if (ends[0] && ends[1]) opts.push(ends);
    } }
    const pr = best(opts, ([a, b]) => mid(a) + mid(b)); if (!pr) return null;
    return { kind: 'sweep', wpts: line(pr[0], pr[1], 1, 0.15), desc: `sweep from ${pr[0].i},${pr[0].j} (top ${pr[0].top}) to ${pr[1].i},${pr[1].j} (top ${pr[1].top})` };
  }
  if (recipe === 'yard') {
    const c = best(cells.filter((c) => { const ring = []; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) ring.push(C(c.i + a, c.j + b)); return ring.every(clear) && Math.max(...ring.map((q) => q.g)) - Math.min(...ring.map((q) => q.g)) <= 1; }), mid); if (!c) return null;
    const a0 = R() * 6.28, ring = []; for (let q = 0; q <= 8; q++) { const a = a0 + (q / 8) * 6.28 * 1.02; ring.push([c.i + Math.cos(a) * 1.7, c.j + Math.sin(a) * 1.7]); }
    return { kind: 'loop', wpts: spline(ring, 8), desc: `loop round ${c.i},${c.j} r~1.7 closed` };
  }
  if (recipe === 'winding') {
    const pairs = []; for (const a of cells) if (clear(a)) for (const b of cells) { const d = Math.hypot(b.i - a.i, b.j - a.j); if (clear(b) && Math.abs(b.g - a.g) <= 1 && d >= 5 && d <= 7) pairs.push([a, b]); }
    const pr = best(pairs, ([a, b]) => mid(a) + mid(b)); if (!pr) return null;
    const [a, b] = pr, L = Math.hypot(b.i - a.i, b.j - a.j), nx = -(b.j - a.j) / L, ny = (b.i - a.i) / L, ctl = [[a.i, a.j]];
    for (let q = 1; q <= 3; q++) { const t = q / 4, o = (q % 2 ? 1 : -1) * 1.3; ctl.push([a.i + (b.i - a.i) * t + nx * o, a.j + (b.j - a.j) * t + ny * o]); }
    ctl.push([b.i, b.j]);
    return { kind: 'meander', wpts: spline(ctl, 10), desc: `meander from ${a.i},${a.j} (top ${a.top}) to ${b.i},${b.j} (top ${b.top})` };
  }
  return null;
}
const CASES = (SETS[Number(opt.set) || 1] ?? []).filter((c) => !opt.cases || String(opt.cases).split(',').includes(c.name));
if (!CASES.length) throw new Error('No matching cases');

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
  // Outcomes remain in sealed/<id>; the review CLI exposes one gesture at a time.
  for (const cs of CASES) {
    const R = rng(cs.seed);
    const p = await lab.open(`${cs.q}&instant`, { width: 430, height: 900 });
    await p.evaluate(() => { try { localStorage.removeItem('labyrinth.intent'); } catch { /* */ } });
    await p.waitForTimeout(2500);
    if (cs.intent) { await p.evaluate((i) => window.__labyrinth.setIntent(i), cs.intent); await p.waitForTimeout(300); }
    // (the view settled: nothing gliding under the hand when the picture's taken)
    // (and drawn: frames counted as they're asked for (not by any canvas's clearing: other canvases clear too, and count
    // frames that never came); a slow (software) renderer can take seconds over one after a build, and a picture taken
    // before then shows the last one)
    await p.evaluate(() => { const raf = window.requestAnimationFrame.bind(window); window.__frames = 0; window.requestAnimationFrame = (f) => raf((t) => { window.__frames++; f(t); }); });
    const frames = async (n) => { const f0 = await p.evaluate(() => window.__frames); for (let t = 0; t < 240; t++) { await p.waitForTimeout(250); if ((await p.evaluate(() => window.__frames)) - f0 >= n) return; } throw new Error('Timed out waiting for rendered frames'); };
    const settle = async () => { let a = null; for (let t = 0; t < 60; t++) { await frames(2); const b = await p.evaluate(() => window.__labyrinth.screenOf(0, 0, 0)); if (a && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.3) return; a = b; } throw new Error('Timed out waiting for camera to settle'); };
    const mem = {};
    let made = 0;
    for (let n = 1; n <= (cs.script ? cs.script.length : opt.n === undefined ? cs.n ?? N : N); n++) {
      await settle();
      // (what's there to touch: each cell's top. Chosen, and the stroke made, in the room's own cells, not the screen's
      // pixels, so the same seed makes the same gestures however the view frames them; projected only to be made)
      const cells = await p.evaluate(() => {
        const L = window.__labyrinth, w = L.world, e = w.extent(), out = [];
        // (on land, the first piece of it: where the hand first looked)
        const b = w.land ? { i0: Math.max(e.i0, -1), i1: Math.min(e.i1, 12), j0: Math.max(e.j0, -1), j1: Math.min(e.j1, 12) } : e;
        for (let i = b.i0; i <= b.i1; i++) for (let j = b.j0; j <= b.j1; j++) {
          const g = w.ground(i, j); let k = g; while (w.stone(k, i, j) || w.stair(k, i, j) >= 0) k++;
          out.push({ i, j, g, top: k, built: k > g, wet: !!w.land?.water.has(j * 1000 + i) });
        }
        return out;
      });
      const topAt = new Map(cells.map((c) => [`${c.i}.${c.j}`, c.top]));
      const ok = cells, built = ok.filter((c) => c.built);
      if (!ok.length) throw new Error(`No gesture targets in ${cs.name}`);
      const pickC = (from = ok) => from[Math.floor(R() * from.length)];
      const near = (c, d0, d1) => ok.filter((q) => { const d = Math.hypot(q.i - c.i, q.j - c.j); return d >= d0 && d <= d1; });
      // (made again, the next way the seed goes, if it would run off the screen: a stroke must be made where it's drawn)
      let kind, wpts, pauses, tap, desc, pts, intentText = null;
      const stream = cs.script ? await p.evaluate(() => window.__labyrinth.world.land?.stream ?? []) : [];
      for (let attempt = 0; attempt < 8; attempt++) {
        if (cs.script) {
          const a = authored(cs.script[n - 1], cells, stream, mem, R);
          if (!a) { kind = null; break; }
          ({ kind, wpts } = a); desc = `authored ${cs.script[n - 1]}: ${a.desc}`; pauses = []; tap = null; intentText = INTENTS[cs.script[n - 1]];
          const proj = await p.evaluate((q) => q.map(([i, j, y]) => window.__labyrinth.screenOf(i, j, y)), wpts.map(([i, j]) => [i, j, topAt.get(`${Math.round(i)}.${Math.round(j)}`) ?? 0]));
          pts = proj.map((s, q) => [Math.min(SAFE.x1, Math.max(SAFE.x0, s[0] + Math.sin(q * 1.7 + R()) * 1.2)), Math.min(SAFE.y1, Math.max(SAFE.y0, s[1] + Math.cos(q * 1.3 + R()) * 1.2))]);
          if (proj.filter(([x, y]) => !safe([x, y])).length <= proj.length * 0.1) break;
          kind = null; continue;
        }
        // (the kind of gesture: weighted, and from a top only if there's one)
        const kinds = [['tap', 2], ['sweep', 3], ['meander', 1.5], ['loop', 1.5], ['pause', 1], ...(built.length ? [['tapTop', 1.5], ['fromTop', 2.5]] : [])];
        let r = R() * kinds.reduce((a, k) => a + k[1], 0); kind = kinds[0][0];
        for (const [k, wgt] of kinds) { if ((r -= wgt) <= 0) { kind = k; break; } }
        wpts = []; pauses = []; tap = null; desc = '';
        if (kind === 'tap' || kind === 'tapTop') {
          const c = pickC(kind === 'tapTop' ? built : ok); wpts = [[c.i + (R() - 0.5) * 0.4, c.j + (R() - 0.5) * 0.4]]; desc = `tap at ${c.i},${c.j}`;
        } else if (kind === 'loop') {
          const c = pickC(ok), rad = 1.6 + R() * 1.6, m = 7, a0 = R() * 6.28, close = R() < 0.6 ? 0.95 + R() * 0.12 : 0.8;
          const ring = [];
          for (let q = 0; q <= m; q++) { const a = a0 + (q / m) * 6.28 * close, rr = rad * (0.8 + R() * 0.4); ring.push([c.i + Math.cos(a) * rr, c.j + Math.sin(a) * rr]); }
          wpts = spline(ring, 8); desc = `loop round ${c.i},${c.j} r~${rad.toFixed(1)} ${close >= 0.95 ? 'closed' : 'left open'}`;
        } else {
          const a = kind === 'fromTop' ? pickC(built) : pickC(ok);
          const far = near(a, kind === 'meander' ? 4 : 2.5, kind === 'meander' ? 9 : 7);
          const b = far.length ? pickC(far) : pickC(ok);
          const A = [a.i, a.j], B = [b.i, b.j], L = Math.hypot(B[0] - A[0], B[1] - A[1]), nx = -(B[1] - A[1]) / (L || 1), ny = (B[0] - A[0]) / (L || 1);
          const mids = kind === 'meander' ? 3 : 1 + (R() < 0.5 ? 1 : 0), ctl = [A];
          for (let q = 1; q <= mids; q++) { const t = q / (mids + 1), off = (R() - 0.5) * L * (kind === 'meander' ? 0.5 : 0.22); ctl.push([A[0] + (B[0] - A[0]) * t + nx * off, A[1] + (B[1] - A[1]) * t + ny * off]); }
          ctl.push(B);
          wpts = spline(ctl, 10);
          if (kind === 'pause') pauses = [Math.floor(wpts.length * (0.35 + R() * 0.3))];
          desc = `${kind} from ${a.i},${a.j} (top ${a.top}) to ${b.i},${b.j} (top ${b.top})`;
        }
        // (onto the screen, each point on the top it's over; with a hand's tremor, and kept on the screen)
        const proj = await p.evaluate((q) => q.map(([i, j, y]) => window.__labyrinth.screenOf(i, j, y)), wpts.map(([i, j]) => [i, j, topAt.get(`${Math.round(i)}.${Math.round(j)}`) ?? 0]));
        pts = proj.map((s, q) => [Math.min(SAFE.x1, Math.max(SAFE.x0, s[0] + Math.sin(q * 1.7 + R()) * 1.2)), Math.min(SAFE.y1, Math.max(SAFE.y0, s[1] + Math.cos(q * 1.3 + R()) * 1.2))]);
        const off = proj.filter(([x, y]) => !safe([x, y])).length;
        if (off <= proj.length * 0.1) break;
      }
      // (an authored step the land offers nowhere for, or that won't stay on the screen: left out, said so)
      if (!kind) { console.log(`${cs.name}: ${cs.script?.[n - 1] ?? 'gesture'} skipped (nowhere for it)`); continue; }
      if (kind === 'tap' || kind === 'tapTop') { tap = pts[0]; pts = []; }
      const id = `${cs.name}-${++made}`, dir = join(OUT, 'sealed', id);
      mkdirSync(dir, { recursive: true });
      const pace = tap ? null : 8 + R() * 14;
      const delays = pts.map((_, q) => q ? pace * (0.6 + 0.8 * Math.sin((q / pts.length) * Math.PI)) + (pauses.includes(q) ? 560 : 0) : 0);
      const before = await p.evaluate(({ pts, tap }) => {
        const L = window.__labyrinth, w = L.world, points = tap ? [tap] : pts;
        return { world: w.encode(), view: JSON.parse(JSON.stringify(L.view)), brush: L.brush, intent: L.intent,
          ops: w.ops.length, probe: L.probe(), declines: L.declines(),
          picks: points.map(([x, y]) => L.pick(x, y)),
          geometry: { mass: [...w.mass.keys()], stairs: [...w.stairs.entries()], paving: [...w.paving], spans: w.spans, courts: [...w.courts] } };
      }, { pts, tap });
      // Only visible information in the BEFORE packet. Generator targets/picks/world are sealed diagnostics.
      writeJSON(join(dir, 'before.json'), { schema: 'labyrinth-intent-before/1', id,
        viewport: { width: 430, height: 900, dpr: 1 }, brush: before.brush, mode: before.intent,
        gesture: { kind, points: tap ? [tap] : pts, pauses, delayAfterPointMs: delays, releaseDelayMs: tap ? 0 : 60, input: tap ? 'mouse' : 'touch, dispatched in the page at its own pace' },
        legend: 'White ring: start; arrow: finish; dotted rings: 560ms pauses; small filled dot: tap. Coordinates are CSS pixels.',
        question: 'What might this hand mean in this visible scene? List plausible expectations before inspecting any result.' });
      if (intentText) writeJSON(join(dir, 'authored.json'), { schema: 'labyrinth-intent-authored/1', id, recipe: cs.script[n - 1], intent: intentText });
      writeJSON(join(dir, 'replay.json'), { schema: 'labyrinth-intent-replay/1', id, query: cs.q + '&instant', generatorSeed: cs.seed,
        description: desc, ...(intentText ? { authored: intentText } : {}), before, points: pts, tap, pauses, delays,
        capture: { instant: true, cats: false, viewport: { width: 430, height: 900, dpr: 1 } } });
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
      await p.screenshot({ path: join(dir, 'before.jpg'), type: 'jpeg', quality: 80 });
      await p.evaluate(() => document.getElementById('intent-overlay')?.remove());
      const ops0 = before.ops;
      // Observe delivered browser events without extra per-move protocol round trips or screenshot pauses.
      await p.evaluate(() => {
        const L = window.__labyrinth;
        window.__intentEvents = [];
        let t0 = null;
        window.__intentListener = (e) => {
          if (t0 === null) t0 = performance.now();
          const op = L.world.ops.at(-1);
          window.__intentEvents.push({ type: e.type, x: e.clientX, y: e.clientY, t: performance.now() - t0,
            hint: document.getElementById('hint')?.textContent ?? '', fan: L.fan(),
            why: op?.why ?? null, reading: op?.reading ?? null,
            reached: op ? L.world.reached.get(op) ?? null : null });
        };
        for (const k of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) document.addEventListener(k, window.__intentListener);
      });
      let during = null;
      if (tap) { await p.mouse.click(tap[0], tap[1]); }
      else {
        // (the stroke dispatched inside the page, in one go, its pace kept by the clock: through Playwright each move
        // waits on a frame, and a slow renderer's second-long frames would read as pauses all along it)
        during = await p.evaluate(({ pts, delays }) => {
          const c = document.getElementById('stone'), busy = (ms) => { const t = performance.now() + ms; while (performance.now() < t) { /* the hand moving */ } };
          c.setPointerCapture = () => {};
          const ev = (type, [x, y]) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 }));
          ev('pointerdown', pts[0]);
          for (let q = 1; q < pts.length; q++) { busy(delays[q]); ev('pointermove', pts[q]); }
          busy(60);
          const d = { hint: document.getElementById('hint')?.textContent ?? '', fan: window.__labyrinth.fan() };
          ev('pointerup', pts[pts.length - 1]);
          return d;
        }, { pts, delays });
      }
      await p.waitForTimeout(400);
      const said = await p.evaluate(() => document.getElementById('hint')?.textContent ?? '');
      await frames(3); await settle();
      // (and the stroke's guides gone: they're drawn only while the finger's down, but a slow frame can still be showing them)
      for (let t = 0; t < 80; t++) { if (!(await p.evaluate(() => { const c = document.getElementById('guide'), x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < x.length; i += 4) if (x[i]) return true; return false; }))) break; await p.waitForTimeout(250); }
      await frames(1);
      await p.screenshot({ path: join(dir, 'after.jpg'), type: 'jpeg', quality: 80 });
      const res = await p.evaluate(({ ops0, oldDeclines }) => {
        const L = window.__labyrinth, w = L.world;
        for (const k of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) document.removeEventListener(k, window.__intentListener);
        const prior = new Set(oldDeclines.map(d => JSON.stringify(d)));
        return { operationAppended: w.ops.length > ops0,
          operations: w.ops.slice(ops0).map(o => ({ op: o, reached: w.reached.get(o) ?? null })),
          alts: L.alts(), declines: L.declines().filter(d => !prior.has(JSON.stringify(d))), intent: L.intent,
          probe: L.probe(), world: w.encode(), view: JSON.parse(JSON.stringify(L.view)),
          events: window.__intentEvents,
          geometry: { mass: [...w.mass.keys()], stairs: [...w.stairs.entries()], paving: [...w.paving], spans: w.spans, courts: [...w.courts] } };
      }, { ops0, oldDeclines: before.declines });
      const difference = (a, b) => { const A = new Set(a.map(x => JSON.stringify(x))), B = new Set(b.map(x => JSON.stringify(x))); return { added: b.filter(x => !A.has(JSON.stringify(x))), removed: a.filter(x => !B.has(JSON.stringify(x))) }; };
      const geometryDelta = Object.fromEntries(['mass', 'stairs', 'paving', 'courts'].map(k => [k, difference(before.geometry[k], res.geometry[k])]));
      writeJSON(join(dir, 'result.json'), { schema: 'labyrinth-intent-result/1', id, ...res, geometryDelta, said, during,
        errors: p.errors.slice(), limitations: ['Synthetic pointer events (strokes dispatched in-page; taps by mouse), DPR 1; not an iPhone touch test', 'Instant growth; cats disabled', 'Event diagnostics are not a video of live feedback', 'reached is a solver diagnostic, not a judgment of intent', 'replay.json records the exact pre-world, camera, planned input; actual timing is in events'] });
      manifest.ids.push(id);
      writeJSON(join(OUT, 'manifest.json'), manifest);
      console.log(`${id}: captured and sealed (outcome withheld)`);
    }
    await p.close();
  }
  manifest.complete = true;
  writeJSON(join(OUT, 'manifest.json'), manifest);
  console.log(`Blind review ready. Run: node devtools/labyrinth-intent-review.mjs next ${OUT}`);
});
