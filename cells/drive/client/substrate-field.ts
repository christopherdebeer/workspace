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
 * The layered model has to run in two places: in the fragment, which paints
 * it, and on the CPU, where the sward seeder has to thin its grass on the SAME
 * outcrop the shader drew. Two hand-written copies is two copies that will
 * disagree, and the disagreement would show as grass standing thick on a patch
 * of painted rock — which is the exact complaint this whole programme started
 * from, arrived at from the other side.
 *
 * So the numbers live here once and the shader source interpolates them. There
 * is nothing to keep in step.
 */
export const SUB_K = Object.freeze({
  // ── THE LAYERS' COLOURS, AS TRANSFORMS OF THE GROUND'S OWN ──
  // Bedrock: the place's colour with its chroma pulled out and a cool cast on
  // it, because weathered stone is grey whatever the soil around it is.
  rockChroma: 0.34, rockR: 0.97, rockG: 0.99, rockB: 1.07,
  // The fines: that colour oxidised warm.
  soilR: 1.13, soilG: 0.99, soilB: 0.82,
  // …and the COARSE debris lying on the fines is a third colour, which the
  // three-material classifier could not express at all: a scree of fresh
  // fragments is broken ROCK, not dirt, so it is paler and cooler than the
  // fines it rests on and a little lighter than either, because a field of
  // angular faces catches the sky from every direction at once.
  screeR: 1.02, screeG: 1.02, screeB: 1.05, screeLift: 0.07,
  // The grassy complement. It is no longer a material — grass is a layer ON
  // rock and regolith, not an alternative to them — so it pulls half as hard
  // as the other two: the palette, the cover tint and the guild already speak
  // for vegetated ground, and at the full pull a meadow came out a step
  // greener than the place's own colour.
  grassR: 0.91, grassG: 1.035, grassB: 0.85,
  // ── AND HOW MUCH OF EACH LAYER IS EXPRESSED ──
  // Not weights over a partition: the substrate is EVERYWHERE, including under
  // dense sward, and these say how much of it can be SEEN through what lies on
  // top. That distinction is the whole of phase C.
  mantleSoil: 0.85, mantleDebris: 0.75, mantleLo: 0.05, mantleHi: 0.55,
  // …and the ONE veto the field cannot supply. Its channels are derived from
  // the landform, which is blind to what is lying on it: a flat glacier in a
  // cirque has soil depth and debris by every topographic argument there is,
  // and painting it with the fines' oxidised warmth would turn it beige. The
  // cover class answers it outright — grain is 0.00 for snow and open water
  // and at least 0.05 for everything else on earth — so this is a veto on two
  // classes rather than a classifier, and it is the whole of what the palette
  // evidence used to be asked for. (The first cut of it asked the palette's
  // own warmth as the old classifier did, and vetoed the Stelvio's scree: a
  // grey lichen pass reads warm 0.009 and grain 0.25, which is one gate short
  // of a snowfield's on BOTH routes.)
  snowLo: 0.005, snowHi: 0.045,
  coverGrass: 0.8, coverMantle: 0.45, rockCover: 0.85,
  grassLo: 0.28, grassHi: 0.82, grassVegLo: 0.01, grassVegHi: 0.13, grassFace: 0.55,
  dampTone: 0.14,
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
// ── THE DOMAIN: WHERE ONE MATERIAL GIVES WAY TO ANOTHER INSIDE ONE FIELD CELL ──
//
// The geomorphic field's own lattice is about thirty-three metres, which is the
// brief's band A (30-150 m) and is where the LANDFORM lives. This is band B
// (5-30 m): the patchiness inside one cell, so a hillside the field calls
// half-exposed is outcrop and fill in patches rather than a uniform half.
// Three octaves at s = 18 m are 47 m, 18 m and 7.6 m, so a patch has a broad
// bias, an irregular body and a ragged edge. Returned about a mean of a half,
// because every caller shifts by (dom - 0.5).
float subDomain(vec2 gp, float s) {
  float d = tdVN(gp / (s * 2.6)) + tdVN(gp / s) * 0.55 + tdVN(gp / (s * 0.42)) * 0.25;
  return clamp(0.5 + d * 0.62, 0.0, 1.0);
}
// ── THE FALL LINE'S FRAME ──
//
// Every anisotropic term downstream is written in it, because gravity is what
// organises a hillside: scree elongates down it, fines wash along it, strata
// cross it. The field's flow channels carry the downhill unit vector; a flat
// cell has no fall line at all, so the frame falls back to the world axes
// rather than normalising a zero and producing a NaN that would paint black.
void subBasis(vec2 flow, out vec2 down, out vec2 across) {
  float m = length(flow);
  down = m > 1.0e-3 ? flow / m : vec2(0.0, 1.0);
  across = vec2(-down.y, down.x);
}
// Ground coordinates stretched along the fall line: ka metres a lattice unit
// across it, kd metres along. Read any noise in this frame and its features
// come out as tongues rather than blobs — which is what a scree apron, a wash
// fan and a rill actually look like, and what an isotropic FBM can never say.
vec2 subAniso(vec2 gp, vec2 down, vec2 across, float ka, float kd) {
  return vec2(dot(gp, across) / ka, dot(gp, down) / kd);
}
// ── A LINE THAT KNOWS ITS OWN PHASE ──
//
// u is a phase in periods and the line sits at each half-integer. fwidth(u) is
// how much of a period THIS fragment spans, so the line is widened to its own
// footprint and then faded out before that footprint can alias it.
//
// PHASE-AWARE RATHER THAN BAND-LIMITED IN METRES, and the difference is not
// cosmetic. A bedding phase is warped, read along a dip and measured up the
// world Y, so the period it presents to the screen is not the period it has in
// the ground: tdBand would cut a line that is still perfectly resolvable where
// the strata run across the view, and keep one that is not where they run into
// it. The derivative is the only thing that knows which.
//
// A NOTE ON WHERE THIS MAY BE CALLED FROM. A derivative is undefined for the
// helper lanes of a quad that did not take the branch, so every gate above a
// call to this has to be a quantity that is SMOOTH across the screen — the
// field's own channels (bilinear over a 33 m lattice) and the art-pixel
// footprint, never the domain noise or a classification built on it.
float subLine(float u, float w) {
  float fw = fwidth(u);
  float fade = 1.0 - smoothstep(w * 1.2, w * 4.0, fw);
  if (fade <= 0.001) return 0.0;
  float d = abs(fract(u) - 0.5);
  return (1.0 - smoothstep(w, w + fw * 0.75, d)) * fade;
}
// ── THE FOUR ROCK STRUCTURE FAMILIES, AS A SMOOTH PARTITION ──
//
// rockFamily rides in one byte as 0 massive, 1/3 bedded, 2/3 fractured,
// 1 loose, and it is INTERPOLATED across the field's lattice — so a hillside
// that changes character does it over thirty metres rather than at a line.
// Tent functions three wide give weights that sum to one everywhere.
//
// CHOSEN BY CONTEXT, NEVER ROLLED. A steep high-exposure face is massive or
// jointed, a broad hillside with contour expression is bedded, a debris zone
// is broken; that decision is the field's (see buildSubstrateCells) and this
// only reads it. A random family per patch is the motif-stamping fault the
// whole rewrite exists to end.
vec4 subFam(float f) {
  return clamp(1.0 - abs(vec4(0.0, 0.3333, 0.6666, 1.0) - f) * 3.0, 0.0, 1.0);
}
// ── BEDDING, AND THE ONE LINE THAT MAKES ROCK READ AS ROCK ──
//
// A sedimentary bed is a near-horizontal layer, so the line where it meets the
// hillside — its outcrop trace — is a contour of (y + dip.xz). PHASING ON THE
// WORLD Y IS THE WHOLE TRICK: the bands then wrap round a spur, climb a gully
// and close up where the ground steepens, exactly as real strata do, for one
// dot product. A purely horizontal noise, however well tuned, lies flat across
// the slope and reads as paint on a hill rather than as the hill's own
// structure. Returns 1 in the bedding plane's shadow and 0 on the bed's face.
float subBed(vec3 p, vec2 dip, float thick, float warp) {
  // A BED IS NOT A PERIOD. fract(u) at one thickness is a perfectly regular
  // comb, and over an alpine hillside that is not strata, it is CORDUROY —
  // reported from the seat at the Stelvio as long parallel ribs running across
  // the whole frame in one direction. The warp argument is the caller's slow
  // phase drift, so the spacing stretches and bunches instead of ticking.
  float u = (p.y + dot(p.xz, dip)) / max(thick, 0.05) + warp;
  // …and the strength is keyed on the bed INDEX, not the position, so a
  // resistant bed is resistant along its whole outcrop — which is what makes a
  // bedding plane read as one bed seen across a hillside rather than as a
  // texture.
  return subLine(u, 0.10) * (0.22 + 0.78 * tdH(vec2(floor(u), 17.0)));
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
  return subLine(dot(gp, dir) / max(spacing, 0.05), 0.08);
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
// ── BAND D: THE HALF-METRE, AND WHOSE HALF-METRE IT IS ──
//
// The brief put this band last and said so — *5-50 m coherent domains +
// 0.5-5 m material structure. Not micro-detail first* — and that was right:
// a landscape is read at the scale of its landforms, and no amount of grain
// makes a wash into a hillside.
//
// But the band was never EMPTY. The detail cascade's third octave has been
// drawing at 0.25 m since long before any of this, keyed on the COVER class
// through the rough and grain attributes, so a metre from the wheel a granite
// face and a ploughed field wore the same speckle — a cover class is the one
// thing that cannot tell them apart. What follows is the same band with the
// material's own answer in it, and the cascade's octave stands down where it
// draws (see the fragment) so that two noises never describe one half-metre.
//
// EVERY TERM HERE IS LOUD, and that is the doctrine's own rule rather than a
// choice: one palette step is 0.07 sRGB, and a term this close to the eye is
// as far from Nyquist as anything in the renderer ever gets. What it must not
// do is draw at all once it cannot be resolved, which is what the bands are.
//
// AND IT COSTS THE RELIEF NOTHING. The lighting normal differentiates these
// same tones, so a crack recesses and a crystal stands proud without a second
// field, a second uniform or a second decision about where the light is.
float subRockMicro(vec2 gp, vec2 dip, vec4 fam, float px) {
  // The crystal grain every rock has: a sharpened noise, so it reads as a
  // scatter of light and dark flecks rather than as a damp wash.
  float t = 0.10 * tdGrain(tdVN(gp * 5.5), 0.85) * tdBand(px, 0.18);
  // Hairline cracks, square to the dip and along it — the joint sets one
  // scale down, and a crack is a SHADOW, which is the one feature this
  // palette renders well.
  if (px < 0.12) {
    vec2 n = vec2(-dip.y, dip.x);
    vec2 dir = normalize(dot(n, n) > 2.5e-3 ? n : vec2(0.31, 0.95));
    float hair = subLine(dot(gp, dir) / 0.45, 0.07)
               + 0.7 * subLine(dot(gp, vec2(-dir.y, dir.x)) / 0.62, 0.07);
    t -= 0.075 * (fam.x * 0.5 + fam.z) * hair;
  }
  // …and a broken face is pitted rather than cracked: there is no coherent
  // plane left in it to crack along.
  t += 0.08 * fam.w * tdVN(gp * 9.0) * tdBand(px, 0.11);
  return t;
}
float subMantleMicro(vec2 gp, float scree, float px) {
  // Fines are crumb — soil aggregates a centimetre or two across, gently
  // sharpened. Coarse debris is chips, which are thresholded and sparse,
  // so the two read as different SURFACES and not as one noise at two gains.
  float t = 0.10 * (1.0 - scree) * tdGrain(tdVN(gp * 8.0), 0.55) * tdBand(px, 0.125);
  if (px < 0.14) {
    t += 0.13 * scree * (subStones(gp, 0.14, 0.55) - 0.10) * tdBand(px, 0.28);
  }
  return t;
}
// ── LAYER A: THE BEDROCK'S OWN STRUCTURE, BY FAMILY ──
//
// A tone, not a weight: the field decides WHERE rock shows and this decides
// what it looks like once you are close enough for the question to mean
// anything. Zero-mean, so rock seen from far enough that its structure has
// faded is the same average colour as rock seen from the cab.
//
// EVERY TERM IS LOUD BY THE STANDARDS OF A TEXTURE, and can afford to be. A
// tone reaches the frame as tone x visibility x the material's colour, so at
// Yosemite — rock 0.46 on ground at 0.72 — an amplitude of 0.13 arrives as
// 0.043, six tenths of a palette step, and spends its life modulating the
// dither. The first cut's bedding was invisible in the frame while the
// classification under it was correct.
float subRockTone(vec3 p, vec2 gp, vec2 down, vec2 across, vec4 fam, float px, float mic) {
  // BAND A (30-150 m): the massing every family shares — the broad tonal
  // difference between one face of an outcrop and the next, which is what
  // makes a cliff read as a cliff from a kilometre away.
  float t = 0.10 * tdVN(gp * (1.0 / 70.0)) * tdBand(px, 70.0)
          + 0.07 * tdVN(gp * (1.0 / 26.0)) * tdBand(px, 26.0);
  if (px > 3.5) return t;
  vec2 dip = subDip(gp);
  // BAND B (5-30 m): the spacing wanders over forty and thirteen metres, which
  // is the scale a fold actually bends strata at. A drift of one bed over
  // ninety metres was the first attempt and it moved the comb's own
  // autocorrelation by a twentieth — nothing.
  float warp = tdVN(gp * (1.0 / 40.0)) * 2.2 + tdVN(gp * (1.0 / 13.0)) * 0.55;
  // AND AN OUTCROP IS NOT CONTINUOUS. Real bedding shows where rock is exposed
  // and is buried by scree and soil between; drawn unbroken across a hillside
  // it reads as corduroy however irregular its spacing.
  float show = 0.30 + 0.70 * smoothstep(-0.18, 0.16, tdVN(gp * (1.0 / 14.0)));
  // BAND C (0.5-5 m): the lines themselves, each fading on its own phase.
  float bed = subBed(p, dip, 4.5, warp) + 0.62 * subBed(p, dip, 1.2, warp * 3.0);
  // Two joint sets for the fractured family — square to the dip and along it,
  // which is what breaks a bed into blocks rather than into slats.
  float joint = subJoint(gp, dip, 3.2) + 0.6 * subJoint(gp, vec2(dip.y, -dip.x), 5.1);
  // A LOOSE, BROKEN FACE HAS NO COHERENT LINE AT ALL, so it gets clasts in the
  // fall line's frame instead: a rubble slope's fragments lie in trains down
  // the slope, not in a circular scatter.
  float clast = 0.0;
  if (px < 0.7) {
    clast = (subStones(subAniso(gp, down, across, 1.4, 3.4), 0.5, 0.58) - 0.16) * tdBand(px, 1.4);
  }
  t -= 0.24 * show * fam.y * bed;
  t -= 0.14 * show * (fam.x * 0.35 + fam.z) * joint;
  t += 0.05 * fam.x * tdVN(gp * 0.30) * tdBand(px, 3.3);
  t += 0.18 * fam.w * clast;
  // BAND D (0.1-0.5 m): the crystal grain, the hairlines and the pitting. It
  // is inside the tone rather than beside it so that the relief pass — which
  // differentiates this one number — catches it for nothing.
  if (px < 0.36 && mic > 0.001) t += mic * subRockMicro(gp, dip, fam, px);
  return t;
}
// ── LAYER B: THE REGOLITH, DEBRIS AND SOIL MANTLE ──
//
// scree is the coarse share of the mantle (debris against fines) and decides
// which of two quite different surfaces this is: a tongue of angular blocks,
// or a wash of fines with a few stones in it.
float subMantleTone(vec2 gp, vec2 down, vec2 across, float scree, float mo, float px, float mic) {
  // THE APRON IS A TONGUE, NOT A BLOB. Read in the fall line's own frame,
  // nearly four times longer downhill than across, so a scree patch elongates
  // the way scree lies. This is the anisotropy the brief asked for and the
  // reason the debris channel walks the fall line at all.
  float t = 0.0;
  if (px < 5.0) {
    vec2 lob = subAniso(gp, down, across, 9.0, 34.0);
    t += (tdVN(lob) * 0.55 + tdVN(lob * 2.6) * 0.28) * scree * 0.30 * tdBand(px, 9.0);
  }
  if (px < 1.0) {
    // Channels within the apron: a much narrower frame, so fines wash into
    // rills between the coarse tongues rather than dusting them evenly.
    t += tdVN(subAniso(gp, down, across, 1.8, 14.0)) * scree * 0.16 * tdBand(px, 1.8);
  }
  // The fines' own metre-scale tonal regions — damp and dry, fine and coarse.
  t += 0.12 * tdVN(gp * 0.4) * (1.0 - scree * 0.6) * tdBand(px, 2.5);
  if (px < 0.45) {
    // …and the clasts lying on them, LIGHTER than the fill they sit on because
    // a stone catches the sky and dirt does not.
    t += 0.19 * (subStones(gp, 0.45, 0.62) - 0.12) * (0.35 + scree * 0.65) * tdBand(px, 0.9);
  }
  // Damp ground is darker. The moisture channel is the one thing here that the
  // BAND D (0.1-0.5 m): crumb on the fines, chips on the scree. Same reason
  // it sits inside the tone: subRelief reads this number and nothing else.
  if (px < 0.25 && mic > 0.001) t += mic * subMantleMicro(gp, scree, px);
  // Damp ground is darker. The moisture channel is the one thing here that the
  // palette cannot say at all, and it is why a hollow reads as a hollow.
  return t - mo * ${K.dampTone};
}
// ── LAYER C: THE GRASSY COMPLEMENT ──
//
// Clumped at the scale a tussock holds. It SUBDUES the mineral structure
// rather than replacing it — see subExpress — so a meadow keeps the stones
// showing through it.
float subGrassTone(vec2 gp, float px) {
  float t = 0.075 * tdVN(gp * 0.22) * tdBand(px, 4.5);
  if (px < 0.55) t += 0.13 * tdVN(gp * 0.9) * tdBand(px, 1.1);
  return t;
}
// ── THE LAYERS' COLOURS ──
vec3 subRockC(vec3 c, float lum) { return mix(vec3(lum), c, ${K.rockChroma}) * vec3(${K.rockR}, ${K.rockG}, ${K.rockB}); }
vec3 subSoilC(vec3 c) { return c * vec3(${K.soilR}, ${K.soilG}, ${K.soilB}); }
vec3 subScreeC(vec3 c, float lum) {
  return (mix(vec3(lum), c, ${K.rockChroma}) + ${K.screeLift}) * vec3(${K.screeR}, ${K.screeG}, ${K.screeB});
}
vec3 subGrassC(vec3 c) { return c * vec3(${K.grassR}, ${K.grassG}, ${K.grassB}); }
// ── HOW MUCH OF EACH LAYER IS EXPRESSED ──
//
// Returns (mantle, rockVisible, grassCover). These are SHARES OF WHAT CAN BE
// SEEN, not weights of a partition, and that is the whole difference between
// phase C and what it replaced: rock, regolith and grass are not three
// competing materials, they are three layers stacked on one another, and the
// substrate exists under all of them whether or not anything is standing on it.
//
// gpot is stretched rather than read raw. Measured over Yosemite in phase B,
// grassPot sits at 0.55-0.75 across most of the ground off the walls, so as a
// modulator it has almost no dynamic range; the smoothstep spends the range it
// does have on the band where it varies.
vec3 subExpress(float ex, float db, float sd, float gpot, float veg, float grain) {
  // THE MANTLE FILLS WHAT THE BEDROCK DOES NOT, and the supply is stretched
  // rather than read raw. The first cut multiplied the supply by (1 - ex) as
  // well, which double-counts: rock visibility already takes the mantle off a
  // face, and the field's own soilDepth already subtracts exposure. Measured at
  // the Stelvio, that left a third of a scree slope drawn as the untouched
  // palette — an arithmetic leftover of two independent mixes standing in for a
  // material nobody had named.
  float mineral = smoothstep(${K.snowLo}, ${K.snowHi}, grain);
  float mantle = smoothstep(${K.mantleLo}, ${K.mantleHi},
    sd * ${K.mantleSoil} + db * ${K.mantleDebris}) * mineral;
  // THE PALETTE STILL HOLDS THE VETO. grassPot is blind to climate — it is a
  // topographic argument about where fines and water end up — so a snowfield
  // and a desert pavement would both grow a lawn on it alone. The palette's
  // own green is what says anything grows here at all.
  float grass = smoothstep(${K.grassLo}, ${K.grassHi}, gpot)
              * smoothstep(${K.grassVegLo}, ${K.grassVegHi}, veg)
              * (1.0 - ex * ${K.grassFace});
  float cover = clamp(grass * ${K.coverGrass} + mantle * ${K.coverMantle}, 0.0, 1.0);
  return vec3(mantle, ex * (1.0 - cover * ${K.rockCover}) * mineral, grass);
}
// ── AND THE COMPOSITE, IN ORDER OF DEPOSITION ──
//
// The bedrock is the ground, the mantle lies on it, the rock that is still
// exposed cuts back through, and the vegetation tints what is left. Layered,
// never winner-take-all: at every point all four are present and what varies
// is how much of each you can see.
vec3 subCompose(vec3 base, vec3 mantleC, vec3 rockC, vec3 grassC, vec3 e) {
  vec3 c = mix(base, mantleC, e.x);
  c = mix(c, rockC, e.y);
  return mix(c, grassC, e.z);
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
/**
 * -- THE COVER CLASS'S OWN [rough, grain], AND WHY IT IS STILL HERE --
 *
 * The three-material classifier that used to live under this heading is gone:
 * phase C took it out of the fragment and phase D took it off the sward, which
 * was its last reader. What survives is the TABLE, because the terrain kernel
 * inlines a copy of it - its closure is stringified into a worker and may not
 * touch a module binding - and this is the source of record that copy is held
 * against. See devtools/substrate-field.test.mjs.
 */
export const SUB_MAT: Readonly<Record<number, readonly [number, number]>> = Object.freeze({
  10: [0.40, 0.30], 20: [0.60, 0.50], 30: [0.35, 0.15], 40: [0.28, 0.05],
  50: [0.50, 0.20], 60: [1.00, 0.85], 70: [0.25, 0.00], 80: [0.00, 0.00],
  90: [0.30, 0.10], 95: [0.35, 0.20], 100: [0.45, 0.25],
});
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

/**
 * ── HOW MUCH OF EACH LAYER IS EXPRESSED, ON THE CPU ──
 *
 * `subExpress`, term for term, on the same shared constants. The CONSTANTS
 * cannot drift (SUB_K is substituted into the GLSL above); the ARITHMETIC is
 * written twice because there is no way to call a fragment from the main
 * thread, and that is stated rather than hidden — the same bargain
 * `subDomainAt` makes with `subDomain`, and this one is exact rather than
 * approximate, since it reads the field's own bytes rather than a noise.
 *
 * Nothing in the game calls it yet: phase D is where the sward stops asking
 * the retired classifier and asks this instead. It exists now because it is
 * what `devtools/substrate-field.test.mjs` holds the layered model's claims
 * against, and a claim nothing can test is a claim nobody can argue with.
 */
export interface SubExpress {
  /** Regolith and debris lying over the bedrock. */
  mantle: number;
  /** Bedrock still showing THROUGH whatever lies on it — never zero where
   *  there is any exposure at all, which is the whole of phase C. */
  rock: number;
  /** Vegetation tinting the result; it subdues the mineral surface and does
   *  not replace it. */
  grass: number;
}
export function subExpressOf(ex: number, db: number, sd: number, gpot: number,
  veg: number, grain: number): SubExpress {
  const cl = (v: number): number => Math.min(1, Math.max(0, v));
  const mineral = sstep(K.snowLo, K.snowHi, grain);
  const mantle = sstep(K.mantleLo, K.mantleHi, sd * K.mantleSoil + db * K.mantleDebris) * mineral;
  const grass = sstep(K.grassLo, K.grassHi, gpot) * sstep(K.grassVegLo, K.grassVegHi, veg)
    * (1 - ex * K.grassFace);
  const cover = cl(grass * K.coverGrass + mantle * K.coverMantle);
  return { mantle, rock: ex * (1 - cover * K.rockCover) * mineral, grass };
}

/** The cover class's own mineral verdict, which is the snow-and-water veto
 *  `subExpressOf` asks for. `subMatOf` returns it too, but that carries the
 *  retiring classifier's slope arithmetic with it and this does not. */
export function subGrainOf(cover: number | null): number {
  const m = cover === null || cover === undefined ? undefined : SUB_MAT[cover];
  return m ? m[1] : 0.5;
}
/**
 * ── THE LAYERED COMPOSITE, ON THE CPU ──
 *
 * `subCompose` term for term, on the same shared transforms: the bedrock, the
 * mantle over it, the rock still showing through, the grassy complement. What
 * it is FOR is a blade fading toward the ground it is standing in — so a tuft
 * on an outcrop is the colour the fragment painted that outcrop rather than
 * the tile's mean — and that only works if it is the same arithmetic.
 *
 * At the domain's own mean, deliberately. The fragment shifts exposure and
 * debris by (dom - 0.5) at eighteen metres, and a CPU reader pretending to
 * reproduce a noise it cannot call is the drifting mirror this file keeps
 * warning about. A blade is a centimetre object standing on a tuft; what it
 * needs is the material, not the material's own speckle.
 */
export function subLayerTint(r: number, g: number, b: number, e: SubExpress): [number, number, number] {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const rk: [number, number, number] = [
    (lum + (r - lum) * K.rockChroma) * K.rockR,
    (lum + (g - lum) * K.rockChroma) * K.rockG,
    (lum + (b - lum) * K.rockChroma) * K.rockB];
  const so: [number, number, number] = [r * K.soilR, g * K.soilG, b * K.soilB];
  const gr: [number, number, number] = [r * K.grassR, g * K.grassG, b * K.grassB];
  const mix3 = (a: number, c: number, t: number): number => a + (c - a) * t;
  const out: [number, number, number] = [r, g, b];
  const base: [number, number, number] = [r, g, b];
  for (let i = 0; i < 3; i++) {
    let c = mix3(base[i], so[i], e.mantle);
    c = mix3(c, rk[i], e.rock);
    out[i] = mix3(c, gr[i], e.grass);
  }
  return out;
}

/**
 * ── HOW MUCH GRASS THE SUBSTRATE ALLOWS ──
 *
 * These constants are the SWARD'S OWN and are deliberately not in SUB_K: they
 * decide how many BLADES stand, which is a question the fragment has no opinion
 * about. What must be shared is the field and the transforms, and both are.
 */
export const SUB_SWARD_K = Object.freeze({
  /** How much of the sward the most mineral ground can take away. A face still
   *  carries a fifth of what the cover class asked for, which is the brief's
   *  own *grass survives at exposure 0.5* and the difference between a hillside
   *  that shades from meadow into scree and one with a line drawn across it. */
  thin: 0.8,
  /** …and coarse debris counts for less than half of bare rock. Grass grows
   *  poorly in active scree and not at all on stone. */
  scree: 0.45,
});
/**
 * A MULTIPLIER ON WHAT THE COVER CLASS ALREADY ASKED FOR, which is why it is
 * this shape and not the grassy cover share itself.
 *
 * The first cut multiplied density by `e.grass`, the same number the fragment
 * tints with, on the reasoning that one field should give one answer. Measured
 * at Camps Bay that took the mean density down **43%** — because `e.grass` is
 * a share of the SURFACE ("how much of this ground looks grassy") and GRASS_M2
 * is already a density ("how many tufts a square metre of this cover class
 * grows"). Multiplying the two applies the same claim twice and halves every
 * meadow in the world, which is the fault SWARD_LUSH exists to have fixed.
 *
 * What the substrate knows that the cover class does not is the MINERAL share:
 * the bedrock the fragment is drawing through the cover, and the coarse debris
 * under it. So this stays near 1 on soft ground and thins where there is stone,
 * which leaves the correlation the sward is judged on and takes the blanket
 * halving away.
 */
export function subGrassAllow(e: SubExpress, debris: number, soilDepth: number): number {
  const scree = debris / Math.max(debris + soilDepth, 1e-3);
  const mineral = Math.min(1, e.rock + scree * SUB_SWARD_K.scree * (1 - e.rock));
  return 1 - SUB_SWARD_K.thin * mineral;
}
