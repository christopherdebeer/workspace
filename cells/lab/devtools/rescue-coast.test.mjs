// Rescue · Rocky Coast's coast and rules, checked without a page (node cells/lab/devtools/rescue-coast.test.mjs [--seeds=8]):
// the coast (one shore field; little boats out in open water, apart, every one reachable; a way through the harbour
// mouth; the hull never inside a boulder), the rule (alongside and slow claims; fast or far does not; everyone climbs
// aboard, counted as they land, no one twice; drive off and the rest wait), whole races steered by the game (over, the
// places by Lily's rule, no hull past the shore), and the same seed the same race.
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const C = await load('../client/rescue-coast/coast.ts'), R = await load('../client/rescue-coast/race.ts');
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : true]));
let n = 0, bad = 0;
const ok = (name, cond, saw) => { n++; if (!cond) { bad++; console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)}` : ''}`); } };
const SEEDS = Array.from({ length: Number(opt.seeds ?? 8) }, (_, k) => k + 1);
const coasts = new Map(SEEDS.map((s) => [s, C.makeCoast(s)]));

// ─── the coast ───
for (const [seed, c] of coasts) {
  const S = (x, z) => C.shoreAt(c, x, z);
  ok(`coast ${seed}: twenty little boats or more`, c.crafts.length >= 20, c.crafts.length);
  ok(`coast ${seed}: each out in open water`, c.crafts.every((k) => S(k.x, k.z) >= 14), c.crafts.filter((k) => S(k.x, k.z) < 14).map((k) => [k.x, k.z]));
  ok(`coast ${seed}: apart`, c.crafts.every((k, i) => c.crafts.every((o, j) => i === j || Math.hypot(k.x - o.x, k.z - o.z) >= 20)));
  const folk = c.crafts.reduce((s, k) => s + k.people.length, 0);
  ok(`coast ${seed}: between 35 and 80 people waiting, one to three in each`, folk >= 35 && folk <= 80 && c.crafts.every((k) => k.people.length >= 1 && k.people.length <= 3), folk);
  const reach = C.flood(c.open, C.navIndex(c.starts[2].x, c.starts[2].z));
  ok(`coast ${seed}: every little boat can be reached from the start`, c.crafts.every((k) => reach[C.navIndex(k.x, k.z)]));
  ok(`coast ${seed}: a way through the harbour mouth to every berth`, reach[C.navIndex(c.gateX, C.GATE_Z + 8)] && c.berths.every((b) => reach[C.navIndex(b.x, b.z)]));
  ok(`coast ${seed}: the line-up and the berths in open water`, [...c.starts, ...c.berths].every((p) => S(p.x, p.z) > C.CLEAR + 4), [...c.starts, ...c.berths].map((p) => S(p.x, p.z).toFixed(1)));
  ok(`coast ${seed}: no boulder reaches past the hull's clearance`, c.rocks.every((r) => S(r.x, r.z) + Math.max(r.sx, r.sz) <= C.CLEAR + 0.3), c.rocks.filter((r) => S(r.x, r.z) + Math.max(r.sx, r.sz) > C.CLEAR + 0.3).slice(0, 3));
  ok(`coast ${seed}: lighthouses (a headland or islet, and both sides of the mouth), the station, a harbour town`, c.props.filter((p) => p.kind === 'lighthouse').length >= 3 && c.props.some((p) => p.kind === 'station') && c.props.filter((p) => p.kind === 'cottage').length >= 15);
  ok(`coast ${seed}: buoys, red and green`, c.buoys.some((b) => b.kind === 'red') && c.buoys.some((b) => b.kind === 'green'));
  ok(`coast ${seed}: buoys in open water`, c.buoys.every((b) => S(b.x, b.z) >= 8));
  ok(`coast ${seed}: land at the ground's height above the sea, the seabed below it`, [...Array(400)].every((_, i) => { const x = -280 + (i * 37) % 560, z = -180 + (i * 53) % 1300, s = S(x, z), g = C.groundAt(c, x, z); return s > 3 ? g < 0 : s < -3 ? g > -0.5 : true; }));
}

// ─── the rule: alongside and slow ───
{
  const c = coasts.get(1);
  const setup = () => { const r = R.newRace(c, { level: 'medium', mine: 0 }); R.start(r); R.runFor(r, 3.2); return r; };
  const k0 = (r) => r.crafts[0];
  const park = (r, b, across, along, v) => { const k = k0(r); b.h = 0.3; const [x, z] = R.world({ x: k.x, z: k.z, h: b.h }, -across, -along); b.x = x; b.z = z; b.v = v; };
  // (the other boats sent far off, so they can't interfere)
  const away = (r) => { for (const b of r.boats) if (b.id !== 0) { b.x = c.starts[b.id].x; b.z = c.starts[b.id].z; b.ai = null; } };
  let r = setup(); away(r); park(r, r.boats[0], 4.2, 0, 2);
  R.runFor(r, 0.2);
  ok('alongside and slow: the line goes across', k0(r).by === 0 && k0(r).stage !== 'wait', [k0(r).by, k0(r).stage]);
  const want = c.crafts[0].people.length;
  R.runFor(r, R.LINE + R.CLIMB * want + 0.5);
  ok('and everyone climbs aboard, each counted', r.boats[0].rescued === want && k0(r).stage === 'done' && k0(r).left === 0, [r.boats[0].rescued, want, k0(r).stage]);
  ok('one at a time, as they land', r.events.filter((e) => e.kind === 'aboard').length === want);
  R.runFor(r, 3);
  ok('no one twice', r.boats[0].rescued === want);
  r = setup(); away(r); park(r, r.boats[0], 4.2, 0, 9); R.step(r, 1 / 60, { throttle: 1 });
  ok('alongside but fast: nothing', k0(r).stage === 'wait', k0(r).stage);
  r = setup(); away(r); park(r, r.boats[0], 9, 0, 1); R.runFor(r, 0.5);
  ok('slow but too far off: nothing', k0(r).stage === 'wait', k0(r).stage);
  r = setup(); away(r); park(r, r.boats[0], 4.2, 0, 1); R.runFor(r, R.LINE + R.CLIMB * 0.5);
  const b0 = r.boats[0]; R.runFor(r, 4, { throttle: 1 });
  ok('drive off mid-climb: the rest let go, to wait for the next boat', want === 1 ? true : (k0(r).stage === 'wait' && k0(r).by === -1 && k0(r).left > 0), [k0(r).stage, k0(r).by, k0(r).left, b0.rescued]);
}

// ─── whole races, steered by the game ───
let lengths = [];
for (const [seed, c] of coasts) for (const level of ['easy', 'hard']) {
  const r = R.newRace(c, { level, mine: 0, auto: true }); R.start(r);
  let inside = 0;
  for (let t = 0; t < 400 && r.phase !== 'over'; t += 0.1) {
    R.runFor(r, 0.1);
    for (const b of r.boats) if (C.shoreAt(c, b.x, b.z) < R.HALF_BEAM - 0.5) inside++;
  }
  lengths.push(r.t);
  ok(`race ${seed} ${level}: over`, r.phase === 'over', [r.phase, r.t.toFixed(0), r.boats.map((b) => [b.rescued, b.finished !== null])]);
  ok(`race ${seed} ${level}: no hull inside the shore`, inside === 0, inside);
  const total = r.boats.reduce((s, b) => s + b.rescued, 0), folk = c.crafts.reduce((s, k) => s + k.people.length, 0);
  ok(`race ${seed} ${level}: most of the people rescued`, total >= folk * 0.6, [total, folk]);
  ok(`race ${seed} ${level}: someone crossed the line`, r.boats.some((b) => b.finished !== null));
  const st = R.standings(r);
  ok(`race ${seed} ${level}: the places by Lily's rule`, st.every((b, i) => i === 0 || (st[i - 1].finished !== null && b.finished === null) || (st[i - 1].finished !== null) === (b.finished !== null) && st[i - 1].rescued >= b.rescued));
  ok(`race ${seed} ${level}: no one counted twice`, r.boats.every((b) => new Set(b.aboard.map((a) => a.craft + ':' + a.person)).size === b.aboard.length) && new Set(r.boats.flatMap((b) => b.aboard.map((a) => a.craft + ':' + a.person))).size === total);
}
console.log(`  races ran ${Math.min(...lengths).toFixed(0)}–${Math.max(...lengths).toFixed(0)} s`);

// ─── the same seed, the same race ───
{
  const a = R.newRace(C.makeCoast(3), { mine: 0, auto: true }), b = R.newRace(C.makeCoast(3), { mine: 0, auto: true });
  R.start(a); R.start(b); R.runFor(a, 60); R.runFor(b, 60);
  ok('the same seed, the same race', JSON.stringify(a.boats.map((x) => [x.x.toFixed(3), x.z.toFixed(3), x.rescued])) === JSON.stringify(b.boats.map((x) => [x.x.toFixed(3), x.z.toFixed(3), x.rescued])));
}
console.log(`${n - bad} of ${n} checks hold`);
if (bad) process.exit(1);
