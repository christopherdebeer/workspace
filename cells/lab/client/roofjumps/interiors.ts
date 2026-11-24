/**
 * Roof Jumps' window interiors: a room behind each near pane, by interior mapping. The façade stays solid; each pane is an
 * instanced quad at the glass, and for every pixel of it the viewing ray is carried into a shallow box behind it, in the
 * window's own coordinates, to find what's seen there:
 *
 *   on the glass        a broken, low pull of the sky reflected in it, stronger at a grazing look
 *   in the opening      the reveal: the jambs, the sill's top (seen from above), the head's underside (from below)
 *   partway in          the middle layers, opaque, fixed in room space: a counter's edge, and behind it someone at it (a bowed
 *                       head and shoulder), so a sideways run lets the jamb hide the person, the shoulder hide the bright counter
 *   at the back         the room's walls, floor and ceiling: one cool wall mass, a cabinet's shadow, a strip of work light; an
 *                       office's ceiling lights in bands that run on behind its mullions (its panes share one room)
 *
 * Painted, not modelled: each surface's colour broken by stroke-shaped noise along its own way, the edges of shapes ragged.
 * Drawn for the near chunks only, fading out with distance into the panes painted under them (stroke-gouache.ts).
 * `windows=flat` (none), `windows=room` (no middle layers): to compare.
 */

/** one pane's room, as the instance carries it (24 floats) */
export interface Room {
  /** the pane's lower left on the façade, along it, out from it; its size */
  o: [number, number, number]; u: [number, number, number]; n: [number, number, number]; w: number; h: number;
  /** the room: how deep, how far it runs past the pane either side, below its foot (to the floor) and above its head */
  D: number; L: number; R: number; F: number; C: number;
  /** what room: 0 dark, 1 kitchen, 2 living, 3 office, 4 curtained, 5 screen-lit, 6 a lamp in the dark */
  type: number; lit: number; seed: number; occ: number;
  /** the opening's depth to the glass; where the pane starts along its row (an office's room spans the row) */
  reveal: number; ox: number;
}
export const ROOM_FLOATS = 24;
export function depositRoom(r: Room, out: Float32Array, at: number): void {
  out.set([...r.o, r.w, ...r.u, r.h, ...r.n, r.D, r.L, r.R, r.F, r.C, r.type, r.lit, r.seed, r.occ, r.reveal, r.ox, 0, 0], at);
}

export const WIN_VS = `#version 300 es
in vec2 aQ; in vec4 w0; in vec4 w1; in vec4 w2; in vec4 w3; in vec4 w4; in vec4 w5;
uniform mat4 uVP; uniform vec3 uEye; uniform float uWinFar;
out vec2 vL; out vec3 vW; flat out vec4 vA; flat out vec4 vB; flat out vec4 vC; flat out vec4 vD; flat out vec4 vE; flat out vec4 vF; out float vFade;
void main() {
  vec3 o = w0.xyz, u = w1.xyz, n = w2.xyz; float w = w0.w, h = w1.w;
  vL = vec2(aQ.x * w, aQ.y * h);
  vec3 p = o + u * vL.x + vec3(0.0, vL.y, 0.0) + n * 0.045;
  float dist = length(uEye - (o + u * w * 0.5 + vec3(0.0, h * 0.5, 0.0)));
  vFade = 1.0 - smoothstep(uWinFar * 0.75, uWinFar, dist);
  vA = w0; vB = w1; vC = w2; vD = w3; vE = w4; vF = w5; vW = p;
  // (seen from behind (inside the building's own face), or too far: nothing)
  if (vFade <= 0.0 || dot(uEye - p, n) < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  gl_Position = uVP * vec4(p, 1.0);
}`;

export const WIN_FS = `#version 300 es
precision highp float;
in vec2 vL; in vec3 vW; flat in vec4 vA; flat in vec4 vB; flat in vec4 vC; flat in vec4 vD; flat in vec4 vE; flat in vec4 vF; in float vFade;
uniform vec3 uEye; uniform float uGlow; uniform vec3 uSkyTop; uniform vec3 uSkyHor; uniform vec3 uHaze; uniform float uFar; uniform float uFogNear; uniform float uTime; uniform int uMiddle;
out vec4 o;
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
// (paint on a surface: its colour broken by strokes laid along it (long one way, short the other), each its own value)
vec3 paint(vec3 c, vec2 q, float sd) { float s = noise(vec2(q.x * 1.6, q.y * 7.0) + sd * 13.0), t = noise(vec2(q.x * 4.0, q.y * 16.0) + sd * 7.0);
  return c * (0.88 + 0.2 * s + 0.08 * (t - 0.5)); }
// (an ellipse's inside, its edge broken a little)
float blob(vec2 p, vec2 c, vec2 r, float sd) { vec2 d = (p - c) / r; return 1.0 - smoothstep(0.86, 1.0, length(d) + 0.12 * (noise(p * 9.0 + sd) - 0.5)); }
void main() {
  vec3 O = vA.xyz, U = vB.xyz, N = vC.xyz; float w = vA.w, h = vB.w, D = vC.w, L = vD.x, R = vD.y, F = vD.z, C = vD.w;
  float type = vE.x, lit = vE.y, sd = vE.z, occ = vE.w, rv = vF.x, ox = vF.y;
  // (the ray, in the window's own coordinates: x along it, y up, z into the room)
  vec3 dw = normalize(vW - uEye); vec3 d = vec3(dot(dw, U), dw.y, -dot(dw, N)); if (d.z < 1e-3) d.z = 1e-3;
  vec3 p0 = vec3(vL, 0.0);
  float glow = uGlow, on = step(0.5, lit);
  // (the light in the room: warm when lit, deepening as the day goes; dark rooms the street's cool)
  vec3 warm = mix(vec3(0.62, 0.52, 0.4), vec3(1.0, 0.78, 0.5), glow), cool = mix(vec3(0.3, 0.33, 0.38), vec3(0.12, 0.14, 0.2), glow);
  vec3 room = type < 0.5 ? cool : type > 5.5 ? cool * 1.1 : type > 4.5 ? mix(cool, vec3(0.45, 0.6, 0.85), 0.55 + 0.25 * glow) : warm;
  vec3 col; bool done = false;
  // ─ the reveal: before the glass, the opening's sides
  float tg = rv / d.z; vec2 g = p0.xy + d.xy * tg;
  if (g.x < 0.0 || g.x > w || g.y < 0.0 || g.y > h) {
    float t = 1e9; int face = 0;
    if (d.x < 0.0) { float tt = -p0.x / d.x; if (tt < t) { t = tt; face = 1; } }
    if (d.x > 0.0) { float tt = (w - p0.x) / d.x; if (tt < t) { t = tt; face = 1; } }
    if (d.y < 0.0) { float tt = -p0.y / d.y; if (tt < t) { t = tt; face = 2; } }
    if (d.y > 0.0) { float tt = (h - p0.y) / d.y; if (tt < t) { t = tt; face = 3; } }
    vec3 q = p0 + d * t, wallc = mix(vec3(0.5, 0.49, 0.47), vec3(0.3, 0.31, 0.36), glow);
    col = face == 2 ? wallc * 1.25 : face == 3 ? wallc * 0.55 : wallc * 0.75;
    // (a little of the room's light on the reveal near the glass)
    col = mix(col, room * 0.9, on * 0.35 * smoothstep(0.0, rv, q.z));
    col = paint(col, face == 1 ? q.zy * 3.0 : q.xz * 3.0, sd);
    done = true;
  }
  if (!done) {
    vec3 e = p0 + d * tg;  // (entering the room at the glass)
    // (the room's box: x from -L to w+R, y from -F to h+C, z from rv to rv+D: where the ray leaves it, and through which face)
    float tx = d.x > 0.0 ? (w + R - p0.x) / d.x : d.x < 0.0 ? (-L - p0.x) / d.x : 1e9;
    float ty = d.y > 0.0 ? (h + C - p0.y) / d.y : d.y < 0.0 ? (-F - p0.y) / d.y : 1e9;
    float tz = (rv + D) / d.z, t = min(tz, min(tx, ty));
    vec3 q = p0 + d * t; float fy = q.y + F;  // (height above the room's floor)
    if (t == tz) {
      // the back wall: one mass; a kitchen's upper cabinets (their shadow under) and a strip of work light; a living room's
      // lamp; an office's desks; a dark room barely there
      col = paint(room * 0.82, vec2(q.x + ox, q.y), sd);
      if (type > 0.5 && type < 1.5) { float cab = step(1.5, fy) * step(fy, 2.25); col = mix(col, room * 0.5, cab * 0.9); col = mix(col, vec3(1.0, 0.92, 0.72), smoothstep(0.05, 0.0, abs(fy - 1.45)) * 0.9 * on); col = mix(col, room * 0.62, step(fy, 0.9) * 0.6); }
      if (type > 1.5 && type < 2.5) { col = mix(col, room * 1.25, blob(vec2(q.x, fy), vec2(w * (0.3 + 0.4 * sd), 1.3), vec2(0.55, 0.45), sd) * 0.7); col = mix(col, room * 0.55, step(fy, 0.75) * step(0.0, q.x) * step(q.x, w) * 0.7); }
      if (type > 2.5 && type < 3.5) { col = mix(col, room * 0.58, step(0.7, fy) * step(fy, 0.8) * 0.8); }
      if (type > 3.5 && type < 4.5) col = mix(col, vec3(0.96, 0.9, 0.76) * (0.6 + 0.4 * glow), 0.65);
    } else if (t == ty && d.y > 0.0) {
      // the ceiling: lit near its lights; an office's in long bands, running on behind the mullions
      col = paint(room * 0.7, vec2(q.x + ox, q.z), sd);
      if (type > 2.5 && type < 3.5) col = mix(col, vec3(1.0, 0.95, 0.82), on * smoothstep(0.14, 0.0, abs(fract((q.z - rv) / 2.4) - 0.5) - 0.32) * step(fract((q.x + ox) / 3.0), 0.8));
    } else if (t == ty) {
      col = paint(room * 0.5, vec2(q.x + ox, q.z) * 1.5, sd);  // the floor
    } else {
      col = paint(room * 0.66, vec2(q.z, q.y), sd + 3.0);  // a side wall
    }
    // ─ the middle layers, in front of the back: a counter's edge, and behind it someone (a kitchen, a living room, an office)
    if (uMiddle == 1 && on > 0.5) {
      float zc = rv + D * 0.32, zp = rv + D * 0.5;
      // (someone: head bowed a little forward, a shoulder; their place along the room by its dice; a slow shift of weight)
      if (occ > 0.5 && zp / d.z < t) {
        vec3 a = p0 + d * (zp / d.z); float fa = a.y + F, px = -L * 0.3 + (w + L * 0.3 + R * 0.3) * fract(sd * 7.3) + 0.06 * sin(uTime * 0.7 + sd * 20.0);
        float body = max(blob(vec2(a.x, fa), vec2(px, 1.62), vec2(0.13, 0.15), sd), max(blob(vec2(a.x, fa), vec2(px + 0.05, 1.32), vec2(0.27, 0.2), sd + 1.0), step(abs(a.x - px - 0.03), 0.22) * step(fa, 1.3) * step(0.4, fa)));
        if (body > 0.5) { vec3 skin = mix(vec3(0.32, 0.26, 0.24), room * 0.42, 0.4); col = paint(skin * (fa > 1.5 ? 1.05 : 0.85), vec2(a.x * 2.0, fa), sd + 5.0); t = zp / d.z; }
      }
      // (the counter: its top a bright line along the room, its front dark; drawn over whoever's behind it)
      if ((type < 1.5 || type > 2.5 && type < 3.5) && zc / d.z < t) {
        vec3 c2 = p0 + d * (zc / d.z); float fc = c2.y + F, top = type > 2.5 ? 0.76 : 0.92;
        if (fc < top + 0.04 && c2.x > -L && c2.x < w + R) { col = fc > top - 0.03 ? mix(room, vec3(1.0, 0.95, 0.85), 0.5) : paint(room * 0.38, vec2(c2.x * 2.0, fc), sd + 9.0); }
      }
    }
    // ─ the glass: the sky in it, a broken pull, stronger at a grazing look and over a dark room
    float graze = pow(1.0 - clamp(-dot(dw, N), 0.0, 1.0), 2.0), dark = 1.0 - on * 0.75;
    vec3 sky = mix(uSkyHor, uSkyTop, clamp(0.5 + dw.y * 2.0, 0.0, 1.0));
    float pull = smoothstep(0.35, 0.7, noise(vec2((vL.x + vL.y * 0.6) * 1.8, vL.y * 0.4) + sd * 17.0 + ox));
    col = mix(col, sky, clamp((0.12 + 0.55 * graze) * dark + 0.18 * pull * (0.4 + graze), 0.0, 0.85));
  }
  // (the haze, as the paint has it)
  float fog = smoothstep(uFar * uFogNear, uFar, length(uEye - vW));
  col = mix(col, uHaze, fog);
  o = vec4(col, vFade);
}`;
