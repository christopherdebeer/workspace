/**
 * The kit as cloth, simulated on the GPU (`?cloth=sim`): the jacket, both sleeves and the breeches' legs.
 *
 * The garments are the athlete's own lofted pieces (athlete.ts). Each is a grid of rings round the body, about a
 * centimetre apart, so each of its points has neighbours along and round it. Their lengths at rest are the drafted
 * pattern's (tailor.ts): distances on flat panels cut at the seams, not on the worn shape. The
 * cloth as cut. The cloth is never part of the bout: the blade meets the body's capsules. So the cloth runs on the GPU,
 * in WebGL 2's own render passes, and nothing comes back to the CPU. The renderer's skinning shader reads the cloth's
 * points straight from the texture it's simulated in.
 *
 * Position-based dynamics in its "small steps" form (many substeps a frame, a pass or two each), solved Jacobi-style
 * (each point works out its own correction from its neighbours, all at once: what a fragment shader does):
 * - stretch and shear: each point keeps its distance to its neighbours along, round and diagonally;
 * - bending: and to its neighbours two along and two round. Thick, dense cloth (a fencing jacket is heavy, stiff
 *   cotton, or aramid) bends in broad folds, not fine ones;
 * - the body: each point is carried by the skin, as it would be if the cloth were rigid (its anchor), and kept within
 *   a distance of it: the tailored ease, tight at the collar, the shoulders, the cuff under the glove and the waist,
 *   generous at the elbow, the chest and the knee. A backstop stops it passing inside the skin. Both are hard and
 *   local, so a lunge's accelerations can't pull the cloth through the body or leave it behind;
 * - inertia, gravity, and a drag toward the body's own motion (air, and the friction of cloth lying on a body).
 *
 * Where the body bends, the skin under the cloth shortens on the inside of the joint. The cloth's lengths don't, and
 * the backstop won't let it go inside, so it buckles out, within its ease: the folds at the inside of an elbow or
 * behind a knee are found, not drawn.
 *
 * Visual only, and not bit-for-bit the same on every GPU; the bout stays deterministic without it. Without float
 * render targets (EXT_color_buffer_float) there's no cloth and the figure is drawn as before.
 */
import type { Athlete, ClothPiece } from './athlete';
import { SKIN_STRIDE } from './athlete';
import { tailor, OFFSETS } from './tailor';

/**
 * The kit's fabric, as a textile is described (Fab's terms: client/fab/fabric.ts): its weight (g/m²), its bending length
 * (how far a strip overhangs a table's edge before it droops to 41.5°: Peirce's cantilever, the measure of drape: it
 * holds the weight too, a heavier cloth of the same stiffness draping softer), and its thickness (mm). A fencing jacket's
 * cotton and polyester twill, 350 N, weighs about 1 kg (armstreet, histfenc, faitsdarmes): about 380 g/m²; drafted on
 * its pattern its bending length is a heavy canvas's but softened by wear and washing, 2.2 cm; about 1.1 mm thick.
 * The solver's dials are worked out from it below (calibrated to the dials it had when they were set by eye, which
 * matched a lighter, stiffer cloth: 220 g/m², 3 cm, 0.8 mm):
 * - bending: as the cube of the bending length (the flexural rigidity per weight is its cube);
 * - air: drag against the cloth's motion as the inverse of its weight (a heavier cloth carries its swing further and
 *   settles slower);
 * - thickness: broader folds, and held further off the skin (two thicknesses and a little).
 */
export const FABRIC = { gsm: 380, bendingLength: 0.022, thickness: 0.0011 };
const FAB0 = { gsm: 220, bendingLength: 0.03, thickness: 0.0008 };
/** the cloth's dials: substep length (s), passes a substep, stiffnesses (0..1 a pass), relaxation, damping, and how
 * much of the body's motion the cloth is dragged toward each substep */
export const CLOTH = { step: 1 / 480, maxSteps: 10, passes: 3, stretch: 1, shear: 0.6, bend: 0.5 * (FABRIC.bendingLength / FAB0.bendingLength) ** 3, omega: 1.4, damp: 0.995, drag: 0.04 * FAB0.gsm / FABRIC.gsm,
  /** thickness: how hard each pass pulls a point's curvature (its offset from its four neighbours' middle) toward the
   * skin's under it (a scale on each piece's own, `thickness`). Thick cloth can't crease in short waves; it folds in
   * broad ones */
  thick: FABRIC.thickness / FAB0.thickness,
  /** how hard a point where the cloth has folded over itself is pulled back toward a smooth sheet, a pass */
  unfold: 0.7 };

/** wear another fabric (`fabric=old`: the lighter, stiffer cloth the dials were first set by eye for), before the cloth starts */
export function useFabric(f: typeof FABRIC) {
  Object.assign(FABRIC, f);
  CLOTH.bend = 0.5 * (FABRIC.bendingLength / FAB0.bendingLength) ** 3; CLOTH.drag = 0.04 * FAB0.gsm / FABRIC.gsm; CLOTH.thick = FABRIC.thickness / FAB0.thickness;
}
export const OLD_FABRIC = { ...FAB0 };

/** the ease: how far each point may stand off its place on the skin (m), along each kind of piece by row fraction */
function ease(p: ClothPiece, row: number): number {
  const k = (keys: [number, number][]) => {
    for (let i = 0; i < keys.length - 1; i++) if (row <= keys[i + 1][0]) { const t = (row - keys[i][0]) / (keys[i + 1][0] - keys[i][0]); return keys[i][1] + (keys[i + 1][1] - keys[i][1]) * t * t * (3 - 2 * t); }
    return keys[keys.length - 1][1];
  };
  const j = p.joint ?? 0.5;
  switch (p.kind) {
    // (hem to collar: the crotch strap holds the hem; the shoulders carry it; the collar is fastened)
    case 'jacket': return k([[0, 0.016], [0.2, 0.014], [0.55, 0.014], [0.74, 0.008], [0.86, 0.003], [0.94, 0]]);
    // (shoulder to wrist: set into the armhole; slack through the elbow; held in from where the glove's gauntlet goes over it)
    case 'sleeveW': case 'sleeveR': return k([[0, 0], [0.07, 0.003], [Math.max(0.1, j - 0.2), 0.012], [j, 0.024], [Math.min(0.72, j + 0.14), 0.012], [0.78, 0.005], [0.82, 0.0015], [0.85, 0]]);
    // (waist to the band below the knee: the waist and the band fastened)
    case 'breeches': return k([[0, 0], [0.1, 0.004], [0.5, 0.012], [j, 0.02], [Math.min(0.94, j + 0.12), 0.008], [0.97, 0]]);
  }
}

/** how thick each piece's cloth is (the pull a pass toward the skin's curvature): the jacket's body is the stiffest
 * (layered, and the 800 N cloth); a sleeve bends at the elbow; the breeches between */
function thickness(p: ClothPiece): number {
  return p.kind === 'jacket' ? 0.38 : p.kind === 'breeches' ? 0.3 : 0.2;
}

const QUAD_VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0); gl_Position = vec4(p, 0.0, 1.0); }`;
const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform int W, N;
ivec2 tc(int i){ return ivec2(i % W, i / W); }
int me(){ ivec2 f = ivec2(gl_FragCoord.xy); return f.y * W + f.x; }
`;
/** the anchors: each point's rest place and normal carried by the skin */
const ANCHOR_FS = HEAD + `
uniform sampler2D Bind, BindN, Joints, Weights; uniform mat4 bones[15];
layout(location=0) out vec4 oP; layout(location=1) out vec4 oN;
void main(){
  int i = me(); if (i >= N) { oP = vec4(0); oN = vec4(0); return; }
  vec4 b = texelFetch(Bind, tc(i), 0), jt = texelFetch(Joints, tc(i), 0), wt = texelFetch(Weights, tc(i), 0);
  mat4 M = bones[int(jt.x)] * wt.x + bones[int(jt.y)] * wt.y + bones[int(jt.z)] * wt.z + bones[int(jt.w)] * wt.w;
  oP = vec4((M * vec4(b.xyz, 1.0)).xyz, b.w);
  oN = vec4(normalize(mat3(M) * texelFetch(BindN, tc(i), 0).xyz), 0.0);
}`;
/** start (or start again) where the skin carries it, at rest */
const INIT_FS = HEAD + `
uniform sampler2D A;
layout(location=0) out vec4 oX; layout(location=1) out vec4 oP;
void main(){ int i = me(); vec4 a = i < N ? texelFetch(A, tc(i), 0) : vec4(0); oX = vec4(a.xyz, 1.0); oP = oX; }`;
/** a substep's prediction: where inertia, gravity and the drag of the body take each point */
const PREDICT_FS = HEAD + `
uniform sampler2D X, P, A0, A1; uniform float h, ratio, s0, s1, damp, drag;
layout(location=0) out vec4 oX; layout(location=1) out vec4 oP;
void main(){
  int i = me(); if (i >= N) { oX = vec4(0); oP = vec4(0); return; }
  vec3 x = texelFetch(X, tc(i), 0).xyz, p = texelFetch(P, tc(i), 0).xyz;
  vec3 a0 = texelFetch(A0, tc(i), 0).xyz, a1 = texelFetch(A1, tc(i), 0).xyz;
  vec3 v = (x - p) * ratio, va = (a1 - a0) * (s1 - s0);
  v = mix(v, va, drag) * damp;
  oX = vec4(x + v + vec3(0.0, -9.81, 0.0) * h * h, 1.0); oP = vec4(x, 1.0);
}`;
/** a pass of the constraints, each point from its neighbours (Jacobi), then the body's: ease and backstop. Written
 * out straight, with no small arrays indexed in a loop: on phone GPUs those spill out of registers and cost several
 * times the whole pass (the first version ran at an eighth of this speed on an iPhone) */
const SOLVE_FS = HEAD + `
uniform sampler2D X, MetaA, MetaB, Rest0, Rest1, Rest2, A0, A1, N0, N1, Seam, SeamB; uniform float s, kStretch, kShear, kBend, omega, kThick, kUnfold;
/** the arms (upper and fore, each side: a, b, radius), for the jacket's body to lie against */
uniform vec4 armA[4], armB[4];
const float LAYER = ${(2 * FABRIC.thickness + 0.009).toFixed(4)};
out vec4 o;
int r, c, R, S, off; bool open; vec3 x, acc; float n;
/** (a closed piece wraps round; an open one (a flat pattern piece) has edges) */
bool okc(int cc){ return !open || (cc >= 0 && cc < S); }
int col(int cc){ return open ? clamp(cc, 0, S - 1) : (cc + S) % S; }
vec3 at(int rr, int cc){ return texelFetch(X, tc(off + rr * S + col(cc)), 0).xyz; }
vec3 anchorAt(int rr, int cc){ ivec2 t = tc(off + rr * S + col(cc)); return mix(texelFetch(A0, t, 0).xyz, texelFetch(A1, t, 0).xyz, s); }
void pull(vec3 xj, float L, float k){ if (L <= 0.0) return; vec3 d = x - xj; float l = length(d); if (l < 1e-7) return; acc -= 0.5 * k * (l - L) * d / l; n += 1.0; }
/** (cloth on cloth: the nearest of the under layer's points, among one and its four neighbours on its grid) */
vec3 ubest; int ubi; float ubd;
void ucand(int k, bool ok){ if (!ok) return; vec3 q = texelFetch(X, tc(k), 0).xyz; float d = dot(x - q, x - q); if (d < ubd) { ubd = d; ubest = q; ubi = k; } }
void rel(int dr, int dc, float L, float k){ int rr = r + dr; if (rr < 0 || rr >= R || L <= 0.0 || !okc(c + dc)) return; pull(at(rr, c + dc), L, k); }
void main(){
  int i = me(); if (i >= N) { o = vec4(0); return; }
  vec4 ma = texelFetch(MetaA, tc(i), 0), mb = texelFetch(MetaB, tc(i), 0);
  r = int(ma.x); c = int(ma.y); R = int(ma.z); open = ma.w < 0.0; S = int(abs(ma.w)); off = int(mb.x);
  x = texelFetch(X, tc(i), 0).xyz; acc = vec3(0.0); n = 0.0;
  // (the rest lengths, the pattern's: along up and down, round right and left; the diagonals; two along, two round)
  vec4 q0 = texelFetch(Rest0, tc(i), 0), q1 = texelFetch(Rest1, tc(i), 0), q2 = texelFetch(Rest2, tc(i), 0);
  bool up = r + 1 < R, down = r > 0;
  vec3 xU = at(up ? r + 1 : r, c), xD = at(down ? r - 1 : r, c), xR = at(r, c + 1), xL = at(r, c - 1);
  if (up) pull(xU, q0.x, kStretch);
  if (down) pull(xD, q0.y, kStretch);
  if (okc(c + 1)) pull(xR, q0.z, kStretch);
  if (okc(c - 1)) pull(xL, q0.w, kStretch);
  rel(1, 1, q1.x, kShear); rel(1, -1, q1.y, kShear); rel(-1, 1, q1.z, kShear); rel(-1, -1, q1.w, kShear);
  rel(2, 0, q2.x, kBend); rel(-2, 0, q2.y, kBend); rel(0, 2, q2.z, kBend); rel(0, -2, q2.w, kBend);
  x += omega * acc / max(n, 1.0);
  // sewn: a point on a seam drawn half way to where it's sewn on the other piece's edge (between two of its points);
  // and the points it's sewn to drawn toward the points sewn to them, by how much of each they hold
  vec4 sw = texelFetch(Seam, tc(i), 0);
  if (sw.x >= 0.0) x += 0.5 * (mix(texelFetch(X, tc(int(sw.x)), 0).xyz, texelFetch(X, tc(int(sw.y)), 0).xyz, sw.z) - x);
  // (each follower packed in one channel: its texel, and its share as the fraction)
  vec4 b = texelFetch(SeamB, tc(i), 0);
  if (b.x >= 0.0) {
    vec3 d = vec3(0.0); float w = 0.0, wk;
    wk = fract(b.x); d += wk * (texelFetch(X, tc(int(b.x)), 0).xyz - x); w += wk;
    if (b.y >= 0.0) { wk = fract(b.y); d += wk * (texelFetch(X, tc(int(b.y)), 0).xyz - x); w += wk; }
    if (b.z >= 0.0) { wk = fract(b.z); d += wk * (texelFetch(X, tc(int(b.z)), 0).xyz - x); w += wk; }
    if (b.w >= 0.0) { wk = fract(b.w); d += wk * (texelFetch(X, tc(int(b.w)), 0).xyz - x); w += wk; }
    x += 0.5 * d / max(1.0, w);
  }
  vec3 a = mix(texelFetch(A0, tc(i), 0).xyz, texelFetch(A1, tc(i), 0).xyz, s);
  if (up && down && okc(c + 1) && okc(c - 1)) {
    vec3 aU = anchorAt(r + 1, c), aD = anchorAt(r - 1, c), aR = anchorAt(r, c + 1), aL = anchorAt(r, c - 1);
    // thickness: the point's offset from its neighbours' middle eased toward the skin's offset there
    vec3 sheet = 0.25 * (xU + xD + xR + xL) + a - 0.25 * (aU + aD + aR + aL);
    x += min(1.0, kThick * abs(mb.y)) * (sheet - x);
    // folded over: where the cloth's surface here has turned inside out against the skin's (its grid's normal against
    // the skin grid's), it's crossed itself; pull it back toward a smooth sheet
    vec3 m = cross(xU - xD, xR - xL), mA = cross(aU - aD, aR - aL);
    float agree = dot(m, mA) / max(1e-12, length(m) * length(mA));
    if (agree < 0.3) x = mix(x, sheet, kUnfold * clamp((0.3 - agree) / 0.6, 0.0, 1.0));
  }
  // cloth on cloth: the jacket over the breeches. Its point kept outside the breeches' surface where they are now (the
  // nearest of the point found under it at rest and that point's four neighbours, the plane through it facing the way
  // the body does there), two thicknesses and a little off: the outer layer gives, the inner one's held by the body
  if (sw.w >= 0.0) {
    int u = int(sw.w); vec4 um = texelFetch(MetaA, tc(u), 0);
    int ur = int(um.x), uc = int(um.y), uR = int(um.z), uS = int(abs(um.w));
    ubest = texelFetch(X, tc(u), 0).xyz; ubi = u; ubd = dot(x - ubest, x - ubest);
    ucand(u + 1, uc + 1 < uS); ucand(u - 1, uc > 0); ucand(u + uS, ur + 1 < uR); ucand(u - uS, ur > 0);
    vec3 un = normalize(mix(texelFetch(N0, tc(ubi), 0).xyz, texelFetch(N1, tc(ubi), 0).xyz, s));
    float dn = dot(x - ubest, un);
    if (ubd < 0.0036 && dn < LAYER) x += (LAYER - dn) * un;
  }
  // the body: within the ease of its place on the skin, and never inside it
  vec3 nn = normalize(mix(texelFetch(N0, tc(i), 0).xyz, texelFetch(N1, tc(i), 0).xyz, s));
  float slack = mb.w;
  // the jacket's body lies against the arms (not where an arm and the body meet: the armpit, where the skin under it
  // is already inside the arm)
  if (mb.y > 0.0 && slack > 0.004) for (int k = 0; k < 4; k++) {
    vec3 A = armA[k].xyz, ab = armB[k].xyz - A; float rq = armA[k].w + 0.008, ab2 = max(1e-9, dot(ab, ab));
    vec3 ca = A + ab * clamp(dot(a - A, ab) / ab2, 0.0, 1.0);
    if (length(a - ca) < rq) continue;
    vec3 cx = A + ab * clamp(dot(x - A, ab) / ab2, 0.0, 1.0), dq = x - cx; float lq = length(dq);
    if (lq < rq && lq > 1e-6) x = cx + dq * (rq / lq);
  }
  if (slack < 0.0005) x = a;
  else {
    vec3 e = x - a; float dn = dot(e, nn);
    if (dn < -mb.z) { x += (-mb.z - dn) * nn; e = x - a; }
    float el = length(e); if (el > slack) x = a + e * (slack / el);
  }
  o = vec4(x, 1.0);
}`;

/** what the skinning shaders need to draw the cloth's points in place of the skinned ones */
const DRAW_GLSL = `
uniform highp sampler2D clothX, clothSeam, clothRest; uniform int clothOn, clothW; uniform ivec4 clothPiece[16];
vec3 clothTx(int i){ return texelFetch(clothX, ivec2(i % clothW, i / clothW), 0).xyz; }
vec3 clothPt(int off, int S, int r, int c){ return clothTx(off + r * S + c); }
void clothAt(inout vec3 q, inout vec3 nn){
  if (clothOn == 0) return;
  for (int k = 0; k < 16; k++) {
    // (a piece: its first vertex, rings, columns (negative: an open, flat piece, no column repeated), first texel)
    ivec4 P = clothPiece[k]; int J = abs(P.z), rel = gl_VertexID - P.x; bool open = P.z < 0;
    if (P.y == 0 || rel < 0 || rel >= P.y * J) continue;
    int S = open ? J : J - 1, r = rel / J, c = rel % J; if (!open && c == S) c = 0;
    q = clothPt(P.w, S, r, c);
    // (welded: a point sewn to another piece is drawn on the edge it's sewn to, so a seam never opens)
    int ti = P.w + r * S + c; vec4 sw = texelFetch(clothSeam, ivec2(ti % clothW, ti / clothW), 0);
    if (sw.x >= 0.0) q = mix(clothTx(int(sw.x)), clothTx(int(sw.y)), sw.z);
    int cR = open ? min(c + 1, S - 1) : (c + 1) % S, cL = open ? max(c - 1, 0) : (c + S - 1) % S;
    vec3 du = clothPt(P.w, S, r, cR) - clothPt(P.w, S, r, cL);
    vec3 dv = clothPt(P.w, S, min(r + 1, P.y - 1), c) - clothPt(P.w, S, max(r - 1, 0), c);
    // (how stretched the cloth is here, across and along: its lengths now against the pattern's (its rest lengths:
    // up, down, right, left), for the creases (shaders.ts): bunched, they deepen; taut, they flatten)
    vec4 rl = texelFetch(clothRest, ivec2(ti % clothW, ti / clothW), 0);
    clothStrain = vec2(length(du) / max(1e-5, rl.z + rl.w), length(dv) / max(1e-5, rl.x + rl.y));
    vec3 m = cross(dv, du);
    if (dot(m, m) > 1e-14) { m = normalize(m); nn = dot(m, nn) < 0.0 ? -m : m; }
    return;
  }
}
`;
/** the renderer's skinning shaders with the cloth spliced in (throws if they've changed shape: then no cloth) */
export function withCloth(vs: string, shadow: boolean): string {
  const main = vs.indexOf('void main(){');
  if (main < 0) throw new Error('cloth: no main');
  let out = vs.slice(0, main) + DRAW_GLSL + vs.slice(main);
  const at = shadow ? 'gl_Position = lvp * vec4(dressedPosition(M,load,nn),1.0);' : 'vec3 q = dressedPosition(M,load,nn);';
  if (!out.includes(at)) throw new Error('cloth: skinning changed');
  out = out.replace(at, shadow ? 'vec3 q = dressedPosition(M,load,nn); clothAt(q, nn); gl_Position = lvp * vec4(q, 1.0);' : at + '\n  clothAt(q, nn);');
  return out;
}

interface Target { tex: WebGLTexture[]; fb: WebGLFramebuffer }
/** one fencer's cloth: its anchors (last frame's and this one's), and its points now and a substep ago */
interface State { a: Target[]; x: WebGLTexture; p: WebGLTexture; spare: WebGLTexture[]; t: number; h: number; last: Float32Array | null }

export class GpuCloth {
  readonly W = 256; readonly N: number; readonly H: number;
  /** each piece's (first vertex, rings, columns, first texel), for the drawing shaders */
  readonly pieces: Int32Array;
  private progs: Record<string, WebGLProgram> = {};
  private loc: Record<string, Record<string, WebGLUniformLocation | null>> = {};
  private stat: Record<string, WebGLTexture> = {};
  private states = new Map<object, State>();
  private vao: WebGLVertexArrayObject;
  private fbs = new Map<string, WebGLFramebuffer>();
  /** ms of CPU spent issuing last frame's cloth passes (the GPU's own time isn't visible from here; iOS rounds this to
   * whole ms), and how many render passes the cloth took last frame, for both fencers */
  issueMs = 0; passes = 0; private passFrame = 0; private passCount = 0;
  /** a stress dial (`?clothx=4`): this many times the substeps, to find where a phone's frame rate gives */
  stress = 1;

  /** why the last attempt to start the cloth failed (for the readout), or null */
  static failure: string | null = null;
  static create(gl: WebGL2RenderingContext, athlete: Athlete): GpuCloth | null {
    if (!gl.getExtension('EXT_color_buffer_float')) { GpuCloth.failure = 'no float render targets'; return null; }
    if (!athlete.pieces?.length) { GpuCloth.failure = 'no garment pieces'; return null; }
    const units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
    if (units < 16) { GpuCloth.failure = `only ${units} texture units`; return null; }
    try { return new GpuCloth(gl, athlete); } catch (e) { GpuCloth.failure = String((e as Error)?.message ?? e).slice(0, 160); console.warn(e); return null; }
  }

  private constructor(readonly gl: WebGL2RenderingContext, athlete: Athlete) {
    const ps = athlete.pieces.slice(0, 16), cols = (p: ClothPiece) => (p.closed ? p.J - 1 : p.J);
    this.N = ps.reduce((s, p) => s + p.R * cols(p), 0);
    this.H = Math.ceil(this.N / this.W);
    const n = this.W * this.H, bind = new Float32Array(n * 4), bindN = new Float32Array(n * 4), jt = new Float32Array(n * 4), wt = new Float32Array(n * 4);
    const metaA = new Float32Array(n * 4), metaB = new Float32Array(n * 4), V = athlete.verts;
    this.pieces = new Int32Array(64);
    let off = 0;
    ps.forEach((p, k) => {
      const S = cols(p), pins = new Set(p.pins ?? []);
      this.pieces.set([p.base, p.R, p.closed ? p.J : -p.J, off], k * 4);
      for (let r = 0; r < p.R; r++) for (let c = 0; c < S; c++) {
        const v = (p.base + r * p.J + c) * SKIN_STRIDE, t = (off + r * S + c) * 4;
        const pinned = pins.has(p.base + r * p.J + c);
        // (on the body, where the athlete has one under it: the cloth may come in until it meets the skin, not just a couple of
        // millimetres in from where it was settled, and where it stands off the body it has room to fall toward it. The
        // normal it's held off by is the body's. What's fastened or pinned stays as it is)
        const vi = p.base + r * p.J + c, gap = athlete.bodyGap, e0 = pinned ? 0 : ease(p, r / (p.R - 1));
        const onBody = !!gap && e0 > 0.002 && gap[vi * 4 + 3] > 2 * FABRIC.thickness + 0.001, d = onBody ? gap![vi * 4 + 3] : 0;
        const lie = 2 * FABRIC.thickness + 0.001, slack = onBody ? e0 + Math.min(0.03, 0.6 * (d - lie)) : e0, inset = onBody ? d - lie : 0.002;
        bind.set([V[v], V[v + 1], V[v + 2], slack], t);
        if (onBody) bindN.set([gap![vi * 4], gap![vi * 4 + 1], gap![vi * 4 + 2], thickness(p)], t);
        else bindN.set([V[v + 3], V[v + 4], V[v + 5], thickness(p)], t);
        jt.set(V.subarray(v + 12, v + 16), t); wt.set(V.subarray(v + 16, v + 20), t);
        metaA.set([r, c, p.R, p.closed ? S : -S], t); // (MetaB: first texel; thickness, negative for a piece the arms don't press (the sleeves themselves); backstop
        // inset; ease. Packed so the solver reads ten textures: phones allow sixteen, and the renderer keeps three)
        metaB.set([off, (p.kind.startsWith('sleeve') ? -1 : 1) * thickness(p), inset, slack], t);
      }
      off += p.R * S;
    });
    // the rest lengths: the pattern drafted to this athlete, four neighbours to a texture
    // (a closed piece's drafted by tailor.ts from its loft; an open one is a pattern piece already: its paper's lengths)
    const rests = [0, 1, 2].map(() => new Float32Array(n * 4));
    const closed = ps.filter((p) => p.closed), draft = tailor(V, closed);
    let offAll = 0, offClosed = 0;
    for (const p of ps) {
      const S = cols(p);
      for (let r = 0; r < p.R; r++) for (let c = 0; c < S; c++) {
        const i = offAll + r * S + c;
        for (let k = 0; k < 12; k++) {
          let L = 0;
          if (p.closed) L = draft.rest[(offClosed + r * S + c) * 12 + k];
          else { const [dr, dc] = OFFSETS[k], rr = r + dr, cc = c + dc; if (rr >= 0 && rr < p.R && cc >= 0 && cc < S && p.flat) { const a = p.flat[r * S + c], b = p.flat[rr * S + cc]; L = Math.hypot(a[0] - b[0], a[1] - b[1]); } }
          rests[k >> 2][i * 4 + (k & 3)] = L;
        }
      }
      offAll += p.R * S; if (p.closed) offClosed += p.R * S;
    }
    // the seams between pieces, welded: each sewn point's place on the other piece's edge (two texels and how far
    // between, −1 none), and each of those points' followers (up to four: texel and share)
    const seam = new Float32Array(n * 4).fill(-1), seamB = new Float32Array(n * 4).fill(-1), texelOf = new Map<number, number>();
    { let o2 = 0; for (const p of ps) { const S = cols(p); for (let r = 0; r < p.R; r++) for (let c = 0; c < S; c++) texelOf.set(p.base + r * p.J + c, o2 + r * S + c); o2 += p.R * S; } }
    const sewn = athlete.stitches ?? (athlete.seams ?? []).map(([a, b]) => [a, b, b, 0] as [number, number, number, number]);
    const follow = (lead: number, f: number, w: number) => {
      if (w <= 0.001) return;
      for (let k = 0; k < 4; k++) if (seamB[lead * 4 + k] < 0) { seamB[lead * 4 + k] = f + Math.min(0.999, w); return; }
    };
    for (const [p, q, q2, t] of sewn) {
      const tp = texelOf.get(p), tq = texelOf.get(q), tq2 = texelOf.get(q2);
      if (tp === undefined || tq === undefined || tq2 === undefined || seam[tp * 4] >= 0) continue;
      seam.set([tq, tq2, t, -1], tp * 4); follow(tq, tp, 1 - t); if (tq2 !== tq) follow(tq2, tp, t);
    }
    // (cloth on cloth: each jacket point's nearest breeches point at rest, within 6 cm: what it's kept outside of)
    {
      const under: { t: number; p: number[] }[] = [], over: { t: number; p: number[] }[] = [];
      { let o2 = 0; for (const p of ps) { const S = cols(p); for (let r = 0; r < p.R; r++) for (let c = 0; c < S; c++) { const v = (p.base + r * p.J + c) * SKIN_STRIDE, e = { t: o2 + r * S + c, p: [V[v], V[v + 1], V[v + 2]] }; if (p.kind === 'breeches') under.push(e); else if (p.kind === 'jacket') over.push(e); } o2 += p.R * S; } }
      if (under.length) for (const o of over) {
        let best = -1, bd = 0.06 * 0.06;
        for (const u of under) { const d = (u.p[0] - o.p[0]) ** 2 + (u.p[1] - o.p[1]) ** 2 + (u.p[2] - o.p[2]) ** 2; if (d < bd) { bd = d; best = u.t; } }
        seam[o.t * 4 + 3] = best;
      }
    }
    for (const [k, d] of Object.entries({ bind, bindN, jt, wt, metaA, metaB, rest0: rests[0], rest1: rests[1], rest2: rests[2], seam, seamB })) this.stat[k] = this.texture(d);
    const progs = { anchor: ANCHOR_FS, init: INIT_FS, predict: PREDICT_FS, solve: SOLVE_FS };
    for (const [k, fs] of Object.entries(progs)) {
      const p = this.progs[k] = program(gl, QUAD_VS, fs);
      const l: Record<string, WebGLUniformLocation | null> = {};
      for (const u of ['W', 'N', 'Bind', 'BindN', 'Joints', 'Weights', 'bones', 'A', 'X', 'P', 'A0', 'A1', 'N0', 'N1', 'MetaA', 'MetaB', 'Rest0', 'Rest1', 'Rest2', 'Seam', 'SeamB', 'h', 'ratio', 's0', 's1', 's', 'damp', 'drag', 'kStretch', 'kShear', 'kBend', 'omega', 'kThick', 'kUnfold', 'armA', 'armB']) l[u] = gl.getUniformLocation(p, u);
      this.loc[k] = l;
    }
    this.vao = gl.createVertexArray()!;
  }

  /** the texture of `f`'s cloth points now (to draw with), or null before its first step */
  points(f: object): WebGLTexture | null { return this.states.get(f)?.x ?? null; }
  /** the welded seams (each sewn point's place on the edge it's sewn to), for drawing */
  get seams(): WebGLTexture { return this.stat.seam; }
  /** the pattern's lengths (each point's to its neighbours), for drawing the creases by how stretched the cloth is */
  get rests(): WebGLTexture { return this.stat.rest0; }

  /** run `f`'s cloth on to bout time `t`, its skin posed by `bones` (the renderer's skinning matrices), its arms
   * `arms` (four capsules: a.xyz and radius each, then b.xyz and 0 each) */
  step(f: object, t: number, bones: Float32Array, at: number, arms: Float32Array = new Float32Array(32)) {
    const gl = this.gl, t0 = performance.now();
    let st = this.states.get(f);
    if (!st) {
      // (a replay's copies of the fencers get their own; only the latest few are kept)
      if (this.states.size >= 4) { const [k, old] = this.states.entries().next().value!; this.free(old); this.states.delete(k); }
      st = { a: [this.target(2), this.target(2)], x: this.texture(null), p: this.texture(null), spare: [this.texture(null), this.texture(null)], t: -1, h: CLOTH.step, last: null };
      this.states.set(f, st);
    }
    const dt = t - st.t;
    if (st.t >= 0 && dt <= 0) return;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.W, this.H);
    gl.bindVertexArray(this.vao);
    // the anchors: last frame's become the start of this one's
    [st.a[0], st.a[1]] = [st.a[1], st.a[0]];
    this.pass('anchor', st.a[1].fb, { Bind: this.stat.bind, BindN: this.stat.bindN, Joints: this.stat.jt, Weights: this.stat.wt }, (l) => gl.uniformMatrix4fv(l.bones, false, bones));
    // (a first step, a jump in time or place: start again at rest on the skin)
    const jumped = st.last === null || Math.abs(at - st.last[0]) > 0.3;
    if (st.t < 0 || dt > 0.1 || jumped) {
      this.pass('init', this.fb([st.x, st.p]), { A: st.a[1].tex[0] });
      this.pass('anchor', st.a[0].fb, { Bind: this.stat.bind, BindN: this.stat.bindN, Joints: this.stat.jt, Weights: this.stat.wt }, (l) => gl.uniformMatrix4fv(l.bones, false, bones));
    } else {
      const n = Math.min(CLOTH.maxSteps * this.stress, Math.max(1, Math.ceil(dt * this.stress / CLOTH.step))), h = dt / n;
      const A0 = st.a[0].tex[0], A1 = st.a[1].tex[0], N0 = st.a[0].tex[1], N1 = st.a[1].tex[1];
      for (let k = 0; k < n; k++) {
        const ratio = h / st.h; st.h = h;
        const [nx, np] = st.spare;
        this.pass('predict', this.fb([nx, np]), { X: st.x, P: st.p, A0, A1 }, (l) => {
          gl.uniform1f(l.h, h); gl.uniform1f(l.ratio, ratio); gl.uniform1f(l.s0, k / n); gl.uniform1f(l.s1, (k + 1) / n);
          gl.uniform1f(l.damp, CLOTH.damp); gl.uniform1f(l.drag, CLOTH.drag);
        });
        st.spare = [st.x, st.p]; st.x = nx; st.p = np;
        for (let it = 0; it < CLOTH.passes; it++) {
          const out = st.spare[0];
          this.pass('solve', this.fb([out]), { X: st.x, MetaA: this.stat.metaA, MetaB: this.stat.metaB, Rest0: this.stat.rest0, Rest1: this.stat.rest1, Rest2: this.stat.rest2, A0, A1, N0, N1, Seam: this.stat.seam, SeamB: this.stat.seamB }, (l) => {
            gl.uniform1f(l.s, (k + 1) / n); gl.uniform1f(l.kStretch, CLOTH.stretch); gl.uniform1f(l.kShear, CLOTH.shear); gl.uniform1f(l.kBend, CLOTH.bend); gl.uniform1f(l.omega, CLOTH.omega); gl.uniform1f(l.kThick, CLOTH.thick); gl.uniform1f(l.kUnfold, CLOTH.unfold);
            gl.uniform4fv(l.armA, arms.subarray(0, 16)); gl.uniform4fv(l.armB, arms.subarray(16, 32));
          });
          st.spare[0] = st.x; st.x = out;
        }
      }
    }
    st.t = t; st.last = Float32Array.of(at);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);
    this.issueMs = performance.now() - t0;
  }

  private pass(name: string, fb: WebGLFramebuffer, tex: Record<string, WebGLTexture>, set?: (l: Record<string, WebGLUniformLocation | null>) => void) {
    const gl = this.gl, l = this.loc[name];
    // (counted per animation frame: both fencers' passes together)
    const frame = Math.floor(performance.now() / 16.6);
    if (frame !== this.passFrame) { this.passes = this.passCount; this.passCount = 0; this.passFrame = frame; }
    this.passCount++;
    gl.useProgram(this.progs[name]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.uniform1i(l.W, this.W); gl.uniform1i(l.N, this.N);
    // (units from 4 up: the renderer keeps the shadow map, the kit atlas and the cloth's points and seams on 0–3)
    Object.entries(tex).forEach(([k, t], i) => { gl.activeTexture(gl.TEXTURE4 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(l[k], 4 + i); });
    set?.(l);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private texture(data: Float32Array | null): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.W, this.H, 0, gl.RGBA, gl.FLOAT, data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    return t;
  }
  private target(k: number): Target { const tex = Array.from({ length: k }, () => this.texture(null)); return { tex, fb: this.fb(tex) }; }
  /** a framebuffer writing to these textures, made once for each combination */
  private fb(tex: WebGLTexture[]): WebGLFramebuffer {
    const gl = this.gl, key = tex.map((t) => this.id(t)).join('|');
    let fb = this.fbs.get(key);
    if (!fb) {
      fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      tex.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
      gl.drawBuffers(tex.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('cloth: framebuffer incomplete');
      this.fbs.set(key, fb);
    }
    return fb;
  }
  private ids = new WeakMap<WebGLTexture, number>(); private nextId = 1;
  private id(t: WebGLTexture) { let i = this.ids.get(t); if (!i) { i = this.nextId++; this.ids.set(t, i); } return i; }
  private free(s: State) {
    const gl = this.gl, mine = new Set([s.x, s.p, ...s.spare, ...s.a.flatMap((a) => a.tex)].map((t) => this.id(t)));
    for (const [k, fb] of this.fbs) if (k.split('|').some((i) => mine.has(Number(i)))) { gl.deleteFramebuffer(fb); this.fbs.delete(k); }
    [s.x, s.p, ...s.spare, ...s.a.flatMap((a) => a.tex)].forEach((t) => gl.deleteTexture(t));
  }
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const sh = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}
