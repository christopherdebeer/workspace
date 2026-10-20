// The connectors of static/labyrinth-connective.md, checked (node cells/lab/devtools/labyrinth-connectors.mjs): each a
// small scene made by gestures through the production gesture.ts, in both edit orders where the order could matter,
// turned to all four sides of the grid and mirrored, and each checked for the failure it exists to prevent (a passage
// shut by what's added over it, a route stopped by a wall it was drawn through, a tower reached at a blank face, a
// whole roof lost to a step on to part of it). Endpoints and clearance, not just that the world joins up somewhere.
//   --only=NAME   --ops (print each scene's ops, to replay with ?ops= in the browser)   --render (each scene, unturned,
//   drawn by the page in WebGL: devtools/out/connectors/*.png; --zoom=, --turn= to frame them)
import './labyrinth-node.mjs';
const { World, key, DIRS } = await import('../client/labyrinth/model.ts');
const G = await import('../client/labyrinth/gesture.ts');
const NAV = await import('../client/labyrinth/nav.ts');
const BU = await import('../client/labyrinth/buildings.ts');

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
let checks = 0, fails = 0;
const ok = (name, cond, saw) => { checks++; if (!cond) { fails++; console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)?.slice(0, 300)}` : ''}`); } else if (opt.v) console.log(`ok    ${name}`); };

// (the grid turned a quarter `r` times about (6, 6), and mirrored: every scene drawn in each)
const C = 6;
const turn = (r, m) => ([i, j]) => { let [x, z] = [i - C, j - C]; if (m) x = -x; for (let q = 0; q < r; q++) [x, z] = [-z, x]; return [x + C, z + C]; };
const ORIENT = [0, 1, 2, 3].flatMap((r) => [[r, false], [r, true]]);

/** the scene's hand, in one orientation: what it touches turned with it */
function hand(w, T) {
  const top = (c) => { const [i, j] = T(c), t = w.topFrom(w.ground(i, j) - 1, i, j); return w.stone(t - 1, i, j) ? { face: 'top', hit: [t - 1, i, j], to: [t, i, j] } : { face: 'ground', hit: [w.ground(i, j) - 1, i, j], to: [w.ground(i, j), i, j] }; };
  const apply = (op, what) => { if (!op || op.refused) throw new Error(`${what}: ${op?.refused ?? 'nothing'}`); w.apply({ ...op, alts: undefined }); return op; };
  return {
    T,
    /** a stroke from a to b (cells, in the scene's frame), with mass or a way in hand */
    stroke: (a, b, intent, end = null) => { const cells = G.connect([T(a), T(b)]); return apply(G.trace(w, top(a), cells, end ? top(end) : null, () => 0, 0, [], intent), `stroke ${a}→${b}`); },
    /** a tap, with mass or a way in hand */
    tap: (c, intent = 'mass') => apply(G.tap(w, top(c), 0, false, intent), `tap ${c}`),
    /** a raised walkway as the model holds one (from a top, out along cells, at that top's height), turned with the scene */
    walkway: (cells) => { const P = cells.map((c) => T(c)), [i, j] = P[0], h = w.topFrom(w.ground(i, j) - 1, i, j); w.apply({ connect: { from: [h, i, j], to: null, path: P }, born: 0, why: 'walkway' }); },
    /** stone laid as a block is, by the hand (a column `n` high) */
    column: (c, n) => { const [i, j] = T(c), g = w.ground(i, j); w.apply({ add: Array.from({ length: n }, (_, k) => [g + k, i, j, 0]) }); },
  };
}
const walks = (w, a, b) => NAV.reaches(BU.walkable(w), a, b);
const { replay } = await import('../client/labyrinth/model.ts');

/**
 * The checks every encounter rule gets, whatever it is (client/labyrinth/encounters.ts): for each meeting found, each
 * rung can be chosen and is laid as chosen; nothing it lays is in a passage or a stair's way; the things that met can
 * be walked between, end to end, at every rung; the rungs only add (each lays what the one below it does, and more);
 * and touching it again (the second thing made again) climbs a rung.
 */
function meetings(w, tag, expect) {
  ok(`${tag}: the meeting found (${expect})`, w.meetings.some((m) => m.rule === expect), w.meetings.map((m) => m.rule));
  for (const m of w.meetings.filter((q) => q.rule === expect)) {
    ok(`${tag}: left to itself, the smallest sufficient (${m.candidates[0].label})`, m.laid === 0, { laid: m.laid, wanted: m.wanted });
    const ends = m.by.map((q) => w.walks.get(w.ops[q]) ?? []).map((cs) => cs[cs.length - 1]).filter(Boolean);
    let below = null;
    for (const c of m.candidates) {
      const v = replay(w.encode(), w.seed); v.apply({ choose: [[...m.anchor, c.level]], why: 'reading' });
      const n = v.meetings.find((q) => q.anchor.join() === m.anchor.join());
      ok(`${tag}: chosen, rung ${c.level} (${c.label}) is what's laid`, n?.laid === c.level, n && { laid: n.laid, wanted: n.wanted });
      // (a flight's steps are each in the way of the one below: that's the flight going on, not a claim crossed)
      const flightOn = (k, i, j) => { const d = v.stair(k, i, j); return d >= 0 && v.stair(k - 1, i - DIRS[d][0], j - DIRS[d][1]) === d; };
      const intoClaims = (n?.at ?? []).filter(([k, i, j]) => (v.passage(k, i, j) >= 0 && !v.archway(k, i, j)) || (v.way(k, i, j) && !flightOn(k, i, j)));
      ok(`${tag}: rung ${c.level} lays nothing in a passage or a stair's way`, !intoClaims.length, intoClaims);
      // (walked between: from one's end to the other's, or to the top it fell short of; unless this rung is to leave
      // them apart)
      const to = ends.length > 1 ? ends[1] : m.cells[m.cells.length - 1];
      if (!c.verbs.includes('separate')) ok(`${tag}: at rung ${c.level}, walked between, end to end`, walks(v, ends[0], to), { from: ends[0], to });
      const here = new Set((n?.at ?? []).map((q) => q.join()));
      if (below) ok(`${tag}: rung ${c.level} lays all that rung ${c.level - 1} does`, [...below].every((q) => here.has(q)), { below: [...below], here: [...here] });
      below = here;
    }
    // (insisting: the last of the things that made it, made again)
    const v = replay(w.encode(), w.seed); v.apply(JSON.parse(JSON.stringify(w.ops[Math.max(...m.by)])));
    const n = v.meetings.find((q) => q.anchor.join() === m.anchor.join());
    ok(`${tag}: made again, a rung higher`, (n?.laid ?? -1) >= 1, n && { laid: n.laid, wanted: n.wanted });
  }
}
/** a gatehouse's checks: one building over the way, its roof whole over it, the way through its foot, walked */
function gatehouse(w, H, tag) {
  const [, i, j] = at(w, H.T, [5, 6]), B = BU.buildings(w), b = B.of.get(key(1, i, j));
  ok(`${tag}: one building, over the way`, !!b && b.cols.length === 6 && B.list.length === 1, B.list.map((x) => x.cols));
  ok(`${tag}: the way through its foot`, !!b && b.through.length === 2, b?.through);
  ok(`${tag}: roofed whole`, !!b?.roof && BU.underRoof(b).length === 6, b && { roof: b.roof, walked: b.walked });
  ok(`${tag}: no door or window cut in the passage`, !!b && !b.openings.some((o) => w.archway(o.k, o.i, o.j) >= 0), b?.openings);
  ok(`${tag}: and the way walks end to end`, walks(w, at(w, H.T, [3, 6]), at(w, H.T, [9, 6])));
}
const at = (w, T, c) => { const [i, j] = T(c); return [w.ground(i, j), i, j]; };

const SCENES = [
  {
    name: 'passage kept under added mass: a way, then a block tapped on to it',
    run(w, H) {
      H.stroke([3, 6], [9, 6], 'way');
      H.tap([6, 6], 'mass');
      const [k, i, j] = at(w, H.T, [6, 6]);
      ok(`${this.tag}: the stone over the way is an archway`, w.stone(k, i, j) && w.archway(k, i, j) >= 0, { stone: w.stone(k, i, j), arch: w.archway(k, i, j) });
      ok(`${this.tag}: and the way still walks end to end`, walks(w, at(w, H.T, [3, 6]), at(w, H.T, [9, 6])));
    },
  },
  {
    name: 'passage kept under added mass: a way, then a wall drawn across it',
    run(w, H) {
      H.stroke([3, 6], [9, 6], 'way');
      H.stroke([6, 3], [6, 9], 'mass');
      const [k, i, j] = at(w, H.T, [6, 6]);
      ok(`${this.tag}: where the wall crosses the way, a gate`, w.stone(k, i, j) && w.archway(k, i, j) >= 0);
      ok(`${this.tag}: and the way still walks end to end`, walks(w, at(w, H.T, [3, 6]), at(w, H.T, [9, 6])));
    },
  },
  {
    name: 'route through a wall: a wall, then a way drawn across it',
    run(w, H) {
      H.stroke([6, 3], [6, 9], 'mass');
      const op = H.stroke([3, 6], [9, 6], 'way');
      const [k, i, j] = at(w, H.T, [6, 6]);
      ok(`${this.tag}: a gate opened where the way goes through`, w.stone(k, i, j) && w.archway(k, i, j) >= 0, { note: op.note });
      ok(`${this.tag}: the way walks end to end`, walks(w, at(w, H.T, [3, 6]), at(w, H.T, [9, 6])));
      ok(`${this.tag}: and isn't routed round it`, !op.took?.includes('routed-round'), op.took);
    },
  },
  {
    name: 'no pier in a passage: a way, then a bridge over it',
    run(w, H) {
      H.stroke([6, 3], [6, 9], 'way');
      H.column([3, 6], 2); H.column([9, 6], 2);
      H.stroke([3, 6], [9, 6], 'mass', [9, 6]);
      const piers = [];
      for (let q = 3; q <= 9; q++) { const [, i, j] = at(w, H.T, [6, q]); for (let k = 0; k < 3; k++) if (w.pier(k, i, j) && w.passage(k, i, j) >= 0) piers.push([k, i, j]); }
      ok(`${this.tag}: no pier stands in the way under the bridge`, !piers.length, piers);
      ok(`${this.tag}: the way under it still walks`, walks(w, at(w, H.T, [6, 3]), at(w, H.T, [6, 9])));
    },
  },
  {
    name: 'tower landing: a way to a tower\'s foot finds a door, not a blank face',
    run(w, H) {
      for (const c of [[7, 6], [8, 6], [7, 7], [8, 7]]) H.column(c, 4);
      H.stroke([2, 6], [6, 6], 'way');
      const b = BU.buildings(w).list.find((x) => x.cols.some(([i, j]) => { const [a, c] = H.T([7, 6]); return i === a && j === c; }));
      const [, i0, j0] = at(w, H.T, [6, 6]);
      const door = b?.openings.find((o) => o.kind === 'door' && Math.abs(o.i - i0) + Math.abs(o.j - j0) === 1);
      ok(`${this.tag}: a door on the face the way arrives at`, !!door, b?.openings.filter((o) => o.kind === 'door'));
    },
  },
  {
    name: 'roof terrace seam: a bridge on to one edge of a roofed house keeps the rest of its roof',
    run(w, H) {
      for (let i = 6; i <= 8; i++) for (let j = 5; j <= 6; j++) H.column([i, j], 3);
      const house = () => BU.buildings(w).list.find((x) => x.cols.some(([i, j]) => { const [a, c] = H.T([7, 5]); return i === a && j === c; }));
      ok(`${this.tag}: the house roofed to begin with`, !!house()?.roof, house()?.roof);
      H.column([3, 5], 3);
      H.stroke([3, 5], [6, 5], 'mass', [6, 5]);
      const b = house(), [ti, tj] = H.T([6, 5]);
      ok(`${this.tag}: arrived on along one edge, that edge a terrace`, !!b?.terrace?.some(([i, j]) => i === ti && j === tj), b && { terrace: b.terrace, roof: b.roof });
      ok(`${this.tag}: and the rest of it still roofed`, !!b?.roof && BU.underRoof(b).length >= 2, b && { roof: b.roof, under: BU.underRoof(b) });
    },
  },
  {
    name: 'stable identity: a house extended by a column keeps its windows',
    run(w, H) {
      for (const c of [[6, 6], [7, 6], [6, 7], [7, 7]]) H.column(c, 3);
      const of = () => BU.buildings(w).list.find((x) => x.cols.some(([i, j]) => { const [a, c] = H.T([7, 7]); return i === a && j === c; }));
      const before = of(), style = before?.openings.find((o) => o.kind === 'window')?.style, id = before?.id;
      for (const c of [[5, 6], [6, 5], [5, 7], [8, 6]]) H.column(c, 3);
      const after = of();
      ok(`${this.tag}: the same identity`, after?.id === id, { id, after: after?.id });
      ok(`${this.tag}: the same windows`, after?.openings.find((o) => o.kind === 'window')?.style === style, { style, after: after?.openings.find((o) => o.kind === 'window')?.style });
    },
  },
  {
    name: 'gatehouse: a way, then a tower over it',
    run(w, H) {
      H.stroke([2, 6], [10, 6], 'way');
      for (let i = 5; i <= 6; i++) for (let j = 5; j <= 7; j++) H.column([i, j], 4);
      gatehouse(w, H, this.tag);
    },
  },
  {
    name: 'gatehouse, the other order: a tower, then a way drawn through it',
    run(w, H) {
      for (let i = 5; i <= 6; i++) for (let j = 5; j <= 7; j++) H.column([i, j], 4);
      const op = H.stroke([2, 6], [10, 6], 'way');
      ok(`${this.tag}: not routed round it`, !op.took?.includes('routed-round'), op.took);
      gatehouse(w, H, this.tag);
    },
  },
  {
    name: 'inhabited bridge: a bridge, then rooms on it',
    run(w, H) {
      H.column([3, 6], 2); H.column([9, 6], 2);
      H.stroke([3, 6], [9, 6], 'mass', [9, 6]);
      for (let i = 5; i <= 7; i++) { const [x, z] = H.T([i, 6]); w.apply({ add: [[2, x, z, 0], [3, x, z, 0]] }); }
      const b = BU.buildings(w).list.find((x) => x.cols.length === 3);
      ok(`${this.tag}: the rooms on it one building`, !!b, BU.buildings(w).list.map((x) => x.cols));
      ok(`${this.tag}: standing on the deck, the passage at its foot`, !!b && b.base.every((k) => k === 2) && b.through.length === 3, b && { base: b.base, through: b.through });
      ok(`${this.tag}: roofed, with windows`, !!b?.roof && b.openings.some((o) => o.kind === 'window'), b && { roof: b.roof });
      ok(`${this.tag}: and the bridge still walks end to end`, walks(w, [2, ...H.T([3, 6])], [2, ...H.T([9, 6])]));
    },
  },
  {
    name: 'ways meet corner to corner: two raised walkways, one ending diagonal to the other\'s end',
    run(w, H) {
      H.column([3, 3], 2); H.walkway([[3, 3], [4, 3], [5, 3], [6, 3]]);
      H.column([7, 8], 2); H.walkway([[7, 8], [7, 7], [7, 6], [7, 5], [7, 4]]);
      meetings(w, this.tag, 'ways-meet');
    },
  },
  {
    name: 'ways meet a cell short: a raised walkway ending a cell short of a top at its height',
    run(w, H) {
      H.column([3, 3], 2); H.walkway([[3, 3], [4, 3], [5, 3], [6, 3]]);
      H.column([8, 3], 2); H.column([8, 4], 2);
      meetings(w, this.tag, 'ways-meet');
    },
  },
  {
    name: 'ways a level apart: two raised walkways side by side, one a level higher',
    run(w, H) {
      H.column([3, 3], 2); H.walkway([[3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3]]);
      H.column([3, 5], 3); H.walkway([[3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5]]);
      meetings(w, this.tag, 'ways-a-level-apart');
    },
  },
  {
    name: 'a way ends in the air: a raised walkway out from a top into nothing',
    run(w, H) {
      H.column([3, 4], 2); H.walkway([[3, 4], [4, 4], [5, 4], [6, 4], [7, 4]]);
      meetings(w, this.tag, 'way-ends');
      const [, i, j] = at(w, H.T, [7, 4]);
      ok(`${this.tag}: left to itself, a rail across the end`, !!w.dressed(1, i, j)?.parapet, w.dressed(1, i, j));
    },
  },
  {
    name: 'ways cross at two levels: a way, then a bridge over it',
    run(w, H) {
      H.stroke([6, 3], [6, 9], 'way');
      H.column([3, 6], 2); H.column([9, 6], 2);
      H.stroke([3, 6], [9, 6], 'mass', [9, 6]);
      meetings(w, this.tag, 'ways-cross');
    },
  },
  {
    name: 'a flight aimed at a wall: up to a narrow terrace against a wall, another terrace beyond it',
    run(w, H) {
      for (let j = 3; j <= 8; j++) H.column([7, j], 4);
      for (let j = 4; j <= 6; j++) { H.column([6, j], 2); H.column([8, j], 2); }
      H.stroke([2, 5], [6, 5], 'way', [6, 5]);
      meetings(w, this.tag, 'flight-meets-wall');
      const [, i, j] = at(w, H.T, [7, 5]);
      ok(`${this.tag}: left to itself, an arch through the wall at its head`, w.archway(2, i, j) >= 0, w.archway(2, i, j));
    },
  },
];

const t0 = Date.now(), scenes = [];
for (const S of SCENES) {
  if (opt.only && !S.name.includes(opt.only)) continue;
  for (const [r, m] of ORIENT) {
    const w = new World(1), H = hand(w, turn(r, m));
    S.tag = `${S.name.split(':')[0]} (turned ${r}${m ? ', mirrored' : ''})`;
    try { S.run(w, H); } catch (e) { checks++; fails++; console.log(`FAIL  ${S.tag}: ${String(e.message ?? e).slice(0, 200)}`); }
    if (opt.ops && r === 0 && !m) console.log(`${S.name}\n  ?ops=${encodeURIComponent(w.encode())}`);
    if (r === 0 && !m) {
      scenes.push({ name: S.name, ops: w.encode() });
      // (a meeting's every rung, drawn too: the ladder, as the hand would see it chosen)
      const mt = w.meetings[0];
      if (mt) for (const c of mt.candidates.filter((q) => q.level > 0)) { const v = replay(w.encode(), w.seed); v.apply({ choose: [[...mt.anchor, c.level]], why: 'reading' }); scenes.push({ name: `${S.name.split(':')[0]}, rung ${c.level}: ${c.label}`, ops: v.encode() }); }
    }
  }
}
console.log(`${checks - fails} of ${checks} connector checks hold (${SCENES.length} scenes × ${ORIENT.length} orientations, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exitCode = fails ? 1 : 0;
if (opt.render) {
  // (the page itself, WebGL and all, nothing moving: each scene as it's drawn, to be looked at)
  process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
  const { withWood } = await import('./harness.mjs'), { mkdirSync } = await import('node:fs');
  mkdirSync(new URL('./out/connectors/', import.meta.url), { recursive: true });
  await withWood(async (lab) => {
    for (const [n, sc] of scenes.entries()) {
      const p = await lab.open(`instant&zoom=${opt.zoom ?? 0.9}&turn=${opt.turn ?? 0}&ops=${encodeURIComponent(sc.ops)}`);
      await p.waitForTimeout(9000);
      const file = new URL(`./out/connectors/${String(n + 1).padStart(2, '0')}-${sc.name.split(':')[0].replace(/[^a-z]+/gi, '-')}.png`, import.meta.url).pathname;
      await p.screenshot({ path: file, timeout: 300000 });
      console.log(`drawn: ${file}`);
      await p.close();
    }
  }, { width: 700, height: 700 });
}
