// The labyrinth's model on its own (node cells/lab/devtools/labyrinth.test.mjs): many worlds built by random gestures
// (taps, traces between surfaces, carving), through the same reading of a gesture the page uses (gesture.ts), and the
// rules' promises checked after every one: whatever the hand built stands (on what's below it, on an arch whose two
// sides are stone, or on a pier that itself stands); every arch's air is clear; nothing's resolved differently twice;
// undo undoes; what's written down makes the same world again. And the storyboard is what it says.
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const { World, replay, CEIL, DIRS, LO, HI, START, key, unkey } = await load('../client/labyrinth/model.ts');
const G = await load('../client/labyrinth/gesture.ts');
const { story } = await load('../client/labyrinth/demo.ts');
const P = await load('../client/labyrinth/palette.ts');
const NAV = await load('../client/labyrinth/nav.ts');
const MO = await load('../client/labyrinth/motifs.ts');
const SEL = await load('../client/labyrinth/select.ts');
const CH = await load('../client/labyrinth/character.ts');

let fails = 0, checks = 0;
const ok = (name, cond, saw) => { checks++; if (!cond) { fails++; if (fails < 25) console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)}` : ''}`); } };

function stands(w, tag) {
  for (let k = 0; k < w.levels; k++) for (let j = LO; j <= HI; j++) for (let i = LO; i <= HI; i++) {
    const mine = w.stone(k, i, j) || w.stair(k, i, j) >= 0, pier = w.pier(k, i, j);
    if (!mine && !pier) continue;
    const where = `${tag} ${k}.${i}.${j}`;
    if (pier) { ok(`${where}: a pier stands on something`, k === 0 || w.occupied(k - 1, i, j)); ok(`${where}: and carries something`, w.occupied(k + 1, i, j)); continue; }
    if (k === 0 || w.occupied(k - 1, i, j)) continue;
    const sp = w.span(k, i, j);
    ok(`${where}: with nothing under it, it's carried on an arch`, !!sp);
    if (!sp) continue;
    const [di, dj] = DIRS[sp.a];
    ok(`${where}: its arch springs from stone either side (three cells at most, or seven for a bridge)`, w.occupied(k, sp.i - di, sp.j - dj) && w.occupied(k, sp.i + sp.n * di, sp.j + sp.n * dj) && sp.n <= (Array.from({ length: sp.n }, (_, q) => w.bridge(k, sp.i + q * di, sp.j + q * dj)).every(Boolean) ? 7 : 3), sp);
    for (let s = 0; s < sp.n; s++) for (let kk = sp.low; kk < k; kk++) ok(`${where}: its air is clear`, !w.occupied(kk, sp.i + s * di, sp.j + s * dj));
  }
}

const made = {};
const walked = { tried: 0, ok: 0, saw: [] }, local = { tried: 0, ok: 0, saw: [] }, lively = { worlds: 0, dressed: 0, gates: 0, kinds: new Set() };
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
    if (op && op.refused) { made.refused = (made.refused ?? 0) + 1; op = null; }
    if (!op) continue;
    const mass0 = new Set(w.mass.keys()), stairs0 = new Set(w.stairs.keys()), piers0 = new Set(w.piers.keys()), spans0 = new Set(w.spans.map(spanCells).flat());
    w.apply(op, t); made[op.why] = (made[op.why] ?? 0) + 1;
    if (op.connect) {
      const c = op.connect, r = w.reached.get(op), tag = `seed ${s} op ${t} (${op.why})`;
      // (the hand's stone is never cut to make a connection)
      ok(`${tag}: a connection cuts nothing`, [...mass0].every((v) => w.mass.has(v) || w.stairs.has(v)) && [...stairs0].every((v) => w.stairs.has(v)));
      // (it reaches where it was going, or it stopped where it met something: never short for nothing)
      ok(`${tag}: it reaches, or it joins what it met`, r && (r.reached || r.stopped >= 0), r);
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
// (a climb too steep for its stroke is refused, saying why; drawn longer, it's built, and walked)
{
  const w = new World(3), top = (i, j) => ({ face: 'top', hit: [w.topFrom(0, i, j) - 1, i, j], to: [w.topFrom(0, i, j), i, j] }), ground = (i, j) => ({ face: 'ground', hit: [-1, i, j], to: [0, i, j] });
  for (let k = 0; k < 3; k++) w.apply({ add: [[k, 6, 5, 0]] });
  const short = G.trace(w, ground(4, 5), [[4, 5], [5, 5]], top(6, 5), () => 0);
  ok('too steep for the stroke: refused, saying why', !!short?.refused && /steep/.test(short.refused), short);
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
  ok('the high walkway\'s free end stands on a pier down to the walkway below', w.pier(2, 5, 5) && w.pier(1, 5, 5) && !w.pier(0, 5, 5));
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
  ok('the arcade taken up: arches, lintels, solid', sel.readings.map((r) => r.label).join() === 'arches,lintels,solid', sel.readings.map((r) => r.label));
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
if (process.env.DEBUG) (await import('node:fs')).writeFileSync(process.env.DEBUG, JSON.stringify(walked.saw));
console.log(`${checks - fails} of ${checks} checks hold · gestures read as ${JSON.stringify(made)} · dressed by the rules: ${lively.dressed} of ${lively.worlds} worlds, gated or arcaded walls: ${lively.gates}`);
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
