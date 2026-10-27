// Rescue · Rocky Coast's coast and rules, checked without a page (node cells/lab/devtools/rescue-coast.test.mjs [--seeds=8]):
// the coast (one shore field; little boats out in open water, apart, every one reachable; a way through the harbour
// mouth; the hull never inside a boulder), the rule (alongside and slow claims; fast or far does not; everyone climbs
// aboard, counted as they land, no one twice; drive off and the rest wait), whole races steered by the game (over, the
// places by Lily's rule, no hull past the shore), and the same seed the same race. Then the Rescue Service: its own coast
// (the harbour with its pier, the open sea past the headland, the calls by zone), its rules (the calls coming in, room
// for everyone, landing them on the pier, holding steady in a swell), whole days with the weather changing, and the same seed
// the same day.
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const C = await load('../client/rescue-coast/coast.ts'), R = await load('../client/rescue-coast/race.ts'), WX = await load('../client/rescue-coast/weather.ts');
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
// ─── the Rescue Service: the same five crews, working together ───
const W = await load('../client/rescue-coast/waves.ts');
for (const [seed, c] of coasts) {
  // (the exposure: open water exposed, some sheltered water in the lee of the land)
  let open = 0, lee = 0, water = 0;
  for (let j = 0; j < C.NEZ; j++) for (let i = 0; i < C.NEX; i++) { const x = C.X0 + i * C.EXPO, z = C.Z0 + j * C.EXPO; if (z > C.GATE_Z || C.shoreAt(c, x, z) < 10) continue; water++; const e = c.exposure[j * C.NEX + i]; if (e > 0.85) open++; if (e < 0.55) lee++; }
  ok(`coast ${seed}: water both open to the swell and in the lee of the land`, open > water * 0.25 && lee > water * 0.05, [open, lee, water]);
  ok(`coast ${seed}: calm inside the harbour`, C.exposureAt(c, c.gateX, C.GATE_Z + 60) < 0.5, C.exposureAt(c, c.gateX, C.GATE_Z + 60));
}

// (the Service's own coast: the little harbour with its pier and station by the mouth, the crews moored along the pier;
// the approach past the harbour's headland and its lighthouse; then the far shore gone and the open sea, the swell
// bigger well out; the calls, nearest first, the bigger ones out at sea; the Rally's coast for the same seed untouched)
const sea = new Map(SEEDS.map((s) => [s, C.makeCoast(s, 'service')]));
// (the moored boats' hulls: half length, half breadth)
const HULL = { row: [1.65, 0.8], sail: [1.85, 0.8], fishing: [2.6, 1.0], yacht: [3.1, 1.15], kayak: [1.8, 0.4] };
for (const [seed, c] of sea) {
  const S = (x, z) => C.shoreAt(c, x, z), P = c.pier;
  ok(`service coast ${seed}: its own kind, the same name as the Rally's`, c.kind === 'service' && coasts.get(seed).kind === 'rally' && c.name === coasts.get(seed).name);
  ok(`service coast ${seed}: a pier out into the harbour, inside the mouth`, P && P.z0 > C.GATE_Z + 30 && S((P.x1 + P.x1 - 20) / 2, (P.z0 + P.z1) / 2) < 0 && S(P.x1 + 6, (P.z0 + P.z1) / 2) > 2, P);
  ok(`service coast ${seed}: the station by the mouth`, c.props.some((p) => p.kind === 'station' && p.z > C.GATE_Z && p.z < C.GATE_Z + 60));
  ok(`service coast ${seed}: the crews moored along the pier, in open water, bows the same way`, c.starts.every((p) => p.z > P.z1 && p.z < P.z1 + 12 && p.x < P.x1 && S(p.x, p.z) > C.CLEAR + 3) && c.berths.every((b, i) => b.x === c.starts[i].x && b.z === c.starts[i].z), c.starts.map((p) => S(p.x, p.z).toFixed(1)));
  const reach = C.flood(c.open, C.navIndex(c.starts[2].x, c.starts[2].z));
  ok(`service coast ${seed}: every little boat can be reached from the pier`, c.crafts.every((k) => reach[C.navIndex(k.x, k.z)]));
  ok(`service coast ${seed}: the lighthouse on the harbour's headland, across the approach`, c.props.some((p) => p.kind === 'lighthouse' && p.v === 0 && p.x > c.gateX && p.z > C.GATE_Z - 300 && p.z < C.GATE_Z - 80));
  const rows = Array.from({ length: 41 }, (_, i) => 150 + i * 10), seaward = rows.filter((z) => S(C.X1 - C.EDGE, z) > 30).length;
  ok(`service coast ${seed}: past the headland the far shore falls away: open sea out to the chart's edge`, seaward > rows.length * 0.6 && S(C.X1 - C.EDGE, C.GATE_Z - 120) < 0, [seaward, rows.length]);
  let rough = 0, wet = 0;
  for (let j = 0; j < C.NEZ; j++) for (let i = 0; i < C.NEX; i++) { const z = C.Z0 + j * C.EXPO; if (z < 150 || z > 550 || C.shoreAt(c, C.X0 + i * C.EXPO, z) < 10) continue; wet++; if (c.exposure[j * C.NEX + i] > 1.15) rough++; }
  ok(`service coast ${seed}: the swell bigger well out at sea (more than open), calm in the harbour`, rough > wet * 0.25 && C.seaAt(c, c.gateX, C.GATE_Z + 70) < 0.5, [rough, wet, C.seaAt(c, c.gateX, C.GATE_Z + 70).toFixed(2)]);
  ok(`service coast ${seed}: no route out past the edge of the search area`, [[C.X1 - 10, 300], [100, C.Z0 + 10], [C.X1 - 20, 0]].every(([x, z]) => !c.open[C.navIndex(x, z)]));
  ok(`service coast ${seed}: no boulder reaches past the hull's clearance`, c.rocks.every((r) => S(r.x, r.z) + Math.max(r.sx, r.sz) <= C.CLEAR + 0.3));
  ok(`service coast ${seed}: buoys in open water, up the approach`, c.buoys.every((b) => S(b.x, b.z) >= 8) && c.buoys.some((b) => b.kind === 'red') && c.buoys.some((b) => b.kind === 'green'));
  const zones = [0, 1, 2].map((z) => c.crafts.filter((k) => k.zone === z)), mean = (l) => l.reduce((n, k) => n + k.people.length, 0) / l.length;
  ok(`service coast ${seed}: calls near the harbour, along the coast, and out at sea`, zones.every((l) => l.length >= 4) && c.crafts.length >= 16, zones.map((l) => l.length));
  const meanAt = (l) => l.reduce((n, k) => n + k.at, 0) / l.length;
  ok(`service coast ${seed}: three waiting as the crews set out; the rest called through the day, the furthest last`, c.crafts.filter((k) => k.at === 0).length === 3 && Math.max(...c.crafts.map((k) => k.at)) < 160 && meanAt(zones[0]) < meanAt(zones[1]) && meanAt(zones[1]) < meanAt(zones[2]), zones.map((l) => meanAt(l).toFixed(0)));
  ok(`service coast ${seed}: bigger groups out at sea than by the harbour`, mean(zones[2]) > mean(zones[0]), [mean(zones[0]).toFixed(1), mean(zones[2]).toFixed(1)]);
  ok(`service coast ${seed}: the little boats out in open water and apart`, c.crafts.every((k) => S(k.x, k.z) >= 14) && c.crafts.every((k, i) => c.crafts.every((o, j) => i === j || Math.hypot(k.x - o.x, k.z - o.z) >= 28)));
  // (harbour life: jetties out from the quay, boats along them and alongside the quay wall, more swinging at buoys, lamps
  // and bunting on the pier; nothing laid over anything else, none of it in the mouth's lane or by the crews' berths,
  // and no route through it)
  const H = c.harbour, jetties = c.props.filter((p) => p.kind === 'jetty'), quay = jetties.filter((j) => S(j.x, j.z) < 3);
  const tip = (j) => [j.x + Math.sin(j.yaw) * j.v, j.z + Math.cos(j.yaw) * j.v];
  ok(`service coast ${seed}: jetties out from the quay into the harbour, a lamp at each end`, quay.length >= 6 && quay.every((j) => S(...tip(j)) > 4) && c.props.filter((p) => p.kind === 'lamp').length >= quay.length + 3, [quay.length, quay.map((j) => S(...tip(j)).toFixed(0))]);
  ok(`service coast ${seed}: bunting along the pier`, c.props.filter((p) => p.kind === 'bunting').length >= 3);
  ok(`service coast ${seed}: boats moored there: rowing boats, dinghies, fishing boats, yachts; some out at buoys`, c.moored.length >= 50 && c.moored.filter((m) => m.buoy).length >= 6 && ['row', 'sail', 'fishing', 'yacht'].every((k) => c.moored.some((m) => m.kind === k)), [c.moored.length, c.moored.filter((m) => m.buoy).length]);
  const box = (x, z, yaw, l, b) => ({ x, z, yaw, l, b });
  const clash = (A, B) => [A.yaw, A.yaw + Math.PI / 2, B.yaw, B.yaw + Math.PI / 2].every((a) => { const along = (q) => q.l * Math.abs(Math.cos(q.yaw - a)) + q.b * Math.abs(Math.sin(q.yaw - a)); return Math.abs((B.x - A.x) * Math.sin(a) + (B.z - A.z) * Math.cos(a)) <= along(A) + along(B); });
  const hulls = c.moored.map((m) => box(m.x, m.z, m.yaw, HULL[m.kind][0], HULL[m.kind][1])), decks = jetties.map((j) => box(...tip(j).map((v, n) => (v + [j.x, j.z][n]) / 2), j.yaw, j.v / 2, 1.5));
  let laidOver = 0;
  hulls.forEach((a, n) => { laidOver += hulls.slice(n + 1).filter((b) => clash(a, b)).length + decks.filter((d) => clash(a, d)).length; });
  ok(`service coast ${seed}: no boat moored over another, or over a jetty; all afloat`, laidOver === 0 && c.moored.every((m) => S(m.x, m.z) > HULL[m.kind][1] + 0.5), laidOver);
  ok(`service coast ${seed}: none of it in the mouth's lane or by the crews' berths`, [...c.moored, ...jetties.map((j) => ({ x: tip(j)[0], z: tip(j)[1] }))].every((m) => !(m.z < H.z - 30 && Math.abs(m.x - c.gateX) < 45) && c.berths.every((b) => Math.hypot(b.x - m.x, b.z - m.z) >= 18)));
  ok(`service coast ${seed}: no route through a jetty or a moored boat, and every crew can get out of the harbour`, c.snags.length > 100 && c.snags.every((q) => !c.open[C.navIndex(q.x, q.z)]) && c.starts.every((p) => [[0, 0], [0, 4], [4, 0], [-4, 0], [0, 8], [4, 4], [-4, 4]].some(([dx, dz]) => reach[C.navIndex(p.x + dx, p.z + dz)])) && reach[C.navIndex(c.gateX, C.GATE_Z - 30)]);
}

// (the rules: room for everyone found; home, they step ashore in the harbour, and not out on the water)
{
  const c = sea.get(1), r = R.newRace(c, { mode: 'service', level: 'medium', mine: 0 }); R.start(r); R.runFor(r, 3.2);
  for (const b of r.boats) if (b.id) b.ai = null;
  const me = r.boats[0], k = r.crafts.find((q) => q.called), many = 9;
  me.aboard = Array.from({ length: many }, () => ({ craft: k.craft.id, person: 0 })); me.rescued = many;
  k.craft.people = [k.craft.people[0], k.craft.people[0], k.craft.people[0]]; k.left = 3;
  me.h = 0.3; [me.x, me.z] = R.world({ x: k.x, z: k.z, h: me.h }, -4.2, 0); me.v = 1;
  for (let t = 0; t < 20 && k.left > 0; t += 0.5) R.runFor(r, 0.5);
  ok('service: however many are aboard already, everyone waiting climbs aboard', me.aboard.length === many + 3 && k.left === 0 && k.stage === 'done', [me.aboard.length, k.left, k.stage]);
  [me.x, me.z] = [c.gateX, C.GATE_Z - 30]; me.h = 0; me.v = 3; r.events.length = 0;
  R.runFor(r, 2);
  ok('service: no one steps ashore out on the water', me.aboard.length === many + 3 && r.ashore.length === 0);
  [me.x, me.z] = [c.gateX, R.INSIDE + 8]; me.v = 2;
  R.runFor(r, R.LAND * (many + 3) + 0.3);
  ok('service: in the harbour they step ashore, one at a time, counted safe', me.aboard.length === 0 && me.safe === many + 3 && r.ashore.length === many + 3 && r.events.filter((e) => e.kind === 'ashore').length === many + 3, [me.aboard.length, me.safe, r.ashore.length]);
  ok('service: still people out there, so not in for the day', me.finished === null);
}
// (driven flat out at a jetty side on: it bumps, and is held off; it doesn't go through)
{
  const c = sea.get(3), r = R.newRace(c, { mode: 'service', level: 'medium', mine: 0 }); R.start(r); R.runFor(r, 3.2);
  for (const b of r.boats) if (b.id) b.ai = null;
  const j = c.props.filter((p) => p.kind === 'jetty' && C.shoreAt(c, p.x, p.z) < 3).sort((a, b) => b.v - a.v)[0], me = r.boats[0];
  const ax = Math.sin(j.yaw), az = Math.cos(j.yaw), mx = j.x + ax * j.v * 0.6, mz = j.z + az * j.v * 0.6, side = (x, z) => Math.sign(-(x - j.x) * az + (z - j.z) * ax);
  [me.x, me.z] = [mx - az * 14, mz + ax * 14]; me.h = Math.atan2(mx - me.x, mz - me.z); me.v = 0;
  const from = side(me.x, me.z);
  let closest = 1e9;
  for (let t = 0; t < 6; t += 0.1) { R.step(r, 0.1, { throttle: 1, steer: 0 }); for (const q of c.snags) closest = Math.min(closest, Math.hypot(me.x - q.x, me.z - q.z) - q.r); }
  ok('service: flat out at a jetty: a bump, held off, still on the side it came from', r.events.some((e) => e.kind === 'bump' && e.boat === 0) && closest > 1.2 && side(me.x, me.z) === from, [closest.toFixed(2), side(me.x, me.z), from]);
}
// (the calls: not there till they come in; then there, unless a lifeboat's right by them (they wait a little for it to go))
{
  const c = sea.get(2), r = R.newRace(c, { mode: 'service', level: 'medium', mine: 0 }); R.start(r); R.runFor(r, 3.2);
  for (const b of r.boats) if (b.id) b.ai = null;
  const k = r.crafts.filter((q) => !q.called).sort((a, b) => a.craft.at - b.craft.at)[0], me = r.boats[0];
  me.h = 0.3; [me.x, me.z] = R.world({ x: k.x, z: k.z, h: me.h }, -4.2, 0); me.v = 0;
  R.runFor(r, Math.max(0.5, k.craft.at - r.t - 1));
  ok('service: a little boat whose call hasn\'t come is not taken aboard, even alongside', !k.called && k.stage === 'wait' && k.left === k.craft.people.length && me.aboard.length === 0, [k.called, k.stage, me.aboard.length]);
  R.runFor(r, 3);
  ok('service: with a lifeboat right there, the call waits', !k.called);
  [me.x, me.z] = [c.starts[0].x, c.starts[0].z];
  R.runFor(r, 0.5);
  ok('service: once it\'s gone, the call comes in', k.called && r.events.some((e) => e.kind === 'call' && e.craft === k.craft.id));
}
// (the weather through the day: a story per seed from where it starts; blended, the sea following it in the race)
{
  const legs = WX.voyage(1, 'sunny');
  ok('weather: a voyage starts in the weather chosen, then changes', legs[0].w === 'sunny' && legs[0].at === 0 && legs.length >= 2 && legs.every((l, i) => i === 0 || l.at > legs[i - 1].at));
  const kinds = new Set(SEEDS.concat([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]).map((s) => WX.voyage(s, 'sunny').map((l) => l.w).join('>')));
  ok('weather: different seeds, different days', kinds.size >= 4, [...kinds]);
  const mid = WX.weatherAt(legs, legs[1].at + WX.TURN / 2), a = WX.WEATHERS[legs[0].w], b = WX.WEATHERS[legs[1].w];
  ok('weather: half way through a change, in between', Math.abs(mid.height - (a.height + b.height) / 2) < 1e-6 && Math.abs(mid.skyTop[0] - (a.skyTop[0] + b.skyTop[0]) / 2) < 1e-6);
  ok('weather: the sea the race reads is the weather drawn', SEEDS.every((s) => { const L = WX.voyage(s, 'calm'); return [0, 50, 95, 130, 175, 260].every((t) => Math.abs(WX.seaOf(L, t)[0] - WX.weatherAt(L, t).height) < 1e-9); }));
  const all = Object.values(WX.WEATHERS).map((w) => w.name);
  ok('weather: every start has its stories, and the night stays night or dawns', all.every((w) => SEEDS.every((s) => WX.voyage(s, w)[0].w === w)) && SEEDS.every((s) => WX.voyage(s, 'night').slice(1).every((l) => l.w !== 'stormy' && l.w !== 'foggy')));
}

// (whole days, steered by the game: everyone home, the rules kept all day)
const serviceLengths = [];
for (const [seed, c] of sea) for (const level of ['easy', 'hard']) {
  const r = R.newRace(c, { mode: 'service', level, mine: 0, auto: true, sky: WX.voyage(seed, 'sunny') }); R.start(r);
  let inside = 0, through = 0, doubled = 0, unclaimed = 0, early = 0, out = 0, homeEarly = 0;
  const calledAt = new Map();
  for (let t = 0; t < 1500 && r.phase !== 'over'; t += 0.25) {
    R.runFor(r, 0.25);
    for (const b of r.boats) if (C.shoreAt(c, b.x, b.z) < R.HALF_BEAM - 0.5) inside++;
    for (const b of r.boats) if (c.snags.some((q) => Math.hypot(b.x - q.x, b.z - q.z) < q.r + 1.2)) through++;
    // (no crew heads home while there's anyone left to find)
    if (r.crafts.some((k) => !k.called || k.left > 0)) for (const b of r.boats) if (b.ai?.target === -1 && b.z < C.GATE_Z - 40 && r.crafts.some((k) => k.called && k.left > 0 && k.claim === -1 && k.stage === 'wait')) homeEarly++;
    for (const e of r.events.splice(0)) {
      if (e.kind === 'call') calledAt.set(e.craft, r.t);
      if (e.kind === 'aboard' && !r.crafts[e.craft].called) early++;
      if (e.kind === 'ashore' && r.boats[e.boat].z <= R.INSIDE) out++;
    }
    // (no two crews going for the same little boat; every crew's choice claimed by it)
    const going = r.boats.filter((b) => b.ai && b.finished === null && b.ai.target >= 0 && r.crafts[b.ai.target].stage === 'wait').map((b) => b.ai.target);
    if (new Set(going).size < going.length) doubled++;
    for (const b of r.boats) if (b.ai && b.finished === null && b.ai.target >= 0 && r.crafts[b.ai.target].stage === 'wait' && r.crafts[b.ai.target].claim !== b.id) unclaimed++;
  }
  serviceLengths.push(r.t);
  const total = r.boats.reduce((s, b) => s + b.rescued, 0), folk = c.crafts.reduce((s, k) => s + k.people.length, 0);
  ok(`service ${seed} ${level}: over, everyone ashore and every lifeboat in`, r.phase === 'over' && total === folk && r.ashore.length === folk && r.boats.every((b) => b.finished !== null && b.aboard.length === 0), [r.phase, r.t.toFixed(0), total, r.ashore.length, folk]);
  ok(`service ${seed} ${level}: in three to six minutes`, r.t > 180 && r.t < 360, r.t.toFixed(0));
  ok(`service ${seed} ${level}: no hull inside the shore`, inside === 0, inside);
  ok(`service ${seed} ${level}: no hull through a jetty or a moored boat`, through === 0, through);
  ok(`service ${seed} ${level}: ashore only in the harbour; no crew heading home with someone left waiting for it`, out === 0 && homeEarly === 0, [out, homeEarly]);
  ok(`service ${seed} ${level}: the calls at their times, no one taken before theirs`, early === 0 && [...calledAt].every(([id, t]) => t >= c.crafts[id].at), early);
  ok(`service ${seed} ${level}: no two crews after the same little boat; each going for one it has claimed`, doubled === 0 && unclaimed === 0, [doubled, unclaimed]);
  ok(`service ${seed} ${level}: no one counted twice`, new Set(r.ashore.map((a) => a.craft + ':' + a.person)).size === total);
  ok(`service ${seed} ${level}: no last call, so no one is left behind for one`, !r.lastCall || r.lastCall.length === 0);
}
console.log(`  service days ran ${Math.min(...serviceLengths).toFixed(0)}–${Math.max(...serviceLengths).toFixed(0)} s`);
{
  // (in a storm too: the sea's height is the weather's, kept to it by the race (steadiness, drift), as drawn)
  const o = await build({ stdin: { contents: "export * as R from './race'; export { SEA } from './waves'; export * as WX from './weather';", resolveDir: new URL('../client/rescue-coast/', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
  const { R: RS, SEA, WX: WS } = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
  for (const seed of SEEDS.slice(0, 4)) {
    const c = sea.get(seed), sky = WS.voyage(seed, 'stormy'), r = RS.newRace(c, { mode: 'service', level: 'easy', mine: 0, auto: true, sky }); RS.start(r);
    RS.runFor(r, 40);
    const kept = Math.abs(SEA.height - WS.seaOf(sky, r.t)[0]) < 1e-6 && SEA.height > 2;
    RS.runFor(r, 1500);
    const folk = c.crafts.reduce((n, k) => n + k.people.length, 0);
    ok(`service ${seed} in a storm: the sea the storm's; everyone ashore, every lifeboat in`, kept && r.phase === 'over' && r.ashore.length === folk && r.t < 1500, [kept, r.phase, r.t.toFixed(0), r.ashore.length, folk]);
  }
}
{
  // (taking one over: a crew going for a little boat leaves it to you when you're well nearer, and says so)
  const c = sea.get(1), r = R.newRace(c, { mode: 'service', mine: 0 }); R.start(r); R.runFor(r, 3.2);
  const ai = r.boats[1], k = r.crafts.find((q) => q.stage === 'wait' && q.called);
  ai.ai.target = k.craft.id; k.claim = ai.id; ai.ai.think = 5; [ai.x, ai.z] = [k.x + 30, k.z - 30];
  const me = r.boats[0]; [me.x, me.z] = R.world({ x: k.x, z: k.z, h: 0 }, 0, -12); me.h = 0; me.v = 2;
  for (const b of r.boats) if (b.id > 1) { b.ai = null; b.x = c.starts[b.id].x; b.z = c.starts[b.id].z; }
  R.runFor(r, 0.5, { throttle: 0.1 });
  ok('service: nearer, you take it over; they leave it to you and say so', k.claim === 0 && r.events.some((e) => e.kind === 'yield' && e.boat === 1 && e.to === 0) && ai.ai.target !== k.craft.id, [k.claim, ai.ai.target, r.events.map((e) => e.kind)]);
}
{
  // (holding steady: the little boat in the lee of the hull climbs across sooner than one on the side the sea comes from;
  // sheltered water sooner than open)
  const c = coasts.get(1);
  const clearTime = (leeSide, where) => {
    const r = R.newRace(c, { mode: 'service', mine: 0, sky: [{ at: 0, w: 'sunny' }] }); R.start(r); R.runFor(r, 3.2);
    for (const b of r.boats) if (b.id) { b.ai = null; b.x = c.starts[b.id].x; b.z = c.starts[b.id].z; }
    const k = r.crafts[0], me = r.boats[0];
    if (where) { k.x = where[0]; k.z = where[1]; }
    k.craft.people = [k.craft.people[0], k.craft.people[0], k.craft.people[0]]; k.left = 3;
    // (beam-on to the swell: the heading at right angles to the way it runs)
    me.h = Math.atan2(W.SWELL[1], -W.SWELL[0]);
    const right = [-Math.cos(me.h), Math.sin(me.h)], leeIsRight = right[0] * W.SWELL[0] + right[1] * W.SWELL[1] > 0;
    const across = (leeSide === leeIsRight ? -1 : 1) * 4.2;
    [me.x, me.z] = R.world({ x: k.x, z: k.z, h: me.h }, across, 0); me.v = 0;
    let t = 0; while (k.left > 0 && t < 30) { R.step(r, 1 / 30, {}); t += 1 / 30; }
    return t;
  };
  let open = null, shel = null;
  for (let j = 0; j < C.NEZ && (!open || !shel); j++) for (let i = 0; i < C.NEX; i++) {
    const x = C.X0 + i * C.EXPO, z = C.Z0 + j * C.EXPO;
    if (z > C.GATE_Z - 40 || z < 40 || C.shoreAt(c, x, z) < 22) continue;
    const e = c.exposure[j * C.NEX + i];
    if (!open && e > 0.95) open = [x, z]; if (!shel && e < 0.45) shel = [x, z];
  }
  const tLee = clearTime(true, open), tWind = clearTime(false, open), tShel = clearTime(false, shel);
  ok('service: in the lee of the hull they climb across sooner than on the weather side', tLee < tWind * 0.8, [tLee.toFixed(2), tWind.toFixed(2)]);
  ok('service: in sheltered water sooner than out in the open', tShel < tWind * 0.85, [tShel.toFixed(2), tWind.toFixed(2)]);
  ok('service: never failing — everyone across even on the weather side in the open', tWind < 30, tWind);
}
{
  const a = R.newRace(C.makeCoast(3, 'service'), { mode: 'service', mine: 0, auto: true, sky: WX.voyage(3, 'sunny') }), b = R.newRace(C.makeCoast(3, 'service'), { mode: 'service', mine: 0, auto: true, sky: WX.voyage(3, 'sunny') });
  R.start(a); R.start(b); R.runFor(a, 90); R.runFor(b, 90);
  ok('the same seed, the same day at sea', JSON.stringify(a.boats.map((x) => [x.x.toFixed(3), x.z.toFixed(3), x.rescued, x.safe])) === JSON.stringify(b.boats.map((x) => [x.x.toFixed(3), x.z.toFixed(3), x.rescued, x.safe])));
}

console.log(`${n - bad} of ${n} checks hold`);
if (bad) process.exit(1);
