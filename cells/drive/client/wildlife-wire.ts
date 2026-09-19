import * as THREE from 'three';

/** Wildlife has real instanced triangles. WIRE must show those triangles with
 * an unlit shader: flat Lambert shading reconstructs normals with fragment
 * derivatives, which are not a reliable surface normal for rasterised lines.
 * In the post pipeline that path can produce black blocks instead of edges.
 * Geometry, instance matrices and per-instance/vertex colours remain intact. */
export function createWildlifeWire() {
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const wires = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  const wireFor = (source: THREE.Material): THREE.MeshBasicMaterial => {
    let wire = wires.get(source);
    if (!wire) {
      const coloured = source as THREE.MeshLambertMaterial;
      wire = new THREE.MeshBasicMaterial({
        name: 'wildlife-debug-wire',
        color: coloured.color?.clone() ?? new THREE.Color(0xffffff),
        vertexColors: !!source.vertexColors,
        wireframe: true,
        side: source.side,
        depthTest: source.depthTest,
        depthWrite: source.depthWrite,
        toneMapped: source.toneMapped,
      });
      source.userData.wildlifeDeform?.(wire);
      wires.set(source, wire);
    }
    wire.visible = source.visible;
    return wire;
  };
  return {
    apply(mesh: THREE.Mesh, enabled: boolean): void {
      if (enabled) {
        if (!originals.has(mesh)) originals.set(mesh, mesh.material);
        const original = originals.get(mesh)!;
        mesh.material = Array.isArray(original) ? original.map(wireFor) : wireFor(original);
      } else {
        const original = originals.get(mesh);
        if (original) { mesh.material = original; originals.delete(mesh); }
      }
    },
    dispose(): void {
      for (const [mesh, original] of originals) mesh.material = original;
      originals.clear();
      for (const wire of wires.values()) wire.dispose();
      wires.clear();
    },
  };
}
