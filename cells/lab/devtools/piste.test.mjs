// Piste's bout, on its own (no page): the blade holds together and sags as steel does; the same intents make the
// same bout; a lunge in distance lights the lamp and bends the blade, out of distance it doesn't; a blade swept fast
// across another meets it instead of passing through; the box keeps its lockout; off the end is a touch against;
// two stand-ins fence a whole bout. (node cells/lab/devtools/piste.test.mjs)
import { build } from 'esbuild';
import { checks } from './harness.mjs';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './bout'; export * from './weapons'; export * from './ai'; export * from './box'; export * from './intent'; export * from './v3'; export * from './blade'; export * from './contact';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { Bout, EPEE, FOIL, Opponent, SPARRING, Box, award, idle } = M;
const c = checks();
const DT = 1 / 60;

/** run a bout with a function giving each fencer's intent, for `secs` */
function run(b, secs, decide) {
  const ev = [];
  for (let s = 0; s < secs; s += DT) {
    for (const k of [0, 1]) b.fencers[k].intent = { ...decide(k, b, s) };
    b.advance(DT);
    ev.push(...b.drain());
  }
  return ev;
}
const still = () => idle();
/** put the fencers so their fronts are `gap` apart, and start fencing */
function at(b, gap) {
  const [A, B] = b.fencers, now = b.gap;
  A.reset(A.s + (now - gap) / 2); B.reset(B.s - (now - gap) / 2);
  b.phase = 'fence'; b.phaseAt = b.t;
}

// the blade at rest, en garde: whole, near its target, bowed a little by its own weight and set
{
  const b = new Bout({ weapon: EPEE, to: 5 });
  run(b, 3, still);
  const A = b.fencers[0], bl = A.blade, tg = [...bl.target.slice(3)];
  const off = Math.hypot(bl.guard[0] - tg[0], bl.guard[1] - tg[1], bl.guard[2] - tg[2]);
  c.ok('the blade keeps its length (strain < 0.1%)', bl.strain() < 1e-3, bl.strain());
  c.ok('the guard is where the hand sends it (< 1 cm)', off < 0.01, off);
  c.ok('the blade bows 0.5–5 cm at rest (weight and set)', bl.bow() > 0.005 && bl.bow() < 0.05, bl.bow());
  const len = Math.hypot(...[0, 1, 2].map((k) => bl.tip[k] - bl.guard[k]));
  c.ok('guard to tip is the blade (0.89–0.9 m)', len > 0.885 && len <= 0.901, len);
}

// the same intents, the same bout
{
  const go = () => { const b = new Bout({ weapon: EPEE, to: 5 }), ai = [new Opponent(b, 0, SPARRING, 5), new Opponent(b, 1, SPARRING, 6)]; run(b, 12, (k) => ai[k].intent(DT)); return [...b.fencers[0].blade.x, ...b.fencers[1].blade.x, ...b.score]; };
  const a = go(), z = go();
  c.ok('deterministic: two runs of the same bout end identically', a.every((v, i) => v === z[i]), a.slice(0, 3));
}

// a straight-arm lunge in distance against a still opponent: a light for the attacker only, the blade bent
const lunge = (k, b, s) => (k === 0 ? { ...idle(), extend: 1, lunge: s > 0.3 } : idle());
{
  const b = new Bout({ weapon: EPEE, to: 5 });
  at(b, 1.15);
  let bow = 0;
  const ev = [];
  for (let s = 0; s < 1.2; s += DT) {
    for (const k of [0, 1]) b.fencers[k].intent = { ...lunge(k, b, s) };
    b.advance(DT); ev.push(...b.drain());
    bow = Math.max(bow, b.fencers[0].blade.bow());
  }
  const lights = ev.filter((e) => e.type === 'light');
  c.ok('a lunge in distance lights the attacker’s lamp', lights.some((e) => e.who === 0 && e.light.valid), lights.map((e) => [e.who, e.light.part]));
  c.ok('…and not the other’s', !lights.some((e) => e.who === 1), lights.map((e) => e.who));
  c.ok('the blade bends on the hit (bow > 4 cm)', bow > 0.04, bow);
  c.ok('the blade survives it (strain < 1%)', b.fencers[0].blade.strain() < 0.01, b.fencers[0].blade.strain());
  console.log(`      (lit on ${lights[0]?.light.part}; bowed ${(bow * 100).toFixed(1)} cm)`);
}
// out of distance: nothing
{
  const b = new Bout({ weapon: EPEE, to: 5 });
  at(b, 3.0);
  const ev = run(b, 1.2, lunge);
  c.ok('a lunge out of distance lights nothing', !ev.some((e) => e.type === 'light'), ev.filter((e) => e.type === 'light'));
}
// a light touch doesn't close the tip: arm extended slowly onto the chest without a lunge, from just in reach
{
  const b = new Bout({ weapon: EPEE, to: 5 });
  at(b, 1.0);
  b.fencers[0].blade.muscle.fGuard = 3; b.fencers[0].blade.muscle.fPommel = 2;
  const ev = run(b, 1.5, (k) => (k === 0 ? { ...idle(), extend: 1 } : idle()));
  c.ok('a hand too weak to press 750 g home lights nothing', !ev.some((e) => e.type === 'light' && e.who === 0), b.peak);
}

// a beat: a blade swept hard across another meets it and knocks it aside
{
  const b = new Bout({ weapon: EPEE, to: 5 });
  // (far enough that the blades cross at their middles, not on a guard)
  at(b, 1.85);
  const [A, B] = b.fencers;
  run(b, 0.6, () => ({ ...idle(), extend: 0.6 }));
  const tip0 = B.blade.tip;
  // A's hand thrown across from its right to its left (a beat in quarte) as fast as the arm will
  const ev = run(b, 0.25, (k) => (k === 0 ? { ...idle(), extend: 0.6, hand: [-0.22, 0], point: [-0.6, 0] } : { ...idle(), extend: 0.6 }));
  const clash = ev.filter((e) => e.type === 'clash');
  const moved = Math.hypot(...[0, 1, 2].map((k) => B.blade.tip[k] - tip0[k]));
  c.ok('a beat meets the other blade (a clash)', clash.length > 0, clash.length);
  c.ok('…and knocks it aside (its tip moves > 5 cm)', moved > 0.05, moved);
  console.log(`      (met at ${clash[0]?.strength.toFixed(2)} m/s; their tip moved ${(moved * 100).toFixed(1)} cm)`);
}
// a blade thrown at another at 20 m/s (more than any arm) bounces off it rather than passing through
{
  const { Blade } = M;
  const held = new Blade(EPEE, [0, 1, 0], [0.11, 1, 0]);
  const thrown = new Blade(EPEE, [0.5, 1.06, -0.5], [0.5, 1.06, -0.39]);
  thrown.muscle.fPommel = thrown.muscle.fGuard = 0; thrown.muscle.omega = 0;
  for (let i = 0; i < thrown.n; i++) thrown.vel[i * 3 + 1] = -20;
  const { BladePair } = await import('data:text/javascript;base64,' + Buffer.from((await build({ stdin: { contents: `export * from './contact';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' })).outputFiles[0].text).toString('base64'));
  const pair = new BladePair(held, thrown), st = { clash: 0, at: [0, 0, 0], touching: false };
  let met = 0;
  for (let s = 0; s < 400; s++) {
    for (const bl of [held, thrown]) bl.predict(1 / 2000);
    for (const bl of [held, thrown]) bl.solve(1 / 2000);
    pair.solve(st); if (st.clash) met = Math.max(met, st.clash);
    for (const bl of [held, thrown]) bl.solve(1 / 2000);
    for (const bl of [held, thrown]) bl.finish(1 / 2000);
  }
  // where the thrown blade crosses x = 0.5 (its own z ≈ 0 node), it's above the held one's line there
  let below = 0;
  for (let i = 2; i < thrown.n; i++) { const p = thrown.at(i); if (Math.abs(p[2]) < 0.04 && p[1] < held.at(8)[1]) below++; }
  c.ok('a blade thrown at 20 m/s meets the other', met > 10, met);
  c.ok('…and doesn’t pass through it', below === 0, below);
}

// the box: lockout, doubles, off target
{
  const box = new Box(EPEE);
  box.register(0, 1.0, 'torso'); box.register(1, 1.03, 'arm');
  c.ok('épée: a touch inside 45 ms of the first is a double', box.lights[0] && box.lights[1]);
  c.ok('épée: a double is a point each', award(EPEE, box.lights).points.join() === '1,1');
  const late = new Box(EPEE);
  late.register(0, 1.0, 'torso'); late.register(1, 1.06, 'arm');
  c.ok('épée: a touch after the lockout doesn’t register', late.lights[0] && !late.lights[1]);
  const foil = new Box(FOIL);
  foil.register(1, 2, 'leg');
  c.ok('foil: a leg is off target (white, no point)', foil.lights[1] && !foil.lights[1].valid && award(FOIL, foil.lights).points.join() === '0,0');
  const dwell = new Box(EPEE);
  for (let i = 0; i < 3; i++) dwell.tip(0, i * 0.0005, 0.0005, 'torso');
  c.ok('a tip closed for less than the dwell doesn’t register', !dwell.lights[0]);
  dwell.tip(0, 0.002, 0.0005, 'torso');
  c.ok('…and does once it has been closed for the dwell', !!dwell.lights[0]);
}

// off the end of the piste: a touch against
{
  const b = new Bout({ weapon: EPEE, to: 5 });
  b.phase = 'fence';
  let k = 0;
  const ev = run(b, 6, (who) => (who === 0 && (k++ % 25 === 0) ? { ...idle(), step: 'retreat' } : idle()));
  const l = ev.find((e) => e.type === 'light');
  c.ok('retreating off the end is a touch against', l && l.who === 1, l);
}

// two stand-ins fence a bout to five
{
  const b = new Bout({ weapon: EPEE, to: 5 }), ai = [new Opponent(b, 0, SPARRING, 3), new Opponent(b, 1, SPARRING, 4)];
  const t0 = performance.now();
  const ev = run(b, 240, (k) => (b.phase === 'over' ? idle() : ai[k].intent(DT)));
  const ms = performance.now() - t0, simulated = b.t;
  c.ok('two stand-ins finish a bout to five', b.phase === 'over' && Math.max(...b.score) === 5, b.score);
  c.ok('it runs faster than real time by 5× or more', ms / 1000 < simulated / 5, { ms, simulated });
  const parts = ev.filter((e) => e.type === 'light').map((e) => e.light.part);
  console.log(`      (${b.score.join('–')} in ${simulated.toFixed(0)} s, ${ms.toFixed(0)} ms; touches on ${parts.join(', ')})`);
}
c.done();
