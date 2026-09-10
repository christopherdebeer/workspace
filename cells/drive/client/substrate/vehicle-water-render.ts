import * as THREE from 'three';
import type { VehicleWaterStamp } from './vehicle-water';

export interface VehicleWaterEvidenceRenderer {
  readonly object3d: THREE.Object3D;
  update(stamps: readonly VehicleWaterStamp[], timeSeconds: number): void;
  dispose(): void;
}

/**
 * Wet contact evidence is a terrain-hugging translucent layer. It contains no
 * Bayer pattern, palette step or colour quantisation; the global post pipeline
 * remains the sole owner of those operations.
 */
export function createVehicleWaterEvidenceRenderer(capacity = 192): VehicleWaterEvidenceRenderer {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, 0, -1,
    1, 0, -1,
    1, 0, 1,
    -1, 0, 1,
  ], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  const iPose = new Float32Array(capacity * 4);
  const iShape = new Float32Array(capacity * 4);
  geo.setAttribute('iPose', new THREE.InstancedBufferAttribute(iPose, 4));
  geo.setAttribute('iShape', new THREE.InstancedBufferAttribute(iShape, 4));
  geo.instanceCount = 0;

  const material = new THREE.ShaderMaterial({
    name: 'vehicle-water-evidence',
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */`
      attribute vec4 iPose;
      attribute vec4 iShape;
      varying vec2 vLocal;
      varying float vAlpha;
      varying float vKind;
      void main() {
        float c = cos(iPose.w), s = sin(iPose.w);
        vec2 local = position.xz * iShape.xy;
        vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
        vec3 world = vec3(iPose.x + rotated.x, iPose.y, iPose.z + rotated.y);
        vLocal = position.xz;
        vAlpha = iShape.z;
        vKind = iShape.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vLocal;
      varying float vAlpha;
      varying float vKind;
      void main() {
        float d = length(vLocal);
        float edge = 1.0 - smoothstep(0.72, 1.0, d);
        if (edge <= 0.001) discard;
        float centre = 1.0 - smoothstep(0.0, 0.92, d);
        vec3 track = vec3(0.055, 0.070, 0.064);
        vec3 drip = vec3(0.070, 0.087, 0.080);
        vec3 colour = mix(track, drip, vKind);
        gl_FragColor = vec4(colour, vAlpha * edge * (0.72 + centre * 0.28));
      }`,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'vehicle-water-evidence';
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;

  return {
    object3d: mesh,
    update(stamps, timeSeconds) {
      const count = Math.min(capacity, stamps.length);
      const start = Math.max(0, stamps.length - count);
      for (let j = 0; j < count; j++) {
        const stamp = stamps[start + j];
        const age = Math.max(0, timeSeconds - stamp.bornSeconds);
        const life = Math.max(0, 1 - age / stamp.lifeSeconds);
        const tail = life * life * (3 - 2 * life);
        const pose = j * 4;
        iPose[pose] = stamp.x;
        iPose[pose + 1] = stamp.yM;
        iPose[pose + 2] = stamp.z;
        iPose[pose + 3] = stamp.heading;
        const shape = j * 4;
        const drip = stamp.kind === 'drip';
        iShape[shape] = drip ? .18 + age * .018 : .20;
        iShape[shape + 1] = drip ? .18 + age * .018 : .42;
        iShape[shape + 2] = stamp.strength * tail * (drip ? .34 : .28);
        iShape[shape + 3] = drip ? 1 : 0;
      }
      geo.instanceCount = count;
      (geo.attributes.iPose as THREE.InstancedBufferAttribute).needsUpdate = true;
      (geo.attributes.iShape as THREE.InstancedBufferAttribute).needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
