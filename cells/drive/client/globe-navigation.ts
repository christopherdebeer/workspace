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
