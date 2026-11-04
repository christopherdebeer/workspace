// One crown, three ways (node cells/lab/devtools/bamboo-crown.mjs): the same approach onto the same crown, and what the
// contact on it does decided by what you ask, not by how hard you came down:
//   on        still going, the way straight on: a running bound, the touch brief, the pace carried through it
//   redirect  turned in the air toward a crown off to the side: the foot on the crown takes the weight and the turn
//             goes with it, a longer stance, the speed absorbed, and the push leaves on the new way, onto that crown
//   settle    let go in the air: you come down on the crown and stop there, braked as hard as the crown asks, and no
//             next launch (a flight under way carries on; the next is yours to decline)
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const CELL = join(dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(join(CELL, 'package.json'))('esbuild');
const o = await build({ stdin: { contents: "export * from './client/bamboo/world.ts'; export * from './client/bamboo/runner.ts';", resolveDir: CELL, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const B = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
const { CHUNK, CELL: STEP, CN } = B;

// (flat ground; crown A straight ahead, B beyond it straight on, C off to the right of A)
const A = { x: 0, z: 12, r: 0.8, flat: 0.8, y: -0.2 }, Bc = { x: 0, z: 14.6, r: 0.8, flat: 0.8, y: -0.2 }, C = { x: 2.3, z: 14.2, r: 0.8, flat: 0.8, y: -0.2 };
function land(stones) {
  const inChunk = (q, ci, cj) => Math.floor(q.x / CHUNK) === ci && Math.floor(q.z / CHUNK) === cj;
  return {
    ground: () => 0, tread: () => null, trailNear: () => ({ d: 99, trail: null, i: -1 }),
    chunk(ci, cj) {
      const x0 = ci * CHUNK, z0 = cj * CHUNK, n = CN * CN;
      return { ci, cj, x0, z0, ground: new Float32Array(n), near: new Float32Array(n).fill(30), rock: new Float32Array(n), culms: [], tall: 0, sprays: [], twigs: [], stones: stones.filter((s) => inChunk(s, ci, cj)).map((s) => ({ yaw: 0, kind: 0, moss: 0, ...s })), steps: [], roots: [], sunVis: new Float32Array(n).fill(1), ao: new Float32Array(n).fill(1) };
    },
  };
}
const near = (p, s) => Math.hypot(p.x - s.x, p.z - s.z) < s.r * 0.9;

function run(mode) {
  const me = new B.Runner(land([A, Bc, C]), 40), dt = 1 / 60;
  me.stream(0, 0, 50); me.y = me.standAt(0, 0); me.v = B.LOPE;
  const r = { lands: [], acts: [], onA: null, leaveA: null, vLandA: 0, vLeaveA: 0, stanceA: 0, after: [] };
  let flights = 0, onAirToA = false;
  me.onAct = (a) => {
    flights++;
    if (flights === 1) r.vIn = Math.hypot(me.vx, me.vz);
    r.acts.push(a);
    if (r.onA !== null && r.leaveA === null) { r.leaveA = me.clock; r.vLeaveA = Math.hypot(me.vx, me.vz); r.leaveDir = Math.atan2(me.vx, me.vz); }
  };
  me.onLand = (on, imp, as) => {
    const s = near(me, A) ? 'A' : near(me, Bc) ? 'B' : near(me, C) ? 'C' : on;
    r.lands.push(`${s}:${as}`);
    if (s === 'A' && r.onA === null) { r.onA = me.clock; r.vLandA = me.v; r.stanceA = me.stanceLeft; }
  };
  let turned = 0;
  for (let t = 0; t < 6; t += dt) {
    // (in the air toward A: the input that decides what A is for)
    onAirToA = me.air && flights === 1;
    let go = true, turn = 0;
    if (onAirToA && mode === 'settle') go = false;
    if (mode === 'settle' && r.onA !== null) go = false;
    if (onAirToA && mode === 'redirect') { const want = Math.atan2(C.x - me.x, C.z - me.z), d = want - me.heading; turn = Math.max(-2 * dt, Math.min(2 * dt, d)); }
    turned += turn;
    me.update(dt, { go, turn });
    if (r.onA !== null) r.after.push({ x: me.x, z: me.z, v: me.v, air: me.air });
  }
  r.end = { x: me.x, z: me.z, v: me.v, y: me.y };
  return r;
}

let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} ${detail}`); };
{
  const r = run('on'), touch = r.leaveA !== null ? r.leaveA - r.onA : 9;
  check('on', r.lands[0]?.startsWith('A') && r.lands.some((l) => l.startsWith('B')) && touch < 0.16 && r.vLeaveA > 0.75 * r.vLandA,
    `lands ${r.lands.join(' ')} · on A ${touch.toFixed(2)} s · speed in ${r.vLandA.toFixed(1)} out ${r.vLeaveA.toFixed(1)} m/s`);
}
{
  const r = run('redirect'), touch = r.leaveA !== null ? r.leaveA - r.onA : 9, wantDir = Math.atan2(C.x - A.x, C.z - A.z);
  check('redirect', r.lands[0]?.startsWith('A') && r.lands.some((l) => l.startsWith('C')) && touch > 0.1 && r.vLandA < 0.75 * r.vIn && Math.abs(r.leaveDir - wantDir) < 0.5,
    `lands ${r.lands.join(' ')} · on A ${touch.toFixed(2)} s · speed in ${r.vIn.toFixed(1)}, absorbed to ${r.vLandA.toFixed(1)}, pushed out ${r.vLeaveA.toFixed(1)} m/s · left at ${(r.leaveDir ?? NaN).toFixed(2)} (C at ${wantDir.toFixed(2)})`);
}
{
  const r = run('settle'), stopAt = r.after.findIndex((s) => s.v < 0.1 && !s.air), onCrown = near(r.end, A);
  check('settle', r.lands[0]?.startsWith('A') && r.leaveA === null && stopAt >= 0 && stopAt / 60 < 0.8 && onCrown,
    `lands ${r.lands.join(' ')} · no launch after: ${r.leaveA === null} · stopped in ${stopAt < 0 ? '-' : (stopAt / 60).toFixed(2)} s · still on A: ${onCrown}`);
}
console.log(fails ? `FAIL ${fails}` : 'ok');
process.exit(fails ? 1 : 0);
