import { equipRig, equipmentFor, type RigEquipmentId } from './rig-equipment';
import { createRanger } from './rig-ranger';
import * as THREE from 'three';

/** The physics footprint is shared by both bodies. A new wheelbase belongs in
 * this definition AND the simulation adapter, never hidden in a mesh scale. */
export const OVERLAND = {
  scaleX: 0.7, scaleY: 0.8, wheelRadius: 0.45, wheelWidth: 0.36,
  trackHalf: 1.18 * 0.7, axleHalf: 1.55,
};
export type RigModelId = 'classic' | 'ranger';
export type RigLoadoutId = 'light' | 'expedition' | 'service';
export const RIG_MODELS: RigModelId[] = ['ranger', 'classic'];
export const RIG_LOADOUTS: RigLoadoutId[] = ['expedition', 'light', 'service'];
export interface RigModel {
  root: THREE.Group;
  bodyMat: THREE.MeshLambertMaterial;
  tailMat: THREE.MeshBasicMaterial;
  wheelPivots: THREE.Group[];
  wheelMeshes: THREE.Mesh[];
  cabMats: THREE.MeshLambertMaterial[];
  parts: THREE.Object3D[];
  anchors: { lamps: THREE.Vector3[]; eye: { x: number; y: number; z: number } };
  setRegistration?(user?: string | null): boolean;
  dispose(): void;
}

/** No scene, campaign, storage or renderer globals. The host supplies its
 * weathering treatment; the model owns only the resources it constructs. */
function createRigBase(model: RigModelId, loadout: RigLoadoutId,
  bodywork: (material: THREE.Material, amount: number) => void): RigModel {
  if (model === 'ranger') return createRanger(loadout, bodywork);
  const { scaleX: SX, scaleY: SY, wheelRadius: WHEEL_R, wheelWidth: WHEEL_W,
    trackHalf: TRACK, axleHalf: AXLE } = OVERLAND;
  const WHEELS = [[-TRACK, -AXLE], [TRACK, -AXLE], [-TRACK, AXLE], [TRACK, AXLE]];
let bodyMat!: THREE.MeshLambertMaterial;
const tailMat = new THREE.MeshBasicMaterial({ color: 0x8e1a12 }); // brightens under braking
const car = new THREE.Group();
car.name = 'car';
car.rotation.order = 'YXZ'; // yaw first, then pitch/roll about the CAR's axes
const wheelPivots: THREE.Group[] = [];
const wheelMeshes: THREE.Mesh[] = [];
// The truck's own materials, collected so the cab view can ghost the shell —
// CAR-LOCAL ONLY. woodMat/leafMat are shared with the world's vegetation, and
// ghosting those would fade every tree in the game with the bonnet.
const cabMats: THREE.MeshLambertMaterial[] = [];
{
  // Built against the reference: a boxy overland 4x4 — glasshouse cab set
  // back, short bonnet, open rear tub, fender flares tying the wheels to the
  // body, and the gear an expedition truck actually carries. Every part is a
  // slab or a cylinder; the silhouette does the work at pixel resolution.
  const RED = 0xc4402c, DARK = 0x1b1f26, STEEL = 0x2a2f36, TAN = 0x6b6250;
  // DoubleSide: the extruded wheel arches are the one part whose winding is
  // not under our control, and a flipped face there renders as a black hole.
  const redMat = new THREE.MeshLambertMaterial({ color: RED, flatShading: true, side: THREE.DoubleSide });
  const glassMat = new THREE.MeshLambertMaterial({ color: DARK, flatShading: true });
  const steelMat = new THREE.MeshLambertMaterial({ color: STEEL, flatShading: true });
  const cargoMat = new THREE.MeshLambertMaterial({ color: TAN, flatShading: true });
  bodyMat = redMat;
  bodywork(redMat, 1);
  bodywork(steelMat, 0.35);
  bodywork(cargoMat, 0.5);
  const panelMat = new THREE.MeshLambertMaterial({ color: 0x14304e, emissive: 0x060f1c, flatShading: true });
  // Dark trim: arch lips, shut lines, handles. Unweathered — these are the
  // rubber-and-plastic parts, and the paint shader would only muddy them.
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x241f1c, flatShading: true, side: THREE.DoubleSide });
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x14171c, flatShading: true });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0x8f8574, flatShading: true });
  cabMats.push(redMat, glassMat, steelMat, cargoMat, panelMat, trimMat, tireMat, hubMat);
  // Every hull part sits DROP metres lower than its written y. The suspension
  // geometry wants the group origin on the axle plane, but hanging the body
  // where that put it left 1.3m of daylight under the tub and the truck walked
  // on stilts. One offset here beats re-deriving thirty numbers.
  const DROP = 0.3;
  const ranger = false; // Classic retains its original geometry.
  // Both the geometry and its placement go through the spec-sheet squeeze, so
  // the authored numbers below stay readable and the sheet is honoured in
  // exactly one place. Every geometry handed in here is freshly built, so
  // scaling it in place is safe.
  // Placement is baked into the GEOMETRY, not carried on the mesh. The bodywork
  // shader below reads `position` straight out of the vertex buffer and needs
  // it in CAR space — with the offset on the mesh instead, every part would
  // have been centred on its own origin and the panel lines, dust gradient and
  // camo would have restarted on each box.
  // `rx` rakes a panel (windscreen, bonnet, solar) about its own centre, so it
  // has to happen after the squeeze and before the translate.
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh => {
    geo.scale(SX, SY, 1);
    if (rx) geo.rotateX(rx);
    geo.translate(x * SX, (y - DROP) * SY, z);
    const m = new THREE.Mesh(geo, mat);
    car.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number): THREE.BoxGeometry => new THREE.BoxGeometry(w, h, d);
  // ── hull ──
  add(box(1.95, ranger ? 0.60 : 0.85, 4.2), redMat, 0, 0.9, 0);                 // body tub
  add(box(1.35, 0.24, 3.4), steelMat, 0, 0.42, 0);              // exposed frame rails
  // ── the nose is not a brick ──
  // The bonnet falls away toward the grille and the leading edge is chamfered,
  // so the front three-quarter reads as a vehicle rather than a shipping crate.
  add(box(1.7, 0.34, 1.05), redMat, 0, 1.52, -1.46, -0.11);     // bonnet, sloping down
  add(box(1.66, 0.2, 0.4), redMat, 0, 1.4, -1.98, -0.34);        // chamfer into the grille
  for (const sx of [-0.8, 0.8]) add(box(0.16, 0.3, 1.0), redMat, sx, 1.5, -1.48, -0.11); // wing tops
  // The cab is RED with a dark GLASS BAND through it, not a black block. That
  // banding — red waist, black glass, red header and roof — is what makes the
  // reference read as one painted truck instead of a cargo pod on a chassis.
  add(box(1.7, 0.78, ranger ? 1.42 : 1.62), redMat, 0, 1.7, -0.31);             // cab shell
  add(box(1.74, 0.34, 1.66), glassMat, 0, 1.86, -0.31);         // side glazing
  // RAKED WINDSCREEN. A vertical pane is the single most box-like thing about
  // the old hull; the reference leans it back over the bonnet. Sitting proud of
  // the cab on its own tilt, it also gives the roofline something to end on.
  add(box(1.66, 0.52, 0.1), glassMat, 0, 1.88, -1.2, 0.42);
  for (const px of [-0.85, 0.85]) add(box(0.14, 0.56, 0.13), redMat, px, 1.88, -1.2, 0.42); // A-pillars, on the rake
  // B and C pillars split the side glass into windows. They sit ON the glass
  // face (x = 0.87, the band's own half-width), not inboard of it: at 0.8 they
  // were buried inside it and invisible from the side elevation.
  for (const pz of [-0.4, 0.42]) {
    for (const px of [-0.87, 0.87]) add(box(0.16, 0.36, 0.15), redMat, px, 1.86, pz);
  }
  add(box(1.74, 0.14, 1.78), redMat, 0, 2.14, -0.39);           // roof cap
  add(box(1.7, 0.13, 0.3), redMat, 0, 2.11, -1.32, 0.3);        // roof leading edge, faired down
  // ── rear tub: side rails and a tailgate, so the back reads as open cargo ──
  for (const sx of [-0.92, 0.92]) add(box(0.11, 0.34, 1.7), redMat, sx, 1.5, 1.2);
  add(box(1.9, 0.34, 0.12), redMat, 0, 1.5, 2.02);
  // Sand ladders strapped along the tub — pure silhouette texture at 320p.

  // ── wheel arches: ARCHES ──
  // Four rectangles over four round tyres was the most obviously wrong thing on
  // the side elevation. These are extruded annulus sectors, so the flare
  // actually follows the tyre. They are built in FINAL metres and added
  // directly — pushing a circle through the SX/SY squeeze would turn it into an
  // ellipse while the tyre beside it stayed round.
  {
    const arch = (r0: number, r1: number, wid: number, mat: THREE.Material): void => {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, r1, 0.12, Math.PI - 0.12, false);
      shape.absarc(0, 0, r0, Math.PI - 0.12, 0.12, true);
      const proto = new THREE.ExtrudeGeometry(shape, { depth: wid, bevelEnabled: false });
      proto.rotateY(Math.PI / 2);        // arch plane → the truck's flank
      proto.translate(-wid / 2, 0, 0);   // and centre it on the wheel
      for (const [fx, fz] of WHEELS) {
        const g = proto.clone();
        g.translate(fx, 0, fz);
        car.add(new THREE.Mesh(g, mat));
      }
      proto.dispose();
    };
    const R1 = WHEEL_R + 0.07;
    // Body-coloured flare, then a dark trim lip WRAPPING its outer edge. Red on
    // red, the flare vanished into the flank; every 4x4 that has flares this
    // wide has them edged in something that isn't paint.
    arch(R1, R1 + 0.16, WHEEL_W + 0.08, redMat);
    arch(R1 + 0.13, R1 + 0.22, WHEEL_W + 0.14, trimMat);
  }
  // ── door cuts and handles ──
  // The shader's panel grid is regular by nature; a door is not. These are the
  // shut lines an eye actually looks for on a flank.
  for (const sx of [-0.99, 0.99]) {
    for (const dz of [-1.12, 0.02, 0.5]) add(box(0.05, 0.62, 0.05), trimMat, sx, 1.34, dz);
    add(box(0.05, 0.05, 1.1), trimMat, sx, 1.63, -0.55);        // waist line
    for (const dz of [-0.72, 0.3]) add(box(0.06, 0.06, 0.2), trimMat, sx, 1.5, dz); // handles
  }
  // ── protection: bull bar, winch, rock sills, tow points ──
  add(box(2.0, 0.26, 0.2), steelMat, 0, 0.95, -2.2);


  for (const sx of [-1.03, 1.03]) add(box(0.13, 0.13, 2.5), steelMat, sx, 0.52, 0);
  add(box(1.7, 0.22, 0.16), steelMat, 0, 0.95, 2.16);
  // ── the face ── grille between the lamps, so the nose is not a blank slab.
  add(box(1.12, 0.34, 0.1), glassMat, 0, 1.28, -2.1);
  for (const gy of [1.18, 1.3, 1.42]) add(box(1.06, 0.05, 0.13), steelMat, 0, gy, -2.11);
  // ── lamps ── small and set into the corners; big ones bloom into blobs.
  const headMat2 = new THREE.MeshBasicMaterial({ color: 0xfff1cf });
  for (const sx of [-0.66, 0.66]) add(box(0.3, 0.2, 0.1), headMat2, sx, 1.08, -2.13);
  for (const sx of [-0.78, 0.78]) add(box(0.22, 0.26, 0.08), tailMat, sx, 1.1, 2.12);
  // ── wheels ──
  for (const [wx, wz] of WHEELS) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0, wz);
    const tireGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 12);
    tireGeo.rotateZ(Math.PI / 2);
    const wheel = new THREE.Mesh(tireGeo, tireMat);
    const hubGeo = new THREE.CylinderGeometry(WHEEL_R * 0.42, WHEEL_R * 0.42, WHEEL_W + 0.08, 8);
    hubGeo.rotateZ(Math.PI / 2);
    wheel.add(new THREE.Mesh(hubGeo, hubMat));
    if (ranger) {
      // One tread mesh per wheel, no per-frame allocations or tread draws.
      // The alternating shoulder profile catches light as the wheel turns.
      const tread = new THREE.CylinderGeometry(WHEEL_R + 0.015, WHEEL_R + 0.015, WHEEL_W * 0.86, 16, 1, true);
      tread.rotateZ(Math.PI / 2);
      wheel.add(new THREE.Mesh(tread, tireMat));
    }
    pivot.add(wheel);
    car.add(pivot);
    wheelPivots.push(pivot);
    wheelMeshes.push(wheel);
  }
}

  const parts = [...car.children];
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>(cabMats);
  car.traverse(o => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    mesh.name ||= `rig-${model}-${geometries.size}`;
    geometries.add(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(m);
      if (m instanceof THREE.MeshLambertMaterial && !cabMats.includes(m)) cabMats.push(m);
    }
  });
  return { root: car, bodyMat, tailMat, wheelPivots, wheelMeshes, cabMats, parts,
    anchors: { lamps: [-0.62, 0.62].map(x => new THREE.Vector3(x * SX, 0.78 * SY, -2.05)),
      eye: { x: 0.42, y: 2.16, z: -0.95 } },
    dispose() { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); },
  };
}


/** Legacy loadouts remain a migration/API convenience; the player's selected
 * fittings are independent flags and the empty array really is bare. */
export function createRigModel(model: RigModelId, loadout: RigLoadoutId,
  bodywork: (material: THREE.Material, amount: number) => void,
  equipment: readonly RigEquipmentId[] = equipmentFor(loadout)): RigModel {
  return equipRig(createRigBase(model, loadout, bodywork), model, equipment);
}
