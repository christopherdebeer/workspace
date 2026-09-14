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
float subBed(vec3 p, vec2 dip, float thick, float warp) {
  // ── A BED IS NOT A PERIOD, AND THE FIRST CUT MADE IT ONE ──
  //
  // fract(u) at one thickness is a perfectly regular comb, and over a whole
  // alpine hillside that is not strata, it is CORDUROY — reported from the
  // seat at the Stelvio as long parallel ribs running across the entire frame
  // in one direction. Real bedding does two things this did not: its spacing
  // wanders, and only SOME beds are resistant enough to stand out.
  //
  // The warp argument is a slow phase drift the caller reads at about ninety
  // metres, so the spacing stretches and bunches instead of ticking.
  float u = (p.y + dot(p.xz, dip)) / max(thick, 0.05) + warp;
  float line = smoothstep(0.13, 0.035, abs(fract(u) - 0.5));
  // …and the strength is keyed on the bed INDEX, not the position, so a
  // resistant bed is resistant along its whole outcrop — which is what makes
  // a bedding plane read as one bed seen across a hillside rather than as a
  // texture. It also thins the ink by a third on average, because most beds
  // are now faint, which is both the honest look and the cheaper one.
  return line * (0.22 + 0.78 * tdH(vec2(floor(u), 17.0)));
}
// The cross-fractures that break a bed into blocks. Square to the dip, because
// a joint set forms perpendicular to the bedding it cuts.
float subJoint(vec2 gp, vec2 dip, float spacing) {
  // SQUARE TO THE DIP, AND NOTHING ELSE. Adding a constant vector to the
  // perpendicular biased every joint set on earth toward one world bearing, so
  // the fractures did not turn with the geology they cut — they ran the same
  // way in the Alps as at the Cape. The dip is two noise reads and is
  // essentially never zero, so the perpendicular alone is well defined; the
  // constant fallback is for the degenerate case and only for that.
  vec2 n = vec2(-dip.y, dip.x);
  vec2 dir = normalize(dot(n, n) > 2.5e-3 ? n : vec2(0.31, 0.95));
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

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  THE SHARED GEOMORPHIC SUBSTRATE FIELD
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The model above this — rock / soil / turf as three competing weights chosen
 * from a noise domain — is retired by this one, and the reason is worth
 * stating before the code, because it is an argument about grammar rather than
 * about tuning.
 *
 * A three-octave domain says "this patch is rock" and a motif is then stamped
 * on it. The eye reads exactly that back: somebody chose a material and
 * printed it. Real ground does not look geological because its textures are
 * good; it looks geological because its features are CAUSALLY CORRELATED. A
 * convex steep shoulder sheds its soil and shows bedrock. What breaks off it
 * collects downslope as scree. Fine material gathers in concavities. Water
 * sorts and darkens along the drainage. Soil deepens on stable low-gradient
 * ground. Vegetation exploits that soil wherever nothing else interferes.
 *
 * And — the correction that makes the rest of it work — **turf is not a
 * substrate**. Grass is a COVER LAYER over rock, regolith and soil, and
 * rockiness goes on existing under and through it. A point is not
 * `rock 0.6, soil 0.2, turf 0.2`; it is
 *
 *     bedrock exposure  0.72
 *     debris / scree    0.38
 *     soil depth        0.21
 *     moisture          0.34
 *     grass cover       0.57
 *
 * so that grass among rock is expressible at all, which "grass OR rock" never
 * was.
 *
 * ── ONE FIELD, TWO READERS, WHICH IS THE WHOLE POINT ──
 *
 * The field is built ONCE per terrain tile, in the worker, off the DEM. The
 * terrain fragment samples it and the sward seeder samples it, so a thinning
 * of the blades and a roughening of the ground are one decision seen twice
 * rather than two models that happen to agree. That divergence is the fault
 * this replaces: the shader and the seeder each had their own idea of where
 * the rock was.
 *
 * ── AND IT IS COARSE, BECAUSE THAT IS WHERE A LANDSCAPE LIVES ──
 *
 * 64x64 over a z14 tile is about 33 m a cell: the 30–150 m band (cliff bands,
 * scree tongues, wet hollows, grassy terraces) and the top of the 5–30 m band
 * (outcrop patches, debris fans, shallow-soil pockets). A 50 m tongue of scree
 * down a mountainside does more for "organic" than ten thousand 45 cm
 * procedural stones. Everything finer than this stays in the fragment, as
 * detail ON a physical signal rather than as the signal.
 */
/** Cells a side, over one terrain tile. 64 over ~2.15 km at z14 is ~33 m. */
export const SUB_FIELD_N = 64;
/**
 * THE CHANNEL ORDER IS A WIRE FORMAT. The kernel packs it, two RGBA textures
 * carry it to the fragment, and the CPU sampler indexes it. Appending is safe;
 * MOVING a channel re-dresses every hillside in the world on the next deploy,
 * exactly as TRADITION_LIST's order does for buildings.
 */
export const SUB_CH = Object.freeze({
  exposure: 0, debris: 1, soilDepth: 2, moisture: 3,   // texture A, rgba
  grassPot: 4, rockFamily: 5, flowX: 6, flowZ: 7,      // texture B, rgba
});
/** Four rock structure families, chosen by CONTEXT rather than rolled: a
 *  steep high-exposure face is massive or jointed, a broad hillside with
 *  contour expression is bedded, a debris zone is broken. Carried as a scalar
 *  because it rides in one byte of a texture; `rockFamilyOf` names it. */
export const ROCK_FAMILY = Object.freeze(['massive', 'bedded', 'fractured', 'loose'] as const);
export type RockFamily = (typeof ROCK_FAMILY)[number];
export function rockFamilyOf(v: number): RockFamily {
  return ROCK_FAMILY[Math.min(3, Math.max(0, Math.round(v * 3)))];
}
export interface SubstrateField {
  n: number;
  /** The tile's world box, so a world point can be put in the field's frame. */
  xs: number; zs: number; w: number; h: number;
  /** exposure, debris, soilDepth, moisture — normalized bytes. */
  a: Uint8Array;
  /** grassPot, rockFamily, flowX, flowZ — flow is (v/255)*2-1. */
  b: Uint8Array;
}
/** What the builder needs, and it is almost nothing: the tile's own
 *  heightfield, its box, and the one input that is not the DEM. */
export interface SubstrateInput {
  data: Float32Array | Int16Array | number[];
  xs: number; zs: number; w: number; h: number;
  /** Cells a side. Passed in rather than read from SUB_FIELD_N because the
   *  builder must close over NOTHING — see the note on its own header. */
  n: number;
  /** WorldCover class at a world point, or null where the raster has not
   *  reached — which is a real answer and abstains rather than voting. */
  cover: (x: number, z: number) => number | null;
}
/**
 * ── THE DERIVATION ──
 *
 * ── IT CLOSES OVER NOTHING, AND THAT IS LOAD-BEARING ──
 *
 * The terrain kernel is one closure stringified into a Blob worker, so nothing
 * inside it may touch a module binding — which is why TD_MAT is duplicated in
 * the kernel with a test parsing both copies to hold them honest. A second
 * hand-copy of a hundred and twenty lines of geomorphology would be far worse
 * than that one: the two would drift the first time a weight moved, and the
 * drift would show as the sward thinning in a different place from the rock,
 * which is precisely the divergence this field exists to end.
 *
 * So this function is SELF-CONTAINED — every helper and every constant it uses
 * is declared inside it — and `terrain-worker.ts` ships it to the worker as
 * text (`buildSubstrateCells.toString()`), handed to the kernel factory as an
 * argument. One copy of the code, two places it runs.
 *
 * `devtools/substrate-morph.test.mjs` re-evaluates the function through
 * `new Function` with no scope at all and requires it to produce byte-identical
 * output, which is the check that fails the moment somebody reaches for a
 * module-scope helper — a mistake that would otherwise surface as the terrain
 * worker throwing on its first job, with no terrain anywhere.
 *
 * Every term is a physical claim written so the next person can argue with the
 * CLAIM rather than with a magic number. The order is causal and cannot be
 * shuffled: moisture and exposure are inputs to debris, both are inputs to
 * soil, and all four are inputs to the grass.
 *
 * Signs, once, because every consumer depends on them: `curv` is the mean of
 * the neighbours LESS the centre, so it is POSITIVE in a hollow (concave,
 * collecting) and NEGATIVE on a shoulder (convex, shedding). `relEl` is 0 at
 * the lowest ground within the window and 1 at its crest — the cheapest
 * drainage proxy there is, since water and fines end up where relEl is low.
 */
export function buildSubstrateCells(inp: SubstrateInput): { a: Uint8Array; b: Uint8Array } {
  const cl01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
  /** A bump peaking at `c`: "steep enough to shed, shallow enough to hold". */
  const bump = (v: number, c: number, wdt: number): number => cl01(1 - Math.abs(v - c) / wdt);
  const sstepF = (a0: number, b0: number, v: number): number => {
    const t = cl01((v - a0) / (b0 - a0 || 1));
    return t * t * (3 - 2 * t);
  };
  const N = inp.n, cellM = inp.w / N;
  const step = 256 / N;                       // raster pixels a cell (4 at N=64)
  // ── 1. THE LANDFORM, NOT THE PIXEL ── the mean of each block rather than a
  // point sample: a point sample at 33 m carries every spike the DEM has, and
  // the whole purpose of this lattice is to describe the shape of the hill.
  const lo = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let s = 0, m = 0;
      for (let b = 0; b < step; b++) {
        for (let a = 0; a < step; a++) { s += inp.data[(j * step + b) * 256 + (i * step + a)]; m++; }
      }
      lo[j * N + i] = s / Math.max(1, m);
    }
  }
  const at = (j: number, i: number): number =>
    lo[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  // ── 2. THE EVIDENCE ── slope, aspect, curvature at two scales, relief and
  // relative elevation over a ~200 m window.
  const slope = new Float32Array(N * N), curv = new Float32Array(N * N);
  const relief = new Float32Array(N * N), relEl = new Float32Array(N * N);
  const gx = new Float32Array(N * N), gz = new Float32Array(N * N);
  const R = 3;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const dx = (at(j, i + 1) - at(j, i - 1)) / (2 * cellM);
      const dz = (at(j + 1, i) - at(j - 1, i)) / (2 * cellM);
      slope[j * N + i] = Math.hypot(dx, dz);
      gx[j * N + i] = dx; gz[j * N + i] = dz;
      const h = lo[j * N + i];
      // Two bands of curvature: the lattice's own ~33 m, which sees an
      // outcrop's shoulder, and ~100 m, which sees the hillside it sits on.
      const cNear = (at(j, i - 1) + at(j, i + 1) + at(j - 1, i) + at(j + 1, i)) * 0.25 - h;
      const cFar = (at(j, i - 3) + at(j, i + 3) + at(j - 3, i) + at(j + 3, i)) * 0.25 - h;
      // Normalised so that a pronounced shoulder or hollow — about a
      // twentieth of the span it is measured over — reads 1.
      curv[j * N + i] = Math.max(-1, Math.min(1,
        (cNear / (cellM * 0.05)) * 0.45 + (cFar / (cellM * 3 * 0.05)) * 0.55));
      // relief and relEl are filled by the separable pass below — a square
      // window's min and max are two one-dimensional passes, 14 reads a cell
      // rather than 49, and this is the whole cost of the build.
    }
  }
  // ── 2b. THE WINDOW, SEPARABLY ── min and max over a (2R+1) square are the
  // min and max of the row-wise mins and maxes, so it is two passes of 2R+1
  // instead of one of (2R+1)². Measured on a real-sized tile, and the figure
  // is the measurement rather than the estimate that was written here first:
  // 8.48 ms a build to 6.82. The window is a fifth of the cost, not all of it
  // — the rest is the 65,536-pixel downsample and the per-cell cover read.
  {
    const rmn = new Float32Array(N * N), rmx = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let mn = Infinity, mx = -Infinity;
        for (let a = -R; a <= R; a++) { const v = at(j, i + a); if (v < mn) mn = v; if (v > mx) mx = v; }
        rmn[j * N + i] = mn; rmx[j * N + i] = mx;
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let mn = Infinity, mx = -Infinity;
        for (let b = -R; b <= R; b++) {
          const jj = Math.min(N - 1, Math.max(0, j + b));
          if (rmn[jj * N + i] < mn) mn = rmn[jj * N + i];
          if (rmx[jj * N + i] > mx) mx = rmx[jj * N + i];
        }
        const span = mx - mn;
        relief[j * N + i] = span;
        // A flat window has no floor and no crest, and dividing by its span
        // would turn float noise into a landform. Half is "neither".
        relEl[j * N + i] = span > 1 ? (lo[j * N + i] - mn) / span : 0.5;
      }
    }
  }
  // ── 3. THE COVER'S OWN WORD ── a wood or a crop is a statement that soil is
  // there and outranks a slope estimated from a 9.5 m DEM; bare ground argues
  // the other way; snow hides whatever is under it and must not read as
  // bedrock. Unmapped abstains.
  const bare = new Float32Array(N * N), veg = new Float32Array(N * N), grassBias = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const wx = inp.xs + (i + 0.5) * cellM, wz = inp.zs + (j + 0.5) * (inp.h / N);
      const c = inp.cover(wx, wz);
      const k = j * N + i;
      if (c === null || c === undefined) { bare[k] = 0.5; veg[k] = 0.5; grassBias[k] = 0.5; continue; }
      bare[k] = c === 60 ? 1 : c === 70 ? 0.3 : c === 50 ? 0.6 : c === 80 ? 0 : 0.1;
      veg[k] = c === 10 || c === 40 || c === 90 || c === 95 ? 1 : c === 30 || c === 20 ? 0.8 : c === 100 ? 0.5 : 0.05;
      grassBias[k] = c === 30 ? 1 : c === 20 ? 0.7 : c === 40 ? 0.6 : c === 10 ? 0.45 : c === 100 ? 0.4 : c === 60 ? 0.12 : 0.1;
    }
  }
  // ── 4. EXPOSURE — bedrock showing ── CONTINUOUS, never thresholded, because
  // 0.3 must mean "grass with stones and bedrock peeking through" and 0.9 a
  // bare face. A threshold here is what makes the whole thing read as a
  // material classifier again.
  const exposure = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const sl = sstepF(0.25, 0.90, slope[k]);
    const convex = cl01(-curv[k]);
    const rlf = cl01(relief[k] / 120);
    exposure[k] = cl01(sl * 0.45 + convex * 0.20 + rlf * 0.20 + bare[k] * 0.20 - veg[k] * 0.25);
  }
  // ── 5. DEBRIS — what the face above shed ── this is the causal relationship
  // that reads instantly as geology: rock face above implies broken material
  // below. Walked UPHILL along the gradient, so the answer is "how much
  // exposed rock stands over me", and the walk is what makes a scree apron a
  // TONGUE rather than a blob.
  const debris = new Float32Array(N * N);
  const UP = 6;                                  // ~200 m of fall line
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      // ── A WEIGHTED MAX, NOT A MEAN, AND THE TEST CAUGHT THE DIFFERENCE ──
      //
      // The first cut averaged the exposure along the walk and normalised by
      // the weights, which dilutes the one thing being asked about: an apron
      // two hundred metres below a cliff has five cells of its own bare
      // ground between it and the face, so the face's 0.55 came back as
      // 0.026 and no scree existed anywhere in the world. The question is not
      // "how exposed is my fall line on average", it is "is there a face
      // above me, and how far up" — a MAX over the walk, faded with distance.
      let fi = i, fj = j, best = 0;
      for (let s = 1; s <= UP; s++) {
        const kk = Math.min(N - 1, Math.max(0, Math.round(fj))) * N + Math.min(N - 1, Math.max(0, Math.round(fi)));
        const g = Math.hypot(gx[kk], gz[kk]);
        if (g < 1e-4) break;
        fi += gx[kk] / g; fj += gz[kk] / g;      // +gradient is uphill
        if (fi < 0 || fj < 0 || fi > N - 1 || fj > N - 1) break;
        const w = 1 - (s - 1) / (UP + 1);        // the face just above counts most
        const e = exposure[Math.round(fj) * N + Math.round(fi)] * w;
        if (e > best) best = e;
      }
      const upslope = best;
      const toe = cl01(curv[k]);                                   // material rests where it flattens
      const mid = bump(slope[k], 0.45, 0.40);                      // steep enough to receive, shallow enough to hold
      // The vegetation penalty is GENTLE here, where it is firm for exposure:
      // WorldCover at 10 m calls a scree apron with tussocks in it grassland,
      // and a penalty stiff enough to respect that erases the one landform
      // this channel exists to draw. A face is unmistakable to the raster; an
      // apron is not.
      debris[k] = cl01(upslope * 0.52 + toe * 0.25 + mid * 0.20 + bare[k] * 0.20 - veg[k] * 0.12);
    }
  }
  // ── 6. MOISTURE, SOIL, GRASS ── a topographic wetness proxy and what grows
  // on it. The hydro field remains the authority on actual water and the
  // climate on how much there is to begin with; this is only about where it
  // goes once it has fallen.
  const a = new Uint8Array(N * N * 4), bOut = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    const concave = cl01(curv[k]);
    const moisture = cl01(concave * 0.40 + (1 - relEl[k]) * 0.42 + (1 - cl01(slope[k])) * 0.18);
    const soil = cl01((1 - cl01(slope[k] / 0.6)) * 0.30 + concave * 0.25 + moisture * 0.20 + veg[k] * 0.20
      - exposure[k] * 0.35 - debris[k] * 0.20);
    const grassPot = cl01(soil * 0.45 + moisture * 0.25 + bump(slope[k], 0.12, 0.5) * 0.15 + grassBias[k] * 0.25
      - exposure[k] * 0.35 - debris[k] * 0.15);
    // ── THE ROCK'S STRUCTURE, BY CONTEXT ── broken where the debris is, and
    // between massive and bedded by whether the hillside has contour
    // expression: high relief on a steep face is a cliff of blocks, moderate
    // relief on a moderate slope is where ledges and bands read.
    const ledge = bump(slope[k], 0.35, 0.35) * cl01(relief[k] / 90);
    const family = debris[k] > 0.45 ? 1
      : 0.333 * cl01(ledge * 1.6) + 0.666 * cl01((debris[k] - 0.25) * 2) * 0.5;
    const g = Math.hypot(gx[k], gz[k]) || 1;
    a[k * 4] = Math.round(exposure[k] * 255);
    a[k * 4 + 1] = Math.round(debris[k] * 255);
    a[k * 4 + 2] = Math.round(soil * 255);
    a[k * 4 + 3] = Math.round(moisture * 255);
    bOut[k * 4] = Math.round(grassPot * 255);
    bOut[k * 4 + 1] = Math.round(cl01(family) * 255);
    // Downhill, which is the axis every anisotropic warp downstream is written
    // in: scree elongates along it, wet ground follows it, strata cross it.
    bOut[k * 4 + 2] = Math.round((cl01(-gx[k] / g * 0.5 + 0.5)) * 255);
    bOut[k * 4 + 3] = Math.round((cl01(-gz[k] / g * 0.5 + 0.5)) * 255);
  }
  return { a, b: bOut };
}
/** One channel of the field at a world point, bilinear — the CPU reader, for
 *  the sward seeder, the flora placement and every probe. Nearest would put
 *  the lattice's own 33 m squares on the hillside, which is the blocky-motif
 *  fault one scale up. */
export function sampleSubstrate(f: SubstrateField, x: number, z: number, ch: number): number {
  const n = f.n;
  const fx = Math.min(n - 1, Math.max(0, ((x - f.xs) / f.w) * n - 0.5));
  const fz = Math.min(n - 1, Math.max(0, ((z - f.zs) / f.h) * n - 0.5));
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(n - 1, x0 + 1), z1 = Math.min(n - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const arr = ch < 4 ? f.a : f.b, o = (ch & 3);
  const p = (j: number, i: number): number => arr[(j * n + i) * 4 + o] / 255;
  const top = p(z0, x0) + (p(z0, x1) - p(z0, x0)) * tx;
  const bot = p(z1, x0) + (p(z1, x1) - p(z1, x0)) * tx;
  const v = top + (bot - top) * tz;
  return ch === SUB_CH.flowX || ch === SUB_CH.flowZ ? v * 2 - 1 : v;
}
