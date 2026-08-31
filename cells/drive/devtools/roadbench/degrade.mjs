/**
 * CONTROLLED DEGRADATIONS — the layer that turns a fixture into evidence.
 *
 * Geographic variety alone is confounded: a road that solves badly in Norway
 * and well in Switzerland tells you nothing about WHY, because everything
 * differs at once. A degradation takes ONE reference surface and varies one
 * property of the input, so the difference in the answer has one cause.
 *
 * Every function here maps a height sampler to a height sampler. The solver
 * never learns which it is holding — `roadprofile.latCands` takes any
 * `(x, z) => number`, which is the whole reason the DP was lifted out of the
 * browser module.
 *
 * WHAT IS NOT HERE, DELIBERATELY: the real Terrarium tile. It belongs in the
 * suite as ONE input variant beside these, not as the only input and not as a
 * reference. Its faults (resolution, source provenance, tile seams) are among
 * the things being measured, so it cannot also be the measuring stick.
 */

/** A reference surface: a regular grid of heights in local metres. */
export function gridSampler({ x0, z0, cell, w, h, data }) {
  return (x, z) => {
    // Bilinear, clamped at the edges — a sampler that returns NaN off the
    // patch would make every degradation's edge behaviour its own experiment.
    const fx = Math.min(w - 1.001, Math.max(0, (x - x0) / cell));
    const fz = Math.min(h - 1.001, Math.max(0, (z - z0) / cell));
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const at = (a, b) => data[b * w + a];
    return at(ix, iz) * (1 - tx) * (1 - tz) + at(ix + 1, iz) * tx * (1 - tz)
      + at(ix, iz + 1) * (1 - tx) * tz + at(ix + 1, iz + 1) * tx * tz;
  };
}

/**
 * RESOLUTION LOSS. Terrarium at z14 is ~9.5m/px at the equator and coarser
 * with latitude; national LiDAR is 1m. The question this answers is how much
 * of a road's construction — a cutting, an embankment, a hairpin's bench — is
 * still recoverable after the grid can no longer see it.
 *
 * Block-mean rather than point-sampling, because that is what a real
 * downsample does: a 30m post is an AVERAGE of the ground, which is why a
 * shelf road narrower than the cell vanishes into the hillside rather than
 * surviving as a lucky sample.
 */
export function resample(sample, cell, { x0, z0, span } = {}) {
  const o0 = x0 ?? -2000, p0 = z0 ?? -2000, sp = span ?? 4000;
  const n = Math.max(2, Math.ceil(sp / cell));
  const grid = new Float64Array(n * n);
  const SUB = 3;                       // sub-samples per axis for the block mean
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let b = 0; b < SUB; b++) {
        for (let a = 0; a < SUB; a++) {
          acc += sample(o0 + (i + (a + 0.5) / SUB) * cell, p0 + (j + (b + 0.5) / SUB) * cell);
        }
      }
      grid[j * n + i] = acc / (SUB * SUB);
    }
  }
  return gridSampler({ x0: o0 + cell / 2, z0: p0 + cell / 2, cell, w: n, h: n, data: grid });
}

/**
 * HORIZONTAL DISPLACEMENT. OSM geometry and a national DEM are surveyed
 * independently and do not always agree about where a road is; 5-30m is an
 * ordinary disagreement on a mountain road digitised from imagery.
 *
 * This is the fault the lateral bench search exists to survive, so it is the
 * one degradation whose result should IMPROVE with the DP switched on — and
 * the one where a solver can cheat by matching truth at a place the road is
 * not. Score elevation where the road is DRAWN, and the bench offset
 * separately. See score.mjs.
 */
export function displace(sample, dx, dz) {
  return (x, z) => sample(x + dx, z + dz);
}

/** VERTICAL BIAS — a datum disagreement, which is a real and common one
 *  between national height systems. A shape score must survive it; an
 *  absolute-elevation score must not pretend to. */
export function bias(sample, dy) {
  return (x, z) => sample(x, z) + dy;
}

/**
 * TILE-BOUNDARY STEPS. Adjacent DEM tiles from different acquisitions can
 * disagree by tens of centimetres, and the seam runs straight across a road.
 * A solver that treats every disagreement as ground will build a step; one
 * that treats it as noise will smooth a real cliff. Both failures matter.
 */
export function tileSteps(sample, tile = 600, step = 0.4, seed = 1) {
  const h = (a, b) => {
    const s = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  return (x, z) => sample(x, z) + h(Math.floor(x / tile), Math.floor(z / tile)) * step;
}

/**
 * A DSM RATHER THAN A DTM: canopy and structures left standing. The failure
 * this provokes is a solver inventing vertical structure — a road climbing a
 * tree line, a phantom embankment under a hedge — which is exactly the New
 * Forest contrast in the design.
 *
 * `cover` decides where the canopy is, so a fixture can put trees on one side
 * of a road and not the other, which is the case that actually breaks a
 * symmetric bench search.
 */
export function dsm(sample, { cover, height = 18, softness = 6 }) {
  return (x, z) => {
    const c = Math.max(0, Math.min(1, cover(x, z)));
    if (c <= 0) return sample(x, z);
    // Canopy is not a flat lid: a soft top reads as a slope to any solver
    // looking for a bench, which is the point.
    const s = Math.sin(x * 0.21) * Math.cos(z * 0.19);
    return sample(x, z) + c * (height + s * softness * 0.5);
  };
}

/** WATER AS A FLAT BENCH. The flattest thing in reach of a coast road is the
 *  sea, and a bench search that does not know it will walk the road into it.
 *  A lake or a river held at a constant level, over whatever is beneath. */
export function water(sample, { inside, level }) {
  return (x, z) => (inside(x, z) ? level : sample(x, z));
}

/** Compose, left to right: `pipe(base, [resample(...), displace(...)])`. */
export const pipe = (sample, fns) => fns.reduce((s, f) => f(s), sample);

/**
 * FRAGMENTATION AND ARRIVAL ORDER. Nothing to do with elevation, and among
 * the most consequential inputs there is: the solver chains ways it can see,
 * and a road that arrives in six clipped pieces across four tiles is a
 * different problem from the same road arriving whole. Determinism regardless
 * of arrival order is a claim worth testing, not assuming.
 */
export function fragment(geometry, pieces) {
  const n = geometry.length;
  const cut = Math.max(2, Math.floor(n / pieces));
  const out = [];
  for (let i = 0; i < n - 1; i += cut - 1) {
    const part = geometry.slice(i, Math.min(n, i + cut));
    if (part.length >= 2) out.push(part);
  }
  return out;
}

/** A deterministic shuffle, so an "order" variant is reproducible. */
export function reorder(list, seed = 1) {
  const a = list.slice();
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Strip the semantics a solver may be leaning on, to measure what they are
 *  worth: bridge and tunnel tags, layer, and the class that sets max grade. */
export function stripTags(tags, which = ['bridge', 'tunnel', 'layer']) {
  const out = { ...tags };
  for (const k of which) delete out[k];
  return out;
}
