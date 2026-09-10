import type {
  CoverageGrid,
  ElevationGrid,
  HydroFeature,
  HydroGeometry,
  HydroPolygon,
  PackedXZ,
  WorldBounds,
} from './types';

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export function featureBounds(feature: HydroFeature): WorldBounds {
  const out = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  const note = (p: PackedXZ): void => {
    for (let i = 0; i + 1 < p.length; i += 2) {
      const x = p[i], z = p[i + 1];
      if (x < out.minX) out.minX = x;
      if (z < out.minZ) out.minZ = z;
      if (x > out.maxX) out.maxX = x;
      if (z > out.maxZ) out.maxZ = z;
    }
  };
  if (feature.geometry.type === 'line') {
    note(feature.geometry.points);
    const r = feature.geometry.widthM * 0.5;
    out.minX -= r; out.minZ -= r; out.maxX += r; out.maxZ += r;
  } else {
    for (const polygon of feature.geometry.polygons) {
      note(polygon.outer);
      for (const hole of polygon.holes) note(hole);
    }
  }
  return out;
}

export function boundsIntersect(a: WorldBounds, b: WorldBounds, pad = 0): boolean {
  return a.maxX + pad >= b.minX && a.minX - pad <= b.maxX
    && a.maxZ + pad >= b.minZ && a.minZ - pad <= b.maxZ;
}

export function pointInRing(x: number, z: number, ring: PackedXZ): boolean {
  let inside = false;
  const n = ring.length >> 1;
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[i * 2], az = ring[i * 2 + 1];
    const bx = ring[j * 2], bz = ring[j * 2 + 1];
    const crosses = (az > z) !== (bz > z)
      && x < ((bx - ax) * (z - az)) / ((bz - az) || Number.EPSILON) + ax;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x: number, z: number, polygon: HydroPolygon): boolean {
  if (!pointInRing(x, z, polygon.outer)) return false;
  for (const hole of polygon.holes) if (pointInRing(x, z, hole)) return false;
  return true;
}

export function pointInArea(x: number, z: number, geometry: Extract<HydroGeometry, { type: 'area' }>): boolean {
  for (const polygon of geometry.polygons) if (pointInPolygon(x, z, polygon)) return true;
  return false;
}

export interface SegmentHit {
  distanceM: number;
  x: number;
  z: number;
  t: number;
  segment: number;
  tangentX: number;
  tangentZ: number;
}

export function nearestSegment(x: number, z: number, points: PackedXZ | Float32Array, stride = 2): SegmentHit {
  let best: SegmentHit = {
    distanceM: Infinity, x, z, t: 0, segment: -1, tangentX: 0, tangentZ: 0,
  };
  const count = Math.floor(points.length / stride);
  for (let i = 0; i + 1 < count; i++) {
    const o = i * stride, p = (i + 1) * stride;
    const ax = points[o], az = points[o + 1];
    const bx = points[p], bz = points[p + 1];
    const dx = bx - ax, dz = bz - az;
    const d2 = dx * dx + dz * dz;
    const t = d2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / d2, 0, 1) : 0;
    const qx = ax + dx * t, qz = az + dz * t;
    const distanceM = Math.hypot(x - qx, z - qz);
    if (distanceM < best.distanceM) {
      const len = Math.sqrt(d2) || 1;
      best = {
        distanceM, x: qx, z: qz, t, segment: i,
        tangentX: dx / len, tangentZ: dz / len,
      };
    }
  }
  return best;
}

export function distanceToRing(x: number, z: number, ring: PackedXZ): number {
  const n = ring.length >> 1;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2], az = ring[i * 2 + 1];
    const bx = ring[j * 2], bz = ring[j * 2 + 1];
    const dx = bx - ax, dz = bz - az;
    const d2 = dx * dx + dz * dz;
    const t = d2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / d2, 0, 1) : 0;
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

export function sampleElevation(
  grid: ElevationGrid,
  bounds: WorldBounds,
  x: number,
  z: number,
): number {
  if (grid.width < 1 || grid.height < 1 || grid.data.length < grid.width * grid.height) return NaN;
  const u = clamp((x - bounds.minX) / Math.max(Number.EPSILON, bounds.maxX - bounds.minX), 0, 1);
  const v = clamp((z - bounds.minZ) / Math.max(Number.EPSILON, bounds.maxZ - bounds.minZ), 0, 1);
  const fx = u * (grid.width - 1), fz = v * (grid.height - 1);
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(grid.width - 1, x0 + 1), z1 = Math.min(grid.height - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const at = (gx: number, gz: number): number => grid.data[gz * grid.width + gx];
  const a = at(x0, z0), b = at(x1, z0), c = at(x0, z1), d = at(x1, z1);
  const invalid = (h: number): boolean => !Number.isFinite(h) || (grid.noData !== undefined && h === grid.noData);
  if (invalid(a) || invalid(b) || invalid(c) || invalid(d)) {
    for (const h of [a, b, c, d]) if (!invalid(h)) return h;
    return NaN;
  }
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

export function sampleCoverage(
  grid: CoverageGrid,
  bounds: WorldBounds,
  x: number,
  z: number,
): number {
  if (grid.width < 1 || grid.height < 1 || grid.data.length < grid.width * grid.height) return 0;
  const u = clamp((x - bounds.minX) / Math.max(Number.EPSILON, bounds.maxX - bounds.minX), 0, 1);
  const v = clamp((z - bounds.minZ) / Math.max(Number.EPSILON, bounds.maxZ - bounds.minZ), 0, 1);
  const gx = Math.round(u * (grid.width - 1));
  const gz = Math.round(v * (grid.height - 1));
  return grid.data[gz * grid.width + gx] / 255;
}

export function quantile(values: number[], q: number): number | undefined {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return undefined;
  const p = clamp(q, 0, 1) * (finite.length - 1);
  const i = Math.floor(p), t = p - i;
  return finite[i] * (1 - t) + finite[Math.min(finite.length - 1, i + 1)] * t;
}

export function hashString(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function areaOfRing(ring: PackedXZ): number {
  let twice = 0;
  const n = ring.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    twice += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return Math.abs(twice) * 0.5;
}
