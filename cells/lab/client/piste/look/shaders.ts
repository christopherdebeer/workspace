/**
 * The salle's light, in GLSL. Three things carry it:
 *
 *   the room itself, as what reflects: a ray from a surface is followed to the room's box (the window bank on the left,
 *     bright and cool; the chalk-blue end wall; the dark right wall; the ceiling's lamps), so a highlight on the steel is
 *     a window of this room and moves as the steel turns;
 *   the sun, coming in through those windows: a point is in the sun only if the line to the sun leaves the room through
 *     a pane (so the floor carries the windows' shapes) and the shadow map says nothing stands in the way;
 *   the day, as an area light from the window side, falling off across the room; the ceiling lamps from above; and,
 *     on the floor, soft contact shadows under each shoe and each tip (which is how the eye places them in depth).
 *
 * Haze takes the far room a little toward the air's colour, which also tells near from far.
 */
import { ROOM, PAINT } from './salle';

const f = (x: number) => x.toFixed(4);
const v3 = (c: number[]) => `vec3(${c.map(f).join(',')})`;
const R = ROOM;

export const MAIN_VS = `#version 300 es
layout(location=0) in vec3 p; layout(location=1) in vec3 n; layout(location=2) in vec4 c; layout(location=3) in vec2 t;
uniform mat4 vp; uniform mat4 lvp;
out vec3 vP; out vec3 vN; out vec3 vC; flat out float vM; out vec4 vL; out vec2 vT; out vec2 vAtlas; out vec2 vStrain;
void main(){ vStrain = vec2(1.0); vP = p; vN = n; vC = c.rgb; vM = c.a; vT = t; vAtlas = vec2(-1.0); vL = lvp * vec4(p, 1.0); gl_Position = vp * vec4(p, 1.0); }`;

export const MAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vP; in vec3 vN; in vec3 vC; flat in float vM; in vec4 vL; in vec2 vT; in vec2 vAtlas; in vec2 vStrain; uniform sampler2D kitAtlas;
uniform vec3 eye; uniform vec3 sunDir; uniform sampler2DShadow shadow; uniform float exposure; uniform float clay; uniform float alpha;
uniform vec4 feet[4]; uniform vec4 tips[2]; uniform vec3 bladeA[2]; uniform vec3 bladeB[2];
out vec4 o;

const vec3 LO = vec3(${f(R.x0)}, 0.0, ${f(R.z0)}), HI = vec3(${f(R.x1)}, ${f(R.h)}, ${f(R.z1)});
const vec3 SUN = vec3(1.0, 0.94, 0.85) * 0.41;
const vec3 SKY = vec3(0.78, 0.86, 1.0);
const vec3 HAZE = vec3(0.52, 0.55, 0.6);

float hash(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 q){ vec2 i = floor(q), u = fract(q); u = u*u*(3.0-2.0*u);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }

// is (x, y) on the window wall a pane (1) or wall / frame (0)
float pane(float x, float y){
  if (y < ${f(R.winY0)} || y > ${f(R.winY1)}) return 0.0;
  float k = floor(x / ${f(R.bay)} + 0.5), cx = k * ${f(R.bay)}, a = x - (cx - ${f(R.w / 2)});
  if (a < 0.0 || a > ${f(R.w)}) return 0.0;
  float u = a / ${f(R.w)} * ${R.cols}.0, v = (y - ${f(R.winY0)}) / ${f(R.winY1 - R.winY0)} * ${R.rows}.0;
  float fu = abs(fract(u) - 0.5), fv = abs(fract(v) - 0.5);
  return smoothstep(0.47, 0.44, max(fu, fv));
}
// the day outside, as the panes show it: bright, cooler above, a little warmer and greener low (trees, far off)
vec3 daylight(float y){ float t = clamp((y - ${f(R.winY0)}) / ${f(R.winY1 - R.winY0)}, 0.0, 1.0);
  return mix(vec3(2.1, 2.25, 2.1), vec3(2.9, 3.05, 3.3), t); }

// what the room looks like along a ray from p: the radiance where it meets the room's box
vec3 room(vec3 p, vec3 d, float wb){
  vec3 t1 = (LO - p) / d, t2 = (HI - p) / d, tf = max(t1, t2);
  float t = min(min(tf.x, tf.y), tf.z);
  vec3 h = p + d * t;
  if (t == tf.z && d.z < 0.0) { // the window wall
    float g = pane(h.x, h.y);
    vec3 wall = ${v3(PAINT.windowWall)} * (h.y < 1.2 ? 0.55 : 0.75);
    return mix(wall, daylight(h.y) * wb, g);
  }
  if (t == tf.z) return (h.y < 1.2 ? ${v3(PAINT.dadoR)} : ${v3(PAINT.rightWall)}) * 0.9;
  if (t == tf.x) return d.x > 0.0 ? ${v3(PAINT.chalk)} * 0.95 : ${v3(PAINT.chalkFront)} * 0.9;
  if (d.y > 0.0) { // the ceiling, and its lamps
    float lamp = step(abs(abs(h.z) - 1.5), 0.06) * step(abs(mod(h.x + 2.0, 4.0) - 2.0), 0.7);
    return mix(${v3(PAINT.ceiling)} * 0.6, vec3(2.6), lamp);
  }
  // the floor: the piste and its sunlit panes, the dark floor round it
  bool onPiste = abs(h.z) < 0.75 && abs(h.x) < 8.5;
  vec3 base = onPiste ? ${v3(PAINT.piste)} * 0.55 : ${v3(PAINT.floor)} * 0.7;
  return base;
}
// the same, blurred (for rough surfaces): just the room's big shapes
vec3 roomSoft(vec3 d){
  float win = smoothstep(0.0, 0.7, -d.z) * smoothstep(-0.1, 0.35, d.y) * smoothstep(1.0, 0.6, d.y);
  vec3 c = mix(${v3(PAINT.floor)} * 0.6, ${v3(PAINT.rightWall)} * 0.9, smoothstep(-0.3, 0.2, d.y));
  c = mix(c, ${v3(PAINT.chalk)} * 0.95, smoothstep(0.5, 0.9, abs(d.x)) * smoothstep(-0.2, 0.2, d.y));
  return c + vec3(1.5, 1.6, 1.7) * win * 0.7 + vec3(0.6) * smoothstep(0.7, 1.0, d.y);
}

// does the sun reach p through a pane
float sunThrough(vec3 p){
  if (sunDir.z >= 0.0) return 0.0;
  float t = (LO.z - p.z) / sunDir.z; vec3 h = p + sunDir * t;
  // The window is a broad daylight source. Average neighboring paths to soften its projected mullions.
  return 0.32 * pane(h.x,h.y) + 0.17 * (pane(h.x+0.14,h.y+0.075) + pane(h.x-0.14,h.y-0.075)
       + pane(h.x+0.06,h.y-0.14) + pane(h.x-0.06,h.y+0.14));
}
float shadowAt(){
  vec3 q = vL.xyz / vL.w * 0.5 + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
  float s = 0.0, b = 0.0015, px = 1.0 / 2048.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += texture(shadow, vec3(q.xy + vec2(i, j) * px * 1.3, q.z - b));
  return s / 9.0;
}
// the window's light is a broad source (the bank of panes, beside the sun's way): its shadow soft, sampled wide
float windowShadow(){
  vec3 q = vL.xyz / vL.w * 0.5 + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
  float s = 0.0, px = 1.0 / 2048.0;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) s += texture(shadow, vec3(q.xy + vec2(i, j) * px * 4.5, q.z - 0.004));
  return s / 25.0;
}
// a surface's fine relief, as a height (m) over its own coordinates: tilt the normal by its slope, from the pixel's
// own derivatives (no tangents needed: Mikkelsen's bump mapping)
vec3 bump(vec3 N, float h){
  vec3 dpx = dFdx(vP), dpy = dFdy(vP); float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx); float det = dot(dpx, r1);
  if (abs(det) < 1e-14) return N;
  return normalize(abs(det) * N - sign(det) * (hx * r1 + hy * r2));
}
// soft contact: the floor darkened under each shoe and under each tip (the nearer the tip to the floor, the darker)
float contact(vec3 p){
  float k = 1.0;
  for (int i = 0; i < 4; i++) { vec2 d = p.xz - feet[i].xz; float r = feet[i].w; k *= 1.0 - 0.55 * exp(-dot(d, d) / (r * r)); }
  for (int i = 0; i < 2; i++) { float hgt = max(0.0, tips[i].y); float r = 0.018 + hgt * 0.072; vec2 d = p.xz - (tips[i].xz - sunDir.xz * hgt / max(0.2,sunDir.y));
    k *= 1.0 - tips[i].w * (0.60 / (1.0 + 4.5*hgt*hgt)) * exp(-dot(d, d) / (r * r)); }
  // the blades' own thin shadows, straight down (the lamps overhead): a line on the floor from under the guard to under
  // the tip, finer and darker where the steel is nearer the floor, ending at the tip's mark
  for (int i = 0; i < 2; i++) {
    vec2 offset = sunDir.xz / max(0.2,sunDir.y);
    vec2 a = bladeA[i].xz-offset*bladeA[i].y, b = bladeB[i].xz-offset*bladeB[i].y, ab = b-a;
    float t = clamp(dot(p.xz - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float hgt = max(0.0, mix(bladeA[i].y, bladeB[i].y, t)), w = 0.006 + hgt * 0.006;
    float dd = length(p.xz - (a + ab * t));
    k *= 1.0 - (0.46 / (1.0 + 3.0*hgt*hgt)) * smoothstep(0.0, 0.25, t) * exp(-dd * dd / (w * w));
  }
  return k;
}

void main(){
  int M = int(vM + 0.5);
  vec3 N = normalize(vN), V = normalize(eye - vP);
  if (dot(N, V) < 0.0) N = -N;
  vec3 alb = vC;
  float rough = 0.9, metal = 0.0, spec = 0.04;
  vec3 emit = vec3(0.0);
  if (M == 6) { emit = daylight(vP.y); }
  else if (M == 11) { emit = vC * 2.4; }
  else if (M == 1) { metal = 1.0; rough = 0.05; }
  else if (M == 2) { metal = 1.0; rough = 0.04; }
  else if (M == 12) { metal = 1.0; rough = 0.2; }
  else if (M == 5) {
    vec2 wall = vec2(abs(N.x) > 0.5 ? vP.z : vP.x, vP.y);
    alb *= 0.94 + 0.07*vnoise(wall*1.7) + 0.022*vnoise(wall*39.0);
  }
  else if (M == 3) { // the piste: brushed steel plates, dull
    float br = vnoise(vec2(vP.x * 3.0, vP.z * 160.0)) * 0.5 + vnoise(vec2(vP.x * 0.7, vP.z * 9.0)) * 0.5;
    float seam = 1.0 - smoothstep(0.0, 0.006 + fwidth(vP.x), abs(fract(vP.x / 1.5 + 0.5) - 0.5)*1.5);
    alb *= 0.86 + 0.22 * br; alb *= 1.0 - 0.25 * seam; metal = 0.35; rough = 0.5 + 0.15 * br;
  }
  else if (M == 4) { // the floor: boards along the room
    float pl = floor(vP.z / 0.14), gr = vnoise(vec2(vP.x * 1.4 + pl * 17.0, pl * 3.1));
    alb *= 0.89 + 0.12 * hash(vec2(pl, floor(vP.x / 2.3 + pl))) * 0.6 + 0.15 * gr;
    alb *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.002, abs(fract(vP.z / 0.14 + 0.5) - 0.5)*0.14));
    rough = 0.55; spec = 0.05;
  }
  else if (M == 17) {
    vec2 wallUV = vec2((vP.z-LO.z)/(HI.z-LO.z), 1.0-vP.y/HI.y);
    if (N.x > 0.0) wallUV.x = 1.0-wallUV.x;
    vec3 paint = texture(kitAtlas,vec2(wallUV.x, 0.503+0.494*wallUV.y)).rgb;
    alb = pow(paint,vec3(2.2))*0.88;
    rough = 0.96; spec = 0.016;
  }
  else if (M == 16) {
    // The low-frequency darkness of the interior is separate from the live reflection of the wire.
    vec3 screen = texture(kitAtlas,vAtlas).rgb;
    vec2 q = vec2(vAtlas.x*0.92+vAtlas.y, vAtlas.x*0.92-vAtlas.y)*234.0;
    vec2 fw = max(fwidth(q), vec2(0.001)), dist = abs(fract(q)-0.5);
    vec2 wire = mix(1.0-smoothstep(vec2(0.12)-0.45*fw,vec2(0.12)+0.45*fw,dist),
                    vec2(0.24), smoothstep(vec2(0.45),vec2(1.1),fw));
    alb = vec3(0.011) + pow(screen,vec3(1.75))*0.50 + vec3(0.16,0.17,0.165)*max(wire.x,wire.y);
    rough = 0.65; spec = 0.034;
  }
  else if (M == 7) { // the mask's mesh: dark holes, bright wire, a soft sheen; where the grid is finer than a pixel it
    // settles to its average (mostly dark: the holes are most of it), never a glossy shell
    // Woven stainless wire in bind space. Filter the two diagonals independently as their pitch falls below a pixel.
    vec2 q = vec2(vT.x + vT.y, vT.x - vT.y) * 185.0;
    vec2 footprint = max(fwidth(q), vec2(0.001));
    vec2 dist = abs(fract(q + 0.5) - 0.5);
    vec2 wire = mix(1.0 - smoothstep(vec2(0.10)-0.42*footprint, vec2(0.10)+0.42*footprint, dist),
                    vec2(0.20), smoothstep(vec2(0.4), vec2(1.2), footprint));
    float coverage = max(wire.x, wire.y);
    float rake = max(dot(N, normalize(vec3(-0.25,0.55,-0.8))), 0.0);
    alb = mix(vec3(0.009,0.010,0.012), vec3(0.29,0.30,0.285)*(0.80+0.62*rake), coverage);
    rough = 0.64; spec = 0.018;
  }
  else if (M == 15) { // cloth: slightly greyed white; a fine weave where it can be seen; seams stitched; folds shaded
    float shade = vC.r, seamD = vC.g;
    int tone = int(vC.b + 0.5);
    alb = tone == 0 ? vec3(0.66, 0.655, 0.625) : tone == 1 ? vec3(0.62, 0.615, 0.59) : tone == 2 ? vec3(0.52, 0.5, 0.46) : vec3(0.69, 0.69, 0.67);
    vec2 q = vT * 700.0; vec2 fw = fwidth(q);
    // (faded out well before a thread is a pixel: finer, it only aliases into moiré)
    float seen = 1.0 - smoothstep(0.18, 0.4, max(fw.x, fw.y));
    float weave = sin(q.x * 6.2832) * sin(q.y * 6.2832) * 0.5 + sin((q.x + q.y) * 3.1416) * 0.5;
    alb *= 1.0 + 0.07 * weave * seen;
    // the relief: a twill's diagonal ribs (about 1.4 mm apart, as a heavy drill's), faded out where finer than a pixel;
    // and each seam a raised welt, its stitches pressed in
    vec2 tq = vT * 720.0; float tseen = 1.0 - smoothstep(0.3, 0.75, fwidth(tq.x + tq.y));
    float rib = sin((tq.x + tq.y) * 3.1416 + 0.8 * vnoise(tq * 0.05)) * 0.00011 * tseen;
    // (the weave's coarser grain, the cotton's slubs: a few millimetres, seen where the ribs aren't)
    vec2 sq = vT * vec2(160.0, 260.0); float sseen = 1.0 - smoothstep(0.35, 0.9, max(fwidth(sq.x), fwidth(sq.y)));
    float slub = (vnoise(sq) - 0.5) * 0.00035 * sseen;
    // (creases: the lived-in wrinkling under the folds, a few centimetres long, running across the garment (ridged noise
    // stretched along its length), each fading in and out: a finer complement to the folds the cloth makes)
    vec2 cq = vec2(vT.x * 11.0 + 0.6 * vnoise(vT * 7.0), vT.y * 34.0 + 1.4 * vnoise(vT * 5.0 + 3.0));
    float ridge = 1.0 - abs(vnoise(cq) * 2.0 - 1.0), patchy = smoothstep(0.35, 0.8, vnoise(vT * vec2(4.0, 6.0) + 9.0));
    // (by how the cloth is held, where it's simulated: bunched along (an elbow bent), the creases across it deepen;
    // bunched across, ones along it (their own pattern, turned); taut, both flatten. At rest, a faint lived-in few)
    vec2 cq2 = vec2(vT.x * 34.0 + 1.4 * vnoise(vT * 5.0 + 7.0), vT.y * 11.0 + 0.6 * vnoise(vT * 7.0 + 2.0));
    float ridge2 = 1.0 - abs(vnoise(cq2) * 2.0 - 1.0);
    float bunchAlong = smoothstep(1.01, 0.88, vStrain.y), bunchAcross = smoothstep(1.01, 0.88, vStrain.x);
    float taut = smoothstep(1.0, 1.04, max(vStrain.x, vStrain.y));
    float crease = (ridge * ridge * (0.25 * patchy + 1.1 * bunchAlong) + ridge2 * ridge2 * 1.1 * bunchAcross) * 0.0016 * (1.0 - taut);
    patchy = clamp(0.25 * patchy + bunchAlong + bunchAcross, 0.0, 1.0) * (1.0 - taut);
    // (smooth: stitches stepped into it lit up, edge on, as a row of teeth; they show in its colour only)
    float welt = 0.0007 * (1.0 - smoothstep(0.0, 0.006, seamD));
    N = bump(N, rib + slub + crease + welt);
    // (a crease's valley a little shut in, its ridge a little lit: the light alone doesn't make it read at a distance)
    alb *= 1.0 - 0.08 * patchy * (1.0 - ridge);
    // the seam: a narrow darker line, stitched
    // (a fine line, faint: a seam reads by its welt catching the light more than by its colour)
    float sl = (1.0 - smoothstep(0.0007, 0.002, seamD)), st = step(0.5, fract(vT.y * 110.0));
    alb *= 1.0 - sl * (0.05 + 0.025 * st);
    // folds and contact: darker and cooler where it's shut in
    alb *= shade; alb = mix(alb * vec3(0.86, 0.9, 1.04), alb, shade);
    if (vAtlas.x >= 0.5) {
      vec3 panel = texture(kitAtlas,vAtlas).rgb;
      alb *= clamp(pow(panel,vec3(1.6))*1.8,0.27,1.4);
    } else if (vAtlas.x >= 0.0) {
      vec3 textile = texture(kitAtlas, vAtlas).rgb;
      alb *= mix(1.0, clamp(textile.r / 0.69, 0.42, 1.28), 0.78);
      vec2 dx = dFdx(vAtlas), dy = dFdy(vAtlas);
      vec3 px = dFdx(vP), py = dFdy(vP);
      float det = dx.x*dy.y - dx.y*dy.x;
      if (abs(det) > 1e-12) {
        vec3 tangent = normalize((px*dy.y - py*dx.y) * sign(det));
        vec3 bitangent = normalize((py*dx.x - px*dy.x) * sign(det));
        vec2 slope = (textile.gb - vec2(0.5)) * 1.45;
        N = normalize(N + tangent*slope.x + bitangent*slope.y);
      }
    }
    float grime = vnoise(vT * vec2(27.0, 18.0));
    alb *= 0.95 + 0.065 * grime;
    if (tone == 2) {
      alb *= vec3(0.82, 0.80, 0.76);
      rough = 0.69; spec = 0.048;
    } else { rough = 0.91; spec = 0.026; }
  }
  else if (M == 0 && vAtlas.x >= 0.5) {
    vec3 leather = texture(kitAtlas,vAtlas).rgb;
    alb *= pow(leather,vec3(1.7))*1.35;
    rough = 0.78;
  }
  else if (M == 13) { rough = 0.6; spec = 0.05; }
  else if (M == 14) { rough = 0.45; spec = 0.05; }
  else if (M == 8) { rough = 0.55; spec = 0.05; }
  else if (M == 9) { rough = 0.6; spec = 0.03; }

  // clay: the figure as a plain grey model, to judge its shape alone
  if (clay > 0.5 && M != 1 && M != 2 && M != 12 && M != 6 && M != 11) { alb = vec3(0.55); rough = 0.9; metal = 0.0; spec = 0.03; }
  vec3 col;
  if (M == 6 || M == 11) col = emit;
  else {
    // light: the sun through the panes (and not shadowed), the day from the window side, the lamps, a warm bounce
    float sun = sunThrough(vP) * shadowAt();
    float nl = max(dot(N, sunDir), 0.0);
    // (the window bank beside the piste: for a figure standing in the room its light comes mostly from the side)
    vec3 winDir = normalize(vec3(-0.2, 0.38, -0.92));
    float fall = 1.0 / (1.0 + 0.16 * (vP.z - LO.z));
    // (the window's light shadowed, softly: an arm across the chest, the far side of a fold; cloth lets it wrap a little
    // further round, as a soft weave does)
    // (the bank of panes along the wall, not one: the panes up and down the room light a face turned along the piste
    // obliquely, as the nearer windows light a fencer's front in the look's targets)
    float wrap = (M == 15) ? 0.12 : 0.0, wl = 0.0;
    for (int k = -2; k <= 2; k++) { vec3 wd = normalize(vec3(float(k) * 0.42, 0.38, -0.92)); wl += max((dot(N, wd) + wrap) / (1.0 + wrap), 0.0) * 0.2; }
    wl *= 1.15;
    float ws = (M == 3 || M == 4 || M == 10 || M == 15 || M == 0 || M == 13 || M == 14 || M == 7 || M == 16 || M == 8 || M == 9) ? mix(0.28, 1.0, windowShadow()) : 1.0;
    vec3 day = SKY * (0.035 + 1.8 * wl * ws) * fall;
    vec3 amb = mix(vec3(0.02, 0.019, 0.017), vec3(0.065, 0.075, 0.085), N.y * 0.5 + 0.5);
    vec3 lamps = vec3(0.06,0.063,0.06) * max(N.y, 0.0) + vec3(0.05, 0.044, 0.036) * max(-N.y, 0.0);
    float ao = (M == 3 || M == 4 || M == 10) ? contact(vP) : 1.0;
    vec3 light = (SUN * nl * sun + day + amb + lamps) * ao;
    vec3 R = reflect(-V, N);
    vec3 env = mix(room(vP + N * 0.01, R, metal > 0.5 ? 2.6 : 1.0), roomSoft(R), clamp(rough * 1.4, 0.0, 1.0));
    float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    // the sun itself in polished steel: a sharp glint where it comes off a face toward the eye
    float glint = pow(max(dot(R, sunDir), 0.0), mix(900.0, 40.0, rough)) * sun * mix(60.0, 2.0, rough);
    if (metal > 0.5) {
      col = alb * (env + SUN * glint) * mix(1.0, ao, 0.6);
      col += alb * light * 0.1 + vec3(0.6, 0.65, 0.72) * fres * 0.8;
      // the button: it catches the window whichever way it's turned (a small rounded barrel): a glint marks the point
      if (M == 12) col += daylight(3.0) * (0.25 + 0.75 * pow(max(dot(R, normalize(vec3(0.0, 0.3, -1.0))), 0.0), 3.0)) * 1.3;
    } else {
      vec3 F = vec3(spec) + (1.0 - spec) * fres * (1.0 - rough);
      col = alb * light * (1.0 - metal) + metal * alb * env * ao + F * env * ao * (1.0 - metal * 0.5) + SUN * glint * spec * (1.0 - rough);
      // cloth's sheen at grazing angles (the weave catching the room), and the floor's warm light from below
      if (M == 3) {
        // Brushed metal spreads the reflected bank along the strip; the foot shadows seat it.
        float strip = exp(-pow(abs(R.z+0.19)/0.17,2.0));
        float brush = vnoise(vec2(vP.x*270.0,vP.z*3.0));
        col += SKY * strip * (0.055 + 0.055*brush) * (0.35+0.65*fres) * ao;
      }
      if (M == 7 || M == 16) col += alb * vec3(0.13,0.14,0.15) + roomSoft(R) * pow(1.0 - max(dot(N, V), 0.0), 2.0) * 0.05;
      if (M == 15 || M == 0) col += roomSoft(R) * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.12 * vC.r + vec3(0.018, 0.014, 0.012) * max(-N.y, 0.0);
    }
  }
  // haze: the far room toward the air's colour, a little greyer
  float dist = length(eye - vP);
  float hz = 1.0 - exp(-max(0.0, dist - 4.0) * 0.022);
  col = mix(col, HAZE * (0.55 + 0.45 * dot(col, vec3(0.333))), hz * (M == 1 || M == 2 ? 0.35 : 0.8));
  col *= exposure;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  o = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), alpha);
}`;

export const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 p; uniform mat4 lvp;
void main(){ gl_Position = lvp * vec4(p, 1.0); }`;
export const SHADOW_FS = `#version 300 es
precision mediump float; out vec4 o; void main(){ o = vec4(1.0); }`;

/** the athlete, skinned: four joints a vertex; the inside of each elbow gathered as it bends; the hem and sleeves
 * moved by their springs; parts the eye inside the mask doesn't see of its own body sent off screen */
const FOLD_INPUTS = `
layout(location=8) in vec4 foldDelta;
layout(location=9) in vec3 foldNormal;
uniform float foldLoad[5];
uniform vec3 hem, sleeveW, sleeveR;
uniform vec2 bend;
vec3 dressedPosition(mat4 skin, float load, vec3 normal) {
  vec3 world = (skin * vec4(p + load*foldDelta.xyz,1.0)).xyz;
  float gather = ex.z > 0.0 ? ex.z*bend.x : -ex.z*bend.y;
  return world + hem*ex.x + (ex.y > 0.0 ? sleeveW*ex.y : sleeveR*(-ex.y)) - 0.012*gather*normal;
}`;

export const SKIN_VS = `#version 300 es
layout(location=0) in vec3 p; layout(location=1) in vec3 n; layout(location=2) in vec4 c; layout(location=3) in vec2 t;
layout(location=4) in vec4 jt; layout(location=5) in vec4 wt; layout(location=6) in vec4 ex; layout(location=7) in vec2 panelUV;
uniform mat4 vp; uniform mat4 lvp; uniform mat4 bones[15];
${FOLD_INPUTS}
out vec3 vP; out vec3 vN; out vec3 vC; flat out float vM; out vec4 vL; out vec2 vT; out vec2 vAtlas; out vec2 vStrain;
vec2 clothStrain = vec2(1.0);
void main(){
  mat4 M = bones[int(jt.x)] * wt.x + bones[int(jt.y)] * wt.y + bones[int(jt.z)] * wt.z + bones[int(jt.w)] * wt.w;
  float load = foldLoad[int(foldDelta.w)];
  vec3 nn = normalize(mat3(M) * (n + load*foldNormal));
  vec3 q = dressedPosition(M,load,nn);
  float g = ex.z > 0.0 ? ex.z * bend.x : -ex.z * bend.y;
  vC = c.rgb; if (c.a > 14.5 && c.a < 15.5) vC.r *= 1.0 - 0.38 * g;
  vP = q; vN = nn; vM = c.a; vT = t; vAtlas = panelUV; vL = lvp * vec4(q, 1.0); vStrain = clothStrain;
  gl_Position = vp * vec4(q, 1.0);
}`;
export const SKIN_SHADOW_VS = `#version 300 es
layout(location=0) in vec3 p; layout(location=4) in vec4 jt; layout(location=5) in vec4 wt; layout(location=6) in vec4 ex;
layout(location=1) in vec3 n; uniform mat4 lvp; uniform mat4 bones[15];
${FOLD_INPUTS}
vec2 clothStrain = vec2(1.0);
void main(){
  mat4 M = bones[int(jt.x)] * wt.x + bones[int(jt.y)] * wt.y + bones[int(jt.z)] * wt.z + bones[int(jt.w)] * wt.w;
  float load = foldLoad[int(foldDelta.w)];
  vec3 nn = normalize(mat3(M)*(n + load*foldNormal));
  gl_Position = lvp * vec4(dressedPosition(M,load,nn),1.0);
}`;

