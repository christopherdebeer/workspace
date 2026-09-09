import * as THREE from 'three';

/** Zoom is a ratio. Damping its logarithm gives the same response at a street
 * and at a hemisphere, without the second camera-position spring. */
export function smoothChartZoom(current: number, target: number, dt: number): number {
  return Math.exp(Math.log(current) + (Math.log(target) - Math.log(current))
    * -Math.expm1(-8 * Math.max(0, dt)));
}

export function wrapLongitude(lon: number): number {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

/** Re-seat the baked paraboloid under the VIEW, not the truck. Expanding
 * -(x-cx)^2-(z-cz)^2 gives exactly this shear plus translation. A rotation
 * was only a small-angle approximation and tilts distant browsed terrain.
 * The same matrix must carry the terrain and its road/label layer. */
export function chartShellMatrix(cx: number, cz: number, radius: number,
  out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.set(
    1, 0, 0, 0,
    cx / radius, 1, cz / radius, -(cx * cx + cz * cz) / (2 * radius),
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
}
