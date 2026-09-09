import * as THREE from 'three';

/** Wire lines are not filled surfaces: derivative-derived flat normals can
 * become undefined. Keep the material's vertex deformation/colour hooks but
 * use its geometry normals for ordinary mesh wires. Shader-defined surfaces
 * and cutouts retain their solid treatment rather than exposing raw cards. */
export function createWireMaterialPolicy() {
  const saved = new WeakMap<THREE.Material, { wireframe: boolean; flatShading?: boolean }>();
  function restore(material: THREE.Material): void {
    const before = saved.get(material);
    if (!before) return;
    const m = material as THREE.MeshStandardMaterial;
    m.wireframe = before.wireframe;
    if (before.flatShading !== undefined && m.flatShading !== before.flatShading) {
      m.flatShading = before.flatShading;
      m.needsUpdate = true;
    }
    saved.delete(material);
  }
  return {
    apply(material: THREE.Material, enabled: boolean, keepSolid = false): void {
      const m = material as THREE.MeshStandardMaterial;
      if (!enabled) { restore(material); return; }
      if (keepSolid || material.userData.wireKeepSolid ||
          (material as THREE.ShaderMaterial).isShaderMaterial ||
          material.transparent || material.alphaTest > 0 || !('wireframe' in material)) {
        restore(material);
        return;
      }
      if (!saved.has(material)) saved.set(material, {
        wireframe: m.wireframe,
        flatShading: 'flatShading' in material ? m.flatShading : undefined,
      });
      if (m.flatShading) { m.flatShading = false; m.needsUpdate = true; }
      m.wireframe = true;
    },
  };
}
