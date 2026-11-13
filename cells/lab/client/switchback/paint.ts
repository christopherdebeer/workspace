/**
 * Switchback painted (`paint=1`): the mountain laid in brush strokes over its facets.
 *
 * The facets stay underneath as the underpainting (so nothing is ever a hole), and the strokes go over them, each one a
 * mark with a reason: planted on a face of the ground where the chunk is built, running the way that ground runs (along
 * the road on the road, across the slope on the snow, down the face on rock, level on the far ranges), coloured from the
 * same four bands the facets use, its bristles mixing toward the band next to it so the colour breaks up as paint does.
 * The strokes are small and close by the road and grow and thin away from it, so where you ride is drawn finely and the
 * mountain round it in a few big marks; and thin further off still, out to the ranges. The rider, the fence, the posts,
 * the pines and the kickers aren't painted: they stay crisp, so what you have to read reads.
 *
 * A stroke is built on the screen where it's drawn: its length laid along its way as the eye sees it (never shorter than
 * a third of itself, however end-on), its width never thinner than a few pixels; and stretched along its own motion on
 * the screen since the last frame, so the speed is in the marks themselves, as far as they move and no further.
 *
 * The marks come from an atlas of brush stamps made here when the page loads (no images): each a brush of bristles,
 * every bristle carrying its own load of paint, starting and lifting a little apart from the rest, running dry along
 * the stroke, leaving a groove between it and the next, and piling paint where it lifts. A stamp's red is where paint
 * is, its green the paint's relief (the ridges catch the light), its blue which of the stroke's two colours.
 */
import type { Course } from './course';
import { M } from './mesh';

// ─── the stamps ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** stamp kinds: a flat brush, a round one, a short dab, a dry flat (bristles running out), a long flat (for the far off) */
const KINDS = ['flat', 'flat', 'round', 'dab', 'round', 'dry', 'dry', 'long'] as const;
export const STAMP = { W: 256, H: 64, COLS: 2, ROWS: 4 } as const;

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x9e3779b9) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 16), 0x21f0aaad); t = Math.imul(t ^ (t >>> 15), 0x735a2d97); return ((t ^ (t >>> 15)) >>> 0) / 4294967296; }; }
const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The atlas: STAMP.COLS × STAMP.ROWS stamps, RGBA bytes. */
export function stampAtlas(): { data: Uint8Array; w: number; h: number } {
  const { W: CW, H: CH, COLS, ROWS } = STAMP, w = CW * COLS, h = CH * ROWS, data = new Uint8Array(w * h * 4);
  KINDS.forEach((kind, idx) => {
    const R = rng(idx * 7717 + 31), dry = kind === 'dry', lanes = kind === 'dab' ? 6 + Math.floor(R() * 3) : 8 + Math.floor(R() * 6);
    // (each bristle: its load, where it touches down and lifts, how fast it runs dry, its share of the second colour)
    const lane = Array.from({ length: lanes }, () => ({
      load: 0.62 + R() * 0.45, start: R() * (kind === 'dab' ? 0.08 : 0.13), end: 1 - R() * (dry ? 0.32 : 0.14),
      rate: (dry ? 0.55 : 0.18) + R() * (dry ? 0.5 : 0.2), tone: R(), ph: R() * 100,
    }));
    // (neighbouring bristles were loaded together: their colours are near)
    for (let p = 0; p < 2; p++) for (let j = 1; j < lanes - 1; j++) lane[j].tone = (lane[j - 1].tone + lane[j].tone * 2 + lane[j + 1].tone) / 4;
    const wav = R() * 6.28, wavA = kind === 'long' ? 0.03 : 0.07;
    const noise = (x: number, s: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), a = rng(i * 131 + s)(), b = rng((i + 1) * 131 + s)(); return a + (b - a) * u; };
    const ox = (idx % COLS) * CW, oy = Math.floor(idx / COLS) * CH;
    for (let py = 0; py < CH; py++) for (let px = 0; px < CW; px++) {
      const u = (px - 6) / (CW - 12), v = ((py - 4) / (CH - 8)) * 2 - 1;
      let cov = 0, rel = 0, tone = 0.5;
      if (u > 0 && u < 1 && v > -1 && v < 1) {
        // (the brush's outline along the stroke)
        const lift = Math.pow(1 - ss(0.72, 1, u), 0.6);
        const e = kind === 'round' ? Math.pow(Math.sin(Math.PI * u), 0.55) : kind === 'dab' ? Math.sqrt(Math.max(0, 1 - ((u - 0.5) / 0.5) ** 2)) : kind === 'long' ? Math.min(1, u / 0.05) ** 0.5 * (1 - 0.45 * u) * lift : Math.min(1, u / 0.08) ** 0.6 * (0.35 + 0.65 * lift);
        const v2 = e > 0.02 ? v / e + wavA * Math.sin(u * 7 + wav) : 9;
        if (Math.abs(v2) < 1) {
          const lp = ((v2 + 1) / 2) * lanes, j = Math.min(lanes - 1, Math.floor(lp)), fj = lp - j, L = lane[j];
          const groove = ss(0, 0.24, fj) * (1 - ss(0.76, 1, fj));
          let paint = L.load - L.rate * Math.max(0, u - L.start) ** 1.3 + (noise(u * 38 + j * 13.1, idx * 17 + j) - 0.5) * (dry ? 0.55 : 0.3);
          paint += (noise(u * 9 + j * 3.3, idx * 29) - 0.5) * 0.2;
          cov = ss(0.18, 0.36, paint) * ss(L.start, L.start + 0.03, u) * (1 - ss(L.end - 0.035, L.end, u));
          cov *= 0.88 + 0.12 * groove;
          cov *= 1 - ss(0.82, 1, Math.abs(v2));
          // (the relief: the bristles' ridges, and the paint piled where each lifts)
          rel = cov * (0.7 + 0.15 * groove) * (0.45 + 0.5 * L.load) + cov * 0.55 * Math.exp(-(((L.end - 0.025 - u) / 0.035) ** 2));
          tone = Math.max(0, Math.min(1, 0.5 + (L.tone - 0.5) * 0.9 + (noise(u * 3 + v2 * 1.5, idx * 41 + 3) - 0.5) * 0.55));
        }
      }
      const o = ((oy + py) * w + ox + px) * 4;
      data[o] = Math.round(Math.min(1, cov) * 255); data[o + 1] = Math.round(Math.min(1, rel) * 255); data[o + 2] = Math.round(tone * 255); data[o + 3] = 255;
    }
  });
  return { data, w, h };
}

// ─── the strokes ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** floats per stroke: where (3), material + tone; its way (3), length; its face's normal (3), width; seed, stamp, bend, kind */
export const STROKE = 16;
/** what's painted: the ground, the road, the rock and the backdrop; not the furniture, the pines, the rider */
/** (not the navy: it's the undersides and the hidden faces, which as facets hardly show but would show as strokes) */
const PAINTED = new Set<number>([M.SNOW, M.TRACK, M.ROCK, M.UMBER, M.SHADOW, M.RUT, M.MTN, M.MTNSNOW, M.FAR, M.FARSNOW, M.RIDGE, M.FOREST, M.VALLEY]);
const BACKDROP = new Set<number>([M.MTN, M.MTNSNOW, M.FAR, M.FARSNOW, M.RIDGE, M.FOREST, M.VALLEY]);

/** A line to measure against: the road's middle, a point every couple of metres, and its way there. */
export function lineOf(c: Course, s0: number, s1: number) {
  const pts: number[] = [];
  for (let s = s0; s <= s1; s += 2) { const p = c.point(s, 0), q = c.point(s + 1, 0), dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1; pts.push(p.x, p.y ?? 0, p.z, dx / l, dz / l); }
  return pts;
}

/**
 * Strokes over a mesh's faces (its vertices, four floats each: three triangles' worth at a time). With `line` (the
 * road's middle), they're sized and oriented by it: fine by the road, bigger away; the road's own strokes along it.
 * Without (the backdrop), they're sized by the faces and laid level.
 */
export function strokesOver(verts: Float32Array, seed: number, line: number[] | null, cap = 16000): Float32Array {
  const R = rng(seed * 2654435761 + 7), out: number[] = [];
  const n = verts.length / 12;
  for (let t = 0; t < n && out.length / STROKE < cap; t++) {
    const o = t * 12, mt = verts[o + 3], m = Math.floor(mt);
    if (!PAINTED.has(m)) continue;
    const ax = verts[o], ay = verts[o + 1], az = verts[o + 2], bx = verts[o + 4], by = verts[o + 5], bz = verts[o + 6], cx = verts[o + 8], cy = verts[o + 9], cz = verts[o + 10];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz), area = nl / 2;
    if (area < 1e-4) continue;
    nx /= nl; ny /= nl; nz /= nl;
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
    // (the road's middle nearest the face, and how far off it is)
    let d = 0, lx = 0, lz = 1, px = mx, pz = mz;
    if (line) {
      let best = Infinity;
      for (let k = 0; k < line.length; k += 5) { const dd = (line[k] - mx) ** 2 + (line[k + 2] - mz) ** 2; if (dd < best) { best = dd; px = line[k]; pz = line[k + 2]; lx = line[k + 3]; lz = line[k + 4]; } }
      d = Math.sqrt(best);
    }
    // (the face's normal: up, or (a steep face) toward the road it's seen from)
    if (Math.abs(ny) < 0.35 && line) { if (nx * (px - mx) + nz * (pz - mz) < 0) { nx = -nx; ny = -ny; nz = -nz; } } else if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    // (the way down the face, and across it)
    let fx = -nx * ny, fy = 1 - ny * ny, fz = -nz * ny;
    fx = -fx; fy = -fy; fz = -fz;
    const fl = Math.hypot(fx, fy, fz);
    let tx: number, ty: number, tz: number;
    const backdrop = BACKDROP.has(m) || !line;
    const across = () => { const cxx = ny * fz - nz * fy, cyy = nz * fx - nx * fz, czz = nx * fy - ny * fx, l = Math.hypot(cxx, cyy, czz) || 1; return [cxx / l, cyy / l, czz / l]; };
    const along = () => { const dp = lx * nx + lz * nz; let x = lx - nx * dp, y = -ny * dp, z = lz - nz * dp; const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
    if (m === M.TRACK || m === M.RUT || (fl < 0.12 && !backdrop) || (m === M.SNOW && d < 18)) [tx, ty, tz] = along();
    else if (m === M.SNOW && d < 40 && fl > 0.12) { const A = along(), C = across(), f = (d - 18) / 22; const x = A[0] * (1 - f) + C[0] * f, y = A[1] * (1 - f) + C[1] * f, z = A[2] * (1 - f) + C[2] * f, l = Math.hypot(x, y, z) || 1; [tx, ty, tz] = [x / l, y / l, z / l]; }
    else if ((m === M.ROCK || m === M.UMBER) && fl > 0.12) [tx, ty, tz] = [fx / fl, fy / fl, fz / fl];
    else if (fl > 0.12) [tx, ty, tz] = across();
    else [tx, ty, tz] = along();
    // (the size: fine by the road, bigger away; the backdrop by its faces)
    const road = m === M.TRACK || m === M.RUT;
    const Ls = backdrop ? Math.max(10, Math.min(260, Math.sqrt(area) * 0.6)) : Math.min(22, 2.3 * (1 + d / 22)) * (road ? 1.7 : 1);
    const Ws = Ls * (road ? 0.16 : 0.34);
    const want = (area * (backdrop ? 1.25 : 1.15)) / (Ls * Ws);
    let k = Math.floor(want) + (R() < want - Math.floor(want) ? 1 : 0);
    while (k-- > 0) {
      // (somewhere on the face)
      let a = R(), b = R(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
      const x = ax + ux * a + vx * b, y = ay + uy * a + vy * b, z = az + uz * a + vz * b;
      // (turned a little off its way, about the face's normal)
      const j = (R() - 0.5) * (m === M.TRACK ? 0.25 : 0.5), cj = Math.cos(j), sj = Math.sin(j);
      const bxx = ny * tz - nz * ty, byy = nz * tx - nx * tz, bzz = nx * ty - ny * tx;
      const wx = tx * cj + bxx * sj, wy = ty * cj + byy * sj, wz = tz * cj + bzz * sj;
      const stamp = m === M.TRACK || m === M.RUT ? (R() < 0.6 ? 0 : 1) : m === M.ROCK || m === M.UMBER ? (R() < 0.6 ? 5 : 6) : backdrop ? (R() < 0.6 ? 7 : 0) : [2, 3, 4, 1][Math.floor(R() * 4)];
      const len = Ls * (0.7 + R() * 0.6), wid = Ws * (0.75 + R() * 0.5);
      out.push(x, y, z, mt, wx, wy, wz, len, nx, ny, nz, wid, R(), stamp, (R() - 0.5) * (backdrop ? 0.3 : 0.9), 0);
    }
  }
  return new Float32Array(out);
}

/** The sky's strokes: a band of level marks round the eye from the horizon up, darkening as they rise, a few paler. */
export function skyStrokes(seed: number): Float32Array {
  const R = rng(seed * 97 + 3), out: number[] = [], RAD = 3200;
  for (let i = 0; i < 1700; i++) {
    const a = R() * Math.PI * 2, el = Math.pow(R(), 1.35) * 0.95, y = RAD * Math.tan(el) - 120;
    const x = Math.sin(a) * RAD, z = Math.cos(a) * RAD, tx = Math.cos(a), tz = -Math.sin(a);
    const len = RAD * (0.06 + R() * 0.09) * (1 + el), wid = len * (0.16 + R() * 0.12);
    out.push(x, y, z, el / 0.95, tx, 0, tz, len, -Math.sin(a), 0, -Math.cos(a), wid, R(), R() < 0.5 ? 7 : 0, (R() - 0.5) * 0.25, R() < 0.12 ? 2 : 1);
  }
  return new Float32Array(out);
}

// ─── drawing them ───────────────────────────────────────────────────────────────────────────────────────────────────────

const SEG = 8;
const VS = `#version 300 es
layout(location=0) in vec2 aQ; layout(location=1) in vec4 a0; layout(location=2) in vec4 a1; layout(location=3) in vec4 a2; layout(location=4) in vec4 a3;
uniform mat4 uVP, uPrev; uniform vec3 uOff, uEye, uSun; uniform vec3 uPal[84]; uniform float uFog, uK, uMinW, uStretch, uDens; uniform vec2 uRes;
uniform vec3 uSkyLo, uSkyHi, uSkyPale;
out vec2 vUv; out vec3 vA; out vec3 vB; flat out float vStamp;
float h(float s, float k){ return fract(sin(s*k)*43758.5453); }
void main(){
  vec3 w = a0.xyz + uOff, n = a2.xyz, t = a1.xyz; float seed = a3.x; bool sky = a3.w > .5;
  vec3 toE = uEye - w; float dist = length(toE); toE /= max(dist, 1e-4);
  float keep = sky ? 1. : uDens*mix(1., .5, smoothstep(80., 900., dist));
  if ((!sky && dot(n, toE) < -.03) || h(seed, 12.9898) > keep) { gl_Position = vec4(2., 2., 2., 1.); return; }
  // (a hair toward the eye, more the further: it sits over its own face)
  if (!sky) w += toE*(.1 + dist*.003) + n*.03;
  vec4 c = uVP*vec4(w, 1.), ct = uVP*vec4(w + t, 1.);
  if (c.w < .3) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec2 px = uRes*.5, sc = c.xy/c.w, st = ct.xy/max(ct.w, .05);
  vec2 d = (st - sc)*px; float dl = length(d), k = uK*px.y/c.w;
  vec2 dir = dl > 1e-4 ? d/dl : vec2(1., 0.);
  float L = max(a1.w*k*clamp(dl/max(k, 1e-5), .5, 1.), uMinW*3.), W = max(a2.w*k, uMinW);
  // (stretched along its own motion on the screen since the last frame)
  vec4 cp = uPrev*vec4(w, 1.);
  if (cp.w > .3 && uStretch > 0.) {
    vec2 m = (sc - cp.xy/cp.w)*px; float ml = length(m), sm = uStretch*smoothstep(4., 50., ml)*(sky ? .3 : 1.);
    if (sm > 0.) { dir = normalize(mix(dir, m/ml, sm*.85)); L += min(ml, px.y*.5)*sm; W *= 1. - .3*sm; }
  }
  float s = (aQ.x - .5)*L, bend = a3.z; vec2 q, nr;
  if (abs(bend) > .02) { float Rr = L/bend, an = s/Rr; q = vec2(Rr*sin(an), Rr*(1. - cos(an))); nr = vec2(-sin(an), cos(an)); } else { q = vec2(s, 0.); nr = vec2(0., 1.); }
  q += nr*aQ.y*W*.5;
  gl_Position = vec4(c.xy + (dir*q.x + vec2(-dir.y, dir.x)*q.y)/px*c.w, c.z, c.w);
  vUv = vec2(aQ.x, aQ.y*.5 + .5); vStamp = a3.y;
  if (sky) {
    vec3 col = mix(uSkyLo, uSkyHi, smoothstep(0., .8, a0.w));
    if (a3.w > 1.5) col = mix(col, uSkyPale, .55);
    vA = col*(.96 + h(seed, 3.7)*.08); vB = col*(1.04 + h(seed, 5.1)*.08);
    return;
  }
  // (its colour: the face's band, as the facets pick it, a little jittered stroke by stroke; and the band next to it)
  int mt = int(a0.w); float tone = fract(a0.w);
  float l = dot(n, uSun) + (tone/.9 - .5)*.42 + (h(seed, 78.233) - .5)*.12;
  int b = l > .62 ? 0 : l > .3 ? 1 : l > -.05 ? 2 : 3;
  int b2 = clamp(b + (h(seed, 3.1) > .5 ? 1 : -1), 0, 3);
  vec3 A = uPal[mt*4 + b], B = mix(A, uPal[mt*4 + b2], .45);
  float fd = length((w - uEye).xz), f = floor(clamp((fd - 80.)/520., 0., 1.)*4.)/4.;
  vec3 fogs[4] = vec3[4](vec3(.62, .66, .9), vec3(.33, .45, .88), vec3(.14, .33, .84), vec3(.09, .26, .78));
  float fk = min(1., f*1.1)*uFog;
  vA = mix(A, fogs[b], fk); vB = mix(B, fogs[b2], fk);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vA; in vec3 vB; flat in float vStamp; uniform sampler2D uAtlas; out vec4 o;
void main(){
  vec2 cell = vec2(mod(vStamp, ${STAMP.COLS}.), floor(vStamp/${STAMP.COLS}.));
  vec4 s = texture(uAtlas, (cell + vUv)/vec2(${STAMP.COLS}., ${STAMP.ROWS}.));
  if (s.r < .05) discard;
  o = vec4(mix(vA, vB, s.b)*(.84 + .32*s.g), smoothstep(.05, .5, s.r));
}`;

/** a buffer of strokes, drawn instanced */
export class Strokes {
  vao: WebGLVertexArrayObject; buf: WebGLBuffer; n = 0;
  constructor(private gl: WebGL2RenderingContext, quad: WebGLBuffer, data: Float32Array) {
    this.vao = gl.createVertexArray()!; this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (let i = 0; i < 4; i++) { gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, STROKE * 4, i * 16); gl.vertexAttribDivisor(1 + i, 1); }
    gl.bindVertexArray(null);
    this.n = data.length / STROKE;
  }
  free() { this.gl.deleteBuffer(this.buf); this.gl.deleteVertexArray(this.vao); }
}

/** the painter: the stamps, the program, and how a buffer of strokes is drawn */
export class Painter {
  prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> = {}; quad: WebGLBuffer; atlas: WebGLTexture;
  /** how much the strokes stretch along their motion (`stretch=` 0…2); how many are kept (0…1) */
  stretch = 1; dens = 1;
  constructor(private gl: WebGL2RenderingContext, palette: Float32Array, sun: number[]) {
    const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? 'shader'); return o; };
    const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const k of ['uVP', 'uPrev', 'uOff', 'uEye', 'uSun', 'uPal', 'uFog', 'uK', 'uMinW', 'uStretch', 'uDens', 'uRes', 'uAtlas', 'uSkyLo', 'uSkyHi', 'uSkyPale']) this.u[k] = gl.getUniformLocation(p, k);
    gl.useProgram(p);
    gl.uniform3fv(this.u.uPal, palette); gl.uniform3fv(this.u.uSun, new Float32Array(sun));
    gl.uniform3f(this.u.uSkyLo, 0.2, 0.42, 0.95); gl.uniform3f(this.u.uSkyHi, 0.015, 0.2, 0.82); gl.uniform3f(this.u.uSkyPale, 0.62, 0.72, 0.98);
    // (the quad: a strip along the stroke, SEG pieces, so a bent stroke bends smoothly)
    const q: number[] = [];
    for (let i = 0; i <= SEG; i++) q.push(i / SEG, -1, i / SEG, 1);
    this.quad = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(q), gl.STATIC_DRAW);
    const a = stampAtlas();
    this.atlas = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, a.w, a.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, a.data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  make(data: Float32Array) { return new Strokes(this.gl, this.quad, data); }
  /** set up for a frame: the eye, its matrices (now and the last frame's), the canvas */
  begin(vp: Float32Array, prev: Float32Array, eye: number[], projY: number, w: number, h: number, dpr: number) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uVP, false, vp); gl.uniformMatrix4fv(this.u.uPrev, false, prev);
    gl.uniform3fv(this.u.uEye, new Float32Array(eye)); gl.uniform1f(this.u.uK, projY); gl.uniform2f(this.u.uRes, w, h);
    gl.uniform1f(this.u.uMinW, 2.4 * dpr); gl.uniform1f(this.u.uStretch, this.stretch); gl.uniform1f(this.u.uDens, this.dens);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.uniform1i(this.u.uAtlas, 0);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.depthMask(false);
  }
  draw(s: Strokes, off: number[], fog: boolean) {
    const gl = this.gl;
    gl.uniform3f(this.u.uOff, off[0], off[1], off[2]); gl.uniform1f(this.u.uFog, fog ? 1 : 0);
    gl.bindVertexArray(s.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2, s.n);
  }
  end() { const gl = this.gl; gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.depthMask(true); gl.bindVertexArray(null); }
}
