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
  if ((mi / 64) % 4 != 3 || abs(n.y) > .5 || mi % 16 == 3) return false;
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
/**
 * Bleeding into the page (after Taohua): how much of the drawing reaches a point, 1 by what's built, none well away from
 * it or at the land's own edge, raggedly. It thins the land's marks (how many strokes there are, how far a dry brush
 * reaches), never how dark they are; and a thing that lies on the land (a rock, a shrub, a cypress) is either drawn
 * whole or not at all, more of them left out the further they are.
 */
const REACH = `
uniform float uBleed; uniform vec4 uLand, uFocusBox; uniform sampler2D uFocus;
float bhash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float bnoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(bhash(i), bhash(i + vec3(1,0,0)), f.x), mix(bhash(i + vec3(0,1,0)), bhash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bhash(i + vec3(0,0,1)), bhash(i + vec3(1,0,1)), f.x), mix(bhash(i + vec3(0,1,1)), bhash(i + vec3(1,1,1)), f.x), f.y), f.z); }
// (how far it is, in cells, to the nearest thing built: a field over the land, worked out whenever what's built changes
// (main.ts), so the drawing gathers round what's built and not round the box it fits in)
float builtD(vec3 p) { return texture(uFocus, (p.xz - uFocusBox.xy) / (uFocusBox.zw - uFocusBox.xy)).r * 16.; }
// (the picture's reach: close round what's built, where it's drawn whole)
float reach(vec3 p) {
  float dB = builtD(p), dE = min(min(p.x - uLand.x, uLand.z - p.x), min(p.z - uLand.y, uLand.w - p.z));
  float rag = (bnoise(vec3(p.x * .35, 0., p.z * .35)) - .5) * 2.5;
  return (1. - smoothstep(.9, 4.4, dB + rag * .6)) * smoothstep(.2, 3.2, dE + rag * .6);
}
// (the line's reach: much further, thinning out to the land's edge)
float reachLines(vec3 p) {
  float dB = builtD(p), dE = min(min(p.x - uLand.x, uLand.z - p.x), min(p.z - uLand.y, uLand.w - p.z));
  float rag = (bnoise(vec3(p.x * .35, 0., p.z * .35)) - .5) * 2.5;
  return (1. - smoothstep(1.5, 11., dB + rag * 1.2)) * smoothstep(.2, 2.6, dE + rag * .6);
}
// (a tree's crown (an olive's, a stone pine's: leaves, kind 1 or 2) isn't a ball of green but leaves in tufts with sky
// between them: where the leaf pattern thins it's cut through, in the picture and in the sun's view both, so its shade
// on the ground is dappled. \`at\`: how thin the pattern may be and still stand: in the picture only toward the crown's
// outline (its normals are the whole crown's, so that's where it's edge-on to the eye), so it breaks there and nowhere
// is the paper seen through its middle; in the sun's view throughout, for the dappling)
uniform float uLeafCut;
bool leafCut(vec3 p, float m, float at) {
  if (uLeafCut < .5) return false;
  int mi = int(m + .5) % 256;
  if (mi % 16 != 3 || ((mi / 64) % 4 != 1 && (mi / 64) % 4 != 2) || (mi / 16) % 4 != 0) return false;
  float lf = bnoise(p * 7.5) * .6 + bnoise(p * 19. + 3.) * .4;
  return lf < at;
}
// (a thing lying on the land (its rise marked 3 + its own chance), left out where the drawing doesn't reach: whole; a
// thing wider than its cell (a tree's crown) marked 4 + its foot's cell and its chance, so it's kept or left whole)
bool leftOut(vec3 p, float u) {
  if (uBleed < .5 || u < 3. || u >= 5.) return false;
  if (u < 4.) return fract(u) > reachLines(vec3(floor(p.x) + .5, 0., floor(p.z) + .5)) * 1.25 - .08;
  float f = (u - 4.) * 10000., at = floor(f);
  return fract(f) / .9 > reachLines(vec3(mod(at, 64.) - 29.5, 0., floor(at / 64.) - 29.5)) * 1.25 - .08;
}
`;
const FS = COMMON + PIERCE + REACH + `
in vec3 vPos, vNrm; in float vAo, vMat, vTone, vU; in vec4 vLs;
uniform highp sampler2DShadow uShadow; uniform highp sampler2D uShadowRaw; uniform vec3 uSun, uEye, uDir, uArea; uniform float uN, uShadows;
// (the sun's map: how much of the world a texel of it covers, and how deep its range is, so its bias and its softness are
// in the world's own units whatever it's fitted to)
uniform float uTexel, uDepthRange;
layout(location=0) out vec4 oCol; layout(location=1) out vec4 oNrm;
float leafEdge(vec3 n) { float rim = 1. - abs(dot(n, normalize(uDir))); return .78 * rim * rim - .1; }
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p) { return .5 * noise(p) + .25 * noise(p * 2.1) + .125 * noise(p * 4.3) + .125 * noise(p * 8.7); }
// (Taohua's brush strokes: in rows rs apart across p.y, each about len long along p.x, so many drawn (dens), tapered,
// swelling past their middle as a brush presses and lifts, a little wavy, broken where the brush runs dry; fy: room
// units to a pixel across the rows. Its ink, 0..1)
float strokes(vec2 p, float rs, float len, float dens, float seed, float fy, float thin, float wv, float dry) {
  float rv = p.y / rs, row = floor(rv);
  float L = len * mix(.6, 1.5, hash(vec3(row, seed, 2.3)));
  float sx = p.x / L + hash(vec3(row, seed, 7.1)) * 13.;
  float seg = floor(sx), t = fract(sx);
  vec3 id = vec3(row * 1.37, seg * .71, seed);
  if (hash(id + 1.3) > dens) return 0.;
  float a0 = hash(id + 2.1) * .35, a1 = 1. - hash(id + 3.7) * .35, u = (t - a0) / (a1 - a0);
  if (u <= 0. || u >= 1.) return 0.;
  float k = hash(id + 4.9) < .65 ? 1. : 2., y0 = .5 + (hash(id + 5.3) - .5) * .36;
  float wav = wv * (.6 + .8 * hash(id + 6.1)) * sin(6.2832 * (k * u + hash(id + 7.7)));
  float px = abs(fract(rv) - y0 - wav) * rs / max(fy, 1e-5);
  float w = mix(.3, 1.35, hash(id + 8.3)) * pow(sin(3.14159 * pow(u, .85)), 1.1) * thin;
  float br = dry > 0. ? step(dry, noise(vec3(p.x * 2.4 / len, row * 3.1, seed + 17.))) : 1.;
  return (1. - smoothstep(w, w + .8, px)) * mix(.5, 1., hash(id + 9.9)) * br;
}
// (travertine: cream, banded as it was laid down, pitted with its little pores, each block a shade of its own)
// (how much fine detail at a frequency survives at this distance: none once a cycle is smaller than a pixel or so)
// (and none of it where the picture's giving way to the drawing (\`gDetail\`): the material's grain goes first, its
// colour and its form after)
float gDetail = 1.;
float keep(float f) { return (1. - smoothstep(.25, .6, length(fwidth(vPos)) * f)) * gDetail; }
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
// (dressed stone, laid in courses: which block a point on an upright face is in (u along the face, v up it), and how
// far it is from its nearest joint. Its colour, its relief and its roughness all come from these same blocks: three
// courses a level, each block its own length, the upright joints staggered course to course)
float ashlar(vec2 q, float tone, out vec2 id) {
  float ch = 1. / 3., cr = floor(q.y / ch), L = mix(.42, .82, hash(vec3(cr, tone * 7., 1.3)));
  float bu = (q.x + hash(vec3(cr, 2.1, tone)) * 3.) / L, b = floor(bu);
  id = vec2(b, cr);
  return min(min(fract(bu), 1. - fract(bu)) * L, min(fract(q.y / ch), 1. - fract(q.y / ch)) * ch);
}
// (a top: flags in rows half a cell wide, each a length of its own, the rows' joints staggered, so a top reads as laid
// stone and not as one slab a cell square)
float flags(vec2 q, out vec2 id) {
  q += uN * .5;
  float rw = .5, r = floor(q.y / rw), L = mix(.36, .62, hash(vec3(r, 4.7, 1.)));
  float bu = (q.x + hash(vec3(r, 8.3, 2.)) * 2.) / L, b = floor(bu);
  id = vec2(b, r);
  return min(min(fract(bu), 1. - fract(bu)) * L, min(fract(q.y / rw), 1. - fract(q.y / rw)) * rw);
}
// (how high the face stands at a distance d from its joint: the mortar back, the block's arris rounded off)
float arris(float d) { return smoothstep(.008, .055, d); }
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
  // (where this is on the way from the picture to the page (\`gT\`: past .85 the picture whole, under .1 the page), worked
  // out first: by the picture's reach at it (a thing on the land by its foot, so it isn't torn in two), ragged where the
  // picture reaches; and each kind of thing at its own rate: what's built holds on longest, then the water, the ground,
  // and soonest the trees, which go to drawn canopy while what they stand by is still whole)
  float gT = 2.;
  bool onIt = mat == 5 && moss;
  if (uBleed > .5 && !sel && !fur) {
    vec3 at = vPos;
    if (vU >= 4. && vU < 5.) { float at0 = floor((vU - 4.) * 10000.); at = vec3(mod(at0, 64.) - 29.5, 0., floor(at0 / 64.) - 29.5); }
    else if (vU >= 3. && vU < 4.) at = vec3(floor(vPos.x) + .5, 0., floor(vPos.z) + .5);
    float R0 = reach(at), rg = min(1., R0 * 4.);
    float rate = onIt ? 0. : mat == 3 ? -.07 : mat == 4 ? -.03 : mat == 2 ? .25 : .3;
    gT = R0 + ((fbm(vec3(at.xz * .9, 5.)) - .5) * .3 + (onIt ? (noise(vPos * 3.1) - .5) * .1 : 0.)) * rg + rate * rg;
  }
  gDetail = smoothstep(.5, .85, gT);
  // (a crown cut through more as it's drawn, so its limbs show and it reads as drawn canopy)
  if (vMat < 511.5 && leafCut(vPos, vMat, leafEdge(n) + .32 * (1. - smoothstep(.1, .7, gT)))) discard;
  if (!fur && leftOut(vPos, vU)) discard;
  vec3 base; float spec = 0., wrap = 0.;
  // (the surface as the light sees it: the face's own normal, turned by the relief of what it's made of (joints, tiles);
  // and how shut in its little hollows are. The ink still sees the face's own)
  vec3 nS = n; float cav = 1.;
  // (how much of the land here is a feature of it (a cliff's rock, a bank's dashes), not its open ground)
  float landFeat = 0.;
  if (fur) { base = coat(m0 - 512, vU, n, vTone); wrap = .5; }
  else if (mat == 2) base = vec3(.13, .25, .25);
  else if (mat == 3) {
    // (leaves, by kind: a cypress's dark green; an olive's grey-green, silver where it turns; a stone pine's deep
    // blue-green; clipped box, a brighter green)
    float f = fbm(vPos * 7.);
    // (and a climber's: its own fresh green, and its bracts in flower, a deep magenta)
    if (moss) base = mix(vec3(.55, .10, .32), vec3(.78, .22, .48), f);
    else if (ivy) base = mix(vec3(.16, .28, .09), vec3(.30, .42, .16), f);
    else if (kind == 1) base = mix(vec3(.24, .29, .20), vec3(.42, .46, .36), f);
    else if (kind == 2) base = mix(vec3(.07, .15, .10), vec3(.15, .23, .14), f);
    else if (kind == 3) base = mix(vec3(.13, .23, .08), vec3(.25, .35, .13), f);
    else base = mix(vec3(.10, .17, .08), vec3(.20, .27, .12), f);
    base *= .8 + .4 * vTone; wrap = .35;
  }
  else if (mat == 4) base = vec3(.32, .24, .17);
  else if (mat == 9) base = vec3(1.);
  else if (mat == 11 && vTone > 1.5) {
    // (the house's paint (in the tone past 2: sage, blue-grey, oxblood): a shutter's louvres, each slat's lower edge in
    // shadow, the paint worn through here and there to grey wood; past 5, canvas, in stripes across it, a little soiled)
    vec3 T = normalize(vec3(-n.z, 0., n.x) + 1e-5);
    float u = dot(vPos, T);
    int pc = int(mod(floor(vTone + .01), 3.));
    vec3 paint = pc == 0 ? vec3(.43, .53, .42) : pc == 1 ? vec3(.40, .51, .58) : vec3(.55, .30, .24);
    if (vTone > 4.5) {
      float st = step(.5, fract(u * 6.5));
      base = mix(vec3(.90, .86, .76), paint * 1.1, st) * (.93 + .07 * noise(vPos * 24.)) * (1. - .08 * smoothstep(.5, .8, fbm(vPos * 5.)));
    } else {
      float sl = fract(vPos.y * 30.);
      base = paint * (.8 + .28 * smoothstep(.0, .45, sl) * keep(30.)) * (.94 + .08 * noise(vPos * 30.));
      base = mix(base, vec3(.48, .45, .40), .55 * smoothstep(.7, .85, noise(vPos * vec3(9., 3., 9.) + 3.)));
    }
  }
  else if (mat == 11) {
    // (a door: planks, upright, weathered dark, with a darker line between each)
    float u = abs(n.x) > .5 ? vPos.z : vPos.x, pl = fract(u * 14.);
    base = vec3(.30, .21, .14) * (.85 + .25 * hash(vec3(floor(u * 14.), 3., 1.))) * (.8 + .2 * noise(vec3(u * 40., vPos.y * 3., 0.)));
    base *= .75 + .25 * smoothstep(.0, .12, min(pl, 1. - pl));
  }
  else if (mat == 12) base = vec3(.09, .10, .11);
  else if (mat == 13) {
    // (roof tiles: laid in the slope's own frame (across it along the eaves, up it), so they're one size whatever the
    // pitch: columns of round tiles, caps and pans by turns (the caps standing up, the pans hollow between them); in
    // courses up the slope, each tile's lip proud of the one below it and throwing a little shadow on it; each a shade of
    // its own, now and then one weathered)
    vec3 T = normalize(vec3(-n.z, 0., n.x) + 1e-5), S = normalize(cross(n, T)); if (S.y < 0.) S = -S;
    float u = dot(vPos, T) * 7., v = dot(vPos, S) * 9., cu = floor(u), cv = floor(v), fv = fract(v);
    float tint = hash(vec3(cu, cv, 7.)), kT = keep(9.);
    base = mix(vec3(.63, .37, .26), vec3(.70, .44, .31), tint);
    if (hash(vec3(cu, cv, 3.)) > .9) base = mix(base, vec3(.50, .40, .30), .45);
    base = mix(base, vec3(.47, .47, .40), .16 * smoothstep(.55, .8, fbm(vPos * 2.)));
    // (across: round over a cap, hollow in a pan; up: each tile rising toward its lip)
    float across = cos(u * 3.14159), along = -.9;
    nS = normalize(n + (T * across * .55 + S * along * .1) * kT);
    // (the lip's shadow on the tile under it; the lip's own edge catching the light; the pans darker than the caps)
    float lip = smoothstep(.78, 1., fv) * kT;
    cav = (1. - .45 * lip) * (1. - .3 * (.5 - .5 * sin(u * 3.14159)) * kT);
    base *= 1. + .12 * (1. - smoothstep(0., .08, fv)) * kT;
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
    // (the land, as the light finds it near what's built (further out it's given back to the paper, below): open ground
    // warm earth and dry grass, greener where it's damp and low; where it's steep, limestone in its beds, the bedding
    // lines across it and the fractures down it, each bed's face a little out of true, weathered darker at its foot)
    float up = n.y, rough = noise(vPos * vec3(1.7, 2.3, 1.7)) * .6 + noise(vPos * 6.) * .4;
    float cliff = smoothstep(.8, .52, up + (rough - .5) * .16);
    landFeat = cliff;
    // (open ground: warm grey-brown earth, not sand; dry grass over most of the level ground in drifts, straw going to
    // olive, its blades a fine grain while they're big enough to see; greener where it's damp and low and at the water's
    // edge (how near the water, from the mesh, in its tone), and darker there, wet)
    float wetv = clamp(vTone, 0., 1.), patchy = fbm(vec3(vPos.xz * 1.1, 2.)), fine = noise(vPos * 9.);
    vec3 earth = mix(vec3(.72, .66, .55), vec3(.65, .59, .49), patchy);
    float gr = smoothstep(.36, .6, fbm(vec3(vPos.xz * 1.6, 7.)) + .3 * (up - .85)) * smoothstep(.7, .9, up);
    vec3 straw = mix(vec3(.73, .68, .51), vec3(.61, .61, .44), smoothstep(.4, .7, fbm(vec3(vPos.xz * .7, 13.))));
    straw *= .87 + .2 * mix(.5, noise(vec3(vPos.x * 31., vPos.y * 4., vPos.z * 31.)), keep(30.));
    vec3 soil = mix(earth, straw, gr * .85);
    soil = mix(soil, vec3(.48, .54, .34), clamp(.35 * smoothstep(.62, .8, fbm(vec3(vPos.xz * 3.1, 11.))) * (1. - vAo * .5) + .5 * wetv, 0., .7));
    soil *= (.94 + .1 * fine) * (1. - .3 * smoothstep(.45, .95, wetv));
    // (the rock: its beds level, a little thicker or thinner each; a bedding line at each bed's foot, a fracture now and
    // then down it, and across a fracture the bed's line a little higher or lower, as the blocks have settled)
    vec2 fall = normalize(n.xz + 1e-4), con = vec2(-fall.y, fall.x);
    float bedR = vPos.y * 2.9 + (noise(vPos * vec3(.45, .2, .45)) - .5) * .3;
    float cc = dot(vPos.xz, con) * 1.3 + hash(vec3(floor(bedR), 5., 5.)) + (noise(vPos * vec3(2., 3., 2.)) - .5) * .25, colI = floor(cc);
    float bedV = bedR + (hash(vec3(colI, floor(bedR), 6.)) - .5) * .2, bedF = fract(bedV), bedI = floor(bedV);
    vec3 rock = mix(vec3(.80, .76, .68), vec3(.88, .85, .78), hash(vec3(bedI, colI, 1.)) * .7 + .3 * rough);
    float fr = min(fract(cc), 1. - fract(cc)) / 1.3;
    rock *= 1. - .1 * (1. - smoothstep(.0, .06, bedF)) - (.07 + .1 * hash(vec3(bedI, colI, 9.))) * (1. - smoothstep(.0, .03, fr));
    rock = mix(rock, vec3(.62, .58, .50), .25 * smoothstep(.6, .9, fbm(vPos * 1.7 + 4.)));
    rock *= 1. - .28 * wetv;
    base = mix(soil, rock, cliff);
    // (the beds' faces turned a little each, the bedding lines and fractures cut in, for the light)
    float kL = keep(6.);
    nS = normalize(n + (vec3(con.x, 0., con.y) * (hash(vec3(bedI, 7., 2.)) - .5) * .5 + vec3(0., 1., 0.) * (smoothstep(.0, .12, bedF) - .5) * .35 + vec3(con.x, 0., con.y) * sign(fract(cc) - .5) * (1. - smoothstep(.0, .05, fr)) * .5) * cliff * kL);
    cav = 1. - cliff * (.3 * (1. - smoothstep(.0, .09, bedF)) + .2 * (1. - smoothstep(.0, .035, fr)));
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
    // (dressed stone, in its blocks (ashlar, or a top's flags): each block a shade of its own; its joints recessed, the
    // mortar a little paler and duller; each arris rounded so it catches the light, each face a little out of true; the
    // detail gone where it's smaller than the eye can hold)
    if (mat == 0 && kind != 3 && n.y > -.5) {
      bool upright = abs(n.y) < .5;
      vec3 T = upright ? normalize(vec3(-n.z, 0., n.x) + 1e-5) : vec3(1., 0., 0.), B = upright ? vec3(0., 1., 0.) : vec3(0., 0., 1.);
      vec2 q = vec2(dot(vPos, T), upright ? vPos.y : vPos.z), id, id2;
      const float e = .004;
      float d0 = upright ? ashlar(q, vTone, id) : flags(q, id);
      float du = upright ? ashlar(q + vec2(e, 0.), vTone, id2) : flags(q + vec2(e, 0.), id2);
      float dv = upright ? ashlar(q + vec2(0., e), vTone, id2) : flags(q + vec2(0., e), id2);
      float h0 = arris(d0), kS = keep(36.);
      vec3 g = ((arris(du) - h0) * T + (arris(dv) - h0) * B) / e;
      float t1 = hash(vec3(id, vTone * 5. + 1.)), t2 = hash(vec3(id, vTone * 5. + 2.));
      nS = normalize(n - g * .03 * kS + (T * (t1 - .5) + B * (t2 - .5)) * .08 * keep(4.));
      base *= .93 + .14 * hash(vec3(id, vTone * 3.));
      base = mix(vec3(.62, .58, .50) * (.92 + .08 * noise(vPos * 50.)), base, mix(1., smoothstep(.007, .018, d0), keep(40.)));
      cav = mix(1., mix(.55, 1., h0), kS);
    }
  }
  // (moss: in the joints and the shade, thicker on tops and low down; ivy: hanging leaves over a side)
  if (moss && mat != 5 && mat != 3) {
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
  if (ivy && mat != 3 && abs(n.y) < .5) base *= .93 - .05 * noise(vPos * 6.);
  // ─── light. The colours above are as they're seen; taken back to light (linear) here, lit, and put through the display
  // transform once, at the end. What lights it is kept apart: the sun, shut out only by its shadow; the sky over it, cool,
  // and the warm light the sunlit ground and stone throw back up, both shut out by what's round it (the vertex's ao: the
  // sky it sees, baked); and a sheen by how rough the material is ───
  vec3 alb = pow(base, vec3(2.2));
  // (the sun, and its shadows: soft, a few taps round where this is in its map)
  vec3 ls = vLs.xyz / vLs.w * .5 + .5;
  float sh = 0., bias = uTexel * (1.6 + 3.2 * (1. - abs(dot(n, uSun)))) / uDepthRange;
  // (soft where what casts it is far off, crisp where it's close: how far the casters are, then filtered that wide; the
  // softness in the world's units, so it's the same however close the map's fitted)
  // (the casters' distance from four raw taps; then nine taps compared by the hardware, each itself filtered over four
  // texels, spread as wide as that distance says)
  float bsum = 0., bn = 0., reachT = max(3., .045 / uTexel);
  for (int a = -1; a <= 1; a += 2) for (int b = -1; b <= 1; b += 2) { float d = texture(uShadowRaw, ls.xy + vec2(a, b) * reachT / 2048.).r; if (d < ls.z - bias) { bsum += d; bn += 1.; } }
  float penW = bn > 0. ? clamp((ls.z - bsum / bn) * uDepthRange * .012, .011, .055) : .016, pen = penW / uTexel;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) sh += texture(uShadow, vec3(ls.xy + vec2(a, b) * 1.1 * pen / 2048., ls.z - bias));
  // (out past the sun's map: lit)
  if (any(lessThan(ls, vec3(0.))) || any(greaterThan(ls, vec3(1.)))) sh = 9.;
  sh = mix(1., sh / 9., uShadows);
  // (and the leaves of a tree out of the picture, between the sun and one side of it, stirring)
  // (where the sun's ray through this point meets the ground plane: the leaves' shade fixed there, not in the map's frame)
  vec2 lw = (vPos.xz - uSun.xz / max(uSun.y, .2) * vPos.y - uArea.xy) / max(uArea.z, 1.);
  float leafy = fbm(vec3(lw * vec2(9., 11.), uTime * .05));
  float leaves = smoothstep(.48, .6, leafy) * smoothstep(-.35, -.85, lw.x * .75 - lw.y * .45);
  sh *= 1. - .38 * leaves * (1. - smoothstep(uArea.z - 3., uArea.z, max(abs(vPos.x - uArea.x), abs(vPos.z - uArea.y))));
  float nl = dot(nS, uSun), key = max((nl + wrap) / (1. + wrap), 0.) * sh * mix(.8, 1., cav);
  // (the sun warm and strong; the sky cooler and quieter from above; what's thrown back warm from below and the sides)
  vec3 SUN = vec3(1., .83, .64) * 3., SKY = vec3(.47, .48, .54) * 1.05, BOUNCE = vec3(.70, .52, .34) * .75;
  float up = nS.y * .5 + .5, seen = vAo;
  vec3 indirect = (SKY * mix(.45, 1., up) + BOUNCE * (1. - up * up)) * seen * mix(.55, 1., seen) * cav;
  vec3 c = alb * (indirect + SUN * key);
  // (its sheen: how rough each material is says how wide and how strong; polished marble most, glass, lead; travertine a
  // little, brick and clay hardly; leaves some)
  {
    float rough = mat == 12 ? .12 : mat == 14 ? .4 : mat == 3 ? .55 : mat == 10 || mat == 13 ? .62 : kind == 2 ? .3 : kind == 1 ? .8 : .7;
    vec3 hv = normalize(uSun - normalize(uDir));
    float g = 2. / max(rough * rough * rough * rough, 1e-3) - 2., f0 = mat == 12 ? .06 : .035;
    float fr = f0 + (1. - f0) * pow(1. - max(dot(hv, -normalize(uDir)), 0.), 5.);
    if (mat != 2 && mat != 9 && !(mat == 5 && moss)) c += SUN * fr * (g + 8.) / 25.13 * pow(max(dot(nS, hv), 0.), g) * max(nl, 0.) * sh * mix(.6, 1., seen);
  }
  // (leaves: a little of the sun through those turned from it; an olive's leaves silver where they turn, at a glance)
  if (mat == 3) {
    // (in tufts: each tuft's leaves turned out from it, the hollows between them darker)
    float t0 = bnoise(vPos * 7.5) * .6 + bnoise(vPos * 19. + 3.) * .4;
    c *= mix(.62, 1.12, smoothstep(.3, .8, t0));
    c += alb * SUN * .16 * max(-nl, 0.) * mix(.5, 1., sh);
    if (kind == 1 && !moss && !ivy) c += vec3(.55, .6, .58) * .22 * pow(1. - abs(dot(nS, normalize(uDir))), 3.) * (.4 + .6 * sh);
  }
  // (a coat's soft sheen where it turns from the eye, lit)
  if (fur) c += alb * vec3(1., .86, .66) * .8 * pow(1. - abs(dot(n, normalize(uDir))), 2.5) * (.4 + .6 * sh);
  // (the display transform: exposure; a filmic curve with a soft shoulder, on how bright it is, so a colour keeps its hue
  // (terracotta doesn't go orange as it brightens); the brightest a little paler, as film takes them; back to how it's
  // seen)
  vec3 xc = c * .5;
  float L0 = max(dot(xc, vec3(.2126, .7152, .0722)), 1e-5), L1 = clamp((L0 * (2.51 * L0 + .03)) / (L0 * (2.43 * L0 + .59) + .14), 0., 1.);
  c = xc * (L1 / L0);
  c = mix(c, vec3(L1), smoothstep(.55, 1., L1) * .35);
  c = pow(clamp(c, 0., 1.), vec3(1. / 2.2));
  // (a lamp: lit from within)
  if (mat == 9) c = vec3(1., .86, .58);
  if (mat == 2) {
    // (water: clear, turquoise as it deepens over a pale bed, the bed showing through where it's shallow at a bank (its
    // depth, from the mesh, in tone); running water (its way, an angle, in how past 1) stirred along its run, the ripples
    // carried down it, a pale line of wet and froth along a bank; still water barely stirred; the sky in it, more at a
    // glance, and the sun's glints)
    bool runs = vU > 1.0005 && vU < 2.;
    float ang = (vU - 1.001) / .98 * 6.2832;
    vec2 fl = runs ? vec2(cos(ang), sin(ang)) : vec2(0.), cr = vec2(-fl.y, fl.x);
    vec2 q = runs ? vec2(dot(vPos.xz, fl), dot(vPos.xz, cr)) : vPos.xz;
    float t = uTime * (runs ? .55 : .12);
    vec2 a1 = runs ? vec2(q.x * 3. - t * 2., q.y * 9.) : q * 5., a2 = runs ? vec2(q.x * 7. - t * 3.1, q.y * 17.) : q * 11.;
    float n1 = noise(vec3(a1, t * .3)) - .5, n2 = noise(vec3(a2, 3. + t * .2)) - .5;
    float amp = runs ? .11 : .035;
    vec2 tilt = (runs ? fl * n1 * 1.2 + cr * n2 : vec2(n1, n2)) * amp;
    vec3 wn = normalize(vec3(tilt.x, 1., tilt.y));
    float depth = clamp(vTone, 0., 1.);
    vec3 bed = vec3(.74, .72, .60), shallow = vec3(.46, .74, .70), deepC = vec3(.13, .45, .50);
    vec3 body = mix(mix(bed, shallow, smoothstep(.0, .3, depth)), deepC, smoothstep(.25, .95, depth));
    body *= .78 + .22 * sh;
    vec3 v = -normalize(uDir);
    float fres = .04 + .96 * pow(1. - max(dot(wn, v), 0.), 5.);
    c = mix(body, vec3(.84, .88, .90), clamp(fres * 1.6, 0., .55));
    c += vec3(1., .93, .8) * pow(max(dot(reflect(-uSun, wn), v), 0.), 90.) * 1.6 * sh;
    // (froth: along a bank where it runs, and in streaks down fast water)
    if (runs) {
      float streak = smoothstep(.62, .82, noise(vec3(q.x * 2.2 - t * 2.4, q.y * 14., 5.))) * (.35 + .65 * (1. - smoothstep(.1, .5, depth)));
      float edge = 1. - smoothstep(.02, .14, depth);
      c = mix(c, vec3(.94, .95, .93), clamp(streak * .55 + edge * .5 * (.6 + .4 * noise(vec3(q * 9., t))), 0., .8));
    }
  }
  // (falling water: white streaks running down it; where it lands, foam)
  if (mat == 2 && abs(n.y) < .6) {
    float u = dot(vPos.xz, normalize(vec2(-n.z, n.x) + 1e-4));
    float st = noise(vec3(u * 26., vPos.y * 3. + uTime * 2.6, 1.)) * .7 + noise(vec3(u * 60., vPos.y * 7. + uTime * 4.2, 3.)) * .3;
    c = mix(vec3(.4, .5, .51), vec3(.93, .95, .94), smoothstep(.38, .78, st)) * (.82 + .18 * sh);
  }
  if (mat == 2 && vTone > .99) c = vec3(.93, .94, .91) * (.86 + .14 * noise(vPos * 40. + uTime));
  // (the ramp from the picture to the page, by the picture's reach: whole round what's built; then, step by step, less
  // coloured and paler, the ink coming up over it, till by the wash's edge (crisp, granulating, pooling a little darker,
  // as a watercolour dries) it's barely a tint on the paper, so the edge is quiet; past it, the marks alone, as far as
  // the lines reach. \`drawn\`: how far along it this is (0 the render, 1 the page), handed to the post pass so its
  // lines come up as the drawing takes over)
  vec3 PAP = vec3(.95, .90, .80);
  float drawn = 0., washA = 1.;
  vec3 washC = c;
  if (uBleed > .5 && !sel && !fur) {
    float t = gT, rg = min(1., max(t, 0.) * 4.);
    drawn = 1. - smoothstep(.1, .85, t);
    float wv = t - .02 + (onIt ? (noise(vPos * 4.5) - .5) * .1 + (noise(vPos * 13.) - .5) * .04 : 0.) * rg;
    washA = smoothstep(.0, .03, wv);
    float L = dot(c, vec3(.3, .55, .15)), fd = smoothstep(.0, 1., drawn);
    // (less coloured toward the paper's own warmth, not toward grey, so the wash never reads paler than the page)
    washC = mix(c, mix(PAP * (L / .9), c, .7), smoothstep(.0, .5, drawn));
    washC = mix(washC, PAP, .82 * fd * fd) * (1. - .1 * washA * (1. - smoothstep(.03, .1, wv))) * (1. + (.05 * noise(vPos * 31.) - .025) * fd);
    // (and over the wash, in the shade, the pen's hatching: one way where it's in shade, crossed where it's darker; laid
    // in the world so it stays on what it shades, and left out where its lines would crowd together)
    float h1 = (vPos.x - vPos.z) * 9. + vPos.y * 6., h2 = (vPos.x + vPos.z) * 9. - vPos.y * 6.;
    float f1 = max(fwidth(h1), 1e-4), f2 = max(fwidth(h2), 1e-4);
    float l1 = (1. - smoothstep(.35, 1.1, min(fract(h1), 1. - fract(h1)) / f1)) * (1. - smoothstep(.25, .45, f1));
    float l2 = (1. - smoothstep(.35, 1.1, min(fract(h2), 1. - fract(h2)) / f2)) * (1. - smoothstep(.25, .45, f2));
    float brk = step(.25, noise(vec3(h1 * .35, h2 * .35, 3.)));
    washC *= 1. - .3 * max(l1 * smoothstep(.6, .38, L), l2 * smoothstep(.4, .24, L)) * brk * smoothstep(.15, .5, drawn) * (1. - smoothstep(.65, .95, drawn)) * (mat == 3 ? 0. : 1.);
  }
  // (the land, held back: most of the way to its own pale, unlit, the shade still on it)
  bool land = mat == 5 && moss;
  if (land && uBleed > .5) {
    // (after Taohua: the open ground is the paper itself, unlit. Only its features are drawn, in marks: a bank hatched in
    // short strokes down its fall; a cliff washed grey as a dry brush lays it, streaked down its face, strokes dragged
    // down it, a broken ink line along its top; the shade cast on the ground laid on in dry strokes. Away from what's
    // built and toward the land's edge there are fewer and fewer of them, each as dark as ever: the land isn't faded
    // out, it's drawn less, till there's only the page)
    float R = reachLines(vPos);
    vec3 GREY = vec3(.72, .64, .53), g = PAP;
    float up = n.y, rough = noise(vPos * vec3(1.7, 2.3, 1.7)) * .6 + noise(vPos * 6.) * .4;
    float cut = .41 - (up + (rough - .5) * .14), cliff = smoothstep(-.09, .09, cut), steep = smoothstep(.97, .7, up);
    vec2 fall = normalize(n.xz + 1e-4), con = vec2(-fall.y, fall.x);
    if (steep > 0. && cliff < 1.) {
      vec2 ph = vec2(dot(vPos.xz, fall) * 1.3 - vPos.y, dot(vPos.xz, con));
      float h = strokes(ph, .17, .7, (.1 + .5 * steep) * R, 15., max(fwidth(ph.y), 1e-5), 1.15, .015, .2);
      g = mix(g, vec3(.45, .36, .27), h * .85 * smoothstep(0., .45, steep) * (1. - cliff));
    }
    if (cliff > 0.) {
      float toL = dot(fall, normalize(uSun.xz + 1e-4)), u = dot(vPos.xz, con);
      vec3 wash = mix(vec3(.66, .59, .5), vec3(.84, .78, .68), smoothstep(-.4, .5, toL)) * (.92 + .12 * noise(vPos * 1.4));
      // (the wash as a dry brush lays it, streaked down the face: as far as the drawing reaches, then broken, then gone)
      float br = noise(vec3(u * 7., vPos.y * 1.1, 4.)) * .72 + noise(vec3(u * 21., vPos.y * 3., 7.)) * .28;
      float laid = smoothstep(1. - R * 1.25, 1.06 - R * 1.25, br);
      g = mix(g, mix(PAP, wash, .7), cliff * laid);
      vec2 pw = vec2(-vPos.y, u);
      float drag = strokes(pw, .11, .8, .75 * sqrt(R), 12., max(fwidth(pw.y), 1e-5), 1.2, .03, .3);
      g = mix(g, vec3(.31, .24, .18), drag * .8 * cliff);
      // (its top: where the cut begins, an ink line, broken)
      float rimD = cut / max(fwidth(cut), 1e-4), downhill = dFdx(cut) * dFdx(vPos.y) + dFdy(cut) * dFdy(vPos.y);
      float rim = (1. - smoothstep(1.2, 2.4, rimD)) * step(0., rimD) * step(downhill, 0.) * step(.3, noise(vPos * vec3(.9, 2., .9)) + .25 * R) * step(1. - R * 1.4, bnoise(vPos * .7));
      g = mix(g, vec3(.2, .15, .11), rim * .85);
    }
    // (the lie of the land in contours: a line each third of a level up it, every third one a little heavier, where the
    // ground's gentle enough for them to stand apart (on a cliff they'd crowd: its hatching says it there); broken here
    // and there, fewer further out; in the world, so they stay where they are as the eye moves)
    {
      float cy = vPos.y * 3., fw = max(fwidth(cy), 1e-4);
      float cl = (1. - smoothstep(.5, 1.3, min(fract(cy), 1. - fract(cy)) / fw)) * (1. - smoothstep(.12, .3, fw)) * (1. - cliff) * smoothstep(.995, .95, up);
      float heavy = step(mod(floor(cy + .5), 3.), .5);
      cl *= step(1. - R * 1.4, noise(vPos * vec3(1.1, .4, 1.1) + 7.));
      g = mix(g, vec3(.38, .3, .22), cl * (.45 + .25 * heavy));
    }
    // (the shade cast on the ground: laid on as a dry brush lays grey, breaking up at its edge, and further out, gone)
    float shade = (1. - sh) * (.75 + .25 * (1. - vAo)), sR = shade * (.25 + .75 * R);
    float brush = noise(vec3(vPos.x * 1.1, vPos.z * 9., 2.)) * .75 + noise(vec3(vPos.x * 4., vPos.z * 24., 5.)) * .25;
    float lay = smoothstep(1. - sR * 1.2, 1.05 - sR * 1.2, brush);
    g = mix(g, GREY, .42 * lay * smoothstep(.05, .3, shade) * (1. - .6 * cliff));
    // (near what's built, the land as the light finds it, whole; then the wash of it with the marks over it; further
    // out the marks alone)
    // (the marks a little softer than ink straight from the pen, so the page and the picture aren't at odds)
    g = mix(PAP, g, .72);
    c = mix(g, washC * mix(vec3(1.), g / PAP, smoothstep(.2, .7, drawn)), washA);
  }
  else if (uBleed > .5 && mat == 2 && !fur) {
    // (the stream, away from what's built: its water laid in broken strokes along it, then only a line or two)
    float R = reachLines(vPos), br = noise(vec3(vPos.x * 3., vPos.z * 3., 9.)) * .6 + noise(vec3(vPos.x * 11., vPos.y, vPos.z * 11.)) * .4;
    float Rw = min(1., reach(vPos) + .25), wet = smoothstep(1. - Rw * 1.3, 1.06 - Rw * 1.3, br);
    vec2 q = vec2(vPos.x + vPos.z, vPos.x - vPos.z) * .707;
    float lines = max(strokes(q, .09, .35, .35, 3., max(fwidth(q.y), 1e-5), .7, .02, .25), strokes(q.yx, .09, .35, .35, 5., max(fwidth(q.x), 1e-5), .7, .02, .25));
    vec3 pale = mix(PAP, vec3(.62, .80, .80), .55 * smoothstep(.0, .5, R));
    c = mix(mix(pale, vec3(.24, .33, .36), lines * .55 * (1. - wet) * smoothstep(0., .25, R + .15)), c, wet);
  }
  else if (land) c = mix(c, base * (.86 + .14 * sh) * (.92 + .08 * vAo), .55);
  // (what stands out on the land (a rock, a shrub, a tree), and anything built out toward its edge: washed the same way)
  if (uBleed > .5 && !land && !sel && !fur && mat != 2) c = mix(PAP, washC, washA);
  // (a crown as it's drawn: its tufts' edges in the pen's small scalloped marks, as a hand draws leaves)
  if (uBleed > .5 && mat == 3 && !fur) {
    float lf = bnoise(vPos * 4.2 + 11.), fl = max(fwidth(lf), 1e-4);
    float mk = (1. - smoothstep(.5, 1.3, abs(lf - .55) / fl)) * (1. - smoothstep(.06, .12, fl)) * step(.35, bnoise(vPos * 9. + 2.));
    c = mix(c, vec3(.32, .27, .18), mk * .55 * smoothstep(.4, .85, drawn));
  }
  // (what's taken up: a faint warm tint; its outline is drawn after, where the mask changes)
  if (sel) c = mix(c, c * vec3(1.1, .98, .84) + vec3(.05, .025, 0.), .6);
  oCol = vec4(c, 1.);
  // (its kind for the post pass, and within land's and the rest's how far it's drawn: land .12–.38, the rest .41–.54)
  oNrm = vec4(n * .5 + .5, sel ? 1. : land ? .12 + .26 * drawn : fur ? .6 : .41 + .13 * drawn);
}`;
const SHADOW_FS = `#version 300 es
precision highp float;
in vec3 vPos, vNrm; in float vAo, vMat, vTone, vU; in vec4 vLs;
` + PIERCE + REACH + `
out vec4 o; void main() { if (pierced(vPos, normalize(vNrm), vMat) || (vMat < 511.5 && (leftOut(vPos, vU) || leafCut(vPos, vMat, .34)))) discard; o = vec4(1.); }`;
const POST_VS = `#version 300 es
out vec2 vUv; void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
const POST_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uCol, uNrm, uDepth; uniform vec2 uPx; uniform float uRange, uPrint, uDpr, uBleed, uWorldPx, uContact; uniform mat3 uViewRot;
out vec4 o;
float D(vec2 uv) { return texture(uDepth, uv).r * uRange; }
vec3 Nn(vec2 uv) { return texture(uNrm, uv).xyz * 2. - 1.; }
void main() {
  vec3 paper = vec3(.95,.90,.80);
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
  // (contact: where something stands close in front of a surface within a short reach (a wall's foot on the ground, the
  // eaves over a wall, a step's riser under its tread, a pot on a top), a little shade in the crease. Short, so a broad
  // pale wall gets no halo; the broad shutting-in is the world's own (baked); not on the land drawn as paper, nor the sky)
  float m1 = texture(uNrm, vUv).a;
  if (uContact > .5 && sky < .5 && uPrint < .5 && !(uBleed > .5 && m1 > .1 && m1 < .4)) {
    // (what's sampled, in the camera's own frame: across and up the picture, and toward the eye; it shades only if it's in
    // front of the surface, along its normal, and near)
    vec3 nv = uViewRot * n;
    float R = .3, rp = R / uWorldPx, occ = 0., rot = mod(floor(q.x) + 2. * floor(q.y), 4.) * 1.5708;
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 2.39996 + rot, t = (float(k) + .5) / 8.;
      vec2 o = vec2(cos(a), sin(a)) * rp * t;
      vec3 v = vec3(o * uWorldPx, d - D(vUv + o * uPx));
      float l = length(v);
      occ += smoothstep(.2, .45, dot(v, nv) / max(l, 1e-4)) * (1. - smoothstep(R * .5, R, l));
    }
    c *= 1. - .32 * smoothstep(.5, 4., occ);
  }
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
  vec3 ink = vec3(.22,.16,.11);
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
  float onLand = uBleed > .5 ? step(m, .4) : step(.1, m) * step(m, .4);
  // (as the drawing takes over from the render (how far, from the mask), the lines come up: heavier, and at creases as
  // well as folds; on the land too, its ledges and banks, a little lighter, broken)
  float drawn = uBleed < .5 ? 0. : m > .405 && m < .545 ? clamp((m - .41) / .13, 0., 1.) : m > .1 && m < .4 ? clamp((m - .12) / .26, 0., 1.) : 0.;
  float fold = smoothstep(.04, .14, lap), crease = smoothstep(.3, .6, turn);
  float wt = (furOn > .5 ? .4 : mix(.16, .8, drawn)) * fold * (1. - onLand) + crease * drawn * .6 * (1. - onLand);
  wt = max(wt, onLand * smoothstep(.15, .6, drawn) * max(fold, smoothstep(.1, .3, turn)) * .32);
  o = vec4(mix(mix(c, ink * 1.6, max(wt * (1. - step(.5, skyN)), rim * .8)), vec3(.69, .36, .12), ring * .9), 1.);
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
export function camera(v: View, aspect: number): { vp: M4; eye: number[]; dir: number[]; range: number; rot: Float32Array } {
  const d = [Math.cos(v.el) * Math.sin(v.az), Math.sin(v.el), Math.cos(v.el) * Math.cos(v.az)], R = 120;
  const eye = [v.target[0] + d[0] * R, v.target[1] + d[1] * R, v.target[2] + d[2] * R];
  const h = v.zoom, w = h * aspect, V = lookAt(eye, v.target, [0, 1, 0]);
  // (its turn alone: the world's directions into the camera's own, across, up and toward the eye)
  const rot = new Float32Array([V[0], V[1], V[2], V[4], V[5], V[6], V[8], V[9], V[10]]);
  return { vp: mul(ortho(-w, w, -h, h, 1, 4 * R), V), eye, dir: [-d[0], -d[1], -d[2]], range: 4 * R - 1, rot };
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
  /**
   * How far each point of the land is from anything built (cells, 16 at most, as a byte over the box in the scene it
   * covers (x0, z0, x1, z1)): bleeding, the picture gathers round what's built and the land's given back to the paper
   * away from it (`focus`)
   */
  private focusTex: WebGLTexture | null = null; private focusBox: [number, number, number, number] = [-1e3, -1e3, 1e3, 1e3];
  focus(field: Uint8Array, w: number, h: number, box: [number, number, number, number]) {
    const gl = this.gl;
    if (!this.focusTex) this.focusTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.focusTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, field);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.focusBox = box;
  }
  private bindFocus(prog: WebGLProgram) {
    const gl = this.gl;
    if (!this.focusTex) this.focus(new Uint8Array([0]), 1, 1, [-1e3, -1e3, 1e3, 1e3]);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.focusTex);
    gl.uniform1i(gl.getUniformLocation(prog, 'uFocus'), 5); gl.uniform4fv(gl.getUniformLocation(prog, 'uFocusBox'), this.focusBox);
  }
  /** how high it's built (the sun's view reaches over it) */
  top = 8;
  /** (for looking at it: the sun's shadows, or none) */
  shadows = true;
  /** what can be switched off to see what it costs (main.ts's profile sweep): the contact shade, the leaves' cutting */
  contact = true; leafCut = true;
  /** the sun's map read two ways: compared by the hardware (filtered), and raw (for how far the casters are) */
  private sCompare: WebGLSampler; private sRaw: WebGLSampler;
  /**
   * What drawing costs, measured (main.ts copies it out on a double tap on the title): the GPU's own time for each pass,
   * where the browser lets it be timed (EXT_disjoint_timer_query_webgl2; Safari doesn't), averaged over the last frames
   * it's come back for; and the CPU's time handing each frame over.
   */
  timing = { gpu: null as null | { shadow: number; main: number; post: number; frames: number }, cpuDraw: 0, frames: 0 };
  private timer: { ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }; pending: Array<{ q: WebGLQuery[] }>; sum: number[]; n: number } | null = null;
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
    const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (tq) this.timer = { ext: tq as unknown as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }, pending: [], sum: [0, 0, 0], n: 0 };
    this.shadowTex = this.depthTex(2048, 2048);
    this.sCompare = gl.createSampler()!; this.sRaw = gl.createSampler()!;
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE], [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL]]) gl.samplerParameteri(this.sCompare, k, v);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.samplerParameteri(this.sRaw, k, v);
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
  /** the vertices drawn: the stone's (fixed till it changes), and what moves */
  get counts() { return { stone: this.count, moving: this.dcount }; }
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
  private builtMsaa = true;
  private targets(w: number, h: number) {
    if (this.size[0] === w && this.size[1] === h && this.fb && this.builtMsaa === this.msaa) return;
    this.builtMsaa = this.msaa;
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
  /** how much of the world a texel of the sun's map covers, and the depth of its range (set by `lightVP`) */
  private shadowTexel = 0.015; private shadowRange = 30;
  /**
   * The sun's view: square on to it, over what's in the picture (the slab, or as much of it as the camera sees, and a
   * little round it for what casts into it), as high as it can be built; its frame stepped a whole texel at a time as the
   * camera moves, so the shadows' edges don't crawl.
   */
  private lightVP(view: View, aspect: number): M4 {
    const [ax, az, e] = this.area, top = Math.max(4, this.top + 2), s = this.sun;
    // (what the camera sees on the ground: as wide as the picture, and as deep as its height looking down at el)
    const seen = Math.hypot(view.zoom * aspect, view.zoom / Math.max(0.3, Math.sin(view.el))) + 2;
    const all = e * 1.42, fit = seen < all;
    const c = fit ? [view.target[0], top / 2, view.target[2]] : [ax, top / 2, az];
    const r = Math.hypot(fit ? seen : all, top / 2) + 1;
    // (the sun's frame, fixed; the middle put in it, and stepped to the texel)
    const V = lookAt([s[0] * 60, s[1] * 60, s[2] * 60], [0, 0, 0], [0, 1, 0]);
    const px = V[0] * c[0] + V[4] * c[1] + V[8] * c[2] + V[12], py = V[1] * c[0] + V[5] * c[1] + V[9] * c[2] + V[13], pz = V[2] * c[0] + V[6] * c[1] + V[10] * c[2] + V[14];
    const tx = (2 * r) / 2048, sx = Math.round(px / tx) * tx, sy = Math.round(py / tx) * tx, rr = r + 2;
    this.shadowTexel = tx; this.shadowRange = 2 * rr;
    return mul(ortho(sx - r, sx + r, sy - r, sy + r, -pz - rr, -pz + rr), V);
  }
  /** the GPU's times come back a few frames late: those that have, summed (and their queries let go) */
  private collect() {
    const gl = this.gl, T = this.timer!;
    while (T.pending.length) {
      const f = T.pending[0];
      if (!gl.getQueryParameter(f.q[2], gl.QUERY_RESULT_AVAILABLE)) break;
      T.pending.shift();
      const ok = !gl.getParameter(T.ext.GPU_DISJOINT_EXT);
      f.q.forEach((q, k) => { if (ok) T.sum[k] += (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6; gl.deleteQuery(q); });
      if (ok) T.n++;
    }
    if (T.n >= 30) { this.timing.gpu = { shadow: T.sum[0] / T.n, main: T.sum[1] / T.n, post: T.sum[2] / T.n, frames: T.n }; T.sum = [0, 0, 0]; T.n = 0; }
  }
  draw(view: View, time: number, dpr: number) {
    const t0 = performance.now();
    const gl = this.gl, cv = this.canvas, w = cv.width, h = cv.height;
    const T = this.timer, qs: WebGLQuery[] = [];
    if (T) this.collect();
    const timed = !!T && T.pending.length < 6, begin = () => { if (!timed) return; const q = gl.createQuery()!; gl.beginQuery(T!.ext.TIME_ELAPSED_EXT, q); qs.push(q); }, end = () => { if (timed) gl.endQuery(T!.ext.TIME_ELAPSED_EXT); };
    this.targets(w, h);
    const cam = camera(view, w / h), light = this.lightVP(view, w / h);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
    // (the sun's depths)
    begin();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb); gl.viewport(0, 0, 2048, 2048);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shadow);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.shadow, 'uVP'), false, light);
    gl.uniform1f(gl.getUniformLocation(this.shadow, 'uTime'), time);
    gl.uniform1f(gl.getUniformLocation(this.shadow, 'uLeafCut'), this.leafCut ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.shadow, 'uBleed'), this.bleed ? 1 : 0); gl.uniform4fv(gl.getUniformLocation(this.shadow, 'uLand'), this.landBox); this.bindFocus(this.shadow);
    gl.cullFace(gl.FRONT);
    gl.bindVertexArray(this.vao);
    if (this.shadows) { gl.drawArrays(gl.TRIANGLES, 0, this.count); if (this.dcount) { gl.bindVertexArray(this.dvao); gl.drawArrays(gl.TRIANGLES, 0, this.dcount); gl.bindVertexArray(this.vao); } }
    gl.cullFace(gl.BACK);
    end(); begin();
    // (the stone, lit)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ms ?? this.fb); gl.viewport(0, 0, w, h);
    gl.clearBufferfv(gl.COLOR, 0, [0.94, 0.91, 0.85, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.main);
    const U = (n: string) => gl.getUniformLocation(this.main, n);
    gl.uniformMatrix4fv(U('uVP'), false, cam.vp); gl.uniformMatrix4fv(U('uLight'), false, light);
    gl.uniform1f(U('uTime'), time); gl.uniform3fv(U('uSun'), this.sun); gl.uniform3fv(U('uEye'), cam.eye); gl.uniform3fv(U('uDir'), cam.dir); gl.uniform1f(U('uN'), 12); gl.uniform3fv(U('uArea'), this.area); gl.uniform1f(U('uShadows'), this.shadows ? 1 : 0); gl.uniform1f(U('uBleed'), this.bleed ? 1 : 0); gl.uniform4fv(U('uLand'), this.landBox); this.bindFocus(this.main);
    gl.uniform1f(U('uTexel'), this.shadowTexel); gl.uniform1f(U('uDepthRange'), this.shadowRange);
    gl.uniform1f(U('uLeafCut'), this.leafCut ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.bindSampler(0, this.sCompare); gl.uniform1i(U('uShadow'), 0);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.bindSampler(3, this.sRaw); gl.uniform1i(U('uShadowRaw'), 3);
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
    end(); begin();
    gl.bindSampler(0, null); gl.bindSampler(3, null);
    // (ink, and paper)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.post);
    const P = (n: string) => gl.getUniformLocation(this.post, n);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.col); gl.uniform1i(P('uCol'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.nrm); gl.uniform1i(P('uNrm'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.dep); gl.uniform1i(P('uDepth'), 2);
    gl.uniform2f(P('uPx'), 1 / w, 1 / h); gl.uniform1f(P('uRange'), cam.range); gl.uniform1f(P('uPrint'), this.print ? 1 : 0); gl.uniform1f(P('uDpr'), dpr); gl.uniform1f(P('uBleed'), this.bleed ? 1 : 0);
    gl.uniform1f(P('uWorldPx'), (2 * view.zoom) / h); gl.uniform1f(P('uContact'), this.contact ? 1 : 0);
    gl.uniformMatrix3fv(P('uViewRot'), false, cam.rot);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    end();
    if (timed && qs.length === 3) T!.pending.push({ q: qs });
    this.timing.cpuDraw = this.timing.cpuDraw * 0.95 + (performance.now() - t0) * 0.05; this.timing.frames++;
    return cam;
  }
}
