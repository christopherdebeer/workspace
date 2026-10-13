/**
 * Taohua: the drawing, as a print. The scene is drawn into two images at once (its colours, flat
 * as inks, lit only a little; and, for each pixel, which way its surface faces and what it's made
 * of) with its depth; then a last pass over the screen draws it as printed on paper: ink lines
 * where one thing stands in front of another or a surface turns sharply (coral, not black, about
 * the blossom), the paper's cream and its fibres and grain under everything, and the far hill
 * fading into the paper.
 *
 * The blossom is puffs: each a disc turned to the eye, its edge ragged, its depth a dome so puffs
 * meet as clouds do, stippled with lighter and darker pinks and a fleck of red; petals are little
 * teardrops, lying on the ground or turning as they fall.
 */
import { INK, M, STRIDE } from './world';

export type V3 = [number, number, number];
/** how far a limb inside its own crown is drawn toward the eye: not at all. Limbs show where the tree's growth and its blossom's density leave them open, and never through a crown in front */
export let REVEAL = 0;
export const setReveal = (k: number) => { REVEAL = k; };
export type M4 = Float32Array;

const COMMON = `
float hash3(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
const vec3 PAPER = vec3(${INK.paper.map((v) => v.toFixed(3)).join(', ')});
const vec3 L = normalize(vec3(.55, .75, -.35));
`;

const SOLID_VS = `#version 300 es
in vec3 aPos; in vec3 aNor; in vec3 aCol; in float aMat;
uniform mat4 uVP, uModel; uniform vec3 uEye, uRight, uUp; uniform float uReveal;
out vec3 vW; out vec3 vN; out vec3 vC; flat out int vM;
void main() {
  vec4 w = uModel * vec4(aPos, 1.);
  vC = aCol; vM = int(aMat + .5);
  if (vM == ${M.type}) {
    // (a cast's words: a sheet standing at its place on the hill, always facing the eye; its
    // position there, and each corner's offset across and up the sheet, in place of a normal)
    w.xyz += uRight * aNor.x + uUp * aNor.y;
    vN = normalize(uEye - w.xyz);
  } else vN = normalize(mat3(uModel) * aNor);
  vW = w.xyz;
  // (a limb drawn nearer the eye by as far as it lies inside its own crown: it shows through its own blossom, as ink over colour, but not through anything else)
  if (vM == ${M.twig}) w.xyz += normalize(uEye - w.xyz) * min(aCol.r * uReveal, .6);
  gl_Position = uVP * w;
}`;
const SOLID_FS = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vC; flat in int vM;
uniform vec3 uEye; uniform sampler2D uPlaque, uType; uniform float uTime;
layout(location = 0) out vec4 oC;
layout(location = 1) out vec4 oA;
${COMMON}
/**
 * A field of brush strokes, as the prints draw water: in rows (across p.y), each row broken into
 * strokes along p.x, staggered; each stroke a short wavy mark, tapered to a hair at both ends,
 * undulating once or twice, its length, weight and tone its own. rs: the rows' spacing (m); len:
 * a stroke's length, about (m); dens: how many are drawn (0-1); fy: metres to a pixel across the
 * rows; thin: how much of its weight it keeps here (0-1). Returns its ink (0-1).
 */
float strokes(vec2 p, float rs, float len, float dens, float seed, float fy, float thin, float wv, float dry) {
  float rv = p.y / rs, row = floor(rv);
  float L = len * mix(.6, 1.5, hash3(vec3(row, seed, 2.3)));
  float sx = p.x / L + hash3(vec3(row, seed, 7.1)) * 13.;
  float seg = floor(sx), t = fract(sx);
  vec3 id = vec3(row * 1.37, seg * .71, seed);
  if (hash3(id + 1.3) > dens) return 0.;
  // (it takes only part of its place along the row: a gap before it, and after)
  float a0 = hash3(id + 2.1) * .35, a1 = 1. - hash3(id + 3.7) * .35;
  float u = (t - a0) / (a1 - a0);
  if (u <= 0. || u >= 1.) return 0.;
  float k = hash3(id + 4.9) < .65 ? 1. : 2.;
  float y0 = .5 + (hash3(id + 5.3) - .5) * .36;
  float wav = wv * (.6 + .8 * hash3(id + 6.1)) * sin(6.2832 * (k * u + hash3(id + 7.7)));
  float px = abs(fract(rv) - y0 - wav) * rs / max(fy, 1e-5);
  // (its weight swells toward its middle, a little past it, as a brush presses and lifts)
  float w = mix(.3, 1.35, hash3(id + 8.3)) * pow(sin(3.14159 * pow(u, .85)), 1.1) * thin;
  // (a dry brush: the stroke breaks, here and there, along its length)
  float br = dry > 0. ? step(dry, noise(vec3(p.x * 2.4 / len, row * 3.1, seed + 17.))) : 1.;
  return (1. - smoothstep(w, w + .8, px)) * mix(.5, 1., hash3(id + 9.9)) * br;
}
/** A stipple of foam: in cells so wide (m), a dot in so many of them (amt), and here and there a tiny ring; fpx: metres to a pixel. */
float stipple(vec2 p, float cell, float amt, float fpx) {
  if (amt <= 0.) return 0.;
  vec2 c = floor(p / cell), f = fract(p / cell);
  vec3 id = vec3(c * vec2(1.31, .77), 31.);
  if (hash3(id) > amt) return 0.;
  vec2 o = .25 + .5 * vec2(hash3(id + 1.1), hash3(id + 2.3));
  float d = length(f - o) * cell / fpx, rr = mix(.5, 1.4, hash3(id + 3.7));
  if (hash3(id + 4.1) < .2) return (1. - smoothstep(.35, 1., abs(d - rr - 1.6))) * .85;
  return 1. - smoothstep(rr, rr + .8, d);
}
void main() {
  vec3 n = normalize(vN);
  // (each face lit from the side it's seen from, whichever way it was wound)
  bool under = dot(n, uEye - vW) < 0.;
  if (under) n = -n;
  vec3 c = vC;
  float lit = .9 + .14 * max(dot(n, L), 0.);
  // (few inks, flat, as a block prints: the paper; one grey for strokes and shade; pale stone and its
  // one darker face; rock in three; nothing mottled but the paper itself)
  vec3 GREY = vec3(.62, .58, .53);
  if (vM == ${M.ground} || vM == ${M.shade}) {
    // the ground: the paper itself
    c = PAPER;
    float rag = noise(vW * 1.3) * .5 + noise(vW * 2.6) * .2;
    if (vM == ${M.ground} && vC.b <= 0. && vC.g > .32 + rag) {
      // (where it's cut deep for water, the banks are rock walls, as the prints wash them: a grey wash,
      // paler where it faces the light, deeper turned from it, mottled; dry strokes dragged down it;
      // an ink line along its top, where the cut begins)
      vec3 nf = normalize(cross(dFdx(vW), dFdy(vW)));
      if (nf.y < 0.) nf = -nf;
      float toL = dot(normalize(nf.xz + 1e-4), normalize(L.xz));
      c = nf.y > .8 ? vec3(.68, .66, .62) : mix(vec3(.4, .39, .38), vec3(.6, .58, .55), smoothstep(-.4, .5, toL));
      c *= .92 + .12 * noise(vW * 1.4);
      vec2 along = normalize(vec2(-nf.z, nf.x) + 1e-4);
      vec2 pw = vec2(-vW.y, dot(vW.xz, along));
      float drag = strokes(pw, .16, 1.1, .5, 12., max(fwidth(pw.y), 1e-5), nf.y > .8 ? 0. : 1., .03, .3);
      c = mix(c, vec3(.2, .19, .18), drag * .85);
      float rimD = (vC.g - .32 - rag) / max(fwidth(vC.g), 1e-4);
      c = mix(c, vec3(.13, .12, .11), (1. - smoothstep(1.2, 2.2, rimD)) * .9);
      lit = 1.;
    } else
    if (vM == ${M.ground} && vC.b <= 0. && vC.g <= .32 + rag) {
      // (a bank, where the ground's cut or filled steeper than the hill: short grey strokes down it,
      // close where it's steep, as the prints hatch a bank)
      vec3 nf = normalize(cross(dFdx(vW), dFdy(vW)));
      if (nf.y < 0.) nf = -nf;
      float steep = smoothstep(.93, .7, nf.y);
      if (steep > 0.) {
        vec2 fall = normalize(nf.xz + 1e-4), con = vec2(-fall.y, fall.x);
        vec2 ph = vec2(dot(vW.xz, fall) * 1.3 - vW.y, dot(vW.xz, con));
        float h = strokes(ph, .2, .8, .12 + .4 * steep, 15., max(fwidth(ph.y), 1e-5), .75, .015, 0.);
        c = mix(c, GREY, h * .8 * smoothstep(.0, .5, steep));
      }
    }
    if (vC.b <= 0. && vC.r > 0.) {
      // (along a trail, a few strokes of grey, as the brush went along it: a worn way)
      float st = step(.7, noise(vec3(vW.x * 1.3, vW.z * 11., 1.))) * step(.45, noise(vW * .8));
      if (st * vC.r > .5) c = GREY;
    }
    if (vC.b > 0.) {
      // (a patch of shade: grey laid on in strokes across, as a dry brush does, thinning out toward its edge)
      float r = length(vC.rg) * (1. + .3 * (noise(vW * 1.7) - .5));
      float f = 1. - smoothstep(.2, 1., r);
      float st = noise(vec3(vW.x * 1.1, vW.z * 9., 2.)) * .75 + noise(vec3(vW.x * 4., vW.z * 24., 5.)) * .25;
      if (st < 1. - f * 1.15) discard;
      c = mix(PAPER, GREY, min(1., vC.b * 3.));
    }
    lit = 1.;
  } else if (vM == ${M.grass}) {
    lit = 1.;
  } else if (vM == ${M.earth}) {
    // trodden ground: the paper, a few grey strokes across it
    c = PAPER;
    if (step(.72, noise(vec3(vW.x * 1.3, vW.z * 11., vW.y * 3.))) * step(.45, noise(vW * .9)) > .5) c = GREY;
    lit = 1.;
  } else if (vM == ${M.step}) {
    // a slab: its top pale, now and then a stroke of grey along it; its faces one darker stone
    if (n.y > .5) {
      c = vec3(.96, .94, .89);
      if (step(.8, noise(vec3(vW.x * 1.6, vW.z * 13., vW.y * 9.))) > .5) c = mix(c, GREY, .6);
    } else c = vec3(.66, .61, .54);
    lit = 1.;
  } else if (vM == ${M.stone}) {
    // stone: a wall's face laid in squared blocks, its joints dark; tops pale
    if (abs(n.y) < .5) {
      c = vec3(.74, .7, .64);
      float row = vW.y / .3, course = floor(row);
      float along = (vW.x * n.z - vW.z * n.x) / .55 + course * .5;
      float joint = max(step(min(fract(row), 1. - fract(row)), .05), step(min(fract(along), 1. - fract(along)), .035));
      c = mix(c, vec3(.36, .32, .28), joint);
    } else c = vec3(.94, .92, .87);
    lit = 1.;
  } else if (vM == ${M.rock}) {
    // rock: flat inks by which way each face turns: black from the light, charcoal to it, grey on
    // top; small dark pits pocking it
    float toL = dot(normalize(n.xz + 1e-4), normalize(L.xz));
    c = n.y > .62 ? vec3(.4, .39, .38) : toL > -.05 ? vec3(.25, .25, .24) : vec3(.1, .1, .1);
    vec3 pc = floor(vW * 7.);
    vec3 pf = fract(vW * 7.) - .5 - (vec3(hash3(pc), hash3(pc + 3.), hash3(pc + 7.)) - .5) * .5;
    if (hash3(pc + 11.) > .8 && length(pf) < .09) c *= .4;
    lit = 1.;
  } else if (vM == ${M.trunk} || vM == ${M.twig}) {
    c = vec3(${INK.trunk.map((v) => v.toFixed(3)).join(', ')});
    // bark: ink, a pale streak down the side that faces the light, broken
    // (hard edged, as cut in a block: a band of the paper's cream down the lit side, broken along its length)
    float side = dot(n, normalize(vec3(.85, .1, -.5)));
    float streak = smoothstep(.56, .62, side) * smoothstep(.22, .3, noise(vW * vec3(1.6, .5, 1.6) + 7.));
    c = mix(c, vec3(.89, .84, .76), streak);
    lit = 1.;
  } else if (vM == ${M.tile} || vM == ${M.ridge}) {
    // glazed tiles, turquoise: every tile drawn
    vec3 gap = vec3(.09, .3, .27), body = vec3(.2, .56, .52), lite = vec3(.36, .74, .68), gloss = vec3(.55, .84, .78);
    if (vC.b > 2.5) {
      // the eaves' edge: a row of round tile-ends on the dark of the eave
      vec2 q = vec2(fract(vC.r) - .5, vC.g - .42);
      float r = length(q * vec2(1., 1.25));
      c = gap * .8;
      if (r < .4) c = mix(body, lite, smoothstep(.3, .05, length(q - vec2(-.08, -.1))));
      if (r > .33 && r < .4) c = gap;
      if (vC.g > .88) c = gap * .7;
    } else if (vC.b > 1.5) {
      // a roof: barrel tiles in rows running down the slope, each a short round segment lapping the
      // next; the gap between rows dark; a gloss down each row's crown
      float ch = fract(vC.r), row = vC.g;
      float across = (ch - .5) / .36;
      float crown = 1. - across * across;
      // (each tile's lower end a curve, lapping the one below)
      float seg = fract(row + .18 * across * across);
      c = crown > 0. ? mix(body, lite, smoothstep(.0, .8, crown)) : gap;
      if (crown > 0.) {
        c = mix(c, gloss, smoothstep(.75, .95, crown) * smoothstep(.15, .6, seg) * .8);
        c = mix(c, gap, smoothstep(.12, .0, seg) * .85);
        c *= .92 + .1 * seg;
      }
      c *= .95 + .08 * noise(vW * 3.);
    } else {
      float course = smoothstep(.0, .12, fract(vW.y * 5.5)) * smoothstep(.0, .1, fract(dot(vW.xz, vec2(.7071)) * 3.5));
      c *= mix(.7, 1.05, course);
    }
    if (under) c *= .62;
    lit = .9 + .2 * max(dot(n, L), 0.);
  } else if (vM == ${M.plaque}) {
    c = texture(uPlaque, vC.rg).rgb;
    lit = 1.;
  } else if (vM == ${M.water}) {
    // water, as the prints draw it: the paper itself, and lines, of a kind for each state of it.
    // Still (a pool, a marsh): long, nearly straight lines across, closer by the shore. Gentle (a
    // stream that runs slowly): long low waves along it, close, parallel to its banks. Rapid (where it
    // runs fast): short choppy waves, two sets crossing. Falling (a fall, a cascade's lip): lines down
    // it, of varied length. Foam (at a fall's foot, below a cascade, in fast water): a stipple of dots
    // and tiny rings. Its bank: a fine line of ink along the shore, broken.
    // (vC: how far in from its edge; across from a stream's middle; its kind, and after the point how
    // fast it runs. Its normal, where it's level: up, leaning by how much foam there is.)
    float inn = vC.r, across = vC.g;
    int kind = int(floor(vC.b + .001));
    float run = fract(vC.b + .001);
    vec3 nn = normalize(vN);
    bool fall = abs(nn.y) < .55, lip = !fall && abs(nn.y) < .9;
    float foamAmt = lip || fall ? 0. : clamp(vN.x / max(abs(vN.y), .2), 0., 1.);
    // (its shore: where it's no way in from its edge, it isn't)
    if (inn < 0. && !fall) discard;
    vec3 LINE = vec3(.22, .24, .25), BANK = vec3(.13, .12, .11);
    float ink = 0., bank = 0.;
    float fpx = max(length(fwidth(vW.xz)), 1e-4) * .7;
    if (fall || lip) {
      // (falling: lines down it, of varied length, wavering a little, running down)
      vec2 p = vec2((fall ? -vW.y : vW.z * 1.4) - uTime * .9, vW.x * .8 + vW.z * .6);
      ink = .85 * strokes(p, .1, fall ? 1.5 : .7, .62, 3., fwidth(p.y), .8, .02, 0.);
    } else {
      float t = uTime * (kind == 0 ? .12 + run * 1.4 : .015), fast = smoothstep(.13, .26, run);
      float grp = noise(vec3(vW.xz * .2, 8.)), shore = 1. - smoothstep(.15, 1., inn);
      // (each thins to nothing at the shore, so none's cut off by it)
      float thin = smoothstep(.0, .25, inn);
      if (kind == 0 || kind == 3) {
        vec2 p = vec2(vW.z + t, across);
        float fy = fwidth(across);
        // gentle: long low waves along it, close together, a finer second set between
        float dens = .55 + .15 * shore + (grp - .5) * .3;
        float gentle = strokes(p, .12, 3.6, dens, 1., fy, thin * .85, .035, .3);
        gentle = max(gentle, .6 * strokes(p + vec2(3.1, .06), .19, 1.6, dens * .6, 2., fy, thin * .6, .05, 0.));
        // rapid: short choppy waves, two sets at a slant to each other, crossing
        vec2 pa = mat2(.976, -.22, .22, .976) * p, pb = mat2(.976, .22, -.22, .976) * p;
        float rapid = max(strokes(pa, .1, .55, .62, 6., fy, thin, .16, 0.), .8 * strokes(pb + vec2(1.7, .05), .12, .45, .5, 7., fy, thin * .8, .18, 0.));
        ink = mix(gentle, rapid, fast);
        foamAmt = max(foamAmt, .22 * smoothstep(.2, .32, run) * smoothstep(.45, .65, noise(vec3(vW.xz * .7, 23.))));
      } else {
        // still: long, nearly straight lines across it, far apart out on it, closer by its shore
        vec2 p = vec2(vW.x + t, vW.z);
        float fy = fwidth(vW.z);
        float dens = .16 + .5 * shore + (grp - .5) * .3;
        ink = strokes(p, .24, 3.4, dens, 5., fy, thin * .9, .008, .22);
        ink = max(ink, .55 * strokes(p + vec2(2.3, .11), .24, 1.4, dens * .5, 9., fy, thin * .7, .012, 0.));
      }
      // foam: a stipple of dots, and here and there a tiny ring
      ink = max(ink, stipple(vW.xz, .1, foamAmt * .75 * smoothstep(.25, .55, noise(vec3(vW.xz * 1.6, 24.)) + foamAmt * .4), fpx));
      // the bank: a fine line of ink along the shore, as a brush draws it, swelling a little, broken
      // now and then; a hairline echo inside it, now and then
      float wi = max(fwidth(inn), 1e-4);
      float nb = noise(vec3(vW.xz * .55, 4.)), gap = noise(vec3(vW.xz * 1.7, 11.));
      float notch = smoothstep(.45, .6, noise(vec3(vW.xz * 1.1, 13.))) * .04;
      float lw = mix(.3, 1.5, smoothstep(.3, .85, nb));
      bank = (1. - smoothstep(lw, lw + .8, (inn - notch) / wi)) * step(.38, gap);
      float e1 = abs(inn - .15 - .04 * sin(vW.x * 2.7 + vW.z * 1.9)) / wi;
      ink = max(ink, (1. - smoothstep(.3, 1., e1)) * step(.6, noise(vec3(vW.xz * 1.2, 14.))) * .45);
    }
    c = mix(PAPER, LINE, ink);
    c = mix(c, BANK, bank * .85);
    lit = 1.;
  } else if (vM >= ${M.ripple} && vM <= ${M.archReflect}) {
    // marks on water about what stands in it or over it: (vC: where, in its own measure; how far in
    // from the water's edge).
    if (vC.b < .03) discard;
    vec2 q = vC.rg;
    float a = 0.;
    vec3 col = vec3(.24, .26, .27);
    float r = length(q), fr = max(fwidth(r), 1e-4), ang = atan(q.y, q.x);
    if (vM == ${M.ripple} || vM == ${M.ring}) {
      // ripples: rings hugging what stands in the water, broken, the outer ones fainter (a petal,
      // one ring); and, under a rock, a short dark stroke where it meets the water
      int n = vM == ${M.ring} ? 1 : 3;
      for (int i = 0; i < 3; i++) {
        if (i >= n) break;
        float R = 1. + float(i) * .27 + .05 * sin(ang * 3. + float(i));
        float on = step(.36 + float(i) * .1 + (vM == ${M.ring} ? .12 : 0.), noise(vec3(cos(ang) * 2.2, sin(ang) * 2.2, float(i) * 3.7 + vW.x)));
        a = max(a, (1. - smoothstep(.4, 1.2, abs(r - R) / fr)) * on * (1. - float(i) * .25));
      }
      if (vM == ${M.ripple}) {
        float under = smoothstep(-.2, -.6, q.y / max(r, 1e-3)) * (1. - smoothstep(1.1, 2.4, abs(r - .9) / fr));
        if (under > .05) { col = vec3(.12, .11, .1); a = max(a, under); }
      }
    } else if (vM == ${M.eddy}) {
      // an eddy: a small spiral, drawn in, broken
      float sp = r / .28 - ang / 6.2832;
      float d = abs(fract(sp) - .5) / max(fwidth(sp), 1e-4);
      a = (1. - smoothstep(.4, 1.2, d)) * (1. - smoothstep(.7, 1., r)) * step(.3, noise(vec3(q * 3., 21.))) * .9;
    } else {
      // reflections: (q.x across, -1 to 1; q.y down from its foot, 0 to 1) in columns down from its
      // foot, each a broken stroke, thin, waving a little; fewer and fainter as they go down
      float fx = max(fwidth(q.x), 1e-4);
      float col0 = q.x * 4.5 + .25 * sin(q.y * 11. + q.x * 3.);
      float d = abs(fract(col0) - .5) / (fx * 4.5);
      float w = mix(.4, 1.3, hash3(vec3(floor(col0), 3., 1.)));
      float comb = step(.5 + .3 * q.y, noise(vec3(floor(col0) * 1.3, q.y * 7., 2.)));
      float fade = (1. - smoothstep(.15, 1., q.y)) * (1. - smoothstep(.5, 1., abs(q.x)));
      if (vM == ${M.archReflect}) {
        // (a stone arch's: its face mirrored below it, round its opening's mirror, so the two make a ring)
        float e = length(vec2(q.x / .78, (q.y - .02) / .72));
        fade = (1. - smoothstep(.25, 1., q.y)) * (1. - smoothstep(.85, 1., abs(q.x))) * smoothstep(.98, 1.04, e);
        float ring = 1. - smoothstep(.8, 1.8, abs(e - 1.) / max(fwidth(e), 1e-4));
        a = max((1. - smoothstep(w, w + .8, d)) * comb * fade, ring * .9 * step(.25, noise(vec3(q * 6., 5.))));
        col = vec3(.3, .3, .3);
      } else {
        a = (1. - smoothstep(w, w + .8, d)) * comb * fade * step(hash3(vec3(floor(col0), 9., 4.)), .75);
        if (vM == ${M.reflectPink}) { col = vec3(.88, .6, .56); a *= .6; } else { col = vec3(.34, .34, .34); a *= .8; }
      }
    }
    if (a < .05) discard;
    c = mix(PAPER, col, a);
    lit = 1.;
  } else if (vM == ${M.type}) {
    // (a cast's words, inked on the hillside: from the sheet of words, or a stroke of ink or vermilion;
    // where there's no ink, the hill)
    vec4 t = vC.b > 1.5 ? vec4(.72, .22, .17, 1.) : vC.b > .5 ? vec4(.17, .14, .125, 1.) : texture(uType, vC.rg);
    if (t.a < .45) discard;
    c = t.rgb;
    lit = 1.;
  } else if (vM == ${M.wall} || vM == ${M.red}) {
    c *= .97 + .04 * noise(vW * 6.);
  }
  c *= lit;
  // (far off, it fades into the paper)
  float d = length(vW - uEye);
  c = mix(c, PAPER, smoothstep(85., 150., d) * .55);
  oC = vec4(c, 1.);
  oA = vec4(n * .5 + .5, float(vM) / 31.);
}`;

/** a blossom puff: a disc to the eye, a dome in depth, its edge ragged, stippled */
const PUFF_VS = `#version 300 es
in vec2 aQ;
in vec3 iPos; in float iRad; in float iShade; in float iSeed;
uniform mat4 uVP; uniform vec3 uRight, uUp;
out vec2 vQ; flat out vec3 vP; flat out float vR, vS, vSeed;
void main() {
  // Unequal broad lobes within a crown, sharing one stable tree seed.
  float shape = fract(sin(dot(iPos, vec3(12.9898, 4.1414, 78.233))) * 43758.5453);
  vQ = aQ * 1.18 * vec2(1.05 + .22 * shape, .76 + .16 * shape);
  vP = iPos; vR = iRad; vS = iShade; vSeed = iSeed;
  gl_Position = uVP * vec4(iPos + (uRight * vQ.x + uUp * vQ.y) * iRad, 1.);
}`;
const PUFF_FS = `#version 300 es
precision highp float;
in vec2 vQ; flat in vec3 vP; flat in float vR, vS, vSeed;
uniform mat4 uVP; uniform vec3 uRight, uUp, uFwd, uEye;
layout(location = 0) out vec4 oC;
layout(location = 1) out vec4 oA;
${COMMON}
void main() {
  float shape = fract(sin(dot(vP, vec3(12.9898, 4.1414, 78.233))) * 43758.5453);
  // (a clump right before the eye, as when looking low over the walker's shoulder, thins away in dabs: never a wall of pink)
  float near = smoothstep(2.5, 6., length(vP - uEye));
  if (near < 1. && hash3(vec3(floor(gl_FragCoord.xy / 3.), vSeed * 31.)) > near) discard;
  vec2 shapeQ = vQ / vec2(1.05 + .22 * shape, .76 + .16 * shape);
  float a = atan(shapeQ.y, shapeQ.x), r = length(shapeQ);
  // (its edge: the blossom crumbles away into the paper in little square dabs, as a worn block prints;
  // a few dabs loose beyond it. The dabs are the puff's own, so they stay where they are as the view moves)
  // Irregular scallops at several scales interrupt the circular silhouette.
  float edge = .84 + .11 * noise(vec3(cos(a) * 3.8, sin(a) * 3.8, vSeed * 40.))
    + .065 * sin(a * 7. + vSeed * 19.) + .035 * sin(a * 13. + shape * 11.);
  // Broken undersides leave room for the branches below each spray.
  edge -= .12 * smoothstep(.1, .75, -shapeQ.y) * noise(vec3(shapeQ.x * 8., 2., vSeed * 23.));
  vec2 dab = floor(vQ * vR / .045);
  float hd = hash3(vec3(dab, floor(vSeed * 97.)));
  float lim = edge * (.86 + .2 * hd);
  if (r > lim && !(r < 1.12 && hd > .965)) discard;
  float rr = min(1., r / edge);
  // the dome, where on the tree this fragment is: its tone comes from there, not from the puff
  float z = sqrt(max(0., 1. - rr * rr));
  vec3 w = vP + (uRight * vQ.x + uUp * vQ.y) * vR - uFwd * z * vR * .14;
  // its tone: the puff's place on its crown (lit, high, or under), and over it washes of deeper and
  // paler pink in soft blotches across the whole crown, as watercolour pools
  // Broad wash belongs to the cluster centre, independent of camera orientation.
  // Fine marks remain attached to the illustrated lobe.
  vec3 mark = vP + vec3(vQ.x, vQ.y, 0.) * vR;
  float wash = noise(vP * .55) - .5, wash2 = noise(mark * 1.7 + 4.) - .5;
  // its tone: continuous, not stepped, but with the crown's own structure: pale where it's lit and
  // high, deep under and toward its foot; dappled over that, as the print dabs it, pale dabs in
  // clusters on the lit side, deep recesses in clusters on the shaded
  float tone = clamp(vS + wash * .32 + wash2 * .12, 0., 1.);
  vec3 deep = vec3(.72, .29, .27), lo = vec3(.84, .41, .36), mid = vec3(.92, .52, .45), hi = vec3(.98, .68, .6);
  vec3 c = tone < .5 ? mix(deep, mid, smoothstep(.0, .5, tone)) : mix(mid, hi, smoothstep(.5, 1., tone));
  float dap = noise(mark * 9. + vSeed * 7.), leaf = noise(mark * 19. + vSeed * 3.);
  c = mix(c, hi, smoothstep(.62, .78, dap) * smoothstep(.3, .7, tone) * .55);
  c = mix(c, deep, smoothstep(.36, .2, dap) * smoothstep(.75, .3, tone) * .45);
  c = mix(c, lo, smoothstep(.66, .84, leaf) * .2);
  // Sparse pinholes open the foliage itself, rather than stippling only its outer edge.
  if (hd < .018 && noise(mark * 5.) > .52) discard;
  // its grain: the print's pale flecks, fine, everywhere; a few deeper
  vec2 g = vQ * vR * 18. + vSeed * 17.;
  vec2 cell = floor(g), f = fract(g) - .5;
  float h = hash3(vec3(cell, vSeed * 7.));
  vec2 jit = vec2(hash3(vec3(cell, 3.)), hash3(vec3(cell, 5.))) - .5;
  float dot1 = 1. - smoothstep(.13, .2, length(f - jit * .5));
  if (h > .72) c = mix(c, vec3(1., .8, .73), dot1 * .7);
  else if (h < .06) c = mix(c, deep * .9, dot1 * .6);
  vec4 clip = uVP * vec4(w, 1.);
  gl_FragDepth = clip.z / clip.w * .5 + .5;
  float d = length(w - uEye);
  c = mix(c, PAPER, smoothstep(85., 150., d) * .55);
  oC = vec4(c, 1.);
  vec3 n = normalize(uRight * vQ.x + uUp * vQ.y - uFwd * z);
  oA = vec4(n * .5 + .5, ${M.blossom}. / 31.);
}`;

/** a petal: a little teardrop, lying flat or turning in the air */
const PETAL_VS = `#version 300 es
in vec2 aQ;
in vec3 iPos; in float iSize; in float iTurn; in float iShade; in float iTilt;
uniform mat4 uVP;
out vec2 vQ; flat out float vS;
void main() {
  vQ = aQ; vS = iShade;
  vec2 q = aQ * iSize * (iShade > .5 ? vec2(1.) : vec2(.7, 1.));
  float c = cos(iTurn), s = sin(iTurn);
  vec3 u = vec3(c, 0., s), v = vec3(-s, 0., c);
  // (tilted up out of the ground's plane as it turns in the air)
  v = normalize(v * cos(iTilt) + vec3(0., 1., 0.) * sin(iTilt));
  gl_Position = uVP * vec4(iPos + u * q.x + v * q.y, 1.);
}`;
const PETAL_FS = `#version 300 es
precision highp float;
in vec2 vQ; flat in float vS;
layout(location = 0) out vec4 oC;
layout(location = 1) out vec4 oA;
${COMMON}
void main() {
  vec3 c;
  if (vS > .5) {
    // (a fallen flower, as the print stamps them: a coral-red star of five round lobes, its edge a blot)
    float a = atan(vQ.y, vQ.x), r = length(vQ);
    float lobe = pow(abs(cos(a * 2.5 + vS * 40.)), .7);
    float pet = (.42 + .5 * lobe) * (.88 + .2 * noise(vec3(cos(a) * 3., sin(a) * 3., vS * 50.)));
    if (r > pet) discard;
    float t = noise(vec3(vQ * 3., vS * 30.));
    c = mix(vec3(.76, .3, .26), vec3(.89, .48, .42), smoothstep(.3, .75, t)) * (1. - .12 * smoothstep(.25, 0., r));
  } else {
    // (a petal: round at one end, pointed at the other, a notch in its round end)
    float y = vQ.y * .5 + .5;
    float w = sin(3.1416 * pow(y, .8)) * .95;
    if (abs(vQ.x) > w || (y > .9 && abs(vQ.x) < .12)) discard;
    c = mix(vec3(.78, .3, .27), vec3(.92, .52, .46), vS * 2.);
  }
  oC = vec4(c, 1.);
  oA = vec4(.5, 1., .5, ${M.petal}. / 31.);
}`;

/** the print: ink lines, the paper under it all */
const POST_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`;
const POST_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uC, uA, uD;
uniform vec2 uPx; uniform float uNear, uFar, uLine, uInk; uniform mat4 uIVP;
out vec4 o;
${COMMON}
float lin(float d) { float z = d * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
int matAt(vec2 uv) { return int(texture(uA, uv).a * 31. + .5); }
void main() {
  vec2 px = uPx * uLine;
  float d0 = texture(uD, vUV).r;
  vec3 c = texture(uC, vUV).rgb;
  if (d0 >= 1.) c = PAPER;
  // ink: where depth jumps (one thing before another), where the surface turns, where one thing meets another
  float z0 = lin(d0);
  vec4 a0 = texture(uA, vUV);
  vec3 n0 = a0.xyz * 2. - 1.;
  int m0 = int(a0.a * 31. + .5);
  // the lines, as the print has them: black ink where things stand against each other; on stone a
  // thin line, warm and broken; none about rock or blossom, which stand by their fills alone (only
  // a deeper pink where one crown stands before another)
  float ink = 0., stone = 0., coral = 0.;
  vec2 offs[4] = vec2[4](vec2(px.x, 0.), vec2(-px.x, 0.), vec2(0., px.y), vec2(0., -px.y));
  bool g0 = m0 == ${M.ground} || m0 == ${M.earth} || m0 == ${M.type} || (m0 >= ${M.water} && m0 <= ${M.archReflect}), s0 = m0 == ${M.step} || m0 == ${M.stone};
  for (int i = 0; i < 4; i++) {
    vec2 uv = vUV + offs[i];
    float di = texture(uD, uv).r;
    float zi = di >= 1. ? 1e4 : lin(di);
    vec4 ai = texture(uA, uv);
    vec3 ni = ai.xyz * 2. - 1.;
    int mi = int(ai.a * 31. + .5);
    // (a line is drawn on the nearer side of an edge only, so it's one pixel, not two)
    float jump = smoothstep(.025, .06, (zi - z0) / z0);
    float turn = smoothstep(.35, .6, 1. - dot(n0, ni));
    float meet = mi != m0 && zi >= z0 * .998 ? 1. : 0.;
    if (m0 == ${M.blossom} || mi == ${M.blossom}) { if (m0 == mi) coral = max(coral, jump); continue; }
    if (m0 == ${M.petal} || mi == ${M.petal} || m0 == ${M.grass} || mi == ${M.grass} || m0 == ${M.shade} || mi == ${M.shade}) continue;
    bool gi = mi == ${M.ground} || mi == ${M.earth} || mi == ${M.type} || (mi >= ${M.water} && mi <= ${M.archReflect}), si = mi == ${M.step} || mi == ${M.stone};
    if (g0 && gi) continue;
    if ((m0 == ${M.rock} && (gi || mi == ${M.rock})) || (mi == ${M.rock} && g0)) continue;
    float e = max(jump, max(turn * (g0 ? 0. : .8), meet));
    if ((s0 || g0 || m0 == ${M.rock}) && (si || gi || mi == ${M.rock})) stone = max(stone, e);
    else ink = max(ink, e);
  }
  if (d0 >= 1.) { ink = 0.; coral = 0.; stone = 0.; }
  // (the stone's line broken, as a dry brush leaves it)
  // (where on the hill this is, so the breaks stay with the stone, not the glass)
  vec4 wp = uIVP * vec4(vUV * 2. - 1., d0 * 2. - 1., 1.);
  stone *= smoothstep(.2, .42, noise(wp.xyz / wp.w * 3.));
  c = mix(c, vec3(.64, .25, .23), coral * .32);
  c = mix(c, vec3(.25, .21, .18), stone * .82);
  c = mix(c, vec3(.16, .13, .12), ink * .85);
  if (uInk > .002) {
    // the composition alone, in broad strokes: what covers each part of the print, gathered over a
    // wide brush, then laid down as a few inks. Blossom a grey wash (deeper where it's dense); rock
    // and trunk black; buildings vermilion; the rest paper. (The path and the walker are brushed over
    // it, on the page)
    float fol = 0., drk = 0., arc = 0., wat = 0.;
    const int K = 48;
    for (int i = 0; i < K; i++) {
      float fi = float(i) + .5, r = sqrt(fi / float(K)) * .03, a = fi * 2.39996;
      int m = matAt(vUV + vec2(cos(a) * r * uPx.x / uPx.y, sin(a) * r));
      if (m == ${M.blossom} || m == ${M.twig}) fol += 1.;
      else if (m == ${M.rock} || m == ${M.trunk}) drk += 1.;
      else if (m == ${M.tile} || m == ${M.red} || m == ${M.wall} || m == ${M.plaque} || m == ${M.ridge}) arc += 1.;
      else if (m >= ${M.water} && m <= ${M.archReflect}) wat += 1.;
    }
    wat /= float(K);
    fol /= float(K); drk /= float(K); arc /= float(K);
    // (the brush: its edge wanders, in long strokes across)
    float br = noise(vec3(gl_FragCoord.xy * vec2(.005, .018), 3.)) - .5;
    vec3 cm = PAPER;
    if (fol > .42 + br * .3) cm = vec3(.6, .56, .52);
    if (fol > .82 + br * .2) cm = vec3(.44, .4, .37);
    if (drk > .28 + br * .2) cm = vec3(.12, .11, .1);
    if (wat > .4 + br * .2) cm = vec3(.86, .87, .84);
    if (arc > .22 + br * .15) cm = vec3(.7, .22, .17);
    // (coming in, the print gives way to its masses; going out, the other way)
    c = mix(c, cm, uInk);
  }
  // the paper: its mottle, its fibres, its grain
  vec2 sp = gl_FragCoord.xy;
  float mottle = noise(vec3(sp * .004, 1.)) * .5 + noise(vec3(sp * .013, 2.)) * .3;
  float fibre = smoothstep(.72, .9, noise(vec3(sp.x * .02, sp.y * .35, 3.))) * .5 + smoothstep(.75, .92, noise(vec3(sp.x * .3, sp.y * .025, 4.))) * .5;
  float grain = hash3(vec3(sp, 7.)) - .5;
  c *= .97 + .05 * mottle;
  c = mix(c, c * .93, fibre * .25);
  c += grain * .035;
  // (the print's edge, a shade darker)
  vec2 e = vUV - .5;
  c *= 1. - .1 * smoothstep(.35, .75, length(e * vec2(1.2, 1.)));
  o = vec4(c, 1.);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

export interface Drawn { vao: WebGLVertexArrayObject; bufs: WebGLBuffer[]; count: number }

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private solid: WebGLProgram; private puff: WebGLProgram; private petal: WebGLProgram; private post: WebGLProgram;
  private quadBuf: WebGLBuffer;
  private fb: WebGLFramebuffer | null = null; private texC: WebGLTexture | null = null; private texA: WebGLTexture | null = null; private texD: WebGLTexture | null = null;
  private w = 0; private h = 0;
  plaque: WebGLTexture;
  type: WebGLTexture;
  private u = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no WebGL2');
    this.gl = gl;
    this.solid = compile(gl, SOLID_VS, SOLID_FS);
    this.puff = compile(gl, PUFF_VS, PUFF_FS);
    this.petal = compile(gl, PETAL_VS, PETAL_FS);
    this.post = compile(gl, POST_VS, POST_FS);
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.plaque = gl.createTexture()!;
    this.type = gl.createTexture()!;
  }
  private loc(p: WebGLProgram, name: string) {
    let m = this.u.get(p);
    if (!m) this.u.set(p, (m = new Map()));
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name));
    return m.get(name)!;
  }

  /** the plaque's face, from a canvas */
  setPlaque(src: HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.plaque);
    // (rows counted up from the bottom, as the plaques' uvs count them)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }

  /** the sheet of the casts' words, from a canvas (ink on nothing; rows from the top, as their uvs count them) */
  setType(src: HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.type);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }

  /** What's drawn at a point of the canvas (device pixels from its top left) in the last frame: its material. */
  matAt(x: number, y: number): number {
    const gl = this.gl;
    if (!this.fb) return -1;
    const px = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(Math.round(x), Math.round(this.h - 1 - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return Math.round((px[3] / 255) * 31);
  }

  /** What's drawn where, the whole last frame at once: each pixel's material, rows from the top. */
  mats(): { w: number; h: number; at: (x: number, y: number) => number } | null {
    const gl = this.gl;
    if (!this.fb) return null;
    const px = new Uint8Array(this.w * this.h * 4), w = this.w, h = this.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { w, h, at: (x, y) => { const i = Math.round(x), j = h - 1 - Math.round(y); return i < 0 || j < 0 || i >= w || j >= h ? -1 : Math.round((px[(j * w + i) * 4 + 3] / 255) * 31); } };
  }

  /** A solid mesh (STRIDE floats a vertex). */
  mesh(verts: Float32Array): Drawn {
    const gl = this.gl;
    const vao = gl.createVertexArray()!, buf = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const at = (name: string, size: number, off: number) => {
      const l = gl.getAttribLocation(this.solid, name);
      if (l < 0) return;
      gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, STRIDE * 4, off * 4);
    };
    at('aPos', 3, 0); at('aNor', 3, 3); at('aCol', 3, 6); at('aMat', 1, 9);
    gl.bindVertexArray(null);
    return { vao, bufs: [buf], count: verts.length / STRIDE };
  }
  /** Instances of a quad (puffs: 6 floats each; petals: 7), as the program wants them. */
  instances(kind: 'puff' | 'petal', data: Float32Array, dynamic = false): Drawn {
    const gl = this.gl, p = kind === 'puff' ? this.puff : this.petal;
    const per = kind === 'puff' ? 6 : 7;
    const vao = gl.createVertexArray()!, buf = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    const q = gl.getAttribLocation(p, 'aQ');
    gl.enableVertexAttribArray(q); gl.vertexAttribPointer(q, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    const names = kind === 'puff' ? [['iPos', 3], ['iRad', 1], ['iShade', 1], ['iSeed', 1]] : [['iPos', 3], ['iSize', 1], ['iTurn', 1], ['iShade', 1], ['iTilt', 1]];
    let off = 0;
    for (const [name, size] of names as Array<[string, number]>) {
      const l = gl.getAttribLocation(p, name);
      if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, per * 4, off * 4); gl.vertexAttribDivisor(l, 1); }
      off += size;
    }
    gl.bindVertexArray(null);
    return { vao, bufs: [buf], count: data.length / per };
  }
  update(d: Drawn, data: Float32Array, per: number) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, d.bufs[0]);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    d.count = data.length / per;
  }
  drop(d: Drawn | null) {
    if (!d) return;
    this.gl.deleteVertexArray(d.vao);
    for (const b of d.bufs) this.gl.deleteBuffer(b);
  }

  private targets(w: number, h: number) {
    if (w === this.w && h === this.h && this.fb) return;
    const gl = this.gl;
    this.w = w; this.h = h;
    for (const t of [this.texC, this.texA, this.texD]) if (t) gl.deleteTexture(t);
    if (this.fb) gl.deleteFramebuffer(this.fb);
    const tex = (internal: number, format: number, type: number) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    this.texC = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.texA = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.texD = tex(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    this.fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texC, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.texA, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.texD, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * The frame: the solids (the world's bands, the walker by its own placing), the blossom, the
   * petals; then the print.
   */
  frame(view: { vp: M4; ivp: M4; eye: V3; right: V3; up: V3; fwd: V3; near: number; far: number; dpr: number; ink?: number | boolean; time?: number },
    solids: Array<{ d: Drawn; model?: M4 }>, puffs: Drawn[], petals: Drawn[]) {
    const gl = this.gl, W = this.canvas.width, H = this.canvas.height;
    this.targets(W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, W, H);
    gl.clearBufferfv(gl.COLOR, 0, [...INK.paper, 1]);
    gl.clearBufferfv(gl.COLOR, 1, [0.5, 1, 0.5, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    gl.useProgram(this.solid);
    gl.uniformMatrix4fv(this.loc(this.solid, 'uVP'), false, view.vp);
    gl.uniform3fv(this.loc(this.solid, 'uEye'), view.eye);
    gl.uniform1f(this.loc(this.solid, 'uReveal'), REVEAL);
    gl.uniform3fv(this.loc(this.solid, 'uRight'), view.right);
    gl.uniform3fv(this.loc(this.solid, 'uUp'), view.up);
    gl.uniform1f(this.loc(this.solid, 'uTime'), view.time ?? 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.plaque);
    gl.uniform1i(this.loc(this.solid, 'uPlaque'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.type);
    gl.uniform1i(this.loc(this.solid, 'uType'), 1);
    gl.activeTexture(gl.TEXTURE0);
    for (const s of solids) {
      gl.uniformMatrix4fv(this.loc(this.solid, 'uModel'), false, s.model ?? I);
      gl.bindVertexArray(s.d.vao);
      gl.drawArrays(gl.TRIANGLES, 0, s.d.count);
    }
    gl.useProgram(this.puff);
    gl.uniformMatrix4fv(this.loc(this.puff, 'uVP'), false, view.vp);
    for (const [k, v] of [['uRight', view.right], ['uUp', view.up], ['uFwd', view.fwd], ['uEye', view.eye]] as Array<[string, V3]>) gl.uniform3fv(this.loc(this.puff, k), v);
    for (const p of puffs) { gl.bindVertexArray(p.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, p.count); }
    gl.useProgram(this.petal);
    gl.uniformMatrix4fv(this.loc(this.petal, 'uVP'), false, view.vp);
    for (const p of petals) { gl.bindVertexArray(p.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, p.count); }
    gl.bindVertexArray(null);
    // the print
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.post);
    const tx = [this.texC, this.texA, this.texD];
    ['uC', 'uA', 'uD'].forEach((n, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tx[i]); gl.uniform1i(this.loc(this.post, n), i); });
    gl.uniform2f(this.loc(this.post, 'uPx'), 1 / W, 1 / H);
    gl.uniform1f(this.loc(this.post, 'uNear'), view.near);
    gl.uniform1f(this.loc(this.post, 'uFar'), view.far);
    gl.uniformMatrix4fv(this.loc(this.post, 'uIVP'), false, view.ivp);
    gl.uniform1f(this.loc(this.post, 'uInk'), Number(view.ink ?? 0));
    gl.uniform1f(this.loc(this.post, 'uLine'), Math.max(1, view.dpr * 0.9));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}

// ─── matrices ────────────────────────────────────────────────────────────────────────────────────
export function perspective(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
export function lookAt(eye: V3, target: V3): { m: M4; right: V3; up: V3; fwd: V3 } {
  const f = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const m = new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0,
    -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]), -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]), f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2], 1]);
  return { m, right: r, up: u, fwd: f };
}
export function mulM(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; }
  return o;
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** The inverse of a 4×4 matrix (column-major). */
export function invert(m: M4): M4 {
  const o = new Float32Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06 || 1e-9, id = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * id; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * id;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * id; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * id;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * id; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * id;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * id; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * id;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * id; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * id;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * id; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * id;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * id; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * id;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * id; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * id;
  return o;
}
