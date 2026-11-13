/**
 * Switchback painted (`paint=1`): the mountain, and everything on it, laid in brush strokes, with nothing under them.
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

/** floats per stroke: where (3), material + tone; its way (3), length; its face's normal (3), width; seed, stamp, bend,
 * kind (0 ground, culled from behind; 1 sky; 2 sky, paler; 3 both sides: things, the rider); the station it's laid at
 * (or NEVER: always laid, the backdrop and what moves), its pass (0 the masses, 1 the detail), and two spare */
export const STROKE = 20;
export const NEVER = -1e9;
const ROAD = new Set<number>([M.TRACK, M.RUT]), GROUND = new Set<number>([M.SNOW, M.SHADOW]), ROCKY = new Set<number>([M.ROCK, M.UMBER, M.GOUGE]);
const BACKDROP = new Set<number>([M.MTN, M.MTNSNOW, M.FAR, M.FARSNOW, M.RIDGE, M.FOREST, M.VALLEY]);
const hash2 = (a: number, b: number) => { let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); return (h ^ (h >>> 13)) >>> 0; };

/** A line to measure against: the road's middle, a point every couple of metres: where, its way, its station. */
export function lineOf(c: Course, s0: number, s1: number) {
  const pts: number[] = [];
  for (let s = Math.max(0, s0); s <= s1; s += 2) { const p = c.point(s, 0), q = c.point(s + 1, 0), dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1; pts.push(p.x, p.y ?? 0, p.z, dx / l, dz / l, s); }
  return pts;
}

/**
 * Strokes over a mesh's faces (its vertices, four floats each: three to a triangle), enough to cover it with no
 * underpainting. Each face's strokes are its own (seeded by the face, or by its place: `place`), so a mesh built afresh
 * each frame (the rider, the ruts) keeps its strokes where they were on it.
 *
 * - the ground (the road, the snow, the rock): two passes, the masses (big, broad, laid first as the front comes) and
 *   the detail over them; sized by the road (`line`: fine by it, broad away), each laid at its station so the front
 *   lays it; running the way the ground runs (along the road and the snow by it, across the slope further off, down
 *   the face on rock);
 * - the backdrop (the ranges, the valley): big level marks, one pass, always laid;
 * - things (the fence, the posts, the pines, the kickers, the rider, a flag): small, sized by their faces, along each
 *   face's longest edge, painted on both sides; what lies flat on the ground (`flat`: your track, a shadow) is laid as
 *   the ground is.
 */
export function strokesOver(verts: Float32Array, seed: number, line: number[] | null, cap = 26000, moving = false, place = 0, flat = false): Float32Array {
  const out: number[] = [];
  const n = verts.length / 12;
  for (let t = 0; t < n && out.length / STROKE < cap; t++) {
    // (each face's strokes seeded by the face: by its place in the mesh, or, for a mesh that's a window sliding along the
    // way (`place`, the size it's known to), by where it is, so the same face keeps the same strokes as the window moves)
    const R = place > 0 ? rng(hash2(seed, hash2(Math.round((verts[t * 12] + verts[t * 12 + 4] + verts[t * 12 + 8]) / (3 * place)), Math.round((verts[t * 12 + 2] + verts[t * 12 + 6] + verts[t * 12 + 10]) / (3 * place))) ^ Math.round((verts[t * 12 + 1] + verts[t * 12 + 5] + verts[t * 12 + 9]) / (3 * place))) + 7) : rng(hash2(seed, t) + 7);
    const o = t * 12, mt = verts[o + 3], m = Math.floor(mt);
    const ax = verts[o], ay = verts[o + 1], az = verts[o + 2], bx = verts[o + 4], by = verts[o + 5], bz = verts[o + 6], cx = verts[o + 8], cy = verts[o + 9], cz = verts[o + 10];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz), area = nl / 2;
    if (area < 1e-5) continue;
    nx /= nl; ny /= nl; nz /= nl;
    const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
    const backdrop = BACKDROP.has(m), ground = !moving && (ROAD.has(m) || GROUND.has(m) || ROCKY.has(m)), thing = !backdrop && !ground;
    // (the road's middle nearest the face: how far off it is, the road's way there, its station)
    let d = 0, lx = 0, lz = 1, px = mx, pz = mz, st = NEVER;
    if (line && !moving) {
      let best = Infinity;
      for (let k = 0; k < line.length; k += 6) { const dd = (line[k] - mx) ** 2 + (line[k + 2] - mz) ** 2; if (dd < best) { best = dd; px = line[k]; pz = line[k + 2]; lx = line[k + 3]; lz = line[k + 4]; st = line[k + 5]; } }
      d = Math.sqrt(best);
    }
    const emit = (tx: number, ty: number, tz: number, Ls: number, Ws: number, cover: number, pass: number, stamps: number[], jit: number, bendA: number, kind: number) => {
      const want = (area * cover) / (Ls * Ws);
      let k = Math.floor(want) + (R() < want - Math.floor(want) ? 1 : 0);
      while (k-- > 0) {
        let a = R(), b = R(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
        const x = ax + ux * a + vx * b, y = ay + uy * a + vy * b, z = az + uz * a + vz * b;
        const j = (R() - 0.5) * jit, cj = Math.cos(j), sj = Math.sin(j);
        const bxx = ny * tz - nz * ty, byy = nz * tx - nx * tz, bzz = nx * ty - ny * tx;
        out.push(x, y, z, mt, tx * cj + bxx * sj, ty * cj + byy * sj, tz * cj + bzz * sj, Ls * (0.75 + R() * 0.5), nx, ny, nz, Ws * (0.8 + R() * 0.4), R(), stamps[Math.floor(R() * stamps.length)], (R() - 0.5) * bendA, kind,
          st, pass, moving ? 1 : 0, 0);
      }
    };
    if (thing) {
      // (a thing: along its face's longest edge, sized by the face; both sides)
      const e = [[ux, uy, uz], [vx, vy, vz], [cx - bx, cy - by, cz - bz]].sort((p, q) => Math.hypot(q[0], q[1], q[2]) - Math.hypot(p[0], p[1], p[2]))[0], el = Math.hypot(e[0], e[1], e[2]) || 1;
      const Ls = Math.max(0.07, Math.min(moving ? (flat ? 1.2 : 0.5) : 1.4, Math.sqrt(area) * 1.1));
      // (a flat thing lying on the ground (your track, a shadow) is laid as the ground is: flat on it, one side; a
      // standing thing, both sides, turning to the eye)
      if (flat && ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      emit(e[0] / el, e[1] / el, e[2] / el, Ls, Ls * (flat ? 0.35 : 0.5), flat ? 2.2 : 3.2, 1, flat ? [0, 1] : [0, 1, 2, 4], 0.35, flat ? 0.2 : 0.4, flat ? 0 : 3);
      continue;
    }
    // (the face's normal: up, or (a steep face) toward the road it's seen from)
    if (Math.abs(ny) < 0.35 && line && !moving) { if (nx * (px - mx) + nz * (pz - mz) < 0) { nx = -nx; ny = -ny; nz = -nz; } } else if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    // (the way down the face, and across it, and along the road)
    const fx = nx * ny, fy = ny * ny - 1, fz = nz * ny, fl = Math.hypot(fx, fy, fz);
    const across = () => { const a = ny * fz - nz * fy, b = nz * fx - nx * fz, c = nx * fy - ny * fx, l = Math.hypot(a, b, c) || 1; return [a / l, b / l, c / l]; };
    const along = () => { const dp = lx * nx + lz * nz; const x = lx - nx * dp, y = -ny * dp, z = lz - nz * dp; const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
    if (backdrop) {
      const [tx, ty, tz] = fl > 0.12 ? across() : along(), Ls = Math.max(10, Math.min(260, Math.sqrt(area) * 0.6));
      emit(tx, ty, tz, Ls, Ls * 0.4, 3.2, 0, [7, 0, 1], 0.4, 0.3, 0);
      continue;
    }
    let tx: number, ty: number, tz: number;
    if (ROAD.has(m) || fl < 0.12 || (GROUND.has(m) && d < 18)) [tx, ty, tz] = along();
    else if (GROUND.has(m) && d < 40) { const A = along(), C = across(), f = (d - 18) / 22; const x = A[0] * (1 - f) + C[0] * f, y = A[1] * (1 - f) + C[1] * f, z = A[2] * (1 - f) + C[2] * f, l = Math.hypot(x, y, z) || 1; [tx, ty, tz] = [x / l, y / l, z / l]; }
    else if (ROCKY.has(m)) [tx, ty, tz] = [fx / fl, fy / fl, fz / fl];
    else [tx, ty, tz] = across();
    const road = ROAD.has(m), Ls = Math.min(22, 2.3 * (1 + d / 22)) * (road ? 1.7 : 1);
    // (the masses: big and broad, laid first; then the detail over them)
    emit(tx, ty, tz, Ls * 2.2, Ls * 2.2 * (road ? 0.3 : 0.42), ROCKY.has(m) ? 3.4 : 2.6, 0, [0, 1, 7], 0.3, 0.25, 0);
    emit(tx, ty, tz, Ls, Ls * (road ? 0.16 : 0.34), 1.3, 1, road ? [0, 1] : ROCKY.has(m) ? [5, 6] : [2, 3, 4, 1], road ? 0.25 : 0.5, 0.9, 0);
  }
  return new Float32Array(out);
}

/** The sky's strokes: level marks round the eye from the horizon up past the top, close enough to cover it, darkening as
 * they rise, a few paler. */
export function skyStrokes(seed: number): Float32Array {
  const R = rng(seed * 97 + 3), out: number[] = [], RAD = 3200;
  for (let i = 0; i < 9000; i++) {
    const a = R() * Math.PI * 2, el = -0.02 + Math.pow(R(), 1.2) * 1.46, y = RAD * Math.tan(Math.min(1.45, el)) - 120;
    const x = Math.sin(a) * RAD, z = Math.cos(a) * RAD, tx = Math.cos(a), tz = -Math.sin(a);
    const len = RAD * (0.08 + R() * 0.11) * (1 + el * 1.5), wid = len * (0.3 + R() * 0.16);
    out.push(x, y, z, Math.max(0, el) / 1.44, tx, 0, tz, len, -Math.sin(a), 0, -Math.cos(a), wid, R(), R() < 0.5 ? 7 : 0, (R() - 0.5) * 0.25, R() < 0.1 ? 2 : 1, NEVER, 0, 0, 0);
  }
  return new Float32Array(out);
}

// ─── drawing them ───────────────────────────────────────────────────────────────────────────────────────────────────────

const SEG = 8;
const VS = `#version 300 es
layout(location=0) in vec2 aQ; layout(location=1) in vec4 a0; layout(location=2) in vec4 a1; layout(location=3) in vec4 a2; layout(location=4) in vec4 a3; layout(location=5) in vec4 a4;
uniform mat4 uVP, uPrev; uniform vec3 uOff, uEye, uSun; uniform vec3 uPal[84]; uniform float uFog, uK, uMinW, uStretch, uDens, uGrow, uReveal; uniform vec2 uRes, uFront;
uniform vec3 uSkyLo, uSkyHi, uSkyPale, uSmear;
out vec2 vUv; out vec3 vA; out vec3 vB; flat out float vStamp; out float vFresh;
float h(float s, float k){ return fract(sin(s*k)*43758.5453); }
void main(){
  vec3 w = a0.xyz + uOff, n = a2.xyz, T = normalize(a1.xyz); float seed = a3.x, kind = a3.w; bool sky = kind > .5 && kind < 2.5, both = kind > 2.5;
  vec3 V = uEye - w; float dist = length(V); V /= max(dist, 1e-4);
  // (the paint front: a stroke at its station is laid, tail to head, as the front for its pass comes past; the backdrop
  // and what moves are laid as the page opens)
  float g = 1., fresh = 0.;
  if (a4.x > -1e8) { float fr = a4.y < .5 ? uFront.x : uFront.y; g = clamp((fr - a4.x)/uGrow, 0., 1.); fresh = 1. - clamp((fr - a4.x - uGrow)/25., 0., 1.); }
  else g = clamp((uReveal*1.5 - h(seed, 7.77)*.9 - (sky ? 0. : .2))/.35, 0., 1.);
  float keep = sky || both ? 1. : uDens*mix(1., .5, smoothstep(80., 900., dist));
  if (!sky && dot(n, V) < 0.) n = -n;
  // (thinned with distance: a stroke past its turn shrinks away over a little more distance, rather than going at once)
  g *= clamp((keep - h(seed, 12.9898))/.12 + 1., 0., 1.);
  vec4 c = uVP*vec4(w, 1.);
  if (g <= 0. || c.w < .3) { gl_Position = vec4(2., 2., 2., 1.); return; }
  // The stroke is laid in the world, on its face, along its own way: nothing about how it lies comes from the screen, so
  // it can't swing as the eye moves. Across it, its width turns from lying on the face toward facing the eye as it gets
  // further off, so it never thins to a sliver (after Brush Rush).
  // (the speed: at pace the stroke turns, on its own face, toward the way the eye is going (one way for every stroke, the
  // eye's smoothed motion in the world, so it holds steady), and draws out by as far as the eye's gone in a moment: the
  // ground and the rock fall into line with the motion, and stream past)
  float smearL = 0.;
  if (!sky && a4.z < .5 && dot(uSmear, uSmear) > 1e-3) {
    vec3 sd = uSmear - n*dot(uSmear, n); float sl = length(sd);
    if (sl > 1e-3) { sd /= sl; if (dot(sd, T) < 0.) sd = -sd; T = normalize(mix(T, sd, clamp(sl/2.4, 0., 1.)*.9)); smearL = sl; }
  }
  vec3 Bn = normalize(cross(n, T)), Be = cross(T, V); float bl = length(Be); Be = bl > .001 ? Be/bl : Bn; if (dot(Be, Bn) < 0.) Be = -Be;
  float face = sky ? 1. : both ? .35 + .5*smoothstep(4., 40., dist) : .15 + .75*smoothstep(5., 70., dist);
  vec3 Wd = normalize(mix(Bn, Be, face));
  // its size: thinned out, the ones kept are bigger; never thinner on the picture than a few pixels, never more than a part of it
  float grow = inversesqrt(max(keep, .3)), k = uK*uRes.y*.5/c.w;
  float len = a1.w*grow, wid = a2.w*grow;
  wid = clamp(wid, uMinW/k, uRes.y*.19/k); len = clamp(len, wid*1.6, uRes.y*.5/k) + min(smearL, uRes.y*.3/k);
  float u = aQ.x*g, c2 = 2.*u - 1., s = (u - .5)*len, bend = a3.z*len*(1. - c2*c2)*.25;
  vec3 p = w + T*s + Wd*(aQ.y*wid*.5 + bend);
  vec4 cq = uVP*vec4(p, 1.);
  // its depth lifted toward the eye, along the line to the eye so it doesn't move on the picture: on the ground a little,
  // more the further (after Brush Rush), on a thing by half its own size; so it clears its own face, never cutting into it
  float lift = sky ? 0. : both ? .02 + max(len, wid)*.5 : .25 + dist*.02 + wid*.5;
  vec4 cl = uVP*vec4(p + V*min(lift, dist*.5), 1.);
  gl_Position = vec4(cq.xy, cl.z/cl.w*cq.w, cq.w);
  vUv = vec2(u, aQ.y*.5 + .5); vStamp = a3.y; vFresh = fresh;
  if (sky) {
    vec3 col = mix(uSkyLo, uSkyHi, smoothstep(0., .8, a0.w));
    if (kind > 1.5) col = mix(col, uSkyPale, .55);
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
in vec2 vUv; in vec3 vA; in vec3 vB; flat in float vStamp; in float vFresh; uniform sampler2D uAtlas; out vec4 o;
void main(){
  vec2 cell = vec2(mod(vStamp, ${STAMP.COLS}.), floor(vStamp/${STAMP.COLS}.));
  vec4 s = texture(uAtlas, (cell + vUv)/vec2(${STAMP.COLS}., ${STAMP.ROWS}.));
  if (s.r < .05) discard;
  vec3 c = mix(vA, vB, s.b)*(.84 + .32*s.g);
  // (fresh paint, just laid: a little lighter, wet)
  c = mix(c, c*1.1 + .04, vFresh*.3);
  // (premultiplied, blended in a fixed order: no dithered coverage to crawl as the strokes shift)
  float a = smoothstep(.05, .5, s.r);
  o = vec4(c*a, a);
}`;

/** a buffer of strokes, drawn instanced (`set` again for what moves) */
export class Strokes {
  vao: WebGLVertexArrayObject; buf: WebGLBuffer; n = 0;
  constructor(private gl: WebGL2RenderingContext, quad: WebGLBuffer, data: Float32Array, dynamic = false) {
    this.vao = gl.createVertexArray()!; this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    for (let i = 0; i < 5; i++) { gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, STROKE * 4, i * 16); gl.vertexAttribDivisor(1 + i, 1); }
    gl.bindVertexArray(null);
    this.n = data.length / STROKE;
  }
  set(data: Float32Array) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); this.n = data.length / STROKE; }
  free() { this.gl.deleteBuffer(this.buf); this.gl.deleteVertexArray(this.vao); }
}

/** the painter: the stamps, the program, and how a buffer of strokes is drawn */
export class Painter {
  prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> = {}; quad: WebGLBuffer; atlas: WebGLTexture;
  /** how much the strokes stretch along their motion (`stretch=` 0…2); how many are kept (0…1) */
  stretch = 1; dens = 1;
  /** the paint front: how far ahead of the rider the masses and the detail are laid, how long a stroke takes to lay (m) */
  lead: [number, number] = [420, 110]; grow = 22;
  private front: [number, number] | null = null; private born = performance.now(); private last = performance.now();
  constructor(private gl: WebGL2RenderingContext, palette: Float32Array, sun: number[]) {
    const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? 'shader'); return o; };
    const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const k of ['uSmear', 'uVP', 'uPrev', 'uOff', 'uEye', 'uSun', 'uPal', 'uFog', 'uK', 'uMinW', 'uStretch', 'uDens', 'uRes', 'uAtlas', 'uSkyLo', 'uSkyHi', 'uSkyPale', 'uFront', 'uGrow', 'uReveal']) this.u[k] = gl.getUniformLocation(p, k);
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
  make(data: Float32Array, dynamic = false) { return new Strokes(this.gl, this.quad, data, dynamic); }
  /** where the rider is: the front only ever goes on (put back at a checkpoint, what's laid stays laid) */
  advance(s: number) {
    // (it sets out from where you are as the page opens, and runs on ahead to its lead, easing up to it and keeping it)
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (!this.front) this.front = [s - 4, s - 4];
    for (const i of [0, 1]) { const want = s + this.lead[i], f = this.front[i]; if (want > f) this.front[i] = f + Math.max((want - f) * Math.min(1, dt * 1.6), Math.min(want - f, 20 * dt)); }
  }
  /** set up for a frame: the eye, its matrices (now and the last frame's), the canvas */
  begin(vp: Float32Array, prev: Float32Array, eye: number[], projY: number, w: number, h: number, dpr: number, smear: number[] = [0, 0, 0]) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniform3f(this.u.uSmear, smear[0] * this.stretch, smear[1] * this.stretch, smear[2] * this.stretch);
    gl.uniformMatrix4fv(this.u.uVP, false, vp); gl.uniformMatrix4fv(this.u.uPrev, false, prev);
    gl.uniform3fv(this.u.uEye, new Float32Array(eye)); gl.uniform1f(this.u.uK, projY); gl.uniform2f(this.u.uRes, w, h);
    gl.uniform1f(this.u.uMinW, 2.4 * dpr); gl.uniform1f(this.u.uStretch, this.stretch); gl.uniform1f(this.u.uDens, this.dens);
    const fr = this.front ?? [-1e9, -1e9]; gl.uniform2f(this.u.uFront, fr[0], fr[1]); gl.uniform1f(this.u.uGrow, this.grow);
    gl.uniform1f(this.u.uReveal, Math.min(1, (performance.now() - this.born) / 1600));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.uniform1i(this.u.uAtlas, 0);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false);
  }
  draw(s: Strokes, off: number[], fog: boolean) {
    const gl = this.gl;
    if (!s.n) return;
    gl.uniform3f(this.u.uOff, off[0], off[1], off[2]); gl.uniform1f(this.u.uFog, fog ? 1 : 0);
    gl.bindVertexArray(s.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2, s.n);
  }
  end() { const gl = this.gl; gl.disable(gl.BLEND); gl.depthMask(true); gl.bindVertexArray(null); }
}

// ─── the speed layer's brush ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The same stamps, for the 2D speed layer (shards, smears, the air off the rider, debris), when the picture's painted:
 * a wedge (thick at its base, to its point) becomes a long brush stroke tapering the same way; a chip of debris a dab.
 * Each colour's stamps are tinted once and kept.
 */
export class Brush2D {
  private atlas: { data: Uint8Array; w: number; h: number };
  private tinted = new Map<string, HTMLCanvasElement>();
  constructor() { this.atlas = stampAtlas(); }
  private sheet(col: string) {
    let c = this.tinted.get(col);
    if (c) return c;
    const { data, w, h } = this.atlas, r = parseInt(col.slice(1, 3), 16), g = parseInt(col.slice(3, 5), 16), b = parseInt(col.slice(5, 7), 16);
    c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d')!, img = x.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const cov = data[i * 4] / 255, rel = data[i * 4 + 1] / 255, tone = data[i * 4 + 2] / 255, k = 0.84 + 0.3 * rel + (tone - 0.5) * 0.12;
      img.data[i * 4] = Math.min(255, r * k); img.data[i * 4 + 1] = Math.min(255, g * k); img.data[i * 4 + 2] = Math.min(255, b * k);
      img.data[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (cov - 0.05) / 0.45)));
    }
    x.putImageData(img, 0, 0);
    this.tinted.set(col, c);
    return c;
  }
  /** a stroke from its base at `a` (half-width w) to its point at `b`, in stamp `st` */
  wedge(ctx: CanvasRenderingContext2D, a: number[], b: number[], w: number, col: string, st = 0) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1) return;
    const W = Math.max(2, w * 3), cell = [(st % STAMP.COLS) * STAMP.W, Math.floor(st / STAMP.COLS) * STAMP.H];
    ctx.save(); ctx.translate(a[0], a[1]); ctx.rotate(Math.atan2(dy, dx));
    ctx.drawImage(this.sheet(col), cell[0], cell[1], STAMP.W, STAMP.H, -L * 0.03, -W / 2, L * 1.06, W);
    ctx.restore();
  }
  /** a dab, `s` across, turned by `a` */
  dab(ctx: CanvasRenderingContext2D, p: number[], s: number, a: number, col: string) {
    const st = 3, cell = [(st % STAMP.COLS) * STAMP.W, Math.floor(st / STAMP.COLS) * STAMP.H];
    ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(a);
    ctx.drawImage(this.sheet(col), cell[0], cell[1], STAMP.W, STAMP.H, -s * 1.3, -s * 0.6, s * 2.6, s * 1.2);
    ctx.restore();
  }
}
