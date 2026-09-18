import type { HydroTileField } from './types';
import { sampleFieldSurface } from './field-sample';

export interface HydroShorePoint {
  x: number;
  z: number;
  groundM: number;
}

export interface HydroShoreSegment {
  a: HydroShorePoint;
  b: HydroShorePoint;
}

const crossing = (
  a: HydroShorePoint,
  b: HydroShorePoint,
  av: number,
  bv: number,
): HydroShorePoint => {
  const t = Math.max(0, Math.min(1, av / (av - bv || 1)));
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    groundM: a.groundM + (b.groundM - a.groundM) * t,
  };
};

/** Extract the canonical coverage isoline with terrain elevation attached. */
export function extractHydroShoreSegments(
  field: HydroTileField,
  coverageCut = 0.5,
  includeGutter = false,
): HydroShoreSegment[] {
  const cut = Number.isFinite(coverageCut)
    ? Math.max(0, Math.min(1, coverageCut))
    : 0.5;
  const pixelX = (field.bounds.maxX - field.bounds.minX) / field.resolution;
  const pixelZ = (field.bounds.maxZ - field.bounds.minZ) / field.resolution;
  const at = (ix: number, iz: number): HydroShorePoint => {
    const i = iz * field.width + ix;
    return {
      x: field.bounds.minX + ((ix - field.gutter) + 0.5) * pixelX,
      z: field.bounds.minZ + ((iz - field.gutter) + 0.5) * pixelZ,
      groundM: field.elevationBaseM + field.ground[i],
    };
  };
  const value = (ix: number, iz: number): number =>
    field.geometry[(iz * field.width + ix) * 4] - cut;

  const out: HydroShoreSegment[] = [];
  // Render diagnostics normally want only cells whose four samples are inside
  // the tile. Terrain topology also needs the cells straddling the tile edge:
  // their interior/gutter pair gives both neighbours the same physical
  // crossing on their shared border instead of letting each bank terminate
  // half a texel before the seam.
  const margin = includeGutter && field.gutter > 0 ? 1 : 0;
  const x0 = field.gutter - margin;
  const z0 = field.gutter - margin;
  const x1 = field.gutter + field.resolution - 1 + margin;
  const z1 = field.gutter + field.resolution - 1 + margin;
  for (let iz = z0; iz < z1; iz++) for (let ix = x0; ix < x1; ix++) {
    const p = [
      at(ix, iz),
      at(ix + 1, iz),
      at(ix + 1, iz + 1),
      at(ix, iz + 1),
    ];
    const v = [
      value(ix, iz),
      value(ix + 1, iz),
      value(ix + 1, iz + 1),
      value(ix, iz + 1),
    ];
    const edges: Array<HydroShorePoint | undefined> = [
      (v[0] >= 0) !== (v[1] >= 0) ? crossing(p[0], p[1], v[0], v[1]) : undefined,
      (v[1] >= 0) !== (v[2] >= 0) ? crossing(p[1], p[2], v[1], v[2]) : undefined,
      (v[2] >= 0) !== (v[3] >= 0) ? crossing(p[2], p[3], v[2], v[3]) : undefined,
      (v[3] >= 0) !== (v[0] >= 0) ? crossing(p[3], p[0], v[3], v[0]) : undefined,
    ];
    const hits = edges.filter((point): point is HydroShorePoint => !!point);
    if (hits.length === 2) {
      out.push({ a: hits[0], b: hits[1] });
      continue;
    }
    if (hits.length !== 4) continue;

    const centreWet = (v[0] + v[1] + v[2] + v[3]) >= 0;
    const diagonal02Wet = v[0] >= 0 && v[2] >= 0;
    if (centreWet === diagonal02Wet) {
      out.push({ a: hits[0], b: hits[1] }, { a: hits[2], b: hits[3] });
    } else {
      out.push({ a: hits[0], b: hits[3] }, { a: hits[1], b: hits[2] });
    }
  }
  return out;
}

/** The exact terrain constraints for rivers, streams and canals. Standing and
 * coastal shorelines keep their existing terrain treatment; this adapter is
 * deliberately scoped to the channel banks whose coarse triangles visibly
 * bridged over the rendered body. */
export function extractFlowingHydroShoreSegments(
  field: HydroTileField,
  coverageCut = 0.5,
  includeGutter = false,
): HydroShoreSegment[] {
  return extractHydroShoreSegments(field, coverageCut, includeGutter)
    .filter((segment) => {
      const sample = sampleFieldSurface(
        field,
        (segment.a.x + segment.b.x) * 0.5,
        (segment.a.z + segment.b.z) * 0.5,
        0.1,
      );
      return sample?.kind === 'river'
        || sample?.kind === 'stream'
        || sample?.kind === 'canal';
    });
}
