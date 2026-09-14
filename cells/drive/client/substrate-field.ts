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
vec3 subRockC(vec3 c, float lum) { return mix(vec3(lum), c, 0.34) * vec3(0.97, 0.99, 1.07); }
vec3 subSoilC(vec3 c) { return c * vec3(1.13, 0.99, 0.82); }
// …and turf pulls HALF as hard as the other two, deliberately. The palette
// already handles vegetated ground well — the cover tint, the guild and the
// sward all speak for it — and the brief's complaint was about EXPOSED ground.
// Measured at Camps Bay, where nearly every texel classifies as turf: at the
// full pull the whole meadow went a step greener than the place's own palette,
// which is the site model being overruled by a texture.
vec3 subTurfC(vec3 c) { return c * vec3(0.91, 1.035, 0.85); }
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
  float rock = clamp(grain * 0.80 + slope * 0.85 - 0.22 + (dom - 0.5) * 0.70, 0.0, 1.0);
  // TURF is the complement of mineral ground, and it is GATED ON THE PALETTE'S
  // OWN GREEN. Without that gate a snowfield (grain 0.00, rough 0.25) reads as
  // deep turf and comes out green, and a desert pavement picks up a lawn.
  float turf = clamp((0.95 - rough) * 1.15 + (0.5 - dom) * 0.35, 0.0, 1.0)
             * smoothstep(0.05, 0.16, veg) * (1.0 - rock * 0.75);
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
  float soil = clamp(0.85 - turf - rock * 0.55 + (dom - 0.5) * 0.30, 0.0, 1.0)
             * max(smoothstep(0.02, 0.18, warm), smoothstep(0.25, 0.60, grain));
  float t = rock + soil + turf;
  return t > 1.0 ? vec3(rock, soil, turf) / t : vec3(rock, soil, turf);
}
`;
/** The domain's wavelength in metres — the scale a patch of outcrop, scree or
 *  soil holds over. The brief's band is 10–50 m; 18 m is the body of it, and
 *  subDomain's own octaves reach 47 m above and 7.6 m below. */
export const SUB_DOM_M = 18;
