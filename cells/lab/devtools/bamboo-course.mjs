// Bamboo's traversal course (node cells/lab/devtools/bamboo-course.mjs): short runs over land laid by hand, each with
// one thing in the way, run straight at it at a lope, no steering. Not "did it get through" (the open run checks that)
// but whether the thing changed the body, and the way kept:
//   root, stone      a skip each, the steps before it shortened to meet it, the pace kept
//   boulder          up onto its crown
//   chain            stone to stone, the next takeoff in mind as each lands
//   drop             a heavy landing that costs speed
//   drop, open       hard and fast onto a clear run down: a roll
//   drop, tight      hard into culms close beyond: a brace, never a roll
//   bowed culm       ducked under
//   narrow gap       shoulders turned through it
// and in every one, the way you were going still yours at the end (within a few metres, a few degrees).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const CELL = join(dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(join(CELL, 'package.json'))('esbuild');
const o = await build({ stdin: { contents: "export * from './client/bamboo/world.ts'; export * from './client/bamboo/runner.ts'; export * from './client/bamboo/footing.ts';", resolveDir: CELL, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const B = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
const { CHUNK, CELL: STEP, CN } = B;

/** a land laid by hand: a ground function, and stones, roots and culms where they're put */
function course({ ground = () => 0, stones = [], roots = [], culms = [] }) {
  const inChunk = (q, ci, cj) => Math.floor(q.x / CHUNK) === ci && Math.floor(q.z / CHUNK) === cj;
  const culm = (c) => ({ y: ground(c.x, c.z), r: 0.06, h: 12, lx: 0, lz: 0, node: 0.3, age: 0.5, phase: 0, pick: 0, crown: 0.5, bend: 0, ...c });
  return {
    ground, tread: () => null, trailNear: () => ({ d: 99, trail: null, i: -1 }),
    chunk(ci, cj) {
      const x0 = ci * CHUNK, z0 = cj * CHUNK, n = CN * CN, g = new Float32Array(n);
      for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) g[i + j * CN] = ground(x0 + i * STEP, z0 + j * STEP);
      const cs = culms.filter((c) => inChunk(c, ci, cj)).map(culm);
      return { ci, cj, x0, z0, ground: g, near: new Float32Array(n).fill(30), rock: new Float32Array(n), culms: cs, tall: cs.length, sprays: [], twigs: [], stones: stones.filter((s) => inChunk(s, ci, cj)).map((s) => ({ yaw: 0, flat: 0.7, kind: 0, moss: 0, y: ground(s.x, s.z), ...s })), steps: [], roots: roots.filter((r) => inChunk(r, ci, cj)).map((r) => ({ yaw: 0, len: 3, moss: 0, y: ground(r.x, r.z) - r.r * 0.35, ...r })), sunVis: new Float32Array(n).fill(1), ao: new Float32Array(n).fill(1) };
    },
  };
}
const cliff = (at, drop) => (x, z) => (z < at ? 0 : z > at + 0.15 ? -drop : -drop * ((z - at) / 0.15));
/** a row of culms across the way at z, each `gap` apart, leaving none wider */
const row = (z, gap, r = 0.07) => Array.from({ length: 15 }, (_, k) => ({ x: (k - 7) * gap, z, r }));

const COURSES = {
  'root, stone': { land: { roots: [{ x: 0, z: 12, r: 0.24 }], stones: [{ x: 0, z: 24, r: 0.45, flat: 0.7, y: 0 }] }, want: (m) => m.acts.skip >= 2 && m.minV > 0.75 * B.LOPE && m.shortened },
  boulder: { land: { stones: [{ x: 0, z: 14, r: 1.5, flat: 0.5, y: -0.15 }] }, want: (m) => m.acts.hop >= 1 && m.onStone > 0.2 },
  chain: { land: { stones: [0, 1, 2].map((k) => ({ x: (k % 2 ? 0.3 : -0.3), z: 12 + k * 2.6, r: 0.8, flat: 0.8, y: -0.2 })) }, want: (m) => m.stoneLandings >= 3 && m.anticipated >= 1 },
  drop: { land: { ground: cliff(15, 1.6) }, want: (m) => m.landings.some((l) => l.as === 'heavy' || l.as === 'roll') && m.minVAfter < 0.92 * m.vBefore },
  'drop, open': { land: { ground: cliff(15, 2.6) }, want: (m) => m.landings.some((l) => l.as === 'roll') },
  'drop, tight': { land: { ground: cliff(15, 2.6), culms: [...row(21.5, 0.9), ...row(23.5, 0.9)] }, want: (m) => m.landings.some((l) => l.as === 'brace') && !m.landings.some((l) => l.as === 'roll') },
  'bowed culm': { land: { culms: [{ x: -5.2, z: 14, r: 0.035, h: 7, lx: 0.3, lz: 0, bend: 1.5 + 2.6 }] }, want: (m) => m.maxDuck > 0.2 },
  'narrow gap': { land: { culms: row(14, 0.86) }, want: (m) => m.maxShoulder > 0.5 && m.through },
};

let fails = 0;
for (const [name, c] of Object.entries(COURSES)) {
  const land = course(c.land), me = new B.Runner(land, 40);
  me.stream(0, 0, 50); me.y = me.standAt(0, 0); me.v = B.LOPE;
  const m = { acts: {}, landings: [], minV: 99, minVAfter: 99, vBefore: 0, onStone: 0, stoneLandings: 0, anticipated: 0, maxDuck: 0, maxShoulder: 0, through: false, shortened: false, closest: 9 };
  const falls = [];
  me.onStep = () => falls.push(me.z);
  me.onAct = (a) => { m.acts[a] = (m.acts[a] ?? 0) + 1; if (!m.vBefore) m.vBefore = me.v; const f = falls.slice(-3); if (f.length === 3 && (a === 'skip' || a === 'hop') && f[2] - f[1] < 2.2 * 0.95) m.shortened = true; };
  me.onLand = (on, imp, as) => { m.landings.push({ on, imp: +imp.toFixed(1), as }); if (on === 'stone') { m.stoneLandings++; if (me.plan) m.anticipated++; } };
  const dt = 1 / 60;
  let landed = false, t = 0;
  for (; t < 9 && me.z < 40; t += dt) {
    me.update(dt, { go: true, turn: 0 });
    m.minV = Math.min(m.minV, me.air ? 99 : me.v);
    if (m.landings.length) landed = true;
    if (landed && !me.air) m.minVAfter = Math.min(m.minVAfter, me.v);
    if (!me.air && me.under === 'stone') m.onStone += dt;
    m.maxDuck = Math.max(m.maxDuck, me.duck); m.maxShoulder = Math.max(m.maxShoulder, Math.abs(me.shoulder));
    if (me.z > 14.5 && Math.abs(me.x) < 1) m.through = true;
    for (const p of me.feet.posts(me.x, me.z, 1.2)) if (B.meets(p, B.EYE + 0.16 - me.duck) === 'block' && !me.air) m.closest = Math.min(m.closest, Math.hypot(p.x - me.x, p.z - me.z) - p.r);
  }
  // (the way kept: still going on the way you set out, not turned off it or stopped)
  const kept = Math.abs(me.x) < 3 && Math.abs(me.heading) < 0.35 && me.z > 25 && m.closest > 0.15;
  const ok = c.want(m) && kept;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(12)} moves ${JSON.stringify(m.acts)} landings ${JSON.stringify(m.landings.map((l) => `${l.as}@${l.on}:${l.imp}`))} duck ${m.maxDuck.toFixed(2)} shoulder ${m.maxShoulder.toFixed(2)} minV ${m.minV === 99 ? '-' : m.minV.toFixed(1)} end x ${me.x.toFixed(1)} z ${me.z.toFixed(1)} closest ${m.closest.toFixed(2)}`);
}
console.log(fails ? `FAIL ${fails}` : 'ok');
process.exit(fails ? 1 : 0);
