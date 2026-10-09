// Technic's rules and solver, on their own: fitting, where pieces go, what moves with what;
// then the machines run — a pendulum swings and settles, a train turns at its ratios, a crank
// turns its rocker, a car drives and turns at the wall. (node cells/lab/devtools/technic.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const load = async (f) => { const o = await build({ entryPoints: [new URL(`../client/technic/${f}`, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const P = await load('pieces.ts');
const S = await load('sim.ts');
const { World, demo, BOARD, FLOOR, XMAX, XMIN } = P;

const piece = (kind, n, x, y, z, rot = 0, friction) => ({ kind, n, at: [x, y], z, rot, colour: 0, ...(friction ? { friction } : {}) });

// ─── fitting ──────────────────────────────────────────────────────────────────────────────────
{
  const w = new World();
  assert.ok(w.fits(piece('beam', 5, 2, 2, 0)), 'a beam on the board');
  assert.ok(!w.fits(piece('beam', 5, 30, 2, 0)), 'off the board');
  assert.ok(!w.fits(piece('beam', 5, 2, 2, -1)), 'in the board');
  const b = w.add(piece('beam', 5, 2, 2, 0));
  assert.ok(!w.fits(piece('beam', 3, 4, 2, 0)), 'through another beam in its layer');
  assert.ok(w.fits(piece('beam', 3, 4, 2, 1)), 'in front of it');
}
{
  const w = new World();
  w.add(piece('beam', 5, 2, 2, 0));
  assert.ok(!w.fits(piece('beam', 3, 4, 3, 0, 3)), 'standing through it: no');
  assert.ok(w.fits(piece('beam', 3, 4, 3, 0, 1)), 'standing on it: yes');
  // pins and axles: through round holes only, one per place
  assert.ok(w.fits(piece('pin', 2, 2, 2, BOARD)), 'a pin into the board');
  assert.ok(w.fits(piece('pin', 2, 2, 2, 0)), 'a pin out the front');
  assert.ok(!w.fits(piece('pin', 2, 9, 9, -2)), 'behind the board');
  const pin = w.add(piece('pin', 2, 2, 2, BOARD, 0, true));
  assert.ok(!w.fits(piece('axle', 3, 2, 2, BOARD)), 'two through one hole: no');
  assert.ok(w.fits(piece('axle', 3, 3, 2, BOARD)), 'an axle through the next hole, from the board');
  const m = w.add(piece('motor', 0, 10, 2, 0));
  assert.ok(!w.fits(piece('pin', 2, 11, 2, BOARD)), 'a pin into the motor\'s solid middle: no');
  assert.ok(w.fits(piece('pin', 2, 10, 2, BOARD)), 'into its mounting hole');
  assert.ok(!w.fits(piece('pin', 2, 12, 2, BOARD)), 'a pin in the output axle hole: no');
  assert.ok(w.fits(piece('axle', 3, 12, 2, BOARD)), 'an axle in it: yes');
  // discs: clear of each other and of beams in their layer; meshing is touching
  w.add(piece('axle', 3, 20, 10, BOARD));
  w.add(piece('gear', 24, 20, 10, 1));
  assert.ok(!w.fits(piece('gear', 8, 21, 10, 1)), 'a gear inside another');
  assert.ok(w.fits(piece('gear', 8, 22, 10, 1)), 'a gear touching another (meshing)');
  assert.ok(!w.fits(piece('beam', 3, 21, 10, 1)), 'a beam through a gear in its layer');
  assert.ok(w.fits(piece('beam', 3, 21, 10, 2)), 'in front of it');
  assert.ok(w.fits(piece('gear', 24, 20, 10, 0)), 'a 24 behind it, against the board (nothing there)');
  console.log('fits ok');
}

// ─── placing ──────────────────────────────────────────────────────────────────────────────────
{
  const w = new World();
  const spec = { kind: 'beam', n: 5, rot: 0, colour: 0 };
  // a beam by its middle hole: its origin is two to the left
  assert.deepEqual(w.place(spec, 10, 5, [2, 0]).piece.at, [8, 5]);
  const b = w.add(w.place(spec, 10, 5, [2, 0]).piece);
  // the same place again: in front
  assert.equal(w.place(spec, 10, 5, [2, 0]).piece.z, 1);
  // a pin dropped on the beam: into the beam and the board behind it
  const pin = w.place({ kind: 'pin', n: 2, rot: 0, colour: 0, friction: true }, 9, 5);
  assert.deepEqual([pin.piece.z, pin.piece.n], [BOARD, 2]);
  // a second beam in front, then a pin: joins the two
  const b2 = w.add(w.place(spec, 10, 5, [0, 0]).piece);
  assert.equal(w.pieces[b2].z, 1);
  assert.equal(w.place({ kind: 'pin', n: 2, rot: 0, colour: 0 }, 11, 5).piece.z, 0);
  // a long pin: all three
  assert.equal(w.place({ kind: 'pin', n: 3, rot: 0, colour: 0 }, 11, 5).piece.z, BOARD);
  // an axle: from the board (the back is against it) out the front
  const ax = w.place({ kind: 'axle', n: 5, rot: 0, colour: 0 }, 11, 5);
  assert.equal(ax.piece.z, BOARD);
  // a gear on a beam's hole with no axle brings one: through the board, the beam, and itself
  const g = w.place({ kind: 'gear', n: 8, rot: 0, colour: 0 }, 12, 5);
  assert.ok(g.extra && g.extra.kind === 'axle');
  assert.equal(g.extra.z, BOARD);
  assert.equal(g.piece.z, 2, 'in front of the front beam');
  assert.ok(g.extra.n >= 4, `an axle long enough: ${g.extra.n}`);
  w.add(g.extra);
  w.add(g.piece);
  // a second gear on that axle: there's no room along it (it was just long enough)
  assert.equal(w.place({ kind: 'gear', n: 8, rot: 0, colour: 0 }, 12, 5), null);
  // a longer axle, and a gear finds the next free layer along it
  w.add(piece('axle', 6, 13, 5, BOARD));
  w.add(piece('gear', 8, 13, 5, 1));
  const g2 = w.place({ kind: 'gear', n: 8, rot: 0, colour: 0 }, 13, 5);
  assert.equal(g2.extra, undefined);
  assert.equal(g2.piece.z, 0, 'the first free layer: behind the beam in layer 1, where the first gear isn\'t');
  w.add(g2.piece);
  assert.equal(w.place({ kind: 'gear', n: 8, rot: 0, colour: 0 }, 13, 5).piece.z, 2, 'then past the beam');
  // nudging: nearer where there's room, not into anything
  assert.equal(w.nudged(b, 1), null, 'the beam can\'t come forward: the other is there');
  const w4 = new World();
  const n1 = w4.add(piece('beam', 5, 2, 2, 0));
  w4.add(piece('beam', 5, 4, 2, 1));
  assert.equal(w4.nudged(n1, 1), null);
  assert.equal(w4.nudged(n1, -1), null, 'not into the board');
  const n2 = w4.add(piece('beam', 5, 2, 6, 0));
  assert.equal(w4.nudged(n2, 1).z, 1);
  assert.equal(w4.turned(n2).rot, 1);
  console.log('place ok');
}

// ─── the mechanism ────────────────────────────────────────────────────────────────────────────
{
  const w = new World();
  // a beam pinned tight to the board is part of the board; one on an axle is its own body, jointed to it
  const a = w.add(piece('beam', 5, 2, 2, 0));
  w.add(piece('pin', 2, 2, 2, BOARD, 0, true));
  const b = w.add(piece('beam', 5, 10, 10, 0));
  w.add(piece('axle', 2, 10, 10, BOARD));
  let m = w.mechanism();
  assert.equal(m.bodyOf[a], 0, 'pinned tight: the board\'s body');
  assert.ok(m.bodyOf[b] > 0);
  assert.equal(m.joints.length, 2, 'the axle turns in the board, and the beam on the axle');
  // two beams on a smooth pin: a joint between them
  const c = w.add(piece('beam', 3, 14, 10, 1));
  w.add(piece('pin', 2, 14, 10, 0));
  m = w.mechanism();
  assert.ok(m.bodyOf[c] !== m.bodyOf[b]);
  assert.equal(m.joints.length, 3);
  // with a tight pin they'd be one body
  const w2 = new World();
  const d = w2.add(piece('beam', 5, 10, 10, 0));
  const e = w2.add(piece('beam', 3, 14, 10, 1));
  w2.add(piece('pin', 2, 14, 10, 0, 0, true));
  assert.equal(w2.mechanism().bodyOf[d], w2.mechanism().bodyOf[e]);
  // gears on axles in the board mesh
  const w3 = new World();
  w3.add(piece('axle', 2, 5, 5, BOARD)); w3.add(piece('gear', 8, 5, 5, 0));
  w3.add(piece('axle', 2, 7, 5, BOARD)); w3.add(piece('gear', 24, 7, 5, 0));
  const m3 = w3.mechanism();
  assert.equal(m3.gears.length, 1);
  assert.equal(m3.joints.length, 2, 'each axle turns in the board');
  console.log('mechanism ok');
}

// ─── it moves ─────────────────────────────────────────────────────────────────────────────────
const run = (w, secs, ports = [], each) => {
  const mech = w.mechanism();
  const sim = new S.Sim(mech);
  const ctl = new S.Controller(ports);
  const dt = 1 / 60;
  for (let t = 0; t < secs; t += dt) { ctl.update(sim, dt); sim.step(dt); if (each) each(sim, t); }
  return { sim, mech, ctl };
};
{
  // a pendulum: a beam hanging from a pivot, pulled aside, swings through and settles below
  const w = new World();
  w.add(piece('axle', 2, 10, 15, BOARD));
  const b = w.add(piece('beam', 9, 10, 15, 0, 3)); // down from (10,15) to (10,7)
  const mech = w.mechanism();
  const sim = new S.Sim(mech);
  const body = mech.bodyOf[b];
  // (turned aside: it turns about its pivot, which is where it's held)
  sim.a[body] = 0.6;
  assert.deepEqual([sim.x[body], sim.y[body]], [10, 15], 'it turns about the pivot');
  let maxSwing = 0;
  let lowest = Infinity;
  for (let t = 0; t < 12; t += 1 / 60) { sim.step(1 / 60); maxSwing = Math.max(maxSwing, Math.abs(sim.a[body])); }
  const [px, py] = sim.pose(b, 10, 15);
  assert.ok(Math.hypot(px - 10, py - 15) < 0.05, `held at its pivot: ${px},${py}`);
  assert.ok(Math.abs(sim.a[body]) < 0.15, `settled below after swinging: ${sim.a[body]}`);
  assert.ok(maxSwing > 0.5);
  const [ex, ey] = sim.pose(b, 10, 7);
  assert.ok(Math.abs(ex - 10) < 0.6 && ey < 7.1, `its end hangs below: ${ex},${ey}`);
  console.log('pendulum ok');
}
{
  // a loose beam falls to the floor and lies there
  const w = new World();
  const b = w.add(piece('beam', 7, 10, 10, 1));
  const { sim, mech } = run(w, 4);
  const body = mech.bodyOf[b];
  const ys = [];
  for (let i = 0; i < 7; i++) ys.push(sim.pose(b, 10 + i, 10)[1]);
  for (const y of ys) assert.ok(Math.abs(y - (FLOOR + 0.5)) < 0.05, `lying on the floor: ${ys}`);
  assert.ok(sim.motion() < 0.05, 'at rest');
  console.log('fall ok');
}
{
  // the train: the motor's 8 turns the 24 the other way at a third, and the 40 the same way at a fifth
  const w = new World();
  for (const p of demo('gears').pieces) assert.ok(w.fits(p), `demo gears: ${JSON.stringify(p)} fits`), w.add(p);
  const ids = w.list().map((p, i) => i);
  const gear = (n) => w.pieces.findIndex((p) => p && p.kind === 'gear' && p.n === n);
  const { sim, mech } = run(w, 3, [{ speed: 100, rule: 'run', period: 2 }]);
  const a8 = sim.a[mech.bodyOf[gear(8)]], a24 = sim.a[mech.bodyOf[gear(24)]], a40 = sim.a[mech.bodyOf[gear(40)]];
  assert.ok(Math.abs(a8) > 10, `the motor turned it a good way: ${a8}`);
  assert.ok(Math.abs(a24 + a8 / 3) < 0.05 * Math.abs(a8), `24 at a third, the other way: ${a24} vs ${-a8 / 3}`);
  assert.ok(Math.abs(a40 - a8 / 5) < 0.05 * Math.abs(a8), `40 at a fifth: ${a40} vs ${a8 / 5}`);
  // the motor's speed: 1.5 turns a second at 100% over 3 s is 4.5 turns, less the start
  assert.ok(Math.abs(a8) > 2 * Math.PI * 3.5 && Math.abs(a8) < 2 * Math.PI * 4.6, `about four turns: ${a8 / (2 * Math.PI)}`);
  // without a hub, nothing runs
  const w2 = new World();
  for (const p of demo('gears').pieces) if (p.kind !== 'hub') w2.add(p);
  const r2 = run(w2, 1, [{ speed: 100, rule: 'run', period: 2 }]);
  assert.ok(Math.abs(r2.sim.a[r2.mech.bodyOf[w2.pieces.findIndex((p) => p && p.kind === 'gear' && p.n === 8)]]) < 0.01, 'no hub, no power');
  console.log('train ok');
}
{
  // the crank: the rocker rocks, the crank goes all the way round, nothing comes apart
  const w = new World();
  for (const p of demo('crank').pieces) assert.ok(w.fits(p), `demo crank: ${JSON.stringify(p)} fits`), w.add(p);
  const rocker = w.pieces.findIndex((p) => p && p.kind === 'beam' && p.rot === 1);
  const crank = w.pieces.findIndex((p) => p && p.kind === 'crank');
  const rod = w.pieces.findIndex((p) => p && p.kind === 'beam' && p.rot === 0 && p.n === 9);
  let lo = Infinity, hi = -Infinity;
  const { sim, mech } = run(w, 8, [{ speed: 100, rule: 'run', period: 2 }], (s) => { const a = s.a[s.mech.bodyOf[rocker]]; lo = Math.min(lo, a); hi = Math.max(hi, a); });
  assert.ok(hi - lo > 0.3, `the rocker rocks: ${lo}..${hi}`);
  assert.ok(Math.abs(sim.a[mech.bodyOf[crank]]) > 2 * Math.PI, 'the crank went round');
  // the rod's ends are still on their pins
  const [cx, cy] = sim.pose(crank, 20, 8);
  const [rx, ry] = sim.pose(rod, 20, 8);
  assert.ok(Math.hypot(cx - rx, cy - ry) < 0.05, `the rod on the crank pin: ${cx},${cy} vs ${rx},${ry}`);
  const [kx, ky] = sim.pose(rocker, 28, 8);
  const [qx, qy] = sim.pose(rod, 28, 8);
  assert.ok(Math.hypot(kx - qx, ky - qy) < 0.05, `the rod on the rocker pin`);
  console.log('crank ok');
}
{
  // the car: drops to the floor, drives, turns back at the wall, never tips
  const w = new World();
  for (const p of demo('car').pieces) assert.ok(w.fits(p), `demo car: ${JSON.stringify(p)} fits`), w.add(p);
  const chassis = w.pieces.findIndex((p) => p && p.kind === 'beam' && p.n === 9);
  const wheel = w.pieces.findIndex((p) => p && p.kind === 'wheel');
  const xs = [];
  let tipped = 0;
  const { sim, mech, ctl } = run(w, 14, [{ speed: 80, rule: 'walls', period: 2 }], (s, t) => {
    if (Math.abs(Math.round(t * 60) % 60) === 0) xs.push(s.pose(chassis, 8, 3)[0]);
    const a = s.a[s.mech.bodyOf[chassis]];
    tipped = Math.max(tipped, Math.abs(Math.atan2(Math.sin(a), Math.cos(a))));
  });
  const [wx, wy] = sim.pose(wheel, 9, 3);
  assert.ok(Math.abs(wy - (FLOOR + 2.5)) < 0.1, `wheels on the floor: ${wy}`);
  const span = Math.max(...xs) - Math.min(...xs);
  assert.ok(span > 8, `it drove: ${xs.map((x) => x.toFixed(1)).join(' ')}`);
  assert.ok(Math.max(...xs) < XMAX && Math.min(...xs) > XMIN, 'inside the walls');
  // it came back: not every reading is farther than the one before
  let turned = false;
  for (let i = 2; i < xs.length; i++) if (Math.sign(xs[i] - xs[i - 1]) !== Math.sign(xs[1] - xs[0])) turned = true;
  assert.ok(turned, `it turned at the wall: ${xs.map((x) => x.toFixed(1)).join(' ')}`);
  assert.ok(tipped < 0.5, `never tipped: ${tipped}`);
  console.log('car ok');
}
{
  // the swing: three chains, all hang from their pivots, none comes apart, they settle
  const w = new World();
  for (const p of demo('swing').pieces) assert.ok(w.fits(p), `demo swing: ${JSON.stringify(p)} fits`), w.add(p);
  const mech = w.mechanism();
  const sim = new S.Sim(mech);
  // (given a push)
  for (let b = 1; b < sim.n; b++) sim.w[b] = 3;
  let swung = 0;
  for (let t = 0; t < 20; t += 1 / 60) { sim.step(1 / 60); for (let b = 1; b < sim.n; b++) swung = Math.max(swung, Math.abs(sim.a[b])); }
  assert.ok(swung > 0.5, `they swung: ${swung}`);
  for (const j of mech.joints) {
    const [ax, ay] = sim.point(j.a, j.x, j.y);
    const [bx, by] = sim.point(j.b, j.x, j.y);
    assert.ok(Math.hypot(ax - bx, ay - by) < 0.05, 'every joint holds');
  }
  assert.ok(sim.motion() < 1, `settling: ${sim.motion()}`);
  console.log('swing ok');
}
console.log('technic ok');

// ─── marbles ──────────────────────────────────────────────────────────────────────────────────
{
  // a ramp fits by its ends; a ball above it rolls down it to the floor, the way it slopes
  const w = new World();
  const ramp = { kind: 'ramp', n: 8, m: 6, at: [4, 12], z: 0, rot: 0, colour: 0 };
  assert.ok(w.fits(ramp));
  w.add(ramp);
  w.add(piece('pin', 2, 4, 12, BOARD, 0, true));
  assert.ok(!w.fits(piece('beam', 5, 6, 10, 0)), 'a beam through the ramp\'s bar: no');
  assert.ok(w.fits(piece('beam', 5, 6, 10, 1)), 'in front of it: yes');
  const ball = w.add({ kind: 'ball', n: 0, at: [5, 13], z: 0, rot: 0, colour: 0 });
  assert.ok(!w.fits({ kind: 'ball', n: 0, at: [6, 11], z: 0, rot: 0, colour: 0 }), 'a ball in the ramp: no');
  const xs = [];
  const { sim, mech } = run(w, 5, [], (s, t) => { if (Math.round(t * 60) % 30 === 0) xs.push(s.pose(ball, 5, 13)); });
  const [bx, by] = sim.pose(ball, 5, 13);
  assert.ok(bx > 11, `it rolled off the bottom end, to the right: ${xs.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}`);
  assert.ok(Math.abs(by - (FLOOR + 0.75)) < 0.05, `and lies on the floor: ${by}`);
  assert.ok(!Number.isNaN(sim.motion()));
  // the ramp didn't move: it's pinned tight
  assert.equal(mech.bodyOf[0], 0);
  console.log('ramp ok');
}
{
  // the marble run: the balls go down both ramps and end up low and to the right, the paddles turning
  const w = new World();
  for (const p of demo('marble').pieces) assert.ok(w.fits(p), `demo marble: ${JSON.stringify(p)} fits`), w.add(p);
  const balls = w.pieces.map((p, i) => (p && p.kind === 'ball' ? i : -1)).filter((i) => i >= 0);
  const { sim } = run(w, 12, demo('marble').ports);
  for (const b of balls) {
    const p = w.pieces[b];
    const [x, y] = sim.pose(b, p.at[0], p.at[1]);
    assert.ok(y < p.at[1] - 8, `ball ${b} came down: ${x.toFixed(1)},${y.toFixed(1)}`);
    assert.ok(x > XMIN && x < XMAX, 'inside the walls');
  }
  assert.ok(!Number.isNaN(sim.motion()));
  console.log('marble ok');
}
