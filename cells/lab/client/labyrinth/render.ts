/**
 * Drawing the labyrinth (WebGL2): the stone from a low sun, with its shadows (a shadow map), the sky's light over it and
 * the stone's own shutting-in (ao, baked per vertex); then over it, in ink, its edges and creases, found from where the
 * depth folds or the surface turns. In **print**, the light's drawn as a lithograph's: hatched, cross-hatched where it's
 * darker, on paper.
 *
 * Everything rises as it's built: each vertex knows when it was built and the height it grows from, and the vertex
 * shader draws it that far grown.
 */
import { STRIDE, type Mesh } from './mesh';

export interface View { az: number; el: number; zoom: number; target: [number, number, number] }

const COMMON = `#version 300 es
precision highp float;
uniform float uTime;
// (how far grown: none before it's built, eased out over 0.9 s)
float grown(float born) { float t = clamp((uTime - born) / 0.9, 0., 1.); return 1. - pow(1. - t, 3.); }
`;
const VS = COMMON + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aAoMat; layout(location=3) in vec3 aRise; layout(location=4) in float aTone;
uniform mat4 uVP, uLight;
out vec3 vPos, vNrm; out float vAo, vMat, vTone, vU; out vec4 vLs;
void main() {
  float s = grown(aRise.x);
  vU = aRise.z;
  vec3 p = vec3(aPos.x, aRise.y + (aPos.y - aRise.y) * s, aPos.z);
  vPos = p; vNrm = aNrm; vAo = aAoMat.x; vMat = aAoMat.y; vTone = aTone; vLs = uLight * vec4(p, 1.);
  gl_Position = s <= 0. ? vec4(2., 2., 2., 1.) : uVP * vec4(p, 1.);
}`;
/** what's cut through (a jali's stone, a mashrabiya's lattice): holes in its upright faces, in the picture and in the
 * sun's view both, so the light falls through them in points */
const PIERCE = `
bool pierced(vec3 p, vec3 n, float m) {
  int mi = int(m + .5) % 256;
  if ((mi / 64) % 4 != 3 || abs(n.y) > .5) return false;
  float u = abs(n.x) > .5 ? p.z : p.x, v = p.y;
  if (mi % 16 == 15) {
    // (a mashrabiya's lattice: fine turned spindles in a grid, small square lights between)
    vec2 q = abs(fract(vec2(u, v) / .045) - .5);
    return q.x < .3 && q.y < .3;
  }
  // (a jali: stone pierced in stars and circles, framed: whole at its foot and head and at each cell's edge, and a band
  // across a little above a railing's height)
  float fu = min(fract(u), 1. - fract(u)), fv = fract(v);
  if (fu < .07 || fv < .07 || fv > .9 || (fv > .25 && fv < .33)) return false;
  vec2 q = fract(vec2(u, v) / .09) - .5;
  float r = length(q), star = abs(q.x) + abs(q.y);
  return r < .27 || (star < .43 && abs(abs(q.x) - abs(q.y)) < .07);
}
`;
const FS = COMMON + PIERCE + `
in vec3 vPos, vNrm; in float vAo, vMat, vTone, vU; in vec4 vLs;
uniform sampler2D uShadow; uniform vec3 uSun, uEye, uDir, uArea; uniform float uN, uShadows, uBleed; uniform vec4 uLand, uBuilt;
layout(location=0) out vec4 oCol; layout(location=1) out vec4 oNrm;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p) { return .5 * noise(p) + .25 * noise(p * 2.1) + .125 * noise(p * 4.3) + .125 * noise(p * 8.7); }
// (travertine: cream, banded as it was laid down, pitted with its little pores, each block a shade of its own)
// (how much fine detail at a frequency survives at this distance: none once a cycle is smaller than a pixel or so)
float keep(float f) { return 1. - smoothstep(.25, .6, length(fwidth(vPos)) * f); }
vec3 travertine(vec3 p, float tone) {
  // (quiet over a large face: banded as it was laid down, a few pores, softer as it goes away)
  vec3 c = vec3(.86, .82, .74) * (.96 + .06 * tone);
  float band = fbm(vec3(p.x * .6, p.y * 6., p.z * .6) + tone * 9.);
  c *= 1. - .05 * smoothstep(.5, .75, band);
  c = mix(c, vec3(.80, .71, .58), .18 * smoothstep(.64, .8, fbm(vec3(p.x * 1.4, p.y * 12., p.z * 1.4) + 3.)));
  float pore = noise(vec3(p.x * 13., p.y * 30., p.z * 13.) + tone * 17.);
  c *= 1. - .2 * smoothstep(.84, .92, pore) * keep(30.);
  float pit = noise(p * 41. + tone * 5.);
  c *= 1. - .12 * smoothstep(.88, .94, pit) * keep(41.);
  return c * (.98 + .03 * noise(p * 90.) * keep(90.));
}
// (brick: narrow courses, each brick a shade of its own (now and then a burnt one, or a pale), its edges a little worn
// so it sits proud of a recessed mortar; on a top, laid as pavers; a little darker toward the foot, where the wet gets)
vec3 brick(vec3 p, vec3 n, float tone) {
  bool top = abs(n.y) > .5;
  float cy = top ? p.z * 4. : p.y * 6., course = floor(cy);
  float u = (top ? p.x * 2. : (abs(n.x) > .5 ? p.z : p.x) * 2.) + course * .5, b = floor(u);
  float shade = hash(vec3(b, course, tone * 7.)), odd = hash(vec3(b, course, 5.));
  vec3 c = mix(vec3(.58, .37, .29), vec3(.72, .52, .40), shade);
  c = odd > .93 ? c * .62 : odd < .05 ? mix(c, vec3(.84, .66, .50), .5) : c;
  c *= .93 + .1 * noise(p * 24.) - .06 * smoothstep(.55, .9, noise(p * 60.));
  float jy = min(fract(cy), 1. - fract(cy)) / (top ? 4. : 6.), ju = min(fract(u), 1. - fract(u)) / 2., jt = min(jy, ju);
  c *= .86 + .14 * smoothstep(.006, .03, jt);
  if (!top) c *= .9 + .1 * smoothstep(0., .45, fract(p.y));
  return mix(vec3(.70, .65, .57) * (.9 + .1 * noise(p * 40.)), c, smoothstep(.005, .011, jt));
}
// (marble: white, a few broad veins, connected, soft at their edges; a faint cloud in it; in large blocks)
vec3 marble(vec3 p, vec3 n, float tone) {
  vec3 c = vec3(.93, .92, .89) * (.97 + .03 * tone);
  vec3 q = p * .55 + vec3(fbm(p * .7 + 1.), fbm(p * .7 + 7.), fbm(p * .7 + 13.)) * 1.6;
  float v = abs(fbm(q + tone * 3.) * 2. - 1.);
  c = mix(vec3(.66, .65, .66), c, mix(1., smoothstep(.0, .07, v), .75 * keep(6.)));
  c = mix(c, vec3(.83, .81, .79), .25 * smoothstep(.55, .8, fbm(p * 1.6 + 2.)));
  float jt;
  if (abs(n.y) < .5) { float u = abs(n.x) > .5 ? p.z : p.x, cy = p.y * 2.; jt = min(min(fract(cy), 1. - fract(cy)) / 2., min(fract(u + floor(cy) * .5), 1. - fract(u + floor(cy) * .5))); }
  else { vec2 f = fract(p.xz), g = min(f, 1. - f); jt = min(g.x, g.y); }
  return c * (1. - .1 * (1. - smoothstep(.003, .009, jt)));
}
// (a cat's coat: its colour, its markings (a tabby's bands round its body, legs and tail, darker along its back), paler
// underneath and at the muzzle; where on the body (h: part × 10 + along it) keeps the markings on the cat as it moves.
// Parts: 0 body, 1 head, 2 tail, 3 legs, 4 ears, 5 muzzle)
vec3 coat(int c, float h, vec3 n, float tone) {
  float part = floor(h / 10. + .001), u = h - part * 10.;
  vec3 base = vec3(.80, .50, .25), mark = vec3(.60, .33, .15), pale = vec3(.93, .84, .66);
  float stripes = .8, white = 0.;
  if (c == 1) { base = vec3(.40, .41, .43); mark = vec3(.33, .34, .36); pale = vec3(.52, .52, .53); stripes = .1; }
  else if (c == 2) { base = vec3(.90, .83, .70); mark = vec3(.80, .68, .52); pale = vec3(.96, .93, .86); stripes = .35; }
  else if (c == 3) { base = vec3(.52, .43, .32); mark = vec3(.23, .19, .15); pale = vec3(.80, .72, .58); stripes = .9; }
  else if (c == 4) { base = vec3(.11, .10, .10); mark = base; pale = vec3(.16, .15, .14); stripes = 0.; }
  else if (c == 5) { base = vec3(.80, .50, .25); mark = vec3(.66, .38, .18); pale = vec3(.95, .93, .89); stripes = .5; white = 1.; }
  else if (c == 6) { base = vec3(.70, .70, .68); mark = vec3(.30, .30, .30); pale = vec3(.88, .87, .84); stripes = .9; }
  else if (c == 7) { base = vec3(.12, .11, .11); mark = base; pale = vec3(.94, .92, .88); stripes = 0.; white = 1.; }
  base *= .94 + .1 * tone;
  // (bands: round the body, closer round the tail and legs; broken along the back)
  float freq = part == 0. ? 9. : part == 2. ? 7. : part == 3. ? 5. : 0.;
  float band = freq > 0. ? smoothstep(.62, .9, .5 + .5 * sin(u * 6.2832 * freq + tone * 3. + sin(u * 23.) * .6)) * .75 : 0.;
  float back = smoothstep(-.2, .5, n.y);
  vec3 c0 = mix(base, mark, band * stripes * (.5 + .5 * back));
  if (part == 2. && u > .86) c0 = mix(c0, mark, stripes * .8);
  // (paler underneath, at the muzzle and the chest; a bicolour's white further up, and on its paws)
  float under = smoothstep(-.05, -.6, n.y) * (part == 0. || part == 1. ? 1. : 0.);
  if (part == 5.) under = 1.;
  if (white > 0.) { under = max(under, smoothstep(.2, -.35, n.y) * (part == 0. ? 1. : 0.)); if (part == 3. && u > .55) under = 1.; if (part == 5.) under = 1.; }
  c0 = mix(c0, pale, under * (white > 0. ? 1. : .75));
  if (part == 4.) c0 *= .82;
  return c0;
}
void main() {
  vec3 n = normalize(vNrm);
  if (pierced(vPos, n, vMat)) discard;
  int m0 = int(vMat + .5), m = m0 % 256, mat = m % 16, kind = (m / 64) % 4;
  bool fur = m0 >= 512;
  bool sel = m0 >= 256 && !fur;
  if (fur) { mat = 16; kind = 0; m = 0; }
  bool moss = (m / 16) % 2 == 1, ivy = (m / 32) % 2 == 1;
  vec3 base; float spec = 0., wrap = 0.;
  // (how much of the land here is a feature of it (a cliff's rock, a bank's dashes), not its open ground)
  float landFeat = 0.;
  if (fur) { base = coat(m0 - 512, vU, n, vTone); wrap = .5; }
  else if (mat == 2) base = vec3(.13, .25, .25);
  else if (mat == 3) { base = mix(vec3(.10, .17, .08), vec3(.20, .27, .12), fbm(vPos * 7.)) * (.8 + .4 * vTone); wrap = .35; }
  else if (mat == 4) base = vec3(.32, .24, .17);
  else if (mat == 9) base = vec3(1.);
  else if (mat == 11) {
    // (a door: planks, upright, weathered dark, with a darker line between each)
    float u = abs(n.x) > .5 ? vPos.z : vPos.x, pl = fract(u * 14.);
    base = vec3(.30, .21, .14) * (.85 + .25 * hash(vec3(floor(u * 14.), 3., 1.))) * (.8 + .2 * noise(vec3(u * 40., vPos.y * 3., 0.)));
    base *= .75 + .25 * smoothstep(.0, .12, min(pl, 1. - pl));
  }
  else if (mat == 12) base = vec3(.09, .10, .11);
  else if (mat == 13) {
    // (roof tiles: terracotta, in courses up the slope, each a curved tile a shade of its own, the next course's lip
    // shading the one under it)
    float row = vPos.y * 9., r = floor(row), fr = fract(row);
    float u = (abs(n.x) > abs(n.z) ? vPos.z : vPos.x) * 7. + r * .5, cu = floor(u), fu = fract(u);
    float tint = hash(vec3(cu, r, 7.));
    base = mix(vec3(.62, .34, .23), vec3(.74, .47, .32), tint) * (.82 + .18 * sin(fu * 3.14159));
    base *= .7 + .3 * smoothstep(.0, .25, fr);
    base = mix(base, vec3(.45, .47, .38), .18 * smoothstep(.55, .8, fbm(vPos * 2.)));
  }
  else if (mat == 15) {
    // (timber: weathered, its grain along it)
    float g = noise(vec3(vPos.x * 3. + vPos.z * 3., vPos.y * 40., 1.));
    base = vec3(.52, .40, .29) * (.85 + .2 * g) * (.9 + .1 * vTone);
  }
  else if (mat == 14) {
    // (lead: grey-green, in standing seams)
    float u = atan(vPos.z - floor(vPos.z) - .5, vPos.x - floor(vPos.x) - .5) * 4., su = fract(u);
    base = vec3(.42, .47, .45) * (.9 + .1 * noise(vPos * 12.)) * (.85 + .15 * smoothstep(.0, .08, min(su, 1. - su)));
  }
  else if (mat == 10) base = vec3(.70, .40, .27) * (.9 + .15 * noise(vPos * 18.));
  else if (mat == 7) base = vec3(.90, .89, .86) * (.98 + .03 * noise(vPos * 3.));
  else if (mat == 6) base = travertine(vPos, .6) * .9;
  else if (mat == 5 && moss) {
    // (the land: barely there. Its open ground the paper's own warm pale, a faint grain in it; where it slopes, a few
    // dashes down the fall of it; where it's steep (a cliff, the land's edge), rock: a grey wash, mottled, cracked)
    float up = n.y, rough = noise(vPos * vec3(1.7, 2.3, 1.7)) * .6 + noise(vPos * 6.) * .4;
    landFeat = smoothstep(.5, .32, up + (rough - .5) * .14);
    base = vec3(.88, .84, .76) * (.97 + .05 * noise(vPos * vec3(3., 1., 3.)));
    float steep = smoothstep(.97, .7, up), cliff = smoothstep(.5, .32, up + (rough - .5) * .14);
    if (steep > 0. && cliff < 1.) {
      vec2 fall = normalize(n.xz + 1e-4), con = vec2(-fall.y, fall.x);
      float a = dot(vPos.xz, con) * mix(9., 5., uBleed), b = dot(vPos.xz, fall) * mix(3., 1.4, uBleed) - vPos.y * mix(3., 1.4, uBleed);
      float row = floor(a), lane = abs(fract(a) - .5);
      float on = step(hash(vec3(row, floor(b), 3.)), mix(.16 + .22 * steep, .1 + .16 * steep, uBleed)) * step(lane, .05 + .03 * steep) * step(mix(.35, .55, uBleed), fract(b + hash(vec3(row, 1., 9.))));
      base = mix(base, vec3(.55, .52, .47), on * .5 * steep * (1. - cliff));
      landFeat = max(landFeat, on * steep * (1. - cliff));
    }
    vec3 rock = mix(vec3(.62, .60, .56), vec3(.80, .77, .71), rough) * (.9 + .1 * vTone);
    float crack = smoothstep(.47, .5, noise(vPos * vec3(5., 9., 5.))) * smoothstep(.53, .5, noise(vPos * vec3(5., 9., 5.)));
    rock = mix(rock, vec3(.36, .34, .31), crack * .7);
    base = mix(base, rock, cliff);
  }
  else if (mat == 5) base = travertine(vPos * .8 + 11., .5) * 1.03;
  else if (mat == 8) {
    // (a courtyard's paving: travertine flags, half a cell each, their joints)
    vec2 f = fract(vPos.xz * 2. + uN), g = min(f, 1. - f);
    base = travertine(vPos * 1.3 + 5., fract(floor(vPos.x * 2.) * .37 + floor(vPos.z * 2.) * .61)) * 1.02;
    base *= 1. - .16 * (1. - smoothstep(.0, .045, min(g.x, g.y)));
  }
  else if (kind == 1) base = brick(vPos, n, vTone);
  else if (kind == 2) base = marble(vPos, n, vTone);
  else {
    base = travertine(vPos, vTone) * (kind == 3 ? 1.04 : 1.);
    // (dressed stone, laid in courses: a joint every third of a level, the upright joints staggered course to course;
    // on a top, a joint at each cell's edge. Not on what's curved)
    if (mat == 0 && kind != 3) {
      float jt;
      if (abs(n.y) < .5) {
        float u = abs(n.x) > .5 ? vPos.z : vPos.x, cy = vPos.y * 3., course = floor(cy);
        float hy = min(fract(cy), 1. - fract(cy)) / 3., ux = fract((u + course * .43 + vTone) / .62), hu = min(ux, 1. - ux) * .62;
        jt = min(hy, hu);
      } else { vec2 f = fract(vPos.xz + uN * .5), g = min(f, 1. - f); jt = min(g.x, g.y); }
      base *= 1. - .14 * (1. - smoothstep(.004, .016 + .006 * noise(vPos * 31.), jt));
    }
  }
  // (moss: in the joints and the shade, thicker on tops and low down; ivy: hanging leaves over a side)
  if (moss && mat != 5) {
    // (moss where it has a reason: in the shade (faces turned from the sun), at the damp foot of a course, and in the
    // joints and along the edges of a top, not across it)
    float shade = 1. - smoothstep(-.1, .45, dot(n, uSun));
    vec2 fe = fract(vPos.xz), ge = min(fe, 1. - fe);
    float where = n.y > .5 ? (1. - smoothstep(.02, .14, min(ge.x, ge.y))) * .8 : (1. - smoothstep(.0, .35, fract(vPos.y))) * (.35 + .65 * shade);
    float spot = smoothstep(.48, .7, fbm(vPos * 2.6 + 2.) + .18 * noise(vPos * 18.));
    vec3 mc = mix(vec3(.30, .35, .18), vec3(.44, .48, .24), smoothstep(.6, .9, noise(vPos * 40.)));
    base = mix(base, mc * (.8 + .3 * noise(vPos * 26.)), where * spot * .65);
  }
  // (ivy's leaves are its own geometry (mesh.ts); under them, where it grows, the stone is a little stained)
  if (ivy && abs(n.y) < .5) base *= .93 - .05 * noise(vPos * 6.);
  // (the sun, and its shadows: soft, a few taps round where this is in its map)
  vec3 ls = vLs.xyz / vLs.w * .5 + .5;
  float sh = 0., bias = .0012 + .0025 * (1. - abs(dot(n, uSun)));
  // (soft where what casts it is far off, crisp where it's close: how far the casters are, then filtered that wide)
  float bsum = 0., bn = 0.;
  for (int a = -2; a <= 2; a += 2) for (int b = -2; b <= 2; b += 2) { float d = texture(uShadow, ls.xy + vec2(a, b) * 3. / 2048.).r; if (d < ls.z - bias) { bsum += d; bn += 1.; } }
  float pen = bn > 0. ? clamp((ls.z - bsum / bn) * 380., .7, 3.6) : 1.;
  for (int a = -2; a <= 2; a++) for (int b = -2; b <= 2; b++) sh += step(ls.z - bias, texture(uShadow, ls.xy + vec2(a, b) * 1.1 * pen / 2048.).r);
  // (out past the sun's map: lit)
  if (any(lessThan(ls, vec3(0.))) || any(greaterThan(ls, vec3(1.)))) sh = 25.;
  sh = mix(1., sh / 25., uShadows);
  // (and the leaves of a tree out of the picture, between the sun and one side of it, stirring)
  vec2 lp = vLs.xy / vLs.w;
  float leafy = fbm(vec3(lp * vec2(9., 11.), uTime * .05));
  float leaves = smoothstep(.48, .6, leafy) * smoothstep(-.35, -.85, lp.x * .75 - lp.y * .45);
  sh *= 1. - .38 * leaves * (1. - smoothstep(uArea.z - 3., uArea.z, max(abs(vPos.x - uArea.x), abs(vPos.z - uArea.y))));
  float nl = dot(n, uSun), key = max((nl + wrap) / (1. + wrap), 0.) * sh;
  vec3 sun = vec3(1.0, .86, .68) * 1.05, sky = mix(vec3(.50, .43, .36), vec3(.62, .62, .64), n.y * .5 + .5);
  vec3 c = base * (sky * (.25 + .45 * vAo) + sun * key * (.65 + .35 * vAo));
  // (a sheen that differs by what it is: polished marble most, travertine a little, brick and clay hardly, leaves some)
  {
    vec3 hv = normalize(uSun - normalize(uDir));
    float glo = mat == 12 ? 90. : mat == 14 ? 30. : mat == 3 ? 18. : mat == 10 || mat == 13 ? 8. : kind == 2 ? 60. : kind == 1 ? 8. : 14.;
    float ks = mat == 12 ? .6 : mat == 14 ? .2 : mat == 3 ? .06 : mat == 10 || mat == 13 ? .03 : kind == 2 ? .22 : kind == 1 ? .015 : .045;
    if (mat == 0 || mat == 1 || mat == 3 || mat == 10 || (mat >= 12 && mat <= 15)) c += sun * ks * pow(max(dot(n, hv), 0.), glo) * sh * (.5 + .5 * vAo);
  }
  // (a coat's soft sheen where it turns from the eye, lit)
  if (fur) c += base * vec3(1., .9, .75) * .35 * pow(1. - abs(dot(n, normalize(uDir))), 2.5) * (.4 + .6 * sh);
  // (light gathers in the archways)
  // (light bounced up into an arch from the sunlit ground: warm near its mouth, little where it's deep)
  if (mat == 1) c += base * vec3(1., .74, .48) * .26 * vAo * vAo;
  // (a lamp: lit from within)
  if (mat == 9) c = vec3(1.25, .92, .55);
  if (mat == 2) {
    // (water: dark, the sky and the sun on it, a little stirred)
    vec3 w = normalize(vec3(.06 * (noise(vec3(vPos.xz * 6., uTime * .4)) - .5), 1., .06 * (noise(vec3(vPos.zx * 6., uTime * .4 + 3.)) - .5)));
    vec3 v = -normalize(uDir), r = reflect(-v, w);
    float fr = .08 + .9 * pow(1. - max(dot(w, v), 0.), 4.);
    c = mix(base * (.5 + .5 * sh), vec3(.86, .84, .8), fr * .7) + vec3(1., .9, .75) * pow(max(dot(reflect(-uSun, w), v), 0.), 120.) * 2. * sh;
  }
  // (a filmic shoulder, warm)
  c = c / (c + .7) * 1.62;
  c = pow(c, vec3(1.03, 1.04, 1.07));
  // (the land, held back: most of the way to its own pale, unlit, the shade still on it)
  bool land = mat == 5 && moss;
  // (bleeding: how far this is given back to the paper: away from what's built (at least a little piece of land round
  // the middle of a bare one), and toward the land's own edge, raggedly. What's built is inside it; what lies on the
  // land (its rocks and shrubs, its stream) goes with its ground)
  float dB = max(max(uBuilt.x - vPos.x, vPos.x - uBuilt.z), max(uBuilt.y - vPos.z, vPos.z - uBuilt.w));
  float dE = min(min(vPos.x - uLand.x, uLand.z - vPos.x), min(vPos.z - uLand.y, uLand.w - vPos.z));
  float ragged = (noise(vPos * vec3(.35, 1., .35)) - .5) * 2.5;
  // (from a cell out from what's built, gone three and a half further; and toward the land's edge, for anything not
  // built. What's built itself is never given back)
  float giveBack = uBleed * max(smoothstep(1., 4.5, dB + ragged * .8), land || dB > 0. ? 1. - smoothstep(.5, 4., dE + ragged) : 0.);
  if (land && uBleed > .5) {
    // (after Taohua: the open ground is the paper itself, unlit; only its features are drawn (a cliff's rock, a bank's
    // dashes, as lit as anything), and the shade cast on it, laid on as a dry brush lays grey, breaking up at its edge.
    // Away from what's built, and toward the land's own edge, it all gives way to the paper: the land bleeds into the
    // page instead of standing on a plinth)
    vec3 PAP = vec3(.94, .91, .85), GREY = vec3(.62, .58, .53);
    float shade = (1. - sh) * (.75 + .25 * (1. - vAo));
    float brush = noise(vec3(vPos.x * 1.1, vPos.z * 9., 2.)) * .75 + noise(vec3(vPos.x * 4., vPos.z * 24., 5.)) * .25;
    float laid = smoothstep(1. - shade * 1.2, 1.05 - shade * 1.2, brush);
    vec3 g = mix(PAP, GREY, .42 * laid * smoothstep(.05, .3, shade));
    g = mix(g, c, landFeat);
    c = mix(g, PAP, giveBack);
  }
  // (a cat's never given back: it walks where it likes)
  else if (uBleed > .5 && giveBack > 0. && !fur) c = mix(c, vec3(.94, .91, .85), giveBack);
  else if (land) c = mix(c, base * (.86 + .14 * sh) * (.92 + .08 * vAo), .55);
  // (what's taken up: a faint warm tint; its outline is drawn after, where the mask changes)
  if (sel) c = mix(c, c * vec3(1.1, .98, .84) + vec3(.05, .025, 0.), .6);
  oCol = vec4(c, 1.);
  oNrm = vec4(n * .5 + .5, sel ? 1. : land ? .25 : fur ? .6 : .5);
}`;
const SHADOW_FS = `#version 300 es
precision highp float;
in vec3 vPos, vNrm; in float vAo, vMat, vTone; in vec4 vLs;
` + PIERCE + `
out vec4 o; void main() { if (pierced(vPos, normalize(vNrm), vMat)) discard; o = vec4(1.); }`;
const POST_VS = `#version 300 es
out vec2 vUv; void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
const POST_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uCol, uNrm, uDepth; uniform vec2 uPx; uniform float uRange, uPrint, uDpr, uBleed;
out vec4 o;
float D(vec2 uv) { return texture(uDepth, uv).r * uRange; }
vec3 Nn(vec2 uv) { return texture(uNrm, uv).xyz * 2. - 1.; }
void main() {
  vec3 paper = vec3(.94,.91,.85);
  float d = D(vUv);
  vec2 px = uPx * max(1., uDpr * .75);
  // (ink where the depth folds (a laplacian, so a sloping face doesn't draw) or the surface turns sharply)
  float dl = D(vUv - vec2(px.x, 0.)), dr = D(vUv + vec2(px.x, 0.)), dd = D(vUv - vec2(0., px.y)), du = D(vUv + vec2(0., px.y));
  float lap = abs(dl + dr - 2. * d) + abs(dd + du - 2. * d);
  vec3 n = Nn(vUv);
  float turn = max(max(1. - dot(n, Nn(vUv + vec2(px.x, 0.))), 1. - dot(n, Nn(vUv - vec2(px.x, 0.)))), max(1. - dot(n, Nn(vUv + vec2(0., px.y))), 1. - dot(n, Nn(vUv - vec2(0., px.y)))));
  float sky = step(.9999 * uRange, d);
  float edge = max(smoothstep(.04, .12, lap), smoothstep(.25, .5, turn));
  // (and round the stone against the sky)
  float skyN = step(.9999 * uRange, dl) + step(.9999 * uRange, dr) + step(.9999 * uRange, dd) + step(.9999 * uRange, du);
  // (but not round the land, bleeding into the page: it has no edge to draw)
  float m0 = texture(uNrm, vUv).a;
  if (sky < .5 && skyN > 0. && !(uBleed > .5 && m0 > .1 && m0 < .4)) edge = 1.;
  vec3 c = texture(uCol, vUv).rgb;
  vec2 q = gl_FragCoord.xy;
  // (what's taken up, outlined: where the selection mask changes, on the side that's selected)
  float m = texture(uNrm, vUv).a, ring = 0.;
  // (a cat's contour: drawn where its coat meets anything else, on its own side)
  float furOn = step(.55, m) * step(m, .7), rim = 0.;
  if (furOn > .5) for (int a = 0; a < 4; a++) { float t = float(a) * 1.5708; float mm = texture(uNrm, vUv + vec2(cos(t), sin(t)) * px).a; rim = max(rim, 1. - step(.55, mm) * step(mm, .7)); }
  if (m > .75) for (int a = 0; a < 8; a++) { float t = float(a) * .785398; vec2 o = vec2(cos(t), sin(t)) * px * 2.; ring = max(ring, step(texture(uNrm, vUv + o).a, .75)); }
  if (sky > .5) {
    // (the paper behind it, a little darker toward the corners)
    float v = length(vUv - .5);
    o = vec4(paper * (1. - .12 * v * v * (1. - uBleed)) * (1. - .06 * uBleed * smoothstep(.35, .75, length((vUv - .5) * vec2(1.2, 1.)))), 1.);
    return;
  }
  vec3 ink = vec3(.17,.14,.12);
  if (uPrint > .5) {
    // (a lithograph: the light as hatching, closer and crossed as it darkens)
    float L = dot(c, vec3(.3,.55,.15));
    float s = 4.5 * uDpr;
    float h1 = abs(fract((q.x + q.y) / s) - .5) * s, h2 = abs(fract((q.x - q.y) / s) - .5) * s, h3 = abs(fract(q.y / (s * .7)) - .5) * s * .7;
    float w = .55 * uDpr;
    float hatch = 0.;
    hatch = max(hatch, (1. - smoothstep(w, w + 1., h1)) * smoothstep(.78, .62, L));
    hatch = max(hatch, (1. - smoothstep(w, w + 1., h2)) * smoothstep(.55, .4, L));
    hatch = max(hatch, (1. - smoothstep(w, w + 1., h3)) * smoothstep(.36, .24, L));
    c = mix(paper, ink, hatch * .85);
  o = vec4(mix(mix(c, ink, max(edge * .85 * (1. - step(.1, m) * step(m, .4) * .8), rim * .9)), vec3(.69, .36, .12), ring * .9), 1.);
    return;
  }
  // (as it is: barely a line, only where the depth folds; never on the land itself, whose folds are its own)
  // (not against the sky: the table's far edge isn't drawn)
  float onLand = step(.1, m) * step(m, .4);
  o = vec4(mix(mix(c, ink * 1.6, max(smoothstep(.04, .14, lap) * (furOn > .5 ? .4 : .16) * (1. - step(.5, skyN)) * (1. - onLand), rim * .8)), vec3(.69, .36, .12), ring * .9), 1.);
  // (bleeding: the same paper under everything, its edge a shade darker, so the ground and the page are one sheet)
  if (uBleed > .5) o.rgb *= 1. - .06 * smoothstep(.35, .75, length((vUv - .5) * vec2(1.2, 1.)));
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(t)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

// ─── the little matrix arithmetic it needs (column-major, as GL has it) ───
export type M4 = Float32Array;
export function mul(a: M4, b: M4): M4 { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
export function ortho(l: number, r: number, b: number, t: number, n: number, f: number): M4 { return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]); }
export function lookAt(e: number[], c: number[], up: number[]): M4 {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
}
export function invert(m: M4): M4 {
  const o = new Float32Array(16), a = m;
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det; o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det; o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det; o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det; o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
  return o;
}
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** the sun: low, from over the left shoulder of the first view */
export const SUN = norm([-0.62, 0.72, -0.3]);

/** the camera: square-on to nothing, looking down at `el` from `az` round, orthographic (as the prints draw it) */
export function camera(v: View, aspect: number): { vp: M4; eye: number[]; dir: number[]; range: number } {
  const d = [Math.cos(v.el) * Math.sin(v.az), Math.sin(v.el), Math.cos(v.el) * Math.cos(v.az)], R = 120;
  const eye = [v.target[0] + d[0] * R, v.target[1] + d[1] * R, v.target[2] + d[2] * R];
  const h = v.zoom, w = h * aspect;
  return { vp: mul(ortho(-w, w, -h, h, 1, 4 * R), lookAt(eye, v.target, [0, 1, 0])), eye, dir: [-d[0], -d[1], -d[2]], range: 4 * R - 1 };
}

export class Renderer {
  gl: WebGL2RenderingContext;
  private main: WebGLProgram; private shadow: WebGLProgram; private post: WebGLProgram;
  private vao: WebGLVertexArrayObject; private buf: WebGLBuffer; private count = 0;
  /** what moves (the cats): its own buffer, filled again each frame, drawn with the stone */
  private dvao: WebGLVertexArrayObject; private dbuf: WebGLBuffer; private dcount = 0;
  private shadowFb: WebGLFramebuffer; private shadowTex: WebGLTexture;
  private fb: WebGLFramebuffer | null = null;
  /** drawn multisampled (4×), then resolved into the textures the ink reads */
  private ms: WebGLFramebuffer | null = null; private msBufs: WebGLRenderbuffer[] = [];
  msaa = true; private col: WebGLTexture | null = null; private nrm: WebGLTexture | null = null; private dep: WebGLTexture | null = null; private size = [0, 0];
  sun = SUN;
  print = false;
  /** what the sun must cover: the middle of the slab (x, z), and how far out from it */
  area: [number, number, number] = [0, 0, 10];
  /** the land bleeding into the page (after Taohua), and the land's extent in the scene (x0, z0, x1, z1) */
  bleed = false; landBox: [number, number, number, number] = [-1e3, -1e3, 1e3, 1e3];
  /** what's built, its extent in the scene (x0, z0, x1, z1): bleeding, the land's given back to the paper away from it */
  built: [number, number, number, number] = [-5, -5, 5, 5];
  /** how high it's built (the sun's view reaches over it) */
  top = 8;
  /** (for looking at it: the sun's shadows, or none) */
  shadows = true;
  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })!;
    if (!gl) throw new Error('no WebGL2');
    this.gl = gl;
    this.main = compile(gl, VS, FS); this.shadow = compile(gl, VS, SHADOW_FS); this.post = compile(gl, POST_VS, POST_FS);
    const layout = () => {
      const F = 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE * F, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE * F, 3 * F);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE * F, 6 * F);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, STRIDE * F, 8 * F);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, STRIDE * F, 11 * F);
    };
    this.vao = gl.createVertexArray()!; this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); layout();
    this.dvao = gl.createVertexArray()!; this.dbuf = gl.createBuffer()!;
    gl.bindVertexArray(this.dvao); gl.bindBuffer(gl.ARRAY_BUFFER, this.dbuf); layout();
    gl.bindVertexArray(null);
    this.shadowTex = this.depthTex(2048, 2048);
    this.shadowFb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  private depthTex(w: number, h: number) {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  private colTex(w: number, h: number) {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  upload(m: Mesh) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, m.data, gl.STATIC_DRAW);
    this.count = m.count;
  }
  /** what moves, as it is this frame (STRIDE floats a vertex) */
  moving(data: Float32Array, count: number) {
    const gl = this.gl;
    this.dcount = count;
    if (!count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dbuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.DYNAMIC_DRAW);
  }
  private targets(w: number, h: number) {
    if (this.size[0] === w && this.size[1] === h && this.fb) return;
    const gl = this.gl;
    for (const t of [this.col, this.nrm, this.dep]) if (t) gl.deleteTexture(t);
    if (this.fb) gl.deleteFramebuffer(this.fb);
    this.col = this.colTex(w, h); this.nrm = this.colTex(w, h); this.dep = this.depthTex(w, h);
    this.fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.col, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.nrm, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.dep, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    // (and its multisampled twin)
    for (const r of this.msBufs) gl.deleteRenderbuffer(r);
    if (this.ms) gl.deleteFramebuffer(this.ms);
    this.ms = null; this.msBufs = [];
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
    if (this.msaa && samples > 1) {
      this.ms = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ms);
      const rb = (fmt: number, at: number) => { const r = gl.createRenderbuffer()!; gl.bindRenderbuffer(gl.RENDERBUFFER, r); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, at, gl.RENDERBUFFER, r); this.msBufs.push(r); };
      rb(gl.RGBA8, gl.COLOR_ATTACHMENT0); rb(gl.RGBA8, gl.COLOR_ATTACHMENT1); rb(gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.deleteFramebuffer(this.ms); this.ms = null; }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.size = [w, h];
  }
  /** the sun's view: square on to it, over the whole slab and as high as it can be built */
  private lightVP(): M4 {
    const [ax, az, e] = this.area, top = Math.max(4, this.top + 2), c = [ax, top / 2, az], s = this.sun;
    const eye = [c[0] + s[0] * 60, c[1] + s[1] * 60, c[2] + s[2] * 60], r = Math.hypot(e * 1.42, top / 2) + 1;
    return mul(ortho(-r, r, -r, r, 60 - r - 2, 60 + r + 2), lookAt(eye, c, [0, 1, 0]));
  }
  draw(view: View, time: number, dpr: number) {
    const gl = this.gl, cv = this.canvas, w = cv.width, h = cv.height;
    this.targets(w, h);
    const cam = camera(view, w / h), light = this.lightVP();
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
    // (the sun's depths)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb); gl.viewport(0, 0, 2048, 2048);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shadow);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.shadow, 'uVP'), false, light);
    gl.uniform1f(gl.getUniformLocation(this.shadow, 'uTime'), time);
    gl.cullFace(gl.FRONT);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, this.count);
    if (this.dcount) { gl.bindVertexArray(this.dvao); gl.drawArrays(gl.TRIANGLES, 0, this.dcount); gl.bindVertexArray(this.vao); }
    gl.cullFace(gl.BACK);
    // (the stone, lit)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ms ?? this.fb); gl.viewport(0, 0, w, h);
    gl.clearBufferfv(gl.COLOR, 0, [0.9, 0.87, 0.81, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.main);
    const U = (n: string) => gl.getUniformLocation(this.main, n);
    gl.uniformMatrix4fv(U('uVP'), false, cam.vp); gl.uniformMatrix4fv(U('uLight'), false, light);
    gl.uniform1f(U('uTime'), time); gl.uniform3fv(U('uSun'), this.sun); gl.uniform3fv(U('uEye'), cam.eye); gl.uniform3fv(U('uDir'), cam.dir); gl.uniform1f(U('uN'), 12); gl.uniform3fv(U('uArea'), this.area); gl.uniform1f(U('uShadows'), this.shadows ? 1 : 0); gl.uniform1f(U('uBleed'), this.bleed ? 1 : 0); gl.uniform4fv(U('uLand'), this.landBox); gl.uniform4fv(U('uBuilt'), this.built);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(U('uShadow'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
    if (this.dcount) { gl.bindVertexArray(this.dvao); gl.drawArrays(gl.TRIANGLES, 0, this.dcount); }
    gl.bindVertexArray(null);
    if (this.ms) {
      // (resolved: each colour, then the depth)
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb);
      gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1]);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    // (ink, and paper)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.post);
    const P = (n: string) => gl.getUniformLocation(this.post, n);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.col); gl.uniform1i(P('uCol'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.nrm); gl.uniform1i(P('uNrm'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.dep); gl.uniform1i(P('uDepth'), 2);
    gl.uniform2f(P('uPx'), 1 / w, 1 / h); gl.uniform1f(P('uRange'), cam.range); gl.uniform1f(P('uPrint'), this.print ? 1 : 0); gl.uniform1f(P('uDpr'), dpr); gl.uniform1f(P('uBleed'), this.bleed ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return cam;
  }
}
