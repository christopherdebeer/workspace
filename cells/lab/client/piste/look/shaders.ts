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
layout(location=0) in vec3 p; layout(location=1) in vec3 n; layout(location=2) in vec4 c;
uniform mat4 vp; uniform mat4 lvp;
out vec3 vP; out vec3 vN; out vec3 vC; flat out float vM; out vec4 vL;
void main(){ vP = p; vN = n; vC = c.rgb; vM = c.a; vL = lvp * vec4(p, 1.0); gl_Position = vp * vec4(p, 1.0); }`;

export const MAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vP; in vec3 vN; in vec3 vC; flat in float vM; in vec4 vL;
uniform vec3 eye; uniform vec3 sunDir; uniform sampler2DShadow shadow; uniform float exposure;
uniform vec4 feet[4]; uniform vec4 tips[2]; uniform vec3 bladeA[2]; uniform vec3 bladeB[2];
out vec4 o;

const vec3 LO = vec3(${f(R.x0)}, 0.0, ${f(R.z0)}), HI = vec3(${f(R.x1)}, ${f(R.h)}, ${f(R.z1)});
const vec3 SUN = vec3(1.0, 0.86, 0.68) * 1.6;
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
  return pane(h.x, h.y);
}
float shadowAt(){
  vec3 q = vL.xyz / vL.w * 0.5 + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
  float s = 0.0, b = 0.0015, px = 1.0 / 2048.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += texture(shadow, vec3(q.xy + vec2(i, j) * px * 1.3, q.z - b));
  return s / 9.0;
}
// soft contact: the floor darkened under each shoe and under each tip (the nearer the tip to the floor, the darker)
float contact(vec3 p){
  float k = 1.0;
  for (int i = 0; i < 4; i++) { vec2 d = p.xz - feet[i].xz; float r = feet[i].w; k *= 1.0 - 0.55 * exp(-dot(d, d) / (r * r)); }
  for (int i = 0; i < 2; i++) { float hgt = max(0.0, tips[i].y); float r = 0.03 + hgt * 0.035; vec2 d = p.xz - tips[i].xz;
    k *= 1.0 - tips[i].w * (0.62 / (1.0 + hgt * 0.5)) * exp(-dot(d, d) / (r * r)); }
  // the blades' own thin shadows, straight down (the lamps overhead): a line on the floor from under the guard to under
  // the tip, finer and darker where the steel is nearer the floor, ending at the tip's mark
  for (int i = 0; i < 2; i++) {
    vec2 a = bladeA[i].xz, b = bladeB[i].xz, ab = b - a;
    float t = clamp(dot(p.xz - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float hgt = max(0.0, mix(bladeA[i].y, bladeB[i].y, t)), w = 0.006 + hgt * 0.006;
    float dd = length(p.xz - (a + ab * t));
    k *= 1.0 - (0.55 / (1.0 + hgt * 0.45)) * smoothstep(0.0, 0.25, t) * exp(-dd * dd / (w * w));
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
  else if (M == 3) { // the piste: brushed steel plates, dull
    float br = vnoise(vec2(vP.x * 3.0, vP.z * 160.0)) * 0.5 + vnoise(vec2(vP.x * 0.7, vP.z * 9.0)) * 0.5;
    float seam = smoothstep(0.006, 0.0, abs(mod(vP.x, 1.5) - 0.75) - 0.744);
    alb *= 0.86 + 0.22 * br; alb *= 1.0 - 0.5 * seam; metal = 0.35; rough = 0.5 + 0.15 * br;
  }
  else if (M == 4) { // the floor: boards along the room
    float pl = floor(vP.z / 0.14), gr = vnoise(vec2(vP.x * 1.4 + pl * 17.0, pl * 3.1));
    alb *= 0.78 + 0.35 * hash(vec2(pl, floor(vP.x / 2.3 + pl))) * 0.6 + 0.15 * gr;
    alb *= 1.0 - 0.35 * smoothstep(0.004, 0.0, abs(fract(vP.z / 0.14) - 0.5) - 0.495);
    rough = 0.55; spec = 0.05;
  }
  else if (M == 7) { // the mask's mesh: a fine grid of bright wire over dark holes, with a soft sheen; where the grid is
    // finer than a pixel it settles to its average
    vec3 q = vP * 230.0, fw = fwidth(q);
    vec3 g = abs(fract(q) - 0.5);
    vec3 line = 1.0 - smoothstep(vec3(0.12) - fw, vec3(0.12) + fw, 0.5 - g);
    float wire = max(max(line.x, line.y), line.z);
    float seen = clamp(1.0 - max(fw.x, max(fw.y, fw.z)) * 1.6, 0.0, 1.0);
    wire = mix(0.42, wire, seen);
    alb = mix(vec3(0.03, 0.03, 0.035), vec3(0.34, 0.34, 0.36), wire); rough = 0.35; spec = 0.12;
  }
  else if (M == 13) { rough = 0.6; spec = 0.05; }
  else if (M == 14) { rough = 0.45; spec = 0.05; }
  else if (M == 8) { rough = 0.55; spec = 0.05; }
  else if (M == 9) { rough = 0.6; spec = 0.03; }

  vec3 col;
  if (M == 6 || M == 11) col = emit;
  else {
    // light: the sun through the panes (and not shadowed), the day from the window side, the lamps, a warm bounce
    float sun = sunThrough(vP) * shadowAt();
    float nl = max(dot(N, sunDir), 0.0);
    vec3 winDir = normalize(vec3(0.0, 0.35, -1.0));
    float fall = 1.0 / (1.0 + 0.16 * (vP.z - LO.z));
    vec3 day = SKY * (0.12 + 0.88 * max(dot(N, winDir), 0.0)) * 1.0 * fall;
    vec3 amb = mix(vec3(0.08, 0.06, 0.055), vec3(0.2, 0.22, 0.25), N.y * 0.5 + 0.5);
    vec3 lamps = vec3(0.22) * max(N.y, 0.0) + vec3(0.42, 0.36, 0.32) * max(-N.y, 0.0);
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
    }
  }
  // haze: the far room toward the air's colour, a little greyer
  float dist = length(eye - vP);
  float hz = 1.0 - exp(-max(0.0, dist - 4.0) * 0.022);
  col = mix(col, HAZE * (0.55 + 0.45 * dot(col, vec3(0.333))), hz * (M == 1 || M == 2 ? 0.35 : 0.8));
  col *= exposure;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  o = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

export const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 p; uniform mat4 lvp;
void main(){ gl_Position = lvp * vec4(p, 1.0); }`;
export const SHADOW_FS = `#version 300 es
precision mediump float; out vec4 o; void main(){ o = vec4(1.0); }`;
