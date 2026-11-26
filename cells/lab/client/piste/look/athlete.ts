/**
 * The athlete: one figure, modelled procedurally from anatomy and the reference studies (no scans), built ONCE in a
 * bind pose as an indexed mesh that stays on the GPU, and skinned in the vertex shader each frame from fifteen joint
 * matrices taken from the pose fencer.ts computes. Every fencer shares the same mesh; only their joints differ.
 *
 *   bones     pelvis, chest, head; weapon upper arm, forearm, hand (the hand framed by the weapon: its roll is the
 *             thumb's); rear upper arm, forearm, hand; each thigh, shin, foot (the foot as it lies: heel to toe)
 *   weights   by where a vertex is along its part, blended across each joint; the jacket near each shoulder takes a
 *             share of that arm (so the weapon shoulder draws the jacket across the chest as the arm reaches)
 *   corrective  the inside of each elbow gathers as it bends (a per-vertex weight, the bend a uniform); the hem and the
 *             sleeves lag and swing as springs on the body's motion (secondary motion: two offsets a fencer a frame)
 *
 * The figure: a jacket cut close at chest and waist with a sloping shoulder running into the sleeve cap, full sleeves,
 * breeches to below the knee, the knee and calf under a long sock, shoes with a shaped sole pitched along the foot; the
 * mask shaped in profile (face, crown, jaw) with its rim, the bib wrapped round the neck and lying on the chest; the
 * weapon hand a gloved hand on the grip (fingers round it, the thumb along it, the knuckle ridge, the cuff over the
 * sleeve); the rear hand bare and relaxed.
 */
import { Fencer } from '../fencer';
import { EPEE } from '../weapons';
import { type V, add, cross, dot, len, lerp, madd, norm, scale, sub } from '../v3';
import { MAT, type C } from './mesh';

/** floats a vertex: place, normal, colour + material, fabric uv, four joints, four weights, (hem, sleeve, gather, part), atlas uv, fold position delta + driver, fold normal delta */
export const SKIN_STRIDE = 33;
export const BONES = 15;
export const B = { pelvis: 0, chest: 1, head: 2, upperW: 3, foreW: 4, handW: 5, upperR: 6, foreR: 7, handR: 8, thighF: 9, shinF: 10, footF: 11, thighB: 12, shinB: 13, footB: 14 } as const;
/** parts, for what the eye inside the mask doesn't see of its own body (a bit each in the `hide` mask) */
export const PART = { always: 0, head: 1, torso: 2, rearArm: 3, upperSleeve: 4 } as const;

export const TONE = { jacket: 0, breeches: 1, glove: 2, sock: 3 } as const;
const COL = { skin: [0.55, 0.36, 0.27] as C, mesh: [0.11, 0.11, 0.115] as C, trim: [0.035, 0.035, 0.04] as C, padding: [0.09, 0.09, 0.1] as C,
  shoe: [0.74, 0.74, 0.72] as C, sole: [0.04, 0.04, 0.045] as C, band: [0.06, 0.07, 0.1] as C };

interface Frame { o: V; x: V; y: V; z: V }
/** a bone's frame: origin, its axis, and a second axis from a reference direction */
function frame(o: V, along: V, ref: V): Frame {
  const x = norm(along);
  let y = sub(ref, scale(x, dot(ref, x)));
  if (len(y) < 1e-5) y = sub([0, 0, 1], scale(x, x[2]));
  y = norm(y);
  return { o, x, y, z: cross(x, y) };
}
const perp = (v: V, ax: V): V => norm(sub(v, scale(ax, dot(v, ax))));

/** every bone's frame, from the pose */
export function boneFrames(f: Fencer): Frame[] {
  const c = f.capsules, F = f.frame, b = f.blade, up: V = [0, 1, 0];
  const ax = b.handAxis, thumb = perp(b.thumb, ax), grip = madd(b.guard, ax, -0.055);
  const kneePoleF = add(F.f, [0, 0.2, 0]), kneePoleB = add(add(scale(F.f, -0.3), scale(F.r, -0.8)), [0, 0.2, 0]);
  const rearHandDir = norm(sub(c[8].b, c[8].a));
  return [
    frame(c[0].a, sub(c[0].b, c[0].a), F.f),
    frame(c[0].b, sub(c[1].b, c[0].b), F.f),
    frame(c[1].b, sub(lerp(c[2].a, c[2].b, 0.5), c[1].b), F.f),
    frame(f.shoulder, sub(f.elbow, f.shoulder), F.u),
    frame(f.elbow, sub(f.hand, f.elbow), F.u),
    frame(grip, ax, thumb),
    frame(c[7].a, sub(c[7].b, c[7].a), F.u),
    frame(c[8].a, sub(c[8].b, c[8].a), F.u),
    // (the rear hand hangs palm in, toward the thigh, the thumb forward)
    frame(c[8].b, rearHandDir, scale(F.r, -1)),
    frame(c[9].a, sub(c[9].b, c[9].a), kneePoleF),
    frame(c[10].a, sub(c[10].b, c[10].a), kneePoleF),
    frame(c[13].a, sub(c[13].b, c[13].a), up),
    frame(c[11].a, sub(c[11].b, c[11].a), kneePoleB),
    frame(c[12].a, sub(c[12].b, c[12].a), kneePoleB),
    frame(c[14].a, sub(c[14].b, c[14].a), up),
  ];
}

/** the skinning matrices (column-major, 16 floats each): each bone's frame now times its bind frame's inverse */
export function skinMatrices(now: Frame[], bind: Frame[], out: Float32Array) {
  for (let i = 0; i < BONES; i++) {
    const n = now[i], b = bind[i];
    // R = Rn · Rbᵀ ; t = on − R·ob
    const Rn = [n.x, n.y, n.z], Rb = [b.x, b.y, b.z];
    const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) { let s = 0; for (let k = 0; k < 3; k++) s += Rn[k][r] * Rb[k][cc]; R[r][cc] = s; }
    const t = [0, 1, 2].map((r) => n.o[r] - (R[r][0] * b.o[0] + R[r][1] * b.o[1] + R[r][2] * b.o[2]));
    const o = i * 16;
    for (let cc = 0; cc < 3; cc++) { for (let r = 0; r < 3; r++) out[o + cc * 4 + r] = R[r][cc]; out[o + cc * 4 + 3] = 0; }
    out[o + 12] = t[0]; out[o + 13] = t[1]; out[o + 14] = t[2]; out[o + 15] = 1;
  }
}

// ─── the mesh, built once ───────────────────────────────────────────────────────────────────────────────────────────
type W = [number, number][];
class SkinMesh {
  v: number[] = []; i: number[] = []; pieces: ClothPiece[] = [];
  get n() { return this.v.length / SKIN_STRIDE; }
  vert(p: V, nr: V, col: C, mat: number, uv: [number, number], w: W, extra: [number, number, number, number], atlas: [number, number] = [-1,-1], fold: V = [0,0,0], normalChange: V = [0,0,0], driver = 0): number {
    const ws = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4), tot = ws.reduce((s, x) => s + x[1], 0) || 1;
    while (ws.length < 4) ws.push([0, 0]);
    this.v.push(...p, ...nr, ...col, mat, ...uv, ...ws.map((x) => x[0]), ...ws.map((x) => x[1] / tot), ...extra, ...atlas, ...fold, driver, ...normalChange);
    return this.n - 1;
  }
  tri(a: number, b: number, c: number) { this.i.push(a, b, c); }
}

interface Ring { c: V; u: V; w: V; r: (a: number) => [number, number]; lift?: (a: number) => number }
interface LoftOpt {
  seg: number; col: (i: number, j: number) => C; mat: (i: number, j: number) => number;
  weights: (i: number, j: number, p: V) => W; extra?: (i: number, j: number, p: V) => [number, number, number, number];
  /** fabric: (circumference uv, along uv, distance to a seam) are worked out from the shape */
  fit?: (p: V) => V;
  /** a garment piece the cloth simulation may take over */
  cloth?: { kind: ClothPiece['kind']; joint?: number; pins?: number[] };
  /** cells left open (an armhole): the quad between rings i, i+1 and columns j, j+1 */
  hole?: (i: number, j: number) => boolean;
  /** sewn: another piece's edge (its vertices and places, any number of them) joined to this one's first ring by a
   * band of triangles, the two edges paired by their angle round this one's first ring: they share the band's points,
   * so they can't come apart */
  stitch?: { v: number[]; p: V[] };
  /** each point's place after it's lofted (and fitted): for a piece shaped onto another's edge */
  place?: (i: number, j: number, p: V) => V;
  fold?: { driver: number; relief: (row: number, angle: number, radial: V) => number };
  panel?: number;
  panelUV?: (i: number, j: number, p: V) => [number, number];
  seams?: number[]; tone?: number; capA?: boolean; capB?: boolean;
  /** an open strip from one angle to another (radians round the ring), instead of all the way round */
  arc?: [number, number];
}
/** a lofted surface through rings (each ring's radius may vary round it: a shaped section), smooth normals, indexed */
/** a loft's points, ring by ring, column by column (the last column of a closed one repeating the first) */
function loftPoints(rings: Ring[], o: LoftOpt): V[][] {
  const S = o.seg, open = !!o.arc, J = S + 1;
  const ang = (j: number) => open ? o.arc![0] + (j / S) * (o.arc![1] - o.arc![0]) : (j / S) * Math.PI * 2;
  return rings.map((r, i) => Array.from({ length: J }, (_, j) => {
    const a = ang(j), [ru, rw] = r.r(a);
    const p = add(r.c, add(scale(r.u, Math.cos(a) * ru), scale(r.w, Math.sin(a) * rw)));
    p[1] += r.lift?.(a) ?? 0;
    const q = o.fit ? o.fit(p) : p;
    return o.place ? o.place(i, j, q) : q;
  }));
}

function loft(m: SkinMesh, rings: Ring[], o: LoftOpt): { base: number; R: number; J: number; P: V[][] } {
  // (closed round, or an open strip over an arc of angles: its own vertices, so its edges are clean)
  const S = o.seg, open = !!o.arc, J = S + 1;
  const ang = (j: number) => open ? o.arc![0] + (j / S) * (o.arc![1] - o.arc![0]) : (j / S) * Math.PI * 2;
  const P: V[][] = loftPoints(rings, o);
  const R = rings.length;
  const nb = (j: number) => open ? [Math.max(0, j - 1), Math.min(J - 1, j + 1)] : [(j + S - 1) % S, (j + 1) % S];
  // A second cut of the same panel supplies displacement AND the changing normal.
  // The UVs and stitching remain attached to the material throughout the bend.
  const folded = o.fold && P.map((ring,i) => ring.map((p,j) => {
    const radial = norm(sub(p,rings[i].c));
    return madd(p,radial,o.fold!.relief(i/(R-1),ang(j),radial));
  }));
  let along = 0;
  const base = m.n;
  for (let i = 0; i < R; i++) {
    if (i > 0) along += len(sub(rings[i].c, rings[i - 1].c));
    let circ = 0;
    for (let j = 0; j < S; j++) circ += len(sub(P[i][(j + 1) % J], P[i][j]));
    for (let j = 0; j < J; j++) {
      const p = P[i][j], [j0, j1] = nb(j);
      const tA = sub(P[i][j1], P[i][j0]), tB = sub(P[Math.min(R - 1, i + 1)][j], P[Math.max(0, i - 1)][j]);
      let nr = norm(cross(tB, tA));
      if (dot(nr, sub(p, rings[i].c)) < 0) nr = scale(nr, -1);
      const fr = j / S;
      let seam = 1;
      for (const sm of o.seams ?? []) { const d = Math.abs(fr - sm); seam = Math.min(seam, d, 1 - d); }
      const mat = o.mat(i, j), fab = mat === MAT.fabric;
      // Concave folds receive less sky. Bake a broad cavity term into the cloth at construction.
      const rim = sub(lerp(P[i][j0], P[i][j1], 0.5), p);
      const crossRow = sub(lerp(P[Math.max(0, i-1)][j], P[Math.min(R-1,i+1)][j], 0.5), p);
      const cavity = Math.max(0, dot(nr, rim)) + Math.max(0, dot(nr, crossRow));
      const col: C = fab ? [Math.max(0.72, 1 - 25 * cavity), seam * circ, o.tone ?? 0] : o.col(i, j);
      const uv: [number, number] = mat === MAT.mesh ? [p[2] + 0.55*p[0], p[1] + 0.12*p[0]] : [fr * circ, along];
      // Insets keep filtered texels clear of the neighboring panel.
      const panel = o.panel;
      const row = i / (R - 1);
      const coord = o.panelUV?.(i,j,p) ?? [fr, panel === 0 ? 1-row : row];
      const atlas: [number, number] = panel === undefined ? [-1,-1] : [
        ((panel%2) + 0.02 + coord[0]*0.96)*0.25 + (panel>=4 ? 0.5 : 0),
        (Math.floor(panel%4/2) + 0.02 + coord[1]*0.96)*0.25,
      ];
      let displacement: V = [0,0,0], normalChange: V = [0,0,0];
      if (folded) {
        const q = folded[i][j];
        const across = sub(folded[i][j1], folded[i][j0]);
        const lengthwise = sub(folded[Math.min(R-1,i+1)][j], folded[Math.max(0,i-1)][j]);
        let bentNormal = norm(cross(lengthwise,across));
        if (dot(bentNormal,sub(q,rings[i].c)) < 0) bentNormal = scale(bentNormal,-1);
        displacement = sub(q,p);
        normalChange = sub(bentNormal,nr);
      }
      m.vert(p, nr, col, mat, uv, o.weights(i, j, p), o.extra ? o.extra(i, j, p) : [0, 0, 0, 0], atlas, displacement, normalChange, o.fold?.driver ?? 0);
    }
  }
  if (o.cloth) m.pieces.push({ ...o.cloth, base, R, J, closed: !open });
  if (o.stitch && !open) {
    const r0 = rings[0], around = (q: V) => { const d = sub(q, r0.c); const a = Math.atan2(dot(d, r0.w), dot(d, r0.u)); return a < 0 ? a + Math.PI * 2 : a; };
    const A = o.stitch.v.map((v, k) => ({ v, a: around(o.stitch!.p[k]) })).sort((x, y) => x.a - y.a);
    const Bs = Array.from({ length: J }, (_, j) => ({ v: base + j, a: ang(j) }));
    A.push({ v: A[0].v, a: A[0].a + Math.PI * 2 });
    if (A[0].a > 0) { /* (the band starts at this piece's column 0: the edge's last point before it, brought round) */ A.unshift({ v: A[A.length - 2].v, a: A[A.length - 2].a - Math.PI * 2 }); A.pop(); A.push({ v: A[0].v, a: A[0].a + Math.PI * 2 }); }
    let ia = 0, ib = 0;
    while (ia < A.length - 1 || ib < Bs.length - 1) {
      const na = ia < A.length - 1 ? A[ia + 1].a : Infinity, nb2 = ib < Bs.length - 1 ? Bs[ib + 1].a : Infinity;
      if (na <= nb2) { m.tri(A[ia].v, Bs[ib].v, A[ia + 1].v); ia++; } else { m.tri(A[ia].v, Bs[ib].v, Bs[ib + 1].v); ib++; }
    }
  }
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < S; j++) {
    if (o.hole?.(i, j)) continue;
    const a = base + i * J + j, b = base + i * J + (j + 1) % J, c = base + (i + 1) * J + (j + 1) % J, d = base + (i + 1) * J + j;
    m.tri(a, d, c); m.tri(a, c, b);
  }
  const cap = (i: number, inward: boolean) => {
    const ctr = rings[i].c, d = norm(sub(rings[i].c, rings[inward ? Math.min(R - 1, i + 1) : Math.max(0, i - 1)].c));
    const capMat = o.mat(i,0);
    const capColor: C = capMat === MAT.fabric ? [0.91,1,o.tone ?? 0] : o.col(i,0);
    const k = m.vert(ctr, d, capColor, capMat, [0, 0], o.weights(i, 0, ctr), o.extra ? o.extra(i, 0, ctr) : [0, 0, 0, 0]);
    for (let j = 0; j < S; j++) m.tri(k, base + i * J + (j + 1) % J, base + i * J + j);
  };
  if (o.capA) cap(0, true);
  if (o.capB) cap(R - 1, false);
  return { base, R, J, P };
}

/** a weight shared between two bones across a zone (0 before it, 1 after it) */
const blend = (s: number, a: number, b: number) => Math.min(1, Math.max(0, (s - a) / (b - a)));
const smooth = (t: number) => t * t * (3 - 2 * t);
/** a profile of [s, value] keys */
function prof(keys: [number, number][], s: number) {
  for (let i = 0; i < keys.length - 1; i++) if (s <= keys[i + 1][0]) { const k = (s - keys[i][0]) / (keys[i + 1][0] - keys[i][0]); return keys[i][1] + (keys[i + 1][1] - keys[i][1]) * smooth(Math.max(0, Math.min(1, k))); }
  return keys[keys.length - 1][1];
}
/** a point along a polyline by fraction of its length, its direction, and where the joints fall (fractions) */
function path(pts: V[]) {
  const ls = pts.slice(1).map((p, i) => len(sub(p, pts[i]))), total = ls.reduce((s, x) => s + x, 0);
  const joints: number[] = []; let acc = 0;
  for (const l of ls.slice(0, -1)) { acc += l; joints.push(acc / total); }
  return {
    joints, total,
    at(t: number): { p: V; d: V } {
      let s = t * total;
      for (let i = 0; i < ls.length; i++) { if (s <= ls[i] || i === ls.length - 1) return { p: lerp(pts[i], pts[i + 1], Math.min(1, s / ls[i])), d: norm(sub(pts[i + 1], pts[i])) }; s -= ls[i]; }
      return { p: pts[pts.length - 1], d: norm(sub(pts[pts.length - 1], pts[pts.length - 2])) };
    },
  };
}
/** a rounded box's radius at an angle (a superellipse): the fist read as planes, not a tube */
const boxR = (a: number, hu: number, hw: number, n = 4): [number, number] => { const k = Math.pow(Math.abs(Math.cos(a)) ** n + Math.abs(Math.sin(a)) ** n, -1 / n); return [hu * k, hw * k]; };
/** A pressed ridge with a narrow sheltered valley along one side. Distances use the garment's local coordinates. */
function pleat(x: number, centre: number, width: number) {
  const d = (x - centre) / width;
  return Math.exp(-d * d) - 0.72 * Math.exp(-3 * (d + 1.05) ** 2);
}

function axesAbout(d: V, hint: V): [V, V] { const u = perp(hint, d); return [u, cross(d, u)]; }

/** a garment piece the cloth simulation can take over (look/cloth.ts): a loft's grid of R rings by J columns from
 * vertex `base` (closed round: the last column repeats the first), what it is, and where its joint falls (row fraction) */
export interface ClothPiece { kind: 'jacket' | 'sleeveW' | 'sleeveR' | 'breeches'; joint?: number; base: number; R: number; J: number; closed: boolean;
  /** vertices held to the skin (an armhole's edge, where a sleeve is sewn on, and the cloth cut out inside it) */
  pins?: number[];
  /** a flat pattern piece (closed: false): each of its points' places on the paper, for its lengths at rest */
  flat?: [number, number][] }
export interface Athlete { verts: Float32Array; index: Uint32Array; bind: Frame[]; count: number; pieces: ClothPiece[];
  /** what's sewn to what between pieces (vertex pairs): a drafted garment's seams */
  seams?: [number, number][];
  /** welded seams: a point drawn (and simulated) on the edge it's sewn to, between two points (p, q, q2, t) */
  stitches?: [number, number, number, number][] }
/** a drafted garment (devtools/piste-jacket.mjs: static/piste/jacket-draft.json), settled on the body in guard, which is
 * the athlete's resting pose: its points, triangles, paper places, seams, pieces */
export interface Draft { x: number[]; tris: number[]; uv: number[]; seam: number[]; flat: number[]; seams: [number, number][]; stitches?: [number, number, number, number][]; pieces: { name: string; kind: ClothPiece['kind']; base: number; rows: number; cols: number }[] }

/** where the garments were sewn, as the last athlete built them (for devtools/piste-seams.mjs) */
export const SEAMS: { what: string; rows: number[]; cols: number[]; heights: number[] }[] = [];

export function buildAthlete(o: { draft?: Draft } = {}): Athlete {
  const f = new Fencer(EPEE, 0, 1);
  f.pose();
  const m = new SkinMesh(), bind = boneFrames(f), c = f.capsules, F = f.frame, up: V = [0, 1, 0];
  const fab = () => MAT.fabric, white = (): C => [1, 1, 1];

  // ── the jacket: one body from the hem to the collar, a sloping shoulder each side ────────────────────────────────
  const pelvis = c[0].a, neck = c[1].b, spine = norm(sub(neck, pelvis));
  const hy = pelvis[1];
  // (heights above the pelvis: section half-widths along the shoulder line (f) and across (r), and the chest's fullness;
  // across the shoulders just beyond the joints (fencer.ts), so the sleeves' caps make the shoulders' outline)
  const H: [number, number, number, number][] = [
    [-0.09, 0.17, 0.118, 0], [-0.03, 0.166, 0.116, 0], [0.12, 0.146, 0.106, 0.004], [0.28, 0.168, 0.129, 0.012],
    [0.38, 0.19, 0.131, 0.01], [0.43, 0.188, 0.121, 0.004], [0.47, 0.165, 0.101, 0], [0.5, 0.128, 0.083, 0], [0.53, 0.068, 0.06, 0], [0.555, 0.062, 0.056, 0],
  ];
  // Orient each cross-section along the anatomical landmark it passes through.
  const hipLine = norm(sub(c[9].a,c[11].a));
  const clavicle = norm(add(sub(f.shoulder,c[7].a), scale(F.r,0.085)));
  // Tailor only the high shoulder, in bind space. Leave ease for the padded jacket.
  const fitShoulder = (p: V): V => {
    const height = p[1] - hy;
    const influence = smooth(blend(height, 0.27, 0.35)) * (1 - smooth(blend(height, 0.49, 0.55)));
    if (influence === 0) return p;
    let nearest = p, gap = Infinity;
    for (const cap of c) {
      const axis = sub(cap.b, cap.a);
      const t = blend(dot(sub(p, cap.a), axis), 0, Math.max(1e-9, dot(axis, axis)));
      const center = madd(cap.a, axis, t);
      const radius = cap.ra + (cap.rb - cap.ra) * t;
      const delta = sub(p, center), distance = len(delta);
      if (distance - radius < gap) {
        gap = distance - radius;
        nearest = madd(center, norm(delta), radius + 0.008);
      }
    }
    return gap <= 0.008 ? p : lerp(p, nearest, 0.88 * influence);
  };
  const torsoRings: Ring[] = Array.from({ length: 68 }, (_, i) => {
    const h = -0.09 + 0.645 * i / 67;
    const section = (axis: number) => prof(H.map(row => [row[0], row[axis]]), h);
    const ru = section(1), rw = section(2), full = section(3);
    const t = (h + 0.09) / 0.645;
    const p = madd(lerp(madd(pelvis, spine, -0.09), madd(neck, spine, 0.035), t), F.f, 0.012);
    // (the chest a little fuller in front (its front faces the fencer's left, −r), the back flatter)
    const across = norm(lerp(hipLine, clavicle, smooth(blend(h, 0.04, 0.39))));
    return { c: p, u: across, w: norm(cross(across,up)), r: (a: number) => {
      const side = Math.cos(a), front = Math.sin(a);
      const waist = pleat(h, 0.055 + 0.067 * side, 0.022) * (0.007 + 0.006 * front);
      const lower = pleat(h, -0.035 + 0.038 * Math.cos(a + 0.8), 0.016) * 0.009;
      const reach = pleat(h, 0.27 + 0.105 * side, 0.023) * 0.011 * (0.5 - 0.5 * front);
      const hem = 0.0035 * Math.exp(-((h + 0.081) ** 2) / 0.000022);
      const dr = waist + lower + reach + hem;
      return [ru + dr, rw * (front < 0 ? 1 + full * 8 * front ** 2 : 1 - 0.04 * front ** 2) + dr];
    }, lift: a => 0.018 * Math.cos(a + 0.35) * (1 - blend(h, -0.09, 0.08)) + 0.013*Math.cos(a)*Math.exp(-(((h-0.43)/0.095)**2))
      };
  });
  // the armholes: where each sleeve is sewn on, a patch of the jacket's grid round the shoulder, a little below the joint
  // where the arm hangs from it, cut out. Its edge (36 points) is the sleeve's first ring (below)
  const SS = 36, SEW = 6;
  const TS = 48, TJ = TS + 1, torsoP = loftPoints(torsoRings, { seg: TS, fit: fitShoulder } as LoftOpt);
  // whether a point is inside the jacket's body: in the plane of the ring nearest its height, inside that ring's outline
  const insideTorso = (q: V): boolean => {
    let i = 0, bd = Infinity;
    for (let k = 20; k < 68; k++) { const d = Math.abs(dot(sub(q, torsoRings[k].c), spine)); if (d < bd) { bd = d; i = k; } }
    const r = torsoRings[i], x = dot(sub(q, r.c), r.u), y = dot(sub(q, r.c), r.w);
    let inside = false;
    for (let j = 0, k = TS - 1; j < TS; k = j++) {
      const a = sub(torsoP[i][j], r.c), b2 = sub(torsoP[i][k], r.c), ax2 = dot(a, r.u), ay = dot(a, r.w), bx = dot(b2, r.u), by = dot(b2, r.w);
      if ((ay > y) !== (by > y) && x < ((bx - ax2) * (y - ay)) / (by - ay) + ax2) inside = !inside;
    }
    return inside;
  };
  /**
   * An armhole: where the sleeve meets the jacket. For each of the sleeve's columns, along its surface (a line parallel
   * to the arm, at the cap's radius) to where it comes out of the jacket's body: those points are the sleeve's first
   * ring, on the jacket's surface, so no part of the sleeve is inside the body to be seen into. Where the cap stands
   * above the shoulder (its line never inside), the jacket's nearest point. The jacket's cut round them: the patch of
   * its grid that holds them, whose edge is sewn to them by a band lying on its surface.
   */
  const R0 = 0.058;
  const armhole = (joint: V, toward: V) => {
    const ax = norm(sub(toward, joint)), [ua, wa] = axesAbout(ax, F.u);
    const nearestGrid = (q: V): [number, number] => { let bi = 0, bj = 0, bd = Infinity; for (let i = 36; i < 64; i++) for (let j = 0; j < TS; j++) { const d = len(sub(torsoP[i][j], q)); if (d < bd) { bd = d; bi = i; bj = j; } } return [bi, bj]; };
    const dirOf = (j: number) => { const a = (j / SS) * Math.PI * 2; return add(scale(ua, Math.cos(a)), scale(wa, Math.sin(a))); };
    const exits: number[] = Array.from({ length: SS }, (_, j) => {
      const at = (t: number) => madd(madd(joint, ax, t), dirOf(j), R0);
      let was = false, exit = NaN;
      for (let t = -0.12; t <= 0.12; t += 0.002) { const ins = insideTorso(at(t)); if (was && !ins) { exit = t; break; } was = ins; }
      if (Number.isNaN(exit)) return NaN;
      let lo = exit - 0.002, hi = exit;
      for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (insideTorso(at(mid))) lo = mid; else hi = mid; }
      return hi;
    });
    // (where the cap stands above the shoulder: at the found ones' middle distance along the arm, out from the axis to
    // the shoulder's surface, so the curve goes on smoothly over the top of the shoulder)
    const found = exits.filter((e) => !Number.isNaN(e)).sort((x, y) => x - y), tMid = found.length ? found[found.length >> 1] : 0;
    const curve: V[] = exits.map((e, j) => {
      if (!Number.isNaN(e)) return madd(madd(joint, ax, e), dirOf(j), R0);
      const base0 = madd(joint, ax, tMid);
      if (!insideTorso(base0)) { const [i, jj] = nearestGrid(madd(base0, dirOf(j), R0)); return torsoP[i][jj]; }
      let lo = 0, hi = R0;
      for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (insideTorso(madd(base0, dirOf(j), mid))) lo = mid; else hi = mid; }
      return madd(base0, dirOf(j), hi);
    });
    // (the jacket's patch round the curve: its grid's rows and columns, a ring of cells clear of it)
    const cells = curve.map(nearestGrid), jc = cells[0][1];
    const rel = (j: number) => ((j - jc + TS + TS / 2) % TS) - TS / 2;
    let i0 = Math.min(...cells.map((c2) => c2[0])) - 1, i1 = Math.max(...cells.map((c2) => c2[0])) + 1;
    const d0 = Math.min(...cells.map((c2) => rel(c2[1]))) - 1, d1 = Math.max(...cells.map((c2) => rel(c2[1]))) + 1;
    i1 = Math.min(i1, 64); i0 = Math.max(20, Math.min(i0, i1 - 4));
    const j0 = jc + d0, j1 = jc + d1, col = (j: number) => ((j % TS) + TS) % TS;
    const loop: [number, number][] = [];
    for (let j = j0; j < j1; j++) loop.push([i0, col(j)]);
    for (let i = i0; i < i1; i++) loop.push([i, col(j1)]);
    for (let j = j1; j > j0; j--) loop.push([i1, col(j)]);
    for (let i = i1; i > i0; i--) loop.push([i, col(j0)]);
    const inside = (i: number, j: number) => i >= i0 && i < i1 && col(j - j0) < j1 - j0;
    const all: [number, number][] = []; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) all.push([i, col(j)]);
    // (the curve stood 3 mm off the jacket, outward from the arm's axis, so the two don't flicker where they meet)
    const proud = curve.map((q) => { const t = dot(sub(q, joint), ax), rad = sub(q, madd(joint, ax, t)); return madd(q, norm(rad), 0.003); });
    return { loop, inside, all, pts: loop.map(([i, j]) => torsoP[i][j]), curve: proud, joint, ax, rows: [i0, i1], cols: [col(j0), col(j1)] };
  };
  const holes = [armhole(f.shoulder, f.elbow), armhole(c[7].a, c[7].b)];
  SEAMS.length = 0;
  holes.forEach((h, k) => SEAMS.push({ what: k ? 'rear armhole' : 'weapon armhole', rows: h.rows, cols: h.cols, heights: h.rows.map((i) => torsoP[i][0][1] - hy) }));
  const torso = loft(m, torsoRings, {
    // (no hole: the sleeve's first ring lies on the jacket's surface, just proud of it, the jacket going on under it,
    // so there's nothing to see into from any angle)

    fold: { driver: 4, relief: (row,a) => {
      const front = 0.5-0.5*Math.sin(a);
      return front*(0.012*pleat(row,0.50+0.16*Math.cos(a),0.035)
        - 0.009*pleat(row,0.39+0.10*Math.cos(a),0.045));
    } },
    cloth: { kind: 'jacket', pins: [] }, fit: fitShoulder, panel: 0, seg: TS, col: white, mat: fab, tone: TONE.jacket, seams: [0.25, 0.75], capB: true,
    weights: (i, j, p) => {
      const h = p[1] - hy, k = blend(h, 0.18, 0.4);
      const w: W = [[B.pelvis, 1 - k], [B.chest, k]];
      // (near each shoulder the jacket takes a share of that arm: reaching, the arm draws it across the chest)
      for (const [sh, bone] of [[f.shoulder, B.upperW], [c[7].a, B.upperR]] as const) {
        // (the same share the sleeve's cap gives the chest where they meet, so jacket and sleeve move as one garment there)
        const d = len(sub(p, sh)), s = Math.max(0, 1 - d / 0.2) * 0.6;
        if (s > 0) { for (const e of w) e[1] *= 1 - s; w.push([bone, s]); }
      }
      return w;
    },
    extra: (i, j, p) => [Math.max(0, 1 - (p[1] - hy + 0.09) / 0.14), 0, 0, PART.torso],
  });
  // (the jacket's cloth held to the skin round each armhole, where a sleeve is sewn on, and inside it, where nothing shows)
  m.pieces[m.pieces.length - 1].pins = holes.flatMap((h) => h.all.flatMap(([i, j]) => j === 0 ? [torso.base + i * TJ, torso.base + i * TJ + TS] : [torso.base + i * TJ + j]));
  const vertexWeights = (v: number): W => { const k = v * SKIN_STRIDE; return [0, 1, 2, 3].map((q) => [m.v[k + 12 + q], m.v[k + 16 + q]] as [number, number]).filter((e) => e[1] > 0); };

  // ── sleeves: the cap out of the shoulder, full through the upper arm, the elbow, the forearm to the cuff ──────────
  // (each sleeve sewn onto its armhole: its first ring is the armhole's edge, the jacket's own points; over its first
  // few rings it goes from the armhole's shape to its own round one, and from the jacket's weights to its own)
  const sleeve = (pts: V[], up1: number, fore: number, partTop: number, armSign: number, seam: ReturnType<typeof armhole>) => {
    const pa = path(pts), sE = pa.joints[0], N = 55;
    const rings: Ring[] = [];
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1), { p } = pa.at(s);
      const tangent = norm(sub(pa.at(Math.min(1, s+0.065)).p, pa.at(Math.max(0, s-0.065)).p));
      const [u, w] = axesAbout(tangent, F.u);
      // (fitted to an athlete's arm with a sleeve's ease: about 36 cm round the upper arm, 31 round the forearm, measured by
      // devtools/piste-proportions.mjs; the cap fuller where it's set into the shoulder)
      // (the rear sleeve's cuff closes onto the bare wrist: its open end doesn't show)
      const r = prof([[0, 0.052], [0.07, 0.064], [0.16, 0.063], [sE - 0.06, 0.054], [sE, 0.052], [sE + 0.1, 0.05], [0.85, 0.044], [1, armSign > 0 ? 0.041 : 0.03]], s);
      rings.push({ c: p, u, w, r: a => {
        const lift = Math.cos(a + armSign * 0.6);
        const inside = 0.44 + 0.38 * lift;
        const elbow = pleat(s, sE - 0.09 + 0.055 * lift, 0.031) * 0.012
          + pleat(s, sE + 0.04 - 0.045 * Math.sin(a), 0.025) * 0.010;
        const cuff = pleat(s, 0.86 + 0.045 * lift, 0.026) * 0.006;
        // (the rear cuff's edge kept round, closed on the wrist: no wave in it)
        const dr = elbow * inside + (armSign > 0 ? cuff : cuff * (1 - blend(s, 0.8, 0.9))) + 0.004 * Math.cos(3*a + 2*s) * Math.sin(Math.PI*s) * (armSign > 0 ? 1 : 1 - blend(s, 0.8, 0.95));
        return [r + dr, r * 0.93 + dr];
      } });
    }
    // the armhole's edge, and for each of the sleeve's columns the nearest of its points round the first ring (whose
    // weights the sleeve's first rings ease from)
    const r0 = rings[0], around = (q: V) => { const d = sub(q, r0.c); const a = Math.atan2(dot(d, r0.w), dot(d, r0.u)); return a < 0 ? a + Math.PI * 2 : a; };
    const edgeV = seam.loop.map(([i, j]) => torso.base + i * TJ + j), edgeA = seam.pts.map(around);
    const nearest = (j: number) => { const a = (j / SS) * Math.PI * 2; let bk = 0, bd = 9; edgeA.forEach((e, k) => { const d = Math.abs(((e - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); if (d < bd) { bd = d; bk = k; } }); return edgeV[bk]; };
    const sewn = (i: number) => smooth(Math.min(1, i / SEW));
    // the inside of the elbow (toward the chord from shoulder to wrist) gathers as it bends
    const E = pts[1], inner = norm(sub(lerp(pts[0], pts[2], 0.5), E));
    loft(m, rings, {
      place: (i, j, p) => (i < SEW ? lerp(seam.curve[j % SS], p, sewn(i)) : p),
      fold: { driver: armSign > 0 ? 0 : 1, relief: (row,a,radial) => {
        const compression = 0.12 + 0.88 * smooth((1 + dot(radial,inner)) * 0.5);
        // Two oblique gathers form at the inside elbow and flatten across the outside.
        return compression*(0.014*pleat(row,sE-0.13+0.045*Math.sin(a),0.031)
          + 0.011*pleat(row,sE+0.055-0.041*Math.cos(a),0.027));
      } },
      cloth: { kind: armSign > 0 ? 'sleeveW' : 'sleeveR', joint: sE }, fit: fitShoulder, panel: 1, seg: SS, col: white, mat: fab, tone: TONE.jacket, seams: [0.5],
      weights: (i, j) => {
        const s = i / (N - 1), k = blend(s, sE - 0.07, sE + 0.07); const yoke = 0.4 * (1 - smooth(blend(s, 0, 0.2)));
        const own: W = [[B.chest, yoke], [up1, 1 - k - yoke], [fore, k]];
        if (i >= SEW) return own;
        // (near the seam, toward the jacket's weights at the armhole: sewn, they move as one)
        const t = sewn(i), w: Map<number, number> = new Map();
        for (const [b, x] of vertexWeights(nearest(j))) w.set(b, (w.get(b) ?? 0) + x * (1 - t));
        for (const [b, x] of own) w.set(b, (w.get(b) ?? 0) + x * t);
        return [...w];
      },
      extra: (i, j, p) => {
        const s = i / (N - 1), near = Math.max(0, 1 - Math.abs(s - sE) / 0.13), face = Math.max(0, dot(norm(sub(p, rings[i].c)), inner));
        return [0, armSign * Math.min(1, s * 1.4) * 0.8, armSign * near * face, armSign < 0 || s < sE - 0.14 ? partTop : PART.always];
      },
    });
  };
  const wrist = madd(f.hand, norm(sub(f.elbow, f.hand)), 0.092);
  // (each sleeve's own first ring at its shoulder joint, a little out along the arm, the armhole's edge sewn to it)
  sleeve([madd(madd(f.shoulder, holes[0].ax, 0.03), up, -0.01), f.elbow, wrist], B.upperW, B.foreW, PART.upperSleeve, 1, holes[0]);
  // (the rear sleeve runs on over the bare wrist, closed onto it, so its open end is filled)
  sleeve([madd(madd(c[7].a, holes[1].ax, 0.03), up, -0.015), c[7].b, madd(c[8].b, norm(sub(c[8].a, c[8].b)), 0.018)], B.upperR, B.foreR, PART.rearArm, -1, holes[1]);

  // The seat: closes the opening between the two leg tops, inside the jacket's hem and the legs. It goes with the pelvis
  // (only its lowest rings take a little of each thigh), so a thigh turning in guard doesn't carry it out through the hem
  const seat: Ring[] = Array.from({ length: 12 }, (_, i) => {
    const t = i / 11;
    return { c: madd(pelvis, up, -0.105 + t * 0.09), u: hipLine, w: norm(cross(hipLine, up)), r: () => [0.032 + 0.07 * t, 0.032 + 0.05 * t] };
  });
  loft(m, seat, { panel: 2, seg: 32, col: white, mat: fab, tone: TONE.breeches, capA: true,
    weights: (i, j) => {
      const thigh = 0.35 * (1 - smooth(i / 11));
      const front = smooth((1 + Math.cos(j * Math.PI / 16)) / 2);
      return [[B.pelvis, 1 - thigh], [B.thighF, thigh * front], [B.thighB, thigh * (1 - front)]];
    }, extra: () => [0, 0, 0, PART.torso] });

  // The crotch strap: from the jacket's hem in front, between the legs, to its hem behind (it holds the jacket down
  // in a lunge). Front and back are the hem's points facing the chest's way (the fencer's left, −r) and the back's
  {
    const hem = torsoP[0].slice(0, TS);
    const facing = (dir: V) => hem.reduce((bk, q, k) => (dot(sub(q, torsoRings[0].c), dir) > dot(sub(hem[bk], torsoRings[0].c), dir) ? k : bk), 0);
    const fr = madd(madd(hem[facing(scale(F.r, -1))], up, 0.012), F.r, 0.004), bk = madd(madd(hem[facing(F.r)], up, 0.012), F.r, -0.004);
    const pa = path([fr, madd(pelvis, up, -0.122), bk]), NS = 16;
    const strap: Ring[] = Array.from({ length: NS }, (_, i) => {
      const s2 = i / (NS - 1), { p: q } = pa.at(s2), tangent = norm(sub(pa.at(Math.min(1, s2 + 0.05)).p, pa.at(Math.max(0, s2 - 0.05)).p));
      const [u, w] = axesAbout(tangent, F.f);
      return { c: q, u, w, r: () => [0.022, 0.0035] };
    });
    loft(m, strap, { seg: 10, col: white, mat: fab, tone: TONE.jacket, capA: true, capB: true, weights: () => [[B.pelvis, 1]], extra: () => [0, 0, 0, PART.torso] });
  }

  // ── legs: breeches full to below the knee, the band, the knee and calf under the sock, the ankle ───────────────────
  const leg = (th: number, sh: number, pole: V) => {
    const hip = c[th].a, knee = c[th].b, ankle = madd(c[sh].b, up, 0.035);
    // (the leg's top is inside the jacket, at the hip, and goes mostly with the pelvis: a thigh tilting in guard doesn't
    // carry it out through the hem)
    const pa = path([madd(hip, up, 0.015), knee, ankle]), sK = pa.joints[0], N = 48, band = sK + 0.07;
    const rings: Ring[] = [], mats: number[] = [], tones: number[] = [];
    const add1 = (s: number, tone: number) => {
      const { p } = pa.at(s), tangent = norm(sub(pa.at(Math.min(1, s+0.045)).p, pa.at(Math.max(0, s-0.045)).p));
      const [u, w] = axesAbout(tangent, pole);
      // (the kneecap at the front of the knee; the calf full at the back; breeches loose above the band)
      const kneeK = Math.max(0, 1 - Math.abs(s - (sK + 0.01)) / 0.05), calfK = Math.max(0, 1 - Math.abs(s - (sK + 0.17)) / 0.15);
      // (fitted: about 62 cm round the upper thigh, 46 above the knee, 42 at it; under the sock a calf that fills out
      // below the band to about 39 and narrows to the ankle. Measured by devtools/piste-proportions.mjs)
      // (the knee is found from in front by the kneecap standing out of a leg that's narrowest just above and below
      // it, not by the band's edge; the breeches gathered in under it to the band)
      const r = tone === TONE.breeches ? prof([[0, 0.092], [0.12, 0.1], [0.3, 0.097], [sK - 0.1, 0.071], [sK - 0.03, 0.064], [sK + 0.015, 0.066], [band, 0.055]], s) : prof([[band, 0.054], [band + 0.04, 0.054], [sK + 0.17, 0.052], [0.8, 0.043], [1, 0.039]], s);
      rings.push({ c: p, u, w, r: (a) => { const ca = Math.cos(a);
        const dr = tone === TONE.breeches ? (0.007 * pleat(s, sK-0.08+0.052*ca, 0.022)
          + 0.005 * pleat(s, sK-0.015-0.029*Math.sin(a), 0.017)
          + 0.008 * pleat(s, 0.16+0.09*ca, 0.032)) : 0;
        // (the kneecap forward; the shin straight in front and the calf full behind it and, less, at either side, so its
        // curve shows from the side and from in front)
        const side = Math.abs(Math.sin(a));
        return [r * (1 + (ca > 0 ? 0.22 * kneeK * ca ** 2 : 0.6 * calfK * -ca)) + dr, r * (0.94 + 0.16 * calfK * side) + dr]; } });
      mats.push(MAT.fabric); tones.push(tone);
    };
    for (let i = 0; i < N; i++) { const s = (i / (N - 1)) * band; add1(s, TONE.breeches); }
    const leg1 = rings.splice(0), tone1 = tones.splice(0); mats.splice(0);
    const wts = (s: number): W => { const k = blend(s, sK - 0.06, sK + 0.06), hipK = 1 - smooth(blend(s, 0, 0.2)); return [[th === 9 ? B.thighF : B.thighB, (1 - k) * (1 - hipK * 0.75)], [sh === 10 ? B.shinF : B.shinB, k], [B.pelvis, (1 - k) * hipK * 0.75]]; };
    loft(m, leg1, { fold: { driver: th === 9 ? 2 : 3, relief: (row,a) => {
      const slack = 0.5-0.5*Math.cos(a);
      return slack*(0.013*pleat(row,0.78+0.06*Math.sin(a),0.045)
        + 0.009*pleat(row,0.88-0.025*Math.sin(a),0.03));
    } }, cloth: { kind: 'breeches', joint: sK / band }, panel: 2, seg: 32, col: white, mat: fab, tone: tone1[0], seams: [0.25], capA: true, weights: (i) => wts((i / (N - 1)) * band) });
    // the band: a narrow cuff, a little proud
    const bandRings: Ring[] = [band - 0.012, band + 0.012].map((s) => { const { p, d } = pa.at(s), [u, w] = axesAbout(d, pole); return { c: p, u, w, r: () => [0.063, 0.06] }; });
    loft(m, bandRings, { seg: 14, col: white, mat: fab, tone: TONE.breeches, seams: [0.25], weights: () => wts(band) });
    for (let i = 0; i < 14; i++) { const s = band + (1 - band) * (i / 13); add1(s, TONE.sock); }
    const leg2 = rings.splice(0);
    // (the sock's foot end goes with the foot, inside the shoe's opening: turned out, the two turn together, no gap)
    const footBone = th === 9 ? B.footF : B.footB;
    loft(m, leg2, { seg: 14, col: white, mat: fab, tone: TONE.sock, capB: true, weights: (i) => {
      const s = band + (1 - band) * (i / 13), k = smooth(blend(s, 0.9, 1)), w = wts(s).map(([b, x]) => [b, x * (1 - k)] as [number, number]);
      return k > 0 ? [...w, [footBone, k]] : w;
    } });
  };
  leg(9, 10, add(F.f, [0, 0.2, 0]));
  leg(11, 12, add(add(scale(F.f, -0.3), scale(F.r, -0.8)), [0, 0.2, 0]));

  // ── shoes: a shaped sole pitched along the foot, the upper rounded over it, two bands each side ────────────────────
  const shoe = (k: number, bone: number) => {
    const heel = c[k].a, toe = c[k].b, d = norm(sub(toe, heel)), side = norm(cross(up, d)), L = len(sub(toe, heel)) + 0.05;
    const back = madd(heel, d, -0.03), base = -0.037;
    // sole: a rounded outline, thicker at the heel, its toe sprung up a little
    const soleRings: Ring[] = [], upperRings: Ring[] = [];
    for (let i = 0; i < 12; i++) {
      const s = i / 11, w = prof([[0, 0.032], [0.12, 0.045], [0.45, 0.044], [0.7, 0.05], [0.92, 0.042], [1, 0.02]], s);
      const th = prof([[0, 0.022], [0.3, 0.02], [0.6, 0.012], [1, 0.01]], s), spring = s > 0.8 ? (s - 0.8) * 0.05 : 0;
      const p = madd(madd(back, d, s * L), up, base + th / 2 + spring);
      soleRings.push({ c: p, u: up, w: side, r: () => [th / 2, w + 0.004] });
      const ht = prof([[0, 0.07], [0.15, 0.085], [0.42, 0.072], [0.72, 0.048], [0.93, 0.034], [1, 0.022]], s);
      upperRings.push({ c: madd(madd(back, d, s * L), up, base + th + ht / 2 + spring), u: up, w: side, r: (a) => [ht / 2, w * (Math.cos(a) < 0 ? 1 : 0.92)] });
    }
    loft(m, soleRings, { seg: 12, col: () => COL.sole, mat: () => MAT.rubber, capA: true, capB: true, weights: () => [[bone, 1]] });
    loft(m, upperRings, { panel: 6, panelUV: (i,j) => [0.5 + 0.49*Math.sin(j/14 * Math.PI*2), i/11], seg: 14, col: (i, j) => { const a = (j / 14) * Math.PI * 2; return (i === 5 || i === 7) && Math.abs(Math.sin(a)) > 0.6 && Math.cos(a) < 0.3 ? COL.band : COL.shoe; }, mat: () => MAT.cloth, capA: true, capB: true, weights: () => [[bone, 1]] });
    for (let row = 0; row < 4; row++) for (const dir of [-1, 1]) {
      const route: V[] = [];
      for (let j = 0; j <= 6; j++) {
        const t = j / 6, across = dir * (2*t-1), s = 0.31 + row*0.072 + t*0.065;
        const station = s*11, k = Math.floor(station), local = station-k;
        const a = upperRings[k], b = upperRings[k+1], centre = lerp(a.c,b.c,local);
        const [ha,wa] = a.r(0), [hb,wb] = b.r(0);
        const z = across*0.63;
        const pos = madd(centre, side, z*(wa+(wb-wa)*local));
        route.push(madd(pos, up, (ha+(hb-ha)*local)*Math.sqrt(1-z*z)+0.0025));
      }
      const lace = route.map((point,i) => {
        const tangent = norm(sub(route[Math.min(i+1,6)],route[Math.max(i-1,0)]));
        const [u,w] = axesAbout(tangent, up);
        return { c:point, u,w, r: (): [number,number] => [0.0016,0.0022] };
      });
      loft(m,lace,{seg:6,col:()=>[0.42,0.41,0.37],mat:()=>MAT.cloth,weights:()=>[[bone,1]]});
    }
  };
  shoe(13, B.footF); shoe(14, B.footB);

  // ── the mask: the cage shaped in profile (face, crown, jaw), a rim, padding behind; the bib round the neck ─────────
  const hc = madd(lerp(c[2].a, c[2].b, 0.5), up, -0.014), fwd = F.f, side = F.r;
  // (rings from under the chin to the crown by elevation, so the crown is a dome; the cage reaches forward to a
  // flattened face and juts under the chin; the back of the head is rounder and shorter)
  const HN = 15, el0 = -1.05;
  const headRing = (t: number, grow = 0): Ring => {
    const e = el0 + t * (Math.PI / 2 - el0), k = Math.max(0.03, Math.cos(e)), chin = e < 0 ? -Math.sin(e) : 0;
    const ff = 0.122 * k * (1 + 0.22 * chin) + grow, fb = 0.108 * Math.max(0.03, Math.cos(e * 1.04)) + grow, sw = 0.104 * k + grow;
    return { c: madd(madd(hc, up, 0.012 + 0.138 * Math.sin(e)), fwd, 0.012 * chin), u: fwd, w: side,
      r: (a) => { const ca = Math.cos(a), sa = Math.abs(Math.sin(a)); return [ca > 0 ? ff * (1 - 0.13 * sa * sa * sa) : fb, sw]; } };
  };
  const headRings = Array.from({ length: HN }, (_, i) => headRing(i / (HN - 1)));
  const hw: W = [[B.head, 1]], hx = (): [number, number, number, number] => [0, 0, 0, PART.head];
  // the cage over the face and up over the crown's front; the padded back; a rubber rim proud along the edge between
  const cageA = 1.95;
  loft(m, headRings, { seg: 22, arc: [-cageA, cageA], col: () => COL.mesh, mat: () => MAT.mesh, weights: () => hw, extra: hx });
  loft(m, headRings, { seg: 14, arc: [cageA, Math.PI * 2 - cageA], col: () => COL.padding, mat: () => MAT.cloth, weights: () => hw, extra: hx, capB: true });
  for (const a0 of [cageA, -cageA]) {
    const rim = Array.from({ length: HN - 2 }, (_, i) => headRing((i + 1) / (HN - 1), 0.007));
    loft(m, rim, { seg: 3, arc: [a0 - 0.12, a0 + 0.12], col: () => COL.trim, mat: () => MAT.rubber, weights: () => hw, extra: hx });
  }
  // The pressed front panel sits proud of the side cage. Its rolled binding describes the jaw in frontal light.
  const faceRing = (s: number, outset = 0): Ring => ({
    c: madd(madd(hc, fwd, 0.071 + 0.063 * (1 - s*s) + outset), up, 0.012),
    u: up, w: side,
    r: a => boxR(a, 0.145*s, (0.111 + 0.013*Math.cos(a))*s, 2.65),
  });
  loft(m, Array.from({length: 19}, (_, i) => faceRing(0.008 + 0.992*i/18)), {
    panel: 4, panelUV: (_i,_j,p) => [0.5 + dot(sub(p,hc),side)/0.23, 0.5 - (p[1]-hc[1]-0.012)/0.31],
    seg: 72, col: () => COL.mesh, mat: () => MAT.maskFront, weights: () => hw, extra: hx, capA: true,
  });
  loft(m, [faceRing(0.948, 0.001), faceRing(0.98, 0.0035), faceRing(1, 0.003), faceRing(1.025, -0.0005), faceRing(1.03, -0.008)], {
    seg: 72, col: () => [0.26, 0.25, 0.22], mat: () => MAT.rubber, weights: () => hw, extra: hx,
  });
  // A bias-bound apron leaves the sides of the collar in shadow and lies flat over the sternum.
  const bibArc: [number, number] = [-1.45, 1.45];
  const bibRow = (t: number, piping = 0): Ring => ({
    c: lerp(madd(hc, up, -0.087), madd(neck, up, -0.030), t),
    u: fwd, w: side,
    lift: a => -0.072 * t * Math.max(0, Math.cos(a)) ** 2 + 0.014*t*Math.abs(Math.sin(a)),
    r: a => [0.087 + 0.068*t + piping, 0.084 + 0.018*t + piping],
  });
  const bibWeights = (t: number): W => [[B.head, 0.85*(1-t)], [B.chest, 0.15 + 0.85*t]];
  loft(m, Array.from({length:18}, (_,i)=>bibRow(i/17)), {
    arc: bibArc, panel: 5, seg: 40, col: white, mat: fab, tone: TONE.jacket,
    weights: i => bibWeights(i/17), extra: hx,
  });
  loft(m, [bibRow(0.945,0.001),bibRow(0.975,0.0025),bibRow(1,0.0005)], {
    arc: bibArc, seg: 40, col: () => [0.42,0.41,0.38], mat: () => MAT.cloth,
    weights: i => bibWeights([0.945,0.975,1][i]), extra: hx,
  });

  // ── the weapon hand: a gloved hand on the grip ─────────────────────────────────────────────────────────────────
  {
    // (the hand's frame: x along the grip toward the guard, y toward the thumb, Z toward the palm's side of the grip (the
    // inside, toward the body): so the back of the hand and the knuckles are outside, the fingers wrap under the grip
    // and their tips come round on the inside, the thumb along the top)
    const hb = bind[B.handW], Z = scale(hb.z, -1), L = (x: number, y: number, z: number): V => add(hb.o, add(scale(hb.x, x), add(scale(hb.y, y), scale(Z, z))));
    const gw: W = [[B.handW, 1]];
    // the cuff (gauntlet): over the sleeve's end, round the forearm, its edge flared
    const fa = norm(sub(f.hand, f.elbow)), cuffRings: Ring[] = [];
    // (flared at its edge over the sleeve, narrowing to a padded wrist, so from the eye the hand shows past it)
    for (let i = 0; i < 25; i++) { const s = i / 24, p = madd(f.hand, fa, -0.175 + s * 0.14), [u, w] = axesAbout(fa, F.u), r = prof([[0, 0.055], [0.12, 0.053], [0.5, 0.045], [0.8, 0.038], [1, 0.034]], s); cuffRings.push({ c: p, u, w, r: a => { const crease = 0.003 * pleat(s, 0.66 + 0.13*Math.sin(a), 0.055) + 0.0025*pleat(s, 0.05, 0.035); return [r+crease, r*0.94+crease]; } }); }
    loft(m, cuffRings, { panel: 3, seg: 24, capA: true, col: white, mat: fab, tone: TONE.glove, seams: [0.0], weights: (i) => [[B.foreW, 1 - i / 32], [B.handW, i / 32]] });
    // the closed hand as a box of planes (after the hand-construction reference): its top the back of the hand, its
    // front the fingers' first segments, its sides; from the wrist to the knuckle ridge, on the outside of the grip,
    // padded a little fuller than a hand
    const backRings: Ring[] = [];
    for (let i = 0; i < 6; i++) { const s = i / 5, x = -0.078 + s * 0.116, hu = prof([[0, 0.031], [0.5, 0.04], [1, 0.037]], s);
      backRings.push({ c: L(x, -0.002, -0.016), u: hb.y, w: Z, r: (a) => boxR(a, hu, Math.sin(a) < 0 ? 0.031 : 0.02) }); }
    loft(m, backRings, { panel: 7, seg: 16, col: white, mat: fab, tone: TONE.glove, seams: [0.75], capA: true, capB: true, weights: () => gw });
    // the palm's inside under the thumb (its heel and the thumb's root), closing the fist round the grip
    const palmRings: Ring[] = [];
    for (let i = 0; i < 5; i++) { const s = i / 4; palmRings.push({ c: L(-0.07 + s * 0.085, 0.0, 0.012), u: hb.y, w: Z, r: (a) => boxR(a, prof([[0, 0.024], [0.6, 0.026], [1, 0.02]], s), 0.014, 3) }); }
    loft(m, palmRings, { seg: 14, col: white, mat: fab, tone: TONE.glove, capA: true, capB: true, weights: () => gw });
    // the knuckle ridge: a knuckle at each finger's root
    const fingerX = [0.029, 0.0095, -0.0095, -0.028];
    for (const x of fingerX) {
      const kRings: Ring[] = [-0.009, 0, 0.009].map((dx, k) => ({ c: L(x + dx, -0.008, -0.043), u: hb.y, w: Z, r: () => [k === 1 ? 0.0115 : 0.006, k === 1 ? 0.0095 : 0.005] }));
      loft(m, kRings, { seg: 8, col: white, mat: fab, tone: TONE.glove, capA: true, capB: true, weights: () => gw });
    }
    // fingers: round the grip from the knuckles, under it, to the palm side
    for (const [k, x] of fingerX.entries()) {
      const fr: Ring[] = [], R = 0.0275, r0 = k === 3 ? 0.0095 : 0.0112;
      for (let i = 0; i < 9; i++) {
        const a = 0.15 + (i / 8) * (Math.PI * 0.95), dir = add(scale(Z, -Math.cos(a)), scale(hb.y, -Math.sin(a)));
        const tan = add(scale(Z, Math.sin(a)), scale(hb.y, -Math.cos(a)));
        const ctr = add(L(x, 0, 0), scale(dir, R)), [u, w] = axesAbout(tan, hb.x);
        fr.push({ c: ctr, u, w, r: () => [r0, r0 * 0.92] });
      }
      loft(m, fr, { panel: 3, seg: 12, col: white, mat: fab, tone: TONE.glove, capA: true, capB: true, weights: () => gw });
    }
    // the thumb: from the root at the side of the hand, along the top of the grip toward the guard, crossing it
    // the thumb: its root a wedge deep in the palm by the wrist (turning with it), then two knuckles seen, lying along
    // the top of the grip toward the guard and crossing onto it
    const tp = path([L(-0.07, 0.008, 0.008), L(-0.034, 0.025, 0.006), L(0.004, 0.03, 0.002), L(0.04, 0.025, 0.0)]), tr: Ring[] = [];
    for (let i = 0; i < 9; i++) { const s = i / 8, { p, d } = tp.at(s), [u, w] = axesAbout(d, hb.y), r = prof([[0, 0.024], [0.3, 0.016], [0.62, 0.0135], [0.68, 0.0145], [0.87, 0.0125], [1, 0.005]], s), wedge = 1 + 0.6 * Math.max(0, 1 - s / 0.4);
      tr.push({ c: p, u, w, r: () => [r, r * 0.88 * wedge] }); }
    loft(m, tr, { panel: 3, seg: 16, col: white, mat: fab, tone: TONE.glove, capA: true, capB: true, weights: () => gw });
  }

  // ── the rear hand: bare, relaxed: a palm, four fingers a little curled, the thumb ───────────────────────────────
  {
    const hb = bind[B.handR], L = (x: number, y: number, z: number): V => add(hb.o, add(scale(hb.x, x), add(scale(hb.y, y), scale(hb.z, z))));
    const hw: W = [[B.handR, 1]], ex = (): [number, number, number, number] => [0, 0, 0, PART.rearArm];
    const wristRings: Ring[] = [-0.062,-0.032,-0.012,0.01,0.027].map((x,i)=>({
      c:L(x,0,0),u:hb.y,w:hb.z,r:()=>[0.025-i*0.001,0.032-i*0.0007],
    }));
    loft(m,wristRings,{seg:18,col:()=>COL.skin,mat:()=>MAT.skin,weights:()=>hw,extra:ex});
    const palm: Ring[] = [];
    for (let i = 0; i < 5; i++) { const s = i / 4; palm.push({ c: L(0.005 + s * 0.085, 0, 0), u: hb.y, w: hb.z, r: () => [prof([[0, 0.022], [0.6, 0.016], [1, 0.012]], s), prof([[0, 0.026], [0.5, 0.042], [1, 0.04]], s)] }); }
    loft(m, palm, { seg: 12, col: () => COL.skin, mat: () => MAT.skin, capA: true, capB: true, weights: () => hw, extra: ex });
    // (each finger from its knuckle a segment into the palm, 85% of its length, not its edge: the knuckle ridge; loosely
    // curled, each joint a little more than the last)
    for (const [k, z] of [0.028, 0.01, -0.008, -0.025].entries()) {
      const l = [0.07, 0.078, 0.074, 0.06][k], x0 = 0.077 - (k === 3 ? 0.006 : 0), fp = path([L(x0, 0.002, z), L(x0 + l * 0.45, -0.006, z * 1.05), L(x0 + l * 0.78, -0.024, z * 1.08), L(x0 + l * 0.95, -0.042, z * 1.1)]);
      const fr: Ring[] = [];
      for (let i = 0; i < 6; i++) { const s = i / 5, { p, d } = fp.at(s), [u, w] = axesAbout(d, hb.y), r = prof([[0, 0.0088], [1, 0.0068]], s); fr.push({ c: p, u, w, r: () => [r * 0.9, r] }); }
      loft(m, fr, { seg: 8, col: () => COL.skin, mat: () => MAT.skin, capA: true, capB: true, weights: () => hw, extra: ex });
    }
    // the thumb: a wedge of root deep in the palm by the wrist, then two knuckles seen
    const tp = path([L(0.004, -0.004, 0.022), L(0.03, -0.01, 0.042), L(0.055, -0.018, 0.052), L(0.077, -0.026, 0.054)]), tr: Ring[] = [];
    for (let i = 0; i < 8; i++) { const s = i / 7, { p, d } = tp.at(s), [u, w] = axesAbout(d, hb.y), r = prof([[0, 0.017], [0.35, 0.011], [1, 0.0082]], s), wedge = 1 + 0.6 * Math.max(0, 1 - s / 0.35);
      tr.push({ c: p, u, w, r: () => [r * 0.85, r * wedge] }); }
    loft(m, tr, { seg: 8, col: () => COL.skin, mat: () => MAT.skin, capA: true, capB: true, weights: () => hw, extra: ex });
  }

  bakeContactShade(m);
  if (o.draft) return dressIn(m, o.draft, bind);
  return { verts: Float32Array.from(m.v), index: Uint32Array.from(m.i), bind, count: m.i.length, pieces: m.pieces };
}

/**
 * The athlete in a drafted garment instead of its own jacket and sleeves: theirs taken out, the draft's pieces put in. A
 * drafted point follows the body as the nearest point of the jacket it replaces did (its joints and weights); the cloth
 * simulation takes them as flat pieces, sewn at their seams (look/cloth.ts).
 */
function dressIn(m: SkinMesh, D: Draft, bind: Frame[]): Athlete {
  const old = m.pieces.filter((p) => p.kind !== 'breeches'), gone = new Uint8Array(m.n);
  for (const p of old) gone.fill(1, p.base, p.base + p.R * p.J);
  const oldIds: number[] = []; for (let i = 0; i < m.n; i++) if (gone[i]) oldIds.push(i);
  const index: number[] = [];
  for (let i = 0; i < m.i.length; i += 3) if (!gone[m.i[i]] && !gone[m.i[i + 1]] && !gone[m.i[i + 2]]) index.push(m.i[i], m.i[i + 1], m.i[i + 2]);
  const at = (i: number): V => [D.x[i * 3], D.x[i * 3 + 1], D.x[i * 3 + 2]], n = D.x.length / 3, base = m.n;
  // (normals from its triangles, as settled)
  const N = Array.from({ length: n }, () => [0, 0, 0] as V);
  for (let t = 0; t < D.tris.length; t += 3) { const [a, b, c] = [D.tris[t], D.tris[t + 1], D.tris[t + 2]], nr = cross(sub(at(b), at(a)), sub(at(c), at(a))); for (const k of [a, b, c]) for (let j = 0; j < 3; j++) N[k][j] += nr[j]; }
  const pieceOf = (i: number) => D.pieces.find((p) => i >= p.base && i < p.base + p.rows * p.cols)!;
  for (let i = 0; i < n; i++) {
    const p = at(i);
    let best = oldIds[0], bd = Infinity; for (const j of oldIds) { const v = j * SKIN_STRIDE, d = (m.v[v] - p[0]) ** 2 + (m.v[v + 1] - p[1]) ** 2 + (m.v[v + 2] - p[2]) ** 2; if (d < bd) { bd = d; best = j; } }
    const v = best * SKIN_STRIDE, w: W = [0, 1, 2, 3].map((k) => [m.v[v + 12 + k], m.v[v + 16 + k]] as [number, number]).filter((e) => e[1] > 0);
    const pc = pieceOf(i), row = Math.floor((i - pc.base) / pc.cols) / (pc.rows - 1);
    // (what the eye inside the mask doesn't see of its own body: the jacket, the rear sleeve, the top of its own sleeve)
    const part = pc.kind === 'jacket' ? PART.torso : pc.kind === 'sleeveR' ? PART.rearArm : row < 0.4 ? PART.upperSleeve : PART.always;
    m.vert(p, norm(N[i]), [0.95, D.seam[i], TONE.jacket], MAT.fabric, [D.uv[i * 2], D.uv[i * 2 + 1]], w, [0, 0, 0, part]);
  }
  for (const t of D.tris) index.push(base + t);
  const pieces: ClothPiece[] = m.pieces.filter((p) => p.kind === 'breeches');
  for (const p of D.pieces) pieces.push({ kind: p.kind, base: base + p.base, R: p.rows, J: p.cols, closed: false, joint: p.kind === 'jacket' ? undefined : 0.55,
    flat: Array.from({ length: p.rows * p.cols }, (_, k) => [D.flat[(p.base + k) * 2], D.flat[(p.base + k) * 2 + 1]] as [number, number]) });
  const seams = D.seams.map(([a, b]) => [base + a, base + b] as [number, number]);
  const stitches = (D.stitches ?? []).map(([p, q, q2, t]) => [base + p, base + q, base + q2, t] as [number, number, number, number]);
  return { verts: Float32Array.from(m.v), index: Uint32Array.from(index), bind, count: index.length, pieces, seams, stitches };
}

/** Short-range occlusion in the rest garment. The sampled shell is discarded after the shared mesh is built. */
function bakeContactShade(mesh: SkinMesh) {
  const v = mesh.v, stride = SKIN_STRIDE, cell = 0.012;
  const lo: V = [Infinity, Infinity, Infinity], hi: V = [-Infinity,-Infinity,-Infinity];
  for (let i=0; i<v.length; i+=stride) for(let k=0;k<3;k++) {
    lo[k]=Math.min(lo[k],v[i+k]); hi[k]=Math.max(hi[k],v[i+k]);
  }
  const size = hi.map((x,k)=>Math.ceil((x-lo[k])/cell)+3), [nx,ny,nz]=size;
  const shell = new Uint8Array(nx*ny*nz);
  const key = (x:number,y:number,z:number) => {
    const a=Math.floor((x-lo[0])/cell)+1,b=Math.floor((y-lo[1])/cell)+1,c=Math.floor((z-lo[2])/cell)+1;
    return a<0||a>=nx||b<0||b>=ny||c<0||c>=nz ? -1 : (c*ny+b)*nx+a;
  };
  for(let i=0;i<mesh.i.length;i+=3) {
    const a=mesh.i[i]*stride,b=mesh.i[i+1]*stride,c=mesh.i[i+2]*stride;
    const bx=v[b]-v[a],by=v[b+1]-v[a+1],bz=v[b+2]-v[a+2];
    const cx=v[c]-v[a],cy=v[c+1]-v[a+1],cz=v[c+2]-v[a+2];
    const steps=Math.max(1,Math.ceil(Math.max(Math.hypot(bx,by,bz),Math.hypot(cx,cy,cz),Math.hypot(bx-cx,by-cy,bz-cz))/cell));
    for(let j=0;j<=steps;j++) for(let k=0;k<=steps-j;k++) {
      shell[key(v[a]+(bx*j+cx*k)/steps,v[a+1]+(by*j+cy*k)/steps,v[a+2]+(bz*j+cz*k)/steps)]=1;
    }
  }
  const rays: V[] = Array.from({length:24},(_,i)=>{
    const y=(i+0.5)/12-1, r=Math.sqrt(1-y*y), angle=i*2.399963;
    return [r*Math.cos(angle),y,r*Math.sin(angle)];
  });
  for(let i=0;i<v.length;i+=stride) {
    const normal: V=[v[i+3],v[i+4],v[i+5]];
    const x=v[i]+0.016*normal[0],y=v[i+1]+0.016*normal[1],z=v[i+2]+0.016*normal[2];
    let blocked=0,total=0;
    for (const ray of rays) {
      const weight=dot(ray,normal);
      if(weight<=0) continue;
      total+=weight;
      for(let step=1;step<=8;step++) {
        const d=step*cell;
        if(shell[key(x+ray[0]*d,y+ray[1]*d,z+ray[2]*d)]) {
          blocked+=weight*(1-d/0.14); break;
        }
      }
    }
    const shade=1-0.78*blocked/Math.max(0.01,total);
    v[i+6]*=shade;
    if(v[i+9]!==MAT.fabric) { v[i+7]*=shade; v[i+8]*=shade; }
  }
}

/**
 * Secondary motion: the hem and the sleeves lag the body and swing back, each a damped spring driven by how the body
 * under it accelerates (the pelvis for the hem, each forearm for its sleeve). Kept per fencer.
 */
export class Secondary {
  hem: V = [0, 0, 0]; hemV: V = [0, 0, 0];
  sleeve: [V, V] = [[0, 0, 0], [0, 0, 0]]; sleeveV: [V, V] = [[0, 0, 0], [0, 0, 0]];
  private last: V[] = []; private vel: V[] = []; private t = -1;
  update(f: Fencer, t: number) {
    const pts: V[] = [f.capsules[0].a, lerp(f.elbow, f.hand, 0.5), lerp(f.capsules[8].a, f.capsules[8].b, 0.5)];
    if (t === this.t) return; // A held frame keeps its spring state.
    const dt = t - this.t;
    if (this.t < 0 || dt <= 0 || dt > 0.3 || len(sub(pts[0], this.last[0] ?? pts[0])) > 0.35) {
      this.last = pts; this.vel = pts.map(() => [0, 0, 0] as V); this.t = t;
      this.hem = [0, 0, 0]; this.hemV = [0, 0, 0]; this.sleeve = [[0, 0, 0], [0, 0, 0]]; this.sleeveV = [[0, 0, 0], [0, 0, 0]];
      return;
    }
    const acc = pts.map((p, i) => { const v = scale(sub(p, this.last[i]), 1 / dt), a = scale(sub(v, this.vel[i]), 1 / dt); this.vel[i] = v; return a; });
    this.last = pts; this.t = t;
    const spring = (x: V, v: V, a: V, k: number, cdamp: number, lim: number): [V, V] => {
      const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
      let xx = x, vv = v;
      for (let i = 0; i < n; i++) { const acc2 = sub(sub(scale(xx, -k), scale(vv, cdamp)), scale(a, 1)); vv = madd(vv, acc2, h); xx = madd(xx, vv, h); }
      const l = len(xx); if (l > lim) xx = scale(xx, lim / l);
      return [xx, vv];
    };
    [this.hem, this.hemV] = spring(this.hem, this.hemV, acc[0], 70, 7, 0.06);
    [this.sleeve[0], this.sleeveV[0]] = spring(this.sleeve[0], this.sleeveV[0], acc[1], 110, 9, 0.025);
    [this.sleeve[1], this.sleeveV[1]] = spring(this.sleeve[1], this.sleeveV[1], acc[2], 110, 9, 0.025);
  }
}
/** how far an elbow is bent (0 straight .. 1 folded) */
export const bendOf = (a: V, e: V, h: V) => Math.max(0, Math.min(1, (1 + dot(norm(sub(a, e)), norm(sub(h, e)))) / 1.2));

