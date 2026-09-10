import * as THREE from 'three';
import type { RigModel, RigModelId, RigLoadoutId } from './rig-model';

export const RIG_EQUIPMENT = [
  ['rack','Roof rack'], ['solar','Solar array'], ['tent','Roof tent'],
  ['awning','Side awning'], ['crates','Cargo cases'], ['cans','Fuel & water cans'],
  ['spare','Spare wheel'], ['ladder','Rear ladder'], ['snorkel','Snorkel'],
  ['winch','Winch & bull bar'], ['boards','Recovery boards'],
  ['mast','Survey mast'], ['lights','Auxiliary lights'],
] as const;
export type RigEquipmentId = typeof RIG_EQUIPMENT[number][0];
export function equipmentFor(loadout: RigLoadoutId): RigEquipmentId[] {
  return loadout === 'light' ? [] : loadout === 'service'
    ? ['rack','solar','crates','cans','spare','ladder','snorkel','winch','boards','mast','lights']
    : ['rack','solar','cans','spare','ladder','snorkel','winch','boards','lights'];
}
export function cleanEquipment(value: unknown): RigEquipmentId[] {
  return RIG_EQUIPMENT.filter(([id]) => Array.isArray(value) && value.includes(id)).map(([id])=>id);
}

// Compact 5x7 plate lettering: geometry remains sharp through the game's
// pixel pipeline and needs neither a canvas nor an asynchronously loaded font.
const glyphs: Record<string,string> = {
 A:'01110/10001/10001/11111/10001/10001/10001', B:'11110/10001/10001/11110/10001/10001/11110',
 C:'01111/10000/10000/10000/10000/10000/01111', D:'11110/10001/10001/10001/10001/10001/11110',
 E:'11111/10000/10000/11110/10000/10000/11111', F:'11111/10000/10000/11110/10000/10000/10000',
 G:'01111/10000/10000/10111/10001/10001/01111', H:'10001/10001/10001/11111/10001/10001/10001',
 I:'11111/00100/00100/00100/00100/00100/11111', J:'00111/00010/00010/00010/10010/10010/01100',
 K:'10001/10010/10100/11000/10100/10010/10001', L:'10000/10000/10000/10000/10000/10000/11111',
 M:'10001/11011/10101/10101/10001/10001/10001', N:'10001/11001/10101/10011/10001/10001/10001',
 O:'01110/10001/10001/10001/10001/10001/01110', P:'11110/10001/10001/11110/10000/10000/10000',
 Q:'01110/10001/10001/10001/10101/10010/01101', R:'11110/10001/10001/11110/10100/10010/10001',
 S:'01111/10000/10000/01110/00001/00001/11110', T:'11111/00100/00100/00100/00100/00100/00100',
 U:'10001/10001/10001/10001/10001/10001/01110', V:'10001/10001/10001/10001/10001/01010/00100',
 W:'10001/10001/10001/10101/10101/10101/01010', X:'10001/10001/01010/00100/01010/10001/10001',
 Y:'10001/10001/01010/00100/00100/00100/00100', Z:'11111/00001/00010/00100/01000/10000/11111',
 '0':'01110/10001/10011/10101/11001/10001/01110','1':'00100/01100/00100/00100/00100/00100/01110',
 '2':'01110/10001/00001/00010/00100/01000/11111','3':'11110/00001/00001/01110/00001/00001/11110',
 '4':'00010/00110/01010/10010/11111/00010/00010','5':'11111/10000/10000/11110/00001/00001/11110',
 '6':'01110/10000/10000/11110/10001/10001/01110','7':'11111/00001/00010/00100/01000/01000/01000',
 '8':'01110/10001/10001/01110/10001/10001/01110','9':'01110/10001/10001/01111/00001/00001/01110',
 '-':'00000/00000/00000/11111/00000/00000/00000',' ':'00000/00000/00000/00000/00000/00000/00000',
};
export const registrationText = (user?: string | null): string =>
  (typeof user === 'string' ? user.replace(/^@/, '').toUpperCase().replace(/[^A-Z0-9 -]/g,'').trim().slice(0,12) : '') || 'DRIVE-01';

/** All optional fittings are built in one place for both vehicles. They are
 * merged by material: selecting ALL adds substantial geometry without one
 * draw call per rung, solar cell or box. Nothing changes driving statistics. */
export function equipRig(rig: RigModel, model: RigModelId, selected: readonly RigEquipmentId[]): RigModel {
  const ids = cleanEquipment(selected); const on = (id: RigEquipmentId) => ids.includes(id);
  const steel = new THREE.MeshLambertMaterial({color:0x39463e,flatShading:true});
  const cloth = new THREE.MeshLambertMaterial({color:0x8d8263,flatShading:true});
  const solar = new THREE.MeshLambertMaterial({color:0x173e53,flatShading:true});
  const rubber = new THREE.MeshLambertMaterial({color:0x19201d,flatShading:true});
  const amber = new THREE.MeshLambertMaterial({color:0xc9a153,flatShading:true});
  const light = new THREE.MeshBasicMaterial({color:0xffefc2});
  const white = new THREE.MeshLambertMaterial({color:0xe5d7a4,flatShading:true});
  const ink = new THREE.MeshBasicMaterial({color:0x151e1b,side:THREE.DoubleSide});
  const mats = [steel,cloth,solar,rubber,amber,light,white,ink];
  rig.cabMats.push(steel,cloth,solar,rubber,amber,white);
  const buckets = new Map<THREE.Material,number[]>();
  const geometry = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const flat = g.index ? g.toNonIndexed() : g;
    const a = buckets.get(m) || []; buckets.set(m,a);
    for(const v of flat.attributes.position.array) a.push(v);
    if(flat !== g) flat.dispose(); g.dispose();
  };
  const box = (w:number,h:number,d:number,x:number,y:number,z:number,m:THREE.Material=steel) =>
    geometry(new THREE.BoxGeometry(w,h,d).translate(x,y,z),m);
  const top = model === 'ranger' ? 2.03 : 1.53;
  // Each fitting includes its own minimal mounting hardware. Checking a solar
  // panel does not silently tick a rack checkbox or leave it floating in air.
  if(on('rack')) {
    for(const x of [-.71,.71]) {box(.065,.09,3.25,x,top+.10,0);box(.055,.19,3.25,x,top+.24,0);}
    for(const z of [-1.50,-.65,.25,1.50]) box(1.48,.06,.065,0,top+.10,z);
  }
  if(on('solar')) {
    for(const x of [-.69,.69]) box(.05,.13,1.35,x,top+.10,-.73);
    for(const z of [-1.19,-.59]) {box(1.40,.065,.54,0,top+.20,z,solar);box(1.46,.025,.56,0,top+.16,z);}
  }
  if(on('tent')) {
    box(1.47,.13,1.42,0,top+.10,.73);
    box(1.39,.45,1.35,0,top+.39,.73,cloth);
    for(const z of [.25,1.18]) box(1.43,.055,.06,0,top+.51,z);
  }
  if(on('awning')) { box(.23,.25,2.55,-.96,top+.16,.05,cloth); for(const z of [-.9,.9]) box(.21,.05,.07,-.82,top+.08,z); }
  if(on('crates')) {box(.30,.55,.77,1.02,1.05,1.05,cloth);for(const z of [.8,1.3])box(.32,.045,.045,1.02,1.05,z);}
  if(on('cans')) for(const x of [-.70,-.38]) {box(.25,.43,.20,x,.98,2.28,amber);box(.15,.055,.09,x,1.22,2.28);}
  if(on('spare')) {
    box(.12,.70,.14,.49,.94,2.25);
    geometry(new THREE.CylinderGeometry(.45,.45,.26,12).rotateX(Math.PI/2).translate(.49,1.22,2.37),rubber);
    geometry(new THREE.CylinderGeometry(.18,.18,.28,8).rotateX(Math.PI/2).translate(.49,1.22,2.37),amber);
  }
  if(on('ladder')) {for(const x of [-.70,-.30])box(.045,1.32,.08,x,1.45,2.48);for(let y=.89;y<2.12;y+=.24)box(.44,.04,.08,-.50,y,2.48);}
  if(on('snorkel')) {box(.11,1.16,.11,.87,1.40,-1.30);box(.11,.12,.35,.87,2,-1.39);}
  if(on('winch')) {box(.52,.26,.29,0,.68,-2.32);for(const x of [-.76,.76])box(.08,.57,.08,x,.79,-2.34);box(1.65,.075,.08,0,1.09,-2.34);}
  if(on('boards')) for(const y of [.88,1.06]) {box(.075,.13,1.32,-.94,y,.60,amber);for(let z=.02;z<1.25;z+=.2)box(.09,.15,.055,-.94,y,z);}
  if(on('mast')) {box(.07,.23,.13,.66,top+.10,1.42);box(.035,1.15,.035,.66,top+.70,1.42);box(.30,.08,.23,.66,top+1.25,1.42,solar);}
  if(on('lights')) {box(1.36,.07,.12,0,top+.11,-1.53);for(const x of [-.49,-.17,.17,.49])box(.23,.16,.13,x,top+.22,-1.54,light);}
  // Plates remain with the bare vehicle, below rear accessories.
  for(const z of [-2.52,2.53])box(.88,.19,.025,0,.49,z,white);
  const owned: THREE.BufferGeometry[] = [];
  for(const [mat,positions] of buckets) {
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();owned.push(g);
    const mesh=new THREE.Mesh(g,mat);mesh.name='rig-equipment';rig.root.add(mesh);
  }
  const letters=new THREE.Mesh(new THREE.BufferGeometry(),ink);letters.name='rig-registration';rig.root.add(letters);
  let plate='';
  rig.setRegistration = (user) => {
    const text=registrationText(user);if(plate===text)return false;plate=text;
    const positions:number[]=[];const unit=Math.min(.019,.78/(text.length*6));
    for(const sign of [-1,1]) for(let i=0;i<text.length;i++) {
      const rows=(glyphs[text[i]]||glyphs['-']).split('/');
      rows.forEach((row,y)=>[...row].forEach((bit,x)=>{if(bit!=='1')return;
        const left=sign*((i*6+x-text.length*3)*unit),right=left+sign*unit*.86;
        const top=.49+(3.5-y)*unit,bottom=top-unit*.86,z=sign*2.546;
        positions.push(left,top,z,right,top,z,right,bottom,z,left,top,z,right,bottom,z,left,bottom,z);
      }));
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();
    letters.geometry.dispose();letters.geometry=g;rig.root.userData.registration=text;return true;
  };
  rig.setRegistration(null);
  rig.root.userData.equipment=ids;
  rig.parts=[...rig.root.children];
  const dispose=rig.dispose;
  rig.dispose=()=>{dispose();owned.forEach(g=>g.dispose());letters.geometry.dispose();mats.forEach(m=>m.dispose());};
  return rig;
}
