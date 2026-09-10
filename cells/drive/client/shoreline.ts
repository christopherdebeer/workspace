import {
  HYDRO_BED_MASK,
  HYDRO_BED_SHIFT,
  HYDRO_BANK_MASK,
  HYDRO_BANK_SHIFT,
  HYDRO_ID_BED,
  HYDRO_ID_BANK,
  HYDRO_ID_KIND,
  HydroFlags,
  type HydroTileField,
  type HydroSample,
} from './hydro/types';
import { sampleFieldSurface } from './hydro/field-sample';
/** Shared inland-bank art rules. No water is invented when the field is absent.
 * Geometry/depth remain the hydro system's authority; these are habitat weights. */
export interface BankWater {
  kind: string; restingLevelM: number; depthM: number; wet?: boolean;
  shoreDistanceM: number; flow: readonly [number, number];
}
const unit = (v: number) => Math.max(0, Math.min(1, v));
export function bankHabitat(cover: number | null, moisture: number, tempC: number,
  slope: number, nearWater: boolean, groundM: number, water?: BankWater
): { reeds: number; mineral: number; submerged: boolean; depth: number } {
  const depth = water ? Math.max(0, water.restingLevelM - groundM) : 0;
  const submerged = !!water && water.wet !== false && depth > 0.04;
  const coast = water?.kind === 'ocean' || water?.kind === 'lagoon';
  if (coast || cover === 70 || tempC < -3 || (!nearWater && !water))
    return { reeds: 0, mineral: 0, submerged, depth };
  const wetland = cover === 90 || cover === 95 || water?.kind === 'wetland';
  const speed = water ? Math.hypot(...water.flow) : 0;
  const margin = water ? unit(1 - Math.max(0, water.shoreDistanceM - 2) / 10) : 1;
  const shallow = unit(1 - depth / 0.8);
  const shelter = unit(1 - speed / 1.8) * unit(1 - slope / 0.42);
  const living = unit((tempC + 3) / 12) * (wetland ? 1 : unit((moisture - 0.08) / 0.55));
  // Small, separated stands. Water cover can grow emergents only with a built,
  // shallow hydro sample; unresolved water is never turned into a lawn.
  const reeds = (cover === 80 && !water ? 0 : 1) * margin * shallow * shelter * living;
  const mineral = margin * unit(1 - depth / 1.15)
    * (wetland ? 0.10 : unit(0.30 + slope * 1.3 + speed * 0.20 + (1 - moisture) * 0.35));
  return { reeds, mineral, submerged, depth };
}

/** Integer intermediates stay within float32's exact integer range. The old
 * fractional multiply hash diverged by whole buckets on CPU/GPU at kilometre
 * scales; a physics cutoff must not depend on that rounding accident. */
const mod = (x: number, y: number) => x - Math.floor(x / y) * y;
export function bankHash(px: number, pz: number): number {
  let h = mod(mod(px,4093)*73 + mod(pz,4093)*157,4093);
  h = mod(h*h,4093);
  return mod(h*251+109,4093)/4093;
}
export function bankNoise(px: number, pz: number): number {
  const ix = Math.floor(px), iz = Math.floor(pz);
  let fx = px - ix, fz = pz - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = bankHash(ix, iz), b = bankHash(ix + 1, iz), c = bankHash(ix, iz + 1), d = bankHash(ix + 1, iz + 1);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}
export function bankPatch(px: number, pz: number): number {
  return bankNoise(px * 0.17, pz * 0.17) * 0.72 + bankNoise(px * 0.043, pz * 0.043) * 0.28;
}
/** Continuous dry-ground wet margin shared by production sward paint and the
 * hydro lab. It reaches several metres beyond the coverage contour so the
 * terrain visibly becomes bank before it becomes water. Patch variation moves
 * only the width; it never decides coverage and contains no screen-space
 * dither or quantisation. */
export function bankWetMargin(distanceM: number, patch = 0.5): number {
  const widthM = 4.5 + unit(patch) * 5.5;
  const t = unit(Math.max(0, distanceM) / widthM);
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth;
}
/** The fragment cut the water shader applies to coverage at this point —
 *  the one number the physics and the overlay must share with it. */
export const WATERLINE_CUT = (px: number, pz: number, kind?: string): number =>
  kind === 'ocean' || kind === 'lagoon' ? 0.5 : 0.5 + (bankPatch(px, pz) - 0.5) * 0.08;

/** Continuous, stationary metre-space patches shared by hydro and sward.
 * No time or tile seed: streamed tiles cannot disagree at their boundaries. */
export const BANK_GLSL = /* glsl */`
float bankHash(vec2 p) {
  float h = mod(dot(mod(p,4093.0),vec2(73.0,157.0)),4093.0);
  h = mod(h*h,4093.0);
  return mod(h*251.0+109.0,4093.0)/4093.0;
}
float bankNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(bankHash(i), bankHash(i+vec2(1.0,0.0)), f.x),
    mix(bankHash(i+vec2(0.0,1.0)), bankHash(i+vec2(1.0)), f.x), f.y);
}
float bankPatch(vec2 p) {
  return bankNoise(p * 0.17) * 0.72 + bankNoise(p * 0.043) * 0.28;
}
`;

/** A bounded neighbourhood of the already-built field, including its gutter.
 * Dry interior exits before searching. Bank context never changes water physics.
 * Distance is approximate at field resolution, so rendered ground height remains
 * the final authority for emergent vegetation. */
export function sampleBankField(f: HydroTileField, x: number, z: number,
  radiusM: number): (HydroSample & { wet: boolean }) | undefined {
  const dx = (f.bounds.maxX - f.bounds.minX) / f.resolution;
  const dz = (f.bounds.maxZ - f.bounds.minZ) / f.resolution;
  if (!(dx > 0 && dz > 0)) return undefined;
  const cx = Math.floor(f.gutter + (x - f.bounds.minX) / dx);
  const cz = Math.floor(f.gutter + (z - f.bounds.minZ) / dz);
  if (cx < 0 || cz < 0 || cx >= f.width || cz >= f.height) return undefined;
  const centre = (cz * f.width + cx) * 4;
  const radius = Math.max(0, Math.min(12, radiusM));
  if (f.geometry[centre + 1] < -radius - Math.max(dx, dz)) return undefined;
  const drawn = sampleFieldSurface(f, x, z, 0.005);
  if (drawn && drawn.coverage >= WATERLINE_CUT(x, z, drawn.kind)) return { ...drawn, wet: true };
  let best = -1, bestD = Infinity;
  const rx = Math.min(3, Math.ceil(radius / dx)), rz = Math.min(3, Math.ceil(radius / dz));
  // A wet texel already answers; do not search another body over it.
  for (let j = Math.max(0, cz-rz); j <= Math.min(f.height-1, cz+rz); j++) {
    for (let i = Math.max(0, cx-rx); i <= Math.min(f.width-1, cx+rx); i++) {
      const k = (j*f.width+i)*4;
      if (f.geometry[k] < 0.5 || !HYDRO_ID_KIND[f.material[k]]) continue;
      // Distance to the texel footprint, rather than its centre.
      const ex = Math.max(0, Math.abs(f.bounds.minX+(i-f.gutter+0.5)*dx-x)-dx*0.5);
      const ez = Math.max(0, Math.abs(f.bounds.minZ+(j-f.gutter+0.5)*dz-z)-dz*0.5);
      const d = ex*ex+ez*ez;
      if (d <= radius*radius && d < bestD) { best = k; bestD = d; }
    }
  }
  if (best < 0) return undefined;
  const flags = f.material[best+3];
  const bedMaterial = HYDRO_ID_BED[(flags & HYDRO_BED_MASK) >> HYDRO_BED_SHIFT] ?? 'silt';
  const bankMaterial = HYDRO_ID_BANK[(flags & HYDRO_BANK_MASK) >> HYDRO_BANK_SHIFT] ?? 'soil';
  return { wet: false, kind: HYDRO_ID_KIND[f.material[best]], coverage: drawn?.coverage ?? 0,
    restingLevelM: f.elevationBaseM+f.geometry[best+2],
    // `bankHabitat` consumes metres AWAY from the water on dry ground. The
    // signed field value here is negative, which previously collapsed every
    // dry texel in the 12m search radius to a zero-distance bank. Use the
    // measured distance to the nearest wet texel footprint instead.
    shoreDistanceM: Math.sqrt(bestD), depthM: f.geometry[best+3],
    flow: [f.dynamics[best],f.dynamics[best+1]], fetchM: f.dynamics[best+2],
    bedMaterial, bankMaterial,
    intermittent: (flags & HydroFlags.Intermittent)!==0,
    tidal: (flags & HydroFlags.Tidal)!==0 };
}
