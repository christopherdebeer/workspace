/**
 * Roof Jumps' looks: how the city and the figure are drawn, each one self-contained, so one can be added, taken out or
 * tried against another without touching the rest. A look is a GLSL function `vec3 look(Surf s)` (a face's colour from
 * what the mesh says it is: mesh.ts), and what it asks of the renderer around it: the colour of the haze it fades into,
 * a sky behind (or the haze), where the sun is, and how the figure's shadow falls (a soft disc under it; or cast, its own
 * shape thrown along the light onto the roof under it and the nearest wall). The renderer builds its program from
 * whatever is in LOOK_DEFS, in order; the page cycles through them (the look button, and the looks tab of the dials).
 *
 *   grid     clay, with the lattice the city is built on drawn faintly over it (a metre, a storey): the default
 *   clay     flat grey, lit
 *   wire     every triangle's edges, nothing else
 *   tags     what each face is, as a colour
 *   normals  which way each face faces
 *   gouache  painted: weathered concrete, copings, windows, a lavender haze, the figure dressed (looks/gouache.ts)
 *   stroke-gouache  every visible mark a brush stroke, opaque and chalky (strokes.ts, looks/stroke-gouache.ts)
 *   sumi     the same strokes, most left out: ink lips, a wash, the paper (looks/sumi.ts)
 */
import { gouache } from './looks/gouache';
import { strokeGouache } from './looks/stroke-gouache';
import { sumi } from './looks/sumi';
import type { StrokeRules } from './strokes';
import type { PaintSettings } from './paint';

export interface LookDef {
  name: string;
  /** `vec3 look(Surf s) { … }`: the face's colour before the haze (the helpers and Surf are in LOOK_PRELUDE) */
  glsl: string;
  /** the haze the distance fades into, and where it starts (a share of how far is drawn) */
  fog?: [number, number, number]; fogNear?: number;
  /** a sky behind the city, from straight up to the horizon (else the haze's colour) */
  sky?: { top: [number, number, number]; horizon: [number, number, number]; clouds?: number };
  /** the way the light comes from (toward it, unit) */
  sun?: [number, number, number];
  /** the figure's shadow: a soft disc under it, its own shape cast along the light, or none; 'map': everything casts
   * along the sun (the buildings onto each other, the figure onto all of it), for the look to use (sunLit) */
  shadow?: 'disc' | 'cast' | 'map' | 'none';
  /** painted in screen space after it's drawn (paint.ts): strokes, edges, paper */
  paint?: PaintSettings;
  /** its colour and how dark, for a cast shadow */
  shade?: [number, number, number, number];
  /** false: the working guides (holds, the plan's lines) aren't drawn over it, to be looked at as itself */
  guides?: boolean;
  /** brushwork: drawn as brush strokes laid on the solid world, not as its shaded faces (strokes.ts); the rules that
   * choose and load them */
  strokes?: StrokeRules;
}

/** What every look can use: what the mesh says of a face, and some shared means of drawing it. */
export const LOOK_PRELUDE = `
struct Surf {
  vec3 pos; vec3 n; int tag;   // where, which way, what (city.ts TAG)
  vec4 rect; vec2 span;        // its box's footprint (x0 z0 x1 z1) and its bottom and top
  float seed;                  // a number its box keeps (0..1); for the figure, its bone's kind (mesh.ts BONE_KIND)
  vec3 bary; vec3 eye;         // where in its triangle; where it's seen from
};
uniform vec3 uSun;
// (the figure's palette, by material (character.ts MAT): the character's colours, for a look to treat as it treats colour;
// eight a character, for as many as are drawn at once (the menu's line): a bone's material is 8 × which + what)
uniform vec3 uFigure[64];
uniform highp sampler2DShadow uShadowMap; uniform mat4 uSunVP; uniform int uShadowOn;
// (how much the sun reaches this point (0..1): the shadow map, softened over a few texels; 1 where there's none)
float sunLit(vec3 p, vec3 n) {
  if (uShadowOn == 0) return 1.0;
  vec4 q = uSunVP * vec4(p + n * 0.06, 1.0); vec3 c = q.xyz / q.w * 0.5 + 0.5;
  if (any(lessThan(c.xy, vec2(0.0))) || any(greaterThan(c.xy, vec2(1.0)))) return 1.0;
  float s = 0.0, t = 1.0 / 2048.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) s += texture(uShadowMap, vec3(c.xy + vec2(i, j) * t * 1.5, c.z - 0.0015));
  return s / 9.0;
}
float line(float x, float period) {
  float d = abs(fract(x / period + 0.5) - 0.5) * period, w = fwidth(x);
  return (1.0 - smoothstep(0.0, 1.5 * w, d)) * clamp(0.12 / w, 0.0, 1.0);
}
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
float litOf(vec3 n) { return 0.64 + 0.36 * dot(n, normalize(vec3(0.42, 0.8, 0.28))); }
// (the details' own colours (dressing.ts), plain: a pane dark or lit, pipes and steel dark, a sign or an awning or a cloth one of a
// few colours by its seed, neon bright, rust a streak)
vec3 dressOf(Surf s) {
  float k = s.seed;
  vec3 pick = k < 0.25 ? vec3(0.72, 0.28, 0.24) : k < 0.5 ? vec3(0.24, 0.42, 0.62) : k < 0.75 ? vec3(0.86, 0.72, 0.3) : vec3(0.36, 0.56, 0.4);
  if (s.tag == 15) return k > 0.74 ? vec3(0.98, 0.84, 0.55) : mix(vec3(0.17, 0.2, 0.25), vec3(0.32, 0.36, 0.43), k * 2.0);
  if (s.tag == 16) return vec3(0.42, 0.42, 0.4) * (abs(s.n.y) < 0.5 ? 1.0 - 0.35 * line(abs(s.n.x) > 0.5 ? s.pos.z : s.pos.x, 0.11) : 1.0);
  if (s.tag == 17 || s.tag == 20 || s.tag == 24) return pick * (s.tag == 24 ? 1.15 : 1.0);
  if (s.tag == 18) return vec3(0.12, 0.12, 0.13);
  if (s.tag == 19) return vec3(0.38, 0.36, 0.34);
  if (s.tag == 21) return mix(vec3(1.0, 0.35, 0.6), vec3(0.35, 0.9, 1.0), step(0.5, k));
  if (s.tag == 22) return vec3(0.52, 0.32, 0.22);
  return mix(vec3(0.75, 0.2, 0.18), vec3(0.3, 0.32, 0.36), step(0.5, k));
}
bool isDetail(Surf s) { return s.tag >= 15 && s.tag <= 24; }
vec3 clayOf(Surf s) { if (isDetail(s)) return dressOf(s) * (s.tag == 21 || (s.tag == 15 && s.seed > 0.74) ? 1.0 : litOf(s.n)); float base = s.tag == 0 ? 0.40 : s.tag == 6 ? 0.13 : s.tag == 1 ? 0.74 : 0.69; return vec3(base * litOf(s.n)); }
`;

const grid: LookDef = { name: 'grid', glsl: `vec3 look(Surf s) {
  vec3 col = clayOf(s); if (s.tag == 6) return col;
  // (the lattice: a metre across a top, a storey up a side and four metres along it)
  float g = abs(s.n.y) > 0.5 ? max(line(s.pos.x, 1.0), line(s.pos.z, 1.0)) * 0.5 + max(line(s.pos.x, 4.0), line(s.pos.z, 4.0)) * 0.5
    : max(line(s.pos.y, 3.0), line(abs(s.n.x) > 0.5 ? s.pos.z : s.pos.x, 4.0));
  return col * (1.0 - 0.2 * g);
}` };
const clay: LookDef = { name: 'clay', glsl: `vec3 look(Surf s) { return clayOf(s); }` };
const wire: LookDef = { name: 'wire', shadow: 'none', glsl: `vec3 look(Surf s) { vec3 w = fwidth(s.bary), e = smoothstep(vec3(0.0), 1.2 * w, s.bary); return mix(vec3(0.12), vec3(0.8, 0.8, 0.79), min(e.x, min(e.y, e.z))); }` };
const tags: LookDef = { name: 'tags', glsl: `vec3 look(Surf s) { float h = float(s.tag) / 25.0; return (0.55 + 0.45 * cos(6.2832 * (h + vec3(0.0, 0.33, 0.67)))) * litOf(s.n); }` };
const normals: LookDef = { name: 'normals', glsl: `vec3 look(Surf s) { return s.n * 0.5 + 0.5; }` };

/** the looks, in the order the page cycles them */
export const LOOK_DEFS: LookDef[] = [grid, clay, wire, tags, normals, gouache, strokeGouache, sumi];
