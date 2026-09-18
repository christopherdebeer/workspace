/**
 * ── THE COVER RASTER IS AN OBSERVATION, NOT A FENCE ──
 *
 * Reported from the seat as hard rectilinear edges in the grass, and the
 * diagnosis was exact: the sward's base density was
 *
 *     density = GRASS_M2[sampleCover(x, z)] * lift
 *
 * with `sampleCover` a NEAREST-NEIGHBOUR read of a z12 raster — about 30 m a
 * pixel at mid latitude. So the field said *this 30 m square is grass, density
 * 0.85; the one beside it is bare, density 0* and the 8 m sward lattice, its
 * LinearFilter texture and every distance-band fade downstream could only turn
 * a 30 m categorical step into an 8-16 m ramp about a geometrically straight
 * edge. The plateaus were still square.
 *
 * ── AND THE TERRAIN ALREADY KNEW BETTER ──
 *
 * `coverPaint` exists in main.ts for exactly this reason — do not let raster
 * pixels appear literally in the world — and jitters its lookup so the ground
 * COLOUR gets an organic boundary. The sward bypassed it and read the raw
 * class, so the colour transition was irregular and the density transition was
 * a rectangle over the top of it. That discrepancy is the whole bug.
 *
 * ── SO THE CLASS BECOMES EVIDENCE, AND THE EVIDENCE IS CONTINUOUS ──
 *
 * `swardCoverEvidence` reads the class at several points over a footprint about
 * the size of one cover texel and returns a weighted tendency, so a boundary
 * arrives as 0.85 · 0.71 · 0.52 · 0.31 · 0.12 rather than 0.85 | 0. The sample
 * POSITIONS are warped by a low-frequency field first, so what comes out is an
 * irregular transition rather than a blurred straight raster edge — which is
 * the difference between this and simply blurring WorldCover, and blurring
 * WorldCover would cost the mapped boundaries (a field, a wood, a lake margin)
 * that are genuinely sharp and genuinely there.
 *
 * ── TWO CLASSES ARE SURFACES AND ARE NOT SOFTENED ──
 *
 * Water and snow are not points on a vegetation continuum with a classifier's
 * threshold drawn through them; they are things lying on the ground, and their
 * edge is a real edge that the bank and shore rules own. A kernel that averaged
 * across them would grow grass out over a lake — measured in the arithmetic: a
 * water texel with four grassy neighbours comes out at 0.57 of full meadow. So
 * the centre's own class vetoes, and only then does the neighbourhood speak.
 *
 * ── AND BARE IS NO LONGER MATHEMATICALLY IMPOSSIBLE GRASS ──
 *
 * `bare` was 0, so no amount of smooth geology downstream could soften that
 * zero: a substrate factor of 0.2 times 0 is still 0. But WorldCover's
 * "bare / sparse vegetation" is a categorical observation at raster scale and
 * can perfectly well hold isolated tufts, weeds, dry grass between rocks and
 * anything under its own classification threshold. These are PRIORS with
 * floors now, and the continuous fields — the substrate's mineral share, the
 * altitude lift, the guild — do the rest.
 */

/** How many tufts a square metre a class ARGUES FOR, before anything else
 *  speaks. Water and snow are the two real zeroes; see the header. */
export const GRASS_M2: Record<number, number> = {
  10: 0.30,   // tree     — forest floor, thinner than open ground
  20: 0.40,   // shrub
  30: 0.85,   // grass    — the case this exists for
  40: 0.55,   // crop
  50: 0.08,   // built    — verges, waste ground, the gaps
  60: 0.07,   // bare     — tufts between the rocks, NOT nothing
  70: 0,      // snow
  80: 0,      // water
  90: 0.70,   // wetland
  95: 0.35,   // mangrove
  100: 0.18,  // moss
};
/** Where the raster has not reached. Abstains toward the middle rather than
 *  voting for bare ground, which would shave a sward off every tile that has
 *  not streamed yet and put it back a second later. */
export const GRASS_UNKNOWN = 0.35;
/** A class the table has no row for at all. */
export const GRASS_DEFAULT = 0.3;

/** The classes whose boundary is a SURFACE and not a threshold. */
const HARD_ZERO = new Set([70, 80]);

export const SWARD_EV = Object.freeze({
  /** Footprint radius in metres. About half a z12 cover texel at mid latitude,
   *  so the transition it produces spans roughly one texel — wide enough to
   *  stop reading as a straight line and narrow enough that a 60 m field or a
   *  30 m copse is still a field or a copse. */
  radiusM: 16,
  /** How far every tap is displaced by the warp, in metres, and the wavelength
   *  it turns over. A warp shorter than the footprint makes the boundary ragged
   *  at the scale the eye reads a patch edge at. */
  warpM: 11, warpLambdaM: 23,
  /** The centre's own weight against the eight ring samples' one each. Two
   *  keeps the class under the point dominant — a 40 m clearing is still a
   *  clearing — while letting the neighbourhood carry the edge.
   *
   *  TEN WEIGHT UNITS IS NOT AN ARBITRARY NUMBER. Over a binary boundary the
   *  evidence can only take as many values as there are weight units, so the
   *  step between adjacent levels is the class range over that count: five
   *  taps gave six levels and a 0.13 jump between them, which is a staircase
   *  rather than a ramp. Ten gives a worst step of 0.078, under a palette
   *  step's worth of density.  */
  centre: 2, rings: [0.55, 1.0],
});
const hashF = (a: number, b: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Value noise in metres, zero-mean, for the warp. Deterministic in world
 *  space, so a patch edge does not crawl as the sweep re-centres. */
function warpN(x: number, z: number, lambda: number): number {
  const fx = x / lambda, fz = z / lambda;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  let tx = fx - ix, tz = fz - iz;
  tx = tx * tx * (3 - 2 * tx); tz = tz * tz * (3 - 2 * tz);
  const a = hashF(ix, iz), b = hashF(ix + 1, iz);
  const c = hashF(ix, iz + 1), d = hashF(ix + 1, iz + 1);
  const top = a + (b - a) * tx, bot = c + (d - c) * tx;
  return (top + (bot - top) * tz) - 0.5;
}

export type CoverSampler = (x: number, z: number) => number | null;

/**
 * The continuous vegetation prior at a point, in tufts per square metre.
 *
 * `strength` 0 reproduces the old nearest-neighbour read EXACTLY (the centre
 * sample and nothing else), which is what makes it an A/B rather than an
 * opinion; 1 is the full neighbourhood. It is a parameter and not a constant
 * because the whole claim — that these edges are the raster's and not the
 * lattice's — is one a frame has to settle.
 */
export function swardCoverEvidence(cover: CoverSampler, x: number, z: number,
  strength = 1): number {
  const c0 = cover(x, z);
  // The veto, before anything else: water and snow own their own edges.
  if (c0 !== null && c0 !== undefined && HARD_ZERO.has(c0)) return 0;
  const rate = (c: number | null): number =>
    c === null || c === undefined ? GRASS_UNKNOWN : (GRASS_M2[c] ?? GRASS_DEFAULT);
  const mid = rate(c0);
  if (!(strength > 0)) return mid;
  const K = SWARD_EV, R = K.radiusM;
  // ── EVERY TAP IS WARPED, THE CENTRE INCLUDED, AND THAT IS THE WHOLE POINT ──
  //
  // The first cut warped only the ring and left the centre reading the class
  // literally under the point. Measured: the profile across a boundary DID
  // vary with z, and the half-way crossing did not move a metre in ninety —
  // because the centre carries two weight units of eight, so its own flip is
  // the largest single jump in the ramp and it happens exactly on the raster's
  // straight line. A soft ramp hung on a hard edge is still a hard edge.
  //
  // Warping the centre means the class at a point is not always the class the
  // raster holds there, which is exactly what `coverPaint` has done for the
  // ground colour since it was written, and for the same reason.
  const warp = (px: number, pz: number): [number, number] => [
    px + warpN(px, pz, K.warpLambdaM) * K.warpM * 2,
    pz + warpN(pz + 91.3, px - 37.7, K.warpLambdaM) * K.warpM * 2,
  ];
  const c = warp(x, z);
  let sum = rate(cover(c[0], c[1])) * K.centre, wsum = K.centre;
  for (const rf of K.rings) {
    for (let i = 0; i < 4; i++) {
      // The two rings are offset half a step from one another, so the eight
      // taps are spread round the circle rather than stacked on four bearings.
      const a = (i / 4 + (rf < 1 ? 0.125 : 0)) * Math.PI * 2 + 0.6;
      const w = warp(x + Math.cos(a) * R * rf, z + Math.sin(a) * R * rf);
      sum += rate(cover(w[0], w[1])); wsum += 1;
    }
  }
  const ev = sum / wsum;
  return mid + (ev - mid) * strength;
}
