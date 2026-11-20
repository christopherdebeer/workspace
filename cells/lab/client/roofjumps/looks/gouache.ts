/**
 * Gouache: the city painted, after stills made from the grey boxes (a figure across a concrete alley, a lavender haze,
 * weathered render streaked below its copings). Flat, chalky colour with a hand's variation in it, not texture: each
 * building its own concrete (warm grey, a blue-green grey, now and then a faded terracotta), mottled in broad patches,
 * streaked where water runs down from the top, rust bleeding through here and there; a lighter coping along every top
 * edge with its shadow under it; windows in storeys and bays on the larger walls (dark panes, a pale frame and sill), few
 * enough to give scale and not crowd the figure; rooftop units with their louvres; a warm low sun and cool shade; the
 * distance going to lavender. The figure dressed (a dark jacket, darker trousers, pale shoes, dark hair), drawn with a
 * darker edge so it holds against the walls. The light is a shadow map from the sun (the buildings throw their shadows
 * across each other, the figure onto all of it), massed into two values; and the frame is painted after (paint.ts):
 * strokes that follow the picture, edges where pigment pools, a paper grain.
 *
 * Only paint. What can be held (a sill, a pipe, a coping) is still the city's holds (city.ts), and the windows here are
 * drawn where none is: the next step is one placement giving both the painted feature and the thing a hand can take.
 */
import type { LookDef } from '../looks';

export const gouache: LookDef = {
  name: 'gouache',
  fog: [0.77, 0.74, 0.83], fogNear: 0.12,
  sky: { top: [0.58, 0.56, 0.7], horizon: [0.89, 0.83, 0.84], clouds: 0.5 },
  sun: [-0.55, 0.6, 0.58],
  shadow: 'map', guides: false,
  paint: { brush: 9, far: 1.8, edges: 0.7, colourEdges: 0.45, wobble: 2.2, grain: 0.7 },
  glsl: /* glsl */ `
vec3 concrete(float seed) {
  vec3 warm = vec3(0.64, 0.62, 0.58), green = vec3(0.57, 0.61, 0.6), cool = vec3(0.6, 0.61, 0.63), terra = vec3(0.67, 0.55, 0.51);
  return seed < 0.4 ? mix(warm, cool, seed / 0.4) : seed < 0.9 ? mix(cool, green, (seed - 0.4) / 0.5) : mix(warm, terra, 0.7);
}
vec3 dressed(float kind, vec3 n) {
  int k = int(kind + 0.5);
  if (k == 7) return vec3(0.87, 0.84, 0.77);                                  // shoes
  if (k == 2) return n.y < -0.3 ? vec3(0.78, 0.6, 0.48) : vec3(0.11, 0.1, 0.1); // hair, the face under it
  if (k == 1 || k == 3 || k == 4) return vec3(0.21, 0.21, 0.28);              // the jacket
  return vec3(0.13, 0.14, 0.2);                                               // trousers
}
vec3 look(Surf s) {
  vec3 n = s.n, sun = normalize(uSun), V = normalize(s.eye - s.pos);
  float ndl = dot(n, sun);
  // (the light as a painter masses it: in the sun or not, a narrow edge between; lit planes warm, shadow one cool colour,
  // a little warmth bounced up into the shadowed walls)
  float inSun = smoothstep(0.0, 0.18, ndl) * sunLit(s.pos, n);
  float mass = smoothstep(0.38, 0.62, inSun);
  vec3 light = mix(vec3(0.7, 0.71, 0.79) + vec3(0.06, 0.04, 0.0) * (1.0 - abs(n.y)) * smoothstep(0.5, -0.5, n.y + 0.2), vec3(1.05, 0.99, 0.91), mass);
  if (s.tag == 6) {
    // (the figure: two tones, and a darker edge where it turns away, so it reads against the walls)
    vec3 c = dressed(s.seed, n);
    float l = smoothstep(0.35, 0.65, smoothstep(-0.1, 0.25, ndl) * sunLit(s.pos, n));
    c = mix(c * vec3(0.55, 0.57, 0.68), c * 1.04, l);
    return c * (1.0 - 0.35 * smoothstep(0.55, 0.95, 1.0 - abs(dot(n, V))));
  }
  bool wall = abs(n.y) < 0.5;
  float W = abs(n.x) > 0.5 ? s.rect.w - s.rect.y : s.rect.z - s.rect.x;
  float u = abs(n.x) > 0.5 ? s.pos.z - s.rect.y : s.pos.x - s.rect.x, v = s.pos.y;
  vec2 fc = wall ? vec2(u + s.seed * 53.0, v) : s.pos.xz;
  float top = s.span.y, bottom = s.span.x, H = top - bottom;
  vec3 c;
  if (s.tag == 0) {
    // (the street: a dark blue-grey, worn)
    c = vec3(0.36, 0.37, 0.41) * (0.9 + 0.2 * fbm(s.pos.xz * 0.15));
  } else if (s.tag == 4 || s.tag == 5) {
    // (rooftop units and tanks: pale enamel gone grey, louvres across their sides, a grille on top)
    c = s.tag == 4 ? vec3(0.72, 0.71, 0.67) : vec3(0.58, 0.5, 0.45);
    if (wall && s.tag == 4) c *= 1.0 - 0.18 * line(v, 0.09);
    else if (s.tag == 4) { vec2 m = vec2((s.rect.x + s.rect.z) * 0.5, (s.rect.y + s.rect.w) * 0.5); float r = length(s.pos.xz - m); c *= 1.0 - 0.25 * smoothstep(0.32, 0.3, r) * (0.5 + 0.5 * line(r, 0.05)); }
    c *= 0.92 + 0.12 * fbm(fc * 1.3);
  } else if (s.tag == 10) {
    c = vec3(0.3, 0.29, 0.32);                                                  // painted steel
  } else if (s.tag == 13) {
    c = vec3(0.47, 0.53, 0.58);                                                 // a skylight
  } else {
    c = concrete(s.seed);
    // (broad patches, the render's own unevenness, the brush in it)
    c *= 0.9 + 0.18 * fbm(fc * 0.18) + 0.06 * (noise(fc * vec2(1.4, 6.0)) - 0.5);
    // (plaster gone lighter in places; rust bleeding through in others, more on some buildings than on others)
    c = mix(c, c * 1.06 + 0.02, smoothstep(0.7, 0.76, fbm(fc * 0.6 + 3.0)) * 0.4);
    c = mix(c, vec3(0.66, 0.45, 0.37), smoothstep(0.63, 0.74, fbm(fc * 0.22 + s.seed * 9.0)) * (0.12 + 0.3 * step(0.6, s.seed)));
    if (wall) {
      float d = top - v;
      // (streaks where water runs down from the top, darkest just under it, a greenish grime)
      float st = smoothstep(0.55, 0.85, noise(vec2(u * 2.1 + s.seed * 31.0, d * 0.07))) * exp(-d * 0.11) * (0.55 + 0.45 * noise(vec2(u * 9.0, 1.0)));
      c = mix(c, c * vec3(0.72, 0.76, 0.72), st * 0.75);
      // (grime toward the ground)
      c *= 1.0 - 0.14 * smoothstep(2.5, 0.0, v - bottom);
      // (the coping: a paler band along the top edge, its shadow just under it)
      if (s.tag == 1 || s.tag == 3 || s.tag == 7) { if (d < 0.16) c = c * 1.16 + 0.02; else if (d < 0.23) c *= 0.7; }
      // (windows: storeys up from the street, bays across, on walls big enough for them; some walls blank; never the top
      // storey's upper part, never the street storey)
      if (s.tag == 1 && W > 3.0 && H > 5.0 && s.seed > 0.18) {
        float sy = v - bottom, storey = floor(sy / 3.0), ys = sy - storey * 3.0;
        float nb = max(1.0, floor(W / 3.3)), bw = W / nb, bay = floor(u / bw), ub = u - bay * bw - bw * 0.5;
        bool here = storey >= 1.0 && sy < H - 1.6 && hash12(vec2(bay + s.seed * 91.0, storey * 0.37 + s.seed)) > 0.32;
        if (here) {
          float hw = 0.46, inside = step(abs(ub), hw) * step(0.95, ys) * step(ys, 2.25);
          if (inside > 0.5) {
            float edge = min(hw - abs(ub), min(ys - 0.95, 2.25 - ys));
            vec3 pane = mix(vec3(0.2, 0.24, 0.28), vec3(0.42, 0.45, 0.52), smoothstep(1.2, 2.2, ys) * 0.5);
            c = edge < 0.05 || abs(ub) < 0.025 ? c * 0.7 + 0.18 : pane;
          } else if (abs(ub) < hw + 0.08 && ys > 0.86 && ys < 0.95) c = c * 1.2 + 0.03;   // the sill
          else if (abs(ub) < hw + 0.04 && ys < 0.86 && ys > -0.8) c *= 1.0 - 0.1 * smoothstep(-0.8, 0.86, ys);  // its stain
        }
      }
    } else {
      // (a roof's top: the coping round its edge, paler, jointed)
      float e = min(min(s.pos.x - s.rect.x, s.rect.z - s.pos.x), min(s.pos.z - s.rect.y, s.rect.w - s.pos.z));
      if (e < 0.28 && (s.tag == 1 || s.tag == 3 || s.tag == 7)) c = (c * 1.14 + 0.02) * (1.0 - 0.12 * line(s.pos.x + s.pos.z, 0.9));
      else c *= 0.9;
    }
  }
  return c * light;
}`,
};
