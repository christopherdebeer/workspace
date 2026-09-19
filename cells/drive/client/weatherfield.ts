/**
 * THE WEATHER FIELD — weather, given a position.
 *
 * Everything the old system produced was four scalars for the whole planet:
 * one cover, one rain, one wetness, everywhere at once. That is why weather
 * read as a SETTING rather than an event — there was nothing to drive into,
 * out of, or around. This module gives those scalars a place to live: a
 * world-anchored grid, a few kilometres on a side, that drifts on the real
 * wind and remembers where it has rained.
 *
 * Pure on purpose, like `roadprofile.ts` and `autopilot.ts` before it: no
 * clock, no random, no THREE. The caller passes the time, the wind and the
 * regional targets; the field hands back bytes. The same bytes go three ways —
 * a DataTexture the shaders sample (sky deck, cloud shadows, fog, wet roads),
 * a bilinear CPU sampler the physics and audio read at the truck, and a test
 * that can assert a front actually moves downwind.
 *
 * ── WHAT LIVES IN A CELL ──
 *
 *   cover  what fraction of sky this square sits under. The REGIONAL target
 *          (live feed, pin, or the synthetic chain) is the mean; the field
 *          modulates around it, scaled by cover·(1−cover) so a pinned CLEAR
 *          is exactly clear and a pinned STORM exactly storm — the harness's
 *          fixtures stay deterministic, and the variation lives mid-range
 *          where fronts actually have edges.
 *   rain   where inside the rainy region it is actually raining. Light rain
 *          is scattered showers; a storm is nearly wall to wall. This is what
 *          makes "driving out of the rain" a real thing that happens.
 *   fog    banks, at a smaller scale than the cloud field, gated by the
 *          regional mist term (dawn, calm, after rain — the caller's model).
 *   wet    MEMORY. The one channel with state: a cell soaks while its own
 *          rain falls on it and dries slowly after, so the wet road is the
 *          road it rained on, not the world. Survives recentring by shifting
 *          with the grid — wetness is anchored to the ground, not the truck.
 *
 * ── THE FOG CEILING ──
 *
 * Mist fills valleys because fog here is a SLAB: density below `fogTop`,
 * nothing above. The top is set from the terrain itself — a low percentile of
 * heights across the grid plus a margin — so on the flat the whole polder
 * blankets, and in the mountains the mist sits in the valley while the pass
 * climbs out of it. That is the drive-through: descend into the ceiling,
 * climb back out the other side.
 */

export const WXF_N = 48;           // cells per side
export const WXF_M = 256;          // metres per cell — 12.3km across
export const WXF_SPAN = WXF_N * WXF_M;

/** Channel offsets in the RGBA byte plane. */
const C_COVER = 0, C_RAIN = 1, C_FOG = 2, C_WET = 3;

export interface WxTargets {
  /** Seconds — any monotonic clock. Advects the noise downwind. */
  t: number;
  /** Wind in m/s, world axes (+x east, +z south — the game's frame). */
  windX: number; windZ: number;
  /** Integrated wind displacement; optional for time-addressed lab fixtures. */
  advectX?: number; advectZ?: number;
  /** Regional means, 0..1 — what the driver (live/pin/synthetic) asked for. */
  cover: number; rain: number; fog: number;
  /** Seconds since the last build — the wet channel's integration step. */
  dt: number;
  /** Daylight 0..1. Sun dries the ground about twice as fast as night air. */
  dayF: number;
}

export interface WxField {
  /** World coords of the grid's corner (cell [0,0]'s min corner). */
  ox: number; oz: number;
  /** RGBA bytes, WXF_N², ready to be a DataTexture. */
  data: Uint8Array<ArrayBuffer>;
  /** Wet, kept at float precision — bytes quantise the slow dry to nothing. */
  wet: Float32Array;
  /** Absolute Y of the mist ceiling, world metres. */
  fogTop: number;
  /** Running mean of the wet channel — the caller's after-rain mist term. */
  wetMean: number;
  /**
   * ── THE NOISE IS KEPT; THE THRESHOLDS ARE NOT ──
   * The three fbm reads a cell needs (front, rain, fog), computed at the
   * advect they were last computed at. They are the whole cost of a build —
   * 2,304 cells × three fbm, one to three milliseconds on a phone — and they
   * change only with the advect, a few metres a rebuild against a front
   * pattern kilometres across. So they are recomputed on a recentre or once
   * the wind has carried them `WX_NOISE_STEP`, and every call re-thresholds
   * them by the regional scalars, which is the cheap half and the half that
   * moves every frame. Before this the whole build ran on a 1.8 s cadence and
   * the sky arrived in stairs — see the doctrine, "The weather steps…".
   */
  noise: Float32Array;
  /** The advect the noise was computed at, or null before the first build
   *  and after a recentre (the cells' positions moved under it). */
  noiseAt: { x: number; z: number } | null;
  /** `t` at which the mist ceiling was last measured off the ground. */
  fogTopAtT: number;
  /** The regional scalars the bytes were last written for, so a frame in
   *  which nothing moved writes nothing. */
  last: { cover: number; rain: number; fog: number };
}

export const mkField = (ox: number, oz: number): WxField => ({
  ox, oz,
  data: new Uint8Array(WXF_N * WXF_N * 4),
  wet: new Float32Array(WXF_N * WXF_N),
  fogTop: -1e9,
  wetMean: 0,
  noise: new Float32Array(WXF_N * WXF_N * 3),
  noiseAt: null,
  fogTopAtT: -1e9,
  last: { cover: -1, rain: -1, fog: -1 },
});

/** Metres of advect between two computations of the noise. An eighth of a
 *  cell: the coverage threshold field shifts by a hundredth of cover at that
 *  hop (a 0.5 swing over 1,400 m, times 32 m), invisible against a 2.8 km
 *  front, and a recompute — 2.85 ms in node, the one synchronous cost left
 *  in the weather — comes no more often than the old 1.8 s cadence paid it
 *  until the wind passes 64 km/h. A sixteenth was measured first and would
 *  have doubled the spike rate in a stiff breeze for nothing the eye reads. */
export const WX_NOISE_STEP = WXF_M / 8;
/** Seconds between two measurements of the mist ceiling off the ground: it
 *  follows the DEM as tiles land, and 144 samples every two seconds is what
 *  the old 1.8 s cadence already paid. */
export const WX_FOGTOP_S = 2;

// ── value noise, deterministic ──────────────────────────────────────
// Integer-hashed so the same cell asks the same question forever — the field
// must not shimmer between rebuilds, and a test must get the same world twice.
function h2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const sm = (t: number): number => t * t * (3 - 2 * t);
function vn(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = sm(x - ix), fz = sm(z - iz);
  return (h2(ix, iz, seed) * (1 - fx) + h2(ix + 1, iz, seed) * fx) * (1 - fz)
    + (h2(ix, iz + 1, seed) * (1 - fx) + h2(ix + 1, iz + 1, seed) * fx) * fz;
}
/** Three octaves. More buys detail below the cell size, which nobody sees. */
export function fbm(x: number, z: number, seed: number): number {
  return vn(x, z, seed) * 0.5 + vn(x * 2.03, z * 2.03, seed + 1) * 0.3
    + vn(x * 4.19, z * 4.19, seed + 2) * 0.2;
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Noise units per metre. ~1/2800: fronts a few kilometres across, several
 *  per grid — enough that one is usually arriving and one leaving. */
const FRONT_SCALE = 1 / 2800;
/** Fog banks are tighter — a bank is a thing you enter, not a hemisphere. */
const FOG_SCALE = 1 / 1400;

/**
 * Re-anchor the grid so `cx,cz` sits near its middle, SHIFTING the wet memory
 * with the ground it belongs to. Cells that scroll on start dry — the honest
 * default for ground nobody has watched it rain on.
 */
export function recenter(f: WxField, cx: number, cz: number): boolean {
  const wantOx = Math.floor((cx - WXF_SPAN / 2) / WXF_M) * WXF_M;
  const wantOz = Math.floor((cz - WXF_SPAN / 2) / WXF_M) * WXF_M;
  const dx = Math.round((wantOx - f.ox) / WXF_M);
  const dz = Math.round((wantOz - f.oz) / WXF_M);
  if (dx === 0 && dz === 0) return false;
  const old = f.wet;
  const next = new Float32Array(WXF_N * WXF_N);
  for (let j = 0; j < WXF_N; j++) {
    for (let i = 0; i < WXF_N; i++) {
      const si = i + dx, sj = j + dz;
      if (si >= 0 && si < WXF_N && sj >= 0 && sj < WXF_N) next[j * WXF_N + i] = old[sj * WXF_N + si];
    }
  }
  f.wet = next;
  f.ox = wantOx; f.oz = wantOz;
  // The cells now stand on different ground: the noise was computed for the
  // old positions and the ceiling measured off the old grid.
  f.noiseAt = null;
  f.fogTopAtT = -1e9;
  return true;
}

/**
 * One build: local cover/rain/fog from the advected noise, wet integrated in
 * place. `heightAt` is only consulted for the fog ceiling, on a sparse lattice
 * — 144 samples, not 2304.
 */
/** The three fbm reads per cell, at one advect. The expensive half. */
function buildNoise(f: WxField, adx: number, adz: number): void {
  for (let j = 0; j < WXF_N; j++) {
    for (let i = 0; i < WXF_N; i++) {
      const wx = f.ox + (i + 0.5) * WXF_M;
      const wz = f.oz + (j + 0.5) * WXF_M;
      const nx = (wx - adx) * FRONT_SCALE, nz = (wz - adz) * FRONT_SCALE;
      const k = (j * WXF_N + i) * 3;
      f.noise[k] = fbm(nx, nz, 11);
      f.noise[k + 1] = fbm(nx + 37.7, nz - 19.3, 23);
      f.noise[k + 2] = fbm((wx - adx * 0.6) * FOG_SCALE, (wz - adz * 0.6) * FOG_SCALE, 41);
    }
  }
}

/**
 * Returns whether the bytes were written. A frame in which the noise did not
 * move, no regional scalar changed and nothing is wet or raining writes
 * nothing, so a settled sky costs a handful of compares and no upload; the
 * caller integrates `dt` from its last WRITE, not its last call.
 */
export function buildField(f: WxField, p: WxTargets, heightAt: (x: number, z: number) => number): boolean {
  // Features travel WITH the wind: sampling upwind of a point brings what is
  // upwind toward it as t grows.
  const adx = p.advectX ?? p.windX * p.t, adz = p.advectZ ?? p.windZ * p.t;
  const moved = !f.noiseAt || Math.hypot(adx - f.noiseAt.x, adz - f.noiseAt.z) >= WX_NOISE_STEP;
  if (moved) { buildNoise(f, adx, adz); f.noiseAt = { x: adx, z: adz }; }
  if (moved || !(p.t - f.fogTopAtT < WX_FOGTOP_S)) {
    // The ceiling: a low percentile of the ground, plus the depth of a bank.
    // Percentile, not minimum — one gorge must not drain the mist off a plateau.
    const hs: number[] = [];
    for (let j = 0; j < 12; j++) {
      for (let i = 0; i < 12; i++) {
        hs.push(heightAt(f.ox + (i + 0.5) * (WXF_SPAN / 12), f.oz + (j + 0.5) * (WXF_SPAN / 12)));
      }
    }
    hs.sort((a, b) => a - b);
    f.fogTop = hs[Math.floor(hs.length * 0.2)] + 34;
    f.fogTopAtT = p.t;
  }
  const wetLive = f.wetMean > 0 || p.rain > 0.01;
  if (!moved && !wetLive
    && Math.abs(p.cover - f.last.cover) < 1e-4
    && Math.abs(p.rain - f.last.rain) < 1e-4
    && Math.abs(p.fog - f.last.fog) < 1e-4) return false;
  // The mid-range spread: zero at pinned extremes, widest where fronts live.
  // The 3.2 is contrast: three octaves of value noise huddle within ±0.2 of
  // their mean, and un-stretched that gave a sky with no real open patches —
  // overcast everywhere, just unevenly, which is not a front, it is dirt on
  // the lens.
  const covSpread = 4 * p.cover * (1 - p.cover);
  // Rain threshold: light rain rains in patches, a storm nearly everywhere.
  const rLo = 0.62 - p.rain * 0.42;
  const rHi = rLo + 0.2;
  const dry = p.dt * (0.010 + 0.014 * p.dayF);   // ~2min in sun, ~4 at night
  let wetSum = 0;
  for (let j = 0; j < WXF_N; j++) {
    for (let i = 0; i < WXF_N; i++) {
      const k = j * WXF_N + i;
      const front = f.noise[k * 3];
      const cover = clamp(p.cover + (front - 0.5) * 3.2 * covSpread, 0, 1);
      const rn = p.rain <= 0.01 ? 0
        : p.rain * clamp((f.noise[k * 3 + 1] - rLo) / (rHi - rLo), 0, 1);
      const fg = p.fog <= 0.01 ? 0
        : p.fog * clamp((f.noise[k * 3 + 2] - 0.46) / 0.3, 0, 1);
      // Wet: soak under this cell's own rain, dry everywhere else.
      const w = clamp(f.wet[k] + (rn > 0.06 ? p.dt * 0.07 * rn : -dry), 0, 1);
      f.wet[k] = w;
      wetSum += w;
      const b = k * 4;
      f.data[b + C_COVER] = (cover * 255) | 0;
      f.data[b + C_RAIN] = (rn * 255) | 0;
      f.data[b + C_FOG] = (fg * 255) | 0;
      f.data[b + C_WET] = (w * 255) | 0;
    }
  }
  f.wetMean = wetSum / (WXF_N * WXF_N);
  f.last.cover = p.cover; f.last.rain = p.rain; f.last.fog = p.fog;
  return true;
}

/** Bilinear sample at a world point — what the truck, the audio and the spray
 *  read. Beyond the grid it clamps, the same answer the texture gives. */
export function wxAt(f: WxField, x: number, z: number): { cover: number; rain: number; fog: number; wet: number } {
  const gx = clamp((x - f.ox) / WXF_M - 0.5, 0, WXF_N - 1.001);
  const gz = clamp((z - f.oz) / WXF_M - 0.5, 0, WXF_N - 1.001);
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const at = (ii: number, jj: number, c: number): number =>
    f.data[(Math.min(jj, WXF_N - 1) * WXF_N + Math.min(ii, WXF_N - 1)) * 4 + c] / 255;
  const bi = (c: number): number =>
    (at(i, j, c) * (1 - fx) + at(i + 1, j, c) * fx) * (1 - fz)
    + (at(i, j + 1, c) * (1 - fx) + at(i + 1, j + 1, c) * fx) * fz;
  return { cover: bi(C_COVER), rain: bi(C_RAIN), fog: bi(C_FOG), wet: bi(C_WET) };
}

/**
 * The puddle pattern, CPU side — the same shapes the road shader draws, close
 * enough that the spray rises where the water is seen. Metre-scale, so it
 * lives outside the cell grid entirely.
 */
export function puddleAt(x: number, z: number, wet: number): number {
  if (wet < 0.45) return 0;
  const n = fbm(x * 0.22, z * 0.22, 97);
  return clamp((n - (1.02 - wet * 0.42)) / 0.1, 0, 1);
}

/** Flood the wet memory — the ?wet= pin, for screenshots and tests that need
 *  a soaked world without waiting out a storm. Writes the bytes too, so the
 *  shaders see it the same frame. */
export function seedWet(f: WxField, v: number): void {
  const w = clamp(v, 0, 1);
  f.wet.fill(w);
  for (let k = 0; k < WXF_N * WXF_N; k++) f.data[k * 4 + 3] = (w * 255) | 0;
  f.wetMean = w;
}
