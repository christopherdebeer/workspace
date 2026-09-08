import { HYDRO_ID_KIND, HydroFlags, type HydroTileField, type HydroSample } from './hydro/types';
/** Shared inland-bank art rules. No water is invented when the field is absent.
 * Geometry/depth remain the hydro system's authority; these are habitat weights. */
export interface BankWater {
  kind: string; restingLevelM: number; depthM: number;
  shoreDistanceM: number; flow: readonly [number, number];
}
const unit = (v: number) => Math.max(0, Math.min(1, v));
export function bankHabitat(cover: number | null, moisture: number, tempC: number,
  slope: number, nearWater: boolean, groundM: number, water?: BankWater
): { reeds: number; mineral: number; submerged: boolean; depth: number } {
  const depth = water ? Math.max(0, water.restingLevelM - groundM) : 0;
  const submerged = !!water && depth > 0.04;
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

/** Continuous, stationary metre-space patches shared by hydro and sward.
 * No time or tile seed: streamed tiles cannot disagree at their boundaries. */
export const BANK_GLSL = /* glsl */`
float bankHash(vec2 p) {
  vec3 h = fract(vec3(p.xyx) * 0.1031);
  h += dot(h, h.yzx + 33.33);
  return fract((h.x + h.y) * h.z);
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
  radiusM: number): HydroSample | undefined {
  const dx = (f.bounds.maxX - f.bounds.minX) / (f.resolution - 1);
  const dz = (f.bounds.maxZ - f.bounds.minZ) / (f.resolution - 1);
  if (!(dx > 0 && dz > 0)) return undefined;
  const cx = Math.round(f.gutter + (x - f.bounds.minX) / dx);
  const cz = Math.round(f.gutter + (z - f.bounds.minZ) / dz);
  if (cx < 0 || cz < 0 || cx >= f.width || cz >= f.height) return undefined;
  const centre = (cz * f.width + cx) * 4;
  const radius = Math.max(0, Math.min(12, radiusM));
  if (f.geometry[centre + 1] < -radius - Math.max(dx, dz)) return undefined;
  let best = -1, bestD = Infinity;
  const rx = Math.min(3, Math.ceil(radius / dx)), rz = Math.min(3, Math.ceil(radius / dz));
  // A wet texel already answers; do not search another body over it.
  if (f.geometry[centre] >= 0.5 && HYDRO_ID_KIND[f.material[centre]]) best = centre;
  else for (let j = Math.max(0, cz-rz); j <= Math.min(f.height-1, cz+rz); j++) {
    for (let i = Math.max(0, cx-rx); i <= Math.min(f.width-1, cx+rx); i++) {
      const k = (j*f.width+i)*4;
      if (f.geometry[k] < 0.5 || !HYDRO_ID_KIND[f.material[k]]) continue;
      // Distance to the texel footprint, rather than its centre.
      const ex = Math.max(0, Math.abs(f.bounds.minX+(i-f.gutter)*dx-x)-dx*0.5);
      const ez = Math.max(0, Math.abs(f.bounds.minZ+(j-f.gutter)*dz-z)-dz*0.5);
      const d = ex*ex+ez*ez;
      if (d <= radius*radius && d < bestD) { best = k; bestD = d; }
    }
  }
  if (best < 0) return undefined;
  const flags = f.material[best+3];
  return { kind: HYDRO_ID_KIND[f.material[best]], coverage: f.geometry[centre],
    restingLevelM: f.elevationBaseM+f.geometry[best+2],
    shoreDistanceM: f.geometry[centre+1], depthM: f.geometry[best+3],
    flow: [f.dynamics[best],f.dynamics[best+1]], fetchM: f.dynamics[best+2],
    intermittent: (flags & HydroFlags.Intermittent)!==0,
    tidal: (flags & HydroFlags.Tidal)!==0 };
}
