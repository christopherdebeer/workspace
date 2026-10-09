/**
 * Technic: the pieces and the rules, apart from the drawing (so they can be tested on their own).
 *
 * The build stands on a pegboard: a wall of holes behind it, a floor beneath. Pieces lie in
 * layers in front of the board (layer 0 against it, each layer one module deep); pins and axles
 * go through the holes, across the layers, and into the board. A module is one hole pitch
 * (8 mm). The grid is the holes: integer x along, y up, z the layer; the board is layer -1.
 *
 * Flat pieces (beams, cranks, gears, wheels, motors, the hub) live in one layer. Through
 * pieces (pins, axles) span several. A friction pin fixes what it passes through together; a
 * smooth pin lets them turn on it; an axle turns freely in a round hole and carries whatever
 * has an axle hole (gears, wheels, a crank's first hole, a motor's output). Into the board, a
 * friction pin is an anchor and an axle a fixed pivot.
 *
 * `mechanism()` reads all that as rigid bodies, joints, gear meshes and motors, for the solver.
 */

/** the board: holes across and up; layers in front of it; the floor and the walls beyond it */
export const BW = 32;
export const BH = 20;
export const BOARD = -1;
export const ZMAX = 10;
export const FLOOR = -0.5;
export const XMIN = -6;
export const XMAX = BW + 6;

export type Kind = 'beam' | 'crank' | 'pin' | 'axle' | 'gear' | 'wheel' | 'motor' | 'hub';
export type Hole = 'round' | 'axle' | 'none';

export interface Piece {
  kind: Kind;
  /** beams and cranks: holes along; pins and axles: layers through; gears: teeth; wheels: modules across */
  n: number;
  /** its origin hole (flat pieces), or the hole it goes through (through pieces) */
  at: [number, number];
  /** its layer, or (through pieces) the layer its back end is in */
  z: number;
  /** quarter turns, anticlockwise */
  rot: number;
  colour: number;
  /** pins: a friction pin holds; a smooth one turns */
  friction?: boolean;
}

export type C3 = [number, number, number];

export const COLOURS: Array<{ name: string; rgb: C3 }> = [
  { name: 'light grey', rgb: [0.66, 0.68, 0.7] },
  { name: 'dark grey', rgb: [0.35, 0.37, 0.4] },
  { name: 'black', rgb: [0.11, 0.11, 0.12] },
  { name: 'white', rgb: [0.93, 0.93, 0.9] },
  { name: 'red', rgb: [0.72, 0.09, 0.08] },
  { name: 'yellow', rgb: [0.97, 0.79, 0.06] },
  { name: 'blue', rgb: [0.05, 0.32, 0.68] },
  { name: 'lime', rgb: [0.62, 0.77, 0.1] },
  { name: 'orange', rgb: [0.93, 0.45, 0.1] },
  { name: 'tan', rgb: [0.85, 0.76, 0.55] },
  { name: 'azure', rgb: [0.32, 0.68, 0.87] },
];
/** the colours a beam can be turned through */
export const BEAM_COLOURS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10];

export const PLANAR = new Set<Kind>(['beam', 'crank', 'gear', 'wheel', 'motor', 'hub']);
export const isPlanar = (k: Kind) => PLANAR.has(k);
export const isDisc = (k: Kind) => k === 'gear' || k === 'wheel';

/** The tray: what can be picked up, in the order it's offered. */
export interface Offer {
  label: string;
  spec: Omit<Piece, 'at' | 'z'>;
}
export const TRAY: Offer[] = [
  ...[3, 5, 7, 9, 11, 13, 15].map((n) => ({ label: `beam ${n}`, spec: { kind: 'beam' as Kind, n, rot: 0, colour: 0 } })),
  { label: 'crank', spec: { kind: 'crank', n: 3, rot: 0, colour: 1 } },
  { label: 'pin', spec: { kind: 'pin', n: 2, rot: 0, colour: 9 } },
  { label: 'pin · tight', spec: { kind: 'pin', n: 2, rot: 0, colour: 2, friction: true } },
  { label: 'long pin', spec: { kind: 'pin', n: 3, rot: 0, colour: 6 } },
  ...[3, 5, 7].map((n) => ({ label: `axle ${n}`, spec: { kind: 'axle' as Kind, n, rot: 0, colour: 4 } })),
  ...[8, 16, 24, 40].map((n) => ({ label: `gear ${n}`, spec: { kind: 'gear' as Kind, n, rot: 0, colour: n === 8 ? 9 : 0 } })),
  { label: 'wheel', spec: { kind: 'wheel', n: 5, rot: 0, colour: 2 } },
  { label: 'motor', spec: { kind: 'motor', n: 0, rot: 0, colour: 0 } },
  { label: 'hub', spec: { kind: 'hub', n: 0, rot: 0, colour: 3 } },
];
/** the axle lengths a gear can bring with it */
export const AXLES = [2, 3, 4, 5, 6, 8];

/** A local cell (i along, j up) turned and put at the origin. */
export function rotXY(i: number, j: number, rot: number): [number, number] {
  switch (((rot % 4) + 4) % 4) {
    case 1: return [-j, i];
    case 2: return [-i, -j];
    case 3: return [j, -i];
    default: return [i, j];
  }
}

/** A flat piece's cells, in its own frame (before its turn): which hole each has. */
export function localCells(kind: Kind, n: number): Array<{ i: number; j: number; hole: Hole }> {
  switch (kind) {
    case 'beam': return Array.from({ length: n }, (_, i) => ({ i, j: 0, hole: 'round' as Hole }));
    case 'crank': return Array.from({ length: n }, (_, i) => ({ i, j: 0, hole: (i === 0 ? 'axle' : 'round') as Hole }));
    case 'gear': case 'wheel': return [{ i: 0, j: 0, hole: 'axle' }];
    case 'motor': {
      // three across, two up: pin holes at its back end, the output at its front bottom corner
      const out: Array<{ i: number; j: number; hole: Hole }> = [];
      for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) out.push({ i, j, hole: i === 0 ? 'round' : i === 2 && j === 0 ? 'axle' : 'none' });
      return out;
    }
    case 'hub': {
      const out: Array<{ i: number; j: number; hole: Hole }> = [];
      for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) out.push({ i, j, hole: i === 0 || i === 3 ? 'round' : 'none' });
      return out;
    }
    default: return [];
  }
}
/** A flat piece's cells in the world. */
export function cellsOf(p: Piece): Array<{ x: number; y: number; hole: Hole }> {
  return localCells(p.kind, p.n).map((c) => {
    const [dx, dy] = rotXY(c.i, c.j, p.rot);
    return { x: p.at[0] + dx, y: p.at[1] + dy, hole: c.hole };
  });
}
/** A disc's radius: a gear's pitch radius (teeth over sixteen), a wheel's half its size. */
export function radiusOf(p: { kind: Kind; n: number }): number {
  return p.kind === 'gear' ? p.n / 16 : p.kind === 'wheel' ? p.n / 2 : 0;
}
/** The layers a through piece spans. */
export function spanOf(p: Piece): number[] {
  return Array.from({ length: p.n }, (_, i) => p.z + i);
}
/** A piece's mass (in beams), for the solver. */
export function massOf(p: Piece): number {
  switch (p.kind) {
    case 'beam': case 'crank': return 0.1 * p.n;
    case 'pin': return 0.02;
    case 'axle': return 0.02 * p.n;
    case 'gear': return 0.04 * (p.n / 8);
    case 'wheel': return 0.3;
    case 'motor': return 0.6;
    case 'hub': return 0.9;
  }
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

export class World {
  pieces: Array<Piece | null> = [];
  /** flat pieces' cells by place */
  private flat = new Map<string, { id: number; hole: Hole }>();
  /** through pieces by place */
  private through = new Map<string, number>();

  list(): Piece[] {
    return this.pieces.filter((p): p is Piece => !!p);
  }
  count(): number {
    return this.list().length;
  }
  add(p: Piece): number {
    const id = this.pieces.length;
    this.pieces.push(p);
    this.mark(id, p, true);
    return id;
  }
  remove(id: number): Piece | null {
    const p = this.pieces[id];
    if (!p) return null;
    this.mark(id, p, false);
    this.pieces[id] = null;
    return p;
  }
  restore(id: number, p: Piece) {
    while (this.pieces.length <= id) this.pieces.push(null);
    this.pieces[id] = p;
    this.mark(id, p, true);
  }
  private mark(id: number, p: Piece, on: boolean) {
    if (isPlanar(p.kind)) {
      for (const c of cellsOf(p)) {
        const k = key(c.x, c.y, p.z);
        if (on) this.flat.set(k, { id, hole: c.hole });
        else this.flat.delete(k);
      }
    } else {
      for (const z of spanOf(p)) {
        const k = key(p.at[0], p.at[1], z);
        if (on) this.through.set(k, id);
        else this.through.delete(k);
      }
    }
  }
  /** The flat piece whose cell is here, and which hole it has there. */
  flatAt(x: number, y: number, z: number): { id: number; hole: Hole } | null {
    return this.flat.get(key(x, y, z)) ?? null;
  }
  /** The pin or axle through here. */
  throughAt(x: number, y: number, z: number): number {
    return this.through.get(key(x, y, z)) ?? -1;
  }
  /** What hole is here: a flat piece's, the board's (round, at layer -1), or none (null: solid). */
  holeAt(x: number, y: number, z: number): Hole | null {
    if (z === BOARD) return x >= 0 && x < BW && y >= 0 && y < BH ? 'round' : null;
    const f = this.flatAt(x, y, z);
    if (!f) return 'none';
    return f.hole === 'none' ? null : f.hole;
  }
  /** The layers with a flat piece's hole at this place (front of the board), in order. */
  column(x: number, y: number): number[] {
    const out: number[] = [];
    for (let z = 0; z < ZMAX; z++) {
      const f = this.flatAt(x, y, z);
      if (f && f.hole !== 'none') out.push(z);
    }
    return out;
  }
  /** The axle through this place, if there is one (any layer). */
  axleAt(x: number, y: number): number {
    for (let z = BOARD; z < ZMAX; z++) {
      const id = this.throughAt(x, y, z);
      if (id >= 0 && this.pieces[id]?.kind === 'axle') return id;
    }
    return -1;
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < BW && y >= 0 && y < BH;
  }
  /** The discs (gears, wheels) in a layer, other than `ignore`. */
  private discs(z: number, ignore: number): Array<{ id: number; x: number; y: number; r: number }> {
    const out: Array<{ id: number; x: number; y: number; r: number }> = [];
    this.pieces.forEach((q, id) => {
      if (q && id !== ignore && isDisc(q.kind) && q.z === z) out.push({ id, x: q.at[0], y: q.at[1], r: radiusOf(q) });
    });
    return out;
  }
  /**
   * Whether a piece fits where it is: on the board, in no other flat piece's cell in its layer,
   * discs clear of each other and of what's solid around them, and through pieces only through
   * holes that take them (a pin a round hole, an axle any hole) or empty air.
   */
  fits(p: Piece, ignore = -1): boolean {
    if (isPlanar(p.kind)) {
      if (p.z < 0 || p.z >= ZMAX) return false;
      const cells = cellsOf(p);
      for (const c of cells) {
        if (!this.inBounds(c.x, c.y)) return false;
        const f = this.flatAt(c.x, c.y, p.z);
        if (f && f.id !== ignore) return false;
        // (a pin or axle already through this place: the cell must be a hole that takes it)
        const t = this.throughAt(c.x, c.y, p.z);
        if (t >= 0 && t !== ignore) {
          const q = this.pieces[t]!;
          if (c.hole === 'none' || (q.kind === 'pin' && c.hole !== 'round')) return false;
        }
      }
      if (isDisc(p.kind)) {
        const r = radiusOf(p);
        for (const d of this.discs(p.z, ignore)) {
          if (Math.hypot(d.x - p.at[0], d.y - p.at[1]) < d.r + r - 0.02) return false;
        }
        // clear of the solid pieces in its layer (their cells, as circles half a module across)
        for (const [k, f] of this.flat) {
          if (f.id === ignore) continue;
          const [x, y, z] = k.split(',').map(Number);
          if (z !== p.z) continue;
          const q = this.pieces[f.id]!;
          if (isDisc(q.kind)) continue;
          if (Math.hypot(x - p.at[0], y - p.at[1]) < r + 0.5 - 0.02) return false;
        }
      } else {
        for (const d of this.discs(p.z, ignore)) {
          for (const c of cells) if (Math.hypot(d.x - c.x, d.y - c.y) < d.r + 0.5 - 0.02) return false;
        }
      }
      return true;
    }
    // a through piece
    if (!this.inBounds(p.at[0], p.at[1])) return false;
    for (const z of spanOf(p)) {
      if (z < BOARD || z >= ZMAX) return false;
      const t = this.throughAt(p.at[0], p.at[1], z);
      if (t >= 0 && t !== ignore) return false;
      const h = this.holeAt(p.at[0], p.at[1], z);
      if (h === null) return false;
      if (p.kind === 'pin' && h === 'axle') return false;
    }
    return true;
  }
  /** Whether a through piece passes through anything at all (else it would just lie there). */
  holds(p: Piece): boolean {
    return spanOf(p).some((z) => this.holeAt(p.at[0], p.at[1], z) === 'round' || this.holeAt(p.at[0], p.at[1], z) === 'axle');
  }

  /**
   * Where a piece goes for the hole under the finger.
   *
   * A flat piece: its `anchor` hole lands in that cell, in the layer asked for or the first in
   * front of it where it fits. A gear or wheel: onto the axle there, in the first free layer along
   * it; with no axle but a hole to go through, it brings an axle (`extra`), through the board if
   * the hole is against it. A pin: into the front piece there and the one behind it (the board,
   * if that's what's behind). An axle: from the back of what's there (into the board, if the
   * back is against it) out toward the front.
   */
  place(spec: Omit<Piece, 'at' | 'z'>, cx: number, cy: number, anchor: [number, number] = [0, 0], zHint = 0): { piece: Piece; extra?: Piece } | null {
    if (isPlanar(spec.kind) && !isDisc(spec.kind)) {
      const [ax, ay] = rotXY(anchor[0], anchor[1], spec.rot);
      const at: [number, number] = [cx - ax, cy - ay];
      for (let z = Math.max(0, zHint); z < ZMAX; z++) {
        const piece: Piece = { ...spec, at, z };
        if (this.fits(piece)) return { piece };
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const piece: Piece = { ...spec, at: [at[0] + dx, at[1] + dy], z: Math.max(0, zHint) };
        if (this.fits(piece)) return { piece };
      }
      return null;
    }
    if (isDisc(spec.kind)) {
      const axle = this.axleAt(cx, cy);
      if (axle >= 0) {
        // (from the back of the axle forward, the first layer with room)
        for (const z of spanOf(this.pieces[axle]!)) {
          if (z < 0) continue;
          const piece: Piece = { ...spec, at: [cx, cy], z };
          if (this.fits(piece)) return { piece };
        }
        return null;
      }
      const col = this.column(cx, cy);
      if (col.length) {
        const back = col[0] === 0 ? BOARD : col[0];
        const z = col[col.length - 1] + 1;
        const need = z - back + 1;
        const n = AXLES.find((a) => a >= need);
        if (!n) return null;
        const extra: Piece = { kind: 'axle', n, at: [cx, cy], z: back, rot: 0, colour: n % 2 ? 0 : 2 };
        const piece: Piece = { ...spec, at: [cx, cy], z };
        if (!this.fits(extra) || !this.fits(piece)) return null;
        return { piece, extra };
      }
      for (let z = Math.max(0, zHint); z < ZMAX; z++) {
        const piece: Piece = { ...spec, at: [cx, cy], z };
        if (this.fits(piece)) return { piece };
      }
      return null;
    }
    // a pin or an axle
    if (!this.inBounds(cx, cy)) return null;
    const col = this.column(cx, cy);
    let z0: number;
    if (spec.kind === 'pin') z0 = col.length ? col[col.length - 1] - spec.n + 1 : BOARD;
    else z0 = col.length ? (col[0] === 0 ? BOARD : col[0]) : BOARD;
    for (let z = z0; z < z0 + spec.n; z++) {
      const piece: Piece = { ...spec, at: [cx, cy], z };
      if (this.fits(piece)) return { piece };
    }
    return null;
  }

  /** The piece a layer nearer (+1) or farther (-1), if it fits there. */
  nudged(id: number, dz: number): Piece | null {
    const p = this.pieces[id];
    if (!p) return null;
    const q = { ...p, z: p.z + dz };
    if (isPlanar(q.kind) && q.z < 0) return null;
    return this.fits(q, id) ? q : null;
  }
  /** The piece turned a quarter, about its origin, if it fits so. */
  turned(id: number): Piece | null {
    const p = this.pieces[id];
    if (!p) return null;
    const q = { ...p, rot: (p.rot + 1) % 4 };
    return this.fits(q, id) ? q : null;
  }
  height(): number {
    let h = 0;
    for (const p of this.list()) for (const c of isPlanar(p.kind) ? cellsOf(p) : [{ x: p.at[0], y: p.at[1] }]) h = Math.max(h, c.y + 1);
    return h;
  }

  // ─── the mechanism: what moves with what ──────────────────────────────────────────────────────
  mechanism(): Mech {
    const pieces = this.pieces;
    const BOARD_NODE = pieces.length;
    const parent = Array.from({ length: pieces.length + 1 }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a: number, b: number) => { parent[find(a)] = find(b); };
    const pairs: Array<{ a: number; b: number; x: number; y: number }> = [];
    const motors: Array<{ stator: number; rotor: number; piece: number; x: number; y: number }> = [];
    // what's in each layer at a through piece's place: a flat piece, or the board
    const nodeAt = (x: number, y: number, z: number): { node: number; hole: Hole } | null => {
      if (z === BOARD) return this.inBounds(x, y) ? { node: BOARD_NODE, hole: 'round' } : null;
      const f = this.flatAt(x, y, z);
      return f && f.hole !== 'none' ? { node: f.id, hole: f.hole } : null;
    };
    pieces.forEach((p, id) => {
      if (!p || isPlanar(p.kind)) return;
      const [x, y] = p.at;
      if (p.kind === 'pin') {
        // a pin: the pieces it passes through, held together (tight) or turning on it (smooth)
        let prev = -1;
        for (const z of spanOf(p)) {
          const n = nodeAt(x, y, z);
          if (!n) continue;
          if (prev >= 0) {
            if (p.friction) union(prev, n.node);
            else pairs.push({ a: prev, b: n.node, x, y });
          }
          prev = n.node;
        }
        // (the pin itself rides with the first thing it's in; else it's its own)
        union(id, prev >= 0 ? prev : id);
      } else {
        // an axle: turns in round holes, fixed in axle holes; a motor's output drives it
        for (const z of spanOf(p)) {
          const n = nodeAt(x, y, z);
          if (!n) continue;
          const q = n.node === BOARD_NODE ? null : pieces[n.node]!;
          if (q && q.kind === 'motor' && n.hole === 'axle') {
            pairs.push({ a: id, b: n.node, x, y });
            motors.push({ stator: n.node, rotor: id, piece: n.node, x, y });
          } else if (n.hole === 'axle') union(id, n.node);
          else pairs.push({ a: id, b: n.node, x, y });
        }
      }
    });
    // gears meshing: two in one layer, their pitch circles touching
    const meshes: Array<{ a: number; b: number; ra: number; rb: number }> = [];
    const gears = pieces.map((p, id) => ({ p, id })).filter((g): g is { p: Piece; id: number } => !!g.p && g.p.kind === 'gear');
    for (let i = 0; i < gears.length; i++) for (let j = i + 1; j < gears.length; j++) {
      const a = gears[i].p;
      const b = gears[j].p;
      if (a.z !== b.z) continue;
      const ra = radiusOf(a);
      const rb = radiusOf(b);
      if (Math.abs(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) - (ra + rb)) < 0.05) meshes.push({ a: gears[i].id, b: gears[j].id, ra, rb });
    }
    // bodies: one per group; the board's is the static one, first
    const bodies: Body[] = [{ pieces: [], m: 0, I: 0, cx: 0, cy: 0, fixed: true }];
    const bodyOfRoot = new Map<number, number>();
    bodyOfRoot.set(find(BOARD_NODE), 0);
    const bodyOf = new Int32Array(pieces.length).fill(-1);
    pieces.forEach((p, id) => {
      if (!p) return;
      const r = find(id);
      let b = bodyOfRoot.get(r);
      if (b === undefined) {
        b = bodies.length;
        bodies.push({ pieces: [], m: 0, I: 0, cx: 0, cy: 0, fixed: false });
        bodyOfRoot.set(r, b);
      }
      bodies[b].pieces.push(id);
      bodyOf[id] = b;
    });
    // mass: a flat piece's cells (or disc), a through piece's place
    for (const b of bodies) {
      if (b.fixed) continue;
      let m = 0, mx = 0, my = 0;
      const pts: Array<[number, number, number]> = [];
      for (const id of b.pieces) {
        const p = pieces[id]!;
        const pm = massOf(p);
        if (isPlanar(p.kind) && !isDisc(p.kind)) {
          const cs = cellsOf(p);
          for (const c of cs) pts.push([c.x, c.y, pm / cs.length]);
        } else pts.push([p.at[0], p.at[1], pm]);
      }
      for (const [x, y, w] of pts) { m += w; mx += x * w; my += y * w; }
      b.m = m;
      b.cx = mx / m;
      b.cy = my / m;
      let I = 0;
      for (const [x, y, w] of pts) I += w * ((x - b.cx) ** 2 + (y - b.cy) ** 2 + 1 / 12);
      for (const id of b.pieces) {
        const p = pieces[id]!;
        if (isDisc(p.kind)) I += 0.5 * massOf(p) * radiusOf(p) ** 2;
      }
      b.I = I;
    }
    const bodyOfNode = (n: number) => (n === BOARD_NODE ? 0 : bodyOf[n]);
    const joints: Joint[] = [];
    for (const j of pairs) {
      const a = bodyOfNode(j.a);
      const b = bodyOfNode(j.b);
      if (a === b) continue;
      joints.push({ a, b, x: j.x, y: j.y });
    }
    const gearJoints: GearJoint[] = [];
    for (const g of meshes) {
      const a = bodyOf[g.a];
      const b = bodyOf[g.b];
      if (a === b) continue;
      const pa = pieces[g.a]!;
      const pb = pieces[g.b]!;
      gearJoints.push({ a, b, ra: g.ra, rb: g.rb, ax: pa.at[0], ay: pa.at[1], bx: pb.at[0], by: pb.at[1] });
    }
    const motorJoints: Motor[] = motors.map((m) => ({ stator: bodyOf[m.stator], rotor: bodyOf[m.rotor], piece: m.piece })).filter((m) => m.stator !== m.rotor);
    const hubs: number[] = [];
    pieces.forEach((p, id) => { if (p?.kind === 'hub') hubs.push(id); });
    // what touches the floor: a flat piece's cells as circles, a disc as its circle
    const contacts: Contact[] = [];
    pieces.forEach((p, id) => {
      if (!p || !isPlanar(p.kind)) return;
      const b = bodyOf[id];
      if (bodies[b].fixed) return;
      if (isDisc(p.kind)) contacts.push({ body: b, x: p.at[0], y: p.at[1], r: radiusOf(p) + (p.kind === 'gear' ? 0.12 : 0), grip: p.kind === 'wheel' ? 1.2 : 0.4 });
      else for (const c of cellsOf(p)) contacts.push({ body: b, x: c.x, y: c.y, r: 0.5, grip: 0.6 });
    });
    return { bodies, bodyOf, joints, gears: gearJoints, motors: motorJoints, hubs, contacts };
  }
}

export interface Body {
  pieces: number[];
  m: number;
  I: number;
  /** its centre of mass, at rest */
  cx: number;
  cy: number;
  fixed: boolean;
}
/** Two bodies turning about one point (at rest, in the world). */
export interface Joint { a: number; b: number; x: number; y: number }
/** Two gears meshing: their teeth keep their rims moving together. */
export interface GearJoint { a: number; b: number; ra: number; rb: number; ax: number; ay: number; bx: number; by: number }
/** A motor turning its rotor against its body. */
export interface Motor { stator: number; rotor: number; piece: number }
export interface Contact { body: number; x: number; y: number; r: number; grip: number }
export interface Mech {
  bodies: Body[];
  bodyOf: Int32Array;
  joints: Joint[];
  gears: GearJoint[];
  motors: Motor[];
  hubs: number[];
  contacts: Contact[];
}

// ─── the hub's program ────────────────────────────────────────────────────────────────────────
export type Rule = 'run' | 'fro' | 'walls' | 'tilt';
export interface Port { speed: number; rule: Rule; period: number }
export const RULES: Array<{ rule: Rule; label: string }> = [
  { rule: 'run', label: 'run' },
  { rule: 'fro', label: 'to and fro' },
  { rule: 'walls', label: 'turn at the walls' },
  { rule: 'tilt', label: 'turn when tipped' },
];
export const defaultPort = (): Port => ({ speed: 60, rule: 'run', period: 2 });

// ─── the demonstrations ───────────────────────────────────────────────────────────────────────
/** A few machines, built for you: for the index, and to take apart. */
export const DEMOS = ['gears', 'crank', 'car', 'swing'] as const;
export type Demo = (typeof DEMOS)[number];
export function demo(name: string): { pieces: Piece[]; ports: Port[] } {
  const P = (kind: Kind, n: number, x: number, y: number, z: number, rot = 0, colour = 0, friction?: boolean): Piece => ({ kind, n, at: [x, y], z, rot, colour, ...(friction ? { friction } : {}) });
  const pin = (x: number, y: number, z: number, tight = true, n = 2) => P('pin', n, x, y, z, 0, tight ? 2 : 9, tight);
  const axle = (n: number, x: number, y: number, z: number) => P('axle', n, x, y, z, 0, n % 2 ? 0 : 2);
  const pieces: Piece[] = [];
  const ports: Port[] = [];
  // a motor on the board, with the hub beside it
  const motorAndHub = () => {
    pieces.push(P('motor', 0, 10, 8, 0, 0, 0), pin(10, 8, -1), pin(10, 9, -1));
    pieces.push(P('hub', 0, 3, 2, 0, 0, 3), pin(3, 2, -1), pin(6, 3, -1));
  };
  // its train: 8 on the motor, 24 and 40 on pivots in the board
  const train = () => {
    pieces.push(axle(3, 12, 8, -1), P('gear', 8, 12, 8, 1, 0, 9));
    pieces.push(axle(3, 14, 8, -1), P('gear', 24, 14, 8, 1, 0, 0));
    pieces.push(axle(4, 18, 8, -1), P('gear', 40, 18, 8, 1, 0, 0));
  };
  switch (name) {
    case 'crank': {
      // a crank on the slow gear, a rod across to a rocker pivoted low on the board
      motorAndHub();
      train();
      pieces.push(P('crank', 3, 18, 8, 2, 0, 1));
      pieces.push(P('beam', 9, 20, 8, 3, 0, 5), pin(20, 8, 2, false));
      pieces.push(P('beam', 9, 28, 2, 4, 1, 4), pin(28, 8, 3, false), axle(6, 28, 2, -1));
      ports.push({ speed: 70, rule: 'run', period: 2 });
      break;
    }
    case 'car': {
      // a chassis off the board, wheels behind it, the motor on it driving the back axle
      pieces.push(P('beam', 9, 8, 3, 2, 0, 5));
      pieces.push(axle(2, 9, 3, 1), P('wheel', 5, 9, 3, 1, 0, 2));
      pieces.push(axle(4, 14, 3, 1), P('wheel', 5, 14, 3, 1, 0, 2), P('gear', 24, 14, 3, 4, 0, 0));
      pieces.push(P('motor', 0, 10, 3, 3, 0, 0), pin(10, 3, 2), axle(3, 12, 3, 2), P('gear', 8, 12, 3, 4, 0, 9));
      pieces.push(P('beam', 3, 8, 3, 3, 1, 0), pin(8, 3, 2));
      pieces.push(P('hub', 0, 8, 4, 2, 0, 3), pin(8, 4, 2));
      ports.push({ speed: 80, rule: 'walls', period: 2 });
      break;
    }
    case 'swing': {
      // beams hung from pivots, one from another
      pieces.push(axle(2, 6, 16, -1), P('beam', 13, 6, 16, 0, 3, 4));
      pieces.push(axle(2, 14, 16, -1), P('beam', 9, 14, 16, 0, 3, 5), P('beam', 7, 14, 8, 1, 3, 6), pin(14, 8, 0, false));
      pieces.push(axle(2, 24, 17, -1), P('beam', 7, 24, 17, 0, 3, 0), P('beam', 5, 24, 11, 1, 3, 7), pin(24, 11, 0, false), P('beam', 3, 24, 7, 2, 3, 10), pin(24, 7, 1, false));
      break;
    }
    default: {
      motorAndHub();
      train();
      ports.push({ speed: 70, rule: 'run', period: 2 });
    }
  }
  return { pieces, ports };
}
