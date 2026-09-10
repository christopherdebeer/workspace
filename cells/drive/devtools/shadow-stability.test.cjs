const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),esbuild=require('esbuild'),THREE=require('three');
const source=fs.readFileSync(process.argv[2]||path.join(__dirname,'../client/main.ts'),'utf8');
const code=['solarAngles','snapShadowCentre'].map(n=>{const i=source.indexOf('function '+n+'(');assert.ok(i>=0);return source.slice(i,source.indexOf('\n}',i)+2)}).join('\n');
function context(map=1024,span=110){
  const c={THREE,Math,SUN_DIR:new THREE.Vector3(),SHADOW_SNAP:true,shadowSpan:span,
    sun:new THREE.DirectionalLight(),shX:new THREE.Vector3(),shY:new THREE.Vector3(),shZ:new THREE.Vector3(),shadowPhase:0,
    shadowAnchor:new THREE.Vector3(),shadowDelta:new THREE.Vector3(),shadowAnchored:false};
  c.sun.shadow.mapSize.set(map,map);
  Object.assign(c.sun.shadow.camera,{left:-span,right:span,top:span,bottom:-span,near:1,far:1400});
  c.sun.shadow.camera.updateProjectionMatrix();
  vm.createContext(c);vm.runInContext(esbuild.transformSync(code,{loader:'ts'}).code,c);return c;
}
function matrix(c,want){
  const target=want.clone();c.snapShadowCentre(target);
  assert.ok(target.distanceTo(want)<=Math.SQRT2*c.shadowSpan/c.sun.shadow.mapSize.x+1e-6);
  c.sun.target.position.copy(target);c.sun.target.updateMatrixWorld(true);
  c.sun.position.copy(target).addScaledVector(c.SUN_DIR,700);c.sun.updateMatrixWorld(true);
  c.sun.shadow.updateMatrices(c.sun);
  return c.sun.shadow.matrix.clone();
}
function phase(a,b){const dx=a.x-b.x,dy=a.y-b.y;return Math.hypot(dx-Math.round(dx),dy-Math.round(dy));}
function parked(offset,rate,transition=false){
  const c=context(),centre=new THREE.Vector3(offset,100,offset),p=centre.clone().add(new THREE.Vector3(2,3,1));
  let prev=null,max=0;
  for(let i=0;i<=3600;i++){
    const f=Math.min(1,i/240),seconds=transition ? 4*3600*f*f*(3-2*f) : i/60*rate;
    const {alt,az}=c.solarAngles(37.73627,-119.63691,new Date(Date.UTC(2026,8,9,15)+seconds*1000));
    c.SUN_DIR.set(Math.cos(alt)*Math.sin(az),Math.sin(alt),-Math.cos(alt)*Math.cos(az));
    const before=c.SUN_DIR.clone();const uv=p.clone().applyMatrix4(matrix(c,centre)).multiplyScalar(1024);
    assert.ok(c.SUN_DIR.equals(before),'sun must not be changed by stabilisation');
    if(prev)max=Math.max(max,phase(uv,prev));prev=uv;
  }return max;
}
const near=parked(0,24),far=parked(10000,24),veryFar=parked(1000000,24);
assert.ok(near<0.001 && far<0.001 && veryFar<0.001);
assert.ok(Math.abs(near-far)<1e-8 && Math.abs(far-veryFar)<1e-7,'rotation must not be amplified by distance from origin');
assert.equal(parked(10000,0),0);
// A rapid preset transition is allowed to move the real shadow, but may not
// amplify grid movement just because the same rig is far from the spawn.
const transitionNear=parked(0,0,true),transitionFar=parked(10000,0,true);
assert.ok(Math.abs(transitionNear-transitionFar)<1e-8);
// At fixed sun, lateral movement stays on one texel lattice, even while the
// requested ground height changes. Check the ACTUAL three shadow matrix.
for(const [map,span] of [[512,80],[1024,110],[2048,150]]){
  const c=context(map,span);c.SUN_DIR.set(.4,.6,.7).normalize();
  const p=new THREE.Vector3(10002,103,10001);let prev=null;
  for(let i=0;i<1800;i++){
    const want=new THREE.Vector3(10000+i*.5,100+Math.sin(i*.01)*4,10000+i*.3);
    const uv=p.clone().applyMatrix4(matrix(c,want)).multiplyScalar(map);
    if(prev)assert.ok(phase(uv,prev)<1e-7,'fixed-sun driving must not swim');prev=uv;
  }
  // Teleport/rebase, quality changes and bypass stay bounded and finite.
  matrix(c,new THREE.Vector3(-1e7,4000,1e7));
  c.sun.shadow.mapSize.set(512,512);matrix(c,new THREE.Vector3(-1e7+1,4000,1e7));
  c.SHADOW_SNAP=false;const want=new THREE.Vector3(7.123,8.456,9.789),out=want.clone();
  c.snapShadowCentre(out);assert.ok(out.equals(want));
  c.SHADOW_SNAP=true;c.SUN_DIR.set(0,1,0);c.snapShadowCentre(out);assert.ok(out.toArray().every(Number.isFinite));
}
console.log('PASS: actual shadow matrices; parked CYCLE near/far/1000km; fixed sun; driving at all qualities; height changes; teleport; toggle; zenith; sun unchanged');
console.log(JSON.stringify({maxPhaseTexelsPerFrame:{near,far,veryFar},presetTransition:{near:transitionNear,far:transitionFar}}));
