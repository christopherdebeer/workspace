/**
 * The kit as cloth, simulated on the GPU (`?cloth=sim`): the jacket, both sleeves and the breeches' legs.
 *
 * The garments are the athlete's own lofted pieces (athlete.ts). Each is a grid of rings round the body, about a
 * centimetre apart, so each of its points has neighbours along and round it. Their lengths at rest, as built, are the
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

/** the cloth's dials: substep length (s), passes a substep, stiffnesses (0..1 a pass), relaxation, damping, and how
 * much of the body's motion the cloth is dragged toward each substep */
export const CLOTH = { step: 1 / 480, maxSteps: 14, passes: 2, stretch: 1, shear: 0.6, bend: 0.5, omega: 1.4, damp: 0.995, drag: 0.04,
  /** thickness: how hard each pass pulls a point's curvature (its offset from its four neighbours' middle) toward the
   * skin's under it (a scale on each piece's own, `thickness`). Thick cloth can't crease in short waves; it folds in
   * broad ones */
  thick: 1 };

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

/** the cut: how much longer (along) and fuller (round) the cloth is than the skin it was shaped on, by row fraction.
 * This is the tailoring: cloth cut to the body exactly has nothing to fold with. A sleeve is cut longer than the arm
 * and fuller at the elbow; the jacket a little full in the body; the breeches long over the knee */
function cut(p: ClothPiece, row: number): [number, number] {
  const j = p.joint ?? 0.5, near = (c: number, w: number) => Math.exp(-(((row - c) / w) ** 2));
  switch (p.kind) {
    // (fitted: a little length for the hem to hang by, fullness only across the chest, where extending draws it)
    case 'jacket': return [1.01, 1.008 + 0.017 * near(0.62, 0.12)];
    case 'sleeveW': case 'sleeveR': return [1.03 + 0.07 * near(j, 0.16) + 0.04 * near(j + 0.2, 0.12), 1.04 + 0.05 * near(j, 0.18)];
    // (fitted through the seat and thigh, long over the knee)
    case 'breeches': return [1.01 + 0.06 * near(j, 0.12), 1.012 + 0.02 * near(j, 0.16)];
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
/** a pass of the constraints, each point from its neighbours (Jacobi), then the body's: ease and backstop */
const SOLVE_FS = HEAD + `
uniform sampler2D X, Bind, BindN, MetaA, MetaB, A0, A1, N0, N1; uniform float s, kStretch, kShear, kBend, omega, kThick;
out vec4 o;
const ivec2 OFF[12] = ivec2[12](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1), ivec2(1,1), ivec2(1,-1), ivec2(-1,1), ivec2(-1,-1), ivec2(2,0), ivec2(-2,0), ivec2(0,2), ivec2(0,-2));
void main(){
  int i = me(); if (i >= N) { o = vec4(0); return; }
  vec4 ma = texelFetch(MetaA, tc(i), 0), mb = texelFetch(MetaB, tc(i), 0);
  int r = int(ma.x), c = int(ma.y), R = int(ma.z), S = int(ma.w), off = int(mb.x);
  vec4 bi = texelFetch(Bind, tc(i), 0);
  vec3 x = texelFetch(X, tc(i), 0).xyz, acc = vec3(0.0); float n = 0.0;
  vec3 a = mix(texelFetch(A0, tc(i), 0).xyz, texelFetch(A1, tc(i), 0).xyz, s);
  vec3 midX = vec3(0.0), midA = vec3(0.0); float m4 = 0.0;
  for (int k = 0; k < 12; k++) {
    int rr = r + OFF[k].x; if (rr < 0 || rr >= R) continue;
    int cc = (c + OFF[k].y + S) % S, j = off + rr * S + cc;
    vec3 xj = texelFetch(X, tc(j), 0).xyz, bj = texelFetch(Bind, tc(j), 0).xyz;
    vec3 d = x - xj; float l = length(d); if (l < 1e-7) continue;
    float kk = k < 4 ? kStretch : (k < 8 ? kShear : kBend);
    // (the rest length: the skin's, eased by the cut, along or round or, on a diagonal, both)
    vec4 mj = texelFetch(MetaB, tc(j), 0);
    float along = 0.5 * (mb.y + mj.y), round = 0.5 * (mb.w + mj.w);
    float e = OFF[k].y == 0 ? along : (OFF[k].x == 0 ? round : sqrt(0.5 * (along * along + round * round)));
    acc -= 0.5 * kk * (l - e * length(bi.xyz - bj)) * d / l; n += 1.0;
    if (k < 4) { midX += xj; midA += mix(texelFetch(A0, tc(j), 0).xyz, texelFetch(A1, tc(j), 0).xyz, s); m4 += 1.0; }
  }
  x += omega * acc / max(n, 1.0);
  // thickness: the point's offset from its neighbours' middle eased toward the skin's offset there
  if (m4 > 3.5) x += min(1.0, kThick * texelFetch(BindN, tc(i), 0).w) * ((midX / m4 + (a - midA / m4)) - x);
  // the body: within the ease of its place on the skin, and never inside it
  vec3 nn = normalize(mix(texelFetch(N0, tc(i), 0).xyz, texelFetch(N1, tc(i), 0).xyz, s));
  float slack = bi.w;
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
uniform highp sampler2D clothX; uniform int clothOn, clothW; uniform ivec4 clothPiece[5];
vec3 clothPt(int off, int S, int r, int c){ int i = off + r * S + c; return texelFetch(clothX, ivec2(i % clothW, i / clothW), 0).xyz; }
void clothAt(inout vec3 q, inout vec3 nn){
  if (clothOn == 0) return;
  for (int k = 0; k < 5; k++) {
    ivec4 P = clothPiece[k]; int rel = gl_VertexID - P.x;
    if (P.y == 0 || rel < 0 || rel >= P.y * P.z) continue;
    int S = P.z - 1, r = rel / P.z, c = rel % P.z; if (c == S) c = 0;
    q = clothPt(P.w, S, r, c);
    vec3 du = clothPt(P.w, S, r, (c + 1) % S) - clothPt(P.w, S, r, (c + S - 1) % S);
    vec3 dv = clothPt(P.w, S, min(r + 1, P.y - 1), c) - clothPt(P.w, S, max(r - 1, 0), c);
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

  static create(gl: WebGL2RenderingContext, athlete: Athlete): GpuCloth | null {
    if (!gl.getExtension('EXT_color_buffer_float') || !athlete.pieces?.length) return null;
    try { return new GpuCloth(gl, athlete); } catch (e) { console.warn(e); return null; }
  }

  private constructor(readonly gl: WebGL2RenderingContext, athlete: Athlete) {
    const ps = athlete.pieces.filter((p) => p.closed).slice(0, 5);
    this.N = ps.reduce((s, p) => s + p.R * (p.J - 1), 0);
    this.H = Math.ceil(this.N / this.W);
    const n = this.W * this.H, bind = new Float32Array(n * 4), bindN = new Float32Array(n * 4), jt = new Float32Array(n * 4), wt = new Float32Array(n * 4);
    const metaA = new Float32Array(n * 4), metaB = new Float32Array(n * 4), V = athlete.verts;
    this.pieces = new Int32Array(20);
    let off = 0;
    ps.forEach((p, k) => {
      const S = p.J - 1;
      this.pieces.set([p.base, p.R, p.J, off], k * 4);
      for (let r = 0; r < p.R; r++) for (let c = 0; c < S; c++) {
        const v = (p.base + r * p.J + c) * SKIN_STRIDE, t = (off + r * S + c) * 4;
        bind.set([V[v], V[v + 1], V[v + 2], ease(p, r / (p.R - 1))], t);
        bindN.set([V[v + 3], V[v + 4], V[v + 5], thickness(p)], t);
        jt.set(V.subarray(v + 12, v + 16), t); wt.set(V.subarray(v + 16, v + 20), t);
        metaA.set([r, c, p.R, S], t); const [al, ar] = cut(p, r / (p.R - 1)); metaB.set([off, al, 0.002, ar], t);
      }
      off += p.R * S;
    });
    for (const [k, d] of Object.entries({ bind, bindN, jt, wt, metaA, metaB })) this.stat[k] = this.texture(d);
    const progs = { anchor: ANCHOR_FS, init: INIT_FS, predict: PREDICT_FS, solve: SOLVE_FS };
    for (const [k, fs] of Object.entries(progs)) {
      const p = this.progs[k] = program(gl, QUAD_VS, fs);
      const l: Record<string, WebGLUniformLocation | null> = {};
      for (const u of ['W', 'N', 'Bind', 'BindN', 'Joints', 'Weights', 'bones', 'A', 'X', 'P', 'A0', 'A1', 'N0', 'N1', 'MetaA', 'MetaB', 'h', 'ratio', 's0', 's1', 's', 'damp', 'drag', 'kStretch', 'kShear', 'kBend', 'omega', 'kThick']) l[u] = gl.getUniformLocation(p, u);
      this.loc[k] = l;
    }
    this.vao = gl.createVertexArray()!;
  }

  /** the texture of `f`'s cloth points now (to draw with), or null before its first step */
  points(f: object): WebGLTexture | null { return this.states.get(f)?.x ?? null; }

  /** run `f`'s cloth on to bout time `t`, its skin posed by `bones` (the renderer's skinning matrices) */
  step(f: object, t: number, bones: Float32Array, at: number) {
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
          this.pass('solve', this.fb([out]), { X: st.x, Bind: this.stat.bind, BindN: this.stat.bindN, MetaA: this.stat.metaA, MetaB: this.stat.metaB, A0, A1, N0, N1 }, (l) => {
            gl.uniform1f(l.s, (k + 1) / n); gl.uniform1f(l.kStretch, CLOTH.stretch); gl.uniform1f(l.kShear, CLOTH.shear); gl.uniform1f(l.kBend, CLOTH.bend); gl.uniform1f(l.omega, CLOTH.omega); gl.uniform1f(l.kThick, CLOTH.thick);
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
    // (units from 4 up: the renderer keeps the shadow map, the kit atlas and the cloth's points on 0–2)
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
