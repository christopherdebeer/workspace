/**
 * Squishy: the places, made from their pieces. Every level is laid fresh from its seed: a run through a
 * place, its pieces each laid where the last left off and every hop in it made sure of as it's laid. A
 * place is its room (a table in the middle of a room; a counter against a tiled wall with windows; the
 * sink; the stove's hob), what things stand on there (see supports.ts), how it starts, how it ends, and
 * its pieces, the harder coming in over its levels:
 *
 * - **The Preparation Table**: a ramekin with a wooden spoon laid from it up onto a painted tin bench, a
 *   tea towel thrown over the bench's end; the floury paddle board across two jars; a plate tipped up on
 *   a teacup on a cake tin; the butter dish; plates, tins and steamers on stools, crates and cookbooks.
 *   It starts on a cloth on cookbooks; home is the golden steamer.
 * - **The Counter by the Window**: a loaf in its bread basket on two canisters; a baking tray on a rack,
 *   buttered in a corner; a tall cake stand, sticky with hundreds and thousands; a tiered stand; a konjac
 *   jelly, or two jellies; and, at the end, the bread bin and the shelf above it with a towel hung over
 *   its edge to climb, and home on the window sill.
 * - **The Sink**: a sponge, soft; a soap dish heaped with bubbles that bounce you; a dish rack, its steel
 *   drip tray sloping and wet, its wire rack above; and, at the end, across the sink at the dishcloth hung
 *   from the window sill, up it, and home along the sill.
 * - **The Stovetop**: the butter dish, a pan with its rim, a honey jar to land against, pots whose lids
 *   rattle on the steam, a towel to climb; on crates, racks, boards across jars.
 * - **The Whole Kitchen**: anything.
 *
 * There's no safe ground anywhere: the table's or the counter's top is well below every spot, and to
 * touch it is to fall, back to the last spot you stood on.
 */
import { hash, seeded, type Rand } from '../kit/rng';
import { FEELS } from './jelly';
import { CHAPTER_AT, DUST, MAT, RADIUS, box, cap, chapterOf, cyl, hop, jelly, serviette, tower, type Chapter, type Level, type Shape, type Top, type Tower, type V3 } from './level';
import { box as drawBox, capsule, drawShapes, quad } from './mesh';
import { drainer, smear, spoon, tiltPlate, towel } from './props';
import { HOLDS, assemble, holder, tiered, type Holder } from './supports';

/** where the wall is (its face), and how far out from it a course may come */
const BACK = 66, FRONT = 2;
type Kind = 'stack' | 'plate' | 'pudding' | 'susan' | 'tin' | 'butter' | 'pan' | 'lid' | 'honey' | 'board' | 'towel' | 'jellies' | 'tray' | 'cloth' | 'tiered' | 'rack'
  | 'spoon' | 'paddle' | 'tilt' | 'loaf' | 'konjac' | 'stand' | 'sponge' | 'soap' | 'drainer' | 'shelfHome' | 'sinkHome';
/** the counter's this far below every top, at least: to touch it is to fall */
const KILL = 6, LOW = 15;
/** what things stand on, by place: the table's wooden and homely; the window's delicate; the sink's enamel and wire; the stove's sturdy and plain; the whole kitchen, anything */
const ROOM: Record<Chapter, Holder[]> = {
  table: ['books', 'stool', 'bench', 'crate', 'bowl', 'books', 'stool'],
  counter: ['pedestal', 'books', 'tins', 'crate', 'stool', 'bowl', 'pedestal'],
  sink: ['bowl', 'rack', 'tins', 'crate', 'bowl', 'rack'],
  stove: ['crate', 'rack', 'trestle', 'tins', 'bench', 'books', 'crate', 'stool'],
  mixed: ['stool', 'pedestal', 'crate', 'books', 'bowl', 'trestle', 'bench', 'rack', 'tins'],
};
/**
 * Each place: what can come in its levels (by which of its levels it is, from 0), what its first level
 * brings in for sure (and later ones, one new thing each, early), and how it ends (a piece that ends in
 * home; or, without one, home stood on something).
 */
const PLACE: Record<Chapter, { pool: (i: number) => Kind[]; intro: (i: number) => Kind[]; finale: (i: number, r: Rand) => Kind | null }> = {
  table: {
    pool: (i) => ['spoon', 'paddle', 'butter', 'tin', 'plate', 'stack', 'board', ...(i >= 1 ? ['tilt', 'pudding', 'tilt'] as Kind[] : []), ...(i >= 2 ? ['susan', 'tiered'] as Kind[] : []), ...(i >= 3 ? ['jellies'] as Kind[] : [])],
    intro: (i) => (i === 0 ? ['spoon', 'butter', 'paddle'] : i === 1 ? ['tilt'] : i === 2 ? ['pudding'] : ['susan']),
    finale: () => null,
  },
  counter: {
    pool: (i) => ['loaf', 'tray', 'stand', 'tin', 'plate', 'stack', 'tiered', 'loaf', ...(i >= 1 ? ['konjac', 'konjac'] as Kind[] : []), ...(i >= 2 ? ['jellies', 'rack'] as Kind[] : [])],
    intro: (i) => (i === 0 ? ['loaf', 'tray', 'stand'] : i === 1 ? ['konjac'] : i === 2 ? ['tiered'] : ['jellies']),
    finale: (i, r) => (i === 0 || r() < 0.6 ? 'shelfHome' : null),
  },
  sink: {
    pool: (i) => ['sponge', 'soap', 'drainer', 'plate', 'tin', 'stack', 'sponge', 'soap', ...(i >= 1 ? ['pudding', 'rack'] as Kind[] : []), ...(i >= 2 ? ['tiered', 'konjac'] as Kind[] : [])],
    intro: (i) => (i === 0 ? ['sponge', 'soap', 'drainer'] : i === 1 ? ['rack'] : i === 2 ? ['konjac'] : ['tiered']),
    finale: (i, r) => (i === 0 || r() < 0.7 ? 'sinkHome' : null),
  },
  stove: {
    pool: (i) => ['stack', 'pan', 'butter', 'pan', 'rack', 'tray', ...(i >= 1 ? ['honey', 'honey', 'jellies'] as Kind[] : []), ...(i >= 2 ? ['lid', 'lid', 'towel'] as Kind[] : []), ...(i >= 3 ? ['tin', 'lid', 'towel'] as Kind[] : [])],
    intro: (i) => (i === 0 ? ['butter', 'pan'] : i === 1 ? ['honey'] : i === 2 ? ['lid'] : ['towel']),
    finale: () => null,
  },
  mixed: {
    pool: () => ['stack', 'board', 'plate', 'pudding', 'tin', 'susan', 'pan', 'butter', 'honey', 'lid', 'jellies', 'towel', 'tray', 'tiered', 'rack', 'honey',
      'spoon', 'paddle', 'tilt', 'loaf', 'konjac', 'stand', 'sponge', 'soap', 'drainer'],
    intro: () => [],
    finale: (_i, r) => (r() < 0.25 ? 'shelfHome' : r() < 0.3 ? 'sinkHome' : null),
  },
};
/** which of its place's levels level n is (from 0) */
const within = (n: number) => n - CHAPTER_AT[chapterOf(n)];
const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);
/** (a lot of vertices on to the end of others: not as arguments, there are too many) */
const append = (a: number[], b: number[]) => { for (let k = 0; k < b.length; k++) a.push(b[k]); };

/** What can come next, by level and by what came last. */
function pick(r: Rand, n: number, last: Kind | null, used: Map<Kind, number>): Kind {
  let pool = PLACE[chapterOf(n)].pool(Math.min(3, within(n)));
  // (not the same twice running; nor honey after butter, or after a buttered tray: honey won't hold butter)
  pool = pool.filter((k) => k !== last && !((last === 'butter' || last === 'tray') && k === 'honey'));
  // (two climbs, two jars, at most, a level; a big piece once)
  pool = pool.filter((k) => !((k === 'towel' || k === 'honey') && (used.get(k) ?? 0) >= 2) && !(['spoon', 'drainer', 'jellies', 'loaf'].includes(k) && used.has(k)));
  return pool[Math.floor(r() * pool.length)];
}

/** The tops of a kind of one thing: how high it stands (its top), how far out it reaches. */
const ONE: Partial<Record<Kind, { top: Top; y: [number, number]; rad: [number, number] }>> = {
  stack: { top: 'steamer', y: [16, 30], rad: [10.5, 13] },
  plate: { top: 'plate', y: [15, 26], rad: [11, 13] },
  pudding: { top: 'pudding', y: [16, 26], rad: [7.5, 7.5] },
  susan: { top: 'susan', y: [15, 24], rad: [13, 15] },
  tin: { top: 'tin', y: [18, 30], rad: [6.5, 8] },
  butter: { top: 'butter', y: [15, 22], rad: [12, 12] },
  pan: { top: 'pan', y: [16, 26], rad: [13, 15] },
  lid: { top: 'lid', y: [18, 30], rad: [9.5, 12] },
  board: { top: 'board', y: [15, 20], rad: [9, 9] },
  honey: { top: 'honey', y: [28, 34], rad: [8.5, 8.5] },
};

/** a piece: its stops, what else is met about it, what's drawn besides, how far it reaches on past its last stop; and a hole it makes in the counter (the sink) */
interface Piece { stops: Tower[]; extra: Shape[]; decor: number[]; reach: number; hole?: [number, number, number, number]; window?: number }

/** What a top stands on, from what its kind can and what the room has. */
function holderFor(top: Top, r: Rand, n: number): Holder | null {
  const can = HOLDS[top];
  if (!can) return null;
  const room = ROOM[chapterOf(n)].filter((h) => can.includes(h));
  return room.length ? room[Math.floor(r() * room.length)] : null;
}
/** A top on what it stands on; on tins from the counter, as they always were, if nothing will hold it. */
function standOn(top: Top, at: V3, rad: number, yaw: number, r: Rand, n: number): { stop: Tower; decor: number[]; on: boolean } {
  const kind = holderFor(top, r, n);
  const off = kind && kind !== 'rack' && kind !== 'bowl' && r() < 0.3 ? (r() < 0.5 ? -1 : 1) * ramp(r, 3, 5) : 0;
  const a = kind ? assemble(top, kind, at, rad, yaw, r, 0, off) : null;
  return a ? { stop: a.tower, decor: a.decor, on: true } : { stop: tower(top, at, rad, yaw, r), decor: [], on: false };
}
/** (what stands on the counter itself, as it always did: on the stove, a burner under it) */
const onHob = new WeakSet<Tower>();
const coinAt = (x: number, z: number) => (salt: number) => (hash(Math.round(x * 10), Math.round(z * 10), salt) % 1000) / 1000;

/** A piece of a kind, its first stop's middle at x, z (a height of its own), from the dice. */
function piece(kind: Kind, x: number, z: number, r: Rand, n: number): Piece | null {
  const one = ONE[kind];
  if (one) {
    // (a honey jar stands behind where you land against it, toward the wall)
    // (and well back, so the way on from its side is forward, away from it)
    if (kind === 'honey' && (z > BACK - 26 || z < 26)) z = Math.max(26, Math.min(BACK - 26, z));
    const rad = ramp(r, ...one.rad);
    // (turned to the course, which runs along x: a pan's handle, a board's jars, out to the sides; a jar toward the wall)
    const yaw = kind === 'honey' ? 0 : Math.PI / 2 + ramp(r, -0.4, 0.4), at: V3 = [x, Math.round(ramp(r, ...one.y)), z];
    const t = kind === 'honey' || kind === 'board' ? { stop: tower(one.top, at, rad, yaw, r), decor: [], on: false } : standOn(one.top, at, rad, yaw, r, n);
    if (!t.on) onHob.add(t.stop);
    // (a plate: crumbs on it, or pepper, more often than not)
    if (kind === 'plate') { const pl = t.stop.land?.find((sh) => sh.mat === MAT.porcelain), d = r(); if (pl) pl.dust = d < 0.4 ? DUST.pepper : d < 0.75 ? DUST.crumbs : DUST.none; }
    // (past a jar is past the jar, not only where you landed against it)
    return { stops: [t.stop], extra: [], decor: t.decor, reach: kind === 'honey' ? 11 : Math.max(rad, ...t.stop.shapes.map((s) => Math.max(s.hi[0] - x, s.hi[2] - z, x - s.lo[0], z - s.lo[2]))) };
  }
  // (what isn't a top on something: stood on something itself)
  const under = (kinds: Holder[], y1: number, need: number, yaw = 0) => holder(kinds[Math.floor(r() * kinds.length)], x, z, 0, y1, need, yaw, coinAt(x, z));
  if (kind === 'cloth') {
    // (where it starts: by the window, a cloth folded on a biscuit tin; at the sink, a dishcloth on an upturned
    // pudding basin; elsewhere, a cloth folded on cookbooks, or a stool)
    const place = chapterOf(n), y = Math.round(ramp(r, LOW, LOW + 3)), yaw = ramp(r, -0.5, 0.5);
    const h = place === 'counter' ? { shapes: [cyl(x, z, 11, 0, y - 1, MAT.tin)], decor: [] as number[] }
      : place === 'sink' ? { shapes: [cyl(x, z, 9.5, 0, y - 1, MAT.pot, 0.6)], decor: [] as number[] }
      : under(place === 'table' ? ['books'] : ['books', 'stool', 'crate'], y - 0.8, 8, yaw);
    const pad = box([x, y - 0.5, z], [7.5, 0.5, 6.5], yaw, place === 'sink' ? MAT.towel : MAT.gingham, 0.9);
    return { stops: [{ top: 'pad', at: [x, y, z], r: 6, box: [7, 6], yaw, shapes: [...h.shapes, pad], land: [pad] }], extra: [], decor: h.decor, reach: 10 };
  }
  if (kind === 'tray') {
    // (a baking tray on a cooling rack, or a crate, buttered in one corner)
    const y = Math.round(ramp(r, LOW, LOW + 5));
    const h = under(['rack', 'crate', 'books'], y - 0.8, 13);
    const tray = box([x, y - 0.4, z], [15, 0.4, 11], 0, MAT.pan, 0.6);
    const lips = [box([x - 15, y + 0.3, z], [0.3, 0.7, 11], 0, MAT.pan, 0.6), box([x + 15, y + 0.3, z], [0.3, 0.7, 11], 0, MAT.pan, 0.6),
      box([x, y + 0.3, z - 11], [15, 0.7, 0.3], 0, MAT.pan, 0.6), box([x, y + 0.3, z + 11], [15, 0.7, 0.3], 0, MAT.pan, 0.6)];
    const d: number[] = [...h.decor];
    const corner = r() < 0.5 ? 1 : -1;
    const sm = smear([x + 13 * corner, y, z - 9], [x + 2 * corner, y, z + 2], 9, n * 7 + Math.round(x));
    for (const s of sm.shapes) { s.tack = 0; s.dust = DUST.butter; }
    append(d, sm.verts);
    return { stops: [{ top: 'tray', at: [x, y, z], r: 9, box: [13.5, 9.5], yaw: 0, shapes: [...h.shapes, tray, ...lips, ...sm.shapes], land: [tray, ...sm.shapes] }], extra: [], decor: d, reach: 17 };
  }
  if (kind === 'jellies') {
    // (a pudding and a konjac, each on its saucer on something: a cake stand, a stool, a crate)
    const d: number[] = [], stops: Tower[] = [];
    const kinds: Array<[keyof typeof FEELS, number, number, number]> = [['pudding', MAT.jelly, 8, 7], ['konjac', MAT.konjac, 9, 8]];
    const dz = ramp(r, -10, 10);
    kinds.forEach(([feel, mat, rad, h], i) => {
      const cx = x + i * 26, cz = Math.max(FRONT + 12, Math.min(BACK - 22, z + i * dz));
      const seat = Math.round(ramp(r, LOW - 6, LOW - 2));
      const kinds: Holder[] = ['pedestal', 'stool', 'crate'];
      const hd = holder(kinds[Math.floor(r() * kinds.length)], cx, cz, 0, seat, rad + 3, ramp(r, 0, 3), coinAt(cx, cz));
      const saucer = cyl(cx, cz, rad + 3, hd.y, hd.y + 0.8, MAT.porcelain, 0.5);
      const j = jelly(cx, cz, rad, hd.y + 0.8, hd.y + 0.8 + h, mat, FEELS[feel]);
      if (r() < 0.4) j.dust = DUST.sprinkles;
      append(d, hd.decor);
      stops.push({ top: 'jelly', at: [cx, hd.y + 0.8 + h, cz], r: rad - 2, yaw: 0, shapes: [...hd.shapes, saucer, j], land: [j] });
    });
    return { stops, extra: [], decor: d, reach: 14 };
  }
  if (kind === 'tiered') {
    const t = tiered(x, z, 0, Math.round(ramp(r, LOW + 4, LOW + 12)), coinAt(x, z));
    return { stops: [t.stop], extra: [], decor: t.decor, reach: 15 };
  }
  if (kind === 'rack') {
    // (a cooling rack with nothing on it, on its tins: land across its wires)
    const y = Math.round(ramp(r, LOW, LOW + 6));
    const h = holder('rack', x, z, 0, y, 9, ramp(r, -0.3, 0.3), coinAt(x, z));
    const wires = h.shapes.filter((s) => s.kind === 'cap' && Math.abs(s.c[1] - s.b[1]) < 0.01 && s.c[1] > y - 0.6);
    return { stops: [{ top: 'rack', at: [x, y, z], r: h.r - 1, box: [h.box![0] - 1.5, h.box![1] - 1.5], yaw: ramp(r, 0, 0), shapes: h.shapes, land: wires }], extra: [], decor: h.decor, reach: Math.hypot(...h.box!) };
  }
  if (kind === 'towel') {
    // (a bread bin out from the wall; a shelf above it no flick reaches; a towel over the shelf's edge)
    const d: number[] = [];
    const bz = BACK - 28.5;
    const bin = box([x, 12, bz], [16, 12, 15.5], 0, MAT.enamel, 0.75);
    // (drawn as a bread bin: its body; its lid, a little proud, a band of wood under its edge; a wooden knob on its front)
    bin.ghost = true;
    drawBox(d, [x, 10.4, bz], [15.7, 10.4, 15.2], 0, MAT.enamel);
    drawBox(d, [x, 21.2, bz], [16.3, 0.45, 15.8], 0, MAT.board);
    drawBox(d, [x, 22.8, bz], [16.1, 1.2, 15.6], 0, MAT.enamel);
    drawBox(d, [x, 24, bz], [15.4, 0.12, 14.9], 0, MAT.enamel);
    capsule(d, [x - 2.2, 18.5, bz - 15.6], [x + 2.2, 18.5, bz - 15.6], 0.75, MAT.board, 10, 3);
    const SY = Math.round(ramp(r, 72, 78)), SX = x + 6, SZ = BACK - 6;
    const shelf = box([SX, SY - 1, SZ], [26, 1, 6], 0, MAT.board, 0.85);
    const brackets = [-18, 18].map((dx) => box([SX + dx, SY - 6, BACK - 5], [0.6, 4, 5], 0, MAT.board, 0.8));
    const hangTo = 40;
    const tw = towel([SX - 13, SY, BACK - 12], [1, 0, 0], [0, 0, -1], 24,
      [[-4.5, 0.15], [-0.6, 0.35], [0.35, -0.5], [0.6, -4], [0.75, hangTo - SY + 6], [0.8, hangTo - SY]], n * 3 + Math.round(x));
    append(d, tw.verts);
    return {
      stops: [
        { top: 'bin', at: [x, 24, bz], r: 9, box: [15, 14.5], yaw: 0, shapes: [bin] },
        { top: 'shelf', at: [SX, SY, SZ], r: 4, box: [24, 4.2], yaw: 0, shapes: [shelf, ...brackets, ...tw.shapes], land: [shelf, ...tw.shapes], wall: tw.shapes, wallAt: [SX - 1, (SY + hangTo) / 2, BACK - 12.8] },
      ], extra: [], decor: d, reach: 30,
    };
  }
  if (kind === 'spoon') {
    // a ramekin, a wooden spoon laid from it up onto a painted tin bench (land in its bowl, it catches you,
    // and up its handle); a tea towel thrown over the bench's far end, down both its sides
    const H = Math.round(ramp(r, 18, 21)), W = 13, BL = 30, RY = 14;
    const bowl: V3 = [x, RY, z];
    const ramekin = cyl(x, z, 5.2, 0, RY + 0.5, MAT.porcelain, 0.6);
    const Cb: V3 = [x + 30 + W / 2 + ramp(r, -2, 2), 0, z + ramp(r, -4, 4)];
    const top = box([Cb[0], H - 0.4, Cb[2]], [W / 2, 0.4, BL / 2], 0, MAT.floral, 0.8);
    const legs = [-1, 1].map((sz) => box([Cb[0], (H - 0.8) / 2, Cb[2] + sz * (BL / 2 - 0.4)], [W / 2, (H - 0.8) / 2, 0.4], 0, MAT.floral, 0.8));
    const rest: V3 = [Cb[0] - W / 2 + 0.8, 0, z];
    const yaw = Math.atan2(rest[0] - bowl[0], rest[2] - bowl[2]);
    const sp = spoon(bowl, yaw, Math.hypot(rest[0] - bowl[0], rest[2] - bowl[2]), H + 0.6);
    const xs: Array<[number, number]> = [
      [-W / 2 - 6, 0.15], [-W / 2 - 2.2, 0.3], [-W / 2 - 0.9, 1.6], [-W / 2 - 0.55, H * 0.5], [-W / 2 - 0.4, H - 1.2], [-W / 2 + 0.2, H + 0.25], [-W / 2 + 1.4, H + 0.32],
      [W / 2 - 1.4, H + 0.32], [W / 2 - 0.2, H + 0.25], [W / 2 + 0.4, H - 1.2], [W / 2 + 0.55, H * 0.5], [W / 2 + 0.9, 1.6], [W / 2 + 2.2, 0.3], [W / 2 + 6, 0.15],
    ];
    const end = r() < 0.5 ? 1 : -1;
    const tw = towel([Cb[0], 0, Cb[2] + end * (BL / 2 - 1.5)], [0, 0, -end], [end, 0, 0], 11, end > 0 ? xs : xs.map(([a, h]) => [-a, h] as [number, number]).reverse(), n * 7 + Math.round(x));
    return {
      stops: [
        { top: 'spoon', at: [x, RY + 0.6, z], r: 4.6, yaw, shapes: [...sp.shapes, ramekin], land: sp.shapes },
        { top: 'bench', at: [Cb[0], H, Cb[2]], r: 6, box: [W / 2 - 1, BL / 2 - 1.5], yaw: 0, shapes: [top, ...legs, ...tw.shapes], land: [top, ...tw.shapes] },
      ], extra: [], decor: [...sp.verts, ...tw.verts], reach: W / 2 + 4,
    };
  }
  if (kind === 'paddle') {
    // the paddle board, floured, laid across two jars (or on cookbooks), its handle out to the side
    const yw = ramp(r, -0.3, 0.6), PY = Math.round(ramp(r, LOW, LOW + 4));
    const cw = Math.cos(yw), sw = Math.sin(yw);
    const held = r() < 0.65 ? { shapes: [-1, 1].map((sx) => cyl(x + cw * 8 * sx, z - sw * 8 * sx, 4.2, 0, PY - 1.6, MAT.jar)), decor: [] as number[] } : under(['books', 'crate'], PY - 1.6, 9, yw);
    const sup = held.shapes, decor = held.decor;
    const board = box([x, PY - 0.8, z], [12, 0.8, 8.5], yw, MAT.board, 0.85);
    board.dust = DUST.flour;
    const handle = box([x + cw * 17, PY - 0.8, z - sw * 17], [5, 0.8, 2], yw, MAT.board, 0.85);
    return { stops: [{ top: 'paddle', at: [x, PY, z], r: 7, box: [11, 7.5], yaw: yw, shapes: [...sup, board, handle], land: [board] }], extra: [], decor, reach: 22 };
  }
  if (kind === 'tilt') {
    // a plate tipped up on a teacup, the two on a cake tin
    const TY = Math.round(ramp(r, LOW - 1, LOW + 2)), c: V3 = [x, TY + 2.4, z];
    const dir = Math.PI / 2 + ramp(r, -0.4, 0.4);
    const cake = cyl(x, z, 13, 0, TY, MAT.tin);
    const cup = cyl(x + Math.sin(dir) * 8, z + Math.cos(dir) * 8, 3.5, TY, TY + 3.6, MAT.porcelain, 0.6);
    const pl = tiltPlate(c, 11, dir, 0.17);
    return { stops: [{ top: 'tilt', at: c, r: 7, yaw: dir, shapes: [...pl.shapes, cup, cake], land: pl.shapes }], extra: [], decor: pl.verts, reach: 14 };
  }
  if (kind === 'loaf') {
    // a round loaf in a shallow woven bread basket, floured, on two canisters: it gives, and it's crumby; the basket's rim catches a bounce
    const UP = Math.round(ramp(r, LOW - 1, LOW + 2)), y1 = ramp(r, -0.3, 0.3);
    const c1 = Math.cos(y1), s1 = Math.sin(y1);
    const at1 = (lx: number, lz: number, y: number): V3 => [x + c1 * lx + s1 * lz, y, z - s1 * lx + c1 * lz];
    const cans = [-1, 1].map((sx) => cyl(x + c1 * 10 * sx, z - s1 * 10 * sx, 5, 0, UP, MAT.enamel, 0.7));
    const basket = box([x, UP + 0.6, z], [17, 0.6, 12], y1, MAT.weave, 0.85);
    basket.dust = DUST.flour;
    const rim = [box(at1(-17, 0, UP + 2.4), [0.6, 1.8, 12], y1, MAT.weave, 0.85), box(at1(17, 0, UP + 2.4), [0.6, 1.8, 12], y1, MAT.weave, 0.85),
      box(at1(0, -12, UP + 2.4), [17, 1.8, 0.6], y1, MAT.weave, 0.85), box(at1(0, 12, UP + 2.4), [17, 1.8, 0.6], y1, MAT.weave, 0.85)];
    const lx = x - c1 * 4, lz = z + s1 * 4;
    const loaf = jelly(lx, lz, 8.5, UP + 1.2, UP + 10.2, MAT.bread, FEELS.boule, 0.9, 5.5);
    loaf.dust = DUST.crumbs;
    return { stops: [{ top: 'boule', at: [lx, UP + 10.2, lz], r: 5, yaw: 0, shapes: [...cans, basket, ...rim, loaf], land: [loaf] }], extra: [], decor: [], reach: 19 };
  }
  if (kind === 'konjac') {
    // a konjac jelly on its saucer, up on something: it throws you up
    const seat = Math.round(ramp(r, LOW - 6, LOW - 1));
    const hd = holder((['pedestal', 'crate', 'stool', 'tins'] as Holder[])[Math.floor(r() * 4)], x, z, 0, seat, 12, ramp(r, 0, 3), coinAt(x, z));
    const saucer = cyl(x, z, 12, hd.y, hd.y + 0.8, MAT.porcelain, 0.5);
    const kj = jelly(x, z, 9, hd.y + 0.8, hd.y + 8.8, MAT.konjac, FEELS.konjac);
    return { stops: [{ top: 'jelly', at: [x, hd.y + 8.8, z], r: 7, yaw: 0, shapes: [...hd.shapes, saucer, kj], land: [kj] }], extra: [], decor: hd.decor, reach: 13 };
  }
  if (kind === 'stand') {
    // a tall cake stand, its plate sticky with hundreds and thousands
    const Y = Math.round(ramp(r, LOW + 4, LOW + 9));
    const foot = cyl(x, z, 7, 0, 1.2, MAT.porcelain, 0.5), stem = cyl(x, z, 2.6, 0, Y - 1, MAT.porcelain, 0.5), plate = cyl(x, z, 11, Y - 1, Y, MAT.porcelain, 0.6);
    plate.dust = DUST.sprinkles;
    return { stops: [{ top: 'stand', at: [x, Y, z], r: 9, yaw: 0, shapes: [foot, stem, plate], land: [plate] }], extra: [], decor: [], reach: 12 };
  }
  if (kind === 'sponge') {
    // a sponge, up on something: soft, it soaks up a landing
    const hd = under(ROOM.sink, Math.round(ramp(r, LOW - 4, LOW)), 7.5);
    const sp = jelly(x, z, 6.5, hd.y, hd.y + 4.5, MAT.sponge, FEELS.sponge, 0.95);
    return { stops: [{ top: 'sponge', at: [x, hd.y + 4.5, z], r: 4.5, yaw: 0, shapes: [...hd.shapes, sp], land: [sp] }], extra: [], decor: hd.decor, reach: 9 };
  }
  if (kind === 'soap') {
    // a soap dish up on something, heaped with bubbles round its rim: they bounce you, and hold nothing
    const hd = under(ROOM.sink, Math.round(ramp(r, LOW - 1, LOW + 3)), 9.5);
    const Y = hd.y, dish = cyl(x, z, 9, Y, Y + 1.2, MAT.porcelain, 0.5);
    const bubbles: Shape[] = [];
    const nb = 6 + Math.floor(r() * 3);
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + r() * 0.4, d = 6.8 + 1.2 * r(), br = 1.4 + r() * 0.9;
      const c: V3 = [x + Math.cos(a) * d, Y + 1.2 + br * 0.75, z + Math.sin(a) * d];
      const b = cap(c, c, br, MAT.bubble, 0.1);
      b.bounce = 0.85; b.tack = 0;
      bubbles.push(b);
    }
    return { stops: [{ top: 'soap', at: [x, Y + 1.2, z], r: 5.5, yaw: 0, shapes: [...hd.shapes, dish, ...bubbles], land: [dish, ...bubbles] }], extra: [], decor: hd.decor, reach: 12 };
  }
  if (kind === 'drainer') {
    // a two-tier dish rack: its grooved steel drip tray on legs, sloping, wet, so it slips; above its back the
    // wire rack, its rails to land across, plates stood up at its far end
    const UP = Math.round(ramp(r, LOW - 1, LOW + 1)), BZ = Math.max(FRONT + 18, Math.min(BACK - 18, z)), HZ = 16;
    const dx0 = x - 8, dx1 = x + 26;
    const dr = drainer(dx0, dx1, BZ - HZ, BZ + HZ, UP + 2.4, UP + 0.4);
    const dlegs = [[dx0 + 1, BZ - HZ + 1, UP + 2.2], [dx0 + 1, BZ + HZ - 1, UP + 2.2], [dx1 - 1, BZ - HZ + 1, UP + 0.4], [dx1 - 1, BZ + HZ - 1, UP + 0.4]].map(([px, pz, py]) => cap([px, 0, pz], [px, py, pz], 0.45, MAT.steel, 0.6));
    const RX = dx0 + 16, RZ = BZ + 7, RY = UP + Math.round(ramp(r, 7, 9));
    const rails: Shape[] = [];
    for (let i = 0; i < 9; i++) { const rz = RZ - 8 + i * 2; rails.push(cap([RX - 13, RY, rz], [RX + 13, RY, rz], 0.45, MAT.steel, 0.7)); }
    const rlegs = [[-13, -8], [13, -8], [-13, 8], [13, 8]].map(([lx, lz]) => cap([RX + lx, UP + 1.5, RZ + lz], [RX + lx, RY, RZ + lz], 0.35, MAT.steel, 0.6));
    const plates: Shape[] = [], d: number[] = [...dr.verts];
    for (const px of [-13, -12]) { const pr = tiltPlate([RX + px, RY + 8.2, RZ], 8, Math.PI / 2, 1.5); plates.push(...pr.shapes); append(d, pr.verts); }
    return {
      stops: [
        { top: 'drainer', at: [(dx0 + dx1) / 2 - 6, UP + 1.9, BZ - 9], r: 6, box: [9, 5.5], yaw: 0, shapes: [...dr.shapes, ...dlegs], land: dr.shapes },
        { top: 'rack', at: [RX + 5.5, RY + 0.35, RZ], r: 5, box: [6.5, 7.5], yaw: 0, shapes: [...rails, ...rlegs, ...plates], land: rails },
      ], extra: [], decor: d, reach: dx1 - (RX + 5.5) + 4,
    };
  }
  if (kind === 'shelfHome') {
    // the end, by the window: the bread bin out from the wall; above it, out of reach of any flick, the shelf, a
    // towel hung over its front edge to land against and climb; and home on the window sill along from it
    const p = piece('towel', x, z, r, n)!;
    const shelf = p.stops[1], SY = shelf.at[1], SX = shelf.at[0];
    const GX = SX + 60 + ramp(r, 0, 6), sillY = SY + 1;
    const sill = box([GX, sillY - 1.5, BACK - 6], [18, 1.5, 7], 0, MAT.porcelain, 0.7);
    const basket = cyl(GX, BACK - 7, 6.5, sillY, sillY + 7, MAT.gold);
    const nap = serviette(GX, sillY + 7, BACK - 7, 6.5);
    const d = [...p.decor];
    const wy0 = sillY + 3, wy1 = sillY + 58, wx0 = GX - 24, wx1 = GX + 24;
    quad(d, [wx0, wy0, BACK - 0.2], [wx0, wy1, BACK - 0.2], [wx1, wy1, BACK - 0.2], [wx1, wy0, BACK - 0.2], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], 12, [0, 0], [0, 1], [1, 1], [1, 0]);
    for (const [c, h] of [[[GX, wy1 + 1, BACK - 1], [26, 1, 1]], [[wx0 - 1, (wy0 + wy1) / 2, BACK - 1], [1, (wy1 - wy0) / 2 + 2, 1]], [[wx1 + 1, (wy0 + wy1) / 2, BACK - 1], [1, (wy1 - wy0) / 2 + 2, 1]], [[GX, (wy0 + wy1) / 2, BACK - 0.8], [0.5, (wy1 - wy0) / 2, 0.6]]] as Array<[V3, V3]>) drawBox(d, c, h, 0, MAT.porcelain);
    // (a knife block about the counter, below the way along: wood, it holds you a moment)
    const kb = box([SX + 30, 13, BACK - 12], [5, 13, 7], 0, MAT.board, 0.8);
    kb.tack = 1.4; kb.tire = 0.6;
    const knives = [-2.5, 0, 2.5].map((dz, i) => cap([kb.c[0] - 1 + i, 26, kb.c[2] + dz], [kb.c[0] - 3 + i, 33, kb.c[2] + dz * 1.2], 0.9, MAT.chopstick));
    drawShapes([sill, kb, ...knives], d);
    return { stops: [...p.stops, { top: 'goal', at: [GX, sillY + 7, BACK - 7], r: 5.5, yaw: 0, shapes: [basket, nap], land: [basket, nap] }], extra: [sill, kb, ...knives], decor: d, reach: 10, window: GX };
  }
  if (kind === 'sinkHome') {
    // the end, at the sink: across it, at the dishcloth hung over the window sill's edge toward the water; up
    // it onto the sill; home along the sill. The sink a hole in the counter, its water, its tap
    const BX = x + 16, BZ = 30, HX = 22, HZ = 16, BY = -18, SZ = BACK - 6;
    const SY = Math.round(ramp(r, 55, 62)), hangTo = Math.round(ramp(r, 23, 29));
    const steel = (c: V3, h: V3) => { const b = box(c, h, 0, MAT.steel, 0.3); b.tack = 0; return b; };
    const basin = [steel([BX - HX - 0.5, BY / 2, BZ], [0.5, -BY / 2, HZ + 1]), steel([BX + HX + 0.5, BY / 2, BZ], [0.5, -BY / 2, HZ + 1]),
      steel([BX, BY / 2, BZ - HZ - 0.5], [HX + 1, -BY / 2, 0.5]), steel([BX, BY / 2, BZ + HZ + 0.5], [HX + 1, -BY / 2, 0.5]), steel([BX, BY - 0.5, BZ], [HX + 1, 0.5, HZ + 1])];
    const d: number[] = [];
    quad(d, [BX - HX, -10, BZ - HZ], [BX - HX, -10, BZ + HZ], [BX + HX, -10, BZ + HZ], [BX + HX, -10, BZ - HZ], [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0], MAT.water, [0, 0], [0, 1], [1, 1], [1, 0]);
    const sill = box([BX + 6, SY - 1.5, SZ], [32, 1.5, 6], 0, MAT.porcelain, 0.7);
    const cloth = towel([BX - 22, SY, BACK - 12], [1, 0, 0], [0, 0, -1], 20, [[-4.5, 0.15], [-0.6, 0.35], [0.35, -0.5], [0.6, -4], [0.75, hangTo - SY + 6], [0.8, hangTo - SY]], n * 5 + 1);
    append(d, cloth.verts);
    const GX = BX + 26;
    const basket = cyl(GX, BACK - 7, 5.5, SY, SY + 7, MAT.gold), nap = serviette(GX, SY + 7, BACK - 7, 5.5);
    const wy0 = SY + 3, wy1 = SY + 58, wx0 = BX - 26, wx1 = BX + 38;
    quad(d, [wx0, wy0, BACK - 0.2], [wx0, wy1, BACK - 0.2], [wx1, wy1, BACK - 0.2], [wx1, wy0, BACK - 0.2], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], 12, [0, 0], [0, 1], [1, 1], [1, 0]);
    for (const [c, h] of [[[(wx0 + wx1) / 2, wy1 + 1, BACK - 1], [(wx1 - wx0) / 2 + 2, 1, 1]], [[wx0 - 1, (wy0 + wy1) / 2, BACK - 1], [1, (wy1 - wy0) / 2 + 2, 1]], [[wx1 + 1, (wy0 + wy1) / 2, BACK - 1], [1, (wy1 - wy0) / 2 + 2, 1]], [[(wx0 + wx1) / 2, (wy0 + wy1) / 2, BACK - 0.8], [0.5, (wy1 - wy0) / 2, 0.6]]] as Array<[V3, V3]>) drawBox(d, c, h, 0, MAT.porcelain);
    // (the tap, behind the sink's right side: its pillar, its arm out over the water, its handles)
    const TX = BX + 12;
    const tap = [cyl(TX, BACK - 9, 2.6, 0, 4, MAT.steel, 0.3), cap([TX, 4, BACK - 9], [TX, 26, BACK - 9], 1.3, MAT.steel, 0.3), cap([TX, 26, BACK - 9], [TX, 26, BACK - 24], 1.2, MAT.steel, 0.3),
      cap([TX, 26, BACK - 24], [TX, 22.5, BACK - 25], 1.1, MAT.steel, 0.3), cyl(TX - 8, BACK - 9, 2, 0, 6, MAT.steel, 0.3), cyl(TX + 8, BACK - 9, 2, 0, 6, MAT.steel, 0.3)];
    for (const t of tap) t.tack = 0;
    drawShapes([...basin, ...tap], d);
    return {
      stops: [
        { top: 'sill', at: [BX - 10, SY, SZ], r: 4, box: [10, 4.2], yaw: 0, shapes: [sill, ...cloth.shapes], land: [sill, ...cloth.shapes], wall: cloth.shapes, wallAt: [BX - 12, (SY + hangTo) / 2, BACK - 12.8] },
        { top: 'goal', at: [GX, SY + 7, BACK - 7], r: 4.5, yaw: 0, shapes: [basket, nap], land: [basket, nap] },
      ], extra: [...basin, ...tap], decor: d, reach: 10, hole: [BX - HX - 1, BX + HX + 1, BZ - HZ - 1, BZ + HZ + 1], window: BX + 6,
    };
  }
  return null;
}

/** The table under it all, to a margin past everything; its legs down to the floor. */
export function underTable(lv: Level) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of lv.shapes) { x0 = Math.min(x0, s.lo[0]); x1 = Math.max(x1, s.hi[0]); z0 = Math.min(z0, s.lo[2]); z1 = Math.max(z1, s.hi[2]); }
  x0 -= 26; x1 += 26; z0 -= 22; z1 += 26;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  const table = box([cx, -2.5, cz], [hx, 2.5, hz], 0, MAT.counter, 0.8);
  lv.shapes.unshift(table);
  drawShapes([table], lv.decor);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) drawBox(lv.decor, [cx + sx * (hx - 6), (lv.ground - 5) / 2, cz + sz * (hz - 6)], [3, (-5 - lv.ground) / 2, 3], 0, MAT.board);
}

/** A piece, laid by itself (for a bench): a kind of piece at (x, z), from a seed. */
export function pieceAt(kind: Kind, x: number, z: number, seed: number): Piece | null { return piece(kind, x, z, seeded(seed), 1); }
export type { Kind as PieceKind, Piece };

/** Whether a piece stands clear of what's laid already (a hand's width between), and of the flights made sure of. */
function clear(lv: Level, p: Piece, corridors: V3[][]): boolean {
  const mine = [...p.stops.flatMap((t) => t.shapes), ...p.extra];
  for (const s of mine) {
    for (const o of lv.shapes) {
      if (o === lv.shapes[0]) continue;
      if (s.lo[0] - 5 < o.hi[0] && s.hi[0] + 5 > o.lo[0] && s.lo[2] - 5 < o.hi[2] && s.hi[2] + 5 > o.lo[2]) return false;
    }
    const m = RADIUS * 1.3;
    if (corridors.some((c) => c.some((q) => q[0] > s.lo[0] - m && q[0] < s.hi[0] + m && q[1] > s.lo[1] - m && q[1] < s.hi[1] + m && q[2] > s.lo[2] - m && q[2] < s.hi[2] + m))) return false;
  }
  return true;
}

/** Level n, from the stovetop on: a run of pieces along the counter, from a cloth to home. */
export function buildKitchen(n: number): Level {
  const r = seeded(hash(n, 0x6b17c4e));
  const chapter = chapterOf(n), place = PLACE[chapter], i = Math.min(3, within(n));
  const stove = chapter === 'stove';
  const holes: Array<[number, number, number, number]> = [], windows: number[] = [];
  // (the counter, long enough for anything, for the hops to be made sure of against; cut to the course at the end)
  const lv: Level = { n, chapter, towers: [], shapes: [box([1400, -2, (BACK - 18) / 2], [1600, 2, (BACK + 18) / 2], 0, MAT.counter)], sticks: [], movers: [], jellies: [], kill: KILL, ground: -90, decor: [], floorMat: MAT.tiles };
  const add = (p: Piece) => {
    for (const t of p.stops) {
      lv.towers.push(t);
      for (const s of t.shapes) if (!lv.shapes.includes(s)) { lv.shapes.push(s); if (s.lift) lv.movers.push(s); if (s.jel) lv.jellies!.push(s); }
      // (on the stove, a burner under what would sit on one, stood on the hob itself)
      if (stove && onHob.has(t) && ['steamer', 'plate', 'tin', 'butter', 'susan', 'pudding', 'goal'].includes(t.top)) t.burner = (t.top === 'butter' ? 5 : t.shapes[0].r) + 3.5;
    }
    lv.shapes.push(...p.extra);
  };
  const remove = (p: Piece) => {
    lv.towers.length -= p.stops.length;
    const gone = new Set([...p.stops.flatMap((t) => t.shapes), ...p.extra]);
    lv.shapes = lv.shapes.filter((s) => !gone.has(s));
    lv.movers = lv.movers.filter((s) => !gone.has(s));
    lv.jellies = lv.jellies!.filter((s) => !gone.has(s));
  };
  const start = piece('cloth', 0, 22, r, n)!;
  add(start);
  append(lv.decor, start.decor);
  const corridors: V3[][] = [];
  // (a place's levels grow a piece longer each; past them, longer still)
  const count = chapter === 'mixed' ? 7 + Math.min(5, Math.floor((n - CHAPTER_AT.mixed) / 2)) : 5 + i;
  const hard = Math.min(1, (n - 1) / 18);
  let last: Kind | null = 'cloth', reach = 10;
  const used = new Map<Kind, number>();
  // (what the level brings in, as its hint says, comes early, for sure; and how it ends)
  const intro = place.intro(i), finale = place.finale(i, r);
  for (let b = 0; b < count; b++) {
    const goal = b === count - 1;
    let laid = false;
    for (let tries = 0; tries < 40 && !laid; tries++) {
      // (and if nothing will fit, a steamer close by, about as high, on something)
      const easy = tries >= 24;
      const kind: Kind = goal ? (finale && tries < 20 ? finale : 'stack') : easy ? 'stack' : b < intro.length && tries < 16 ? intro[b] : pick(r, n, last, used);
      const prev = lv.towers[lv.towers.length - 1];
      const gap = easy ? ramp(r, 4, 9) : ramp(r, 6, 12 + 14 * hard) * (1 - tries * 0.02);
      const x = prev.at[0] + reach + gap + (kind === 'towel' || kind === 'tray' || kind === 'shelfHome' ? 18 : kind === 'honey' ? 2 : 12);
      // (from a jar's side, forward, away from the jar)
      const z = prev.jar ? Math.max(FRONT + 12, prev.at[2] - ramp(r, 16, 26)) : Math.max(FRONT + 12, Math.min(BACK - 22, prev.at[2] + ramp(r, -22, 22) * (easy ? 0.4 : 1)));
      const y = Math.round(Math.max(LOW + 1, Math.min(30, prev.at[1] > 32 ? ramp(r, 18, 26) : prev.at[1] + ramp(r, -4, 6))));
      // (home, and what's sure to fit when nothing else will: a steamer, on something)
      const sure = (top: Top, at: V3, rad: number): Piece => { const t = standOn(top, at, rad, 0, r, n); if (!t.on) onHob.add(t.stop); return { stops: [t.stop], extra: [], decor: t.decor, reach: rad + 2 }; };
      const p = goal && kind === 'stack' ? sure('goal', [x, Math.round(ramp(r, LOW + 3, LOW + 11)), z], 13) : easy ? sure('steamer', [x, y, z], 11) : piece(kind, x, z, r, n);
      if (!p || !clear(lv, p, corridors)) continue;
      const k0 = lv.towers.length;
      add(p);
      // (each hop into it and through it can be made; and the one before still can, with it stood by it)
      let ok = k0 < 2 || !!hop(lv, k0 - 2, k0 - 1);
      const flights: V3[][] = [];
      for (let k = k0; ok && k < lv.towers.length; k++) { const h = hop(lv, k - 1, k); if (h) flights.push(...h.flights); else ok = false; }
      if (!ok) { remove(p); continue; }
      corridors.push(...flights);
      append(lv.decor, p.decor);
      if (p.hole) holes.push(p.hole);
      if (p.window !== undefined) windows.push(p.window);
      last = kind; reach = p.reach; laid = true;
      used.set(kind, (used.get(kind) ?? 0) + 1);
    }
  }
  room(lv, chapter, holes, windows);
  return lv;
}

/**
 * The room about a run. At the table: the table under it all, to a margin past everything, its legs down
 * to the floor. Elsewhere: the counter (the hob, on the stove) from the wall to its front edge, a hole in it
 * where the sink is, the cupboards under it to the floor, the tiled wall behind with windows in it.
 */
function room(lv: Level, chapter: Chapter, holes: Array<[number, number, number, number]>, windows: number[]) {
  if (chapter === 'table') { lv.shapes.shift(); lv.ground = -76; lv.floorMat = undefined; underTable(lv); return; }
  const stove = chapter === 'stove';
  let x0 = Infinity, x1 = -Infinity;
  for (const s of lv.shapes.slice(1)) { x0 = Math.min(x0, s.lo[0]); x1 = Math.max(x1, s.hi[0]); }
  x0 -= 40; x1 += 40;
  const F = -18, mat = stove ? MAT.hob : MAT.counter;
  const slab = (a: number, b: number, c: number, d: number) => box([(a + b) / 2, -2, (c + d) / 2], [(b - a) / 2, 2, (d - c) / 2], 0, mat, 0.8);
  // (the counter, in pieces round a sink if there is one)
  const h = holes[0];
  const tops = h ? [slab(x0, h[0], F, BACK), slab(h[1], x1, F, BACK), slab(h[0], h[1], F, h[2]), slab(h[0], h[1], h[3], BACK)] : [slab(x0, x1, F, BACK)];
  lv.shapes.splice(0, 1, ...tops);
  drawShapes(tops, lv.decor);
  // (well past the course each way, and high: the camera can't go round its ends or over its top)
  const wall = box([(x0 + x1) / 2, 150, BACK + 1], [(x1 - x0) / 2 + 300, 150, 1], 0, MAT.tiles, 0.4);
  wall.tack = 0;
  lv.shapes.push(wall);
  lv.walls = [wall];
  drawShapes([wall], lv.decor);
  drawBox(lv.decor, [(x0 + x1) / 2, (lv.ground - 4) / 2, (BACK - 14) / 2], [(x1 - x0) / 2 - 1, (-4 - lv.ground) / 2, (BACK + 14) / 2], 0, MAT.enamel);
  // (windows along the wall, high, clear of the shelves)
  for (let wx = x0 + 70; wx < x1 - 70; wx += 190) {
    // (not over a window that's there already, by a sill)
    if (windows.some((w) => Math.abs(w - wx) < 110)) continue;
    const wy0 = 84, wy1 = 140, a = wx - 30, b = wx + 30;
    quad(lv.decor, [a, wy0, BACK - 0.2], [a, wy1, BACK - 0.2], [b, wy1, BACK - 0.2], [b, wy0, BACK - 0.2], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], 12, [0, 0], [0, 1], [1, 1], [1, 0]);
    for (const [c, h] of [[[wx, wy1 + 1, BACK - 1], [32, 1, 1]], [[wx, wy0 - 1.5, BACK - 4], [33, 1.5, 4]], [[a - 1, (wy0 + wy1) / 2, BACK - 1], [1, (wy1 - wy0) / 2 + 2, 1]], [[b + 1, (wy0 + wy1) / 2, BACK - 1], [1, (wy1 - wy0) / 2 + 2, 1]]] as Array<[V3, V3]>) drawBox(lv.decor, c, h, 0, MAT.porcelain);
  }
}
