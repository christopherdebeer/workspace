// The labyrinth's model on its own (node cells/lab/devtools/labyrinth.test.mjs): many worlds built by random gestures
// (taps, traces between surfaces, carving), through the same reading of a gesture the page uses (gesture.ts), and the
// rules' promises checked after every one: whatever the hand built stands (on what's below it, on an arch whose two
// sides are stone, or on a pier that itself stands); every arch's air is clear; nothing's resolved differently twice;
// undo undoes; what's written down makes the same world again. And the storyboard is what it says.
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const { World, replay, CEIL, DIRS, DRESS, RULE, LO, HI, START, key, unkey } = await load('../client/labyrinth/model.ts');
const G = await load('../client/labyrinth/gesture.ts');
const { story } = await load('../client/labyrinth/demo.ts');
const P = await load('../client/labyrinth/palette.ts');
const NAV = await load('../client/labyrinth/nav.ts');
const MO = await load('../client/labyrinth/motifs.ts');
const SEL = await load('../client/labyrinth/select.ts');
const CH = await load('../client/labyrinth/character.ts');
const BU = await load('../client/labyrinth/buildings.ts');
const FO = await load('../client/labyrinth/form.ts');
const ME = await load('../client/labyrinth/mesh.ts');

let fails = 0, checks = 0;
const ok = (name, cond, saw) => { checks++; if (!cond) { fails++; if (fails < 25) console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)}` : ''}`); } };

function stands(w, tag) {
  for (let k = 0; k < w.levels; k++) for (let j = LO; j <= HI; j++) for (let i = LO; i <= HI; i++) {
    const mine = w.stone(k, i, j) || w.stair(k, i, j) >= 0, pier = w.pier(k, i, j);
    if (!mine && !pier) continue;
    const where = `${tag} ${k}.${i}.${j}`;
    if (pier) { ok(`${where}: a pier stands on something`, k === 0 || w.occupied(k - 1, i, j)); ok(`${where}: and carries something`, w.occupied(k + 1, i, j)); continue; }
    if (k === 0 || w.occupied(k - 1, i, j)) continue;
    const cb = w.corbel(k, i, j);
    if (cb >= 0) { const [a, b] = DIRS[cb]; ok(`${where}: held out on corbels from stone that stands (or the land), a cell out, nothing beyond`, ((w.stone(k, i + a, j + b) && (k === 0 || w.occupied(k - 1, i + a, j + b))) || w.earth(k, i + a, j + b)) && !w.occupied(k, i - a, j - b)); continue; }
    const sp = w.span(k, i, j);
    ok(`${where}: with nothing under it, it's carried on an arch`, !!sp);
    if (!sp) continue;
    const [di, dj] = DIRS[sp.a];
    ok(`${where}: its arch springs from stone either side (three cells at most, or seven for a bridge)`, w.occupied(k, sp.i - di, sp.j - dj) && w.occupied(k, sp.i + sp.n * di, sp.j + sp.n * dj) && sp.n <= (Array.from({ length: sp.n }, (_, q) => w.bridge(k, sp.i + q * di, sp.j + q * dj)).every(Boolean) ? 7 : 3), sp);
    for (let s = 0; s < sp.n; s++) for (let kk = sp.low; kk < k; kk++) ok(`${where}: its air is clear`, !w.occupied(kk, sp.i + s * di, sp.j + s * dj));
  }
}

const made = {}, declines = {};
const ways = { tried: 0, ok: 0, saw: [] }, walked = { tried: 0, ok: 0, saw: [] }, local = { tried: 0, ok: 0, saw: [] }, lively = { worlds: 0, dressed: 0, gates: 0, kinds: new Set(), roofs: 0, doors: 0, form: 0 };
/** how far from what an edit touched its effect on piers and arches may go (an arch spans seven at most; an arcade's
 * piers are respaced along its whole run, so a little more) */
const LOCAL = 9;
const spanCells = (sp) => Array.from({ length: sp.n }, (_, q) => key(sp.k, sp.i + q * DIRS[sp.a][0], sp.j + q * DIRS[sp.a][1]));
const opCells = (op) => [...(op.add ?? []), ...(op.stairs ?? []), ...(op.cut ?? []), ...(op.arches ?? []), ...(op.walls ?? []), ...(op.trees ?? [])].map((c) => [c[1], c[2]]).concat((op.pools ?? []).map((c) => [c[0], c[1]]), op.connect ? op.connect.path : [], op.connect?.to ? [[op.connect.to[1], op.connect.to[2]]] : []);
for (let s = 1; s <= 60; s++) {
  const w = new World(s);
  let r = s * 7919;
  const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647);
  const pickAt = (i, j) => { let k = -1; while (k + 1 < CEIL && w.occupied(k + 1, i, j)) k++; return k < 0 ? { face: 'ground', hit: [-1, i, j], to: [0, i, j] } : { face: 'top', hit: [k, i, j], to: [k + 1, i, j] }; };
  for (let t = 0; t < 60; t++) {
    // (somewhere on the slab, as it's grown)
    const e = w.extent(), i = e.i0 + Math.floor(rnd() * (e.i1 - e.i0 + 1)), j = e.j0 + Math.floor(rnd() * (e.j1 - e.j0 + 1)), what = rnd();
    let op = null;
    if (what < 0.45) {
      const p = rnd() < 0.3 && w.occupied(0, i, j) ? (() => { const d = DIRS[Math.floor(rnd() * 4)], k = Math.floor(rnd() * w.topFrom(0, i, j)); return { face: 'side', hit: [k, i, j], to: [k, i + d[0], j + d[1]] }; })() : pickAt(i, j);
      op = G.tap(w, p, t);
    } else if (what < 0.85) {
      // (a stroke: wandering from here a few cells, ending on whatever's there)
      const cells = [[i, j]]; let [x, z] = [i, j], d = Math.floor(rnd() * 4);
      for (let q = 0, L = 2 + Math.floor(rnd() * 6); q < L; q++) { if (rnd() < 0.25) d = (d + (rnd() < 0.5 ? 1 : 3)) % 4; x = Math.max(e.i0, Math.min(e.i1, x + DIRS[d][0])); z = Math.max(e.j0, Math.min(e.j1, z + DIRS[d][1])); cells.push([x, z]); }
      const [ex, ez] = cells[cells.length - 1];
      op = G.trace(w, pickAt(i, j), cells, pickAt(ex, ez), () => t);
    } else if (what < 0.91) {
      // (a brush's other work: a reading switched on what's taken up, dressing, a run of pieces)
      const pk = pickAt(i, j), r2 = rnd();
      if (r2 < 0.45 && pk.face === 'top') {
        const sl = rnd() < 0.5 ? SEL.selectCell(w, pk.hit, 1, t) : (() => { const m = MO.around(MO.motifs(w), pk.hit)[0]; return m ? SEL.selectMotif(w, m, t) : null; })();
        const rd = sl?.readings.filter((x) => x.op);
        if (rd?.length) op = rd[Math.floor(rnd() * rd.length)].op;
      } else if (r2 < 0.75) {
        const kind = P.DRESSINGS[Math.floor(rnd() * P.DRESSINGS.length)], c = P.dressAt(w, pk);
        if (c) op = P.dress(w, kind, [c]);
      } else {
        const cells = [[i, j]], d = DIRS[Math.floor(rnd() * 4)];
        for (let q = 1; q < 2 + Math.floor(rnd() * 4); q++) cells.push([i + q * d[0], j + q * d[1]]);
        op = P.run(w, ['block', 'arch', 'stair', 'wall'][Math.floor(rnd() * 4)], pk, cells, 1, t);
      }
    } else if (what < 0.96) {
      // (a piece from the palette, where a touch would put it)
      const hand = ['block', 'wall', 'arch', 'stair', 'bridge', 'cypress', 'pool', 'take'][Math.floor(rnd() * 8)];
      const pk = pickAt(i, j), d = DIRS[Math.floor(rnd() * 4)];
      const pp = rnd() < 0.4 && pk.face === 'top' ? { face: 'side', hit: pk.hit, to: [pk.hit[0], i + d[0], j + d[1]] } : pk;
      op = P.place(w, hand, pp, Math.floor(rnd() * 4), t);
    } else {
      const k = Math.floor(rnd() * Math.max(1, w.topFrom(0, i, j)));
      const c = G.carve(w, { face: 'side', hit: [k, i, j], to: [k, i, j] });
      if (c) op = { cut: [c], why: 'carve' };
    }
    if (op && op.refused) { made.refused = (made.refused ?? 0) + 1; declines[op.refused.split(':')[0]] = (declines[op.refused.split(':')[0]] ?? 0) + 1; op = null; }
    if (!op) continue;
    const mass0 = new Set(w.mass.keys()), stairs0 = new Set(w.stairs.keys()), piers0 = new Set(w.piers.keys()), spans0 = new Set(w.spans.map(spanCells).flat());
    w.apply(op, t); made[op.why] = (made[op.why] ?? 0) + 1;
    if (['raise', 'course', 'extend', 'wall', 'walkway', 'stairs', 'bridge'].includes(op.why)) {
      // (auto never builds into a stair's way, and never lays a stair that climbs into stone)
      const into = [...w.mass.keys()].filter((v) => !mass0.has(v) && w.way(...unkey(v)));
      ways.tried++; if (!into.length) ways.ok++; else if (ways.saw.length < 3) ways.saw.push({ s, t, why: op.why, into: into.map(unkey) });
      for (const v of w.stairs.keys()) if (!stairs0.has(v)) { const [k, i, j] = unkey(v), d = w.stair(k, i, j), [a, b] = DIRS[d]; ok(`seed ${s} op ${t}: a stair laid by auto climbs into the open`, !w.stone(k + 1, i + a, j + b) && !w.stone(k, i - a, j - b) && !w.stone(k + 1, i, j), [k, i, j, d]); }
    }
    if (op.connect) {
      const c = op.connect, r = w.reached.get(op), tag = `seed ${s} op ${t} (${op.why})`;
      // (the hand's stone is never cut to make a connection)
      ok(`${tag}: a connection cuts nothing`, [...mass0].every((v) => w.mass.has(v) || w.stairs.has(v)) && [...stairs0].every((v) => w.stairs.has(v)));
      // (it reaches where it was going, or it stopped where it met something: never short for nothing)
      ok(`${tag}: it reaches, or it joins what it met`, r && (r.reached || r.stopped >= 0), r);
      if (c.to && !r?.reached) declines['stopped short'] = (declines['stopped short'] ?? 0) + 1;
      if (c.to) declines.tried = (declines.tried ?? 0) + 1;
      if (r?.reached) {
        // (and what it built can be walked, end to end)
        const n = NAV.navigate(w), place = (k, i, j) => n.places.has(key(k, i, j));
        const a = place(c.from[0], ...c.path[0]) ? [c.from[0], ...c.path[0]] : [c.from[0], ...c.path[1]];
        const last = c.path[c.path.length - 1], b = c.to ? (place(...c.to) ? c.to : null) : [c.from[0], ...last];
        if (place(...a) && b && place(...b)) { walked.tried++; if (NAV.reaches(n, a, b)) walked.ok++; else if (walked.saw.length < 3) walked.saw.push({ s, t, c, a, b, enc: process.env.DEBUG ? w.encode() : undefined }); }
      }
    }
    // (an edit changes what holds things up only near it)
    const near = opCells(op), far = (v) => { const [, i, j] = unkey(v); return near.every(([x, z]) => Math.max(Math.abs(x - i), Math.abs(z - j)) > LOCAL); };
    const changed = [...[...w.piers.keys()].filter((v) => !piers0.has(v)), ...[...piers0].filter((v) => !w.piers.has(v)), ...w.spans.map(spanCells).flat().filter((v) => !spans0.has(v))];
    local.tried++; if (changed.every((v) => !far(v))) local.ok++; else if (local.saw.length < 3) local.saw.push({ s, t, why: op.why, far: changed.filter(far).map(unkey) });
  }
  stands(w, `seed ${s}`);
  // (form: a touch strikes a block where it's drawn: just inside each open side of its outline it's stone, just outside
  // it isn't, unless what's outside is more stone)
  {
    let tried = 0, wrong = 0, saw = null;
    for (const v of w.mass.keys()) {
      const [k, i, j] = unkey(v);
      if (!w.block(k, i, j) || FO.buttresses(w, k, i, j).length) continue;
      for (const e of FO.outline(w, k, i, j).edges) {
        if (!e.open) continue;
        const dx = e.b[0] - e.a[0], dz = e.b[1] - e.a[1], l = Math.hypot(dx, dz), nx = dz / l, nz = -dx / l, mx = (e.a[0] + e.b[0]) / 2, mz = (e.a[1] + e.b[1]) / 2;
        const X = (f) => i - 6 + 0.5 + mx + nx * f, Z = (f) => j - 6 + 0.5 + mz + nz * f, y = k + 0.5;
        const inn = ME.inStone(w, X(-0.02), y, Z(-0.02)), out = ME.inStone(w, X(0.02), y, Z(0.02));
        const beyond = Math.floor(X(0.02) + 6) !== i || Math.floor(Z(0.02) + 6) !== j;
        tried++;
        if (!inn || (out && !beyond)) { wrong++; saw = saw ?? { k, i, j, e, inn, out }; }
      }
    }
    lively.form += tried; ok(`seed ${s}: blocks are struck where they're drawn`, wrong === 0, saw);
  }
  // (buildings: every opening is in a building's own face and looks out on air; a door looks out on a place to stand;
  // a roof only over a top that isn't walked; the same every time)
  {
    const bs = BU.buildings(w), nav = NAV.navigate(w);
    for (const b of bs.list) {
      for (const o of b.openings) {
        const [a, c] = DIRS[o.d];
        ok(`seed ${s}: an opening is in a building's own stone, looking out on air`, w.block(o.k, o.i, o.j) && !w.stone(o.k, o.i + a, o.j + c) && w.stair(o.k, o.i + a, o.j + c) < 0, o);
        if (o.kind === 'door') ok(`seed ${s}: a door looks out on a place to stand`, NAV.standing(w, o.k, o.i + a, o.j + c), o);
      }
      if (b.roof) ok(`seed ${s}: a roof only over a top nothing arrives at`, !b.walked && b.rect, b);
      lively.roofs += b.roof ? 1 : 0; lively.doors += b.openings.filter((o) => o.kind === 'door').length;
    }
    const again = BU.buildings(replay(w.encode(), w.seed));
    ok(`seed ${s}: buildings come out the same every time`, JSON.stringify(again.list.map((b) => [b.roof, b.openings])) === JSON.stringify(bs.list.map((b) => [b.roof, b.openings])));
    void nav;
  }
  // (the rules' own dressing: the same for the same world, and a motif dressed all of a piece)
  {
    const ch = CH.character(w), again = CH.character(replay(w.encode(), w.seed));
    ok(`seed ${s}: the rules dress it the same every time`, JSON.stringify([...ch]) === JSON.stringify([...again]));
    for (const m of MO.motifs(w).filter((m) => m.kind === 'tower')) { const mats = new Set(m.cells.filter((c) => w.stone(...c)).map((c) => ch.get(key(...c))?.mat ?? 0)); ok(`seed ${s}: a tower's all one stone`, mats.size === 1, [...mats]); }
    lively.worlds++; if (ch.size >= 3) lively.dressed++;
    for (const d of ch.values()) for (const [f, v] of Object.entries(d)) if (v) lively.kinds.add(f === 'mat' ? `mat${v}` : f === 'prop' ? `prop${v}` : f);
    lively.gates += w.ops.filter((o) => o.why === 'wall' && o.arches?.length).length;
  }
  // (an arcade's bays alike: every arch of it springs from the same height)
  for (const m of MO.motifs(w).filter((m) => m.kind === 'arcade')) ok(`seed ${s}: an arcade's bays spring alike`, m.spans.every((sp) => sp.low === m.spans[0].low), m.spans);
  const again = replay(w.encode());
  ok(`seed ${s}: what's written makes the same world`, again.encode() === w.encode() && again.mass.size === w.mass.size && again.piers.size === w.piers.size && again.spans.length === w.spans.length);
  const before = w.encode(), n = w.ops.length, last = w.ops[n - 1];
  w.undo(); ok(`seed ${s}: undo takes the last back`, w.ops.length === n - 1);
  if (last) { w.apply(last); ok(`seed ${s}: and doing it again is the same`, w.encode() === before); }
}
// (the slab grows with what's built: it reaches MARGIN cells past every piece, and never shrinks below its start)
{
  const w = new World(1), e0 = w.extent();
  ok('the slab starts as its square', e0.i0 === START[0] && e0.i1 === START[1]);
  w.apply({ add: [[0, START[1], START[1], 0]] });
  const e1 = w.extent();
  ok('built at its edge, it grows past what\'s built', e1.i1 === START[1] + 2 && e1.j1 === START[1] + 2, e1);
  w.apply({ add: [[0, START[1] + 2, START[1], 0]] });
  ok('and again', w.extent().i1 === START[1] + 4);
  w.undo(); w.undo();
  ok('undone, it goes back', w.extent().i1 === START[1]);
}
ok(`connections that reached can be walked end to end (${walked.ok} of ${walked.tried})`, walked.tried > 50 && walked.ok === walked.tried, walked.saw);
ok(`an edit changes what holds things up only near it (${local.ok} of ${local.tried})`, local.ok === local.tried, local.saw);
ok(`auto never builds into a stair's way (${ways.ok} of ${ways.tried})`, ways.ok === ways.tried, ways.saw);
// (a climb too steep for its stroke is refused, saying why; drawn longer, it's built, and walked)
{
  const w = new World(3), top = (i, j) => ({ face: 'top', hit: [w.topFrom(0, i, j) - 1, i, j], to: [w.topFrom(0, i, j), i, j] }), ground = (i, j) => ({ face: 'ground', hit: [-1, i, j], to: [0, i, j] });
  for (let k = 0; k < 3; k++) w.apply({ add: [[k, 6, 5, 0]] });
  const short = G.trace(w, ground(4, 5), [[4, 5], [5, 5]], top(6, 5), () => 0);
  ok('too steep for a flight: a stair tower instead', short?.why === 'tower' && !short.refused, short);
  {
    const t = replay(w.encode()); t.apply(short);
    const b = BU.buildings(t).list.find((x) => x.cols.some(([i, j]) => i === 5 && j === 5));
    ok('the stair tower: a building, a door at its foot facing the way it was come to, a stair inside', !!b && b.inside && b.openings.some((o) => o.kind === 'door' && o.k === 0 && o.d === 2), b && { inside: b.inside, openings: b.openings });
    ok('and it reaches the top', NAV.reaches(BU.walkable(t), [0, 4, 5], [3, 6, 5]));
    for (let k = 0; k < 2; k++) w.apply({ add: [[k, 5, 8, 0]] });
    w.apply({ trees: [[0, 5, 7, 0]] });
    const steep = G.trace(w, ground(5, 6), [[5, 6], [5, 7]], top(5, 8), () => 0);
    ok('too steep, and no room for a tower: a walkway out toward it, saying why', !steep?.refused && steep?.why === 'walkway' && /steep/.test(steep.note), steep);
  }
  const long = G.trace(w, ground(2, 5), [[2, 5], [3, 5], [4, 5], [5, 5]], top(6, 5), () => 0);
  ok('drawn longer: stairs', long?.why === 'stairs', long);
  w.apply(long);
  ok('which reach the top', w.reached.get(long)?.reached, w.reached.get(long));
  ok('and can be climbed', NAV.reaches(NAV.navigate(w), [0, 2, 5], [3, 6, 5]));
  // (a connection through the hand's stone stops there and joins it, and the stone stays)
  w.apply({ add: [[3, 4, 8, 0]] });
  const wk = G.trace(w, top(6, 5), [[6, 5], [6, 6], [6, 7], [6, 8], [5, 8], [4, 8], [3, 8]], null, () => 0);
  w.apply(wk);
  ok('a walkway meeting stone stops at it, and cuts nothing', w.stone(3, 4, 8) && w.reached.get(wk)?.stopped >= 0, w.reached.get(wk));
}
// (auto comes out with character: most worlds dressed by the rules, in every kind of dressing; walls with gates and arcades)
ok(`most worlds are dressed by the rules (${lively.dressed} of ${lively.worlds})`, lively.dressed >= lively.worlds * 0.6, lively);
ok(`the rules use every kind of dressing (${[...lively.kinds].sort().join(' ')})`, ['mat1', 'mat2', 'moss', 'ivy', 'parapet', 'prop6', 'prop7'].every((k) => lively.kinds.has(k)), [...lively.kinds]);
ok(`walls come out gated or arcaded, now and then (${lively.gates})`, lively.gates >= 20, lively.gates);
// (the hand's dressing wins over the rules', part by part)
{
  const w = new World(2);
  for (let k = 0; k < 4; k++) w.apply({ add: [[k, 5, 5, 0]] });
  let seed = 2, auto = null;
  for (; seed < 60 && !auto; seed++) { w.seed = seed; w.rebuild(); const d = CH.look(w, 3, 5, 5); if (d?.mat === 2 || d?.prop) auto = d; }
  ok('somewhere, the rules dress a lone tower (marble, or a lantern on top)', !!auto, auto);
  w.apply({ dress: [[3, 5, 5, 0, 1], [3, 5, 5, 6, 0]] });
  ok('the hand\'s travertine, and its lantern taken off, win over the rules\'', (CH.look(w, 3, 5, 5)?.mat ?? 0) === 0 && !CH.look(w, 3, 5, 5)?.prop, CH.look(w, 3, 5, 5));
}
// (there's no cap on how high it goes)
{
  const w = new World(4), H = 14;
  for (let k = 0; k < H; k++) { const op = G.tap(w, k ? { face: 'top', hit: [k - 1, 5, 5], to: [k, 5, 5] } : { face: 'ground', hit: [-1, 5, 5], to: [0, 5, 5] }, 0); if (op) w.apply(op); }
  ok(`tapped up ${H} times: ${H} high`, w.topFrom(0, 5, 5) === H && w.top() === H && w.levels > H, { top: w.top(), levels: w.levels });
  ok('and read as a tower that high', MO.motifs(w).some((m) => m.kind === 'tower' && m.label.includes(`${H} high`)));
  // (a long straight trace from the stone climbs all the way up it)
  const path = Array.from({ length: H + 2 }, (_, q) => [5 - (H + 1) + q, 5]);
  const op = G.trace(w, { face: 'ground', hit: [-1, path[0][0], 5], to: [0, path[0][0], 5] }, path, { face: 'top', hit: [H - 1, 5, 5], to: [H, 5, 5] }, () => 0);
  w.apply(op);
  ok(`a flight all the way up: ${H} steps, reaching the top, walkable`, op.why === 'stairs' && w.reached.get(op)?.reached && NAV.reaches(NAV.navigate(w), [0, path[0][0], 5], [H, 5, 5]), w.reached.get(op));
  stands(w, 'tall');
  // (and drawn: every level of it)
  const M = await load('../client/labyrinth/mesh.ts'), mesh = M.buildMesh(w);
  let top = 0; for (let q = 1; q < mesh.data.length; q += 12) top = Math.max(top, mesh.data[q]);
  ok('drawn to the top', top >= H - 0.01, top);
}
// (a pier landing on a walkway below stands aside, slim, and the walkway past it stays open)
{
  const M = await load('../client/labyrinth/mesh.ts');
  const w = new World(3);
  w.apply({ add: [2, 3, 4, 5, 6, 7, 8].map((i) => [0, i, 5, 0]) });
  for (let k = 0; k < 4; k++) w.apply({ add: [[k, 5, 1, 0]] });
  w.apply({ add: [2, 3, 4, 5].map((j) => [3, 5, j, 0]) });
  ok('the high walkway\'s free end is held out on corbels, the walkway below left open', w.corbel(3, 5, 5) >= 0 && !w.pier(2, 5, 5) && !w.pier(1, 5, 5));
  // (a pier asked for there: it stands on the walkway below, aside)
  w.apply({ rule: [[3, 5, 5, RULE.pier]] });
  ok('a pier asked for at the free end stands on a pier down to the walkway below', w.pier(2, 5, 5) && w.pier(1, 5, 5) && !w.pier(0, 5, 5));
  const ps = M.pierShape(w, 1, 5, 5);
  ok('the pier is slim, and stands aside off the walkway', ps.r <= 0.17 && Math.abs(ps.oz) > 0.2 && ps.ox === 0, ps);
  ok('and the walkway can be walked past it', NAV.reaches(NAV.navigate(w), [1, 2, 5], [1, 8, 5]));
  ok('the hand can still build where a pier stands', w.free(1, 5, 5));
}
// (thin walls: a wall's thickness; they close a court as walls do, and a tap on one goes on as one)
{
  const w = new World(3);
  const ring = [[3, 3], [4, 3], [5, 3], [6, 3], [6, 4], [6, 5], [6, 6], [5, 6], [4, 6], [3, 6], [3, 5], [3, 4]];
  w.apply(P.run(w, 'wall', { face: 'ground', hit: [-1, 3, 3], to: [0, 3, 3] }, ring, 1, 0));
  ok('a run of the wall piece: thin walls', ring.every(([i, j]) => w.wall(0, i, j) >= 0 && !w.block(0, i, j)));
  ok('thin walls close a court', [[4, 4], [5, 4], [4, 5], [5, 5]].every(([i, j]) => w.courts.has(key(0, i, j))));
  const up = G.tap(w, { face: 'top', hit: [0, 4, 3], to: [1, 4, 3] }, 0), out = G.tap(w, { face: 'side', hit: [0, 6, 4], to: [0, 7, 4] }, 0);
  ok('a tap on a thin wall goes on as one: up, and out along its way', up?.walls?.[0]?.[0] === 1 && out?.walls?.[0]?.[3] === 0, { up, out });
  w.apply(up); w.apply({ add: [[2, 4, 3, 0]] });
  stands(w, 'thin walls');
  const M = await load('../client/labyrinth/mesh.ts');
  ok('thin walls are drawn, and struck where they are, not between', M.buildMesh(w).count > 0 && M.inStone(w, 4 - 6 + 0.5, 0.5, 3 - 6 + 0.5) && !M.inStone(w, 4 - 6 + 0.5, 0.5, 3 - 6 + 0.9));
}
// (a wall's kind is chosen once, where the stroke starts, and kept as it grows; its openings never move)
{
  let moved = 0, kinds = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const w = new World(seed), start = { face: 'ground', hit: [-1, 2, 2 + (seed % 5)], to: [0, 2, 2 + (seed % 5)] };
    let prev = null, note = null;
    for (let n = 2; n <= 14; n++) {
      const cells = Array.from({ length: n }, (_, q) => [2 + q, start.hit[2]]), op = G.trace(w, start, cells, null, () => 0);
      const open = new Set((op.arches ?? []).map((c) => c[1]));
      if (n >= 3 && note && op.note !== note) moved++;
      if (n >= 3) note = op.note;
      if (prev) for (const i of prev) if (!open.has(i)) moved++;
      prev = open;
    }
    kinds.add(note);
  }
  ok('a wall keeps its kind as the stroke grows, and its openings stay where they are', moved === 0, moved);
  ok('and walls come in all three kinds', kinds.size === 3, [...kinds]);
}
// (buildings: a stair inside where one's needed; doors where ways meet walls; roofs where they belong, and switched)
ok(`the random worlds have buildings with doors and roofs (${lively.doors} doors, ${lively.roofs} roofs)`, lively.doors > 0 && lively.roofs > 0, lively);
ok(`blocks' outlines tried against where they're struck (${lively.form} sides)`, lively.form > 1000, lively.form);
{
  const s4 = story(4), base = NAV.navigate(s4), full = BU.walkable(s4);
  ok('story 4: the terrace\'s top can\'t be reached from the stone by the stone alone', !NAV.reaches(base, [0, 9, 3], [3, 9, 4]));
  ok('story 4: so the terrace has a door at its foot and a stair inside, and it can', NAV.reaches(full, [0, 9, 3], [3, 9, 4]) && BU.buildings(s4).list.some((b) => b.inside && b.openings.some((o) => o.kind === 'door' && o.k === 0)), BU.buildings(s4).list.map((b) => b.openings));
  ok('story 4: and from there, the platform\'s top, along the connection', NAV.reaches(full, [0, 9, 3], [2, 3, 7]));
  const s7 = story(7);
  ok('story 7: a door where the high walkway leaves the tower, halfway up', !!BU.opening(s7, 4, 13, 4, 2) || !!BU.opening(s7, 5, 13, 4, 2), BU.buildings(s7).list.map((b) => b.openings.filter((o) => o.kind === 'door')));
  const s8 = story(8), roofs = BU.buildings(s8).list.filter((b) => b.roof).map((b) => b.roof).sort();
  ok('story 8: the houses roofed, each its own way (dome, gable, hipped, shed)', JSON.stringify(roofs) === JSON.stringify(['dome', 'gable', 'hipped', 'shed']), roofs);
  ok('story 8: and none over a top that\'s walked', BU.buildings(s8).list.every((b) => !b.roof || !b.walked));
  ok('story 8: every house has a door', BU.buildings(s8).list.filter((b) => b.roof).every((b) => b.openings.some((o) => o.kind === 'door')));
  ok('story 8: the slot\'s towers have stairs inside, up to the bridge between them', NAV.reaches(BU.walkable(s8), [0, -1, 4], [5, 0, 6]));
  // (a roof switched by hand, and back)
  const hip = BU.buildings(s8).list.find((b) => b.roof === 'hipped'), m = MO.motifs(s8).find((q) => q.cells.some((c) => c[1] === hip.cols[0][0] && c[2] === hip.cols[0][1] && c[0] === hip.h - 1));
  const sel = SEL.selectMotif(s8, m, 0), gable = sel.readings.find((r) => r.label === 'gable roof');
  ok('a building taken up reads its roof every way', sel.readings.length === 6 && !!gable, sel.readings.map((r) => r.label));
  s8.apply(gable.op);
  ok('read as a gable, it\'s gabled', BU.buildings(s8).list.find((b) => b.id === hip.id)?.roof === 'gable');
  s8.apply(SEL.selectMotif(s8, m, 0).readings.find((r) => r.label === 'no roof').op);
  ok('and with no roof, none', BU.buildings(s8).list.find((b) => b.id === hip.id)?.roof === null);
  const M = await load('../client/labyrinth/mesh.ts');
  ok('story 8 is drawn, roofs and openings and all', M.buildMesh(story(8)).count > 0);
  // (features: storyboard 9 has each where it belongs)
  const s9 = story(9);
  stands(s9, 'story 9');
  const row = s9.spans.filter((sp) => sp.k === 2 && sp.j === 1);
  ok('story 9: the colonnade, every bay flat on columns', row.length >= 2 && row.every((sp) => sp.order === 'colonnade') && [...s9.piers.keys()].every((v) => { const [k, i, j] = unkey(v); return j !== 1 || M.pierShape(s9, k, i, j).column; }), row.length);
  ok('story 9: over each column, only an entablature', [...s9.mass.keys()].filter((v) => { const [k, i, j] = unkey(v); return M.onColumn(s9, k, i, j); }).length === row.length - 1);
  ok('story 9: the terrace and its flight balustraded', CH.look(s9, 1, 3, 6)?.rail === DRESS.balustrade && CH.look(s9, 0, 3, 9)?.rail === DRESS.balustrade && s9.stair(0, 3, 9) >= 0);
  ok('story 9: the court\'s west side a jali', [6, 7, 8, 9].every((j) => s9.wall(0, 6, j) >= 0 && CH.look(s9, 0, 6, j)?.screen));
  const house9 = BU.buildings(s9).list.find((b) => b.cols.some(([i, j]) => i === 13 && j === 9));
  ok('story 9: the house, its windows arched (for its colonnettes), mashrabiya above', !!house9 && house9.openings.filter((o) => o.kind === 'window').every((o) => o.style === 'arched') && CH.look(s9, 1, 13, 9)?.oriel && CH.look(s9, 0, 13, 9)?.colonnettes);
  ok('story 9: a pergola over the yard, the yard still walked', CH.look(s9, 0, 13, 6)?.pergola && NAV.navigate(s9).places.has(key(0, 13, 6)));
  ok('story 9 is drawn, every feature and all', M.buildMesh(s9).count > M.buildMesh(story(9), true).count * 0.5);
  // (flow: storyboard 10)
  const s10 = story(10);
  stands(s10, 'story 10');
  ok('story 10: the wall traced on the diagonal is drawn on the diagonal', [[2, 1], [3, 2], [4, 3], [5, 4]].every(([i, j]) => FO.outline(s10, 0, i, j).flow === 'diagonal' && FO.outline(s10, 1, i, j).flow === 'diagonal'));
  ok('story 10: the court\'s corners sweep round (where no other wall meets them)', [[9, 1], [13, 1], [13, 6]].every(([i, j]) => FO.outline(s10, 0, i, j).flow === 'curve'));
  ok('story 10: neither is a building', !BU.buildings(s10).of.has(key(0, 3, 2)) && !BU.buildings(s10).of.has(key(0, 9, 1)));
  ok('story 10: the wall traced across the stair\'s foot leaves it open', s10.stair(0, 7, 9) === 2 && !s10.stone(0, 8, 9) && s10.stone(0, 8, 8) && s10.stone(0, 8, 10));
  { const r = G.tap(s10, { face: 'ground', hit: [-1, 8, 9], to: [0, 8, 9] }, 0); ok('story 10: a tap there raises the cell beside it instead, the way kept open, and offers to raise it anyway', !r?.refused && r.add?.length === 1 && !s10.way(...r.add[0].slice(0, 3)) && r.alts?.[0]?.label === 'raise it anyway' && r.alts[0].op.add?.length === 1, r); }
  // (the dressing toggles: on, then a stroke starting on it takes it off; a jali on a thin wall pierces it)
  {
    const w = replay(s9.encode());
    const on = P.dress(w, 'balustrade', [[1, 12, 1]]); w.apply(on);
    ok('balustrade on a top', CH.look(w, 1, 12, 1)?.parapet && CH.look(w, 1, 12, 1)?.rail === DRESS.balustrade);
    w.apply(P.dress(w, 'balustrade', [[1, 12, 1]]));
    ok('and off again', !CH.look(w, 1, 12, 1)?.parapet);
    w.apply(P.dress(w, 'pergola', [[1, 4, 6]]));
    ok('a pergola, put on a top, goes over it', CH.look(w, 2, 4, 6)?.pergola);
    w.apply(P.place(w, 'take', { face: 'top', hit: [1, 4, 6], to: [2, 4, 6] }, 0, 0));
    ok('take, on a top under a pergola, takes the pergola first', !CH.look(w, 2, 4, 6)?.pergola && w.stone(1, 4, 6));
  }
  // (the rules' own features, over many worlds: each kind put somewhere, and only where it belongs)
  {
    const seen = { balustrade: 0, jali: 0, screen: 0, pergola: 0, oriel: 0, colonnettes: 0, colonnade: 0 };
    let wrong = 0;
    for (let seed = 1; seed <= 40; seed++) for (const n of [4, 6, 7, 8]) {
      const w = replay(story(n).encode());
      w.seed = seed; w.rebuild(0);
      for (const [v, d] of CH.character(w)) {
        const [k, i, j] = unkey(v);
        if (d.rail === DRESS.balustrade) seen.balustrade++;
        if (d.rail === DRESS.jali) seen.jali++;
        if (d.screen) { seen.screen++; if (w.wall(k, i, j) < 0) wrong++; }
        if (d.pergola) { seen.pergola++; if (!w.free(k, i, j) || !w.floor(k, i, j)) wrong++; }
        if (d.oriel) seen.oriel++;
        if (d.colonnettes) seen.colonnettes++;
      }
      seen.colonnade += w.spans.filter((sp) => sp.order === 'colonnade').length;
    }
    ok('the rules put each feature somewhere, and only where it belongs', wrong === 0 && seen.balustrade && seen.pergola && seen.oriel && seen.colonnettes, { wrong, ...seen });
  }
}
// (more of the stroke read: a loop walls in a court; a pause, a gate; a way blocked at its height goes round; every
// wall offers its other kinds)
{
  const w = new World(5), ground = (i, j) => ({ face: 'ground', hit: [-1, i, j], to: [0, i, j] });
  const ring = [[2, 2], [3, 2], [4, 2], [5, 2], [5, 3], [5, 4], [5, 5], [4, 5], [3, 5], [2, 5], [2, 4], [2, 3], [2, 2]];
  ok('a stroke round: closed', G.walk(ring).closed && G.walk(ring).cells.length === 12, G.walk(ring));
  const court = G.trace(w, ground(2, 2), ring, null, () => 0);
  ok('a loop walls in a court, a gate where it began, the other kinds offered', court?.note === 'a court, walled round' && court.arches?.length === 1 && court.add.length === 11 && court.alts.map((a) => a.label).join() === 'a ring of wall,an arcaded court,a thin wall', court);
  w.apply(court);
  ok('and it is a court', w.courts.has(key(0, 3, 3)) && w.courts.has(key(0, 4, 4)));
  const line = [[8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 6]], plain = G.trace(w, ground(8, 1), line, null, () => 0);
  ok('a wall offers its other kinds', plain?.why === 'wall' && plain.alts.length === 3 && plain.alts.some((a) => a.label === 'a thin wall' && a.op.walls?.length === 6), plain?.alts?.map((a) => a.label));
  const paused = G.trace(w, ground(8, 1), line, null, () => 0, 0, [[8, 3]]);
  const asWall = [paused, ...paused.alts.map((a) => a.op)].find((o) => o.note.startsWith('a wall'));
  ok('where the finger paused, a gate', (asWall?.arches ?? []).some(([, i, j]) => i === 8 && j === 3) && /paused/.test(asWall.note), asWall);
  // (a bridge between two towers, the stroke straight through a third in the way: it goes round)
  for (const [i, j, h] of [[11, 1, 2], [11, 5, 2], [11, 3, 3]]) for (let k = 0; k < h; k++) w.apply({ add: [[k, i, j, 0]] });
  const top = (i, j) => ({ face: 'top', hit: [w.topFrom(0, i, j) - 1, i, j], to: [w.topFrom(0, i, j), i, j] });
  const br = G.trace(w, top(11, 1), [[11, 1], [11, 2], [11, 3], [11, 4]], top(11, 5), () => 0);
  ok('blocked at its height: round it, the way through offered', br?.why === 'bridge' && !br.connect.path.some(([i, j]) => i === 11 && j === 3) && br.alts?.[0]?.label === 'joining what it meets', br?.connect);
  w.apply(br);
  ok('and round it reaches', w.reached.get(br)?.reached && NAV.reaches(NAV.navigate(w), [2, 11, 1], [2, 11, 5]), w.reached.get(br));
  // (a pause on a climb: a landing there, if there's room)
  const v = new World(5); for (let k = 0; k < 2; k++) v.apply({ add: [[k, 6, 5, 0]] });
  const vt = (i, j) => ({ face: 'top', hit: [v.topFrom(0, i, j) - 1, i, j], to: [v.topFrom(0, i, j), i, j] });
  const climb = G.trace(v, ground(1, 5), [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]], vt(6, 5), () => 0, 0, [[3, 5]]);
  v.apply(climb);
  ok('a pause on a climb: a landing there', climb.connect.rest?.length === 1 && v.stair(0, 3, 5) < 0 && v.stair(1, 3, 5) < 0 && v.reached.get(climb)?.reached, { rest: climb.connect.rest, stairs: [...v.stairs.keys()].map(unkey) });
  ok('kept when it\'s written down', replay(v.encode()).encode() === v.encode() && JSON.parse(v.encode()).at(-1)[7][3]?.length === 1);
}
// (the land: seeded, composed, and what's built on it stands on it, walks, and keeps its ways open)
{
  const LA = await load('../client/labyrinth/land.ts');
  const a = LA.makeLand(6), b = LA.makeLand(6), c = LA.makeLand(7);
  ok('the land: the same seed, the same land; another, another', a.g.join() === b.g.join() && a.g.join() !== c.g.join());
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const l = LA.makeLand(seed), G = (i, j) => LA.groundOf(l, i, j);
    ok(`land ${seed}: its stream falls all the way, a cell at a time, and its bed is under its banks`, l.stream.every(([i, j], q) => q === 0 || (Math.abs(i - l.stream[q - 1][0]) + Math.abs(j - l.stream[q - 1][1]) === 1 && G(i, j) <= G(...l.stream[q - 1]))) && l.stream.every(([i, j]) => DIRS.every(([x, z]) => !LA.onLand(i + x, j + z) || l.water.has((j + z) * 1000 + i + x) || G(i + x, j + z) >= G(i, j))));
    const flat = [-1, 0, 1].every((dj) => [-1, 0, 1].every((di) => !LA.onLand(l.shelf[0] + di, l.shelf[1] + dj) || l.water.has((l.shelf[1] + dj) * 1000 + l.shelf[0] + di) || G(l.shelf[0] + di, l.shelf[1] + dj) === G(...l.shelf)));
    ok(`land ${seed}: a shelf flat enough for a court (its middle all one level, but where the stream runs)`, flat);
    ok(`land ${seed}: its surface is flat at each column's level through its middle`, [[2, 3], [5, 5], [8, 1]].every(([i, j]) => Math.abs(LA.surfaceY(l, i + 0.5, j + 0.5) - G(i, j) + (l.water.has(j * 1000 + i) ? 0.3 : 0)) < 1e-9));
  }
  // (storyboard 12: four gestures make a place)
  const s12 = story(12);
  stands(s12, 'story 12');
  ok('story 12: written down with its land, and made again the same', replay(s12.encode()).encode() === s12.encode() && replay(s12.encode()).landSeed === 6);
  ok('story 12: a court walled round on the shelf, by a stroke drawn round it', s12.courts.has(key(0, 1, 4)) && s12.archway(3, 1, 6) >= 0);
  const ways12 = s12.ops.filter((o) => o.connect?.follow);
  ok('story 12: both ways reach', ways12.length === 2 && ways12.every((o) => s12.reached.get(o)?.reached));
  ok('story 12: the first climbs where the land does, by flights, through the gate', s12.stair(1, 1, 8) >= 0 && s12.stair(2, 1, 7) >= 0 && s12.paved(1, 9));
  ok('story 12: the second crosses the stream on an arch, the water under it', s12.spans.some((sp) => sp.k === 0 && s12.pool(sp.i, sp.j)));
  const n12 = BU.walkable(s12);
  ok('story 12: from the low ground into the court, and over the stream to the house, on foot', NAV.reaches(n12, [1, 1, 10], [3, 1, 5]) && NAV.reaches(n12, [1, 1, 10], [3, 7, 4]), { court: NAV.reaches(n12, [1, 1, 10], [3, 1, 5]), house: NAV.reaches(n12, [1, 1, 10], [3, 7, 4]) });
  ok('story 12: the house across the ravine is a house', BU.buildings(s12).list.some((x) => x.cols.some(([i, j]) => i === 7 && j === 2) && x.roof));
  ok('story 12: drawn', ME.buildMesh(s12).count > 0);
  // (random gestures on the land, mass and way: what stands, stands; nothing's built into the land; ways reach or join
  // what they meet, and what reached can be walked; auto never builds into a stair's way)
  let tried = 0, walkedOk = 0, wayTried = 0, reached = 0, inLand = 0, intoWays = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const w = new World(seed, 1 + (seed % 5));
    let r = seed * 104729;
    const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647);
    const e = w.extent();
    const pickAt = (i, j) => { const g = w.ground(i, j); let k = g - 1; while (k + 1 < CEIL && (w.stone(k + 1, i, j) || w.stair(k + 1, i, j) >= 0)) k++; return k < g ? { face: 'ground', hit: [g - 1, i, j], to: [g, i, j] } : { face: 'top', hit: [k, i, j], to: [k + 1, i, j] }; };
    for (let t = 0; t < 40; t++) {
      const i = e.i0 + Math.floor(rnd() * (e.i1 - e.i0 + 1)), j = e.j0 + Math.floor(rnd() * (e.j1 - e.j0 + 1)), what = rnd();
      let op = null;
      if (what < 0.35) op = G.tap(w, pickAt(i, j), t);
      else {
        const cells = [[i, j]]; let [x, z] = [i, j], d = Math.floor(rnd() * 4);
        for (let q = 0, L = 2 + Math.floor(rnd() * 7); q < L; q++) { if (rnd() < 0.25) d = (d + (rnd() < 0.5 ? 1 : 3)) % 4; x = Math.max(e.i0, Math.min(e.i1, x + DIRS[d][0])); z = Math.max(e.j0, Math.min(e.j1, z + DIRS[d][1])); cells.push([x, z]); }
        op = G.trace(w, pickAt(i, j), cells, pickAt(...cells[cells.length - 1]), () => t, t, [], what < 0.75 ? 'way' : 'mass');
      }
      if (!op || op.refused) continue;
      const mass0 = new Set(w.mass.keys());
      w.apply({ ...op, alts: undefined }, t);
      for (const v of w.mass.keys()) if (!mass0.has(v) && w.earth(...unkey(v))) inLand++;
      if (['raise', 'course', 'extend', 'wall', 'walkway', 'stairs', 'bridge', 'way'].includes(op.why)) intoWays += [...w.mass.keys()].filter((v) => !mass0.has(v) && w.way(...unkey(v))).length;
      if (op.connect?.follow) {
        wayTried++; const rr = w.reached.get(w.ops[w.ops.length - 1]);
        if (rr?.reached) {
          reached++;
          const c = op.connect, n = BU.walkable(w);
          tried++; if (NAV.reaches(n, [c.from[0], ...c.path[0]], c.to)) walkedOk++;
        }
      }
    }
    stands(w, `land world ${seed}`);
  }
  ok('on the land, nothing built goes into the land', inLand === 0, inLand);
  ok('on the land, auto never builds into a stair\'s way', intoWays === 0, intoWays);
  ok(`on the land, ways that reach can be walked, end to end (${walkedOk} of ${tried}; ${reached} of ${wayTried} reached)`, tried > 20 && walkedOk === tried && reached >= wayTried * 0.4, { tried, walkedOk, reached, wayTried });
}
// (form: a run a cell thick is a wall's thickness, curving where it turns, on the diagonal where it steps, with posts
// where walls meet and buttresses along it; a mass fills its cells, its outside corners rounded; a wall runs on to a
// gate in it)
{
  const w = new World(3);
  w.apply({ add: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [0, i, 2, 0]).concat([[0, 7, 3, 0], [0, 7, 4, 0]]) });
  w.apply({ add: [[0, 2, 7, 0], [0, 3, 7, 0], [0, 2, 8, 0], [0, 3, 8, 0], [1, 2, 7, 0], [1, 3, 7, 0], [1, 2, 8, 0], [1, 3, 8, 0]] });
  w.apply({ add: [[0, 9, 9, 0], [0, 11, 9, 0]], arches: [[0, 10, 9, 1, 0]] });
  const st = FO.outline(w, 0, 3, 2), corner = FO.outline(w, 0, 7, 2), mass = FO.outline(w, 0, 2, 7);
  ok('a straight run is a wall\'s thickness', FO.wallCell(w, 0, 3, 2) && st.straight && st.edges.filter((e) => e.open && e.face % 2 === 1).every((e) => Math.abs(e.dist - FO.WT) < 1e-9), st);
  // (a wall that turns once sweeps round a curve; a stair-step of turns is a diagonal; where walls meet, a post)
  ok('where it turns once, a curve', corner.wall && corner.flow === 'curve' && corner.edges.some((e) => e.open && e.face < 0), corner.flow);
  ok('struck on its curve, not across the corner it cuts', ME.inStone(w, 7 - 6 + 0.5 - 0.146, 0.5, 2 - 6 + 0.5 + 0.146) && !ME.inStone(w, 7 - 6 + 0.5 + 0.4, 0.5, 2 - 6 + 0.5 - 0.4));
  w.apply({ add: [[0, 5, 3, 0]] });
  ok('where walls meet, a post', FO.outline(w, 0, 5, 2).post === FO.POST && !FO.outline(w, 0, 5, 2).flow);
  w.apply({ add: [[0, 1, 10, 0], [0, 2, 10, 0], [0, 2, 11, 0], [0, 3, 11, 0], [0, 3, 12, 0], [0, 4, 12, 0]] });
  ok('a stair-step of turns: one wall on the diagonal', ['2.10', '2.11', '3.11', '3.12'].every((c) => { const [i, j] = c.split('.').map(Number); return FO.outline(w, 0, i, j).flow === 'diagonal'; }));
  ok('and it meets a straight wall at a straight wall\'s thickness', FO.outline(w, 0, 2, 10).edges.filter((e) => !e.open).every((e) => Math.abs(Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) - 2 * FO.WT) < 1e-9));
  ok('along a long run on the stone, buttresses', FO.buttresses(w, 0, 3, 2).length === 2 || FO.buttresses(w, 0, 6, 2).length === 2 || FO.buttresses(w, 0, 0, 2).length === 2);
  ok('a mass fills its cells, its outside corners rounded', !mass.wall && mass.edges.some((e) => e.face < 0) && mass.edges.filter((e) => e.face >= 0).every((e) => Math.abs(e.dist - 0.5) < 1e-9));
  ok('a wall runs on to a gate in it', FO.wallCell(w, 0, 9, 9) && FO.wallCell(w, 0, 11, 9));
  ok('struck in its middle, not beside its face', ME.inStone(w, 4 - 6 + 0.5, 0.5, 2 - 6 + 0.5) && !ME.inStone(w, 4 - 6 + 0.5, 0.5, 2 - 6 + 0.5 + FO.WT + 0.05));
  stands(w, 'form');
}
// (a gate in a wall is walked through)
{
  const w = new World(3);
  w.apply({ add: [[0, 3, 5, 0], [0, 5, 5, 0]], arches: [[0, 4, 5, 1, 0]] });
  const n = NAV.navigate(w), nx = (n.next.get(key(0, 4, 5)) ?? []).map((v) => unkey(v).join('.')).sort();
  ok('a gate in a wall is walked through, along its way only', nx.join() === '0.4.4,0.4.6', nx);
}
// (motifs and dressing, as the storyboard has them)
{
  const s6 = story(6), ms = MO.motifs(s6), arc = ms.find((m) => m.kind === 'arcade' && m.spans.every((sp) => sp.k === 2 && sp.a === 1));
  ok('story 6: the trace from the terrace to the far tower is an arcade of three bays, alike', !!arc && arc.spans.length === 3 && arc.spans.every((sp) => sp.n === arc.spans[0].n && sp.low === arc.spans[0].low), arc?.spans);
  const fl = ms.find((m) => m.kind === 'flight');
  ok('story 6: the stair brush\'s run is a flight of three, up to the terrace, and it can be climbed', fl?.cells.length === 3 && NAV.reaches(NAV.navigate(s6), [0, 14, 4], [3, 10, 4]), fl);
  ok('story 6: towers and the court are found', ms.filter((m) => m.kind === 'tower').length >= 2 && ms.some((m) => m.kind === 'court'), ms.map((m) => m.label));
  ok('story 6: the passage read as a lintel', s6.span(1, 6, 7)?.flat === true);
  ok('story 6: dressed (marble, brick, moss, ivy, a parapet, lanterns, pots)', s6.dressed(0, 3, 3)?.mat === 2 && s6.dressed(0, 3, 9)?.mat === 1 && s6.dressed(0, 3, 7)?.moss && s6.dressed(1, 9, 4)?.ivy && s6.dressed(1, 6, 7)?.parapet && s6.dressed(2, 3, 3)?.prop === 6 && s6.dressed(2, 9, 5)?.prop === 7);
  stands(s6, 'story 6');
  const again = replay(s6.encode());
  ok('story 6: its readings and dressing are written down, and made again', again.encode() === s6.encode() && again.span(1, 6, 7)?.flat && again.dressed(0, 3, 9)?.mat === 1);
  // (every reading of the arcade, each one standing, and switching back leaves it as it was)
  const sel = SEL.selectMotif(s6, arc, 0);
  ok('the arcade taken up: arches, lintels, a colonnade, solid', sel.readings.map((r) => r.label).join() === 'arches,lintels,a colonnade,solid', sel.readings.map((r) => r.label));
  {
    // (read as a colonnade: flat, on columns; read back as arches, kept arches, never made a colonnade of its own accord)
    const w = replay(s6.encode()); w.apply(sel.readings[2].op);
    const row = w.spans.filter((sp) => sp.k === 2 && sp.a === 1 && sp.i === 10);
    ok('read as a colonnade: every bay flat, under an entablature', row.length >= 3 && row.every((sp) => sp.flat && sp.order === 'colonnade'), row.length);
    const back = replay(s6.encode()); back.apply(SEL.selectMotif(w, arc, 0).readings[0].op ?? {});
    ok('read as arches: none a colonnade', !back.spans.some((sp) => sp.order === 'colonnade'));
  }
  for (const r of sel.readings) if (r.op) { const w = replay(s6.encode()); w.apply(r.op); stands(w, `arcade read as ${r.label}`); if (r.label === 'solid') ok('read solid: stone under it all', !w.spans.some((sp) => sp.k === 2 && sp.a === 1 && sp.i === 10)); }
  // (a long arch, taken up, read as two bays: a pier under its middle)
  const w = new World(5);
  for (const i of [3, 9]) for (let k = 0; k < 2; k++) w.apply({ add: [[k, i, 5, 0]] });
  w.apply({ add: [4, 5, 6, 7, 8].map((i) => [1, i, 5, 0]), bridge: true });
  const one = w.span(1, 6, 5);
  ok('a bridge of five on one arch', one?.n === 5, one);
  const r2 = SEL.selectCell(w, [1, 6, 5], 0, 0).readings.find((r) => r.label === 'two bays');
  w.apply(r2.op);
  ok('read as two bays: a pier under its middle, two arches either side, alike', w.pier(0, 6, 5) && w.spans.filter((sp) => sp.k === 1).length === 2 && new Set(w.spans.map((sp) => sp.low)).size === 1, w.spans);
}
for (const why of ['raise', 'course', 'extend', 'wall', 'walkway', 'stairs', 'carve', 'block', 'arch', 'stair', 'bridge', 'cypress', 'pool', 'take', 'reading', 'dress', 'arcade', 'flight', 'thin wall', 'wall piece']) ok(`gestures read every way: ${why}`, (made[why] ?? 0) > 3, made);
// (the storyboard: what each stage says it is)
const s1 = story(1), s2 = story(2), s3 = story(3), s4 = story(4);
ok('story 1: a small raised platform', s1.topFrom(0, 3, 7) === 2 && s1.topFrom(0, 4, 7) === 2);
ok('story 2: a wall traced from it', [5, 6, 7, 8, 9].every((i) => s2.stone(0, i, 7)));
ok('story 3: a connection up to the higher terrace, with steps', s3.stairs.size >= 1 && s3.stone(1, 6, 7));
ok('story 4: a passage beneath the walkway, on an arch', !s4.stone(0, 6, 7) && !!s4.span(1, 6, 7));
ok('story 4: the court closed, with something growing in it', s4.courts.size > 0 && s4.decor.length > 0);
{ const bay = s4.spans.filter((sp) => sp.k === 2 && sp.a === 0 && sp.j === 4); ok('story 4: the tower bridged to the terrace on one great arch, or an arcade of even bays (the rules\' choice)', (bay.length === 1 && bay[0].n === 5) || (bay.length === 2 && bay.every((sp) => sp.n === bay[0].n)), bay); }
stands(s4, 'story 4');
// ─── the land carried on past its first square; water let into tops, spilling; strokes drawn round that fill ───
{
  const LA = await load('../client/labyrinth/land.ts');
  for (const seed of [6, 1, 2, 23]) {
    const L = LA.makeLand(seed), s = L.stream;
    ok(`land ${seed}: its stream runs on past its first square, each cell beside the next`, s.length > 20 && s.every((c, q) => q === 0 || Math.abs(c[0] - s[q - 1][0]) + Math.abs(c[1] - s[q - 1][1]) === 1), s.length);
    ok(`land ${seed}: and never climbs on its way down`, s.every((c, q) => q === 0 || LA.groundOf(L, ...c) <= LA.groundOf(L, ...s[q - 1])));
    const w = new World(1, seed), e0 = w.extent(), g = w.ground(12, 5);
    w.apply({ add: [[g, 12, 5, 0]] });
    const e1 = w.extent();
    ok(`land ${seed}: built at its edge, more of it, that way only`, e1.i1 === e0.i1 + 4 && e1.i0 === e0.i0 && e1.j0 === e0.j0 && e1.j1 === e0.j1, { e0, e1 });
    ok(`land ${seed}: and the more is the same land, from the same seed`, [13, 14, 15, 16].every((i) => w.ground(i, 5) === LA.groundOf(L, i, 5)));
    w.undo(); ok(`land ${seed}: undone, back as it was`, JSON.stringify(w.extent()) === JSON.stringify(e0));
  }
  const s14 = story(14);
  ok('story 14: basins let into the tops of the tower, the terrace and the wall', s14.basins.size >= 4 + 4 + 6);
  ok('story 14: the tower\'s spills onto the terrace\'s (water finds water)', s14.falls.some((f) => f.k === 3 && f.into === 'water' && f.land === 2), s14.falls);
  ok('story 14: the terrace\'s and the channel\'s spill to the ground, into bowls', s14.falls.filter((f) => f.into === 'bowl' && f.land === 0).length >= 2 && s14.bowls.size >= 2, s14.falls);
  ok('story 14: one spout to a basin', s14.falls.length === 3, s14.falls.length);
  ok('story 14: no roof over water', !BU.buildings(s14).list.some((b) => b.roof && b.cols.some(([x, z]) => s14.basin(b.h, x, z))));
  ok('story 14: water isn\'t stood on, nor a bowl', [...s14.basins.keys()].every((v) => { const [k, i, j] = unkey(v); return !s14.floor(k, i, j); }) && [...s14.bowls.keys()].every((v) => { const [k, i, j] = unkey(v); return !s14.floor(k, i, j); }));
  ok('story 14: written down and made again, it spills the same', JSON.stringify(replay(s14.encode(), s14.seed).falls.map((f) => [f.k, f.i, f.j, f.d, f.into])) === JSON.stringify(s14.falls.map((f) => [f.k, f.i, f.j, f.d, f.into])));
  ok('story 14: a stroke of the pool brush drawn round fills what it closed round (a pond)', [10].every((i) => [3, 4].every((j) => s14.pool(i, j))) && s14.pool(9, 2) && s14.pool(11, 5));
  { const w = replay(s14.encode(), s14.seed), op = P.place(w, 'take', { face: 'top', hit: [2, 3, 3], to: [3, 3, 3] }, 0, 0); ok('take: a basin before the stone it\'s let into', op?.cut?.[0]?.[0] === 3 && op.cut[0][1] === 3, op); }
  { const ring = [[2, 2], [3, 2], [4, 2], [4, 3], [4, 4], [3, 4], [2, 4], [2, 3]]; ok('a stroke drawn round: what it closes round', JSON.stringify(P.closed(ring)) === '[[3,3]]'); ok('a stroke that doesn\'t close: nothing', P.closed(ring.slice(0, 5)) === null); }
  { const w = new World(9); w.apply({ add: [[0, 3, 3, 0]] }); const op = P.place(w, 'pool', { face: 'top', hit: [0, 3, 3], to: [1, 3, 3] }, 0, 0); ok('pool on a top: a basin let into it', !!op?.basins?.length); w.apply(op); ok('and a lone basin on a block spills over its deepest edge, into a bowl', w.falls.length === 1 && w.falls[0].into === 'bowl', w.falls); }
}
// ─── forms chosen by their surroundings (context.ts, buildings.ts) ───
{
  const CX = await load('../client/labyrinth/context.ts');
  const w = story(15), R = CX.retaining(w), bs = BU.buildings(w).list;
  ok('story 15: banks beside the way held by retaining walls', R.size >= 2 && [...R.values()].every((r) => r.hi - r.lo >= 1 && r.hi - r.lo <= 3), R.size);
  ok('story 15: a held bank is flat to its wall either side', [...R.values()].every((r) => { const [a, b] = DIRS[r.d], x = r.i + 0.5 + a * 0.49, z = r.j + 0.5 + b * 0.49, x2 = r.i + 0.5 + a * 0.51, z2 = r.j + 0.5 + b * 0.51; return Math.abs(CX.groundY(w, x, z) - r.hi) < 0.01 && Math.abs(CX.groundY(w, x2, z2) - r.lo) < 0.01; }));
  ok('story 15: no wall where a stair climbs the bank', [...R.values()].every((r) => { const [a, b] = DIRS[r.d]; return w.stair(r.lo, r.i + a, r.j + b) !== (r.d + 2) % 4; }));
  const step = (i, j) => bs.find((b) => b.cols.some((c) => c[0] === i && c[1] === j));
  const up = step(10, 4), low = step(10, 7), cliff = step(2, 7);
  ok('story 15: a house across a bank read as two steps, each its own building', up && low && up !== low && up.h === low.h + 1, { up: up?.h, low: low?.h });
  ok('story 15: each step under a lean-to falling downhill', up?.roof === 'shed' && low?.roof === 'shed' && up.fall === 1 && low.fall === 1, { up: [up?.roof, up?.fall], low: [low?.roof, low?.fall] });
  ok('story 15: the house set into the cliff: its roof falls away from the hill', cliff?.roof === 'shed' && cliff.fall === 1, [cliff?.roof, cliff?.fall]);
  ok('story 15: and it\'s come into from the hill above', cliff?.openings.some((o) => o.kind === 'door' && o.k === w.ground(2, 6) && o.d === 3), cliff?.openings);
  ok('story 15: no window or door into the earth', bs.every((b) => b.openings.every((o) => !w.earth(o.k, o.i + DIRS[o.d][0], o.j + DIRS[o.d][1]))));
  ok('the flat slab: no retaining walls', CX.retaining(story(8)).size === 0);
  // (how cells answer their neighbours)
  for (const n of [3, 8, 9, 11]) {
    const w2 = story(n), unrailed = [...w2.stairs.keys()].map(unkey).filter(([k, i, j]) => DIRS.some(([a, b]) => !w2.occupied(k, i + a, j + b) && w2.stair(k, i + a, j + b) < 0 && Math.max(MO.height(w2, i + a, j + b), w2.ground(i + a, j + b)) < k) && !CH.look(w2, k, i, j)?.parapet);
    ok(`story ${n}: every stair with a drop beside it railed`, unrailed.length === 0, unrailed);
    ok(`story ${n}: no parapet on a thin wall`, [...ME.parapets(w2).edges.keys()].every((v) => w2.wall(...unkey(v)) < 0));
  }
  { const w2 = story(4), sp = w2.spans[0], op = P.place(w2, 'pool', { face: 'top', hit: [sp.k, sp.i, sp.j], to: [sp.k + 1, sp.i, sp.j] }, 0, 0); ok('a basin only in a plain block: not in an arch\'s deck', !op?.basins, op); }
  { const w2 = story(15); ok('a block built against a bank has no face into it', [...w2.mass.keys()].map(unkey).every(([k, i, j]) => DIRS.every((_, d) => !w2.earth(k, i + DIRS[d][0], j + DIRS[d][1]) || FO.covered(w2, k, i, j, d)))); }
}
// ─── the cats (perches.ts, cats.ts): where they can be, and their lives over what's built and what's built in front of them ───
{
  const CT = await load('../client/labyrinth/cats.ts');
  const PE = await load('../client/labyrinth/perches.ts');
  const PZ = await load('../client/labyrinth/model.ts');
  const IN = (w, x, y, z) => ME.inStone(w, x, y, z);
  for (const n of [4, 8, 9, 12, 13]) {
    const w = story(n), P = PE.perches(w);
    ok(`story ${n}: places for cats, each with room for one and something under it`, P.spots.length > 20 && P.spots.every((s) => !IN(w, s.x, s.y + 0.08, s.z) && (s.kind === 'rail' || s.ground || IN(w, s.x, s.y - (s.kind === 'stair' ? 0.2 : 0.04), s.z))), P.spots.filter((s) => IN(w, s.x, s.y + 0.08, s.z)).map((s) => s.name).slice(0, 5));
    ok(`story ${n}: every walk between places goes both ways`, P.spots.every((s) => s.links.every((l) => l.kind !== 'walk' || P.spots[l.to].links.some((m) => m.to === s.id))));
    ok(`story ${n}: a jump's arc is clear of the stone`, P.spots.every((s) => s.links.every((l) => !l.from || [0.25, 0.5, 0.75].every((t) => { const a = l.from, b = l.land, dy = b[1] - a[1], h = dy > 0 ? dy / 2 + 0.18 : l.kind === 'leap' ? 0.32 : 0.15; return !IN(w, a[0] + (b[0] - a[0]) * t, a[1] + dy * t + h * 4 * t * (1 - t) + 0.1, a[2] + (b[2] - a[2]) * t); }))));
    ok(`story ${n}: home for a few cats, not a crowd`, P.capacity >= 1 && P.capacity <= 6, P.capacity);
  }
  ok('bare land, and the bare stone: home for no cats', PE.perches(new PZ.World(1, 6)).capacity === 0 && PE.perches(new PZ.World(1)).capacity === 0);
  // (their lives: never in stone, never left in the air, one to a narrow place and to a place to rest, as many as it's home for)
  const watch = (w, C, secs, tag, build) => {
    let inStone = 0, floating = 0, crowded = 0, over = 0;
    const air = new Map();
    for (let t = 0; t < secs; t += 0.1) {
      if (build && Math.abs(t - build.at) < 0.05) w.apply(build.op, t);
      C.update(w, 0.1);
      for (const c of C.list) {
        if (c.hidden || c.air || c.gone) { air.set(c.name, 0); continue; }
        if (IN(w, c.x, c.y + 0.12, c.z) && t - (build?.at ?? -9) > 2.5) { inStone++; if (inStone < 3) console.log('  in stone:', tag, t.toFixed(1), c.name, c.at, c.doing, c.want, c.x.toFixed(2), c.y.toFixed(2), c.z.toFixed(2)); }
        const s = C.place(c.at), on = s && Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z) < 0.25;
        const held = on || IN(w, c.x, c.y - 0.06, c.z) || (w.land && c.y < 0.06 + w.ground(Math.floor(c.x + 6), Math.floor(c.z + 6))) || (!w.land && c.y < 0.05) || c.moving > 0;
        air.set(c.name, held ? 0 : (air.get(c.name) ?? 0) + 0.1);
        if ((air.get(c.name) ?? 0) > 2) floating++;
      }
      const rests = C.list.filter((c) => c.resting && !c.gone).map((c) => c.resting);
      if (new Set(rests).size !== rests.length) crowded++;
      const narrow = C.list.filter((c) => !c.gone && !c.air && C.place(c.at)?.narrow && C.place(c.at) && Math.hypot(C.place(c.at).x - c.x, C.place(c.at).z - c.z) < 0.05).map((c) => c.at);
      if (new Set(narrow).size !== narrow.length) crowded++;
      if (C.list.filter((c) => !c.leaving).length > C.P.capacity + 1) over++;
    }
    ok(`${tag}: no cat in the stone`, inStone === 0, inStone);
    ok(`${tag}: no cat left in the air`, floating === 0, floating);
    ok(`${tag}: one cat to a place to rest, one to a narrow place`, crowded === 0, crowded);
    ok(`${tag}: as many as it's home for`, over === 0, over);
  };
  for (const n of [8, 12, 13]) { const w = story(n), C = new CT.Cats(1); watch(w, C, 240, `story ${n}'s cats, four minutes`); }
  {
    // (story 13: the bridge built last, in front of them: they go and see it, and cross onto it)
    const w = story(13), bridge = w.ops.pop(); w.rebuild(0);
    const C = new CT.Cats(1);
    let saw = false, onIt = false;
    for (let t = 0; t < 90; t += 0.1) {
      if (Math.abs(t - 30) < 0.05) w.apply(bridge, t);
      C.update(w, 0.1);
      if (t > 30) for (const c of C.list) { if (/new stone/.test(c.doing)) saw = true; if (/^(floor|ledge|rail)\.2\.(6|7)\.5\./.test(c.at)) onIt = true; }
    }
    ok('story 13: a bridge built in front of the cats: one goes to see it', saw);
    ok('story 13: and onto it, a new way', onIt);
  }
  {
    // (building over and under them: walls traced through them, stone taken from under them; they move, never stuck)
    const w = story(12), C = new CT.Cats(3);
    C.run(w, 20);
    const ops = [];
    for (const c of C.list.slice(0, 2)) { const s = C.place(c.at); if (s) ops.push({ add: [[s.k, s.i, s.j, 0]] }); }
    const s0 = C.place(C.list[2]?.at ?? '');
    if (s0 && !s0.ground) ops.push({ cut: [[s0.k - 1, s0.i, s0.j]] });
    let t = 20;
    for (const op of ops) { w.apply(op, t); t += 0.1; }
    watch(w, C, 60, 'story 12: stone built on the cats, and taken from under one', { at: 0, op: {} });
  }
  // (who they are: the same every visit; their favourite places kept)
  { const a = new CT.Cats(1), b = new CT.Cats(1); a.run(story(13), 5); b.run(story(13), 5); ok('the same cats every visit', JSON.stringify(a.list.map((c) => [c.name, c.coat])) === JSON.stringify(b.list.map((c) => [c.name, c.coat]))); }
  { const a = new CT.Cats(1); a.run(story(13), 200); const m = a.remembered(); ok('they come to have favourite places', m.fav.some((f) => f.length > 0 && f[0][1] > 0.3), m.fav.map((f) => f[0])); }
}
if (process.env.DEBUG) (await import('node:fs')).writeFileSync(process.env.DEBUG, JSON.stringify(walked.saw));
console.log(`${checks - fails} of ${checks} checks hold · gestures read as ${JSON.stringify(made)} · declined: ${JSON.stringify(declines)} · dressed by the rules: ${lively.dressed} of ${lively.worlds} worlds, gated or arcaded walls: ${lively.gates}`);
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
