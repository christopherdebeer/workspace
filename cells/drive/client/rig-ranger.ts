import * as THREE from 'three';
import type { RigModel, RigLoadoutId } from './rig-model';

/** Ranger is a forward-control field vehicle, authored in final metres. It
 * shares contact points with Classic, but no body panels: the windscreen
 * leads, the nose is a short wedge and the rear is an integrated workshop.
 * Equipment sits below the cab roof so it cannot erase that silhouette. */
export function createRanger(loadout: RigLoadoutId,
  weather: (mat: THREE.Material, amount: number) => void): RigModel {
  const root = new THREE.Group(); root.name = 'car'; root.rotation.order = 'YXZ';
  const paint = new THREE.MeshLambertMaterial({ color: 0xc4402c, flatShading: true });
  const shell = new THREE.MeshLambertMaterial({ color: 0xa49b7c, flatShading: true });
  const frame = new THREE.MeshLambertMaterial({ color: 0x303b38, flatShading: true });
  const glass = new THREE.MeshLambertMaterial({ color: 0x18353b, flatShading: true });
  const rubber = new THREE.MeshLambertMaterial({ color: 0x161d1c, flatShading: true });
  const hub = new THREE.MeshLambertMaterial({ color: 0xafa68b, flatShading: true });
  const solar = new THREE.MeshLambertMaterial({ color: 0x214c57, flatShading: true });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xffefbd });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x8e1a12 });
  const cabMats = [paint, shell, frame, glass, rubber, hub, solar];
  weather(paint, 0.65); weather(shell, 0.3); weather(frame, 0.2);
  const materials = new Set<THREE.Material>([...cabMats, lamp, tailMat]);
  const geometries = new Set<THREE.BufferGeometry>();
  const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.name = `ranger-${name}`;
    geometries.add(geo); root.add(mesh); return mesh;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) =>
    add(name, new THREE.BoxGeometry(w, h, d).translate(x, y, z), mat);
  // A polygon in side elevation extruded across the track. Placement is baked
  // into vertices so the host's paint shader retains car-local coordinates.
  const profile = (name: string, points: number[][], width: number, x: number, mat: THREE.Material) => {
    const shape = new THREE.Shape();
    points.forEach(([z,y],i) => i ? shape.lineTo(z,y) : shape.moveTo(z,y)); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
    g.rotateY(-Math.PI/2); g.translate(x + width/2, 0, 0);
    return add(name,g,mat);
  };
  box('frame',1.25,.18,3.85,0,.12,0,frame);
  box('belly',1.60,.24,2.15,0,.36,.06,frame);
  // Wheels remain exposed beneath the high shoulder, with visible daylight
  // at each arch. The short nose does not inherit the pickup's bonnet.
  profile('cab', [[-2.12,.65],[-2.12,1.05],[-1.68,1.91],[-.36,1.91],[-.24,.65]],1.74,0,paint);
  profile('windscreen', [[-2.126,1.10],[-1.696,1.88],[-1.63,1.88],[-2.06,1.10]],1.57,0,glass);
  // A fine central mullion, broad glass and a cream roof cap establish the face.
  profile('mullion', [[-2.135,1.10],[-1.705,1.88],[-1.66,1.88],[-2.09,1.10]],.055,0,frame);
  box('roof',1.84,.095,1.36,0,1.96,-1.02,shell);
  for(const x of [-.885,.885]) {
    profile('side-glass',[[-1.90,1.14],[-1.59,1.80],[-.47,1.80],[-.40,1.14]],.035,x,glass);
    box('door-cut',.04,.46,.035,x,.87,-.45,frame);
    box('door-handle',.07,.055,.23,x,1.04,-.58,hub);
    box('mirror-arm',.20,.045,.045,x*1.08,1.47,-1.68,frame);
    box('mirror',.09,.25,.15,x*1.17,1.47,-1.68,frame);
    box('step',.25,.09,.76,x,.30,-.63,frame);
  }
  profile('short-nose',[[-2.24,.57],[-2.24,.81],[-2.05,1.09],[-1.84,1.09],[-1.84,.57]],1.76,0,paint);
  box('bumper',1.95,.17,.20,0,.43,-2.23,frame);
  box('grille',.80,.18,.035,0,.76,-2.247,rubber);
  // The rear's chamfered shoulder and unbroken pale flank read as one useful
  // enclosure, contrasting with Classic's open bed and raised roof rack.
  profile('utility-body',[[-.20,.64],[-.20,1.66],[1.77,1.66],[2.12,1.37],[2.12,.64]],1.72,0,shell);
  box('rear-spine',1.10,.12,2.12,0,.49,1.01,frame);
  for(const x of [-.875,.875]) {
    box('locker',.04,.46,1.33,x,1.02,.76,paint);
    for(const z of [.15,1.36]) box('latch',.055,.12,.08,x*1.025,1.06,z,frame);
    box('clerestory',.035,.17,.77,x,1.46,.40,glass);
    box('rear-grip',.04,.045,.35,x,1.44,1.40,frame);
  }
  box('rear-door',1.19,.72,.035,0,1.04,2.14,paint);
  box('rear-bumper',1.94,.16,.18,0,.44,2.22,frame);
  for(const x of [-.66,.66]) {
    box('headlamp',.27,.105,.04,x,.73,-2.255,lamp);
    box('tail-lamp',.12,.27,.04,x,.86,2.175,tailMat);
    box('tow-eye',.10,.12,.10,x,.36,-2.25,hub);
  }
  if(loadout !== 'light') {
    // Flush panels on the rear shoulder; no light bar or rack above the cab.
    for(const z of [.14,.81,1.48]) box('solar',1.48,.055,.57,0,1.72,z,solar);
    box('equipment-tray',1.10,.12,.56,0,.69,1.73,frame);
  }
  if(loadout === 'service') {
    box('survey-case',.47,.29,.68,-.49,1.87,.44,frame);
    box('mast',.035,.63,.035,.72,1.95,1.57,hub);
    box('sensor',.18,.07,.17,.72,2.24,1.57,solar);
  }
  const wheelPivots: THREE.Group[] = [], wheelMeshes: THREE.Mesh[] = [];
  for(const [x,z] of [[-.826,-1.55],[.826,-1.55],[-.826,1.55],[.826,1.55]]) {
    // Short angular eyebrows instead of the pickup's oversize round flares.
    profile('arch',[ [z-.55,.38],[z-.43,.63],[z+.43,.63],[z+.55,.38],
      [z+.44,.38],[z+.34,.52],[z-.34,.52],[z-.44,.38]],.22,x,frame);
    const pivot = new THREE.Group(); pivot.position.set(x,0,z); pivot.name='ranger-wheel-pivot';
    const tyreG = new THREE.CylinderGeometry(.45,.45,.36,16).rotateZ(Math.PI/2);
    const wheel = new THREE.Mesh(tyreG,rubber); wheel.name='ranger-tyre'; geometries.add(tyreG);
    const hubG = new THREE.CylinderGeometry(.24,.24,.375,8).rotateZ(Math.PI/2); geometries.add(hubG);
    const cap = new THREE.Mesh(hubG,hub); cap.name='ranger-hub'; wheel.add(cap);
    pivot.add(wheel); root.add(pivot); wheelPivots.push(pivot); wheelMeshes.push(wheel);
  }
  return { root,bodyMat:paint,tailMat,wheelPivots,wheelMeshes,cabMats,parts:[...root.children],
    anchors:{lamps:[-.66,.66].map(x=>new THREE.Vector3(x,.73,-2.255)),eye:{x:.42,y:1.75,z:-1.43}},
    dispose(){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());} };
}
