/**
 * ── THE SUBSTRATE: WHAT THE GROUND IS MADE OF, AT THE SCALE THAT CARRIES ──
 *
 * The surface-detail cascade in main.ts draws TEXTURE — a tonal wobble at four
 * wavelengths, band-limited against the art pixel. It is the right thing and it
 * is not enough, and the seat said why: over exposed ground the world reads as
 * one undifferentiated wash with some noise on it, because every term in that
 * cascade is a BRIGHTNESS and one palette step is 0.07 sRGB. A term at ±0.045
 * spends its life deciding which side of the Bayer threshold a pixel falls on.
 * Nothing in it can say "this is outcrop and that is scree".
 *
 * So this is the layer under the texture: a first-order CLASSIFICATION of the
 * ground into three materials, coherent over the ten to fifty metres a driver
 * actually reads a landscape at, with each material drawing its own structure
 * at its own band. The design brief's own priority, verbatim: *5–50 m coherent
 * substrate domains + 0.5–5 m material structure. Not micro-detail first.*
 *
 *   40–100 m   the region's geological grain: dip direction, bedding
 *   10–50 m    the domain — where outcrop gives way to regolith to turf
 *    2–8 m     bedding planes, joints, stone clusters, tonal regions
 *    0.3–2 m   individual stones, turf clumps
 *   under 0.3  grit — the existing cascade's finest octave, not this module's
 *
 * THE MATERIALS ARE TRANSFORMS OF THE PLACE'S OWN COLOUR, NOT THREE COLOURS.
 * The terrain palette has already decided what COUNTRY this is — the climate
 * ramps, the bedrock family, the cover tint, the ecoregion's guild standing on
 * it — and a substrate that painted a fixed granite grey over all of it would
 * undo the whole site model to gain a texture. Rock is the ground's own colour
 * with its chroma pulled out and a cool cast on it (weathered stone is grey
 * whatever the soil around it is); regolith is that colour oxidised warm; turf
 * is it pulled green.
 *
 * AND THE TRANSFORMS HOLD LUMINANCE TO WITHIN A FEW PER CENT, deliberately.
 * Fourteen levels and a dither turn a brightness difference into a different
 * TONE and a hue difference into a different MATERIAL, and it is materials this
 * is trying to draw. Every differential here is two to three palette steps in
 * the chroma channels and under one in luminance — which is why it reads as
 * rock beside dirt rather than as light ground beside dark ground.
 *
 * THE EVIDENCE IS THE VERTEX ATTRIBUTE AND THE VERTEX COLOUR, AND BOTH ARE
 * NEEDED. `aTd` carries rough, grain and the bed's own slope, which say how
 * mineral and how steep this is; the colour says whether anything grows here
 * and whether the ground is oxidised. Neither alone is enough: grain cannot
 * tell a snowfield from a crop field (0.00 against 0.05) and the colour cannot
 * tell a cliff from the meadow below it. Snow is the case that proves it — with
 * the attribute alone a glacier classifies as regolith and comes out beige.
 *
 * Depends on TD_HELPERS (tdVN, tdBand) and must be concatenated after it.
 */
/**
 * ── ONE TABLE OF CONSTANTS, SUBSTITUTED INTO THE GLSL ──
 *
 * The classification has to run in two places: in the fragment, which paints
 * it, and on the CPU, where the sward seeder has to thin its grass on the SAME
 * outcrop the shader drew. Two hand-written copies of eleven numbers is two
 * copies that will disagree, and the disagreement would show as grass standing
 * thick on a patch of painted rock — which is the exact complaint this whole
 * programme started from, arrived at from the other side.
 *
 * So the numbers live here once and the shader source interpolates them. There
 * is nothing to keep in step.
 */
export const SUB_K = Object.freeze({
  rockGrain: 0.80, rockSlope: 0.85, rockBias: 0.22, rockDom: 0.70,
  turfRough: 0.95, turfGain: 1.15, turfDom: 0.35, turfVegLo: 0.05, turfVegHi: 0.16,
  turfRock: 0.75,
  soilBase: 0.85, soilRock: 0.55, soilDom: 0.30,
  soilWarmLo: 0.02, soilWarmHi: 0.18, soilGrainLo: 0.25, soilGrainHi: 0.60,
  // …and the three material transforms, here for the same reason: a blade
  // fading toward the outcrop it stands on has to fade toward the SAME colour
  // the fragment painted that outcrop.
  rockChroma: 0.34, rockR: 0.97, rockG: 0.99, rockB: 1.07,
  soilR: 1.13, soilG: 0.99, soilB: 0.82,
  turfR: 0.91, turfG: 1.035, turfB: 0.85,
});
const K = SUB_K;
export const SUB_GLSL = `
// ── THE REGION'S GEOLOGY: A DIP AND A JOINT DIRECTION THAT HOLD FOR A MILE ──
//
// Real strata do not change direction between one outcrop and the next; a
// hillside's beds all dip the same way because they are the same beds. Two very
// low-frequency noise reads give a dip vector that is effectively constant over
// any one hillside and turns over about a kilometre, which is the scale a fold
// belt actually varies at. It costs two hashes and needs no lookup, no district
// table and no upload.
vec2 subDip(vec2 gp) {
  return vec2(tdVN(gp * (1.0 / 1100.0)), tdVN(gp * (1.0 / 870.0) + 31.7)) * 0.55;
}
// ── THE DOMAIN: WHERE ONE MATERIAL GIVES WAY TO ANOTHER ──
//
// Three octaves over the ground plane at the scale a patch of scree, a soil
// terrace or an outcrop actually holds: with s = 18 m that is 47 m, 18 m and
// 7.6 m, so a patch has a broad bias, an irregular body and a ragged edge.
// Returned as 0..1 about a mean of a half, because the caller shifts a weight
// by (dom - 0.5) and a field with a mean anywhere else would bias the whole
// world toward one material.
float subDomain(vec2 gp, float s) {
  float d = tdVN(gp / (s * 2.6)) + tdVN(gp / s) * 0.55 + tdVN(gp / (s * 0.42)) * 0.25;
  return clamp(0.5 + d * 0.62, 0.0, 1.0);
}
// ── BEDDING, AND THE ONE LINE THAT MAKES ROCK READ AS ROCK ──
//
// A sedimentary bed is a near-horizontal layer, so the line where it meets the
// hillside — its outcrop trace — is a contour of (y + dip·xz). PHASING ON THE
// WORLD Y IS THE WHOLE TRICK: the bands then wrap round a spur, climb a gully
// and close up where the ground steepens, exactly as real strata do, for one
// dot product. A purely horizontal noise, however well tuned, lies flat across
// the slope and reads as paint on a hill rather than as the hill's own
// structure. Returns 1 in the bedding plane's shadow and 0 on the bed's face.
float subBed(vec3 p, vec2 dip, float thick) {
  float f = abs(fract((p.y + dot(p.xz, dip)) / max(thick, 0.05)) - 0.5);
  return smoothstep(0.13, 0.035, f);
}
// The cross-fractures that break a bed into blocks. Square to the dip, because
// a joint set forms perpendicular to the bedding it cuts.
float subJoint(vec2 gp, vec2 dip, float spacing) {
  vec2 dir = normalize(vec2(-dip.y, dip.x) + vec2(0.31, 0.95));
  float f = abs(fract(dot(gp, dir) / max(spacing, 0.05)) - 0.5);
  return smoothstep(0.10, 0.02, f);
}
// Sparse angular clasts: a thresholded noise, so most of the ground is bare of
// them and a few per cent carries a stone. Not a scatter of dots — a cluster,
// because clasts collect in hollows and along wash lines, which is what the
// second, coarser read is for.
float subStones(vec2 gp, float scale, float cut) {
  float n = tdVN(gp / scale) + 0.5;
  float cluster = tdVN(gp / (scale * 7.0)) + 0.5;
  return smoothstep(cut, cut + 0.16, n * (0.55 + cluster * 0.9));
}
// ── THE THREE MATERIALS, AS TRANSFORMS OF THE GROUND'S OWN COLOUR ──
vec3 subRockC(vec3 c, float lum) { return mix(vec3(lum), c, ${K.rockChroma}) * vec3(${K.rockR}, ${K.rockG}, ${K.rockB}); }
vec3 subSoilC(vec3 c) { return c * vec3(${K.soilR}, ${K.soilG}, ${K.soilB}); }
// …and turf pulls HALF as hard as the other two, deliberately. The palette
// already handles vegetated ground well — the cover tint, the guild and the
// sward all speak for it — and the brief's complaint was about EXPOSED ground.
// Measured at Camps Bay, where nearly every texel classifies as turf: at the
// full pull the whole meadow went a step greener than the place's own palette,
// which is the site model being overruled by a texture.
vec3 subTurfC(vec3 c) { return c * vec3(${K.turfR}, ${K.turfG}, ${K.turfB}); }
// ── THE FIRST-ORDER CLASSIFICATION ──
//
// m is (rough, grain, slope) from aTd; veg and warm are what the palette says
// about this ground; dom is the domain field. The weights do NOT have to sum
// to one: whatever is left over is the palette as the painter left it, which is
// the honest answer for ground none of the three describes — a snowfield, open
// water, a made surface. Only an over-subscribed sum is normalised.
vec3 subWeights(vec3 m, float veg, float warm, float dom) {
  float rough = m.x, grain = m.y, slope = m.z;
  // BEDROCK shows where soil cannot stay: a steep face, and ground the cover
  // already calls bare or broken. The domain then shifts it by a third either
  // way, which is what turns a uniform verdict into outcrop standing out of
  // fill — the thing the seat asked for and the thing a per-vertex material
  // can never produce on its own.
  float rock = clamp(grain * ${K.rockGrain} + slope * ${K.rockSlope} - ${K.rockBias} + (dom - 0.5) * ${K.rockDom}, 0.0, 1.0);
  // TURF is the complement of mineral ground, and it is GATED ON THE PALETTE'S
  // OWN GREEN. Without that gate a snowfield (grain 0.00, rough 0.25) reads as
  // deep turf and comes out green, and a desert pavement picks up a lawn.
  float turf = clamp((${K.turfRough} - rough) * ${K.turfGain} + (0.5 - dom) * ${K.turfDom}, 0.0, 1.0)
             * smoothstep(${K.turfVegLo}, ${K.turfVegHi}, veg) * (1.0 - rock * ${K.turfRock});
  // REGOLITH is the default fill — the dirt, gravel and weathered debris that
  // covers most ground that is neither outcrop nor sward.
  //
  // ── AND ITS GATE NEEDS BOTH HALVES OF THE EVIDENCE, WHICH COST A RUN ──
  //
  // The first cut gated it on the palette's warmth alone: soil is oxidised and
  // snow is not, which is true and is not sufficient. Measured at the seat's
  // own Yosemite spot, the exposed granite apron reads (0.711, 0.727, 0.746) —
  // pale and very slightly BLUE — so warm is −0.049, one gate short of a
  // snowfield's, and the whole surface the brief was written about classified
  // as 49% outcrop and 51% LEAVE IT ALONE. The pale sheet stayed a pale sheet.
  //
  // What actually separates granite grus from a glacier is the cover class,
  // which is already in hand: bare and broken ground carries grain 0.85 and
  // snow carries 0.00. So either piece of evidence opens the gate and a
  // snowfield still has neither. Worked ground keeps its warmth route (crops
  // are grain 0.05 and warm 0.36) and a made surface passes neither.
  float soil = clamp(${K.soilBase} - turf - rock * ${K.soilRock} + (dom - 0.5) * ${K.soilDom}, 0.0, 1.0)
             * max(smoothstep(${K.soilWarmLo}, ${K.soilWarmHi}, warm), smoothstep(${K.soilGrainLo}, ${K.soilGrainHi}, grain));
  float t = rock + soil + turf;
  return t > 1.0 ? vec3(rock, soil, turf) / t : vec3(rock, soil, turf);
}
`;
/** The domain's wavelength in metres — the scale a patch of outcrop, scree or
 *  soil holds over. The brief's band is 10–50 m; 18 m is the body of it, and
 *  subDomain's own octaves reach 47 m above and 7.6 m below. */
export const SUB_DOM_M = 18;

/**
 * ── AND THE SAME CLASSIFICATION ON THE CPU, FOR THE SWARD ──
 *
 * The brief's own next ask, verbatim: *if the shader says this location is 70%
 * grassy and 30% exposed soil, the sward seeder should read essentially the
 * same field… then sward doesn't appear as arbitrary tufts pasted onto blank
 * ground.* The seeder runs on the main thread and the classification runs in a
 * fragment, so "the same field" means these functions and the shader's must be
 * the same arithmetic on the same evidence.
 *
 * The CONSTANTS are shared outright (SUB_K, substituted into the source above),
 * so the weights cannot drift. The NOISE is written twice — once in GLSL and
 * once here — because there is no way to call one from the other, and that is
 * stated rather than hidden: they are the same construction at different
 * precision (float32 in the fragment, float64 here). The lattice wrap at 2048
 * that keeps the hash argument under 3e5 is what makes that difference
 * irrelevant: the two agree to about a part in 10^5, which is five orders
 * below the eighteen metres a domain patch spans.
 *
 * `devtools/substrate-field.test.mjs` holds the statistics that say the port
 * is the same field — mean, range, and that two samples a patch apart have
 * decorrelated — because those are the properties the weights actually read.
 */
const subH = (x: number, y: number): number => {
  // The GLSL's tdH, term for term: wrap the lattice, two multiplies, a dot and
  // two fracts. See TD_HELPERS for why 2048 and what it costs.
  const fr = (v: number): number => v - Math.floor(v);
  let px = fr(((x % 2048) + 2048) % 2048 * 127.31);
  let py = fr(((y % 2048) + 2048) % 2048 * 311.7);
  const d = px * (px + 34.23) + py * (py + 34.23);
  px += d; py += d;
  return fr(px * py);
};
const subVN = (x: number, y: number): number => {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = subH(ix, iy), b = subH(ix + 1, iy);
  const c = subH(ix, iy + 1), d = subH(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy - 0.5;
};
/** The domain field at a world point — subDomain's own three octaves. */
export function subDomainAt(x: number, z: number, s = SUB_DOM_M): number {
  const d = subVN(x / (s * 2.6), z / (s * 2.6))
    + subVN(x / s, z / s) * 0.55
    + subVN(x / (s * 0.42), z / (s * 0.42)) * 0.25;
  return Math.min(1, Math.max(0, 0.5 + d * 0.62));
}
/** Per cover class, the [rough, grain] the terrain kernel's own TD_MAT gives —
 *  the SOURCE OF RECORD for that table, which the kernel inlines because its
 *  closure is stringified into a worker and may not touch a module binding.
 *  `devtools/substrate-field.test.mjs` parses the kernel's copy and asserts
 *  the two agree, which is the same trick perf-check.mjs uses for refreshVeg
 *  and the only kind of check that can hold a duplicate honest. */
export const SUB_MAT: Readonly<Record<number, readonly [number, number]>> = Object.freeze({
  10: [0.40, 0.30], 20: [0.60, 0.50], 30: [0.35, 0.15], 40: [0.28, 0.05],
  50: [0.50, 0.20], 60: [1.00, 0.85], 70: [0.25, 0.00], 80: [0.00, 0.00],
  90: [0.30, 0.10], 95: [0.35, 0.20], 100: [0.45, 0.25],
});
export interface SubMat { rough: number; grain: number; slope: number }
/** What the kernel would have written into `aTd` for this cover class and
 *  slope. Slope raises rough exactly as the kernel does, and the BED slope is
 *  returned separately, because those are two different questions (see
 *  TileBuild.mats). */
export function subMatOf(cover: number | null, slope: number): SubMat {
  const m = cover === null || cover === undefined ? undefined : SUB_MAT[cover];
  const grain = m ? m[1] : 0.5;
  const bed = Math.min(1, slope);
  return { rough: Math.min(1, (m ? m[0] : 0.6) + bed * 0.6), grain, slope: bed };
}
const sstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** The vertex colour's two verdicts, normalised by luminance so a shaded face
 *  and a sunlit one classify alike — see the fragment for why that divide is
 *  load-bearing rather than tidy. */
export function subEvidence(r: number, g: number, b: number): { veg: number; warm: number } {
  const lum = Math.max(1e-3, 0.2126 * r + 0.7152 * g + 0.0722 * b);
  return { veg: (g - 0.5 * (r + b)) / lum, warm: (r - b) / lum };
}
export interface SubW { rock: number; soil: number; turf: number }
/** subWeights, term for term, on the shared constants. */
export function subWeightsOf(m: SubMat, veg: number, warm: number, dom: number): SubW {
  const cl = (v: number): number => Math.min(1, Math.max(0, v));
  const rock = cl(m.grain * K.rockGrain + m.slope * K.rockSlope - K.rockBias + (dom - 0.5) * K.rockDom);
  const turf = cl((K.turfRough - m.rough) * K.turfGain + (0.5 - dom) * K.turfDom)
    * sstep(K.turfVegLo, K.turfVegHi, veg) * (1 - rock * K.turfRock);
  const soil = cl(K.soilBase - turf - rock * K.soilRock + (dom - 0.5) * K.soilDom)
    * Math.max(sstep(K.soilWarmLo, K.soilWarmHi, warm), sstep(K.soilGrainLo, K.soilGrainHi, m.grain));
  const t = rock + soil + turf;
  return t > 1 ? { rock: rock / t, soil: soil / t, turf: turf / t } : { rock, soil, turf };
}
/**
 * HOW MUCH GRASS A SUBSTRATE ALLOWS, as a multiplier on whatever the cover
 * class and the altitude already asked for.
 *
 * Not the turf weight itself: turf is "how sward-like is this ground", which
 * is already most of what GRASS_M2 says from the cover class, and multiplying
 * the two would thin every meadow in the world by a third for nothing. What
 * the substrate adds is the MINERAL share — the outcrop and the scree the
 * fragment is drawing at ten to fifty metres — so the grass thins on the same
 * patch the shader roughened, and the patchwork the seat asked for is one
 * field seen twice rather than two fields that happen to be near each other.
 *
 * Regolith counts for less than half of rock: grass grows in dirt and does not
 * grow on stone.
 */
export function subGrassFactor(w: SubW): number {
  return 1 - 0.8 * Math.min(1, w.rock + w.soil * 0.45);
}
/** The material colour a blade should fade toward, so a tuft standing on an
 *  outcrop is the outcrop's colour rather than the tile's mean. The same three
 *  transforms the fragment applies, in the same order, weighted the same. */
export function subTintOf(r: number, g: number, b: number, w: SubW): [number, number, number] {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const rest = Math.max(0, 1 - w.rock - w.soil - w.turf);
  const rk = [(lum + (r - lum) * K.rockChroma) * K.rockR,
    (lum + (g - lum) * K.rockChroma) * K.rockG, (lum + (b - lum) * K.rockChroma) * K.rockB];
  const so = [r * K.soilR, g * K.soilG, b * K.soilB];
  const tu = [r * K.turfR, g * K.turfG, b * K.turfB];
  return [
    r * rest + rk[0] * w.rock + so[0] * w.soil + tu[0] * w.turf,
    g * rest + rk[1] * w.rock + so[1] * w.soil + tu[1] * w.turf,
    b * rest + rk[2] * w.rock + so[2] * w.soil + tu[2] * w.turf,
  ];
}
