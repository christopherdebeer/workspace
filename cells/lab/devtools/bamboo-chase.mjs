// Bamboo's chase, without drawing (node cells/lab/devtools/bamboo-chase.mjs [seeds]).
//
// First, situations on land laid by hand, each one thing the chase must get right:
//   behind a rock     a fox standing behind a boulder isn't seen; stepping out from it, it is (found again)
//   heard, not seen   behind you on stone: traced while you can hear; with the sound off, searching, then lost
//   restraint         coming at it fast in the open alarms it into flight; coming slowly keeps it calm; stopping calms it
//   a meeting         lying up, it lets you walk up to it; run at it and it's gone
//   a bound           across a row of stones: in the air, then a landing heard; never a pop in height on the ground
// Then chases on the mountain against a pursuer that knows only what it's seen and heard (steering for its belief),
// reported. Throughout: its movement is honest (never further in a second than its speed; on the ground, never a jump in
// height; up or down anything bigger, a bound through the air).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const CELL = join(dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(join(CELL, 'package.json'))('esbuild');
const o = await build({ stdin: { contents: "export * from './client/bamboo/world.ts'; export * from './client/bamboo/runner.ts'; export * from './client/bamboo/footing.ts'; export * from './client/bamboo/presence.ts'; export * from './client/bamboo/chase.ts';", resolveDir: CELL, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const B = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
const { CHUNK, CELL: STEP, CN } = B;
const seeds = (process.argv[2] ?? '1,2,3').split(',').map(Number);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const PX = (2 * Math.tan((74 * Math.PI) / 360)) / 844;
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(36)} ${detail}`); };

/** a land laid by hand (as bamboo-course.mjs lays one) */
function course({ ground = () => 0, stones = [], culms = [] }) {
  const inChunk = (q, ci, cj) => Math.floor(q.x / CHUNK) === ci && Math.floor(q.z / CHUNK) === cj;
  const culm = (c) => ({ y: ground(c.x, c.z), r: 0.06, h: 12, lx: 0, lz: 0, node: 0.3, age: 0.5, phase: 0, pick: 0, crown: 0.5, bend: 0, ...c });
  return {
    ground, tread: () => null, trailNear: () => ({ d: 99, trail: null, i: -1 }),
    chunk(ci, cj) {
      const x0 = ci * CHUNK, z0 = cj * CHUNK, n = CN * CN, g = new Float32Array(n);
      for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) g[i + j * CN] = ground(x0 + i * STEP, z0 + j * STEP);
      const cs = culms.filter((c) => inChunk(c, ci, cj)).map(culm);
      return { ci, cj, x0, z0, ground: g, near: new Float32Array(n).fill(30), rock: new Float32Array(n), culms: cs, tall: cs.length, sprays: [], twigs: [], stones: stones.filter((s) => inChunk(s, ci, cj)).map((s) => ({ yaw: 0, flat: 0.7, kind: 0, moss: 0, y: ground(s.x, s.z), ...s })), steps: [], roots: [], sunVis: new Float32Array(n).fill(1), ao: new Float32Array(n).fill(1), canopy: new Float32Array(n).fill(0.3) };
    },
  };
}
function setup(land) { const me = new B.Runner(land, 60); me.stream(0, 0, 60); return me.feet; }
const senses = (eye, yaw, hearing = true) => ({ eye, yaw, pitch: -0.05, hx: 0.6, hy: 0.65, px: PX, legible: (x, y, z) => (Math.hypot(x - eye[0], z - eye[2]) < 80 ? 1 : 0), hearing, mask: 0 });

// ─── behind a rock ───
{
  const land = course({ stones: [{ x: 0, z: 12, r: 1.7, flat: 0.95, y: -0.1 }] }), F = setup(land);
  const fox = new B.Presence('fox', F, land, 0, 15.5, 0, 3); fox.mode = 'pause'; Object.assign(fox, { pauseT: 99 });
  const ch = new B.Chase(fox, F), eye = [0, 1.62, 0];
  for (let t = 0; t < 2; t += 1 / 30) { fox.step(1 / 30, { x: 0, z: 0, y: 1.62, v: 0, loud: 0 }); ch.update(1 / 30, senses(eye, 0, false), 0); }
  const hidden = !ch.seen;
  fox.x = 3.5; fox.z = 15.5; fox.y = 0;
  for (let t = 0; t < 1; t += 1 / 30) { fox.step(1 / 30, { x: 0, z: 0, y: 1.62, v: 0, loud: 0 }); ch.update(1 / 30, senses(eye, 0, false), 0); }
  check('behind a rock: not seen', hidden, `seen ${!hidden}`);
  check('stepping out: seen again', ch.seen, `seen ${ch.seen}, state ${ch.state}`);
}
// ─── heard, not seen ───
for (const hearing of [true, false]) {
  const land = course({ stones: Array.from({ length: 12 }, (_, k) => ({ x: -12 + k * 2.2, z: -10, r: 1, flat: 0.25, y: -0.15 })) }), F = setup(land);
  const fox = new B.Presence('fox', F, land, -10, -10, Math.PI / 2, 5);
  const ch = new B.Chase(fox, F), eye = [0, 1.62, 0];
  const states = new Set();
  for (let t = 0; t < 30; t += 1 / 30) { fox.step(1 / 30, { x: 0, z: 0, y: 1.62, v: 0, loud: 0 }); fox.alarm = 0.5; ch.update(1 / 30, senses(eye, 0, hearing), 0); states.add(ch.state); }
  if (hearing) check('heard behind you: traced', states.has('traced') && !states.has('seen'), [...states].join(' → '));
  else check('sound off: searching, then lost', states.has('searching') && ch.state === 'lost', [...states].join(' → '));
}
// ─── restraint ───
{
  const run = (v, hide) => {
    const land = course({ stones: hide ? [{ x: 0, z: 17, r: 2, flat: 1.2, y: 0 }] : [] }), F = setup(land);
    const fox = new B.Presence('fox', F, land, 0, 22, 0, 7); fox.mode = 'pause'; Object.assign(fox, { pauseT: 99 });
    let peak = 0, z = 0;
    for (let t = 0; t < 2.5; t += 1 / 30) { z = Math.min(11, z + v / 30); fox.step(1 / 30, { x: 0, z, y: 1.62, v, loud: 0 }); peak = Math.max(peak, fox.alarm); }
    return { peak, fox };
  };
  const fast = run(7, false), slow = run(1.3, false), hidden = run(7, true);
  check('fast in the open: alarmed', fast.peak > 0.8, `alarm ${fast.peak.toFixed(2)}`);
  check('slow in the open: calm', slow.peak < 0.5, `alarm ${slow.peak.toFixed(2)}`);
  check('fast behind a rock: less alarmed', hidden.peak < fast.peak - 0.15, `alarm ${hidden.peak.toFixed(2)} vs ${fast.peak.toFixed(2)}`);
  const f = fast.fox; for (let t = 0; t < 6; t += 1 / 30) f.step(1 / 30, { x: 0, z: 0, y: 1.62, v: 0, loud: 0 });
  check('stopping: calms', f.alarm < 0.5, `alarm after 6 s still ${f.alarm.toFixed(2)}`);
}
// ─── a meeting ───
for (const v of [1.3, 7]) {
  const land = course({}), F = setup(land);
  const fox = new B.Presence('fox', F, land, 0, 14, Math.PI, 9); fox.mode = 'rest';
  const ch = new B.Chase(fox, F);
  let z = 0;
  for (let t = 0; t < 20 && !ch.over; t += 1 / 30) { z = Math.min(z + v / 30, 11); const eye = [0, 1.62, z]; fox.step(1 / 30, { x: 0, z, y: 1.62, v: z < 11 ? v : 0, loud: 0 }); ch.update(1 / 30, senses(eye, 0, true), v / 30); }
  if (v < 2) check('walked up to it slowly: met', ch.state === 'met', `state ${ch.state}, alarm ${fox.alarm.toFixed(2)}`);
  else check('ran at it: gone', ch.state !== 'met' && fox.mode === 'go', `state ${ch.state}, mode ${fox.mode}`);
}
// ─── a bound ───
{
  const land = course({ stones: Array.from({ length: 9 }, (_, k) => ({ x: -8 + k * 2, z: 10, r: 1.1, flat: 0.75, y: -0.1 })) }), F = setup(land);
  const fox = new B.Presence('fox', F, land, 0, 4, 0, 11); fox.alarm = 0.9;
  let airs = 0, wasAir = false, pop = 0, landed = 0, py = fox.y;
  for (let t = 0; t < 4; t += 1 / 60) {
    fox.step(1 / 60, { x: 0, z: -6, y: 1.62, v: 7, loud: 0.5 });
    if (fox.air && !wasAir) airs++;
    if (!fox.air && !wasAir) pop = Math.max(pop, Math.abs(fox.y - py));
    wasAir = fox.air; py = fox.y;
  }
  landed = fox.cues.filter((c) => c.kind === 'land').length;
  check('across stones: bounds, lands, no pops', airs > 0 && landed > 0 && pop < 0.31, `${airs} bounds, ${landed} landings, biggest step on the ground ${pop.toFixed(2)} m, reached z ${fox.z.toFixed(1)}`);
}

// ─── chases on the mountain, against a pursuer that knows only what it's perceived ───
for (const kind of ['fox', 'runner', 'stir']) for (const seed of seeds) {
  const world = new B.World(seed), me = new B.Runner(world);
  let sx = 0, sz = 0, sh = 0;
  { const q = world.trailNear(0, 0); if (q.trail) { const t = q.trail, i = Math.min(t.x.length - 4, Math.max(0, q.i)); sx = t.x[i]; sz = t.z[i]; sh = Math.atan2(t.x[i + 3] - t.x[i], t.z[i + 3] - t.z[i]); } }
  me.x = sx; me.z = sz; me.heading = me.move = sh; me.stream(sx, sz, 400); me.y = me.standAt(sx, sz); me.v = B.LOPE * 0.6;
  const fx = Math.sin(sh), fz = Math.cos(sh);
  const it = new B.Presence(kind, me.feet, world, sx + fx * 13 - fz * 2, sz + fz * 13 + fx * 2, kind === 'runner' ? sh : sh + Math.PI / 2, seed * 7 + 1);
  const chase = new B.Chase(it, me.feet), dt = 1 / 30, trace = [];
  let top = 0, pop = 0, py = it.y, wasAir = false, bounds = 0, path = '', last = '', noise = 0;
  me.onLand = (_on, imp) => { noise = Math.max(noise, Math.min(1, imp / 5)); };
  for (let t = 0; t < 300 && !chase.over; t += dt) {
    const [gx, gz] = chase.guess();
    const turn = Math.max(-1.8 * dt, Math.min(1.8 * dt, wrap(Math.atan2(gx - me.x, gz - me.z) - me.heading)));
    const ox = me.x, oz = me.z;
    me.update(dt, { go: true, turn }); me.stream(me.x, me.z, 1);
    noise *= Math.exp(-dt * 2);
    it.step(dt, { x: me.x, z: me.z, y: me.y + 1.62, v: me.v, loud: noise });
    trace.push([it.x, it.z]); if (trace.length > 30) { const [ax, az] = trace[trace.length - 31]; top = Math.max(top, Math.hypot(it.x - ax, it.z - az)); }
    if (it.air && !wasAir) bounds++;
    if (!it.air && !wasAir && kind !== 'stir') pop = Math.max(pop, Math.abs(it.y - py));
    wasAir = it.air; py = it.y;
    chase.update(dt, { ...senses([me.x, me.y + 1.62, me.z], me.heading, true), mask: (me.v / B.LOPE) * 0.3 }, Math.hypot(me.x - ox, me.z - oz));
    if (chase.state !== last) { path += chase.state[0]; last = chase.state; }
  }
  const TOP = { fox: 10.5, runner: 7.6, stir: 7.4 }[kind];
  const honest = top <= TOP * 1.1 && pop < 0.31;
  check(`${kind} seed ${seed}: honest`, honest, `${chase.over ? chase.state : 'still on'} after ${Math.round(chase.time)} s · ran ${Math.round(chase.run)} m · seen ${Math.round((100 * chase.seenTime) / Math.max(1, chase.time))}% traced ${Math.round((100 * chase.tracedTime) / Math.max(1, chase.time))}% searching ${Math.round((100 * chase.searchTime) / Math.max(1, chase.time))}% · found again ${chase.regained} · bounds ${bounds} · fastest ${top.toFixed(1)} m/s · step ${pop.toFixed(2)} m · ${path.slice(0, 30)}`);
}
console.log(fails ? `FAIL ${fails}` : 'ok');
process.exit(fails ? 1 : 0);
