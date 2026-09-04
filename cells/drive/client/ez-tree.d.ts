/**
 * ── @dgreenheck/ez-tree, AS FAR AS THE TYPE CHECK IS CONCERNED ──
 *
 * The package reaches the browser from esm.sh through client/imports.json
 * and is never installed, so tsc has no declarations for it. This is the
 * published surface (build/ez-tree.es.d.ts of 1.1.0, which esm.sh serves as
 * X-TypeScript-Types) trimmed to what a caller can use: the sixteen preset
 * object types are collapsed into one, and the generator's internals
 * (branch queues, per-branch generate calls) are left out. flora-ez-lab.ts
 * type-checks against the published file unchanged; if the two ever drift,
 * `npm i --no-save @dgreenheck/ez-tree@1.1.0` at the workspace root and a
 * tsc run with this file moved aside is the arbiter.
 */
declare module '@dgreenheck/ez-tree' {
  import * as THREE from 'three';

  type PerLevel4 = { 0: number; 1: number; 2: number; 3: number };
  type PerLevel3 = { 0: number; 1: number; 2: number };

  /** Every option a tree is generated from; `copy` takes a plain object of
   *  the same shape, which is what a TreePreset entry is. */
  export class TreeOptions {
    seed: number;
    type: string;
    bark: {
      type: string;
      tint: number;
      flatShading: boolean;
      textured: boolean;
      textureScale: { x: number; y: number };
    };
    branch: {
      levels: number;
      angle: { 1: number; 2: number; 3: number };
      children: PerLevel3;
      force: { direction: { x: number; y: number; z: number }; strength: number };
      gnarliness: PerLevel4;
      length: PerLevel4;
      radius: PerLevel4;
      sections: PerLevel4;
      segments: PerLevel4;
      start: { 1: number; 2: number; 3: number };
      taper: PerLevel4;
      twist: PerLevel4;
    };
    leaves: {
      type: string;
      billboard: string;
      angle: number;
      count: number;
      start: number;
      size: number;
      sizeVariance: number;
      tint: number;
      alphaTest: number;
    };
    trellis: {
      enabled: boolean;
      position: { x: number; y: number; z: number };
      width: number;
      height: number;
      spacing: number;
      force: { strength: number; maxDistance: number; falloff: number };
      cylinderRadius: number;
      visible: boolean;
      color: number;
    };
    copy(source: TreeOptions, target?: this): void;
  }

  export type TreePresetName =
    | 'Ash Small' | 'Ash Medium' | 'Ash Large'
    | 'Aspen Small' | 'Aspen Medium' | 'Aspen Large'
    | 'Bush 1' | 'Bush 2' | 'Bush 3'
    | 'Oak Small' | 'Oak Medium' | 'Oak Large'
    | 'Pine Small' | 'Pine Medium' | 'Pine Large'
    | 'Willow';

  /** The published presets: plain option objects, keyed by name. */
  export const TreePreset: Record<TreePresetName, Omit<TreeOptions, 'copy'>>;

  export namespace BarkType { const Birch: string; const Oak: string; const Pine: string; const Willow: string; }
  export namespace Billboard { const Single: string; const Double: string; }
  export namespace LeafType { const Ash: string; const Aspen: string; const Oak: string; const Pine: string; }
  export namespace TreeType { const Deciduous: string; const Evergreen: string; }

  export class Trellis extends THREE.Group<THREE.Object3DEventMap> {}

  /** A THREE.Group carrying a branches mesh and a leaves mesh. `generate()`
   *  disposes the previous geometry and rebuilds both from `options`; the
   *  meshes' geometries are the product, their MeshStandardMaterials carry
   *  the package's own textures. */
  export class Tree extends THREE.Group<THREE.Object3DEventMap> {
    constructor(options?: TreeOptions);
    options: TreeOptions;
    branchesMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
    leavesMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
    trellisMesh: Trellis;
    update(elapsedTime: number): void;
    loadPreset(name: TreePresetName): void;
    loadFromJson(json: TreeOptions): void;
    generate(): void;
    get vertexCount(): number;
    get triangleCount(): number;
  }
}
