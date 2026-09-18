/**
 * ── THE COAST FIELD: TRAVEL TIME FROM THE WATERLINE, AND EXPOSURE ──
 *
 * The nearshore wave phases on the signed shore distance because a distance
 * is continuous by construction and its isolines are crest lines "to a first
 * approximation" (shaders.ts). The approximation is that a crest is the same
 * sixty metres from a steep rock shore as from a shelving beach, and that it
 * wraps a headland like a contour line. A real crest slows where the water
 * shallows — the finite-depth dispersion ω² = g·k·tanh(k·h) — so over a
 * shoal the crests bunch and turn parallel to the beach as they come in,
 * and round a headland they bend rather than wrap. That is refraction, and
 * it is one number per texel: the TRAVEL TIME from the waterline, solved as
 * the eikonal |∇T| = 1/c(h) by monotone Godunov fast sweeps (the ocean demo
 * this was gleaned from does the same over its authored seabed; here it is
 * per streamed tile, off the frame, in the hydro build). Stored in
 * DEEP-WATER METRES, T·c₀, so it IS the shore distance wherever the water is
 * deep and grows faster than distance where it is shallow: the shader can
 * put it into the same phase the distance was in and nothing else about
 * that phase changes. The dry side keeps signed shore distance (the run-up
 * phase), and the two meet at zero on the waterline.
 *
 * DEPTH IS TRUSTED ONLY WHERE THE DEM IS. The ocean mask's interior is fill,
 * not measurement (build-tile: "the mask rules offshore; depth shapes only
 * the edge"), so interior texels are solved as deep water — the field there
 * is the distance transform in other units — and refraction lives in the
 * edge band, which is where the surf zone is.
 *
 * EXPOSURE is the fourth channel: how much open sea a texel's seaward fan
 * reaches. Seven rays over ±72° about the seaward direction, marched out to
 * about a kilometre over the wet mask; one that meets land keeps almost no
 * energy, one that crosses a shallow keeps less each step, one that leaves
 * the grid counts as open. A harbour behind its arm reads a tenth, a bay
 * about a half, an open beach one. The shader damps the shore wave, the
 * breakers, the spill and the chop by it. Solved on a lattice of every
 * fourth texel and read back bilinearly — shelter is a hundred-metre thing
 * and the full march was a third of a build.
 */
import { clamp } from './geometry';

const G = 9.81;

export interface CoastFieldInput {
  width: number;
  height: number;
  /** Metres per texel. */
  pixelM: number;
  /**
   * ── THE MEDIUM ── 1 where the swell can stand or travel: any STANDING
   * water the caller hands in, whatever body it belongs to. Not merely the
   * texels the field is about. A land-cover polygon lying over the sea (False
   * Bay wears one 62,578 pixels across) is sea to a wave whatever its tag
   * says, and when the medium was the coastal kinds alone such a polygon was
   * BOTH a wall to the exposure fan AND, being outside the medium, a source
   * of travel at zero — a false waterline emitting crests from its own rim,
   * the very defect the travel field exists to remove. Land bounds the
   * medium, and so does a channel: a river is the caller's to exclude.
   */
  wet: Uint8Array;
  /** 1 where that water is the sea or a lagoon — what the field is ABOUT,
   *  which is a narrower thing than what the swell crosses. Stats only. */
  coastal: Uint8Array;
  /** 1 where the ocean mask's interior painted the texel: depth unknown, deep assumed. */
  interior: Uint8Array;
  /** Level minus ground, metres, per texel. Read only outside the interior. */
  depth: Float32Array;
  /** Deep-water wavelength of the swell the tile draws. */
  swellWavelengthM: number;
  /** Texels to the nearest dry texel, per texel — build-tile's own distance
   *  transform when it has one; solved here when it has not. */
  toDry?: Float32Array;
}

/** Texels to the nearest texel of `target` — the same two-pass chamfer as
 *  build-tile's, kept here so the solver stands alone in a test. */
function chamfer(mask: Uint8Array, width: number, height: number, target: number): Float32Array {
  const inf = 1e9;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] === target ? 0 : inf;
  const rt2 = Math.SQRT2;
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const i = z * width + x;
    if (x > 0) out[i] = Math.min(out[i], out[i - 1] + 1);
    if (z > 0) out[i] = Math.min(out[i], out[i - width] + 1);
    if (x > 0 && z > 0) out[i] = Math.min(out[i], out[i - width - 1] + rt2);
    if (x + 1 < width && z > 0) out[i] = Math.min(out[i], out[i - width + 1] + rt2);
  }
  for (let z = height - 1; z >= 0; z--) for (let x = width - 1; x >= 0; x--) {
    const i = z * width + x;
    if (x + 1 < width) out[i] = Math.min(out[i], out[i + 1] + 1);
    if (z + 1 < height) out[i] = Math.min(out[i], out[i + width] + 1);
    if (x + 1 < width && z + 1 < height) out[i] = Math.min(out[i], out[i + width + 1] + rt2);
    if (x > 0 && z + 1 < height) out[i] = Math.min(out[i], out[i + width - 1] + rt2);
  }
  return out;
}

export interface CoastFieldStats {
  cycles: number;
  coastalTexels: number;
  /** The band's sweeps alone; `solveMs` adds the far field's growth. */
  sweepMs: number;
  solveMs: number;
  exposureMs: number;
}

export interface CoastField {
  /** RGBA per texel: travel (deep-water metres), seaward direction x, z, exposure. */
  data: Float32Array<ArrayBuffer>;
  stats: CoastFieldStats;
}

/** The shader's own swell wavelength for a body's fetch, at uWaveLength = 1:
 *  38 m for a pond, 140 m for the open sea, on the same log ramp.
 *
 *  IT HAS TO BE THE SHADER'S NUMBER, not a number of its own. The field is
 *  the travel time of the wave the vertex draws; solved for a longer swell
 *  than the one being phased on it, the refraction bends the wrong crests
 *  and the shoaling starts in water that swell would not yet feel. It moved
 *  from 240 with the shader's steepness pass — see the wavelength note in
 *  shaders.ts — and a shorter swell feels the bottom later, so the crawl
 *  below now begins closer in, which is the physics and not a tuning. */
export function swellWavelengthM(fetchM: number): number {
  const fetchScale = clamp(Math.log2(Math.max(fetchM, 80) / 80) / 8, 0, 1);
  return 38 + (140 - 38) * fetchScale;
}

/** Slowness (seconds per metre) of a swell of deep-water wavenumber k0 over
 *  depth h — Newton on the dispersion relation, five steps, as the demo. */
export function swellSlowness(k0: number, h: number): number {
  const omega2 = G * k0;
  let k = Math.max(k0, Math.sqrt(omega2 / (G * h)));
  for (let j = 0; j < 5; j++) {
    const t = Math.tanh(k * h);
    k = Math.max(k0, k - (G * k * t - omega2) / (G * (t + k * h * (1 - t * t))));
  }
  return k / Math.sqrt(omega2);
}

export function solveCoastField(input: CoastFieldInput): CoastField {
  const { width, height, pixelM, wet, coastal, interior, depth } = input;
  const n = width * height;
  const t0 = performance.now();
  const k0 = (2 * Math.PI) / Math.max(1, input.swellWavelengthM);
  const c0 = Math.sqrt(G / k0);
  const deepStep = pixelM / c0;
  // THE CRAWL IS CAPPED AT THREE TIMES DEEP. Half a metre of water carries a
  // 140 m swell at two metres a second against fifteen offshore, so the
  // last wet texel would be worth ten texels of deep-water metres — one and
  // a half shore wavelengths of phase inside the 18.75 m the field can
  // resolve, which is aliasing, not shoaling. At three times, the crests
  // bunch to a third of their offshore spacing over the shelf, still two
  // texels apart at the tightest, and the refraction (which needs only the
  // RELATIVE speeds across a section) keeps its shape.
  const SLOW_MAX = 3;
  const deepSlow = 1 / c0;
  // ── AND THE SOLVE READS A BEACH PROFILE, NOT THE FILL ──
  // Terrarium encodes open water as zero, so `depth` is the resting datum
  // everywhere offshore — 0.40 m at Camps Bay, a kilometre out. Fed to the
  // dispersion, that is ten times slower than deep water at EVERY texel,
  // which the cap below flattens to a uniform three: no gradient, therefore
  // no refraction at all, and a phase coordinate stretched threefold across
  // the whole nearshore. So the solve reads the same one-in-seventeen shelf
  // the wave shader reads (shaders.ts explains the slope), off the distance
  // transform it already has — the two must agree about where the bottom is
  // — and the deeper of shelf and datum wins, so real soundings survive
  // wherever a tile carries them.
  const SHELF = 0.06;
  // ── THE SWEEP IS A BAND; THE FAR FIELD IS GROWN FROM IT ──
  // The shader reads the travel as a phase only within the nearshore
  // crossfade (120 m of it) and whatever a shoal stretches that to. So the
  // eikonal is swept over the sixteen texels (300 m) nearest the waterline
  // and the sea beyond is filled by a two-pass chamfer seeded with the
  // band's converged values at the deep-water step — which IS the eikonal
  // at constant speed, to the chamfer's four per cent, the same error the
  // shore distance the phase used to ride already had. Monotone by
  // construction, no seam at the band's edge. Measured warm at 140²: the
  // whole grid swept was 7 ms a tile; band and chamfer are under 4 with the
  // exposure fan, which still marches over every sea texel.
  const BAND = 16;
  const toDry = input.toDry ?? chamfer(wet, width, height, 0);
  const medium = new Uint8Array(n);
  // Seconds to cross one texel, per band texel; land and other water are
  // walls, the far field is fixed and carries no step.
  const step = new Float32Array(n);
  const INF = 1e9;
  const T = new Float32Array(n);
  let coastalTexels = 0;
  for (let i = 0; i < n; i++) {
    if (!wet[i]) continue;
    medium[i] = 1;
    if (coastal[i]) coastalTexels++;
    T[i] = INF;
    if (toDry[i] > BAND) continue;
    const h = Math.max(depth[i], toDry[i] * pixelM * SHELF, 0.35);
    step[i] = interior[i] ? deepStep
      : Math.min(swellSlowness(k0, h), deepSlow * SLOW_MAX) * pixelM;
  }
  // Monotone Godunov sweeps in the four diagonal orders. A coast source is
  // reached in two or three cycles; the loop stops when a cycle moves
  // nothing by more than a hundredth of a deep step — a third of a metre of
  // phase, under the texel's own bilinear error.
  let cycles = 0;
  if (coastalTexels) {
    const settle = deepStep * 1e-2;
    for (cycles = 1; cycles <= 8; cycles++) {
      let moved = 0;
      for (let order = 0; order < 4; order++) {
        const sx = order & 1 ? -1 : 1, sz = order & 2 ? -1 : 1;
        const z0 = sz > 0 ? 0 : height - 1, x0 = sx > 0 ? 0 : width - 1;
        for (let zz = 0, z = z0; zz < height; zz++, z += sz) {
          const row = z * width;
          const up = z > 0, down = z + 1 < height;
          for (let xx = 0, x = x0, i = row + x0; xx < width; xx++, x += sx, i += sx) {
            const s = step[i];
            if (s === 0) continue;
            const l = x > 0 ? T[i - 1] : INF, r = x + 1 < width ? T[i + 1] : INF;
            const u = up ? T[i - width] : INF, d = down ? T[i + width] : INF;
            const a = l < r ? l : r, b = u < d ? u : d;
            if (a >= INF && b >= INF) continue;
            const diff = a > b ? a - b : b - a;
            let value: number;
            if (diff >= s) value = (a < b ? a : b) + s;
            else { const q = 2 * s * s - diff * diff; value = (a + b + Math.sqrt(q > 0 ? q : 0)) * 0.5; }
            const was = T[i];
            if (value < was) {
              T[i] = value;
              const delta = was >= INF ? INF : was - value;
              if (delta > moved) moved = delta;
            }
          }
        }
      }
      if (moved < settle) break;
    }
  }
  const sweepMs = performance.now() - t0;
  // The far field: grown outward from the band by the chamfer. Band texels
  // are its seeds and are never lowered by it — a deep-water step through a
  // band texel would erase the very slowing the sweep put there.
  if (coastalTexels) {
    const c1 = deepStep, c2 = deepStep * Math.SQRT2;
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
      const i = z * width + x;
      if (!medium[i] || step[i] !== 0) continue;
      let v = T[i];
      if (x > 0) { const w = T[i - 1] + c1; if (w < v) v = w; }
      if (z > 0) {
        const w = T[i - width] + c1; if (w < v) v = w;
        if (x > 0) { const w2 = T[i - width - 1] + c2; if (w2 < v) v = w2; }
        if (x + 1 < width) { const w2 = T[i - width + 1] + c2; if (w2 < v) v = w2; }
      }
      T[i] = v;
    }
    for (let z = height - 1; z >= 0; z--) for (let x = width - 1; x >= 0; x--) {
      const i = z * width + x;
      if (!medium[i] || step[i] !== 0) continue;
      let v = T[i];
      if (x + 1 < width) { const w = T[i + 1] + c1; if (w < v) v = w; }
      if (z + 1 < height) {
        const w = T[i + width] + c1; if (w < v) v = w;
        if (x + 1 < width) { const w2 = T[i + width + 1] + c2; if (w2 < v) v = w2; }
        if (x > 0) { const w2 = T[i + width - 1] + c2; if (w2 < v) v = w2; }
      }
      T[i] = v;
    }
  }
  const solveMs = performance.now() - t0;
  const t1 = performance.now();
  const data = new Float32Array(n * 4);
  const valid = (j: number, own: number): number => (T[j] >= INF ? own : T[j]);
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const i = z * width + x;
    // A SEA TEXEL NO SHORE REACHED — a tile wholly at sea, whose gutter
    // shows no land — carries the plain shore distance instead, which is
    // the distance transform's own answer there (a clamp, well past the
    // nearshore crossfade). Left at zero it would read as the waterline and
    // put a full, phase-flat shore wave over the whole open tile.
    if (!medium[i] || T[i] >= INF) {
      if (medium[i]) data[i * 4] = Math.min(4000, toDry[i] * pixelM);
      data[i * 4 + 3] = 1;
      continue;
    }
    const own = T[i];
    const gx = valid(z * width + Math.min(width - 1, x + 1), own) - valid(z * width + Math.max(0, x - 1), own);
    const gz = valid(Math.min(height - 1, z + 1) * width + x, own) - valid(Math.max(0, z - 1) * width + x, own);
    const len = Math.hypot(gx, gz);
    data[i * 4] = Math.min(4000, own * c0);
    data[i * 4 + 1] = len > 0 ? gx / len : 0;
    data[i * 4 + 2] = len > 0 ? gz / len : 0;
    data[i * 4 + 3] = 1;
  }
  // ── EXPOSURE, ON A COARSE LATTICE ──
  // The fan faces the OPEN SEA: down the distance to the mask's interior,
  // where the tile has one. The travel's own gradient was tried first and
  // pointed the fan at the beach from between a beach and a rock — a texel
  // on the ridge between two shores has no seaward side by travel — so the
  // surf zone at Camps Bay read a fifth as exposed as the water beyond it.
  const toDeep = chamfer(interior, width, height, 1);
  const STRIDE = 4;
  const lw = Math.ceil(width / STRIDE), lh = Math.ceil(height / STRIDE);
  const lattice = new Float32Array(lw * lh).fill(1);
  const RAYS = 7, HALF_FAN = (72 * Math.PI) / 180, STEPS = 28, STEP_TEXELS = 2;
  for (let lz = 0; lz < lh; lz++) for (let lx = 0; lx < lw; lx++) {
    const x = Math.min(width - 1, lx * STRIDE), z = Math.min(height - 1, lz * STRIDE);
    const i = z * width + x;
    if (!medium[i] || T[i] >= INF) continue;
    let dx = data[i * 4 + 1], dz = data[i * 4 + 2];
    if (toDeep[i] < 1e8) {
      const gx = toDeep[z * width + Math.min(width - 1, x + 1)] - toDeep[z * width + Math.max(0, x - 1)];
      const gz = toDeep[Math.min(height - 1, z + 1) * width + x] - toDeep[Math.max(0, z - 1) * width + x];
      const gl = Math.hypot(gx, gz);
      if (gl > 0) { dx = -gx / gl; dz = -gz / gl; }
    }
    if (dx === 0 && dz === 0) continue;                 // deep interior: open by definition
    const base = Math.atan2(dz, dx);
    let sum = 0;
    for (let r = 0; r < RAYS; r++) {
      const angle = base - HALF_FAN + (2 * HALF_FAN * r) / (RAYS - 1);
      const rx = Math.cos(angle), rz = Math.sin(angle);
      let energy = 1;
      for (let s = 1; s <= STEPS; s++) {
        const px = Math.round(x + rx * s * STEP_TEXELS), pz = Math.round(z + rz * s * STEP_TEXELS);
        if (px < 0 || pz < 0 || px >= width || pz >= height) break;   // left the grid: open
        const j = pz * width + px;
        // ANY WATER IS WATER. Only LAND stops a swell. The first cut also
        // walled off water of another KIND, and a land-cover polygon lying
        // over the sea — False Bay wears one 62,578 pixels across — killed
        // five of seven rays on open water, reading 0.34 where it should
        // read 1. And the demo's shallow attenuation (0.87 a step over its
        // authored seabed) is meaningless on fill: our sea is 0.40 m deep
        // everywhere, so it fired on every step of every ray — 0.9^28 =
        // 0.05 — and drove whole coastlines to the floor. Shelter here is
        // what the LAND blocks, which is what this data can carry.
        if (!wet[j]) { energy = 0.03; break; }
      }
      sum += energy;
    }
    lattice[lz * lw + lx] = 0.09 + 0.91 * (sum / RAYS);
  }
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const i = z * width + x;
    if (!medium[i] || T[i] >= INF) continue;
    const fx = x / STRIDE, fz = z / STRIDE;
    const x0 = Math.min(lw - 1, Math.floor(fx)), z0 = Math.min(lh - 1, Math.floor(fz));
    const x1 = Math.min(lw - 1, x0 + 1), z1 = Math.min(lh - 1, z0 + 1);
    const tx = fx - x0, tz = fz - z0;
    const e = (lattice[z0 * lw + x0] * (1 - tx) + lattice[z0 * lw + x1] * tx) * (1 - tz)
      + (lattice[z1 * lw + x0] * (1 - tx) + lattice[z1 * lw + x1] * tx) * tz;
    data[i * 4 + 3] = clamp(e, 0, 1);
  }
  const exposureMs = performance.now() - t1;
  return { data, stats: { cycles, coastalTexels, sweepMs, solveMs, exposureMs } };
}
