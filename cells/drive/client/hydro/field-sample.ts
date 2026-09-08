import { HYDRO_ID_KIND, HydroFlags, type HydroSample, type HydroTileField } from './types';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Match texture2D: geometry/dynamics are LINEAR; class/flags are NEAREST.
 * build-tile places texel centres at (i-gutter+0.5)*span/resolution.
 * The gutter makes the same interpolation valid right up to a tile boundary. */
export function sampleFieldSurface(field: HydroTileField, x: number, z: number,
  coverageCut = 0.5): HydroSample | undefined {
  const b = field.bounds;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return undefined;
  const sx = (b.maxX-b.minX)/field.resolution, sz = (b.maxZ-b.minZ)/field.resolution;
  if (!(sx > 0 && sz > 0)) return undefined;
  const px = field.gutter + (x-b.minX)/sx - 0.5;
  const pz = field.gutter + (z-b.minZ)/sz - 0.5;
  const ix = Math.floor(px), iz = Math.floor(pz), tx = px-ix, tz = pz-iz;
  const index = (i: number, j: number) => (clamp(j,0,field.height-1)*field.width+clamp(i,0,field.width-1))*4;
  const a=index(ix,iz), c=index(ix,iz+1), d=index(ix+1,iz+1), e=index(ix+1,iz);
  const bilinear = (v: Float32Array, k: number) =>
    (v[a+k]*(1-tx)+v[e+k]*tx)*(1-tz)+(v[c+k]*(1-tx)+v[d+k]*tx)*tz;
  const coverage=bilinear(field.geometry,0);
  const cut=Number.isFinite(coverageCut)?clamp(coverageCut,0,1):0.5;
  if (coverage < cut) return undefined;
  const i=index(Math.floor(px+0.5),Math.floor(pz+0.5));
  const kind=HYDRO_ID_KIND[field.material[i]];
  if (!kind) return undefined;
  const flag=field.material[i+3];
  return {kind,coverage,restingLevelM:field.elevationBaseM+bilinear(field.geometry,2),
    shoreDistanceM:bilinear(field.geometry,1),depthM:bilinear(field.geometry,3),
    flow:[bilinear(field.dynamics,0),bilinear(field.dynamics,1)],
    fetchM:bilinear(field.dynamics,2),
    intermittent:(flag&HydroFlags.Intermittent)!==0,tidal:(flag&HydroFlags.Tidal)!==0};
}
