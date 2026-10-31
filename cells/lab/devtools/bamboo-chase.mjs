// Bamboo's chase, without drawing (node cells/lab/devtools/bamboo-chase.mjs [kinds] [seeds]): a presence set going
// across your way, and you after it, steering for where you believe it is (as chase.ts has it: where you last saw or
// heard it, carried on the way it was going). Each run until it's lost or met, or five minutes. Checks that its
// movement is honest (never faster than its own speed, so never a jump), that the chases end, that contact goes through
// traced and back (found again after two seconds or more out of sight), and how long they last.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const CELL = join(dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(join(CELL, 'package.json'))('esbuild');
const o = await build({ stdin: { contents: "export * from './client/bamboo/world.ts'; export * from './client/bamboo/runner.ts'; export * from './client/bamboo/presence.ts'; export * from './client/bamboo/chase.ts';", resolveDir: CELL, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const B = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
const kinds = (process.argv[2] ?? 'fox,runner,stir').split(','), seeds = (process.argv[3] ?? '1,2,3').split(',').map(Number);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const TOP = { fox: 10.5, runner: 7.6, stir: 7.4 };
let fails = 0;
const rows = [];
for (const kind of kinds) for (const seed of seeds) {
  const world = new B.World(seed), me = new B.Runner(world);
  // (start on a trail, facing along it; the presence crossing a little ahead: a runner on the trail itself, ahead)
  let sx = 0, sz = 0, sh = 0;
  { const q = world.trailNear(0, 0); if (q.trail) { const t = q.trail, i = Math.min(t.x.length - 4, Math.max(0, q.i)); sx = t.x[i]; sz = t.z[i]; sh = Math.atan2(t.x[i + 3] - t.x[i], t.z[i + 3] - t.z[i]); } }
  me.x = sx; me.z = sz; me.heading = me.move = sh; me.stream(sx, sz, 400); me.y = me.standAt(sx, sz); me.v = B.LOPE * 0.6;
  const fx = Math.sin(sh), fz = Math.cos(sh);
  const px = kind === 'runner' ? sx + fx * 18 : sx + fx * 14 - fz * 4, pz = kind === 'runner' ? sz + fz * 18 : sz + fz * 14 + fx * 4;
  const it = new B.Presence(kind, me.feet, world, px, pz, kind === 'runner' ? sh : sh + Math.PI / 2, seed * 7 + 1);
  const chase = new B.Chase(it, me.feet);
  const dt = 1 / 30;
  let top = 0, t = 0, states = '', last = ''; const trace = [];
  for (; t < 300 && !chase.over; t += dt) {
    const [gx, gz] = chase.guess();
    const want = Math.atan2(gx - me.x, gz - me.z), turn = Math.max(-1.8 * dt, Math.min(1.8 * dt, wrap(want - me.heading)));
    const ox = me.x, oz = me.z;
    me.update(dt, { go: true, turn });
    me.stream(me.x, me.z, 1);
    it.step(dt, { x: me.x, z: me.z });
    trace.push([it.x, it.z]); if (trace.length > 30) { const [ax, az] = trace[trace.length - 31]; top = Math.max(top, Math.hypot(it.x - ax, it.z - az)); }
    chase.update(dt, [me.x, me.y + 1.62, me.z], me.heading, -0.05, 0.55, 0.6, Math.hypot(me.x - ox, me.z - oz));
    if (chase.state !== last) { states += chase.state[0]; last = chase.state; }
  }
  // (over each second: never further than its top speed takes it, so never a jump)
  const honest = top <= TOP[kind] * 1.1;
  if (!honest) fails++;
  rows.push({ kind, seed, end: chase.over ? chase.state : 'still on', secs: Math.round(chase.time), run: Math.round(chase.run), seen: Math.round((100 * chase.seenTime) / Math.max(1, chase.time)), traced: Math.round((100 * chase.tracedTime) / Math.max(1, chase.time)), regained: chase.regained, top: +top.toFixed(1), honest, path: states.slice(0, 40) });
}
for (const r of rows) console.log(`${r.honest ? 'ok  ' : 'FAIL'} ${r.kind.padEnd(7)} seed ${r.seed}  ${String(r.end).padEnd(8)} ${String(r.secs).padStart(4)} s  ran ${String(r.run).padStart(5)} m  seen ${String(r.seen).padStart(3)}%  traced ${String(r.traced).padStart(3)}%  found again ${r.regained}  fastest ${r.top} m/s  ${r.path}`);
const ended = rows.filter((r) => r.end !== 'still on').length, regained = rows.filter((r) => r.regained > 0).length;
console.log(`${ended}/${rows.length} ended; ${regained}/${rows.length} found it again at least once`);
console.log(fails ? `FAIL ${fails}` : 'ok');
process.exit(fails ? 1 : 0);
