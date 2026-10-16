/**
 * Squishy: a third-person platformer in which you are a dumpling: a clear, glittery, pink jelly
 * one, a squishy toy (or, as you like, a steamed one of dough).
 *
 * You don't walk: you flick. Drag back from anywhere and let go, as with a slingshot, and the
 * dumpling flies the other way, as hard as you pulled; while you pull it winds up, squeezed
 * along the way it will go, and the dotted line shows where its middle will land. It's soft:
 * it squashes when it lands, bulges, wobbles back, dents on an edge, sticks to a wall for a
 * moment (dough is tacky), and rights itself like a roly-poly. Across a kitchen counter, from
 * a bamboo steamer to the golden one: home.
 *
 * The dumpling (`body.ts`) and the course (`level.ts`) are pure and tested on their own; the
 * meshes (`mesh.ts`) too. Here is the game: its state, the levels and the title, the aim and the
 * flick, the camera, the hands, and each frame drawn (WebGL2: the window's shadow map, soft; the
 * course's materials; the jelly seen through, refracting what's behind it, glitter in it; dough
 * lit as dough; a face drawn on its rest shape so it turns and squashes with it). Beside it: the
 * GLSL (`shaders.ts`); the context, programs and meshes on the card (`gpu.ts`); the targets it's
 * drawn into and the finish (`post.ts`); the light the course's things give each other, baked
 * (`bakegl.ts`); quality by frame time (`quality.ts`); the sounds (`sound.ts`); small maths
 * (`vmath.ts`); and what the page was opened with (`env.ts`).
 */
import { hash, seeded } from '../kit/rng';
import { Dumpling, ROLL_MAX, ROLL_MIN, railAxis, rollReach, type Kind } from './body';
import { kitchenRun, tableSet } from './room';
import { CHAPTER_AT, CHAPTER_NAME, DUST, MAT, dustMat, carried, chapterOf, fingerprint, nextTop, RADIUS, REST_H, aim, respawnAt, autoFlick, climbLaunch, launch, liftAt, path, touch, towerAt, type Dust, type Level, type Shape, type V3 } from './level';
import { BENCHES, bench, buildLevel } from './course';
import { logFlick, noteBack, readFlicks, settleFlick } from './flicklog';
import { logoSVG } from './title';
import { paintAtlas } from './books';
import { VSTRIDE, disc, levelMesh, sphere, type LevelMesh } from './mesh';
import { honeyOver, type HoneyRim } from './honey';
import { honeyField } from './honeyfield';
import { bounceOf, jelMesh, jelMeshSize, FEELS } from './jelly';
import { FAST, STORE, auto, params, preview } from './env';
import { HDR, SHADOW, backProg, bubbleProg, canvas, doughProg, drop, gl, glitterProg, jellyProg, prog, puffProg, shadowProg, skyProg, u, upload, type Mesh } from './gpu';
import { backFb, backTex, finish, msFb, sceneCopy, skyVao, targets, tgtS } from './post';
import { bakeLight, bakeMs } from './bakegl';
import { fixedQuality, qLocked, quality, renderScale, samples } from './quality';
import { ac, blop, boing, chime, plop, pop, rattle, setSound, sneezeSound, soundOn, squish, wake } from './sound';
import { add, cross, dot, invert, len, mul, norm, ortho, sub, viewProj } from './vmath';

/** a bench: one thing to try over and over (`?bench=jelly`) */
const benchName = params.get('bench');
/** (for a look at a place from where you say: ?view=eye x,y,z,looking at x,y,z) */
const fixedView = params.get('view')?.split(',').map(Number);
/**
 * The lab's way in (`?lab`, or a bench, or playing itself): any level, the dumpling either way, a step back
 * or on from the foot of the glass. Otherwise it's a game: a level's open once the one before's been got
 * home (or once it's been played at all, from before there was any of this), and the jelly's earned, by
 * getting level 12 home.
 */
const lab = params.has('lab') || params.has('auto') || params.has('preview') || params.has('bench');
const reachedNow = () => { try { return Math.max(1, Number(localStorage.getItem(STORE + ':reached')) || 0, Number(localStorage.getItem(STORE + ':level')) || 0); } catch { return 1; } };

/** the light: ?light=morning (low and warm through the window: the default), noon (high and white), shade (the sun off the window: the room's light only) */
const LIGHT = params.get('light') ?? 'morning';
if (preview) document.body.classList.add('preview');
const $ = (id: string) => document.getElementById(id)!;


const SPHERE = upload((() => { const v: number[] = []; sphere(v, 13); return v; })());
const DISC = upload((() => { const v: number[] = []; disc(v, 14); return v; })());
let courseMesh: Mesh | null = null;
/**
 * The jellies, drawn as their tops are each frame: the mesh, the floats it's filled from, and how it's deformed; and
 * the rings spreading from where the dumpling last came down on it (where, when, how hard), and whether it's in it now.
 */
/** ?nodef: nothing drawn from how things are deformed or pressed (the dumpling's press, a jelly's dent and rings), to compare */
const noDef = params.has('nodef');
let jellyMeshes: Array<{ shape: Shape; mesh: Mesh; data: Float32Array; def: Float32Array; ripple: [number, number, number, number]; was: boolean }> = [];
function fillJellies() {
  for (const jm of jellyMeshes) {
    const j = jm.shape.jel!;
    const n = jelMesh(j, jm.data, jm.shape.mat, jm.shape.dust && jm.shape.mat !== MAT.bread ? dustMat(jm.shape.dust) : 0, noDef ? undefined : jm.def);
    gl.bindBuffer(gl.ARRAY_BUFFER, jm.mesh.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, jm.data, 0, n);
    if (!noDef) { gl.bindBuffer(gl.ARRAY_BUFFER, jm.mesh.dbuf!); gl.bufferSubData(gl.ARRAY_BUFFER, 0, jm.def, 0, (n / VSTRIDE) * 2); }
    jm.mesh.count = n / VSTRIDE;
    // (come down on: rings from there, as hard as it came)
    const now = (j.held ?? 0) > 0;
    if (now && !jm.was && !noDef) jm.ripple = [body.com[0], body.com[2], simTime, Math.min(1, (j.vin ?? 0) / 300)];
    jm.was = now;
  }
}
let glassMesh: Mesh | null = null;
let liquidMesh: Mesh | null = null;
/** honey run over a rim (a jar's, a pot's): its collar, drips and drops, rebuilt a few times a second as it creeps */
let honeyRims: HoneyRim[] = [], dripMesh: Mesh | null = null, dripAt = -1;
let honeyMeshes: Array<{mesh: Mesh; center: V3; radius: number; bottom: number; top: number}> = [];
let roomMesh: Mesh | null = null;
/** the lids: each its own mesh about its rest place, drawn where it is now */
let movers: Array<{ shape: LevelMesh['movers'][number]['shape']; mesh: Mesh }> = [];
/** the soap bubbles: each its own clear mesh; popped (when, in sim time; -1 whole) out of the course, till it grows back */
let bubbles: Array<{ shape: Shape; mesh: Mesh; c0: V3; gone: number; drift: V3 | null; until: number }> = [];
/** how long a popped bubble takes to grow back (s), so the way past it is never gone for good */
const BUBBLE_BACK = 6;

// ─── the dumpling on the card ────────────────────────────────────────────────────────────────────
/**
 * What it's made of: steamed dough; or, from level 13 (and once you've been there, anywhere), a
 * clear glittery jelly, the squishy toy, kept for later as a treat.
 */
const JELLY_AT = 13;
let jellyOpen = ((): boolean => { try { return localStorage.getItem(STORE + ':jelly') === '1'; } catch { return false; } })();
let skin: Kind = ((): Kind => {
  const want = params.get('skin') ?? (jellyOpen ? (() => { try { return localStorage.getItem(STORE + ':skin'); } catch { return null; } })() : null);
  return want === 'jelly' ? 'jelly' : want === 'dough' ? 'dough' : 'dough';
})();
let body!: Dumpling;
/** on the title, a second dumpling beside the first: the other kind (the jelly, while it's still to come) */
let buddy: Dumpling | null = null;
let buddyPrev = new Float32Array(0);
interface Flakes { n: number; rest: Float32Array; near: Uint16Array; w: Float32Array; nor: Float32Array; data: Float32Array; buf: WebGLBuffer; vao: WebGLVertexArrayObject }
/**
 * A skin on the card: its triangles, its positions and normals as drawn (rewritten each frame),
 * where each was in its rest shape; and, for the jelly, the glitter in it: each flake placed
 * somewhere inside, carried along by the four particles of the skin nearest it.
 */
/**
 * A skin at rest: how thick it is at each point (along its inward normal to where that comes out the far side),
 * and how much of its surface is about each point (a third of each triangle it's a corner of).
 */
function skinMeasure(q: Float32Array, tris: ArrayLike<number>): { thick: Float32Array; area: Float32Array } {
  const n = q.length / 3, nrm = new Float32Array(n * 3), area = new Float32Array(n), thick = new Float32Array(n);
  for (let k = 0; k < tris.length; k += 3) {
    const a = tris[k] * 3, b = tris[k + 1] * 3, c = tris[k + 2] * 3;
    const ux = q[b] - q[a], uy = q[b + 1] - q[a + 1], uz = q[b + 2] - q[a + 2], vx = q[c] - q[a], vy = q[c + 1] - q[a + 1], vz = q[c + 2] - q[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, A = Math.hypot(nx, ny, nz) / 2;
    for (const i of [a, b, c]) { nrm[i] += nx; nrm[i + 1] += ny; nrm[i + 2] += nz; area[i / 3] += A / 3; }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
    const dx = -nrm[i * 3] / l, dy = -nrm[i * 3 + 1] / l, dz = -nrm[i * 3 + 2] / l;
    const ox = q[i * 3] + dx * 0.02, oy = q[i * 3 + 1] + dy * 0.02, oz = q[i * 3 + 2] + dz * 0.02;
    let best = RADIUS * 2.2;
    // (the nearest triangle the inward ray meets, past its own: Möller–Trumbore)
    for (let k = 0; k < tris.length; k += 3) {
      const a = tris[k] * 3, b = tris[k + 1] * 3, c = tris[k + 2] * 3;
      if (a === i * 3 || b === i * 3 || c === i * 3) continue;
      const e1x = q[b] - q[a], e1y = q[b + 1] - q[a + 1], e1z = q[b + 2] - q[a + 2], e2x = q[c] - q[a], e2y = q[c + 1] - q[a + 1], e2z = q[c + 2] - q[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-9) continue;
      const inv = 1 / det, tx = ox - q[a], ty = oy - q[a + 1], tz = oz - q[a + 2];
      const uu = (tx * px + ty * py + tz * pz) * inv;
      if (uu < 0 || uu > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const vv = (dx * qx + dy * qy + dz * qz) * inv;
      if (vv < 0 || uu + vv > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 0.05 && t < best) best = t;
    }
    thick[i] = best;
  }
  return { thick, area };
}
function skinOnCard(kind: Kind) {
  const d = new Dumpling([0, 0, 0], kind);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const pos = gl.createBuffer()!, nor = gl.createBuffer()!, rest = gl.createBuffer()!, idx = gl.createBuffer()!, coat = gl.createBuffer()!;
  const bind = (b: WebGLBuffer, loc: number, size = 3) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, rest);
  gl.bufferData(gl.ARRAY_BUFFER, d.q, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.bufferData(gl.ARRAY_BUFFER, d.x.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, nor);
  gl.bufferData(gl.ARRAY_BUFFER, d.x.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, coat);
  gl.bufferData(gl.ARRAY_BUFFER, d.n * 2 * 4, gl.DYNAMIC_DRAW);
  // (how thick it is at each point, through its rest shape, and how much skin is round each point at rest: for how
  // it's stretched or squashed, as it's drawn)
  const { thick, area: restArea } = skinMeasure(d.q, d.tris);
  const skinData = new Float32Array(d.n * 3);
  for (let i = 0; i < d.n; i++) skinData[i * 3] = thick[i];
  const skin = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, skin);
  gl.bufferData(gl.ARRAY_BUFFER, skinData, gl.DYNAMIC_DRAW);
  bind(pos, 0); bind(nor, 1); bind(rest, 2); bind(coat, 3, 2); bind(skin, 4, 3);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.tris, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  // (and for the shadow map: the same positions)
  const svao = gl.createVertexArray()!;
  gl.bindVertexArray(svao);
  const sloc = gl.getAttribLocation(shadowProg, 'aPos');
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.enableVertexAttribArray(sloc);
  gl.vertexAttribPointer(sloc, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
  gl.bindVertexArray(null);
  let flakes: Flakes | null = null;
  if (kind === 'jelly') {
    const r = seeded(hash(7, 0x611));
    const N = preview ? 500 : 1100, q = d.q;
    const fr = new Float32Array(N * 3), near = new Uint16Array(N * 4), w = new Float32Array(N * 4), fn = new Float32Array(N * 3);
    for (let f = 0; f < N; f++) {
      // (anywhere inside, evenly: a point in a box about it, kept if it's within the skin that way)
      for (let tries = 0; tries < 60; tries++) {
        const P = [(r() * 2 - 1) * RADIUS * 1.2, (r() * 2 - 1) * RADIUS * 1.2, (r() * 2 - 1) * RADIUS * 1.2];
        const l = Math.hypot(P[0], P[1], P[2]) || 1;
        let most = -2, edge = 0;
        for (let j = 0; j < d.n; j++) {
          const qx = q[j * 3], qy = q[j * 3 + 1], qz = q[j * 3 + 2], ql = Math.hypot(qx, qy, qz) || 1;
          const c = (qx * P[0] + qy * P[1] + qz * P[2]) / (ql * l);
          if (c > most) { most = c; edge = ql; }
        }
        fr[f * 3] = P[0]; fr[f * 3 + 1] = P[1]; fr[f * 3 + 2] = P[2];
        if (l < edge * 0.9) break;
      }
      const best: Array<[number, number]> = [];
      for (let j = 0; j < d.n; j++) {
        const dd = (q[j * 3] - fr[f * 3]) ** 2 + (q[j * 3 + 1] - fr[f * 3 + 1]) ** 2 + (q[j * 3 + 2] - fr[f * 3 + 2]) ** 2;
        if (best.length < 4 || dd < best[3][0]) { best.push([dd, j]); best.sort((a, b) => a[0] - b[0]); if (best.length > 4) best.pop(); }
      }
      let sw = 0;
      best.forEach(([dd, j], k) => { near[f * 4 + k] = j; w[f * 4 + k] = 1 / (dd + 0.05); sw += w[f * 4 + k]; });
      for (let k = 0; k < 4; k++) w[f * 4 + k] /= sw;
      const nz = r() * 2 - 1, na = r() * Math.PI * 2, nr = Math.sqrt(1 - nz * nz);
      fn[f * 3] = nr * Math.cos(na); fn[f * 3 + 1] = nz; fn[f * 3 + 2] = nr * Math.sin(na);
    }
    // (each flake's own: what colour (silver, pink, lilac), how big)
    const data = new Float32Array(N * 8);
    for (let f = 0; f < N; f++) { data[f * 8 + 6] = r(); data[f * 8 + 7] = 0.05 + 0.05 * r(); }
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    const fvao = gl.createVertexArray()!;
    gl.bindVertexArray(fvao);
    for (const [name, size, off] of [['aPos', 3, 0], ['aNor', 3, 3], ['aK', 2, 6]] as Array<[string, number, number]>) {
      const loc = gl.getAttribLocation(glitterProg, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 32, off * 4);
    }
    gl.bindVertexArray(null);
    flakes = { n: N, rest: fr, near, w, nor: fn, data, buf, vao: fvao };
  }
  return { kind, vao, svao, pos, nor, coat, skin, skinData, restArea, areaNow: new Float32Array(d.n), coatData: new Float32Array(d.n * 2), count: d.tris.length, normals: new Float32Array(d.x.length), shown: new Float32Array(d.x.length), q: d.q, flakes };
}
const skins = { jelly: skinOnCard('jelly'), dough: skinOnCard('dough') };
/** The skin as drawn: between the solver's last two states, its normals from its triangles; and the glitter carried along. */
let prevX = new Float32Array(0);
function uploadSkin(body: Dumpling, prevX: Float32Array, alpha: number) {
  const g = skins[body.kind];
  const x = body.x, s = g.shown, nrm = g.normals;
  for (let i = 0; i < x.length; i++) s[i] = prevX.length === x.length ? prevX[i] + (x[i] - prevX[i]) * alpha : x[i];
  nrm.fill(0);
  const an = g.areaNow;
  an.fill(0);
  const t = body.tris;
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
    const ux = s[b] - s[a], uy = s[b + 1] - s[a + 1], uz = s[b + 2] - s[a + 2], vx = s[c] - s[a], vy = s[c + 1] - s[a + 1], vz = s[c + 2] - s[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, A = Math.hypot(nx, ny, nz) / 6;
    for (const i of [a, b, c]) { nrm[i] += nx; nrm[i + 1] += ny; nrm[i + 2] += nz; an[i / 3] += A; }
  }
  // (how much skin is about each point now, against at rest: stretched, more; squashed, less; and how hard it's pressed
  // against what it's on)
  const sd = g.skinData, ra = g.restArea;
  for (let j = 0; j < an.length; j++) { sd[j * 3 + 1] += ((ra[j] > 0 ? an[j] / ra[j] - 1 : 0) - sd[j * 3 + 1]) * 0.5; sd[j * 3 + 2] = noDef ? 0 : body.press[j]; }
  gl.bindBuffer(gl.ARRAY_BUFFER, g.skin);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, sd);
  for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  gl.bindBuffer(gl.ARRAY_BUFFER, g.pos);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, s);
  gl.bindBuffer(gl.ARRAY_BUFFER, g.nor);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, nrm);
  // (and what's on it)
  const cd = g.coatData;
  for (let i = 0; i < body.n; i++) { cd[i * 2] = body.coat[i]; cd[i * 2 + 1] = body.coatKind[i]; }
  gl.bindBuffer(gl.ARRAY_BUFFER, g.coat);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, cd);
  const fl = g.flakes;
  if (!fl) return;
  // (each flake where its four particles would put it, each as if the flake were held to it as it's turned)
  const R = body.R, q = g.q, out = fl.data;
  for (let f = 0; f < fl.n; f++) {
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k < 4; k++) {
      const j = fl.near[f * 4 + k], w = fl.w[f * 4 + k];
      const dx = fl.rest[f * 3] - q[j * 3], dy = fl.rest[f * 3 + 1] - q[j * 3 + 1], dz = fl.rest[f * 3 + 2] - q[j * 3 + 2];
      px += w * (s[j * 3] + R[0] * dx + R[1] * dy + R[2] * dz);
      py += w * (s[j * 3 + 1] + R[3] * dx + R[4] * dy + R[5] * dz);
      pz += w * (s[j * 3 + 2] + R[6] * dx + R[7] * dy + R[8] * dz);
    }
    const nx = fl.nor[f * 3], ny = fl.nor[f * 3 + 1], nz = fl.nor[f * 3 + 2];
    out[f * 8] = px; out[f * 8 + 1] = py; out[f * 8 + 2] = pz;
    out[f * 8 + 3] = R[0] * nx + R[1] * ny + R[2] * nz; out[f * 8 + 4] = R[3] * nx + R[4] * ny + R[5] * nz; out[f * 8 + 5] = R[6] * nx + R[7] * ny + R[8] * nz;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, fl.buf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, out);
}

// ─── the game ────────────────────────────────────────────────────────────────────────────────────
let levelN = Math.max(1, Number(params.get('level')) || (() => { try { return Number(localStorage.getItem(STORE + ':level')) || 1; } catch { return 1; } })());
let lv!: Level;
/** the tower last stood on (where a fall comes back to), falls, the clock, home (the time, or not yet) */
let check = 0;
/**
 * How much of the aim is shown, on a continuum: the arc (dots along the flick's first part, up past its top) and
 * the ring (where it'll land, green on a top that's on). Easy, both; normal, the arc only; hard, neither, judged by
 * eye. By default, as you go: both while learning (levels 1–6), the arc only through the middle (to 20), then
 * neither. Benches show both.
 */
const AIMS = ['default', 'easy', 'normal', 'hard'] as const;
type Aim = (typeof AIMS)[number];
const AIM_WORDS: Record<Aim, string> = { default: 'default', easy: 'easy', normal: 'normal', hard: 'hard' };
const AIM_ABOUT: Record<Aim, string> = { default: 'arc and ring to level 6, the arc to 20, then neither', easy: 'the arc and where it lands, always', normal: 'the arc, no ring, always', hard: 'no arc, no ring: by eye' };
let aimMode: Aim = ((): Aim => {
  // (as it was: a ring always, early, never)
  const old: Record<string, Aim> = { always: 'easy', early: 'default', never: 'hard' };
  const read = (v: string | null): Aim | null => (v && (AIMS as readonly string[]).includes(v) ? (v as Aim) : v && old[v] ? old[v] : null);
  const q = read(params.get('aim') ?? params.get('ring'));
  if (q) return q;
  try { return read(localStorage.getItem(STORE + ':aim')) ?? read(localStorage.getItem(STORE + ':ring')) ?? 'default'; } catch { return 'default'; }
})();
/** After a fall: back on the last top stood on (the default), or back where it was flicked, pushed or poked from
 * last — a jump's tried again from where it was tried, wherever that was: on a top, hanging from a rail, stuck to a
 * side. But not for ever: put back at the jump TRIES times within TRIES_IN seconds, the next fall's back to the last
 * top (somewhere it can't hold, or a jump it can't make, isn't tried over and over). */
const RESETS = ['top', 'jump'] as const;
type Reset = (typeof RESETS)[number];
const RESET_WORDS: Record<Reset, string> = { top: 'last top', jump: 'last jump' };
let resetMode: Reset = ((): Reset => { const ok = (v: string | null) => (v && (RESETS as readonly string[]).includes(v) ? (v as Reset) : null); try { return ok(params.get('reset')) ?? ok(localStorage.getItem(STORE + ':reset')) ?? 'top'; } catch { return ok(params.get('reset')) ?? 'top'; } })();
/** where it was set going from last, if from somewhere it can be put back */
let launchedFrom: V3 | null = null;
const launching = () => { launchedFrom = body.contacts > 0 ? [...body.com] as V3 : null; };
const TRIES = 3, TRIES_IN = 20;
/** where this fall puts it back: the jump (true), or the last top */
let toJump = false;
/** and by which rule, for the flick log */
let backBy: 'top' | 'jump' | 'capped' = 'top';
/** when it's been put back at the jump lately */
let retries: number[] = [];
/** what of the aim shows now: the arc, and the ring */
/** how much aim a level's played with: the setting, or by default, as you go */
function aimFor(n: number): Exclude<Aim, 'default'> {
  return aimMode === 'default' ? (benchName || n <= 6 ? 'easy' : n <= 20 ? 'normal' : 'hard') : aimMode;
}
function aimShows(): { arc: boolean; ring: boolean } {
  const m = aimFor(levelN);
  return { arc: m !== 'hard', ring: m === 'easy' };
}
/** said, the first time a lid's pop throws you */
let popSaid = false;
/** another layout of the level (?seed=), as the Level Lab names it; and the level's fingerprint, for the flick log */
const levelSeed = Math.max(0, Math.floor(Number(params.get('seed')) || 0));
let levelFp = '';
/** whether it's been said, this time playing, that the way parts */
let forkSaid = false;
/** the tops stood on this go (not where it starts): for the score */
const visited = new Set<number>();
/**
 * A level's score, from how it went: every top stood on, 100; a bonus for each tenth of a second under par (8 s a hop);
 * 60 off for each fall, and 150 more for none. Kept with the best time and the fewest falls, each its own best.
 */
interface Run { score: number; time: number; falls: number; tops: number }
function scoreOf(time: number, falls: number, tops: number): Run {
  // (par: by the way it's laid to go, the sure way where there's a choice)
  const par = 8 * Math.max(1, (lv.route?.length ?? lv.towers.length) - 1);
  const score = Math.max(0, tops * 100 + Math.max(0, Math.round((par - time) * 10)) - falls * 60 + (falls ? 0 : 150));
  return { score, time, falls, tops };
}
/** a level's record, kept for how much aim it was played with (a run with the ring's not one without it); those from
 * before, all played with the ring, count as easy */
const RECORD = (n: number, aim = aimFor(n)) => `${STORE}:record:${n}${aim === 'easy' ? '' : ':' + aim}`;
function recordOf(n: number): (Run & { bestTime: number; fewestFalls: number }) | null {
  try {
    const r = JSON.parse(localStorage.getItem(RECORD(n)) ?? 'null');
    if (r) return r;
    if (aimFor(n) !== 'easy') return null;
    // (from before scores: a best time alone)
    const t = Number(localStorage.getItem(`${STORE}:best:${n}`));
    return t ? { score: 0, time: t, falls: 0, tops: 0, bestTime: t, fewestFalls: Infinity } : null;
  } catch { return null; }
}
/** Home: the run scored, kept if it's the best, and shown on a card (gold, a new best). */
function showDone(r: Run) {
  const was = recordOf(levelN);
  const better = !was || r.score > was.score, fasterThan = !was || r.time < was.bestTime, cleaner = !was || r.falls < was.fewestFalls;
  const rec = { ...(better ? r : was!), bestTime: Math.min(r.time, was?.bestTime ?? Infinity), fewestFalls: Math.min(r.falls, was?.fewestFalls ?? Infinity) };
  if (!auto && !benchName) try { localStorage.setItem(RECORD(levelN), JSON.stringify(rec)); if (aimFor(levelN) === 'easy') localStorage.setItem(`${STORE}:best:${levelN}`, String(rec.bestTime)); } catch { /* */ }
  const el = $('done');
  const first = !was || !was.score;
  el.classList.toggle('best', better && !first);
  el.querySelector('b')!.textContent = first ? 'home!' : better ? 'a new best!' : 'home!';
  const row = (k: string, v: string, note: string, hi: boolean) => `<div class="row${hi ? ' hi' : ''}"><span>${k}</span><b>${v}</b><i>${note}</i></div>`;
  const tops = lv.towers.length - 1;
  el.querySelector('.rows')!.innerHTML =
    row('time', `${r.time.toFixed(1)} s`, was && !first ? (fasterThan ? `was ${was.bestTime.toFixed(1)}` : `best ${was.bestTime.toFixed(1)}`) : '', fasterThan && !first)
    + row('falls', `${r.falls}`, was && !first && Number.isFinite(was.fewestFalls) ? (cleaner ? `was ${was.fewestFalls}` : `fewest ${was.fewestFalls}`) : '', cleaner && !first)
    + row('tops', `${r.tops} of ${tops}`, '', false)
    + row('score', `${r.score}`, was && !first ? (better ? `was ${was.score}` : `best ${was.score}`) : '', better && !first)
    + row('aim', AIM_WORDS[aimFor(levelN)], 'records are kept for each', false);
  el.classList.add('on');
  if (better && !first) setTimeout(() => { if (ac) [990, 1320, 1760].forEach((f, i) => setTimeout(() => blop(f, f * 1.01, 0.4, 0.1), i * 90)); }, 520);
}
let falls = 0;
let clock = 0;
let home = -1;
/**
 * The way this run's gone: each top it's sat on in turn, and -1 where it fell. Kept, in a place (one
 * with more than one way through it), with how long it took, so which ways get found, and where it
 * goes wrong, can be looked at after (the bench's panel shows the last few).
 */
let way: number[] = [0];
const WAY_WORDS: Record<string, string> = { pad: 'cloth', tray: 'tray', pancakes: 'pancakes', bin: 'bread bin', jelly: 'konjac', steamer: 'steamers', cereal: 'cereal box', honey: 'honey', goal: 'home' };
const wayWords = (w: number[]) => w.map((k) => (k < 0 ? 'splat' : WAY_WORDS[lv.towers[k].top] ?? lv.towers[k].top)).join(' → ');
const WAYS = () => `${STORE}:ways:${benchName ?? levelN}`;
function waysKept(): Array<{ way: string; t: number; falls: number }> { try { return JSON.parse(localStorage.getItem(WAYS()) ?? '[]'); } catch { return []; } }
let still = 0;
/** fallen: when it comes back */
let fallenAt = -1;
let simTime = 0;
/** when this level began (simTime), for what creeps as it goes on (honey); ?honeyt=s to see it later on */
let levelBorn = 0;
const HONEY_AHEAD = Number(params.get('honeyt')) || 0;
/** (while the honey's being settled: the collar, sheet and tubes for now, ?honeygeo=field the one-surface field
 * (honeyfield.ts) being worked on; the light through it by its thickness, ?honeyopt=old the old light, to compare) */
const HONEY_OLD_SHAPE = params.get('honeygeo') !== 'field', HONEY_OLD_LIGHT = params.get('honeyopt') === 'old';
/** each lid's lift last step (for the steam as one starts up); whether it was stuck to honey; when the autopilot last looked */
let lidWas: number[] = [];
let heldWas = false;
let aimedAt = -9;
/** what it was last coated with most, and which coatings it's been told about */
let coatWas: Dust = DUST.none;
const coatSaid = new Set<Dust>();
/**
 * The jelly bench's panel: which jelly, and how it gives (how fast it springs back, how much of
 * each wobble it keeps, how heavy, how far a dent spreads), changed as it's tried; and a drop onto
 * it from so high, to see it again.
 */
let benchPick = 1, benchDrop = 25;
function benchPanel() {
  if (benchName === 'breakfast') { waysPanel(); return; }
  if (benchName !== 'jelly' && benchName !== 'coats') return;
  const jellyBench = benchName === 'jelly';
  let el = document.getElementById('bench');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bench';
    document.body.appendChild(el);
    const st = document.createElement('style');
    st.textContent = `#bench { position: fixed; left: 8px; right: 8px; top: calc(max(12px, env(safe-area-inset-top)) + 44px); padding: 8px 10px; border-radius: 12px; background: rgba(30,22,14,.55); color: #fff; font: 12px/1.3 system-ui, sans-serif; display: grid; gap: 4px; z-index: 5; max-width: 420px; margin: 0 auto; }
      #bench .tabs { display: flex; gap: 6px; } #bench .tabs button, #bench .go { flex: 1; padding: 6px 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,.4); background: transparent; color: #fff; font: inherit; }
      #bench .tabs button.on { background: rgba(255,255,255,.85); color: #3a2a18; }
      #bench label { display: grid; grid-template-columns: 70px 1fr 44px; align-items: center; gap: 6px; } #bench input { width: 100%; }
      #bench .go { background: rgba(255,255,255,.85); color: #3a2a18; }`;
    document.head.appendChild(st);
  }
  const names = jellyBench ? ['panna cotta', 'mango pudding', 'konjac'] : ['flour', 'crumbs', 'pepper', 'sprinkles', 'butter'];
  benchPick = Math.min(benchPick, names.length - 1);
  const jl = jellyBench ? lv.jellies![benchPick].jel! : { feel: { hz: 0, zeta: 0, mass: 0, spread: 0, e: 0, soft: 0, deep: 0, slip: 0 } };
  type Row = [keyof typeof jl.feel | 'drop', string, number, number, number];
  const feelRows: Row[] = [['e', 'gives back', 0, 1, 0.01], ['slip', 'grip (slippery 0)', 0, 1, 0.01], ['soft', 'in, 10 cm', 0.05, 0.8, 0.01], ['deep', 'in, 50 cm', 0.1, 1, 0.01], ['hz', 'wobble Hz', 1, 14, 0.1], ['zeta', 'wobble damping', 0, 0.6, 0.005]];
  const rows: Row[] = [...(jellyBench ? feelRows : []), ['drop', 'drop cm', 5, 80, 1]];
  el.innerHTML = `<div class="tabs">${names.map((n, i) => `<button data-i="${i}" class="${i === benchPick ? 'on' : ''}">${n}</button>`).join('')}</div>`
    + rows.map(([k, label, lo, hi, step]) => `<label>${label}<input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${step}" value="${k === 'drop' ? benchDrop : jl.feel[k]}"><span>${(k === 'drop' ? benchDrop : jl.feel[k]).toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0)}</span></label>`).join('')
    + `<button class="go">drop it on the ${names[benchPick]}</button>`;
  el.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.addEventListener('click', () => { benchPick = Number(b.dataset.i); benchPanel(); }));
  el.querySelectorAll<HTMLInputElement>('input').forEach((inp) => inp.addEventListener('input', () => {
    const k = inp.dataset.k as keyof typeof jl.feel | 'drop', v = Number(inp.value);
    if (k === 'drop') benchDrop = v; else { jl.feel[k] = v; if (k === 'slip' && jellyBench) lv.jellies![benchPick].mu = v; }
    inp.nextElementSibling!.textContent = v.toFixed(Number(inp.step) < 0.01 ? 3 : Number(inp.step) < 0.1 ? 2 : Number(inp.step) < 1 ? 1 : 0);
  }));
  el.querySelector('.go')!.addEventListener('click', () => {
    const t = lv.towers[benchPick + 1];
    body.place([t.at[0], t.at[1] + REST_H + benchDrop, t.at[2]], camYaw + Math.PI);
    prevX = new Float32Array(body.x);
  });
}
function startLevel(n: number, quiet = false) {
  levelBorn = simTime;
  launchedFrom = null; retries = [];
  levelN = Math.max(1, n);
  if (lab && levelN >= JELLY_AT && !jellyOpen) {
    jellyOpen = true;
    try { localStorage.setItem(STORE + ':jelly', '1'); } catch { /* */ }
    if (!params.has('skin')) skin = 'jelly';
    showSkin();
  }
  lv = benchName ? bench(benchName) : buildLevel(levelN, levelSeed);
  levelFp = fingerprint(lv);
  drop(courseMesh); drop(glassMesh); drop(liquidMesh); drop(dripMesh); dripMesh = null; dripAt = -1; for (const h of honeyMeshes) drop(h.mesh); honeyMeshes = [];
  for (const m of susanMeshes.values()) drop(m);
  susanMeshes.clear();
  for (const m of movers) drop(m.mesh);
  for (const b of bubbles) drop(b.mesh);
  for (const jm of jellyMeshes) drop(jm.mesh);
  jellyMeshes = (lv.jellies ?? []).map((shape) => {
    const data = new Float32Array(jelMeshSize(shape.jel!, shape.mat === MAT.bread ? 0 : shape.dust)), def = new Float32Array((data.length / VSTRIDE) * 2);
    return { shape, data, def, mesh: upload(data, gl.DYNAMIC_DRAW, null, def), ripple: [0, 0, -99, 0], was: false };
  });
  const lm = levelMesh(lv);
  const solid = new Float32Array(lm.solid);
  courseMesh = upload(solid, gl.STATIC_DRAW, bakeLight(solid));
  glassMesh = lm.glass.length ? upload(lm.glass) : null;
  liquidMesh = lm.liquids.length ? upload(lm.liquids) : null;
  honeyRims = lm.honeyRims;
  honeyMeshes = lm.honeyBodies.map(h => ({mesh: upload(h.verts), center: h.center, radius: h.radius, bottom: h.bottom, top: h.top}));
  movers = lm.movers.map((m) => ({ shape: m.shape, mesh: upload(m.verts) }));
  bubbles = lm.bubbles.map((b) => ({ shape: b.shape, mesh: upload(b.verts), c0: [...b.shape.c] as V3, gone: -1, drift: null, until: 0 }));
  lidWas = movers.map(() => -1);
  drop(roomMesh);
  roomMesh = upload(room(lv));
  const at = lv.towers[0].at;
  // (set down a little above, to drop on: on a lid, its knob is under it)
  body = new Dumpling([at[0], at[1] + REST_H + 2, at[2]], skin);
  body.localStrainEnabled = !params.has('nostrain');
  prevX = new Float32Array(body.x);
  check = 0; falls = 0; clock = 0; home = -1; still = 0; fallenAt = -1; visited.clear(); $('done').classList.remove('on');
  way = [0];
  const n1 = lv.towers[nextTop(lv, 0)].at;
  camYaw = lv.walls?.length ? wallYaw(n1[0] - at[0]) : Math.atan2(n1[0] - at[0], n1[2] - at[2]);
  camTarget = [at[0], at[1] + 4, at[2]];
  steamSeed = 0;
  puffs.length = 0;
  ahead = 0;
  // (a level's first time: the way over it, from home back to the start; not when it's started over)
  fly = -1;
  if (!quiet && (!benchName || lv.route) && !preview && flown !== levelN && lv.towers.length > 1) { fly = 0; flyFor = Math.max(3, Math.min(6, 1.6 + 0.35 * lv.towers.length)); }
  flown = levelN;
  if (quiet) return;
  try { if (!auto && !benchName) localStorage.setItem(STORE + ':level', String(levelN)); } catch { /* */ }
  if (!auto && !benchName) history.replaceState(null, '', `?level=${levelN}`);
  showHands();
  showTitle();
  if (benchName === 'breakfast') { hint('the breakfast counter: home is the golden steamer, up high. more than one way there: find yours', 7000); benchPanel(); return; }
  if (benchName) { hint(benchName === 'jelly' ? 'land on each: a panna cotta, a mango pudding, a konjac jelly. tune them above' : benchName === 'look' ? 'a still life, to judge the light by' : benchName === 'supports' ? 'what things stand on: a stool, a cake stand, a board on jars, a crate, cookbooks, a bowl upturned, a tiered stand, a cooling rack' : 'flour, crumbs, pepper, sprinkles, butter: land hard on each, and look', 7000); benchPanel(); return; }
  hint(levelN === 1 ? 'take hold of the dumpling, drag back and let go: it flies the other way. drag anywhere else to look round' : levelN === 2 ? 'push the dumpling on, up the glass, and it rolls that way; tap it to poke it' : levelN === CHAPTER_AT.counter ? 'a shelf no flick reaches: land against the towel under it, and climb' : levelN === CHAPTER_AT.counter + 1 ? 'a rail: fly at it and you hang on. tap the dumpling to shimmy along; flick off at the end' : levelN === CHAPTER_AT.counter + 2 ? 'a sill\'s lip holds you too: catch it, shimmy along, flick off' : levelN === CHAPTER_AT.sink ? 'bubbles bounce you, then pop; steel slips; the water\'s a fall' : levelN === CHAPTER_AT.stove ? 'the stovetop. butter slides; a pan has a rim; hang from the oven\'s handle' : levelN === CHAPTER_AT.stove + 1 ? 'honey: land against the jar, and you stick. flick to let go' : levelN === CHAPTER_AT.stove + 2 ? 'a pot\'s lid rattles on the steam, then pops: don\'t sit on it long' : levelN === JELLY_AT ? 'a treat: it\'s jelly from here' : `level ${levelN}`);
}
/** The kitchen about the course: tiled walls on all sides, with windows, a little way off. */
function room(lv: Level): number[] {
  const out: number[] = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = 0;
  for (const t of lv.towers) { x0 = Math.min(x0, t.at[0]); x1 = Math.max(x1, t.at[0]); z0 = Math.min(z0, t.at[2]); z1 = Math.max(z1, t.at[2]); top = Math.max(top, t.at[1]); }
  // (round a table, the room is nearer, and its floor is far below)
  const m = lv.chapter === 'table' ? 150 : 220, g = lv.ground;
  x0 -= m; x1 += m; z0 -= m; z1 += m;
  // (in a kitchen, nothing past its wall: the room ends there)
  if (lv.kitchen) z1 = lv.kitchen.zb + 1;
  const H = top + 260 - g;
  const wall = (a: V3, b: V3, n: V3, windows = true) => {
    const d = sub(b, a), L = Math.hypot(d[0], d[2]), t = mul(d, 1 / L);
    const P = (s: number, y: number): V3 => add(add(a, mul(t, s)), [0, y, 0]);
    const q = (A: V3, B: V3, C: V3, D: V3, mat: number, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number]) => {
      for (const [p, uv] of [[A, ua], [B, ub], [C, uc], [A, ua], [C, uc], [D, ud]] as Array<[V3, [number, number]]>) out.push(p[0], p[1], p[2], n[0], n[1], n[2], mat, uv[0], uv[1]);
    };
    q(P(0, 0), P(0, H), P(L, H), P(L, 0), MAT.tiles, [0, 0], [0, H], [L, H], [L, 0]);
    // windows, every so far, their panes a little in front
    // (their sills a little above the counter, or the table)
    const w0 = lv.chapter === 'table' ? 85 : 60, w1 = w0 + 140;
    for (let s = 120; windows && s + 90 < L - 60; s += 260) {
      const o = mul(n, 0.5);
      q(add(P(s, w0), o), add(P(s, w1), o), add(P(s + 90, w1), o), add(P(s + 90, w0), o), 12, [0, 0], [0, 1], [1, 1], [1, 0]);
    }
  };
  wall([x0, g, z0], [x1, g, z0], [0, 0, 1]);
  wall([x1, g, z0], [x1, g, z1], [-1, 0, 0]);
  // (at the table, the kitchen's run along the back wall, its own windows)
  wall([x1, g, z1], [x0, g, z1], [0, 0, -1], lv.chapter !== 'table');
  wall([x0, g, z1], [x0, g, z0], [1, 0, 0]);
  // the counter (or the floor, under a table), to the walls
  const n: V3 = [0, 1, 0];
  const floor = lv.floorMat ?? (lv.chapter === 'counter' || lv.chapter === 'table' ? MAT.counter : MAT.hob);
  for (const [p, uv] of [[[x0, g, z0], [x0, z0]], [[x0, g, z1], [x0, z1]], [[x1, g, z1], [x1, z1]], [[x0, g, z0], [x0, z0]], [[x1, g, z1], [x1, z1]], [[x1, g, z0], [x1, z0]]] as Array<[V3, [number, number]]>) out.push(p[0], p[1], p[2], n[0], n[1], n[2], floor, uv[0], uv[1]);
  // the kitchen: along the counter the course is on, its cupboards, windows, range and fridge, and a table out in the
  // room behind you; at the table, the run along the back wall
  const k = lv.kitchen;
  if (k) {
    kitchenRun(out, { ...k, yt: 0, g });
    // (against the wall behind you, its chairs toward the counter, well clear of it)
    tableSet(out, (k.xa + k.xb) / 2 - 40, z0 + 44, g, 'front');
  } else if (lv.chapter === 'table') {
    const xm = (x0 + x1) / 2;
    kitchenRun(out, { xa: xm - 130, xb: xm + 130, zf: z1 - 62, zb: z1, yt: g + 90, g, avoid: [], top: MAT.counter });
  }
  return out;
}

// ─── aiming and the flick ────────────────────────────────────────────────────────────────────────
/** the pull: where the finger went down and where it is (and where it's been, lately); what it would do */
/**
 * A hold on the dumpling, as a gesture: pending till the finger's gone COMMIT px, then a pull (a flick) or a push (a
 * roll), by which way it went first, and that it stays for the rest of the drag (a pull may come round to aim any
 * way, toward you even; it doesn't turn into a push). Back into the middle, where it began: pending again, to start
 * over. Let go still pending, soon: a poke.
 */
let pull: { down: number; sx: number; sy: number; x: number; y: number; id: number; hist: Array<{ x: number; y: number; t: number }>; at: V3; kind: 'pending' | 'pull' | 'push' } | null = null;
const COMMIT = 18;
/** a finger on the glass but not on the dumpling: turning the camera round; and whether you've turned it (then it stays as you left it, until the next flick) */
let look: { id: number; x: number; y: number } | null = null;
let userCam = false;
let aimNow: { yaw: number; power: number; vel: V3; climb?: V3 } | null = null;
/** a flick asked for in the air: done on landing, if soon */
let buffered: { vel: V3; spin: number; until: number; climb?: V3 } | null = null;
function aimAt(x: number, y: number): typeof aimNow {
  if (!pull) return null;
  const dx = x - pull.sx, dy = y - pull.sy;
  const L = Math.hypot(dx, dy);
  // (a flick only if it's been pulled back, toward you or to the side; pushed on, up the glass, it's a roll: see pushAt)
  if (L < DEAD || pull.kind !== 'pull') return null;
  const fwd: V3 = [Math.sin(camYaw), 0, Math.cos(camYaw)];
  const right: V3 = [-fwd[2], 0, fwd[0]];
  const d = norm(sub(mul(fwd, dy), mul(right, dx)));
  const yaw = Math.atan2(d[0], d[2]);
  const power = Math.min(1, (L - 14) / (0.3 * Math.min(innerWidth, innerHeight)));
  // (clinging to a wall, and aimed into it: a climb, up it and over its top)
  const n = body.clinging ? body.wallN : null;
  if (n && d[0] * n[0] + d[2] * n[2] < -0.35) return { yaw, power, vel: climbLaunch(power), climb: n };
  return { yaw, power, vel: launch(yaw, power) };
}
/** the dead middle of a drag (px): nothing's aimed till it's out of it */
const DEAD = 14;
/** how far up the glass a drag on the dumpling has to go (of its length) to be a push, not a pull */
const PUSH_K = 0.15;
/** A push: the dumpling pushed on, up the glass (the way the finger goes), to roll it that way, as hard as it's pushed. */
let pushNow: { dir: V3; power: number; v: number } | null = null;
function pushAt(x: number, y: number): typeof pushNow {
  if (!pull) return null;
  const dx = x - pull.sx, dy = y - pull.sy, L = Math.hypot(dx, dy);
  if (L < DEAD || pull.kind !== 'push') return null;
  const fwd: V3 = [Math.sin(camYaw), 0, Math.cos(camYaw)], right: V3 = [-fwd[2], 0, fwd[0]];
  const dir = norm(add(mul(fwd, -dy), mul(right, dx)));
  const power = Math.min(1, (L - 14) / (0.32 * Math.min(innerWidth, innerHeight)));
  return { dir, power, v: ROLL_MIN + (ROLL_MAX - ROLL_MIN) * power };
}
function aimFromPull() { aimNow = pull ? aimAt(pull.x, pull.y) : null; pushNow = pull ? pushAt(pull.x, pull.y) : null; }
/**
 * Let go. A finger lifted still flicks as aimed. A finger swiped as it lets go gives spin: swiped
 * on, the way it will fly, topspin (it runs on when it lands); swiped back, backspin (it bites).
 * The aim is taken from before the swipe, so the swipe doesn't change where it goes.
 */
/** a snap: how fast (px/s) a let-go has to leave where the finger was held, how soon (ms), how far (px); and how still
 * (px/s, over HOLD_MS) the finger had to be, to have been held there */
const SNAP_V = 600, SNAP_MS = 160, SNAP_PX = 25, HOLD_V = 150, HOLD_MS = 80;
/** Looking back from a let-go: the last place the finger was held still, if it was snapped away from there just
 * before it let go; how far and how fast. A steady pull let go of while moving isn't a snap: it was never held. */
function snapOf(h: Array<{ x: number; y: number; t: number }>, now: number): { x: number; y: number; dx: number; dy: number; speed: number } | null {
  const end = h[h.length - 1];
  for (let k = h.length - 2; k >= 0; k--) {
    const p = h[k];
    if (now - p.t > SNAP_MS) return null;
    // (still, about here: over the HOLD_MS before it, hardly moved)
    let i = k;
    while (i > 0 && p.t - h[i].t < HOLD_MS) i--;
    const span = p.t - h[i].t;
    if (span < HOLD_MS * 0.6) continue;
    if (Math.hypot(p.x - h[i].x, p.y - h[i].y) / (span / 1000) > HOLD_V) continue;
    const dx = end.x - p.x, dy = end.y - p.y, dist = Math.hypot(dx, dy), speed = dist / (Math.max(16, now - p.t) / 1000);
    return dist >= SNAP_PX && speed >= SNAP_V ? { x: p.x, y: p.y, dx, dy, speed } : null;
  }
  return null;
}
function release() {
  if (!pull) return;
  const now = performance.now();
  // (pushed on: a roll, that way, as hard as it was pushed)
  const push = pushAt(pull.x, pull.y);
  if (push) {
    pull = null; aimNow = null; pushNow = null; body.squeeze = null;
    // (hanging from a rail: a push along it shimmies it that way, the further the harder)
    const rl = body.onRail;
    if (rl && home < 0 && fallenAt < 0) { const ax = railAxis(rl); body.shimmy(Math.sign(push.dir[0] * ax[0] + push.dir[2] * ax[2]) || 1, 1 + 2 * push.power); pop(0.2); }
    else if (home < 0 && fallenAt < 0 && body.canFlick) { launching(); body.roll(push.dir, push.v); userCam = false; pop(0.25 + push.power * 0.3); }
    return;
  }
  // (let go: a flick from where the finger is — unless it was held still and then snapped away, just before: then the
  // flick's from where it was held, and the snap's its spin, on the way it'll go, topspin; back, backspin)
  let a = aimAt(pull.x, pull.y), spin = 0;
  const snap = snapOf(pull.hist, now);
  if (snap) {
    const held = aimAt(snap.x, snap.y);
    const fx = pull.sx - snap.x, fy = pull.sy - snap.y, fl = Math.hypot(fx, fy) || 1;
    const along = (snap.dx * fx + snap.dy * fy) / fl;
    if (held && Math.abs(along) > 0.5 * Math.hypot(snap.dx, snap.dy)) { a = held; spin = Math.sign(along) * Math.min(1, 0.5 + (snap.speed - SNAP_V) / 1200); }
  }
  const dragged = Math.hypot(pull.x - pull.sx, pull.y - pull.sy);
  pull = null; aimNow = null; pushNow = null;
  body.squeeze = null;
  if (!a || a.power < 0.02 || home >= 0 || fallenAt >= 0) return;
  // (kept, for the Level Lab: from where, as dragged, and what the ring said)
  if (body.canFlick && !auto && !benchName) logFlick({ t: Date.now(), level: levelN, seed: levelSeed, fp: levelFp, skin, from: check, yaw: a.yaw, power: a.power, spin, drag: dragged, vw: innerWidth, vh: innerHeight, camYaw, aim: aimFor(levelN), reset: resetMode, ring: !aimShows().ring ? null : aimLand ? towerAt(lv, aimLand, 0.5) : -1 }, { to: ((k) => (k >= 0 ? k : -2))(towerAt(lv, body.com, 1)), at: body.com });
  if (body.canFlick) doFlick(a.vel, spin, a.climb);
  else buffered = { vel: a.vel, spin, until: simTime + 0.35, climb: a.climb };
}
function doFlick(vel: V3, spin = 0, climb?: V3) {
  launching();
  body.flick(vel, climb ? 0 : spin, climb ?? null);
  userCam = false;
  buffered = null;
  pop(0.4 + len(vel) / 500);
  if (Math.abs(spin) > 0.1) hint(spin > 0 ? 'topspin: it runs on' : 'backspin: it bites', 1400);
}

// ─── the camera ──────────────────────────────────────────────────────────────────────────────────
const eye: V3 = [0, 30, -40];
let camTarget: V3 = [0, 20, 0];
let camYaw = 0;
let orbit = { yaw: 0, pitch: 0, at: -9 };
let zoom = 1;
/** winding up: how far the camera's gone over to framing the flick (0–1), what it's looking at then, and how far back it wants to be */
let framed = 0, aimMid: V3 | null = null, wantFrame = 44;
/** where the aim last said it would land, for the camera */
let aimLand: V3 | null = null, aimTop: V3 | null = null;
/** (the dots of a bounce off a jelly: how far apart, cm) */
const BOUNCE_GAP = 2.4;
/** how much the camera's drawn back to take in the next top as well (0–1): when it's sat still on a top */
let ahead = 0;
/**
 * The way over a level as it opens: from above home, back along the course, top by top, down to the
 * start (`fly`: how far through it, in seconds; -1 once it's done, or a touch cut it short). Once a
 * level; again, after a fall or a start over, it isn't.
 */
let fly = -1, flyFor = 0, flown = -1;
const ease = (x: number) => x * x * (3 - 2 * x);
function flyCamera(dt: number) {
  fly += dt;
  const T = lv.route ? lv.route.map((k) => lv.towers[k]) : lv.towers, u = ease(Math.min(1, fly / flyFor));
  // (the course from home back to the start, as a path through its tops)
  const f = (1 - u) * (T.length - 1), i = Math.min(T.length - 2, Math.floor(f)), k = f - i, a = T[i].at, b = T[i + 1].at;
  const p: V3 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k + 3, a[2] + (b[2] - a[2]) * k];
  // (high and far at first, coming down and in to where play begins)
  const pitch = 0.95 - 0.45 * u, dist = 150 - 100 * u;
  const back: V3 = [-Math.sin(camYaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(camYaw) * Math.cos(pitch)];
  const kk = 1 - Math.exp(-dt * 6);
  for (let j = 0; j < 3; j++) camTarget[j] += (p[j] - camTarget[j]) * (fly < dt * 1.5 ? 1 : kk);
  const want = add(camTarget, mul(back, dist));
  for (let j = 0; j < 3; j++) eye[j] += (want[j] - eye[j]) * (fly < dt * 1.5 ? 1 : kk);
  if (fly >= flyFor) fly = -1;
}
function updateCamera(dt: number) {
  if (mode === 'title') { titleCamera(dt); return; }
  if (mode === 'pause') return;
  if (fly >= 0) { flyCamera(dt); return; }
  // (it follows easily; but if it's got near the edge of the glass, or off it, it catches up at once)
  const on = screenOf(body.com);
  const off = !on || on[0] < innerWidth * 0.12 || on[0] > innerWidth * 0.88 || on[1] < innerHeight * 0.1 || on[1] > innerHeight * 0.82;
  const k = 1 - Math.exp(-dt * (off ? 22 : 5));
  // (sat still on a top, and not home: the camera looks a little toward the next, and stands back far enough to see it too)
  // (from the top it's on now, not the last it sat on: gone on along the ground past some, it isn't turned back to them;
  // on the ground, or hanging on something, it doesn't look ahead at all, it only follows)
  const onTop = towerAt(lv, body.com, 1);
  const nxt = lv.towers[nextTop(lv, onTop >= 0 ? onTop : check)];
  const settled = onTop >= 0 && body.contacts > 0 && len(body.vcom) < 8 && home < 0 && !userCam;
  ahead += ((settled ? 1 : 0) - ahead) * (1 - Math.exp(-dt * (settled ? 1.2 : 4)));
  const toNext = sub(nxt.at, body.com), sep = Math.hypot(toNext[0], toNext[2]);
  let want = add(add(body.com, [0, 3, 0]), mul(toNext, 0.5 * ahead * Math.min(1, 110 / Math.max(1, sep))));
  // (winding up a flick: it follows where it'll land, looking between the two, the landing and the dumpling both in view)
  const framing = !!aimNow && !!aimLand;
  framed += ((framing ? 1 : 0) - framed) * (1 - Math.exp(-dt * (framing ? 3 : 2)));
  if (aimNow && aimLand) aimMid = add(mul(add(body.com, aimLand), 0.5), [0, 3, 0]);
  if (aimMid) want = add(mul(want, 1 - framed), mul(aimMid, framed));
  if (framed < 0.01 && !framing) aimMid = null;
  for (let i = 0; i < 3; i++) camTarget[i] += (want[i] - camTarget[i]) * (1 - Math.exp(-dt * (framing ? 4 : off ? 22 : ahead > 0.01 && ahead < 0.99 ? 3 : 5)));
  // (turned toward the next top, when it's sat still and no one's turning the camera)
  if (!pull && !userCam && onTop >= 0 && body.contacts > 0 && simTime - orbit.at > 2.5 && home < 0) {
    const nx = lv.towers[nextTop(lv, onTop)];
    const wantYaw = lv.walls?.length ? wallYaw(nx.at[0] - body.com[0]) : Math.atan2(nx.at[0] - body.com[0], nx.at[2] - body.com[2]);
    let dy = wantYaw - camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    camYaw += dy * (1 - Math.exp(-dt * 1.4));
  }
  // (looking down on the counter a little more than across it, so the wall behind doesn't take half the glass; winding up, a little more)
  const pitch = Math.max(0.12, Math.min(1.2, (lv.walls?.length ? 0.56 : 0.48) + orbit.pitch + 0.1 * framed));
  const back: V3 = [-Math.sin(camYaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(camYaw) * Math.cos(pitch)];
  let dist = Math.max(44, Math.min(120, 34 + sep * 0.95) * ahead + 44 * (1 - ahead)) / zoom;
  // (and back far enough that the dumpling, where it'll land, and the top of the way there are all on the glass)
  if (aimMid && framed > 0.001) {
    const f = mul(back, -1), right = norm(cross(f, [0, 1, 0])), upv = cross(right, f);
    const tv = Math.tan(0.45), th = tv * (innerWidth / innerHeight);
    let need = dist;
    for (const p of [body.com, aimLand ?? body.com, aimTop ?? body.com]) {
      const o = sub(p, camTarget), x = dot(o, right), y = dot(o, upv), z = dot(o, back);
      need = Math.max(need, z + Math.abs(x) / (th * 0.78) + RADIUS, z + Math.abs(y) / (tv * 0.7) + RADIUS);
    }
    wantFrame += (Math.min(260, need) - wantFrame) * (1 - Math.exp(-dt * 3));
    dist += (Math.max(dist, wantFrame) - dist) * framed;
  } else wantFrame = dist;
  // (wherever it's turned, even out past a wall: a wall seen from behind isn't drawn, and whatever else comes between
  // the camera and the dumpling is screened, so the room's never in the way — a cutaway, a dollhouse)
  const wantEye = add(camTarget, mul(back, dist));
  for (let i = 0; i < 3; i++) eye[i] += (wantEye[i] - eye[i]) * (1 - Math.exp(-dt * (off ? 20 : 8)));
}
/**
 * Along a counter against a wall, the camera looks at the wall, a little the way the course goes
 * on (dx: how far on the next top is, along the counter): three-quarters on, the wall behind it all,
 * what's ahead to one side and what's climbed face on; not round at the next top, which in a place
 * is as often in the way.
 */
function wallYaw(dx: number): number { return Math.atan2(0.62 * (dx < 0 ? -1 : 1), 0.78); }

// ─── hands ───────────────────────────────────────────────────────────────────────────────────────
const pointers = new Map<number, { x: number; y: number }>();
let two: { d: number; cx: number; cy: number } | null = null;
/**
 * Which bit of the dumpling is under a point on the glass, if any: of its particles near the
 * point (as seen, give or take a fingertip), the one nearest the camera. Its index, or -1.
 */
function pick(x: number, y: number, b: Dumpling = body): number {
  const reach = Math.max(26, 0.12 * Math.min(innerWidth, innerHeight));
  let near = Infinity;
  const sx = new Float32Array(b.n), sy = new Float32Array(b.n), ok = new Uint8Array(b.n);
  for (let i = 0; i < b.n; i++) {
    const s2 = screenOf([b.x[i * 3], b.x[i * 3 + 1], b.x[i * 3 + 2]]);
    if (!s2) continue;
    sx[i] = s2[0]; sy[i] = s2[1]; ok[i] = 1;
    near = Math.min(near, Math.hypot(s2[0] - x, s2[1] - y));
  }
  if (near > reach) return -1;
  // (of those as near as the nearest, give or take, the one on the side facing you)
  let best = -1, bd = Infinity;
  for (let i = 0; i < b.n; i++) {
    if (!ok[i] || Math.hypot(sx[i] - x, sy[i] - y) > near + 14) continue;
    const d = len(sub([b.x[i * 3], b.x[i * 3 + 1], b.x[i * 3 + 2]], eye));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
canvas.addEventListener('pointerdown', (e) => {
  wake();
  if (mode === 'title') { toyDown(e); return; }
  if (mode === 'pause') return;
  // (the way over the level, cut short by a touch, which goes on to be what it would be: from there, play)
  if (fly >= 0) fly = -1;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1 && !auto) {
    // on the dumpling: take hold of it (a drag is a flick, a tap a poke); anywhere else: the camera
    const i = home < 0 && fallenAt < 0 ? pick(e.clientX, e.clientY) : -1;
    if (i >= 0) {
      pull = { down: e.timeStamp, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, id: e.pointerId, hist: [{ x: e.clientX, y: e.clientY, t: performance.now() }], at: [body.x[i * 3], body.x[i * 3 + 1], body.x[i * 3 + 2]], kind: 'pending' };
      body.grab = { w: body.hold(i), pull: [0, 0, 0] };
      squish(0.15);
    } else look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  } else { pull = null; aimNow = null; pushNow = null; body.squeeze = null; body.grab = null; look = null; two = null; }
});
canvas.addEventListener('pointermove', (e) => {
  if (toy && toy.id === e.pointerId) { toyMove(e); return; }
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size >= 2) {
    // two fingers: turn the camera round, tilt it, come close
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    if (two) {
      zoom = Math.max(0.5, Math.min(2.5, zoom * (d / two.d)));
      camYaw -= (cx - two.cx) * 0.008;
      orbit.pitch = Math.max(-0.3, Math.min(0.7, orbit.pitch + (cy - two.cy) * 0.004));
      orbit.at = simTime; userCam = true;
    }
    two = { d, cx, cy };
    return;
  }
  if (look && look.id === e.pointerId) {
    // one finger off the dumpling: round it, and up and down
    camYaw -= (e.clientX - look.x) * 0.009;
    orbit.pitch = Math.max(-0.3, Math.min(0.75, orbit.pitch + (e.clientY - look.y) * 0.004));
    orbit.at = simTime; userCam = true;
    look.x = e.clientX; look.y = e.clientY;
  }
  if (pull && pull.id === e.pointerId) {
    pull.x = e.clientX; pull.y = e.clientY;
    pull.hist.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    while (pull.hist.length > 2 && performance.now() - pull.hist[0].t > 700) pull.hist.shift();
    // (committed, once it's gone far enough, by which way; back to the middle, undecided again)
    const dx = pull.x - pull.sx, dy = pull.y - pull.sy, L = Math.hypot(dx, dy);
    if (pull.kind === 'pending' && L > COMMIT) pull.kind = dy < -PUSH_K * L ? 'push' : 'pull';
    else if (pull.kind !== 'pending' && L < DEAD) pull.kind = 'pending';
  }
});
const up = (e: PointerEvent) => {
  if (toy && toy.id === e.pointerId) { toyUp(e); return; }
  pointers.delete(e.pointerId);
  if (pointers.size < 2) two = null;
  if (look && look.id === e.pointerId) look = null;
  if (pull && pull.id === e.pointerId) {
    // (a tap on it, not a pull: a poke, where it was touched, the way the finger was going into the glass)
    const moved = Math.hypot(pull.x - pull.sx, pull.y - pull.sy);
    body.grab = null;
    if (e.type === 'pointerup' && pull.kind === 'pending' && moved < 12 && e.timeStamp - pull.down < 300 && two === null) { pokeAt(pull.at); pull = null; aimNow = null; pushNow = null; body.squeeze = null; }
    else if (e.type === 'pointerup') release(); else { pull = null; aimNow = null; pushNow = null; body.squeeze = null; }
  }
};
// ─── on the title: the two of them to squish and stretch, where they sit ───────────────────────────
/** the one held on the title: by which finger, where it went down and is now, when, and the bit of it touched */
let toy: { b: Dumpling; id: number; sx: number; sy: number; x: number; y: number; t0: number; at: V3 } | null = null;
/** when either was last touched on the title (they don't hop about while you're playing with them) */
let toyAt = -9;
function toyDown(e: PointerEvent) {
  if (toy) return;
  // (whichever is under the finger, the nearer if both)
  let best: { b: Dumpling; i: number; d: number } | null = null;
  for (const b of [body, buddy]) {
    if (!b) continue;
    const i = pick(e.clientX, e.clientY, b);
    if (i < 0) continue;
    const at = screenOf([b.x[i * 3], b.x[i * 3 + 1], b.x[i * 3 + 2]])!;
    const d = Math.hypot(at[0] - e.clientX, at[1] - e.clientY);
    if (!best || d < best.d) best = { b, i, d };
  }
  if (!best) return;
  canvas.setPointerCapture(e.pointerId);
  const { b, i } = best;
  toy = { b, id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp, at: [b.x[i * 3], b.x[i * 3 + 1], b.x[i * 3 + 2]] };
  b.grab = { w: b.hold(i), pull: [0, 0, 0] };
  toyAt = simTime;
  squish(0.15);
}
/** Stretched: the held bit drawn after the finger, across the glass at its depth, so far and no further. */
function toyMove(e: PointerEvent) {
  if (!toy || !toy.b.grab) return;
  toy.x = e.clientX; toy.y = e.clientY;
  const fwd = norm(sub(camTarget, eye)), right = norm(cross(fwd, [0, 1, 0])), upv = cross(right, fwd);
  const px = (len(sub(toy.at, eye)) * 2 * Math.tan(0.45)) / innerHeight;
  let d = add(mul(right, (toy.x - toy.sx) * px), mul(upv, (toy.sy - toy.y) * px));
  const L = len(d);
  if (L > TOY_REACH) d = mul(d, TOY_REACH / L);
  toy.b.grab.pull = d;
  toyAt = simTime;
}
function toyUp(e: PointerEvent) {
  if (!toy) return;
  const { b } = toy;
  b.grab = null;
  // (a tap: a poke, a dent and a wobble, where it is; no rolling off)
  if (e.type === 'pointerup' && Math.hypot(toy.x - toy.sx, toy.y - toy.sy) < 12 && e.timeStamp - toy.t0 < 300) { b.poke(toy.at, norm(sub(toy.at, eye)), false); pop(0.3); }
  else if (e.type === 'pointerup') squish(0.4);
  toy = null;
  toyAt = simTime;
}
/** how far the title's two can be stretched (cm) */
const TOY_REACH = 6;
/** A poke: at the bit of it touched, along the line from your eye through it. */
function pokeAt(at: V3) {
  if (auto || home >= 0 || fallenAt >= 0 || !body.canFlick) return;
  launching();
  // (a finger pushes the dough where it touches it, square to its skin there: in from that point toward its middle,
  // a little along the line of sight; harder met square on — a glancing poke, a little over half as hard. Its side, it
  // goes the other way; low on its near side, it lifts as it goes; its top, it's mostly squashed)
  const ray = norm(sub(at, eye)), inward = norm(sub(body.com, at));
  const square = 0.6 + 0.4 * Math.max(0, ray[0] * inward[0] + ray[1] * inward[1] + ray[2] * inward[2]);
  // (the dent as it was; what it carries on with, half: a poke nudges, a push rolls)
  body.poke(at, norm(add(mul(inward, 0.8), mul(ray, 0.2))), true, square, 0.5);
  pop(0.3);
}
/** Where a point is on the glass (pixels), if it's in front of the camera. */
/** (the last frame's view and projection: where things are on the glass) */
let lastVP: Float32Array | null = null;
function screenOf(p: V3): [number, number] | null {
  if (!lastVP) return null;
  const m = lastVP;
  const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (cw <= 0) return null;
  return [((cx / cw) * 0.5 + 0.5) * innerWidth, (0.5 - (cy / cw) * 0.5) * innerHeight];
}
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.5, Math.min(2.5, zoom * Math.exp(-e.deltaY * 0.0012))); }, { passive: false });
addEventListener('keydown', (e) => {
  if (mode === 'title') { if (e.key === 'Enter') play(1); return; }
  if (mode === 'pause') { if (e.key === 'Enter' || e.key === 'Escape') resume(); return; }
  if (fly >= 0) fly = -1;
  if (e.key === 'ArrowLeft') { camYaw += 0.15; orbit.at = simTime; }
  else if (e.key === 'ArrowRight') { camYaw -= 0.15; orbit.at = simTime; }
  else if (e.key.toLowerCase() === 'r') startLevel(levelN);
});
const btn = (id: string, f: () => void) => $(id).addEventListener('click', (e) => { e.stopPropagation(); wake(); f(); });
btn('again', () => startLevel(levelN));
btn('next', () => startLevel(levelN + 1));
btn('prev', () => startLevel(levelN - 1));
btn('nextw', () => startLevel(levelN + 1));
btn('skin', () => {
  // (jelly ⇄ dough: the new one set down where the old one was)
  skin = skin === 'jelly' ? 'dough' : 'jelly';
  try { localStorage.setItem(STORE + ':skin', skin); } catch { /* */ }
  const at = body.com;
  body = new Dumpling([at[0], at[1] + 0.5, at[2]], skin);
  body.localStrainEnabled = !params.has('nostrain');
  prevX = new Float32Array(body.x);
  showSkin();
});
function showSkin() { $('skin').textContent = skin; $('skin').style.display = lab && (jellyOpen || params.has('skin')) ? '' : 'none'; }
// (a level back or on, from the foot of the glass: the lab's)
if (!lab) for (const id of ['prev', 'nextw']) $(id).style.display = 'none';
showSkin();
function toggleSound() {
  setSound(!soundOn);
  $('sound').textContent = soundOn ? 'sound on' : 'sound off';
  showMenu();
}
btn('sound', toggleSound);

// ─── the title: the name, New Game, Continue, Settings; the place behind it, the dumpling and its friend ─────
/** the title or playing; on the title, which way the camera looks (toward the course), the level the settings would start, and which card is up */
let mode: 'title' | 'play' | 'pause' = auto || benchName || params.has('level') || params.has('skin') ? 'play' : 'title';
let titleYaw = 0, pickN = 1, card: 'main' | 'settings' | 'benches' = 'main';
let hopAt = 2.5, hopWho = 0;
const saved = () => { try { return Number(localStorage.getItem(STORE + ':level')) || 0; } catch { return 0; } };
$('logo').innerHTML = logoSVG();
/**
 * The title: the first place laid out behind it, the dumpling sat on the cloth it starts on, and
 * beside it the other kind (the jelly, while it's still to come), both turned to you.
 */
function startTitle() {
  mode = 'title';
  document.body.classList.add('title');
  startLevel(1, true);
  const pad = lv.towers[0].at, nx = lv.towers[1].at;
  titleYaw = Math.atan2(nx[0] - pad[0], nx[2] - pad[2]);
  // (side by side across the view: the dough on the left)
  const right: V3 = [-Math.cos(titleYaw), 0, Math.sin(titleYaw)];
  const y = pad[1] + REST_H + 1.2;
  // (set down already turned to the camera, which looks along titleYaw)
  const face = titleYaw + Math.PI;
  body.place([pad[0] - right[0] * 3.9, y, pad[2] - right[2] * 3.9], face);
  buddy = new Dumpling([0, 0, 0], skin === 'jelly' ? 'dough' : 'jelly');
  buddy.localStrainEnabled = !params.has('nostrain');
  buddy.place([pad[0] + right[0] * 4.2, y, pad[2] + right[2] * 4.2], face);
  prevX = new Float32Array(body.x); buddyPrev = new Float32Array(buddy.x);
  seats = [{ b: body, at: [...body.com] as V3, face }, { b: buddy, at: [...buddy.com] as V3, face }];
  toy = null;
  pickN = Math.max(1, saved() || 1);
  hopAt = simTime + 2;
  card = 'main';
  showMenu();
}
/** where the title's two sit: they're kept there, so a stretch or a poke never sends them off */
let seats: Array<{ b: Dumpling; at: V3; face: number; peak?: number }> = [];
/** On the title, each drawn gently back to its seat when it's not held; off the cloth altogether, set back down. */
function keepSeated(dt: number) {
  for (const s of seats) {
    const b = s.b, dx = s.at[0] - b.com[0], dz = s.at[2] - b.com[2];
    // (how hard it's jiggled lately, its skin moving about its middle, for the checks)
    let jig = 0;
    for (let i = 0; i < b.n; i++) jig = Math.max(jig, Math.hypot(b.v[i * 3] - b.vcom[0], b.v[i * 3 + 1] - b.vcom[1], b.v[i * 3 + 2] - b.vcom[2]));
    s.peak = Math.max((s.peak ?? 0) * Math.exp(-dt), jig);
    if (b.com[1] < s.at[1] - 8 || Math.hypot(dx, dz) > 12) { b.place(s.at, s.face); continue; }
    if (b.grab) continue;
    const k = Math.min(1, dt * 2);
    for (let i = 0; i < b.n; i++) { b.x[i * 3] += dx * k; b.x[i * 3 + 2] += dz * k; }
  }
}
/** Off the title, into level n. */
function play(n: number) {
  mode = 'play';
  buddy = null; toy = null; seats = [];
  document.body.classList.remove('title', 'paused');
  startLevel(n);
}
/** The title's cards as they are: Continue only with somewhere to continue to; the settings' values. */
function showMenu() {
  if (mode !== 'title' && mode !== 'pause') return;
  const paused = mode === 'pause';
  $('resume').hidden = !paused;
  $('resume').innerHTML = `Resume<small>level ${levelN}</small>`;
  $('totitle').hidden = !paused;
  document.getElementById('menu')!.classList.toggle('deep', card !== 'main');
  $('main').hidden = card !== 'main';
  $('settings').hidden = card !== 'settings';
  $('benches').hidden = card !== 'benches';
  $('s-ring').textContent = AIM_WORDS[aimMode];
  $('s-reset').textContent = RESET_WORDS[resetMode];
  $('s-aim').textContent = AIM_ABOUT[aimMode];
  const at = saved();
  const cont = $('cont');
  cont.hidden = at <= 1 || paused;
  cont.innerHTML = `Continue<small>level ${at}</small>`;
  $('s-sound').textContent = soundOn ? 'on' : 'off';
  const sk = $('s-skin');
  sk.textContent = jellyOpen ? skin : 'dough';
  sk.classList.toggle('off', !jellyOpen);
  sk.title = jellyOpen ? '' : `the jelly comes at level ${JELLY_AT}`;
  $('s-level').textContent = String(pickN);
  $('s-place').textContent = `${CHAPTER_NAME[chapterOf(pickN)]}${jellyOpen ? '' : ` · jelly from level ${JELLY_AT}`}`;
  $('s-play').textContent = `Play level ${pickN}`;
}
btn('new', () => play(1));
btn('cont', () => play(saved()));
btn('opts', () => { card = 'settings'; showMenu(); });
btn('s-back', () => { card = 'main'; showMenu(); });
btn('s-play', () => play(pickN));
btn('s-sound', toggleSound);
btn('s-ring', () => {
  aimMode = AIMS[(AIMS.indexOf(aimMode) + 1) % AIMS.length];
  try { localStorage.setItem(STORE + ':aim', aimMode); } catch { /* */ }
  showMenu();
});
btn('s-reset', () => {
  resetMode = RESETS[(RESETS.indexOf(resetMode) + 1) % RESETS.length];
  try { localStorage.setItem(STORE + ':reset', resetMode); } catch { /* */ }
  showMenu();
});
btn('s-benches', () => { card = 'benches'; showMenu(); });
btn('b-back', () => { card = 'settings'; showMenu(); });
/** the benches, listed: each opens as a page of its own (?bench=…), with the dumpling as chosen */
$('b-list').innerHTML = BENCHES.map((b) => `<button data-bench="${b.name}">${b.title}<small>${b.about}</small></button>`).join('');
$('b-list').addEventListener('click', (ev) => {
  const b = (ev.target as Element).closest('[data-bench]') as HTMLElement | null;
  if (b) location.search = `?bench=${b.dataset.bench}${jellyOpen ? `&skin=${skin}` : ''}`;
});
btn('s-prev', () => { pickN = Math.max(1, pickN - 1); showMenu(); });
btn('s-next', () => { pickN = Math.min(lab ? 24 : Math.min(24, reachedNow()), pickN + 1); showMenu(); });
btn('s-skin', () => {
  if (!jellyOpen) return;
  if (mode === 'pause') { $('skin').click(); showMenu(); return; }
  skin = skin === 'jelly' ? 'dough' : 'jelly';
  try { localStorage.setItem(STORE + ':skin', skin); } catch { /* */ }
  showSkin();
  startTitle();
  card = 'settings';
  showMenu();
});
/** The menu in play: the level held where it is behind it (nothing moves, the clock stops), to change a setting and
 * come back to, or to leave. From a bench, the game's own title: the bench was a page of its own. */
function pause() {
  if (benchName) { location.search = ''; return; }
  mode = 'pause';
  pull = null; aimNow = null; pushNow = null; body.squeeze = null;
  document.body.classList.add('title', 'paused');
  card = 'main';
  pickN = levelN;
  showMenu();
}
function resume() {
  if (mode !== 'pause') return;
  mode = 'play';
  document.body.classList.remove('title', 'paused');
}
btn('tomenu', pause);
/** The flick log, copied: a double tap on the time up in the corner puts every flick kept on this device on the
 * clipboard, as JSON, to paste wherever it's wanted; a word says so. */
async function copyFlicks() {
  const flicks = readFlicks();
  const text = JSON.stringify({ kind: 'squishy-flicks', exported: new Date().toISOString(), level: levelN, seed: levelSeed, fp: levelFp, aim: aimFor(levelN), reset: resetMode, screen: [innerWidth, innerHeight, devicePixelRatio], agent: navigator.userAgent, flicks });
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    // (no clipboard access: the old way, through a selection)
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { /* */ }
    ta.remove();
  }
  const st = $('status');
  st.classList.remove('copied'); void st.offsetWidth; st.classList.add('copied');
  hint(ok ? `flick log copied: ${flicks.length} flick${flicks.length === 1 ? '' : 's'}` : 'couldn\'t copy the flick log', 2600);
}
{
  let lastTap = 0;
  $('status').addEventListener('pointerup', (e) => {
    e.stopPropagation();
    const now = performance.now();
    if (now - lastTap < 400) { lastTap = 0; void copyFlicks(); } else lastTap = now;
  });
}
btn('resume', resume);
// (from the paused menu, the title itself: the level left)
btn('totitle', () => { document.body.classList.remove('paused'); startTitle(); });
/** On the title: the two of them sat there, now and then one hopping, a little, where it is. */
function titleTick(dt: number) {
  body.step(lv, dt, simTime);
  buddy?.step(lv, dt, simTime);
  keepSeated(dt);
  simTime += dt;
  // (left alone a while, now and then one hops)
  if (simTime - toyAt < 8) hopAt = Math.max(hopAt, simTime + 2);
  if (simTime > hopAt) {
    const b = hopWho++ % 2 === 0 ? buddy : body;
    if (b && b.canFlick) b.flick([0, 90 + 40 * Math.random(), 0]);
    hopAt = simTime + 2.2 + Math.random() * 2.6;
  }
}
/** On the title: from behind the cloth, low, toward the spoon and the bench, swaying a little; the two of them low on the glass, under the name. */
function titleCamera(dt: number) {
  const pad = lv.towers[0].at;
  const yaw = titleYaw + 0.2 * Math.sin(time * 0.13);

  const want: V3 = [pad[0], pad[1] + 8, pad[2]];
  const pitch = 0.22, dist = innerWidth > innerHeight ? 34 : 27;
  const back: V3 = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const k = 1 - Math.exp(-dt * 3);
  for (let i = 0; i < 3; i++) camTarget[i] += (want[i] - camTarget[i]) * k;
  const wantEye = add(want, mul(back, dist));
  for (let i = 0; i < 3; i++) eye[i] += (wantEye[i] - eye[i]) * k;
  camYaw = yaw;
}
function showHands() {
  document.body.classList.toggle('home', home >= 0);
  $('level').textContent = `level ${levelN}`;
}
/** the place's name, as a card when a level starts: spaced capitals, a rule under, fading */
let titleTimer = 0;
function showTitle() {
  const el = $('title');
  el.querySelector('b')!.textContent = benchName ? `the ${benchName} bench` : CHAPTER_NAME[lv.chapter];
  const rec = benchName ? null : recordOf(levelN);
  el.querySelector('i')!.textContent = benchName ? 'try it, again and again' : `${levelN}${rec?.score ? ` · best ${rec.score}` : rec ? ` · best ${rec.bestTime.toFixed(1)} s` : ''}`;
  el.classList.add('on');
  clearTimeout(titleTimer);
  titleTimer = window.setTimeout(() => el.classList.remove('on'), 3200);
}
let hintTimer = 0;
function hint(text: string, ms = 5000) {
  const el = $('hint');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => el.classList.remove('on'), ms);
}

$('sound').textContent = soundOn ? 'sound on' : 'sound off';

// ─── steam and flour ────────────────────────────────────────────────────────────────────────────
interface Puff { p: V3; v: V3; age: number; life: number; size: number; a: number }
const puffs: Puff[] = [];
let steamSeed = 0;
const puffBuf = gl.createBuffer()!;
const puffVao = gl.createVertexArray()!;
gl.bindVertexArray(puffVao);
gl.bindBuffer(gl.ARRAY_BUFFER, puffBuf);
{ const loc = gl.getAttribLocation(puffProg, 'aP'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0); }
gl.bindVertexArray(null);
function updatePuffs(dt: number) {
  // steam from home, always; from the dumpling, when it's home
  const r = seeded(hash(++steamSeed, 7));
  const goal = lv.towers[lv.towers.length - 1];
  const rate = home >= 0 ? 3 : 1;
  for (let i = 0; i < rate; i++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * goal.r * 0.8;
    puffs.push({ p: [goal.at[0] + Math.cos(a) * rr, goal.at[1] + 1, goal.at[2] + Math.sin(a) * rr], v: [(r() - 0.5) * 4, 10 + r() * 8, (r() - 0.5) * 4], age: 0, life: 2.5 + r() * 1.5, size: 3 + r() * 3, a: 0.16 });
  }
  for (const p of puffs) {
    p.age += dt;
    p.v[0] += Math.sin(p.age * 2 + p.size) * dt * 3;
    p.v[1] *= 1 - dt * 0.3;
    p.p = add(p.p, mul(p.v, dt));
    p.size += dt * 4;
  }
  for (let i = puffs.length - 1; i >= 0; i--) if (puffs[i].age > puffs[i].life) puffs.splice(i, 1);
}
/** A bubble touched pops: its bounce given, then it's gone, out of the course (so the flick's arc knows), a fine spray
 * and a pop. One nearly hit — a hard landing beside it, the dumpling going by fast and close — is knocked loose: it
 * floats off, up and away from the blow, bobbing, and pops in a few seconds, or when it's touched again. Popped a
 * while, with nothing in its way, it grows back where it was. */
function bubblesTick(dt: number) {
  const fast = len(body.vcom);
  for (const b of bubbles) {
    const sh = b.shape, c = sh.c, d = len(sub(body.com, c));
    if (b.gone >= 0) {
      if (simTime - b.gone > BUBBLE_BACK && len(sub(body.com, b.c0)) > sh.r + RADIUS * 2.5) {
        b.gone = -1; b.drift = null;
        placeBubble(sh, b.c0);
        lv.shapes.push(sh);
      }
      continue;
    }
    if (d < sh.r + RADIUS * 1.15) { burst(b); continue; }
    if (b.drift) {
      // (floating off: drifting, slowing, a little up, bobbing; till it's due)
      for (let i = 0; i < 3; i++) b.drift[i] *= Math.exp(-dt * 0.6);
      const bob = Math.sin(simTime * 5 + b.c0[0] * 0.37 + b.c0[2] * 0.21) * 1.5;
      placeBubble(sh, [c[0] + b.drift[0] * dt, c[1] + (b.drift[1] + 3 + bob) * dt, c[2] + b.drift[2] * dt]);
      if (simTime > b.until) burst(b);
      continue;
    }
    // (nearly hit: a hard landing close by, or going by fast and close)
    if (d < sh.r + RADIUS * 3 && (body.impact > 70 || (fast > 140 && d < sh.r + RADIUS * 2))) {
      const away = norm(sub(c, body.com)), k = Math.min(1.5, Math.max(body.impact, fast) / 150);
      b.drift = [away[0] * 14 * k, 6 + 6 * k, away[2] * 14 * k];
      b.until = simTime + 2.5 + 1.5 * (Math.sin(b.c0[0] * 12.9 + b.c0[2] * 78.2) + 1);
    }
  }
}
/** a bubble's place: its middle, and its bounds with it */
function placeBubble(sh: Shape, at: V3) {
  sh.c[0] = sh.b[0] = at[0]; sh.c[1] = sh.b[1] = at[1]; sh.c[2] = sh.b[2] = at[2];
  for (let i = 0; i < 3; i++) { sh.lo[i] = at[i] - sh.r; sh.hi[i] = at[i] + sh.r; }
}
function burst(b: { shape: Shape; gone: number; drift: V3 | null }) {
  b.gone = simTime; b.drift = null;
  const i = lv.shapes.indexOf(b.shape);
  if (i >= 0) lv.shapes.splice(i, 1);
  const at = b.shape.c, r = b.shape.r, q = seeded(hash(Math.floor(simTime * 1000), 7));
  for (let k = 0; k < 8 + r * 6; k++) {
    const a = q() * Math.PI * 2, e = q() * 1.2 - 0.3;
    const dir: V3 = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
    puffs.push({ p: add(at, mul(dir, r)), v: mul(dir, 18 + 30 * q()), age: 0, life: 0.25 + q() * 0.25, size: 0.35 + q() * 0.4, a: 0.5 });
  }
  pop(0.12 + 0.05 * r);
}
function flourPuff(at: V3, k: number) {
  const r = seeded(hash(Math.floor(simTime * 1000), 3));
  for (let i = 0; i < 6 + 10 * k; i++) {
    const a = r() * Math.PI * 2;
    puffs.push({ p: [at[0] + Math.cos(a) * RADIUS, at[1] - RADIUS * 0.4, at[2] + Math.sin(a) * RADIUS], v: [Math.cos(a) * (10 + 30 * k * r()), 4 + 10 * r(), Math.sin(a) * (10 + 30 * k * r())], age: 0, life: 0.6 + r() * 0.5, size: 1 + r(), a: 0.4 });
  }
}

/** A sneeze's pepper: a few dark-ish puffs, thrown out in front. */
function pepperPuff(at: V3) {
  const rr = seeded(hash(Math.floor(simTime * 1000), 9));
  for (let i = 0; i < 10; i++) { const a = rr() * Math.PI * 2; puffs.push({ p: [at[0], at[1], at[2]], v: [Math.cos(a) * 30 * rr(), 20 + 30 * rr(), Math.sin(a) * 30 * rr()], age: 0, life: 0.5 + rr() * 0.4, size: 0.6 + rr() * 0.8, a: 0.25 }); }
}
/** Crumbs (or sugar) shaken off: a scatter of small bright bits. */
function crumbPuff(at: V3) {
  const rr = seeded(hash(Math.floor(simTime * 1000), 11));
  for (let i = 0; i < 8; i++) { const a = rr() * Math.PI * 2; puffs.push({ p: [at[0] + Math.cos(a) * RADIUS, at[1] - RADIUS * 0.3, at[2] + Math.sin(a) * RADIUS], v: [Math.cos(a) * (20 + 30 * rr()), 10 + 20 * rr(), Math.sin(a) * (20 + 30 * rr())], age: 0, life: 0.4 + rr() * 0.3, size: 0.5 + rr() * 0.5, a: 0.4 }); }
}
/** Steam out from under a lid as it lifts: from all round the pot's rim, up and out. */
function steamOut(at: V3, r: number, n = 26) {
  const rr = seeded(hash(Math.floor(simTime * 1000), 5));
  for (let i = 0; i < n; i++) {
    const a = rr() * Math.PI * 2;
    puffs.push({ p: [at[0] + Math.cos(a) * r, at[1] + 0.5, at[2] + Math.sin(a) * r], v: [Math.cos(a) * (8 + 14 * rr()), 14 + 18 * rr(), Math.sin(a) * (8 + 14 * rr())], age: 0, life: 1 + rr() * 0.8, size: 1.5 + 1.5 * rr(), a: 0.35 });
  }
}

// ─── drawing ─────────────────────────────────────────────────────────────────────────────────────
const KEY = norm(LIGHT === 'noon' ? [0.3, 0.92, 0.25] : [0.55, 0.75, 0.38]);
const WIN = norm([0.62, 0.32, 0.5]);
const KEY_COL: V3 = LIGHT === 'noon' ? [2.3, 2.25, 2.15] : LIGHT === 'shade' ? [0.16, 0.16, 0.18] : [2.1, 1.95, 1.72];
/** the room's own light, by the light: in shade, it's most of what there is, and a little cooler */
const AMB: V3 = LIGHT === 'shade' ? [1.55, 1.6, 1.72] : LIGHT === 'noon' ? [1.05, 1.05, 1.05] : [1, 1, 1];
let dpr = 1;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2) * (preview ? 0.6 : 1) * renderScale;
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
addEventListener('resize', resize);
// the cookbooks, every title lettered (books.ts): on texture 6, for good
{
  const t = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE6);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, paintAtlas());
  gl.generateMipmap(gl.TEXTURE_2D);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const an = gl.getExtension('EXT_texture_filter_anisotropic');
  if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  gl.activeTexture(gl.TEXTURE0);
}
const shadowTex = gl.createTexture()!;
gl.bindTexture(gl.TEXTURE_2D, shadowTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW, SHADOW, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
const shadowFb = gl.createFramebuffer()!;
gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
gl.drawBuffers([gl.NONE]);
gl.readBuffer(gl.NONE);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
const I4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const model = (at: V3, s: number) => new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, at[0], at[1], at[2], 1]);
/** a flat thing lying on a surface: its disc turned to the normal there */
function flatOn(at: V3, n: V3, s: number): Float32Array {
  const t = norm(Math.abs(n[1]) > 0.9 ? cross([1, 0, 0], n) : cross([0, 1, 0], n));
  const b = cross(n, t);
  return new Float32Array([t[0] * s, t[1] * s, t[2] * s, 0, n[0] * s, n[1] * s, n[2] * s, 0, b[0] * s, b[1] * s, b[2] * s, 0, at[0], at[1], at[2], 1]);
}
function lightUniforms(p: WebGLProgram) {
  gl.uniform3fv(u(p, 'uKey'), KEY);
  gl.uniform3fv(u(p, 'uKeyCol'), KEY_COL);
  gl.uniform3fv(u(p, 'uAmb'), AMB);
  gl.uniform3fv(u(p, 'uWin'), WIN);
}
function drawMesh(m: Mesh, M: Float32Array = I4, mat = -1) {
  gl.uniformMatrix4fv(u(prog, 'uModel'), false, M);
  gl.uniform1f(u(prog, 'uMatOver'), mat);
  gl.bindVertexArray(m.vao);
  gl.drawArrays(gl.TRIANGLES, 0, m.count);
}

/** ?perf: how long a frame takes (and the card's own time for it, where it'll say), what it's drawing into */
const perfEl = params.has('perf') ? (() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9;font:11px/1.3 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.55);padding:4px 6px;border-radius:6px;pointer-events:none'; document.body.appendChild(d); return d; })() : null;
const timerExt = perfEl ? gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null : null;
const queries: WebGLQuery[] = [];
let perfMs = 16, perfGpu = -1, perfShown = 0;
function perfStart() { if (!timerExt) return; const q = gl.createQuery()!; gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q); queries.push(q); }
function perfEnd(dtMs: number, now: number) {
  if (!perfEl) return;
  if (timerExt) {
    gl.endQuery(timerExt.TIME_ELAPSED_EXT);
    while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = queries.shift()!;
      if (!gl.getParameter(timerExt.GPU_DISJOINT_EXT)) perfGpu += ((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6 - perfGpu) * 0.1;
      gl.deleteQuery(q);
    }
  }
  perfMs += (dtMs - perfMs) * 0.1;
  if (now - perfShown > 500) { perfShown = now; perfEl.textContent = `${(1000 / perfMs).toFixed(0)} fps · ${perfMs.toFixed(1)} ms${timerExt ? ` · gpu ${perfGpu.toFixed(1)} ms` : ''} · ${HDR ? 'hdr' : 'ldr'} ${tgtS}x · ${canvas.width}×${canvas.height} (${renderScale.toFixed(2)}${fixedQuality ? ', fixed' : qLocked ? ', settled' : ''}) · ${((courseMesh?.count ?? 0) / 3000).toFixed(0)}k triangles · bake ${bakeMs.toFixed(0)} ms`; }
}

let last = performance.now();
let time = 0;
let lag = 0;
/** blinking: when the next one is, and how far through one it is */
let blinkAt = 2;
function frame(now: number) {
  // (a frame's time can be from before the page's own start, in a page opened behind another: never backwards)
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  const dtMs = now - last;
  last = now;
  perfStart();
  quality(dtMs);
  resize();
  // (`?fast=N`, for headless tests: N whole steps of the game a drawn frame, as though N frames had gone by)
  for (let k = 0; k < (FAST || 1); k++) advance(FAST ? 1 / 60 : dt);
  render(now, dtMs);
}
/** what a frame does before it's drawn: the game's clock, the dumpling's steps, the camera, the puffs, where it looks */
function advance(dt: number) {
  time += dt;
  // the dumpling, in fixed steps
  lag = Math.min(lag + dt, 0.1);
  while (lag >= 1 / 60) {
    lag -= 1 / 60;
    prevX = new Float32Array(body.x);
    if (buddy) buddyPrev = new Float32Array(buddy.x);
    tick(1 / 60);
  }
  updateCamera(dt);
  if (fixedView?.length === 6) { eye[0] = fixedView[0]; eye[1] = fixedView[1]; eye[2] = fixedView[2]; camTarget = [fixedView[3], fixedView[4], fixedView[5]]; }
  updatePuffs(dt);
  // sat still: it turns to look at you (winding up, it looks where it's going)
  body.look = aimNow ? norm([aimNow.vel[0], 0, aimNow.vel[2]]) : norm([eye[0] - body.com[0], 0, eye[2] - body.com[2]]);
  if (buddy) buddy.look = norm([eye[0] - buddy.com[0], 0, eye[2] - buddy.com[2]]);
  // winding up: squeezed along the way it would go
  aimFromPull();
  body.squeeze = aimNow && body.canFlick ? { d: norm(aimNow.vel), k: aimNow.power * 0.6 } : pushNow && body.canFlick ? { d: pushNow.dir, k: pushNow.power * 0.35 } : null;
  // (held: the dough under the finger drawn back the way it's pulled, as far as it's pulled, a few centimetres at most)
  if (body.grab && mode === 'play') {
    // (a climb is pulled down, to go up)
    // (pushed on: leant over the way it's pushed)
    const d = pushNow ? pushNow.dir : !aimNow ? ([0, 0, 0] as V3) : aimNow.climb ? ([0, -1, 0] as V3) : norm([-aimNow.vel[0], 0, -aimNow.vel[2]]);
    const k = pushNow ? 0.6 + 1.6 * pushNow.power : aimNow ? 0.8 + 2.6 * aimNow.power : 0;
    body.grab.pull = aimNow?.climb ? [0, -k, 0] : [d[0] * k, 0.25 * k, d[2] * k];
  }
}
/** the frame, drawn */
function render(now: number, dtMs: number) {
  const W = canvas.width, H = canvas.height;
  const fwd = norm(sub(camTarget, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const upv = cross(right, fwd);
  const vp = viewProj(eye, fwd, right, upv, 0.9, W / H, 1, 3000);
  lastVP = vp;
  const span = 70;
  const lightVP = ortho(body.com, KEY, span, 500, SHADOW);
  const shadowSoft = (500 * 0.08) / ((2 * span) / SHADOW);
  // (the bodies to draw: the dumpling, and on the title its friend; the dough first, so the jelly sees it through itself)
  const drawn = [body, ...(buddy ? [buddy] : [])].sort((a, b) => (a.kind === 'dough' ? 0 : 1) - (b.kind === 'dough' ? 0 : 1));
  for (const b of drawn) uploadSkin(b, b === body ? prevX : buddyPrev, Math.max(0, Math.min(1, lag * 60)));

  // 1. the window's shadow map
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
  gl.viewport(0, 0, SHADOW, SHADOW);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(shadowProg);
  gl.uniformMatrix4fv(u(shadowProg, 'uLightVP'), false, lightVP);
  gl.uniformMatrix4fv(u(shadowProg, 'uModel'), false, I4);
  if (courseMesh) { gl.bindVertexArray(courseMesh.svao); gl.drawArrays(gl.TRIANGLES, 0, courseMesh.count); }
  // (the honey in a jar's drawn apart, over the scene, but it still stands in the sun)
  for (const h of honeyMeshes) { gl.bindVertexArray(h.mesh.svao); gl.drawArrays(gl.TRIANGLES, 0, h.mesh.count); }
  for (const m of movers) { gl.uniformMatrix4fv(u(shadowProg, 'uModel'), false, model([0, m.shape.c[1] - m.shape.lift!.y0, 0], 1)); gl.bindVertexArray(m.mesh.svao); gl.drawArrays(gl.TRIANGLES, 0, m.mesh.count); }
  gl.uniformMatrix4fv(u(shadowProg, 'uModel'), false, I4);
  fillJellies();
  for (const jm of jellyMeshes) { gl.bindVertexArray(jm.mesh.svao); gl.drawArrays(gl.TRIANGLES, 0, jm.mesh.count); }
  for (const b of drawn) { const sk = skins[b.kind]; gl.bindVertexArray(sk.svao); gl.drawElements(gl.TRIANGLES, sk.count, gl.UNSIGNED_SHORT, 0); }
  targets(W, H, samples);
  gl.bindFramebuffer(gl.FRAMEBUFFER, msFb);

  // 2. the room beyond
  gl.viewport(0, 0, W, H);
  gl.clearColor(0.6, 0.55, 0.48, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(skyProg);
  lightUniforms(skyProg);
  gl.uniformMatrix4fv(u(skyProg, 'uInvVP'), false, invert(vp));
  gl.bindVertexArray(skyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // 3. the kitchen and the course
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(prog);
  lightUniforms(prog);
  gl.uniformMatrix4fv(u(prog, 'uVP'), false, vp);
  gl.uniformMatrix4fv(u(prog, 'uLightVP'), false, lightVP);
  gl.uniform3fv(u(prog, 'uEye'), eye);
  gl.uniform1f(u(prog, 'uTime'), simTime);
  gl.uniform1f(u(prog, 'uRun'), simTime - levelBorn + HONEY_AHEAD);
  gl.uniform1f(u(prog, 'uShadowSoft'), shadowSoft);
  gl.uniform1f(u(prog, 'uBakeView'), params.has('bakeview') ? 1 + Number(params.get('bakeview') === 'colour') : 0);
  gl.uniform1i(u(prog, 'uShadowMap'), 0);
  gl.uniform1i(u(prog, 'uBooks'), 6);
  gl.uniform1f(u(prog, 'uAlpha'), 1);
  gl.uniform1f(u(prog, 'uLiquidOpt'), 0); // only sample the resolved scene in the thin-film pass
  gl.uniform1f(u(prog, 'uHoneyNew'), HONEY_OLD_LIGHT ? 0 : 1);
  gl.uniform3fv(u(prog, 'uTint'), [1, 1, 1]);
  // (the screen over what stands before the dumpling: on in play, once the way over's done)
  gl.uniform3fv(u(prog, 'uHole'), mode === 'play' && fly < 0 && !fixedView ? [0, 0, 1] : [0, 0, 0]);
  gl.uniform3fv(u(prog, 'uHoleAt'), body.com);
  // (the dumpling, as a ball shutting in what's near it, and its colour, for the light off it)
  gl.uniform4f(u(prog, 'uBodyAt'), body.com[0], body.com[1], body.com[2], noDef ? 0 : RADIUS * 1.3);
  gl.uniform3fv(u(prog, 'uBodyCol'), body.kind === 'jelly' ? [0.9, 0.3, 0.42] : [0.85, 0.72, 0.52]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  if (roomMesh) drawMesh(roomMesh);
  // (the lazy Susans turn: drawn turned by their time)
  if (courseMesh) drawMesh(courseMesh);
  drawSusans();
  // (the lids, where the steam has them)
  for (const m of movers) drawMesh(m.mesh, model([0, m.shape.c[1] - m.shape.lift!.y0, 0], 1));
  // (the jellies, as their tops are: the konjac seen partly through)
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  for (const jm of jellyMeshes) { const r = jm.ripple; gl.uniform4f(u(prog, 'uRipple'), r[0], r[1], simTime - r[2], r[3]); drawMesh(jm.mesh); }
  gl.uniform4f(u(prog, 'uRipple'), 0, 0, -99, 0);
  gl.disable(gl.BLEND);
  // the dark under the dumpling
  gl.uniform3fv(u(prog, 'uHole'), [0, 0, 0]);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  for (const b of drawn) {
    const ground = groundUnder(b.com);
    if (!ground) continue;
    const lift = Math.max(0, b.com[1] - ground.p[1] - REST_H);
    gl.uniform1f(u(prog, 'uAlpha'), Math.max(0, 1 - lift / 40));
    drawMesh(DISC, flatOn(add(ground.p, mul(ground.n, 0.05)), ground.n, RADIUS * (1.3 + lift * 0.04)), 15);
    // (where it's touching: a tighter, darker core, as wide as what of it touches, wider as it squashes down)
    if (b.contacts > 0 && lift < 1.5) {
      const foot = Math.max(0.8, Math.min(RADIUS * 1.35, RADIUS * 0.85 * Math.sqrt(b.contacts / 150)));
      gl.uniform1f(u(prog, 'uAlpha'), 0.7 * (1 - lift / 1.5));
      drawMesh(DISC, flatOn(add(ground.p, mul(ground.n, 0.07)), ground.n, foot), 15);
    }
  }
  // the aiming line: dots along where its middle will go, a ring where it lands
  aimLand = null;
  const shows = aimShows();
  if (aimNow && shows.arc) {
    const pa = path(lv, body.com, aimNow.vel, 3, simTime, aimNow.climb ?? null);
    // (the camera frames the landing whether the ring's shown or not: it's where to look, not a promise)
    aimLand = pa.hit ? pa.hit.p : pa.pts[pa.pts.length - 1] ?? null;
    aimTop = pa.pts.reduce<V3 | null>((m, p) => (!m || p[1] > m[1] ? p : m), null);
    const can = body.canFlick;
    // (the arc alone: strong where it leaves, fading to nothing a little past its top and well short of where it
    // comes down — the way it's going, how high, never where it ends; smaller as they fade)
    const top = pa.pts.reduce((m, p, i) => (p[1] > pa.pts[m][1] ? i : m), 0);
    const gone = Math.max(top + 2, Math.min(pa.pts.length * 0.75, top * 1.45));
    gl.uniform3fv(u(prog, 'uTint'), can ? [1, 0.97, 0.88] : [1, 0.6, 0.5]);
    pa.pts.forEach((p, i) => {
      const f = shows.ring ? 1 - (i / pa.pts.length) * 0.5 : Math.max(0, 1 - i / gone) ** 1.4;
      if (f < 0.04) return;
      gl.uniform1f(u(prog, 'uAlpha'), (can ? 0.95 : 0.5) * f);
      drawMesh(SPHERE, model(p, (0.55 + 0.25 * aimNow!.power) * (shows.ring ? 1 : 0.55 + 0.45 * f)), 13);
    });
    // (onto a jelly's top, the dots go on: up as high as it's thrown back, on as far as it skids)
    if (pa.hit && shows.ring) {
      const lands = towerAt(lv, pa.hit.p, 0.5);
      gl.uniform3fv(u(prog, 'uTint'), lands > check ? [0.6, 1, 0.65] : lands >= 0 ? [1, 0.97, 0.88] : [1, 0.5, 0.45]);
      gl.uniform1f(u(prog, 'uAlpha'), 0.95);
      const n = pa.hit.n;
      drawMesh(DISC, flatOn(add(sub(pa.hit.p, mul(n, RADIUS * 0.8)), mul(n, 0.08)), n, RADIUS * 1.4), 14);
    }
  }
  // the push: dots along what it's on, the way it'll roll, about as far as it will on the flat; to an edge it'd go
  // off, they stop there, and they're red
  if (pushNow) {
    const can = body.canFlick, reach = rollReach(pushNow.v), g = groundUnder(body.com);
    let y = g ? g.p[1] : body.com[1] - REST_H;
    const dots: V3[] = [];
    let over = false;
    for (let t = RADIUS + 2; t <= RADIUS + reach; t += 2.6) {
      const x = body.com[0] + pushNow.dir[0] * t, z = body.com[2] + pushNow.dir[2] * t;
      const on = surfaceNear(x, z, y);
      if (on === null) { over = true; break; }
      y = on;
      dots.push([x, y + 0.6, z]);
    }
    gl.uniform3fv(u(prog, 'uTint'), !can ? [1, 0.6, 0.5] : over ? [1, 0.45, 0.4] : [1, 0.97, 0.88]);
    dots.forEach((p, i) => {
      gl.uniform1f(u(prog, 'uAlpha'), (can ? 0.85 : 0.45) * (1 - (i / (dots.length + 1)) * 0.5));
      drawMesh(SPHERE, model(p, 0.45), 13);
    });
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);

  // (the jelly's light: where the window's light comes through it to the ground, focused, pink)
  for (const b of drawn) if (b.kind === 'jelly') {
    const lit = groundAlong(b.com, mul(KEY, -1));
    if (lit) {
      const far = len(sub(lit.p, b.com));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.uniform1f(u(prog, 'uAlpha'), 0.42 * Math.max(0, 1 - far / 90));
      drawMesh(DISC, flatOn(add(lit.p, mul(lit.n, 0.06)), lit.n, RADIUS * (1.25 + far * 0.012)), 16);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  // 4. the dumpling (and on the title, its friend)
  if (time > blinkAt + 0.14) blinkAt = time + 2 + Math.random() * 3;
  const blinkOf = (at: number) => (time > at && time < at + 0.14 ? Math.sin(((time - at) / 0.14) * Math.PI) : 0);
  for (const body of drawn) {
  const hero = body === drawn.find((b) => b !== buddy);
  const blink = hero ? blinkOf(blinkAt) : blinkOf(blinkAt + 1.3);
  // (its face: squeezed shut winding up, an o in the air, a smile at home; and it blinks)
  const face = mode === 'title' ? (body.grab ? 1 : body.contacts === 0 || body.sinceFlick < 0.6 ? 3 : 0) : !hero ? (body.contacts === 0 ? 3 : 0) : home >= 0 ? 2 : aimNow ? 1 : body.contacts === 0 && body.sinceFlick < 2 ? 3 : 0;
  const sk = skins[body.kind];
  const skinUniforms = (p: WebGLProgram) => {
    gl.useProgram(p);
    lightUniforms(p);
    gl.uniformMatrix4fv(u(p, 'uVP'), false, vp);
    gl.uniformMatrix4fv(u(p, 'uLightVP'), false, lightVP);
    gl.uniform3fv(u(p, 'uEye'), eye);
    gl.uniform1f(u(p, 'uShadowSoft'), shadowSoft);
    gl.uniform1i(u(p, 'uShadowMap'), 0);
    gl.uniform1f(u(p, 'uR'), RADIUS);
    gl.uniform1f(u(p, 'uFace'), face);
    gl.uniform1f(u(p, 'uBlink'), blink);
  };
  gl.bindVertexArray(sk.vao);
  if (body.kind === 'dough') {
    skinUniforms(doughProg);
    gl.drawElements(gl.TRIANGLES, sk.count, gl.UNSIGNED_SHORT, 0);
  } else {
    // its far side: how far from the eye, the farthest wherever it's seen, for how thick it is there
    if (backProg) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, backFb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
      gl.enable(gl.BLEND); gl.blendEquation(gl.MAX);
      gl.useProgram(backProg);
      gl.uniformMatrix4fv(u(backProg, 'uVP'), false, vp);
      gl.uniform3fv(u(backProg, 'uEye'), eye);
      gl.bindVertexArray(sk.vao);
      gl.drawElements(gl.TRIANGLES, sk.count, gl.UNSIGNED_SHORT, 0);
      gl.blendEquation(gl.FUNC_ADD); gl.disable(gl.BLEND);
      gl.cullFace(gl.BACK); gl.disable(gl.CULL_FACE);
      gl.enable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, msFb);
    }
    // what's behind it, to see through it
    sceneCopy(W, H);
    skinUniforms(jellyProg);
    gl.uniform1i(u(jellyProg, 'uScene'), 1);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, backTex); gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u(jellyProg, 'uBack'), 5);
    gl.uniform1f(u(jellyProg, 'uHasBack'), backProg ? 1 : 0);
    gl.uniformMatrix3fv(u(jellyProg, 'uRot'), true, new Float32Array(body.R));
    gl.uniform3fv(u(jellyProg, 'uCom'), body.com);
    gl.uniform2f(u(jellyProg, 'uRes'), W, H);
    gl.uniform1f(u(jellyProg, 'uPass'), 0);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, sk.count, gl.UNSIGNED_SHORT, 0);
    // the glitter in it
    const fl = sk.flakes!;
    gl.useProgram(glitterProg);
    lightUniforms(glitterProg);
    gl.uniformMatrix4fv(u(glitterProg, 'uVP'), false, vp);
    gl.uniform3fv(u(glitterProg, 'uEye'), eye);
    gl.uniform3fv(u(glitterProg, 'uCom'), body.com);
    gl.uniform1f(u(glitterProg, 'uR'), RADIUS);
    gl.uniform1f(u(glitterProg, 'uScale'), H * 0.9);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(fl.vao);
    gl.drawArrays(gl.POINTS, 0, fl.n);
    // and on it: its gloss, its face
    skinUniforms(jellyProg);
    gl.uniform1f(u(jellyProg, 'uPass'), 1);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    gl.bindVertexArray(sk.vao);
    gl.drawElements(gl.TRIANGLES, sk.count, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
  }

  }

  // What's seen through, after everything solid. One copy of the scene serves the films (butter, honey's pool) and
  // the honey in a jar; where there's a jar with honey run down it, the drips take a second, so they've the jar's
  // honey behind them. A bubble takes a fresh copy only if one of those (or the jelly, or the glass) has drawn since.
  let fresh = false;
  const seeThrough = () => { if (!fresh) { sceneCopy(W, H); fresh = true; } };
  if (honeyRims.length && (dripAt < 0 || simTime - dripAt > 0.5 || simTime < dripAt)) {
    const v: number[] = [];
    for (const r of honeyRims) (HONEY_OLD_SHAPE ? honeyOver : honeyField)(r, simTime - levelBorn + HONEY_AHEAD, v);
    drop(dripMesh); dripMesh = upload(v, gl.DYNAMIC_DRAW); dripAt = simTime;
  }
  if (liquidMesh || dripMesh || honeyMeshes.length) {
    seeThrough();
    gl.useProgram(prog);
    gl.uniform1i(u(prog, 'uScene'), 1);
    gl.uniform2f(u(prog, 'uRes'), W, H);
    gl.uniform3fv(u(prog, 'uRight'), right);
    gl.uniform3fv(u(prog, 'uUp'), upv);
    gl.uniform1f(u(prog, 'uAlpha'), 1);
    gl.uniform3fv(u(prog, 'uTint'), [1, 1, 1]);
    gl.uniform3fv(u(prog, 'uHole'), [0, 0, 0]);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    // (the honey in a jar first, keeping its depth: its thickness along the ray through it, from the jar's own
    // cylinder, no back-face pass. What runs down the outside of the jar goes over it, and sees it behind)
    if (honeyMeshes.length) {
      gl.uniform1f(u(prog, 'uLiquidOpt'), 2);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      for (const jar of honeyMeshes) {
        gl.uniform3fv(u(prog, 'uHoneyC'), jar.center);
        gl.uniform3f(u(prog, 'uHoneyRange'), jar.radius, jar.bottom, jar.top);
        drawMesh(jar.mesh);
      }
      gl.disable(gl.CULL_FACE);
      if (dripMesh) { sceneCopy(W, H); gl.useProgram(prog); }
    }
    // (then the films and the honey's drips, over what's behind them now)
    gl.uniform1f(u(prog, 'uLiquidOpt'), 1);
    if (liquidMesh) drawMesh(liquidMesh);
    if (dripMesh) drawMesh(dripMesh);
    gl.uniform1f(u(prog, 'uLiquidOpt'), 0);
    fresh = false;
  }

  // (the glass: over everything, seen through)
  const liveBubbles = bubbles.filter((b) => b.gone < 0);
  if (glassMesh) {
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(u(prog, 'uAlpha'), 1);
    gl.uniform3fv(u(prog, 'uTint'), [1, 1, 1]);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT); drawMesh(glassMesh); gl.cullFace(gl.BACK); drawMesh(glassMesh);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    fresh = false;
  }

  // (the bubbles: the scene refracted through each one's near shell, its film's colours toward its rim)
  if (liveBubbles.length) {
    seeThrough();
    gl.useProgram(bubbleProg);
    lightUniforms(bubbleProg);
    gl.uniformMatrix4fv(u(bubbleProg, 'uVP'), false, vp);
    gl.uniformMatrix4fv(u(bubbleProg, 'uLightVP'), false, lightVP);
    gl.uniform3fv(u(bubbleProg, 'uEye'), eye);
    gl.uniform3fv(u(bubbleProg, 'uRight'), right);
    gl.uniform3fv(u(bubbleProg, 'uUp'), upv);
    gl.uniform2f(u(bubbleProg, 'uRes'), W, H);
    gl.uniform1i(u(bubbleProg, 'uScene'), 1);
    gl.enable(gl.DEPTH_TEST);
    // (no culling: a bubble's wound inside out for this; its near shell is the half whose normal faces the eye, and
    // the shader keeps only that)
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(false);
    for (const b of liveBubbles) {
      gl.uniformMatrix4fv(u(bubbleProg, 'uModel'), false, model(sub(b.shape.c, b.c0), 1));
      gl.bindVertexArray(b.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, b.mesh.count);
    }
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
  }

  // 5. steam and flour
  if (puffs.length) {
    const data = new Float32Array(puffs.length * 4);
    puffs.forEach((p, i) => {
      const a = p.a * Math.sin(Math.min(1, p.age / p.life) * Math.PI);
      data.set([p.p[0], p.p[1], p.p[2], Math.floor(a * 100) + Math.min(0.999, p.size / 10)], i * 4);
    });
    gl.useProgram(puffProg);
    gl.uniformMatrix4fv(u(puffProg, 'uVP'), false, vp);
    gl.uniform1f(u(puffProg, 'uScale'), H * 0.9);
    gl.bindBuffer(gl.ARRAY_BUFFER, puffBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(puffVao);
    gl.drawArrays(gl.POINTS, 0, puffs.length);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
  finish(W, H);
  perfEnd(dtMs, now);
  gl.bindVertexArray(null);
  drawBand();
  showStatus();
  (window as unknown as { __squishy: unknown }).__squishy = {
    visualBuild: 'xpbd-contact-v1', physics:{strain:!params.has('nostrain'),adhesion:'compliant-peel'}, optics: { honeyJars: honeyMeshes.length, liquidTriangles: liquidMesh ? liquidMesh.count / 3 : 0 },
    level: levelN, towers: lv.towers.length, check, falls, clock, home, fly, ahead: Math.round(ahead * 100) / 100, com: body.com.map((v) => Math.round(v * 10) / 10),
    speed: Math.round(len(body.vcom)), contacts: body.contacts, canFlick: body.canFlick, aiming: !!aimNow, pushing: !!pushNow, power: aimNow?.power ?? pushNow?.power ?? 0, framed: Math.round(framed * 100) / 100,
    volume: Math.round((body.volume() / body.restVolume) * 1000) / 1000, deform: Math.round(body.deform * 1000) / 1000, squeeze: !!body.squeeze,
    eye: eye.map((v) => Math.round(v)), camYaw, pulling: !!pull, mode, chapter: lv.chapter, held: body.held, pinned: body.pinned, spin: body.spinMode, kind: body.kind, coated: body.coated.map((v) => Math.round(v * 1000) / 1000), coatMost: body.coatMost, jellyOpen,
    // (how far its face is turned from you, in degrees; and how upright it is)
    faceOff: Math.round((Math.abs(Math.atan2(body.R[2] * (eye[2] - body.com[2]) - body.R[8] * (eye[0] - body.com[0]), body.R[2] * (eye[0] - body.com[0]) + body.R[8] * (eye[2] - body.com[2]))) * 180) / Math.PI),
    up: Math.round(body.R[4] * 100) / 100,
  };
  requestAnimationFrame(frame);
}
/** The pull on the glass: a band from where the finger went down to where it is, and a ring for how hard. */
const ui = document.getElementById('ui') as HTMLCanvasElement;
const ux = ui.getContext('2d')!;
function drawBand() {
  const w = Math.round(innerWidth * devicePixelRatio), h = Math.round(innerHeight * devicePixelRatio);
  if (ui.width !== w || ui.height !== h) { ui.width = w; ui.height = h; }
  ux.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ux.clearRect(0, 0, innerWidth, innerHeight);
  // (hidden outright when nothing's pulled: a cleared canvas isn't always shown cleared at once)
  const show = pull ? '' : 'none';
  if (ui.style.display !== show) ui.style.display = show;
  if (!pull) return;
  const p = aimNow?.power ?? 0, can = body.canFlick;
  const col = !aimNow ? 'rgba(255,255,255,.5)' : can ? `hsla(${40 - 40 * p}, 95%, ${70 - 15 * p}%, .95)` : 'rgba(255,140,120,.8)';
  ux.lineCap = 'round';
  // (the ring at the start: how far there is to pull, and how far it's pulled)
  const R = 0.3 * Math.min(innerWidth, innerHeight) + 14;
  ux.lineWidth = 2;
  ux.strokeStyle = 'rgba(255,255,255,.35)';
  ux.beginPath(); ux.arc(pull.sx, pull.sy, 14, 0, Math.PI * 2); ux.stroke();
  ux.setLineDash([3, 6]);
  ux.beginPath(); ux.arc(pull.sx, pull.sy, R, 0, Math.PI * 2); ux.stroke();
  ux.setLineDash([]);
  // (the band, thinning as it stretches; a bead at the finger)
  const L = Math.hypot(pull.x - pull.sx, pull.y - pull.sy);
  ux.strokeStyle = col;
  ux.lineWidth = Math.max(2, 9 - L / 30);
  ux.beginPath(); ux.moveTo(pull.sx, pull.sy); ux.lineTo(pull.x, pull.y); ux.stroke();
  ux.fillStyle = col;
  ux.beginPath(); ux.arc(pull.x, pull.y, 9, 0, Math.PI * 2); ux.fill();
  // (and an arrow the other way, the way it will go)
  if (aimNow) {
    const dx = (pull.sx - pull.x) / (L || 1), dy = (pull.sy - pull.y) / (L || 1);
    const ax = pull.sx + dx * (24 + 40 * p), ay = pull.sy + dy * (24 + 40 * p);
    ux.lineWidth = 3;
    ux.beginPath(); ux.moveTo(pull.sx + dx * 18, pull.sy + dy * 18); ux.lineTo(ax, ay);
    ux.lineTo(ax - dx * 10 - dy * 7, ay - dy * 10 + dx * 7); ux.moveTo(ax, ay); ux.lineTo(ax - dx * 10 + dy * 7, ay - dy * 10 - dx * 7); ux.stroke();
  }
}
/** The breakfast counter's panel: the ways the last few runs went, and how long each took (tap to fold it away). */
function waysPanel() {
  let el = document.getElementById('ways');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ways';
    document.body.appendChild(el);
    const st = document.createElement('style');
    st.textContent = `#ways { position: fixed; left: 10px; top: calc(max(12px, env(safe-area-inset-top)) + 30px); max-width: 70vw; padding: 6px 9px; border-radius: 10px; background: rgba(30,22,14,.45); color: #fff; font: 11px/1.35 system-ui, sans-serif; z-index: 5; }
      #ways.folded li { display: none; } #ways ol { margin: 2px 0 0; padding-left: 16px; } #ways b { font-weight: 600; }`;
    document.head.appendChild(st);
    el.addEventListener('click', () => el!.classList.toggle('folded'));
  }
  const kept = waysKept();
  el.innerHTML = `<b>ways taken</b> ${kept.length ? '' : '· none yet'}<ol>${kept.slice(0, 6).map((w) => `<li>${w.t.toFixed(1)} s${w.falls ? ` · ${w.falls}✕` : ''} · ${w.way}</li>`).join('')}</ol>`;
}
/** The lazy Susans: their tops drawn turned, as they are. */
const susanMeshes = new Map<object, Mesh>();
function drawSusans() {
  for (const s of lv.shapes) if (s.spin) {
    let m = susanMeshes.get(s);
    if (!m) {
      const v: number[] = [];
      const r = s.r, y = s.c[1] + s.hh + 0.02;
      // (a turning top: its pattern drawn on a thin disc just over it, so it's seen to turn)
      for (let k = 0; k < 48; k++) {
        const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2;
        v.push(0, y, 0, 0, 1, 0, MAT.lacquer, 0, 0);
        v.push(Math.cos(a1) * r, y, Math.sin(a1) * r, 0, 1, 0, MAT.lacquer, Math.cos(a1), Math.sin(a1));
        v.push(Math.cos(a0) * r, y, Math.sin(a0) * r, 0, 1, 0, MAT.lacquer, Math.cos(a0), Math.sin(a0));
      }
      m = upload(v);
      susanMeshes.set(s, m);
    }
    const a = s.spin * simTime, c = Math.cos(a), sn = Math.sin(a);
    drawMesh(m, new Float32Array([c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, s.c[0], 0, s.c[2], 1]));
  }
}
/** What's under a point: the first surface straight down (for the dark under the dumpling). */
const hitTmp = { nx: 0, ny: 0, nz: 0, d: 0, vx: 0, vy: 0, vz: 0 };
function groundUnder(p: V3): { p: V3; n: V3 } | null {
  const col = lv.shapes.filter((s) => p[0] >= s.lo[0] - 0.5 && p[0] <= s.hi[0] + 0.5 && p[2] >= s.lo[2] - 0.5 && p[2] <= s.hi[2] + 0.5 && s.lo[1] < p[1]);
  for (let y = p[1]; y > p[1] - 400; y -= 0.4) for (const s of col) if (touch(s, p[0], y, p[2], 0.05, hitTmp) && hitTmp.d > 0) return { p: [p[0], y - 0.05 + hitTmp.d, p[2]], n: [hitTmp.nx, hitTmp.ny, hitTmp.nz] };
  return null;
}

/** What's under (x, z) near height y (a little above it, or a little below): its top's height; null if nothing (an edge, past it a drop). */
function surfaceNear(x: number, z: number, y: number): number | null {
  const col = lv.shapes.filter((s) => x >= s.lo[0] - 0.5 && x <= s.hi[0] + 0.5 && z >= s.lo[2] - 0.5 && z <= s.hi[2] + 0.5 && s.lo[1] < y + 2 && s.hi[1] > y - 4);
  for (let yy = y + 2; yy > y - 4; yy -= 0.3) for (const s of col) if (touch(s, x, yy, z, 0.05, hitTmp) && hitTmp.d > 0 && hitTmp.ny > 0.5) return yy - 0.05 + hitTmp.d;
  return null;
}
/** Where a line from a point first meets the course (for where the window's light through the jelly falls). */
function groundAlong(p: V3, d: V3, max = 160): { p: V3; n: V3 } | null {
  const e = add(p, mul(d, max));
  const lo = [Math.min(p[0], e[0]) - 1, Math.min(p[1], e[1]) - 1, Math.min(p[2], e[2]) - 1], hi = [Math.max(p[0], e[0]) + 1, Math.max(p[1], e[1]) + 1, Math.max(p[2], e[2]) + 1];
  const col = lv.shapes.filter((s) => s.lo[0] <= hi[0] && s.hi[0] >= lo[0] && s.lo[1] <= hi[1] && s.hi[1] >= lo[1] && s.lo[2] <= hi[2] && s.hi[2] >= lo[2]);
  for (let t = 0; t < max; t += 0.5) {
    const x = p[0] + d[0] * t, y = p[1] + d[1] * t, z = p[2] + d[2] * t;
    for (const s of col) if (touch(s, x, y, z, 0.05, hitTmp) && hitTmp.d > 0) return { p: [x, y, z], n: [hitTmp.nx, hitTmp.ny, hitTmp.nz] };
  }
  return null;
}

/** A step of the game: the dumpling; where it's stood, falling, home; a flick asked for in the air; the autopilot. */
function tick(dt: number) {
  if (mode === 'title') { titleTick(dt); return; }
  if (mode === 'pause') return;
  body.step(lv, dt, simTime);
  bubblesTick(dt);
  simTime += dt;
  if (home < 0 && fly < 0) clock += dt;
  if (body.impact > 90) {
    const k = Math.min(1, body.impact / 300);
    squish(k);
    if (body.impact > 140 && (body.kind === 'dough' || body.coated[DUST.flour] > 0.05)) flourPuff(body.com, k * (body.kind === 'dough' ? 1 : 2 * body.coated[DUST.flour]));
    if (lv.shapes.some((s) => s.bounce > 0 && Math.hypot(s.c[0] - body.com[0], s.c[2] - body.com[2]) < s.r + 2) && body.impact > 120) boing();
  }
  if (fallenAt >= 0) {
    // (back onto a lid: not while it's rattling, nor just before — wait for a quiet second on it)
    const back: V3 = toJump && launchedFrom ? [launchedFrom[0], launchedFrom[1] + 0.8, launchedFrom[2]] : respawnAt(lv, check);
    const onto = toJump && launchedFrom ? towerAt(lv, launchedFrom, 2) : check;
    const lid = onto >= 0 ? lv.towers[onto].land?.[0]?.lift : null;
    const noisy = !!lid && (liftAt(lid, simTime).on || liftAt(lid, simTime + 1).on);
    if (simTime > fallenAt + 0.7 && !noisy) {
      body.place(back);
      noteBack(back, backBy);
      prevX = new Float32Array(body.x);
      fallenAt = -1;
      pop(0.6);
    }
    return;
  }
  // fallen to the counter: back to the last top it stood on
  if (body.com[1] < lv.kill) {
    falls++;
    fallenAt = simTime;
    if (way[way.length - 1] !== -1) way.push(-1);
    settleFlick(-1, body.com);
    plop();
    // (back to the jump, unless it's been tried from there too often lately)
    retries = retries.filter((t) => simTime - t < TRIES_IN);
    toJump = resetMode === 'jump' && !!launchedFrom && retries.length < TRIES;
    if (toJump) retries.push(simTime);
    const often = resetMode === 'jump' && !!launchedFrom && !toJump;
    backBy = toJump ? 'jump' : often ? 'capped' : 'top';
    if (often) retries = [];
    hint(toJump ? 'splat. back to where you jumped from' : often ? 'splat. tried enough from there: back to the last top' : 'splat. back to the last top', 1800);
    return;
  }
  // the lids: as one starts to rattle, its rattle, and steam out from under it each time it jumps
  movers.forEach((m, i) => {
    const l = m.shape.lift!;
    if (m.shape.r < 2) return;
    const { k, on } = liftAt(l, simTime);
    if (on && lidWas[i] < 0 && len(sub(m.shape.c, body.com)) < 120) rattle();
    if (k > 0.3 && lidWas[i] <= 0.3) steamOut([m.shape.c[0], l.y0 - m.shape.hh, m.shape.c[2]], m.shape.r, 10);
    // (the pop: a burst, and a word the first time it throws you)
    if (k > 1.5 && lidWas[i] <= 1.5) { steamOut([m.shape.c[0], l.y0 - m.shape.hh, m.shape.c[2]], m.shape.r * 1.4, 28); rattle(); if (!popSaid && len(sub(m.shape.c, body.com)) < m.shape.r + 4) { popSaid = true; hint('pop! the lid throws you', 1600); } }
    lidWas[i] = on ? k : -1;
  });
  const k = towerAt(lv, body.com, 1);
  const speed = body.moving;
  // (stood on it: on its feet on its top, or hanging from it if it's a rail; not draped over its edge, nor clinging to its side)
  const stood = k >= 0 && (lv.towers[k].rail ? !!body.onRail : body.onFeet);
  if (stood && body.contacts > 0 && speed < 30) settleFlick(k, body.com);
  if (stood && body.contacts > 0 && speed < 30) { check = k; if (k > 0) visited.add(k); if (way[way.length - 1] !== k && still > 0.2) way.push(k); }
  // (on a top the way parts at, the first time: say so)
  if (stood && !benchName && !forkSaid && lv.ways && lv.ways.filter(([a]) => a === k).length > 1 && still > 0.5) { forkSaid = true; hint('two ways on: the sure way along the front; along the back, one long hop, quicker', 5000); }
  // (sat still: its drift, not its speed, so a quiver on an edge counts as still)
  // (sat still: not drifting, and touching, or only a moment off it, trembling on a jelly)
  const quiet = len(sub(body.drift, carried(lv, body.com))) < 6 && body.sinceContact < 0.12;
  if (body.held > 1 && !heldWas) hint('stuck. aim into it to climb up and over; aim away to jump off', 2600);
  heldWas = body.held > 1;
  // what it's picked up: a word the first time; a sneeze when it's peppered; what a hard landing shakes off
  if (body.coatMost !== coatWas) {
    const said = ['', 'flour: dry and grippy, and no stick', 'butter: slippery, and honey won\'t hold it', 'crumbs: bouncy', 'pepper...', 'hundreds and thousands: sticky', 'honey: it sticks to the side of anything, a while'][body.coatMost];
    if (said && !coatSaid.has(body.coatMost)) { coatSaid.add(body.coatMost); hint(said, 2600); }
    coatWas = body.coatMost;
  }
  if (body.sneezed) { sneezeSound(); hint('achoo!', 1200); pepperPuff(body.com); }
  if (body.shook === DUST.flour) flourPuff(body.com, 0.6);
  else if (body.shook === DUST.crumbs || body.shook === DUST.sprinkles) crumbPuff(body.com);
  still = quiet ? still + dt : 0;
  if (k === lv.towers.length - 1 && stood && still > 0.5 && home < 0) {
    home = clock;
    chime();
    showHands();
    if (way[way.length - 1] !== k) way.push(k);
    if (benchName || auto) hint(`home! ${clock.toFixed(1)} s${falls ? ` · ${falls} fall${falls > 1 ? 's' : ''}` : ''}${lv.route && benchName ? ` · ${wayWords(way)}` : ''}`, 9000);
    if (lv.route && benchName && !auto) { try { localStorage.setItem(WAYS(), JSON.stringify([{ way: wayWords(way), t: Math.round(clock * 10) / 10, falls }, ...waysKept()].slice(0, 30))); } catch { /* */ } benchPanel(); }
    // (scored; a card, a new best gold)
    if (!benchName && !auto) showDone(scoreOf(clock, falls, visited.size));
    try { if (!auto && !benchName) localStorage.setItem(STORE + ':reached', String(Math.max(reachedNow(), levelN + 1))); } catch { /* */ }
    // (got home from the level before the jelly's: it's yours)
    if (!benchName && !auto && levelN >= JELLY_AT - 1 && !jellyOpen) {
      jellyOpen = true;
      try { localStorage.setItem(STORE + ':jelly', '1'); } catch { /* */ }
      if (!params.has('skin')) skin = 'jelly';
      showSkin();
      setTimeout(() => hint('the jelly\'s yours: it\'s jelly from the next level (switch in settings)', 6000), 2500);
    }
  }
  if (buffered && body.canFlick) { if (simTime < buffered.until) doFlick(buffered.vel, buffered.spin, buffered.climb); else buffered = null; }
  // the autopilot (the index's preview, and ?auto): the next top, as the course's own aim has it
  if (auto) {
    if (home >= 0 && still > 2.5) { startLevel(levelN); return; }
    // (from where it's ended up, which may be over a top's edge; and, with no way on from there, a hop to the middle of this top first)
    // (off any top, on the table: from where it is, on to the next after the last it stood on)
    // (in a place, down on the counter: the way again from its first hop, which the counter reaches)
    // (and past home, off it: back on to it)
    const last = lv.towers.length - 1, near = k >= 0 ? k : towerAt(lv, body.com, 4), on = near >= 0 ? near : lv.next && !body.clinging && body.com[1] < 8 ? 0 : check;
    const at = on === last && k !== last ? last - 1 : on;
    if (still > 0.5 && body.canFlick && at >= 0 && at < lv.towers.length - 1 && simTime - aimedAt > 0.2) {
      aimedAt = simTime;
      const a = autoFlick(lv, body.com, at, simTime, body.coated[DUST.butter], body.clinging ? body.wallN : null);
      if (a?.shimmy) body.shimmy(a.shimmy);
      else if (a) doFlick(a.climb ? climbLaunch(a.power) : launch(a.yaw, a.power), 0, a.climb);
    }
  }
}
let statusAt = 0;
function showStatus() {
  if (performance.now() - statusAt < 100) return;
  statusAt = performance.now();
  const t = home >= 0 ? home : clock;
  // (how far: where it stands now along a run; along ways that part and meet, how many tops it's been on, of the sure way's)
  $('status').textContent = `${lv.route && benchName ? '' : lv.route ? `${visited.size}/${lv.route.length - 1} · ` : `${check}/${lv.towers.length - 1} · `}${t.toFixed(1)} s${falls ? ` · ${falls} fall${falls > 1 ? 's' : ''}` : ''}`;
}


(window as unknown as { __squishyTop: (k: number) => string }).__squishyTop = (k: number) => lv.towers[k]?.top;
/** (for the lab's renders: the card at home, for a made-up run) */
(window as unknown as { __squishyDone: (t: number, f: number, n: number) => void }).__squishyDone = (t, f, n) => { showDone(scoreOf(t, f, n)); };
/** (for the checks: where the dumpling is on the glass, in pixels; and the camera's turn) */
(window as unknown as { __squishyAt: () => unknown }).__squishyAt = () => ({
  at: screenOf(body.com), camYaw, grabbed: !!body.grab,
  // (on the title: where each sits on the glass, how far it's drawn out, and how far it's moved from its seat)
  title: seats.map((s) => {
    let reach = 0;
    for (let i = 0; i < s.b.n; i++) reach = Math.max(reach, Math.hypot(s.b.x[i * 3] - s.b.com[0], s.b.x[i * 3 + 1] - s.b.com[1], s.b.x[i * 3 + 2] - s.b.com[2]));
    return { kind: s.b.kind, at: screenOf(s.b.com), top: screenOf([s.b.com[0], s.b.com[1] + REST_H, s.b.com[2]]), reach, moved: Math.hypot(s.b.com[0] - s.at[0], s.b.com[2] - s.at[2]), held: !!s.b.grab, deform: s.b.deform, peak: s.peak ?? 0 };
  }),
});
// ─── begin ───────────────────────────────────────────────────────────────────────────────────────
if (mode === 'title') startTitle(); else startLevel(levelN);
resize();
requestAnimationFrame(frame);

