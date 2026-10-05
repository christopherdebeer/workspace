/**
 * The crystals' light, in GLSL. Every crystal is a convex hull of planes (in a data texture),
 * so a ray through one is exact: an entry face, an exit face, and the path between. The main
 * pass traces a ray from each pixel: a Fresnel share reflects off the first face, the rest
 * refracts in — three times, at three wavelengths' indices, for the dispersion — walks the
 * inside (internal reflections where it can't get out), picks up the body colour along its
 * path, leaves, and finds what lies beyond: another crystal, the matrix, the ground (lit by the
 * caustics), or the light. The caustic pass sends a sheet of the key light's rays through the
 * same hulls from the vertex shader and splats where each lands on the ground.
 */
export const MAXC = 12;

export const COMMON = /* glsl */ `
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uPlanes;
uniform int uN;
uniform vec4 uC0[${MAXC}]; // bounding centre, radius
uniform vec4 uC1[${MAXC}]; // plane start, count, ior, dispersion
uniform vec4 uC2[${MAXC}]; // absorption rgb, milk
uniform vec4 uC3[${MAXC}]; // base point, striation
uniform vec4 uC4[${MAXC}]; // the axis, length as grown
uniform vec4 uC5[${MAXC}]; // the x column, radius as grown
uniform vec4 uC6[${MAXC}]; // the second absorption rgb, zoning mode (0 none, 1 tip, 2 core, 3 band)
uniform vec4 uC7[${MAXC}]; // veils, needles, cracks, phantom
uniform vec4 uC8[${MAXC}]; // needle colour rgb, bubbles
uniform float uSeed;
uniform vec3 uMat;         // the matrix: an ellipsoid at the origin
uniform vec3 uLight;       // toward the key light
uniform vec3 uLightCol;
uniform float uTime;
uniform sampler2D uCaustic;
uniform vec4 uCMap;        // centre x, z, half-extent, gain

float hash3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1 + 3.7) * 0.28 + vnoise(p * 4.3 + 9.1) * 0.17; }

/** the ray against a hull: entry and exit distances and faces */
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
/** the nearest crystal a ray from outside enters (-1: none) */
int nearest(vec3 o, vec3 d, out float tn, out vec3 nn, out float tf, out vec3 nf) {
  int best = -1; tn = 1e9; nn = vec3(0.0, 1.0, 0.0); tf = 1e9; nf = nn;
  for (int i = 0; i < ${MAXC}; i++) {
    if (i >= uN) break;
    vec3 oc = o - uC0[i].xyz; float b = dot(oc, d); float c = dot(oc, oc) - uC0[i].w * uC0[i].w;
    float h = b * b - c; if (h < 0.0) continue; h = sqrt(h);
    if (-b + h < 0.0 || -b - h > tn) continue;
    float a, bb; vec3 na, nb;
    if (hull(int(uC1[i].x), int(uC1[i].y), o, d, a, bb, na, nb) && a > 0.0 && a < tn) { tn = a; nn = na; tf = bb; nf = nb; best = i; }
  }
  return best;
}
float ellipsoid(vec3 o, vec3 d) {
  vec3 oo = o / uMat, dd = d / uMat;
  float a = dot(dd, dd), b = dot(oo, dd), c = dot(oo, oo) - 1.0;
  float h = b * b - a * c; if (h < 0.0) return 1e9;
  float t = (-b - sqrt(h)) / a; return t > 0.0 ? t : 1e9;
}
float schlick(float c, float ior) { float f0 = (ior - 1.0) / (ior + 1.0); f0 *= f0; float x = 1.0 - c; float x2 = x * x; return f0 + (1.0 - f0) * x2 * x2 * x; }
vec3 env(vec3 d) {
  // a studio sweep: dark below, a grey glow low behind, darker again overhead
  vec3 sky = mix(vec3(0.02, 0.021, 0.028), vec3(0.11, 0.115, 0.14), smoothstep(-0.25, 0.15, d.y) * (1.0 - smoothstep(0.15, 0.9, d.y)) + 0.35 * smoothstep(0.15, 0.9, d.y));
  // the key light is a softbox: a broad bright disc, brighter toward its centre, with a hot core
  float k = max(dot(d, uLight), 0.0);
  vec3 key = uLightCol * (3.0 * smoothstep(0.78, 0.985, k) + 0.5 * pow(k, 4.0) + 6.0 * smoothstep(0.994, 0.9995, k));
  vec3 fd = normalize(vec3(-uLight.x, 1.1, -uLight.z));
  float f = max(dot(d, fd), 0.0);
  vec3 fill = vec3(0.3, 0.36, 0.5) * (0.25 * pow(f, 3.0) + 0.9 * smoothstep(0.86, 0.97, f));
  vec3 rd = normalize(vec3(uLight.z, 0.7, -uLight.x));
  float r = max(dot(d, rd), 0.0);
  vec3 rim = vec3(0.5, 0.42, 0.35) * 0.9 * smoothstep(0.92, 0.99, r);
  return sky + key + fill + rim;
}
/** the key light at a ground or matrix point: 1 lit; through a crystal, a little; behind the matrix, none */
float shadow(vec3 p) {
  vec3 o = p + vec3(0.0, 0.003, 0.0);
  if (ellipsoid(o, uLight) < 1e8) return 0.0;
  float tn, tf; vec3 nn, nf;
  int id = nearest(o, uLight, tn, nn, tf, nf);
  return id < 0 ? 1.0 : 0.1;
}
vec3 caustic(vec3 p) {
  vec2 uv = (p.xz - uCMap.xy) / uCMap.z * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
  return texture(uCaustic, uv).rgb * uCMap.w;
}
vec3 groundLit(vec3 p) {
  float m = fbm(p * 2.3), v = fbm(p * 11.0 + 5.0);
  vec3 alb = mix(vec3(0.035, 0.036, 0.042), vec3(0.075, 0.07, 0.066), m) * (0.8 + 0.4 * v);
  float sh = shadow(p);
  vec3 light = uLightCol * max(uLight.y, 0.0) * sh * 0.9 + caustic(p);
  vec3 amb = vec3(0.04, 0.045, 0.06);
  // the slate goes to dark with distance
  return alb * (light + amb) * exp(-length(p.xz) * 0.16);
}
vec3 matrixShade(vec3 p, vec3 d) {
  vec3 n = normalize(p / (uMat * uMat));
  vec3 g = vec3(fbm(p * 6.0 + 1.0), fbm(p * 6.0 + 7.0), fbm(p * 6.0 + 13.0)) - 0.5;
  n = normalize(n + g * 0.7);
  float m = fbm(p * 5.0);
  vec3 alb = mix(vec3(0.008, 0.008, 0.009), vec3(0.022, 0.021, 0.02), m);
  float sh = shadow(p + n * 0.01);
  float lam = max(dot(n, uLight), 0.0);
  vec3 col = alb * (uLightCol * lam * sh + vec3(0.05, 0.055, 0.07) * (0.5 + 0.5 * n.y));
  vec3 h = normalize(uLight - d);
  col += uLightCol * sh * pow(max(dot(n, h), 0.0), 24.0) * 0.04;
  return col;
}
/** what a ray sees, one level deep: a crystal as plain glass, the matrix, the lit ground, the light */
vec3 scene1(vec3 o, vec3 d) {
  float tn, tf; vec3 nn, nf; int id = nearest(o, d, tn, nn, tf, nf);
  float tm = ellipsoid(o, d);
  float tg = d.y < -1e-5 ? -o.y / d.y : 1e9;
  float tc = id >= 0 ? tn : 1e9;
  float t = min(min(tc, tm), tg);
  if (t > 1e8) return env(d);
  vec3 p = o + d * t;
  if (tc <= t) {
    float ior = uC1[id].z;
    float F = schlick(max(dot(-d, nn), 0.0), ior);
    vec3 refl = env(reflect(d, nn));
    vec3 rd = refract(d, nn, 1.0 / ior);
    vec3 q = p - nn * 1e-3;
    vec3 tr = vec3(0.0);
    float a, b; vec3 na, nb;
    if (hull(int(uC1[id].x), int(uC1[id].y), q, rd, a, b, na, nb)) {
      vec3 q2 = q + rd * b;
      vec3 rd2 = refract(rd, -nb, ior);
      if (dot(rd2, rd2) < 0.5) rd2 = rd; // (trapped: let it through, roughly)
      vec3 T = exp(-uC2[id].xyz * b);
      float tg2 = rd2.y < -1e-5 ? -q2.y / rd2.y : 1e9;
      float tm2 = ellipsoid(q2 + nb * 1e-3, rd2);
      vec3 beyond = tg2 < tm2 && tg2 < 1e8 ? groundLit(q2 + rd2 * tg2) : tm2 < 1e8 ? matrixShade(q2 + rd2 * tm2, rd2) : env(rd2);
      float milk = 1.0 - exp(-uC2[id].w * b);
      tr = mix(T * beyond, uC2[id].xyz * 0.0 + exp(-uC2[id].xyz * 0.6) * uLightCol * 0.25, milk);
    }
    return F * refl + (1.0 - F) * tr;
  }
  if (tm <= t) return matrixShade(p, d);
  vec3 g = groundLit(p);
  float F = schlick(max(-d.y, 0.0), 1.5) * 0.4 * exp(-length(p.xz) * 0.1);
  return g + F * env(reflect(d, vec3(0.0, 1.0, 0.0)));
}
`;

export const QUAD_VS = /* glsl */ `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }
`;

export const MAIN_FS = /* glsl */ `#version 300 es
${COMMON}
uniform vec3 uEye; uniform mat3 uCam; uniform vec2 uRes; uniform float uFov; uniform int uDisp; uniform int uDebug;
out vec4 oColor;
/** the crystal's own coordinates: across, along the axis, across */
vec3 local(int id, vec3 p) {
  vec3 q = p - uC3[id].xyz; vec3 ax = uC4[id].xyz, xc = uC5[id].xyz, zc = cross(ax, xc);
  return vec3(dot(q, xc), dot(q, ax), dot(q, zc));
}
float h1(float x) { return fract(sin(x * 127.1 + uSeed) * 43758.5453); }
vec3 h3(float x) { return vec3(h1(x), h1(x + 7.3), h1(x + 19.1)); }
/** striations: the prism faces ripple across their width, in lines along the axis */
vec3 striate(int id, vec3 p, vec3 n) {
  float k = uC3[id].w; if (k < 0.01) return n;
  vec3 ax = uC4[id].xyz;
  if (abs(dot(n, ax)) > 0.35) return n; // (only the prism faces)
  vec3 t = normalize(cross(ax, n));
  float u = dot(p, t) * 140.0 + h1(float(id)) * 50.0;
  float w = sin(u) * 0.6 + sin(u * 2.7 + 1.0) * 0.3 + sin(u * 0.31) * 0.4;
  return normalize(n + t * w * 0.02 * k);
}
struct Inner { vec3 absorb; vec3 scatter; vec3 glint; vec3 solid; float hit; };
/** the inside, along the first segment of the ray: zoning, phantoms, veils, bubbles sampled on
 *  the way; needles and cracks met exactly */
Inner interior(int id, vec3 q, vec3 rd, float len) {
  Inner r; r.absorb = uC2[id].xyz; r.scatter = vec3(0.0); r.glint = vec3(0.0); r.solid = vec3(0.0); r.hit = 1e9;
  float L = max(uC4[id].w, 0.02), R = max(uC5[id].w, 0.02);
  float mode = uC6[id].w, veils = uC7[id].x, cracks = uC7[id].z, phantom = uC7[id].w, bubbles = uC8[id].w;
  float fid = float(id) * 3.7;
  // zoning and the sampled features
  float zone = 0.0, veil = 0.0, bub = 0.0, ghost = 0.0;
  const int N = 10;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N) * len;
    vec3 lp = local(id, q + rd * t);
    float rad = length(lp.xz), y = lp.y / L, rr = rad / R;
    if (mode > 0.5 && mode < 1.5) zone += smoothstep(0.45, 0.95, y + 0.15 * sin(lp.x * 9.0 + lp.z * 7.0));
    else if (mode < 2.5 && mode > 1.5) zone += 1.0 - smoothstep(0.45, 0.85, rr);
    else if (mode > 2.5) zone += 0.5 + 0.5 * sin(y * 11.0 + 2.5 * fbm(lp * 3.0 + fid));
    // (a phantom: one or two ghost tips, where the crystal's outline once was)
    if (phantom > 0.0) { float g = y + rr * 0.55; ghost += smoothstep(0.02, 0.0, abs(fract(g * 1.15 + h1(fid)) - 0.5) - 0.47) * step(0.3, y) * (0.6 + 0.4 * fbm(lp * 6.0)); }
    if (veils > 0.0) { vec3 vn = normalize(h3(fid + 1.0) - 0.5); float dv = abs(dot(lp, vn) - (h1(fid + 2.0) - 0.5) * R); float mask = smoothstep(0.52, 0.7, fbm(lp * 5.0 + fid)); veil += smoothstep(0.03, 0.0, dv) * mask; }
    if (bubbles > 0.0) { vec3 c = floor(lp * 14.0); vec3 jit = h3(dot(c, vec3(1.0, 57.0, 113.0)) + fid); float db = length(fract(lp * 14.0) - 0.5 - (jit - 0.5) * 0.6); bub += step(jit.x, bubbles * 0.5) * smoothstep(0.16, 0.0, db); }
  }
  zone /= float(N);
  r.absorb = mix(uC2[id].xyz, uC6[id].xyz, zone);
  r.scatter = (veil * veils * 0.35 + ghost * phantom * 0.07 + bub * 0.8) / float(N) * uLightCol;
  // needles: thin rods, met exactly
  int nn = int(uC7[id].y);
  vec3 lq = local(id, q), lrd = local(id, q + rd) - lq;
  for (int k = 0; k < 4; k++) {
    if (k >= nn) break;
    float fk = fid + 11.0 + float(k) * 5.1;
    vec3 c = (h3(fk) - 0.5) * vec3(R * 1.6, L * 0.9, R * 1.6) + vec3(0.0, L * 0.5, 0.0);
    vec3 dn = uC7[id].y > 0.0 && uC8[id].w < -0.5 ? vec3(0.0, 1.0, 0.0) : normalize(h3(fk + 2.0) - 0.5);
    // (a ray against a cylinder of radius rn about the line c + s*dn)
    float rn = 0.012;
    vec3 oc = lq - c; vec3 dd = lrd - dn * dot(lrd, dn); vec3 oo = oc - dn * dot(oc, dn);
    float a = dot(dd, dd), b = dot(oo, dd), cc = dot(oo, oo) - rn * rn; float h = b * b - a * cc;
    if (h < 0.0 || a < 1e-6) continue;
    float t = (-b - sqrt(h)) / a;
    if (t > 0.0 && t < len && t < r.hit) { float along = dot(oc + lrd * t, dn); if (abs(along) < L * 0.5) { r.hit = t; vec3 pn = normalize(oo + dd * t); r.solid = uC8[id].xyz * (0.3 + 0.7 * max(dot(pn, local(id, q + uLight) - lq), 0.0)) * uLightCol; } }
  }
  // cracks: planes within, patchy, glinting with a thin film's colours
  if (cracks > 0.0) for (int k = 0; k < 2; k++) {
    float fk = fid + 31.0 + float(k) * 7.7;
    vec3 cn = normalize(h3(fk) - 0.5); float cd = (h1(fk + 1.0) - 0.5) * R * 0.8 + cn.y * L * 0.5;
    float dn = dot(lrd, cn); if (abs(dn) < 1e-5) continue;
    float t = (cd - dot(lq, cn)) / dn;
    if (t < 0.0 || t > len) continue;
    vec3 lp = lq + lrd * t;
    float mask = smoothstep(0.5, 0.62, fbm(lp * 4.0 + fk)) * cracks * step(0.0, lp.y) * step(lp.y, L);
    if (mask <= 0.0) continue;
    vec3 wn = normalize(uC5[id].xyz * cn.x + uC4[id].xyz * cn.y + cross(uC4[id].xyz, uC5[id].xyz) * cn.z);
    float c = abs(dot(rd, wn));
    vec3 film = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + c * 9.0 + h1(fk) * 6.0);
    r.glint += env(reflect(rd, wn)) * film * mask * (0.25 + 0.75 * pow(1.0 - c, 2.0)) * 0.7;
    r.scatter += mask * 0.03 * uLightCol;
  }
  return r;
}
vec3 ground(vec3 p, vec3 d) {
  vec3 g = groundLit(p);
  float F = schlick(max(-d.y, 0.0), 1.5) * 0.45 * exp(-length(p.xz) * 0.1);
  vec3 r = reflect(d, vec3(0.0, 1.0, 0.0));
  return g + F * scene1(p + vec3(0.0, 1e-3, 0.0), r);
}
/** one wavelength through the crystal: in at p, out somewhere, and what it sees beyond */
float through(int id, vec3 p, vec3 d, vec3 nn, float ior, int ch, out float path) {
  vec3 rd = refract(d, nn, 1.0 / ior);
  vec3 q = p - nn * 1e-3;
  int s = int(uC1[id].x), n = int(uC1[id].y);
  // (what leaves at each face is summed; what reflects back inside goes on to the next face —
  // the fire of a stone is these later exits)
  path = 0.0; float w = 1.0, sum = 0.0;
  for (int b = 0; b < 5; b++) {
    float a, bb; vec3 na, nb;
    if (!hull(s, n, q, rd, a, bb, na, nb)) break;
    vec3 q2 = q + rd * bb; path += bb;
    vec3 rd2 = refract(rd, -nb, ior);
    if (dot(rd2, rd2) < 0.5) { rd = reflect(rd, -nb); q = q2 + rd * 1e-3; w *= 0.985; continue; }
    float F2 = schlick(max(dot(rd2, nb), 0.0), ior);
    vec3 beyond = scene1(q2 + nb * 1e-3, rd2);
    sum += w * (1.0 - F2) * beyond[ch];
    w *= F2;
    if (w < 0.03) break;
    rd = reflect(rd, -nb); q = q2 + rd * 1e-3;
  }
  return sum;
}
vec3 crystalShade(int id, vec3 p, vec3 d, vec3 nn) {
  float ior = uC1[id].z, disp = uC1[id].w;
  nn = striate(id, p, nn);
  float cosi = max(dot(-d, nn), 0.0);
  float F = schlick(cosi, ior);
  vec3 refl = scene1(p + nn * 1e-3, reflect(d, nn));
  // the inside, once, along the green ray's first segment
  vec3 rd0 = refract(d, nn, 1.0 / ior); vec3 q0 = p - nn * 1e-3;
  float a0, b0; vec3 na0, nb0; hull(int(uC1[id].x), int(uC1[id].y), q0, rd0, a0, b0, na0, nb0);
  Inner in_ = interior(id, q0, rd0, b0);
  vec3 tr; float path;
  if (uDisp > 0) {
    tr.r = through(id, p, d, nn, ior - disp, 0, path);
    tr.g = through(id, p, d, nn, ior, 1, path);
    tr.b = through(id, p, d, nn, ior + disp, 2, path);
  } else {
    vec3 col = vec3(0.0);
    tr.g = through(id, p, d, nn, ior, 1, path);
    tr.r = tr.g; tr.b = tr.g;
  }
  vec3 T = exp(-in_.absorb * path);
  float milk = 1.0 - exp(-uC2[id].w * path);
  vec3 body = exp(-in_.absorb * 0.7) * (uLightCol * 0.22 * (0.5 + 0.5 * max(dot(nn, uLight), 0.0)) + vec3(0.03, 0.035, 0.045));
  vec3 inner = mix(T * tr, body, milk);
  // what the inside adds: scattered light from veils, phantoms and bubbles, the cracks' glints;
  // a needle met stops the ray there
  if (in_.hit < 1e8) inner = in_.solid * exp(-in_.absorb * in_.hit) + in_.scatter * exp(-in_.absorb * 0.5);
  else inner += in_.scatter * exp(-in_.absorb * 0.5) * 2.0;
  inner += in_.glint;
  // a touch of the key light scattered at the face, and a glint along grazing edges
  float glint = pow(1.0 - cosi, 6.0) * 0.15;
  return F * refl + (1.0 - F) * inner + glint * uLightCol * 0.2;
}
vec3 shade(vec3 o, vec3 d) {
  float tn, tf; vec3 nn, nf; int id = nearest(o, d, tn, nn, tf, nf);
  float tm = ellipsoid(o, d);
  float tg = d.y < -1e-5 ? -o.y / d.y : 1e9;
  float tc = id >= 0 ? tn : 1e9;
  float t = min(min(tc, tm), tg);
  if (t > 1e8) return env(d);
  vec3 p = o + d * t;
  if (tc <= t) return crystalShade(id, p, d, nn);
  if (tm <= t) return matrixShade(p, d);
  return ground(p, d);
}
vec3 tonemap(vec3 x) { x *= 1.6; return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); }
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  if (uDebug == 1) { oColor = vec4(pow(texture(uCaustic, gl_FragCoord.xy / uRes).rgb * uCMap.w, vec3(1.0 / 2.2)), 1.0); return; }
  vec3 d = normalize(uCam * vec3(uv * uFov, -1.0));
  if (uDebug == 3) { float tn, tf; vec3 nn, nf; int id = nearest(uEye, d, tn, nn, tf, nf); float tm = ellipsoid(uEye, d); float tc = id >= 0 ? tn : 1e9; if (tm < tc && tm < 1e8) { vec3 p = uEye + d * tm; vec3 n = normalize(p / (uMat * uMat)); oColor = vec4(matrixShade(p, d) * 4.0, 1.0); } else oColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  if (uDebug == 4) { oColor = vec4(shade(uEye, d) * 4.0, 1.0); return; }
  if (uDebug == 2) { float tn, tf; vec3 nn, nf; int id = nearest(uEye, d, tn, nn, tf, nf); float tm = ellipsoid(uEye, d); float tg = d.y < -1e-5 ? -uEye.y / d.y : 1e9; float tc = id >= 0 ? tn : 1e9; float t = min(min(tc, tm), tg); oColor = vec4(tc <= t ? 1.0 : 0.0, tm <= t && tm < tc ? 1.0 : 0.0, tg <= t && tg < tc && tg < tm ? 1.0 : 0.0, 1.0); return; }
  vec3 col = shade(uEye, d);
  // vignette and a little dither
  float vig = 1.0 - 0.35 * dot(uv, uv);
  col = tonemap(col * vig);
  col = pow(col, vec3(1.0 / 2.2)) + (hash3(vec3(gl_FragCoord.xy, uTime)) - 0.5) / 255.0;
  oColor = vec4(col, 1.0);
}
`;

export const CAUSTIC_VS = /* glsl */ `#version 300 es
${COMMON}
uniform int uGrid; uniform vec3 uU, uV; uniform float uExt; uniform vec3 uCen; uniform float uShift; uniform vec3 uWave; uniform float uSplat; uniform float uGain; uniform vec2 uJit;
out vec3 vCol;
void main() {
  int i = gl_VertexID;
  float x = (float(i % uGrid) + uJit.x) / float(uGrid) * 2.0 - 1.0;
  float y = (float(i / uGrid) + uJit.y) / float(uGrid) * 2.0 - 1.0;
  vec3 o = uCen + uLight * 8.0 + (uU * x + uV * y) * uExt;
  vec3 d = -uLight;
  vec3 w = uWave;
  bool any = false;
  for (int pass = 0; pass < 2; pass++) {
    float tn, tf; vec3 nn, nf; int id = nearest(o, d, tn, nn, tf, nf);
    if (id < 0) break;
    if (ellipsoid(o, d) < tn) { any = false; break; }
    any = true;
    float ior = uC1[id].z + uShift * uC1[id].w;
    vec3 p = o + d * tn;
    w *= 1.0 - schlick(max(dot(-d, nn), 0.0), ior);
    vec3 rd = refract(d, nn, 1.0 / ior);
    vec3 q = p - nn * 1e-3;
    int s = int(uC1[id].x), n = int(uC1[id].y);
    float path = 0.0; bool left = false;
    for (int b = 0; b < 4; b++) {
      float a, bb; vec3 na, nb;
      if (!hull(s, n, q, rd, a, bb, na, nb)) break;
      vec3 q2 = q + rd * bb; path += bb;
      vec3 rd2 = refract(rd, -nb, ior);
      if (dot(rd2, rd2) < 0.5) { rd = reflect(rd, -nb); q = q2 + rd * 1e-3; continue; }
      w *= 1.0 - schlick(max(dot(rd2, nb), 0.0), ior);
      o = q2 + nb * 1e-3; d = rd2; left = true; break;
    }
    if (!left) { any = false; break; }
    w *= exp(-uC2[id].xyz * path);
  }
  if (!any || d.y > -0.02) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); gl_PointSize = 1.0; return; }
  float tg = -o.y / d.y;
  if (ellipsoid(o, d) < tg) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); gl_PointSize = 1.0; return; }
  vec3 p = o + d * tg;
  vec2 uv = (p.xz - uCMap.xy) / uCMap.z;
  gl_Position = vec4(uv, 0.0, 1.0);
  gl_PointSize = uSplat;
  vCol = w * uGain * max(-d.y, 0.05);
}
`;

export const CAUSTIC_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vCol; out vec4 oColor;
void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; oColor = vec4(vCol * exp(-r2 * 3.0), 1.0); }
`;
