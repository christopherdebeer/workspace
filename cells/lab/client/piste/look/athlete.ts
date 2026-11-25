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

/** floats a vertex: place, normal, colour + material, fabric uv, four joints, four weights, (hem, sleeve, gather, part) */
export const SKIN_STRIDE = 26;
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
    frame(c[8].b, rearHandDir, F.r),
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
  v: number[] = []; i: number[] = [];
  get n() { return this.v.length / SKIN_STRIDE; }
  vert(p: V, nr: V, col: C, mat: number, uv: [number, number], w: W, extra: [number, number, number, number], atlas: [number, number] = [-1,-1]): number {
    const ws = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4), tot = ws.reduce((s, x) => s + x[1], 0) || 1;
    while (ws.length < 4) ws.push([0, 0]);
    this.v.push(...p, ...nr, ...col, mat, ...uv, ...ws.map((x) => x[0]), ...ws.map((x) => x[1] / tot), ...extra, ...atlas);
    return this.n - 1;
  }
  tri(a: number, b: number, c: number) { this.i.push(a, b, c); }
}

interface Ring { c: V; u: V; w: V; r: (a: number) => [number, number]; lift?: (a: number) => number }
interface LoftOpt {
  seg: number; col: (i: number, j: number) => C; mat: (i: number, j: number) => number;
  weights: (i: number, j: number, p: V) => W; extra?: (i: number, j: number, p: V) => [number, number, number, number];
  /** fabric: (circumference uv, along uv, distance to a seam) are worked out from the shape */
  panel?: number;
  panelUV?: (i: number, j: number, p: V) => [number, number];
  seams?: number[]; tone?: number; capA?: boolean; capB?: boolean;
  /** an open strip from one angle to another (radians round the ring), instead of all the way round */
  arc?: [number, number];
}
/** a lofted surface through rings (each ring's radius may vary round it: a shaped section), smooth normals, indexed */
function loft(m: SkinMesh, rings: Ring[], o: LoftOpt) {
  // (closed round, or an open strip over an arc of angles: its own vertices, so its edges are clean)
  const S = o.seg, open = !!o.arc, J = S + 1;
  const ang = (j: number) => open ? o.arc![0] + (j / S) * (o.arc![1] - o.arc![0]) : (j / S) * Math.PI * 2;
  const P: V[][] = rings.map((r) => Array.from({ length: J }, (_, j) => {
    const a = ang(j), [ru, rw] = r.r(a);
    const p = add(r.c, add(scale(r.u, Math.cos(a) * ru), scale(r.w, Math.sin(a) * rw)));
    p[1] += r.lift?.(a) ?? 0;
    return p;
  }));
  const R = rings.length;
  const nb = (j: number) => open ? [Math.max(0, j - 1), Math.min(J - 1, j + 1)] : [(j + S - 1) % S, (j + 1) % S];
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
      m.vert(p, nr, col, mat, uv, o.weights(i, j, p), o.extra ? o.extra(i, j, p) : [0, 0, 0, 0], atlas);
    }
  }
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < S; j++) {
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

export interface Athlete { verts: Float32Array; index: Uint32Array; bind: Frame[]; count: number }

export function buildAthlete(): Athlete {
  const f = new Fencer(EPEE, 0, 1);
  f.pose();
  const m = new SkinMesh(), bind = boneFrames(f), c = f.capsules, F = f.frame, up: V = [0, 1, 0];
  const fab = () => MAT.fabric, white = (): C => [1, 1, 1];

  // ── the jacket: one body from the hem to the collar, a sloping shoulder each side ────────────────────────────────
  const pelvis = c[0].a, neck = c[1].b, spine = norm(sub(neck, pelvis));
  const hy = pelvis[1];
  // (heights above the pelvis: section half-widths along the shoulder line (f) and across (r), and the chest's fullness)
  const H: [number, number, number, number][] = [
    [-0.09, 0.17, 0.118, 0], [-0.03, 0.166, 0.116, 0], [0.12, 0.146, 0.106, 0.004], [0.28, 0.168, 0.129, 0.012],
    [0.38, 0.205, 0.131, 0.01], [0.43, 0.211, 0.121, 0.004], [0.47, 0.186, 0.101, 0], [0.5, 0.134, 0.083, 0], [0.53, 0.068, 0.06, 0], [0.555, 0.062, 0.056, 0],
  ];
  // Orient each cross-section along the anatomical landmark it passes through.
  const hipLine = norm(sub(c[9].a,c[11].a));
  const clavicle = norm(add(sub(f.shoulder,c[7].a), scale(F.r,0.085)));
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
    }, lift: a => 0.018 * Math.cos(a + 0.35) * (1 - blend(h, -0.09, 0.08)) + 0.013*Math.cos(a)*Math.exp(-(((h-0.43)/0.095)**2)) };
  });
  loft(m, torsoRings, {
    panel: 0, seg: 48, col: white, mat: fab, tone: TONE.jacket, seams: [0.25, 0.75, 0.62], capB: true,
    weights: (i, j, p) => {
      const h = p[1] - hy, k = blend(h, 0.18, 0.4);
      const w: W = [[B.pelvis, 1 - k], [B.chest, k]];
      // (near each shoulder the jacket takes a share of that arm: reaching, the arm draws it across the chest)
      for (const [sh, bone] of [[f.shoulder, B.upperW], [c[7].a, B.upperR]] as const) {
        const d = len(sub(p, sh)), s = Math.max(0, 1 - d / 0.16) * 0.45;
        if (s > 0) { for (const e of w) e[1] *= 1 - s; w.push([bone, s]); }
      }
      return w;
    },
    extra: (i, j, p) => [Math.max(0, 1 - (p[1] - hy + 0.09) / 0.14), 0, 0, PART.torso],
  });

  // ── sleeves: the cap out of the shoulder, full through the upper arm, the elbow, the forearm to the cuff ──────────
  const sleeve = (pts: V[], up1: number, fore: number, partTop: number, armSign: number) => {
    const pa = path(pts), sE = pa.joints[0], N = 55;
    const rings: Ring[] = [];
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1), { p } = pa.at(s);
      const tangent = norm(sub(pa.at(Math.min(1, s+0.065)).p, pa.at(Math.max(0, s-0.065)).p));
      const [u, w] = axesAbout(tangent, F.u);
      const r = prof([[0, 0.055], [0.07, 0.082], [0.16, 0.077], [sE - 0.06, 0.06], [sE, 0.057], [sE + 0.1, 0.055], [0.85, 0.046], [1, 0.041]], s);
      rings.push({ c: p, u, w, r: a => {
        const lift = Math.cos(a + armSign * 0.6);
        const inside = 0.44 + 0.38 * lift;
        const elbow = pleat(s, sE - 0.09 + 0.055 * lift, 0.031) * 0.012
          + pleat(s, sE + 0.04 - 0.045 * Math.sin(a), 0.025) * 0.010;
        const cuff = pleat(s, 0.86 + 0.045 * lift, 0.026) * 0.006;
        const dr = elbow * inside + cuff + 0.004 * Math.cos(3*a + 2*s) * Math.sin(Math.PI*s);
        return [r + dr, r * 0.93 + dr];
      } });
    }
    // the inside of the elbow (toward the chord from shoulder to wrist) gathers as it bends
    const E = pts[1], inner = norm(sub(lerp(pts[0], pts[2], 0.5), E));
    loft(m, rings, {
      panel: 1, seg: 32, col: white, mat: fab, tone: TONE.jacket, seams: [0.5],
      weights: (i) => { const s = i / (N - 1), k = blend(s, sE - 0.07, sE + 0.07); const yoke = 0.40 * (1 - smooth(blend(s, 0, 0.16))); return [[B.chest,yoke], [up1, 1 - k - yoke], [fore, k]]; },
      extra: (i, j, p) => {
        const s = i / (N - 1), near = Math.max(0, 1 - Math.abs(s - sE) / 0.13), face = Math.max(0, dot(norm(sub(p, rings[i].c)), inner));
        return [0, armSign * Math.min(1, s * 1.4) * 0.8, armSign * near * face, armSign < 0 || s < sE - 0.14 ? partTop : PART.always];
      },
    });
  };
  const wrist = madd(f.hand, norm(sub(f.elbow, f.hand)), 0.092);
  sleeve([madd(madd(lerp(f.shoulder, c[7].a, 0.16), up, 0.004), F.r, -0.02), f.elbow, wrist], B.upperW, B.foreW, PART.upperSleeve, 1);
  sleeve([madd(madd(lerp(c[7].a, f.shoulder, 0.16), up, 0.0), F.r, 0.012), c[7].b, madd(c[8].b, norm(sub(c[8].a, c[8].b)), 0.035)], B.upperR, B.foreR, PART.rearArm, -1);

  // Breeches share a seat between both hip sockets. The lower edge rises over the outside of each thigh.
  const seat: Ring[] = Array.from({length: 20}, (_,i) => {
    const t=i/19;
    const width=prof([[0,0.101],[0.28,0.166],[0.58,0.186],[1,0.153]],t);
    const depth=prof([[0,0.071],[0.35,0.125],[0.62,0.139],[1,0.113]],t);
    return {c:madd(pelvis,up,-0.132+0.192*t),u:hipLine,w:norm(cross(hipLine,up)),
      lift:a=>0.045*Math.cos(a)**2*(1-t),
      r:a=>[width,depth*(1+0.07*Math.sin(a))]};
  });
  loft(m,seat,{panel:2,seg:40,col:white,mat:fab,tone:TONE.breeches,seams:[],capA:true,
    weights:(i,j)=>{const front=(1+Math.cos(j/40*2*Math.PI))*0.5;
      const thigh=0.45*(1-i/19);return [[B.pelvis,1-thigh],[B.thighF,front*thigh],[B.thighB,(1-front)*thigh]];},
    extra:()=>[0,0,0,PART.torso]});

  // ── legs: breeches full to below the knee, the band, the knee and calf under the sock, the ankle ───────────────────
  const leg = (th: number, sh: number, pole: V) => {
    const hip = c[th].a, knee = c[th].b, ankle = madd(c[sh].b, up, 0.035);
    const pa = path([madd(hip, up, 0.07), knee, ankle]), sK = pa.joints[0], N = 48, band = sK + 0.07;
    const rings: Ring[] = [], mats: number[] = [], tones: number[] = [];
    const add1 = (s: number, tone: number) => {
      const { p } = pa.at(s), tangent = norm(sub(pa.at(Math.min(1, s+0.045)).p, pa.at(Math.max(0, s-0.045)).p));
      const [u, w] = axesAbout(tangent, pole);
      // (the kneecap at the front of the knee; the calf full at the back; breeches loose above the band)
      const kneeK = Math.max(0, 1 - Math.abs(s - sK) / 0.06), calfK = Math.max(0, 1 - Math.abs(s - (sK + 0.2)) / 0.14);
      const r = tone === TONE.breeches ? prof([[0, 0.118], [0.3, 0.108], [sK - 0.05, 0.084], [band, 0.068]], s) : prof([[band, 0.063], [band + 0.04, 0.057], [sK + 0.2, 0.056], [0.85, 0.042], [1, 0.039]], s);
      rings.push({ c: p, u, w, r: (a) => { const ca = Math.cos(a);
        const dr = tone === TONE.breeches ? (0.010 * pleat(s, sK-0.08+0.052*ca, 0.022)
          + 0.007 * pleat(s, sK-0.015-0.029*Math.sin(a), 0.017)
          + 0.008 * pleat(s, 0.16+0.09*ca, 0.032)) : 0;
        return [r * (1 + (ca > 0 ? 0.18 * kneeK * ca : 0.22 * calfK * -ca)) + dr, r * 0.94 + dr]; } });
      mats.push(MAT.fabric); tones.push(tone);
    };
    for (let i = 0; i < N; i++) { const s = (i / (N - 1)) * band; add1(s, TONE.breeches); }
    const leg1 = rings.splice(0), tone1 = tones.splice(0); mats.splice(0);
    const wts = (s: number): W => { const k = blend(s, sK - 0.06, sK + 0.06), hipK = 1 - blend(s, 0, 0.14); return [[th === 9 ? B.thighF : B.thighB, (1 - k) * (1 - hipK * 0.5)], [sh === 10 ? B.shinF : B.shinB, k], [B.pelvis, (1 - k) * hipK * 0.5]]; };
    loft(m, leg1, { panel: 2, seg: 32, col: white, mat: fab, tone: tone1[0], seams: [0.25], capA: true, weights: (i) => wts((i / (N - 1)) * band) });
    // the band: a narrow cuff, a little proud
    const bandRings: Ring[] = [band - 0.012, band + 0.012].map((s) => { const { p, d } = pa.at(s), [u, w] = axesAbout(d, pole); return { c: p, u, w, r: () => [0.07, 0.067] }; });
    loft(m, bandRings, { seg: 14, col: white, mat: fab, tone: TONE.breeches, seams: [0.25], weights: () => wts(band) });
    for (let i = 0; i < 14; i++) { const s = band + (1 - band) * (i / 13); add1(s, TONE.sock); }
    const leg2 = rings.splice(0);
    loft(m, leg2, { seg: 14, col: white, mat: fab, tone: TONE.sock, capB: true, weights: (i) => { const s = band + (1 - band) * (i / 13); return wts(s); } });
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
    r: a => boxR(a, 0.151*s, (0.109 + 0.006*Math.cos(a))*s, 2.35),
  });
  loft(m, Array.from({length: 19}, (_, i) => faceRing(0.008 + 0.992*i/18)), {
    panel: 4, panelUV: (_i,_j,p) => [0.5 + dot(sub(p,hc),side)/0.23, 0.5 - (p[1]-hc[1]-0.012)/0.31],
    seg: 72, col: () => COL.mesh, mat: () => MAT.maskFront, weights: () => hw, extra: hx, capA: true,
  });
  loft(m, [faceRing(0.948, 0.001), faceRing(0.98, 0.0035), faceRing(1, 0.003), faceRing(1.025, -0.0005), faceRing(1.03, -0.008)], {
    seg: 72, col: () => [0.26, 0.25, 0.22], mat: () => MAT.rubber, weights: () => hw, extra: hx,
  });
  // the bib: wrapped round the neck from under the jaw, flaring down so its lower edge lies on the chest
  const bibRings: Ring[] = [];
  const BN = 22, chestY = neck[1] - 0.058;
  for (let i = 0; i < BN; i++) {
    const t = i / (BN - 1), y = lerp([0, hc[1] - 0.1, 0], [0, chestY, 0], t)[1];
    const ctr: V = [lerp(hc, neck, t)[0] + 0.012 * t, y, lerp(hc, neck, t)[2]];
    const rf = prof([[0, 0.074], [0.5, 0.10], [1, 0.145]], t), rs = prof([[0, 0.081], [0.5, 0.091], [1, 0.103]], t);
    bibRings.push({ c: ctr, u: fwd, w: side, lift: a => t * (0.032 - 0.04*Math.cos(a) + 0.009*Math.sin(2*a)), r: a => {
      const quilt = 0.0015*pleat(t, 0.78 + 0.08*Math.sin(a), 0.06);
      return [(Math.cos(a) > 0 ? rf : rf*0.7) + quilt, rs + quilt];
    } });
  }
  loft(m, bibRings, {
    panel: 5, seg: 40, col: white, mat: fab, tone: TONE.jacket, seams: [],
    weights: (i) => { const t = i / (BN - 1); return [[B.head, 0.6 * (1 - t)], [B.chest, 0.4 + 0.6 * t]]; },
    extra: () => [0, 0, 0, PART.head],
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
  return { verts: Float32Array.from(m.v), index: Uint32Array.from(m.i), bind, count: m.i.length };
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
