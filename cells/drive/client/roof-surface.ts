import * as THREE from 'three';
import { flatBox } from './roof';

/** Per-building metric roof frame. Kept on geometry so batches share materials.
 * xy is the local plan coordinate; zw its span. Concave plans use negative
 * spans: courses still align, but a bounding-box shadow would invent edges. */
export function attachRoofSurface(geo: THREE.BufferGeometry, seats: Array<{
  pts: Array<[number, number]>; ranges: Array<{ start: number; count: number }>;
}>): void {
  const pos = geo.getAttribute('position');
  const data = new Float32Array(pos.count * 4);
  for (const seat of seats) {
    if (seat.pts.length < 3) continue;
    const p = flatBox(seat.pts), w = p.u1 - p.u0, d = p.v1 - p.v0;
    if (w < 0.1 || d < 0.1) continue;
    let area = 0;
    for (let i=0; i<seat.pts.length; i++) {
      const a=seat.pts[i], b=seat.pts[(i+1)%seat.pts.length];
      area += a[0]*b[1]-b[0]*a[1];
    }
    const sign = Math.abs(area)/2 > w*d*0.94 ? 1 : -1;
    for (const r of seat.ranges) for (let i=r.start; i<r.start+r.count; i++) {
      const x=pos.getX(i), z=pos.getZ(i);
      data.set([x*p.ux+z*p.uz-p.u0, x*p.vx+z*p.vz-p.v0, w*sign, d*sign], i*4);
    }
  }
  geo.setAttribute('aRoofPlan', new THREE.BufferAttribute(data, 4));
}
