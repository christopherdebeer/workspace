/**
 * A crystal anomaly: the Crystals experiment's own specimen for the find's seed (crystals/
 * mineral.ts — its species, its habit, every crystal of its cluster as the convex hull of its
 * planes) grown to tens of metres and broken up out of the ground, its matrix a low dome of rock
 * half-buried, and about it shards of the same species breaking through the litter, smaller
 * further out. Built as faceted meshes (each face its hull's polygon, cut small to bend with the
 * wood's projection) and drawn into Mistwood's scene, writing its depth: the trees go in front of
 * it and behind it.
 *
 * Its glass is the Crystals experiment's own optics (crystals/shaders.ts), worked in the
 * specimen's own units so every feature is at its true scale: each pixel of a face is traced into
 * the crystal's hull — refracted in, reflected about inside (total internal reflection; the fire
 * of a stone is its later exits), out wherever it leaves, each colour at its own index — absorbed
 * by its body over the path, with its zoning, phantoms, veils, bubbles, needles met exactly,
 * cracks glinting with a thin film's colours, striated and frosted faces, tarnish. Only the world
 * it sees is different: not the studio but the wood — what lies beyond it as drawn so far this
 * frame, and in its faces the wood about it (the frame before, the crystals left out of it), and
 * the sun or moon through the fog.
 */
import { hash, seeded } from '../kit/rng';
import { planesOf, specimen, type Crystal, type Plane, type Species, type Specimen } from '../crystals/mineral';
import { WOOD_GLSL, type WoodEnv } from '../mistwood/render';
import { Builder, PROJECT, cross, dot, norm, program, upload, type Mesh, type V3 } from './mesh';
import type { Find } from './finds';

/** crystals in a specimen at most (crystals/shaders.ts MAXC) */
const MAXC = 12;
// position, normal, part (0 a crystal of the cluster, 1 the matrix, 2 a shard) and the crystal's
// index, a shard's axis and how far along it (0 base … 1 tip)
const STRIDE = 12;
const VS = `#version 300 es
in vec3 aP;
in vec3 aN;
in vec2 aK;
in vec4 aA;
uniform vec3 uAnchor;
${PROJECT}
out vec3 vWorld;
out vec3 vN;
out vec2 vK;
out vec4 vA;
out float vDist;
void main() {
  vWorld = uAnchor + aP;
  vDist = project(vWorld);
  vN = aN; vK = aK; vA = aA;
}`;
const FS = () => `#version 300 es
precision highp float;
precision highp int;
in vec3 vWorld;
in vec3 vN;
in vec2 vK;
in vec4 vA;
in float vDist;
out vec4 o;
uniform float uDensity;
${WOOD_GLSL()}
// ─── the specimen, packed as the Crystals experiment packs it (crystals/engine.ts) ──────────────
uniform sampler2D uPlanes;
uniform vec4 uC1[${MAXC}]; // plane start, count, ior, dispersion
uniform vec4 uC2[${MAXC}]; // absorption rgb, milk
uniform vec4 uC3[${MAXC}]; // base point, striation
uniform vec4 uC4[${MAXC}]; // the axis, length
uniform vec4 uC5[${MAXC}]; // the x column, radius
uniform vec4 uC6[${MAXC}]; // the second absorption rgb, zoning mode
uniform vec4 uC7[${MAXC}]; // veils, needles, cracks, phantom
uniform vec4 uC8[${MAXC}]; // needle colour rgb, bubbles
uniform vec4 uC9[${MAXC}]; // frosted, tarnish
uniform vec3 uMat;
uniform float uSpecSeed;
uniform float uDispOn;
// ─── where the specimen is in the wood: its heart (uAnchor), metres to its units, its turn, the
// ground's height in its units
uniform vec3 uAnchor;
uniform float uScale, uTurn, uYG;
// (the shards, shaded more simply: the species' colour, index and absorption)
uniform vec3 uTint;
uniform float uIor, uAbsorb;
// ─── the wood it sees: as drawn so far this frame (what lies beyond it), and the frame before (to
// mirror; the crystals marked out of it in its alpha). uGrab 0: neither (the mist only)
uniform sampler2D uScene, uPrev;
uniform float uGrab;
uniform vec2 uRes;
uniform float uF, uHz;

// ── the specimen's terms and the wood's ──
vec3 toSpecP(vec3 w) { vec3 q = (w - uAnchor) / uScale; float c = cos(uTurn), s = sin(uTurn); return vec3(q.x * c + q.z * s, q.y + uYG, -q.x * s + q.z * c); }
vec3 toSpecD(vec3 d) { float c = cos(uTurn), s = sin(uTurn); return vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c); }
vec3 toWorldD(vec3 d) { float c = cos(uTurn), s = sin(uTurn); return vec3(d.x * c - d.z * s, d.y, d.x * s + d.z * c); }
vec3 toWorldP(vec3 p) { return uAnchor + toWorldD(vec3(p.x, p.y - uYG, p.z)) * uScale; }
// where on the screen (0..1) a direction is seen, in the wood's projection (what lies behind you,
// not on it, folded into view: the wood behind is like the wood ahead, near enough)
vec2 screenDir(vec3 d) {
  float cs = cos(uCam.w), sn = sin(uCam.w);
  float cx = d.x * cs - d.z * sn, cz = d.x * sn + d.z * cs;
  float a = abs(cx) + abs(cz) < 1e-6 ? 0. : atan(cx, cz);
  float hw = .5 * uRes.x / uF;
  if (abs(a) > hw) a = sign(a) * max(0., 3.14159 - abs(a));
  a = clamp(a, -hw, hw);
  float el = clamp(d.y / max(length(vec2(cx, cz)), .05), -2., 2.);
  return clamp(vec2(a * uF + .5 * uRes.x, el * uF + uHz) / uRes, vec2(.002), vec2(.998));
}
vec2 screenAt(vec3 w) { return screenDir(w - vec3(uCam.x, uCam.z, uCam.y)); }
// the key light: the sun (or moon) behind the fog, toward it, in the wood and in the specimen
vec3 keyW() { return normalize(vec3(sin(uSun.x) * cos(uSun.y), max(sin(uSun.y), .12), cos(uSun.x) * cos(uSun.y))); }

// ── crystals/shaders.ts, as it is (its noise, its hulls, its Fresnel) ──
float hash3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1 + 3.7) * 0.28 + vnoise(p * 4.3 + 9.1) * 0.17; }
bool hull(int s, int n, vec3 o, vec3 d, out float tn, out float tf, out vec3 nn, out vec3 nf) {
  tn = -1e9; tf = 1e9; nn = vec3(0.0, 1.0, 0.0); nf = nn;
  for (int k = 0; k < 24; k++) {
    if (k >= n) break;
    int i = s + k;
    vec4 pl = texelFetch(uPlanes, ivec2(i & 63, i >> 6), 0);
    float dn = dot(pl.xyz, d);
    float dist = pl.w - dot(pl.xyz, o);
    if (abs(dn) < 1e-7) { if (dist < 0.0) return false; continue; }
    float t = dist / dn;
    if (dn < 0.0) { if (t > tn) { tn = t; nn = pl.xyz; } }
    else if (t < tf) { tf = t; nf = pl.xyz; }
    if (tn > tf) return false;
  }
  return tf > 0.0;
}
float ellipsoid(vec3 o, vec3 d) {
  vec3 oo = o / uMat, dd = d / uMat;
  float a = dot(dd, dd), b = dot(oo, dd), c = dot(oo, oo) - 1.0;
  float h = b * b - a * c; if (h < 0.0) return 1e9;
  float t = (-b - sqrt(h)) / a; return t > 0.0 ? t : 1e9;
}
float schlick(float c, float ior) { float f0 = (ior - 1.0) / (ior + 1.0); f0 *= f0; float x = clamp(1.0 - c, 0., 1.); float x2 = x * x; return f0 + (1.0 - f0) * x2 * x2 * x; }

// ── the world it sees: the wood, not the studio ──
/** what a face mirrors, looking along d (specimen terms): the wood about it, the mist and the sky
 *  above, the sun or moon through the fog */
vec3 env(vec3 dS) {
  vec3 d = toWorldD(dS);
  vec3 e = fogDir(d);
  if (uGrab > .5) {
    vec2 at = screenDir(d);
    vec4 w = texture(uPrev, at), w2 = texture(uPrev, vec2(1. - at.x, at.y));
    w = w.a > .5 ? w : w2;
    e = mix(e, w.rgb, smoothstep(.5, .9, w.a) * (.85 - .5 * smoothstep(.35, .9, d.y)));
  }
  float k = max(dot(d, keyW()), 0.);
  return e + uIllum * (1.4 * smoothstep(.975, .998, k) + .3 * pow(k, 10.));
}
/** what a ray meets leaving the crystal (specimen terms): its rock; else the wood beyond it, as
 *  drawn so far this frame (a few metres on, where the trees are) */
vec3 beyond(vec3 pS, vec3 dS) {
  if (ellipsoid(pS, dS) < 1e8) return vec3(.1, .095, .09) * uIllum;
  vec3 d = toWorldD(dS);
  if (uGrab < .5) return fogDir(d);
  return texture(uScene, screenAt(toWorldP(pS) + d * 9.)).rgb;
}

// ── crystals/shaders.ts MAIN_FS: the inside, the way through, the face ──
vec3 local(int id, vec3 p) {
  vec3 q = p - uC3[id].xyz; vec3 ax = uC4[id].xyz, xc = uC5[id].xyz, zc = cross(ax, xc);
  return vec3(dot(q, xc), dot(q, ax), dot(q, zc));
}
float h1(float x) { return fract(sin(x * 127.1 + uSpecSeed) * 43758.5453); }
vec3 h3(float x) { return vec3(h1(x), h1(x + 7.3), h1(x + 19.1)); }
vec3 striate(int id, vec3 p, vec3 n) {
  float k = uC3[id].w; if (k < 0.01) return n;
  vec3 ax = uC4[id].xyz;
  if (abs(dot(n, ax)) > 0.35) return n;
  vec3 t = normalize(cross(ax, n));
  float u = dot(p, t) * 140.0 + h1(float(id)) * 50.0;
  float w = sin(u) * 0.6 + sin(u * 2.7 + 1.0) * 0.3 + sin(u * 0.31) * 0.4;
  return normalize(n + t * w * 0.02 * k);
}
struct Inner { vec3 absorb; vec3 scatter; vec3 glint; vec3 solid; float hit; };
Inner interior(int id, vec3 q, vec3 rd, float len, vec3 kL, vec3 kC) {
  Inner r; r.absorb = uC2[id].xyz; r.scatter = vec3(0.0); r.glint = vec3(0.0); r.solid = vec3(0.0); r.hit = 1e9;
  float L = max(uC4[id].w, 0.02), R = max(uC5[id].w, 0.02);
  float mode = uC6[id].w, veils = uC7[id].x, cracks = uC7[id].z, phantom = uC7[id].w, bubbles = uC8[id].w;
  float fid = float(id) * 3.7;
  float zone = 0.0, veil = 0.0, bub = 0.0, ghost = 0.0;
  const int N = 10;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N) * len;
    vec3 lp = local(id, q + rd * t);
    float rad = length(lp.xz), y = lp.y / L, rr = rad / R;
    if (mode > 0.5 && mode < 1.5) zone += smoothstep(0.45, 0.95, y + 0.15 * sin(lp.x * 9.0 + lp.z * 7.0));
    else if (mode < 2.5 && mode > 1.5) zone += 1.0 - smoothstep(0.45, 0.85, rr);
    else if (mode > 2.5) zone += 0.5 + 0.5 * sin(y * 11.0 + 2.5 * fbm(lp * 3.0 + fid));
    if (phantom > 0.0) { float g = y + rr * 0.55; ghost += smoothstep(0.02, 0.0, abs(fract(g * 1.15 + h1(fid)) - 0.5) - 0.47) * step(0.3, y) * (0.6 + 0.4 * fbm(lp * 6.0)); }
    if (veils > 0.0) { vec3 vn = normalize(h3(fid + 1.0) - 0.5); float dv = abs(dot(lp, vn) - (h1(fid + 2.0) - 0.5) * R); float mask = smoothstep(0.52, 0.7, fbm(lp * 5.0 + fid)); veil += smoothstep(0.03, 0.0, dv) * mask; }
    if (bubbles > 0.0) { vec3 c = floor(lp * 14.0); vec3 jit = h3(dot(c, vec3(1.0, 57.0, 113.0)) + fid); float db = length(fract(lp * 14.0) - 0.5 - (jit - 0.5) * 0.6); bub += step(jit.x, bubbles * 0.5) * smoothstep(0.16, 0.0, db); }
  }
  zone /= float(N);
  r.absorb = mix(uC2[id].xyz, uC6[id].xyz, zone);
  r.scatter = (veil * veils * 0.35 + ghost * phantom * 0.07 + bub * 0.8) / float(N) * kC;
  int nn = int(uC7[id].y);
  vec3 lq = local(id, q), lrd = local(id, q + rd) - lq;
  for (int k = 0; k < 4; k++) {
    if (k >= nn) break;
    float fk = fid + 11.0 + float(k) * 5.1;
    vec3 c = (h3(fk) - 0.5) * vec3(R * 1.6, L * 0.9, R * 1.6) + vec3(0.0, L * 0.5, 0.0);
    vec3 dn = uC7[id].y > 0.0 && uC8[id].w < -0.5 ? vec3(0.0, 1.0, 0.0) : normalize(h3(fk + 2.0) - 0.5);
    float rn = 0.006 + 0.004 * h1(fk + 4.0);
    vec3 oc = lq - c; vec3 dd = lrd - dn * dot(lrd, dn); vec3 oo = oc - dn * dot(oc, dn);
    float a = dot(dd, dd), b = dot(oo, dd), cc = dot(oo, oo) - rn * rn; float h = b * b - a * cc;
    if (h < 0.0 || a < 1e-6) continue;
    float t = (-b - sqrt(h)) / a;
    if (t > 0.0 && t < len && t < r.hit) { float along = dot(oc + lrd * t, dn); if (abs(along) < L * 0.5) { r.hit = t; vec3 pn = normalize(oo + dd * t); r.solid = uC8[id].xyz * (0.3 + 0.7 * max(dot(pn, local(id, q + kL) - lq), 0.0)) * kC; } }
  }
  float cracks2 = cracks;
  if (cracks2 > 0.0) for (int k = 0; k < 2; k++) {
    float fk = fid + 31.0 + float(k) * 7.7;
    vec3 cn = normalize(h3(fk) - 0.5); float cd = (h1(fk + 1.0) - 0.5) * R * 0.8 + cn.y * L * 0.5;
    float dn = dot(lrd, cn); if (abs(dn) < 1e-5) continue;
    float t = (cd - dot(lq, cn)) / dn;
    if (t < 0.0 || t > len) continue;
    vec3 lp = lq + lrd * t;
    float mask = smoothstep(0.5, 0.62, fbm(lp * 4.0 + fk)) * cracks2 * step(0.0, lp.y) * step(lp.y, L);
    if (mask <= 0.0) continue;
    vec3 wn = normalize(uC5[id].xyz * cn.x + uC4[id].xyz * cn.y + cross(uC4[id].xyz, uC5[id].xyz) * cn.z);
    float c = abs(dot(rd, wn));
    vec3 film = mix(vec3(1.0), 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + c * 9.0 + h1(fk) * 6.0), 0.55);
    float g = 1.0 - c;
    r.glint += env(reflect(rd, wn)) * film * mask * (0.25 + 0.75 * g * g) * 0.6;
    r.scatter += mask * 0.03 * kC;
  }
  return r;
}
/** one index through the crystal: in at p, out somewhere, and what it sees beyond */
vec3 through(int id, vec3 p, vec3 d, vec3 nn, float ior, out float path) {
  vec3 rd = refract(d, nn, 1.0 / ior);
  vec3 q = p - nn * 1e-3;
  int s = int(uC1[id].x), n = int(uC1[id].y);
  path = 0.0; float w = 1.0; vec3 sum = vec3(0.0);
  for (int b = 0; b < 5; b++) {
    float a, bb; vec3 na, nb;
    if (!hull(s, n, q, rd, a, bb, na, nb)) break;
    vec3 q2 = q + rd * bb; path += bb;
    vec3 rd2 = refract(rd, -nb, ior);
    if (dot(rd2, rd2) < 0.5) { rd = reflect(rd, -nb); q = q2 + rd * 1e-3; w *= 0.985; continue; }
    float F2 = schlick(max(dot(rd2, nb), 0.0), ior);
    vec3 seen = beyond(q2 + nb * 1e-3, rd2);
    sum += w * (1.0 - F2) * seen;
    w *= F2;
    if (w < 0.03) break;
    rd = reflect(rd, -nb); q = q2 + rd * 1e-3;
  }
  return sum;
}
vec3 crystalShade(int id, vec3 p, vec3 d, vec3 nn) {
  vec3 kL = toSpecD(keyW()), kC = uIllum * 1.3;
  float ior = uC1[id].z, disp = uC1[id].w;
  nn = striate(id, p, nn);
  if (uC9[id].x > 0.5 && abs(dot(nn, uC4[id].xyz)) < 0.35) {
    vec3 j = vec3(hash3(p * 900.0), hash3(p * 900.0 + 3.0), hash3(p * 900.0 + 7.0)) - 0.5;
    nn = normalize(nn + j * 0.14);
  }
  float cosi = max(dot(-d, nn), 0.0);
  float F = schlick(cosi, ior);
  vec3 refl = env(reflect(d, nn));
  if (uC9[id].y > 0.0) { float tm = smoothstep(0.5, 0.7, fbm(p * 7.0 + float(id))) * uC9[id].y; vec3 film = mix(vec3(1.0), 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + cosi * 7.0 + fbm(p * 11.0) * 3.0), 0.6); refl = mix(refl, refl * film * 1.5, tm); }
  vec3 rd0 = refract(d, nn, 1.0 / ior); vec3 q0 = p - nn * 1e-3;
  float a0, b0; vec3 na0, nb0; hull(int(uC1[id].x), int(uC1[id].y), q0, rd0, a0, b0, na0, nb0);
  Inner in_ = interior(id, q0, rd0, max(b0, 0.), kL, kC);
  vec3 tr; float path;
  // (each colour at its own index close to — the fire; one ray for all three further off)
  if (uDispOn > .5) {
    float pr, pb;
    tr.r = through(id, p, d, nn, ior - disp, pr).r;
    tr.b = through(id, p, d, nn, ior + disp, pb).b;
    tr.g = through(id, p, d, nn, ior, path).g;
  } else tr = through(id, p, d, nn, ior, path);
  vec3 T = exp(-in_.absorb * path);
  float milk = 1.0 - exp(-uC2[id].w * path);
  vec3 body = exp(-in_.absorb * 0.7) * (kC * 0.22 * (0.5 + 0.5 * max(dot(nn, kL), 0.0)) + fogDir(toWorldD(nn)) * .2);
  vec3 inner = mix(T * tr, body, milk);
  if (in_.hit < 1e8) inner = in_.solid * exp(-in_.absorb * in_.hit) + in_.scatter * exp(-in_.absorb * 0.5);
  else inner += in_.scatter * exp(-in_.absorb * 0.5) * 2.0;
  inner += in_.glint;
  float g = 1.0 - cosi, g2 = g * g;
  return F * refl + (1.0 - F) * inner + g2 * g2 * g2 * 0.15 * kC * 0.2;
}

void main() {
  // (what is under the ground is not seen: the ground does not hide it by its depth)
  if (vWorld.y < landH(vWorld.xz) - .04) discard;
  vec3 eye = vec3(uCam.x, uCam.z, uCam.y);
  vec3 V = normalize(eye - vWorld);
  vec3 N = normalize(vN);
  if (dot(N, V) < 0.) N = -N;
  vec3 L = keyW();
  vec3 col;
  if (vK.x < .5) {
    // a crystal of the cluster: traced as the Crystals experiment traces it, in its own units
    int id = int(vK.y + .5);
    col = crystalShade(id, toSpecP(vWorld), toSpecD(-V), toSpecD(N));
  } else if (vK.x < 1.5) {
    // the matrix: dark stone, rough, in the wood's light
    float n = fbm(vWorld.xz * .3 + vWorld.y * .25);
    vec3 stone = mix(vec3(.1, .095, .09), vec3(.3, .29, .27), n) * (.7 + .5 * vnoise(vWorld.xz * 2.7 + vWorld.y * 1.3));
    col = stone * (.4 + .6 * max(dot(N, L), 0.)) * uIllum + stone * fogDir(N) * .25;
  } else {
    // a shard: small, and among the trees (drawn before them): its face and its body, simply
    float NV = min(abs(dot(N, V)), 1.);
    vec3 Rd = refract(-V, N, 1. / uIor);
    if (dot(Rd, Rd) < .01) Rd = reflect(-V, N);
    float F = schlick(NV, uIor);
    float depth = 1. + 2. * (1. - NV);
    vec3 through = mix(uFogLow, fogDir(Rd), .55) * pow(uTint, vec3(1.2 + uAbsorb * depth));
    vec3 ax = vA.xyz;
    vec3 b1 = normalize(cross(ax, abs(ax.y) < .9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.)));
    float r1 = dot(Rd, b1), r2 = dot(Rd, cross(ax, b1));
    float ang = abs(r1) + abs(r2) < 1e-6 ? 0. : atan(r1, r2);
    float facets = smoothstep(-.06, .06, sin(ang * 3. + dot(Rd, ax) * 7. + vA.w * 2.5));
    through *= mix(.45, 1.4, facets);
    float k = max(dot(reflect(-V, N), L), 0.);
    col = mix(through, fogDir(reflect(-V, N)), F * .8 + .1) + uIllum * (1.4 * smoothstep(.975, .998, k) + .3 * pow(k, 10.));
  }
  float fogD = fogAt(vDist, vWorld.y - uBase, uDensity);
  float fog = 1. - (1. - fogD) * (1. - mistTo(vWorld));
  o = vec4(mix(col, fogToward(vWorld), fog) + dither(), 1.);
}`;

/** a convex hull's faces: each plane's polygon, cut by all the others (in order round its normal) */
export function hullFaces(planes: Plane[]): Array<{ n: V3; pts: V3[] }> {
  const out: Array<{ n: V3; pts: V3[] }> = [];
  for (let i = 0; i < planes.length; i++) {
    const n = planes[i].n as V3, d = planes[i].d;
    const c: V3 = [n[0] * d, n[1] * d, n[2] * d];
    const u = norm(cross(Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], n)), v = cross(n, u);
    const S = 1e3;
    let poly: V3[] = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => [c[0] + (u[0] * a + v[0] * b) * S, c[1] + (u[1] * a + v[1] * b) * S, c[2] + (u[2] * a + v[2] * b) * S]);
    for (let j = 0; j < planes.length && poly.length >= 3; j++) {
      if (j === i) continue;
      const pn = planes[j].n as V3, pd = planes[j].d;
      const next: V3[] = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        const da = dot(pn, a) - pd, db = dot(pn, b) - pd;
        if (da <= 0) next.push(a);
        if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
      }
      poly = next;
    }
    // (a face cut to nothing, or to a sliver)
    if (poly.length >= 3) out.push({ n, pts: poly });
  }
  return out;
}

/** a rotation whose +Y is `axis`, rolled about it (columns x, y, z) — as mineral.ts frames its crystals */
function frame(axis: V3, roll: number): number[] {
  const y = norm(axis);
  let x = norm(cross(Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], y));
  let z = norm(cross(y, x));
  const c = Math.cos(roll), s = Math.sin(roll);
  x = [x[0] * c + z[0] * s, x[1] * c + z[1] * s, x[2] * c + z[2] * s];
  z = norm(cross(y, x));
  return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
}

/** the specimen packed for the shader, as crystals/engine.ts packs it (grown) */
export interface Packed { planes: Float32Array; C: Float32Array[]; n: number }
function pack(spec: Specimen): Packed {
  const sp = spec.species;
  const planes = new Float32Array(64 * 4 * 4);
  const C = Array.from({ length: 9 }, () => new Float32Array(MAXC * 4));
  const [C1, C2, C3, C4, C5, C6, C7, C8, C9] = C;
  let n = 0;
  const count = Math.min(MAXC, spec.crystals.length);
  for (let i = 0; i < count; i++) {
    const c = spec.crystals[i];
    const pl = planesOf(c, sp, 1);
    C1.set([n, pl.length, sp.ior, sp.disp * 2.2], i * 4);
    for (const p of pl) { planes.set([p.n[0], p.n[1], p.n[2], p.d], n * 4); n++; }
    for (let k = 0; k < 3; k++) C2[i * 4 + k] = -Math.log(Math.max(0.02, sp.tint[k])) * sp.absorb;
    C2[i * 4 + 3] = sp.milk;
    C3.set([c.at[0], c.at[1], c.at[2], sp.striate], i * 4);
    C4.set([c.R[3], c.R[4], c.R[5], sp.habit === 'prism' ? c.len * 1.001 : c.r * 1.001 * 1.6], i * 4);
    C5.set([c.R[0], c.R[1], c.R[2], sp.habit === 'prism' ? c.r : c.r * 1.001], i * 4);
    for (let k = 0; k < 3; k++) C6[i * 4 + k] = -Math.log(Math.max(0.02, sp.tint2[k])) * sp.absorb;
    C6[i * 4 + 3] = ['none', 'tip', 'core', 'band'].indexOf(sp.zoning);
    C7.set([sp.veils, sp.needles, sp.cracks, sp.phantom], i * 4);
    C8.set([sp.needle[0], sp.needle[1], sp.needle[2], sp.along ? -1 : sp.bubbles], i * 4);
    C9.set([c.frost ? 1 : 0, sp.tarnish, 0, 0], i * 4);
  }
  return { planes, C, n: count };
}

export interface CrystalAnomaly {
  b: Builder; top: number; species: Species; spec: Specimen;
  /** metres to the specimen's units, its turn, the ground's height in its units */
  scale: number; turn: number; yG: number;
  /** indices of the cluster and its matrix (the shards follow) */
  bodyCount: number;
  /** what is solid underfoot: discs (x, z, r; m from the heart) */
  solids: Array<[number, number, number]>;
}
/** the anomaly's meshes, in metres from its heart (at the ground there); `ground` the wood's
 *  ground (m) at a point, for the shards */
export function crystalAnomaly(f: Find, ground: (x: number, z: number) => number): CrystalAnomaly {
  const spec = specimen(f.seed);
  const sp = spec.species;
  const r = seeded(hash(f.seed, 0xc4a));
  const turn = r() * Math.PI * 2, ct = Math.cos(turn), st = Math.sin(turn);
  const b = new Builder(STRIDE);
  const g0 = ground(f.x, f.z);
  // the cluster: its faces, in the specimen's units; how big it is grown (its height over the
  // ground, which cuts its matrix a little above the middle)
  const yG = spec.matrix[1] * 0.45;
  const hulls = spec.crystals.slice(0, MAXC).map((c) => ({ c, faces: hullFaces(planesOf(c, sp, 1)) }));
  let maxY = 0;
  for (const h of hulls) for (const fc of h.faces) for (const p of fc.pts) maxY = Math.max(maxY, p[1] - yG);
  const H = 24 + r() * 18;
  const S = Math.min(H / Math.max(maxY, 0.1), (f.reach * 0.42) / spec.matrix[0]);
  const place = (p: V3): V3 => [(p[0] * ct - p[2] * st) * S, (p[1] - yG) * S, (p[0] * st + p[2] * ct) * S];
  const turnN = (n: V3): V3 => [n[0] * ct - n[2] * st, n[1], n[0] * st + n[2] * ct];
  let top = 0;
  // (solid: the matrix's dome, and the bigger shards)
  const solids: Array<[number, number, number]> = [[0, 0, Math.min(spec.matrix[0], spec.matrix[2]) * S * 0.9]];
  /** one crystal's faces, given in metres (from the heart): each a fan from its middle */
  const crystal = (faces: Array<{ n: V3; pts: V3[] }>, part: number, id: number, base: V3, axis: V3) => {
    let len = 0.3;
    for (const fc of faces) for (const p of fc.pts) len = Math.max(len, dot([p[0] - base[0], p[1] - base[1], p[2] - base[2]], axis));
    const along = (p: V3) => dot([p[0] - base[0], p[1] - base[1], p[2] - base[2]], axis) / len;
    for (const fc of faces) {
      const m = fc.pts.length;
      const C: V3 = [0, 0, 0];
      for (const p of fc.pts) { C[0] += p[0] / m; C[1] += p[1] / m; C[2] += p[2] / m; top = Math.max(top, p[1]); }
      const v = (p: V3) => [p[0], p[1], p[2], fc.n[0], fc.n[1], fc.n[2], part, id, axis[0], axis[1], axis[2], along(p)];
      for (let k = 0; k < m; k++) b.fine(v(C), v(fc.pts[k]), v(fc.pts[(k + 1) % m]), 1.8);
    }
  };
  hulls.forEach(({ c, faces }, i) => crystal(faces.map((fc) => ({ n: turnN(fc.n), pts: fc.pts.map(place) })), 0, i, place(c.at as V3), turnN([c.R[3], c.R[4], c.R[5]])));
  // the matrix: a dome of rock, the top of its ellipsoid, a little rough
  {
    const [mx, my, mz] = spec.matrix;
    const LAT = 14, LON = 40;
    const rr = seeded(hash(f.seed, 0x4a7));
    const bumps = Array.from({ length: 6 }, () => [rr() * 6.28, rr() * 3, 0.04 + rr() * 0.06]);
    const at = (i: number, j: number): V3 => {
      const la = -0.35 + (i / LAT) * (Math.PI / 2 + 0.35), lo = (j / LON) * Math.PI * 2;
      let k = 1;
      for (const [ph, fr, amp] of bumps) k += amp * Math.sin(lo * (2 + fr) + ph) * Math.cos(la * (1 + fr));
      return place([Math.cos(la) * Math.cos(lo) * mx * k, Math.sin(la) * my * k, Math.cos(la) * Math.sin(lo) * mz * k]);
    };
    for (let i = 0; i < LAT; i++) for (let j = 0; j < LON; j++) {
      const p00 = at(i, j), p10 = at(i + 1, j), p01 = at(i, j + 1), p11 = at(i + 1, j + 1);
      const nrm = norm(cross([p01[0] - p00[0], p01[1] - p00[1], p01[2] - p00[2]], [p10[0] - p00[0], p10[1] - p00[1], p10[2] - p00[2]]));
      const v = (p: V3) => [p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], 1, 0, 0, 1, 0, 0];
      b.fine(v(p00), v(p10), v(p11), 2.5);
      b.fine(v(p00), v(p11), v(p01), 2.5);
    }
  }
  const bodyCount = b.index.length;
  // shards: the species breaking through the litter about it, leaning out from its heart,
  // bigger nearer, some in twos and threes
  const n = 26 + Math.floor(r() * 22);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, u = r();
    const d = f.reach * (0.3 + 0.48 * Math.sqrt(u));
    const near = 1 - (d / f.reach - 0.3) / 0.48;
    const k = 1 + (r() < 0.3 ? 1 + Math.floor(r() * 2) : 0);
    for (let m = 0; m < k; m++) {
      const x = Math.cos(a) * d + (m ? (r() - 0.5) * 1.6 : 0), z = Math.sin(a) * d + (m ? (r() - 0.5) * 1.6 : 0);
      const size = (0.3 + 2.6 * near * near) * (0.6 + 0.7 * r()) * (m ? 0.6 : 1);
      const lean = 0.2 + 0.7 * r(), psi = Math.atan2(z, x) + (r() - 0.5) * 1.4;
      const axis = norm([Math.sin(lean) * Math.cos(psi), Math.cos(lean), Math.sin(lean) * Math.sin(psi)]);
      const prism = sp.habit === 'prism';
      const radius = prism ? size * 0.28 : size * 0.5;
      const slen = sp.slender[0] + r() * (sp.slender[1] - sp.slender[0]);
      const len = prism ? radius * slen : radius;
      const gy = ground(f.x + x, f.z + z) - g0;
      const c: Crystal = { at: [x, gy - (prism ? len * 0.25 : radius * 0.6), z], R: frame(axis, r() * 6.28), r: radius, len, t0: 0, dur: 1, roll: r() * 6.28, frost: false };
      crystal(hullFaces(planesOf(c, sp, 1)) as Array<{ n: V3; pts: V3[] }>, 2, 0, c.at as V3, axis);
      if (radius > 0.5) solids.push([x, z, radius * 0.9]);
    }
  }
  return { b, top, species: sp, spec, scale: S, turn, yG, solids, bodyCount };
}

/** meshes built ahead (off the frame that first draws them) */
const ready = new Map<number, CrystalAnomaly>();
export function prepareCrystal(f: Find, ground: (x: number, z: number) => number) { if (!ready.has(f.seed)) ready.set(f.seed, crystalAnomaly(f, ground)); }
const progs = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
interface Gpu { mesh: Mesh; a: Omit<CrystalAnomaly, 'b'>; packed: Packed; planes: WebGLTexture }
const meshes = new WeakMap<WebGL2RenderingContext, Map<number, Gpu>>();
/** what is solid of each anomaly built so far (by seed): discs in the wood (x, z, r) */
export const crystalSolids = new Map<number, Array<[number, number, number]>>();

/** the wood as drawn so far this frame, copied (a texture per context, kept at the frame's size) */
const grabs = new WeakMap<WebGL2RenderingContext, { tex: WebGLTexture; w: number; h: number }>();
function grab(gl: WebGL2RenderingContext, W: number, H: number): WebGLTexture {
  let g = grabs.get(gl);
  if (!g) { g = { tex: gl.createTexture()!, w: 0, h: 0 }; grabs.set(gl, g); }
  gl.bindTexture(gl.TEXTURE_2D, g.tex);
  if (g.w !== W || g.h !== H) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    g.w = W; g.h = H;
  }
  // (from the wood's own target, as it stands: everything beyond the crystal is drawn by now)
  gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);
  return g.tex;
}
/** the whole wood as it was at the end of the last frame (a texture per context) */
const prevs = new WeakMap<WebGL2RenderingContext, { tex: WebGLTexture; w: number; h: number }>();
function prevOf(gl: WebGL2RenderingContext, W: number, H: number): WebGLTexture {
  let g = prevs.get(gl);
  if (!g) { g = { tex: gl.createTexture()!, w: 0, h: 0 }; prevs.set(gl, g); }
  if (g.w !== W || g.h !== H) {
    gl.bindTexture(gl.TEXTURE_2D, g.tex);
    // (nothing yet: alpha 0, so the mist stands in until a frame is taken)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    g.w = W; g.h = H;
  }
  return g.tex;
}
/** take the finished wood, for the crystals to reflect next frame (a CustomDraw drawn last) */
export function takeFrame(env: WoodEnv) {
  const { gl } = env;
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, prevOf(gl, env.W, env.H));
  gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, env.W, env.H);
  gl.activeTexture(gl.TEXTURE0);
}

/** draw a crystal anomaly into the wood (a render.ts CustomDraw, set at its heart): its cluster
 *  and matrix in their place among the trees, seeing the wood drawn behind them; or its shards,
 *  drawn first (scattered among the trees, they write their depth before them) */
export function drawCrystalAnomaly(env: WoodEnv, f: Find, ground: (x: number, z: number) => number, part: 'body' | 'shards' = 'body') {
  const { gl } = env;
  let p = progs.get(gl);
  if (!p) { p = program(gl, VS, FS()); progs.set(gl, p); }
  let byGl = meshes.get(gl);
  if (!byGl) meshes.set(gl, (byGl = new Map()));
  let m = byGl.get(f.seed);
  if (!m) {
    const { b, ...a } = ready.get(f.seed) ?? crystalAnomaly(f, ground);
    ready.delete(f.seed);
    const packed = pack(a.spec);
    const planes = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, planes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 64, 4, 0, gl.RGBA, gl.FLOAT, packed.planes);
    m = { mesh: upload(gl, p, b, [['aP', 3, 0], ['aN', 3, 3], ['aK', 2, 6], ['aA', 4, 8]]), a, packed, planes };
    crystalSolids.set(f.seed, a.solids.map(([x, z, r]) => [f.x + x, f.z + z, r]));
    byGl.set(f.seed, m);
  }
  const sp = m.a.species;
  const body = part === 'body';
  gl.activeTexture(gl.TEXTURE3);
  if (body) grab(gl, env.W, env.H);
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, prevOf(gl, env.W, env.H));
  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, m.planes);
  gl.useProgram(p);
  env.common(p);
  const u = (n: string) => gl.getUniformLocation(p!, n);
  gl.uniform1i(u('uScene'), 3);
  gl.uniform1i(u('uPrev'), 4);
  gl.uniform1i(u('uPlanes'), 5);
  gl.uniform1f(u('uGrab'), body ? 1 : 0);
  ['uC1', 'uC2', 'uC3', 'uC4', 'uC5', 'uC6', 'uC7', 'uC8', 'uC9'].forEach((n, i) => gl.uniform4fv(u(n), m!.packed.C[i]));
  gl.uniform3fv(u('uMat'), m.a.spec.matrix);
  gl.uniform1f(u('uSpecSeed'), (f.seed % 1000) * 0.37);
  // (each colour its own ray close to; one for all three further off)
  gl.uniform1f(u('uDispOn'), Math.hypot(f.x - env.view.x, f.z - env.view.z) < 45 ? 1 : 0);
  gl.uniform1f(u('uScale'), m.a.scale);
  gl.uniform1f(u('uTurn'), m.a.turn);
  gl.uniform1f(u('uYG'), m.a.yG);
  gl.uniform3f(u('uAnchor'), f.x, env.base, f.z);
  gl.uniform1f(u('uBase'), env.base);
  gl.uniform2fv(u('uMistT'), env.mist);
  gl.uniform1f(u('uTopH'), env.top);
  gl.uniform3fv(u('uTint'), sp.tint);
  gl.uniform1f(u('uIor'), sp.ior);
  gl.uniform1f(u('uAbsorb'), sp.absorb);
  gl.bindVertexArray(m.mesh.vao);
  gl.depthMask(true);
  // (the cluster leaves its mark in the alpha: 0, so the wood it mirrors next frame leaves it out)
  if (body) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ZERO);
  const n = body ? m.a.bodyCount : m.mesh.count - m.a.bodyCount;
  if (n > 0) gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_INT, body ? 0 : m.a.bodyCount * 4);
  gl.depthMask(false);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.activeTexture(gl.TEXTURE0);
}
