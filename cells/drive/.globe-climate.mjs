// cells/drive/client/climate.ts
var BIOME_ORDER = ["arid", "tropical", "temperate", "boreal", "alpine"];
var ALPINE = 4;
var GROUND_RAMPS = {
  arid: [[0.5, [0.07, 0.3, 0.35]], [60, [0.44, 0.37, 0.22]], [300, [0.41, 0.33, 0.19]], [900, [0.37, 0.27, 0.15]], [1800, [0.33, 0.28, 0.23]], [1e9, [0.62, 0.63, 0.65]]],
  tropical: [[0.5, [0.06, 0.26, 0.3]], [60, [0.14, 0.27, 0.14]], [300, [0.13, 0.24, 0.13]], [900, [0.16, 0.24, 0.14]], [1800, [0.24, 0.26, 0.2]], [1e9, [0.6, 0.62, 0.64]]],
  temperate: [[0.5, [0.07, 0.28, 0.33]], [60, [0.25, 0.29, 0.17]], [300, [0.24, 0.27, 0.16]], [900, [0.28, 0.26, 0.17]], [1800, [0.31, 0.29, 0.25]], [1e9, [0.66, 0.67, 0.69]]],
  boreal: [[0.5, [0.06, 0.24, 0.31]], [60, [0.18, 0.25, 0.19]], [300, [0.17, 0.23, 0.18]], [900, [0.21, 0.23, 0.19]], [1800, [0.3, 0.31, 0.3]], [1e9, [0.74, 0.76, 0.78]]],
  alpine: [[0.5, [0.08, 0.28, 0.36]], [60, [0.28, 0.3, 0.24]], [300, [0.3, 0.3, 0.26]], [900, [0.34, 0.33, 0.3]], [1800, [0.44, 0.45, 0.46]], [1e9, [0.86, 0.88, 0.9]]]
};
function groundColourAt(w, elev) {
  const ramps = BIOME_ORDER.map((b2) => GROUND_RAMPS[b2]);
  const steps = ramps[0];
  let band = steps.length - 1;
  for (let i = 1; i < steps.length; i++) {
    if (elev <= steps[i][0]) {
      band = i;
      break;
    }
  }
  let r = 0, g = 0, b = 0, tot = 0;
  for (let k = 0; k < ramps.length; k++) {
    const wk = w[k] ?? 0;
    if (wk <= 0) continue;
    const c = ramps[k][band][1];
    r += c[0] * wk;
    g += c[1] * wk;
    b += c[2] * wk;
    tot += wk;
  }
  return tot > 0 ? [r / tot, g / tot, b / tot] : ramps[2][band][1];
}
var CLIM_G = 2048;
var CLIM_CACHE_MAX = 2e4;
var CLIM_HOMES = [
  [
    [0.85, 0.12, 1],
    // arid      — hot, dry
    [0.4, 0.08, 0.9]
  ],
  //           — …and cold, dry: steppe and cold desert
  [[0.88, 0.8, 1]],
  // tropical  — hot, wet
  [[0.55, 0.55, 1]],
  // temperate — mild, middling
  [[0.28, 0.5, 1]],
  // boreal    — cold, middling
  // Amplitude 0.75, and deliberately: alpine's identity comes from being ABOVE
  // THE TREES, which applyTreeline supplies at up to 3.2x. Its home in the
  // temperature/moisture plane is a placeholder — the note on applyTreeline
  // says as much — and at full amplitude that placeholder was winning cold dry
  // LOWLANDS off the new cold-desert home, which is the one thing alpine
  // should never be. Weak here, decisive where the trees stop.
  [[0.2, 0.4, 0.75]]
  // alpine    — cold, and mostly a matter of height
];
var MOIST_OF = {
  10: 0.75,
  // tree
  20: 0.28,
  // shrub
  30: 0.45,
  // grass
  40: 0.6,
  // crop
  60: 0.08,
  // bare
  80: 1,
  // water
  90: 1,
  // wetland
  95: 1,
  // mangrove
  100: 0.5
  // moss
};
var treelineAt = (latAbs, moisture = 0.5) => {
  const dry = (0.5 - moisture) * 1400;
  return Math.max(0, 4e3 - 0.8 * latAbs * latAbs + dry);
};
var seaTempAt = (latAbs) => 27 - 68e-4 * latAbs * latAbs;
var LAPSE = 65e-4;
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
var WET_SIGNS = /* @__PURE__ */ new Set([10, 40, 80, 90, 95]);
var DRY_SIGNS = /* @__PURE__ */ new Set([20, 60]);
function moistureAt(env, x, z) {
  let sum = 0, n = 0, wet = 0, dry = 0;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const cv = env.coverAt(x + i * 400, z + j * 400);
    if (cv === null) continue;
    const m = MOIST_OF[cv];
    if (m === void 0) continue;
    sum += m;
    n++;
    if (WET_SIGNS.has(cv)) wet++;
    else if (DRY_SIGNS.has(cv)) dry++;
  }
  if (!n) return 0.5;
  const mean = sum / n;
  const aridity = Math.max(0, Math.min(1, dry / n - wet / n * 3));
  return mean * (1 - 0.55 * aridity);
}
function applyTreeline(c, elevAbs) {
  c.elevAbs = elevAbs;
  const above = clamp((elevAbs - (c.treeline - 500)) / 700, 0, 1);
  const boost = above * above * (3 - 2 * above) * 3.2;
  let total = 0, dom = 0;
  for (let i = 0; i < 5; i++) {
    c.w[i] = c.w0[i];
    total += c.w0[i];
  }
  c.w[ALPINE] += boost * (total / 5);
  total += boost * (total / 5);
  for (let i = 0; i < 5; i++) {
    c.w[i] /= total;
    if (c.w[i] > c.w[dom]) dom = i;
  }
  c.domIdx = dom;
}
function climCompute(env, x, z, stamp) {
  const latAbs = env.latAbsAt(x, z);
  let elevAbs = 0;
  try {
    elevAbs = env.groundAt(x, z);
  } catch {
  }
  const tempC = seaTempAt(latAbs) - LAPSE * Math.max(0, elevAbs);
  const moisture = moistureAt(env, x, z);
  const treeline = treelineAt(latAbs, moisture);
  const tempN = clamp((tempC + 10) / 40, 0, 1);
  const w = [];
  let total = 0;
  for (let i = 0; i < CLIM_HOMES.length; i++) {
    let best = 0;
    for (const [ht, hm, amp] of CLIM_HOMES[i]) {
      const dt = tempN - ht, dm = moisture - hm;
      const v = amp * Math.exp(-(dt * dt * 12 + dm * dm * 10));
      if (v > best) best = v;
    }
    w.push(best);
    total += best;
  }
  for (let i = 0; i < w.length; i++) w[i] /= total;
  const c = {
    w: w.slice(),
    w0: w,
    domIdx: 0,
    tempC,
    moisture,
    treeline,
    elevAbs,
    hadCover: env.coverAt(x, z) !== null,
    stamp
  };
  applyTreeline(c, elevAbs);
  return c;
}
var corners = (spanM, g = CLIM_G) => Math.pow(Math.ceil(spanM / g) + 1, 2);
var ClimateField = class {
  constructor(env) {
    this.env = env;
    this.cache = /* @__PURE__ */ new Map();
    /** Bumped when cover lands, expiring evidence-free corners. */
    this.stamp = 0;
    this.scratch = {
      w: [0, 0, 0, 0, 0],
      w0: [0, 0, 0, 0, 0],
      domIdx: 2,
      tempC: 12,
      moisture: 0.5,
      treeline: 2e3,
      elevAbs: 0,
      hadCover: false,
      stamp: 0
    };
  }
  get size() {
    return this.cache.size;
  }
  /** New cover: every corner that had none gets one more chance. */
  noteCover() {
    this.stamp++;
  }
  corner(gx, gz) {
    const k = gx * 65536 + gz;
    const c = this.cache.get(k);
    if (c && (c.hadCover || c.stamp === this.stamp)) return c;
    const fresh = climCompute(this.env, gx * CLIM_G, gz * CLIM_G, this.stamp);
    if (this.cache.size > CLIM_CACHE_MAX) this.cache.clear();
    this.cache.set(k, fresh);
    return fresh;
  }
  /**
   * The climate at a point. Returns a SHARED SCRATCH — read what you need and
   * do not retain it across another call; this runs per terrain vertex and per
   * sward texel, where an allocation is a collection mid-build.
   *
   * Bilinear, not nearest: a nearest-corner lookup would put a hard 2km grid
   * into the ground colour, which is the same checkerboard the sward's flower
   * patches drew when they thresholded a per-cell hash instead of a field.
   */
  at(x, z, elevAbs) {
    const s = this.scratch;
    const fx = x / CLIM_G, fz = z / CLIM_G;
    const gx = Math.floor(fx), gz = Math.floor(fz);
    const tx = fx - gx, tz = fz - gz;
    const a = this.corner(gx, gz), b = this.corner(gx + 1, gz);
    const c = this.corner(gx, gz + 1), d = this.corner(gx + 1, gz + 1);
    const mix = (p, q, r, t) => (p * (1 - tx) + q * tx) * (1 - tz) + (r * (1 - tx) + t * tx) * tz;
    for (let i = 0; i < 5; i++) s.w0[i] = mix(a.w0[i], b.w0[i], c.w0[i], d.w0[i]);
    s.moisture = mix(a.moisture, b.moisture, c.moisture, d.moisture);
    s.treeline = mix(a.treeline, b.treeline, c.treeline, d.treeline);
    const lattice = mix(a.elevAbs, b.elevAbs, c.elevAbs, d.elevAbs);
    const elev = elevAbs ?? lattice;
    s.tempC = mix(a.tempC, b.tempC, c.tempC, d.tempC) + (lattice - elev) * LAPSE;
    s.hadCover = a.hadCover && b.hadCover && c.hadCover && d.hadCover;
    s.stamp = this.stamp;
    applyTreeline(s, elev);
    return s;
  }
};
function climPick(table, w, r) {
  let total = 0;
  for (let i = 0; i < BIOME_ORDER.length; i++) {
    const row = table[BIOME_ORDER[i]];
    if (!row) continue;
    for (const [, wt] of row) total += wt * w[i];
  }
  if (total <= 0) return null;
  let t = r() * total;
  for (let i = 0; i < BIOME_ORDER.length; i++) {
    const row = table[BIOME_ORDER[i]];
    if (!row) continue;
    for (const [k, wt] of row) {
      t -= wt * w[i];
      if (t <= 0) return k;
    }
  }
  return null;
}
function climPickRow(table, w, roll) {
  const n = (table.temperate ?? []).length;
  const acc = new Array(n).fill(0);
  let total = 0;
  for (let i = 0; i < BIOME_ORDER.length; i++) {
    const row = table[BIOME_ORDER[i]];
    if (!row) continue;
    for (let k = 0; k < row.length && k < n; k++) {
      acc[k] += row[k] * w[i];
      total += row[k] * w[i];
    }
  }
  if (total <= 0) return 0;
  let t = roll * total;
  for (let k = 0; k < n; k++) {
    t -= acc[k];
    if (t <= 0) return k;
  }
  return 0;
}
var AltBand = {
  /** Closed forest. The default everywhere below the trees. */
  Montane: 0,
  /** The upper forest, thinning — trees still win but are losing. */
  Treeline: 1,
  /** Stunted, wind-flagged conifer. The same archetype at a third the size:
   *  a deformation, not a new asset. */
  Krummholz: 2,
  /** Alpine meadow — no trunked plant stands, and the sward gets its best
   *  season of the year. */
  Meadow: 3,
  /** Rock and shard only. */
  Scree: 4,
  /** Nothing grows. */
  Snow: 5
};
var ALT_BAND_NAMES = ["montane", "treeline", "krummholz", "meadow", "scree", "snow"];
var ALT_EDGES = [-400, 0, 250, 700, 1200];
function altBandAt(elevEff, treeline) {
  const d = elevEff - treeline;
  for (let i = 0; i < ALT_EDGES.length; i++) if (d < ALT_EDGES[i]) return i;
  return AltBand.Snow;
}
function krummholz(elevEff, treeline) {
  const d = elevEff - treeline;
  if (d <= -400) return 1;
  if (d >= 250) return 0;
  if (d <= 0) return 1 - 0.72 * ((d + 400) / 400);
  return 0.28 * (1 - d / 250);
}
function swardLift(elevEff, treeline) {
  const d = elevEff - treeline;
  if (d >= 1e3) return 0;
  if (d >= 500) return 1 - (d - 500) / 500;
  if (d >= 0) return 1.35;
  if (d >= -400) return 1 + 0.35 * ((d + 400) / 400);
  return 1;
}
var ASPECT_LIFT = 150;
function aspectLift(env, x, z, lat, step = 12) {
  let h0, hx, hz;
  try {
    h0 = env.groundAt(x, z);
    hx = env.groundAt(x + step, z);
    hz = env.groundAt(x, z + step);
  } catch {
    return 0;
  }
  const gx = (hx - h0) / step, gz = (hz - h0) / step;
  const grade = Math.hypot(gx, gz);
  if (grade < 0.05) return 0;
  const pole = lat >= 0 ? -1 : 1;
  const northness = -gz / grade * pole;
  return northness * ASPECT_LIFT * Math.min(1, grade / 0.5);
}
var CONTIN_E = 4e5;
var SHADOW_FULL = 1200;
var SLOPE_R = 90;
var HOLLOW_R = 220;
function upwindAt(lat) {
  const a = Math.abs(lat);
  const east = a < 30 || a > 60;
  return [east ? 1 : -1, 0];
}
function beltRainAt(lat) {
  const a = Math.abs(lat);
  return 2200 * Math.exp(-((lat / 12) ** 2)) + 900 * Math.exp(-(((a - 52) / 16) ** 2)) + 90;
}
var norm = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);
function siteAt(env, x, z) {
  const lat = env.latAt(x, z);
  const latAbs = Math.abs(lat);
  let elevAbs = 0;
  try {
    elevAbs = env.groundAt(x, z);
  } catch {
  }
  const coastRaw = env.coastKmAt(x, z);
  const hadCoast = coastRaw !== null;
  const contin = hadCoast ? 1 - Math.exp(-(coastRaw * 1e3) / CONTIN_E) : 0.45;
  const seaShift = (0.5 - contin) * 2 * Math.max(0, (latAbs - 35) * 0.22);
  const heatC0 = seaTempAt(latAbs) + seaShift - LAPSE * Math.max(0, elevAbs);
  const [ux, uz] = upwindAt(lat);
  let upMax = elevAbs, upMin = elevAbs;
  for (let d = 15e3; d <= 4e4; d += 5e3) {
    try {
      const h = env.groundAt(x + ux * d, z + uz * d);
      if (h > upMax) upMax = h;
      if (h < upMin) upMin = h;
    } catch {
    }
  }
  const rainShadow = clamp((upMax - elevAbs - 300) / SHADOW_FULL, 0, 1);
  const rainContin = 0.45 * clamp((latAbs - 8) / 20, 0, 1);
  const orographic = clamp((elevAbs - upMin) / 1500, 0, 1);
  const waterMm = beltRainAt(lat) * (1 - rainContin * contin) * (1 - 0.6 * rainShadow) * (1 + 0.9 * orographic);
  const heatC = heatC0 + clamp((600 - waterMm) / 600, 0, 1) * 3.5;
  const rangeC = (2 + 0.62 * latAbs) * (0.3 + 0.7 * contin);
  const summerC = heatC + rangeC / 2;
  const winterC = heatC - rangeC / 2;
  const frostDays = clamp((4 - winterC) * 18, 0, 365);
  const marine = 1 - contin;
  const summerDry = clamp(Math.exp(-(((latAbs - 35) / 9) ** 2)) * (0.55 + 0.45 * marine), 0, 1);
  const winterDry = clamp(Math.exp(-(((latAbs - 13) / 8) ** 2)) * 0.95, 0, 1);
  const hE = safeGround(env, x + SLOPE_R, z, elevAbs);
  const hW = safeGround(env, x - SLOPE_R, z, elevAbs);
  const hS = safeGround(env, x, z + SLOPE_R, elevAbs);
  const hN = safeGround(env, x, z - SLOPE_R, elevAbs);
  const dx = (hE - hW) / (2 * SLOPE_R), dz = (hS - hN) / (2 * SLOPE_R);
  const grade = Math.hypot(dx, dz);
  const sunZ = lat >= 0 ? 1 : -1;
  const sunward = grade > 1e-4 ? -(dz * sunZ) / grade : 0;
  const insolation = clamp(0.5 + 0.5 * sunward * clamp(grade * 2.2, 0, 1), 0, 1);
  let above = 0, seen = 0;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const h = safeGround(env, x + Math.cos(a) * HOLLOW_R, z + Math.sin(a) * HOLLOW_R, NaN);
    if (!Number.isFinite(h)) continue;
    seen++;
    above += clamp((h - elevAbs) / 60, 0, 1);
  }
  const wetness = seen ? above / seen : 0.3;
  const exposure = clamp((1 - wetness) * 0.7 + norm(elevAbs, 200, 2600) * 0.3, 0, 1);
  const seaM = env.seaNearAt ? env.seaNearAt(x, z) : null;
  const salt = seaM === null ? 0 : clamp(1 - seaM / 900, 0, 1) * clamp(1 - Math.max(0, elevAbs) / 6, 0, 1);
  const treeline = treelineAt(latAbs, 0.5);
  return {
    heatC,
    summerC,
    winterC,
    rangeC,
    frostDays,
    waterMm,
    summerDry,
    winterDry,
    contin,
    rainShadow,
    treelineDelta: elevAbs - treeline,
    insolation,
    wetness,
    salt,
    exposure,
    elevAbs,
    hadCoast
  };
}
function safeGround(env, x, z, fallback) {
  try {
    const h = env.groundAt(x, z);
    return Number.isFinite(h) ? h : fallback;
  } catch {
    return fallback;
  }
}
export {
  ALPINE,
  ALT_BAND_NAMES,
  ALT_EDGES,
  ASPECT_LIFT,
  AltBand,
  BIOME_ORDER,
  CLIM_CACHE_MAX,
  CLIM_G,
  CLIM_HOMES,
  ClimateField,
  GROUND_RAMPS,
  LAPSE,
  MOIST_OF,
  altBandAt,
  applyTreeline,
  aspectLift,
  beltRainAt,
  climCompute,
  climPick,
  climPickRow,
  corners,
  groundColourAt,
  krummholz,
  moistureAt,
  seaTempAt,
  siteAt,
  swardLift,
  treelineAt,
  upwindAt
};
