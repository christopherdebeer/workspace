import * as THREE from 'three';

/** Shader-only condition. Habitation never implies a change to collision or massing. */
export interface BuildingCondition { inhabited: number; decay: number }
type Ring = Array<[number, number]>;
interface Fabric { id: number; x: number; z: number; seed: number; material: number; decay: number }
const fabrics = new WeakMap<Ring, Fabric>();
const overrides = new Map<number, Partial<BuildingCondition>>();
const kinds = ['render', 'stone', 'brick', 'timber', 'adobe'];
function hash(id: number): number {
  let h = (id | 0) ^ Math.imul(Math.floor(id / 4294967296), 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export function registerBuildingFabric(pts: Ring, id: number, material: string, ruin = false): void {
  const seed = hash(id) & 65535;
  const x = pts.reduce((n, p) => n + p[0], 0) / Math.max(1, pts.length);
  const z = pts.reduce((n, p) => n + p[1], 0) / Math.max(1, pts.length);
  fabrics.set(pts, { id, x, z, seed, material: Math.max(0, kinds.indexOf(material)),
    decay: (ruin ? 0.78 : 0.48) + (seed / 65535) * (ruin ? 0.22 : 0.40) });
}
export function inheritBuildingFabric(pts: Ring, parent: Ring): void {
  const f = fabrics.get(parent); if (f) fabrics.set(pts, f);
}
function packed(f: Fabric): number {
  const c = overrides.get(f.id);
  return 1 + Math.round((c?.inhabited ?? 0) * 255)
    + Math.round((c?.decay ?? f.decay) * 255) * 256 + f.material * 65536;
}
type Range = { start: number; count: number };
type Binding = { fabric: Fabric; ranges: Range[] };
/** One vec4, eight total attributes on a wall batch; no new geometry/groups. */
export function attachBuildingFabric(geo: THREE.BufferGeometry,
  seats: Array<{ pts: Ring; ranges: Range[] }>): void {
  const data = new Float32Array(geo.attributes.position.count * 4);
  const bindings: Binding[] = [];
  for (const seat of seats) {
    const f = fabrics.get(seat.pts); if (!f) continue;
    bindings.push({ fabric: f, ranges: seat.ranges });
    const p = packed(f);
    for (const r of seat.ranges) for (let i = r.start; i < r.start + r.count; i++) {
      data[i * 4] = f.x; data[i * 4 + 1] = f.z; data[i * 4 + 2] = p; data[i * 4 + 3] = f.seed;
    }
  }
  geo.setAttribute('aFabric', new THREE.BufferAttribute(data, 4));
  geo.userData.fabricBindings = bindings;
}
/** Call from contextual gameplay. Overrides apply to loaded and future batches.
 * Values are independent: a reclaimed home can still be heavily weathered.
 * Passing null clears the override. Only this explicit API enables habitation.
 */
export function setBuildingCondition(id: number, patch: Partial<BuildingCondition> | null, root?: THREE.Object3D): void {
  if (!Number.isSafeInteger(id)) throw new Error('Building id must be a safe integer');
  if (patch) {
    for (const k of Object.keys(patch)) {
      const v = patch[k as keyof BuildingCondition];
      if (!['inhabited', 'decay'].includes(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)
        throw new Error('Building condition requires inhabited/decay in [0, 1]');
    }
    overrides.set(id, { ...overrides.get(id), ...patch });
  } else overrides.delete(id);
  root?.traverse((obj) => {
    const geo = (obj as THREE.Mesh).geometry;
    if (!geo) return;
    const bindings = geo.userData.fabricBindings as Binding[] | undefined;
    const attr = geo.getAttribute('aFabric') as THREE.BufferAttribute | undefined;
    if (!bindings || !attr) return;
    let changed = false;
    for (const b of bindings) if (b.fabric.id === id) {
      const p = packed(b.fabric);
      for (const r of b.ranges) for (let i = r.start; i < r.start + r.count; i++) attr.setZ(i, p);
      changed = true;
    }
    if (changed) attr.needsUpdate = true;
  });
}
