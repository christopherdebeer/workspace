// The rescue race's sea and rules, checked without a page (node cells/lab/devtools/rescue.test.mjs [--seeds=12]):
// the sea (tiny boats in deep water, apart, reachable from the start; a way to the finish), the rule (near enough
// claims, everyone lands, counted on landing, no one taken twice, nothing from too far), whole races steered by the
// game (over, the places by Lily's rule, no boat aground, the last call kept), steering, and the same seed the same race.
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const S = await load('../client/rescue/sea.ts'), R = await load('../client/rescue/race.ts');
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : true]));
let n = 0, bad = 0;
const ok = (name, cond, saw) => { n++; if (!cond) { bad++; console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)}` : ''}`); } };
const SEEDS = Array.from({ length: Number(opt.seeds ?? 12) }, (_, k) => k + 1);

// ─── the sea ───
for (const seed of SEEDS) {
  const sea = S.makeSea(seed), H = (x, z) => S.heightAt(sea, x, z);
  ok(`sea ${seed}: thirty tiny boats or more`, sea.tinies.length >= 30, sea.tinies.length);
  ok(`sea ${seed}: each tiny boat in deep water`, sea.tinies.every((t) => H(t.x, t.z) <= -3.5), sea.tinies.filter((t) => H(t.x, t.z) > -3.5).map((t) => [t.x, t.z]));
  ok(`sea ${seed}: the tiny boats apart`, sea.tinies.every((t, i) => sea.tinies.every((o, j) => i === j || Math.hypot(t.x - o.x, t.z - o.z) >= 16)));
  const folk = sea.tinies.reduce((s, t) => s + t.people.length, 0);
  ok(`sea ${seed}: between 45 and 100 people waiting`, folk >= 45 && folk <= 100, folk);
  ok(`sea ${seed}: one to three in each tiny boat`, sea.tinies.every((t) => t.people.length >= 1 && t.people.length <= 3));
  ok(`sea ${seed}: the boats line up in water, and berth in it`, [...sea.starts, ...sea.berths].every((p) => H(p.x, p.z) < -S.DRAFT - 1), [...sea.starts, ...sea.berths].map((p) => H(p.x, p.z).toFixed(1)));
  ok(`sea ${seed}: the finish line crosses open water`, sea.finish[1] - sea.finish[0] > 120, sea.finish);
  // (a way through: water deep enough for a big boat, on a 4 m grid, from the start to past the finish, by every tiny boat)
  const G = 4, at = (x, z) => `${Math.round(x / G)},${Math.round(z / G)}`, seen = new Set(), q = [[Math.round(sea.starts[2].x / G), Math.round(sea.starts[2].z / G)]];
  seen.add(q[0].join(','));
  while (q.length) { const [i, j] = q.pop(); for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${i + a},${j + b}`; if (!seen.has(k) && H((i + a) * G, (j + b) * G) < -1.6) { seen.add(k); q.push([i + a, j + b]); } } }
  ok(`sea ${seed}: a way from the start past the finish`, [...seen].some((k) => Number(k.split(',')[1]) * G > S.L + 10));
  ok(`sea ${seed}: every tiny boat can be reached`, sea.tinies.every((t) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]].some(([a, b]) => seen.has(`${Math.round(t.x / G) + a},${Math.round(t.z / G) + b}`))), sea.tinies.filter((t) => !seen.has(at(t.x, t.z))).length);
  ok(`sea ${seed}: decor stands about (palms, houses, two lighthouses, buoys at both lines)`, ['palm', 'house', 'buoy', 'pier'].every((k) => sea.decor.some((d) => d.kind === k)) && sea.decor.filter((d) => d.kind === 'lighthouse').length === 2);
}

// ─── the rule: near enough claims; they jump across one by one, and are counted as they land ───
{
  const r = R.newRace(3), me = r.boats[r.mine];
  R.runFor(r, 3.2);
  ok('rule: the race is on after three', r.phase === 'racing', r.phase);
  const tn = r.tinies.find((t) => t.people.length === 3) ?? r.tinies[0], k = tn.people.length;
  for (const b of r.boats) if (b !== me) { b.x = r.sea.starts[b.id].x; b.z = r.sea.starts[b.id].z - 30; b.ai = false; b.speed = 0; }
  me.x = tn.x + 10; me.z = tn.z; me.h = 0; me.v = 0;
  R.step(r, 1 / 60, { throttle: 0 });
  ok('rule: ten metres off is not near enough', tn.claimedBy < 0);
  me.x = tn.x + 6; me.z = tn.z;
  R.step(r, 1 / 60, { throttle: 0 });
  ok('rule: six metres off is near enough, and it\'s yours', tn.claimedBy === me.id, tn.claimedBy);
  ok('rule: no one counted until they land', me.rescued === 0 && me.aboard.length === k, [me.rescued, me.aboard.length]);
  const other = r.boats.find((b) => b !== me);
  other.x = tn.x - 4; other.z = tn.z;
  R.step(r, 1 / 60, { throttle: 0 });
  ok('rule: once claimed, no one else\'s', tn.claimedBy === me.id);
  let landed = 0;
  for (let s = 0; s < 4 * 60; s++) { R.step(r, 1 / 60, { throttle: 0 }); for (const e of r.events) if (e.kind === 'land') landed++; r.events.length = 0; }
  ok('rule: all of them across and counted', me.rescued === k && landed === k, [me.rescued, landed, k]);
  ok('rule: each to a spot of their own', new Set(me.aboard.map((p) => r.people[p].spot)).size === k);
  ok('rule: the deck has room for thirty and more', R.SPOTS.length >= 30, R.SPOTS.length);
}

// ─── whole races, all five steered by the game ───
const stats = [];
for (const level of ['easy', 'medium', 'hard']) for (const seed of SEEDS.slice(0, level === 'easy' ? 8 : 4)) {
  const r = R.newRace(seed, { level, auto: true });
  R.start(r);
  let aground = 0, steps = 0;
  while (r.phase !== 'done' && steps < 600 * 60) {
    R.step(r, 1 / 60);
    r.events.length = 0;
    steps++;
    for (const b of r.boats) if (S.heightAt(r.sea, b.x, b.z) > -0.5) aground++;
  }
  R.runFor(r, 3);
  const tag = `race ${level} ${seed}`;
  ok(`${tag}: over`, r.phase === 'done', [r.phase, r.time]);
  ok(`${tag}: no boat aground`, aground === 0, aground);
  const all = r.boats.flatMap((b) => b.aboard);
  ok(`${tag}: no one taken twice`, new Set(all).size === all.length);
  ok(`${tag}: everyone taken on has landed`, r.boats.every((b) => b.rescued === b.aboard.length), r.boats.map((b) => [b.rescued, b.aboard.length]));
  const folk = r.people.length;
  ok(`${tag}: most of them rescued`, all.length >= folk * 0.5, [all.length, folk]);
  ok(`${tag}: three boats across or more`, r.boats.filter((b) => b.finished >= 0).length >= 3, r.boats.map((b) => b.finished));
  if (r.lastCall >= 0) ok(`${tag}: over by the end of the last call`, r.endAt <= r.lastCall + r.callLength + 1e-6, [r.lastCall, r.endAt]);
  const st = R.standings(r);
  ok(`${tag}: five places, each boat once`, new Set(st.map((b) => b.id)).size === 5);
  const fine = st.every((b, i) => i === 0 || (() => {
    const a = st[i - 1], ia = a.finished >= 0, ib = b.finished >= 0;
    if (ia !== ib) return ia;
    return a.aboard.length > b.aboard.length || (a.aboard.length === b.aboard.length && (!ia || a.finished <= b.finished));
  })());
  ok(`${tag}: places by Lily's rule (across first; most rescued; a tie to who crossed first)`, fine, st.map((b) => [b.name, b.aboard.length, b.finished.toFixed(1)]));
  stats.push({ level, seed, time: Math.round(r.endAt), counts: st.map((b) => b.aboard.length).join('/'), across: r.boats.filter((b) => b.finished >= 0).length, folk });
}

// ─── you, holding no wheel: the others finish, the last call runs out, and a boat not across comes after those that are ───
{
  const r = R.newRace(5, { level: 'medium' });
  R.start(r);
  for (let s = 0; s < 600 * 60 && r.phase !== 'done'; s++) { R.step(r, 1 / 60, {}); r.events.length = 0; }
  const me = r.boats[r.mine], st = R.standings(r);
  ok('idle: the race ends without you', r.phase === 'done');
  ok('idle: the last call long enough for you to have got home from where you were', r.callLength >= R.LEVELS.medium.last, r.callLength);
  if (me.finished < 0) ok('idle: not across, you come after every boat that is', st.slice(st.indexOf(me)).every((b) => b.finished < 0));
}

// ─── steering: pointed somewhere, the boat turns and goes there ───
{
  const r = R.newRace(2), me = r.boats[r.mine];
  R.runFor(r, 3.1);
  // (the others out of the way: a boat crossing their bows is slowed by them)
  for (const b of r.boats) if (b !== me) { b.ai = false; b.speed = 0; b.z -= 60; }
  const aim = { x: me.x + 60, z: me.z + 60 };
  for (let s = 0; s < 6 * 60; s++) R.step(r, 1 / 60, { aim });
  const want = Math.atan2(aim.x - me.x, aim.z - me.z);
  ok('steer: heading for where it\'s pointed', Math.abs(Math.atan2(Math.sin(want - me.h), Math.cos(want - me.h))) < 0.25, [me.h, want]);
  ok('steer: under way', me.v > 6, me.v);
}

// ─── the same seed, the same race ───
{
  const go = () => { const r = R.newRace(7, { level: 'medium', auto: true }); R.start(r); for (let s = 0; s < 600 * 60 && r.phase !== 'done'; s++) { R.step(r, 1 / 60); r.events.length = 0; } return R.standings(r).map((b) => `${b.name}:${b.aboard.length}`).join(' '); };
  const a = go(), b = go();
  ok('same seed, same race', a === b, [a, b]);
}

console.table(stats);
console.log(`${n - bad} of ${n} checks hold`);
if (bad) { console.log(`${bad} failed`); process.exit(1); }
