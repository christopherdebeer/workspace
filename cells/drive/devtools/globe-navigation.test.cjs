const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const esbuild = require('esbuild');
const path = require('node:path');
const Module = require('node:module');
const THREE = require('three');
const sourcePath = path.resolve(process.argv[2] || path.join(__dirname, '../client/main.ts'));
function loadTS(name) {
  const filename = path.join(path.dirname(sourcePath), name);
  const output = esbuild.buildSync({entryPoints:[filename],bundle:true,platform:'node',format:'cjs',external:['three'],write:false});
  const mod = new Module(filename, module);
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(output.outputFiles[0].text, filename);
  return mod.exports;
}
const nav = loadTS('globe-navigation.ts');
const globe = loadTS('globe.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const names = ['localToLatLon', 'setChartFocus', 'chartRemote', 'chartDist', 'chartMpp',
  'globeOn', 'globeFree', 'globeDegPerPx', 'chartTilt', 'stepGlobe', 'dragGlobe',
  'globeSpinLatRange', 'chartPlaneAt', 'sphereRTC', 'sphereLatLon', 'capEyeUpdate', 'onNearCap'];
const code = names.map(name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const lineEnd = source.indexOf('\n', start);
  const end = source.slice(start, lineEnd).endsWith('}') ? lineEnd : source.indexOf('\n}', start) + 2;
  return source.slice(start, end);
}).join('\n');
const origin = {lat:-30,lon:25,mLon:111320*Math.cos(-30*Math.PI/180)};
const ctx = {THREE, ...nav, ...globe, Math, origin, M_LAT:111320,
  panX:0,panZ:0,globeSpinLat:0,globeSpinLon:0,zoomCur:40000,zoomT:40000,
  panY:0,panPtrs:new Map(),ZOOM_MIN:0.125,ZOOM_MAX:20000000/175,
  camMode:'top',CAM:{base:175,tilt:70},GLOBE_TILT_LO:750000,GLOBE_TILT_HI:2750000,
  GLOBE_PIN_PX:4.5,GLOBE_PIN_LIFT:1.001,GLOBE_SPIN_LAT_MAX:85,
  // the near-cap test's scratch objects and the hide set stepGlobe reads
  capEye:new THREE.Vector3(),capQ:new THREE.Quaternion(),hideSet:new Set(),
  // the fling's state and constants, the retired rings stepGlobe culls, and the clock dragGlobe reads
  globeVelLat:0,globeVelLon:0,globeVelAt:0,globeFlingLat:0,globeFlingLon:0,globeFlingAt:0,
  GLOBE_FLING_TAU:0.45,GLOBE_FLING_MAX:180,GLOBE_FLING_STOP:0.05,GLOBE_FLING_HOLD_MS:90,flingOn:true,
  farRetired:[],ovRetired:[],performance,
  FAR_RING_MAX:2,SIGHT_MAX:1500000,EARTH_R:6371000,farZ:5,FIXTURE:false,
  innerWidth:390,innerHeight:844,pixSize:{x:148,y:320},
  planetGroup:new THREE.Group(),globeMesh:new THREE.Mesh(),globePin:new THREE.Mesh(),
  farGroup:new THREE.Group(),ovGroup:new THREE.Group(),
  globeU:{uBase:{value:{}},uSun:{value:new THREE.Vector3()}},
  clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),viewX:()=>0,viewZ:()=>0,mapRot:()=>0,
  toLocal:(lat,lon)=>[(lon-origin.lon)*origin.mLon,(origin.lat-lat)*111320],
  tileMetres:()=>1084000,farLevelFor:()=>5,globeTexture:()=>{},clockHour:()=>12,
  camera:new THREE.PerspectiveCamera(55,390/844,1,1e9),
};
vm.createContext(ctx);
vm.runInContext(esbuild.transformSync(code,{loader:'ts',target:'es2022'}).code,ctx);
const close=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const pinchStart = source.indexOf('  } else if (panPtrs.size === 2) {') + '  } else if (panPtrs.size === 2) {'.length;
const pinchEnd = source.indexOf('\n  }\n  panPtrs.set(e.pointerId, cur);',pinchStart);
assert.ok(pinchStart>40 && pinchEnd>pinchStart);
vm.runInContext(esbuild.transformSync('function pinch(e,prev,cur){'+source.slice(pinchStart,pinchEnd)+'}',{loader:'ts'}).code,ctx);
function focus(){return ctx.localToLatLon(ctx.panX,ctx.panZ);}
function frame(){
  ctx.stepGlobe();
  const d=ctx.chartDist(),t=ctx.chartTilt()*Math.PI/180,r=ctx.mapRot();
  ctx.camera.position.set(ctx.panX-Math.sin(r)*d*Math.cos(t),d*Math.sin(t),ctx.panZ+Math.cos(r)*d*Math.cos(t));
  ctx.camera.lookAt(ctx.panX,0,ctx.panZ);ctx.camera.updateMatrixWorld(true);
}
// The reported regression: spin, then zoom in through every boundary. Keep
// the place, leave the rig untouched, and centre both backdrops on that place.
frame();ctx.globeSpinLat=70;ctx.globeSpinLon=115;frame();
for(const zoom of [110000,40000,25000,15000,8000,1000,8,1]){
  ctx.zoomCur=zoom;frame();close(focus()[0],40);close(focus()[1],140);
  close(ctx.globeSpinLat,0);close(ctx.globeSpinLon,0);
}
assert.equal(ctx.viewX(),0);assert.equal(ctx.viewZ(),0);
// Date-line wrapping and both polar bounds remain finite.
ctx.setChartFocus(100,541);close(focus()[0],85);close(focus()[1],-179);
ctx.setChartFocus(-100,-541);close(focus()[0],-85);close(focus()[1],179);
// At wide scale a horizontal drag changes longitude, not the camera target's
// height/tilt; a vertical drag follows the thumb northwards, also heading-up.
for(const rotation of [0,Math.PI/2,Math.PI]){
  ctx.mapRot=()=>rotation;ctx.setChartFocus(-30,25);ctx.zoomCur=110000;frame();
  ctx.dragGlobe(195,422,215,422);
  const moved=focus();assert.ok(moved.every(Number.isFinite));
  if(rotation===0){assert.ok(moved[1]<25);close(moved[0],-30,0.2);}
  if(rotation===Math.PI/2)assert.ok(moved[0]>-30);
}
// The hand-over cannot depend on a network-driven farZ change or pixel dial.
ctx.mapRot=()=>0;ctx.setChartFocus(-30,25);ctx.zoomCur=40000;frame();
const free=ctx.globeFree(),tilt=ctx.chartTilt();
for(const z of [13,11,9,7,6,5]){ctx.farZ=z;assert.equal(ctx.globeFree(),free);}
for(const h of [160,320,844]){ctx.pixSize.y=h;close(ctx.chartTilt(),tilt);assert.equal(ctx.globeFree(),free);}
// THE SHELL IS ON THE SPHERE, NOT ON A PARABOLOID. Every far and overview
// vertex is built by sphereRTC relative to its tile's centre point: the sum
// stands at exactly R + height from the planet's centre, and the inverse
// gives the lat/lon and height back. The old shear (chartShellMatrix) and the
// seat's first-order tilt (alignFarShell) are gone with the paraboloid.
{
  const R=globe.GLOBE_R,out=new THREE.Vector3();
  for(const [cLat,cLon] of [[0,0],[47,8],[-30,25],[84,-179],[-60,150]]){
    const centre=globe.latLonToUnit(cLat,cLon).multiplyScalar(R);
    for(const [lat,lon,y] of [[cLat,cLon,0],[cLat+3,cLon-4,1234],[cLat-2.5,cLon+5,-4817],[cLat+0.01,cLon,12]]){
      ctx.sphereRTC(lat,lon,y,centre,out);
      close(out.clone().add(centre).length(),R+y,1e-3);
      const [la,lo,h]=ctx.sphereLatLon(out.clone().add(centre));
      close(la,lat,1e-9);close(((lo-lon+540)%360)-180,0,1e-9);close(h,y,1e-3);
      // Relative to its centre the vertex is the tile's size, not the Earth's.
      assert.ok(out.length()<1.2e6,`rtc magnitude ${out.length()}`);
    }
  }
}
// Repeat two-finger out/in sequences across the hand-over. All intermediate
// states must stay finite and returning fingers must return near the focus.
ctx.zoomCur=ctx.zoomT=16000;ctx.setChartFocus(20,160);frame();
ctx.panPtrs.set(1,{x:95,y:422});ctx.panPtrs.set(2,{x:295,y:422});
for(const separation of [190,180,160,140,120,100,80,60,80,100,120,140,160,180,190,200]){
  for(const [id,x] of [[1,195-separation/2],[2,195+separation/2]]){
    const prev=ctx.panPtrs.get(id),cur={x,y:422};
    ctx.pinch({pointerId:id},prev,cur);ctx.panPtrs.set(id,cur);
    ctx.zoomCur=ctx.zoomT;frame();
    assert.ok([...focus(),ctx.zoomCur,...ctx.camera.position.toArray()].every(Number.isFinite));
  }
}
close(ctx.zoomCur,16000,1e-6);
console.log('Repeated pinch focus error (degrees):',focus()[0]-20,focus()[1]-160);
close(focus()[0],20,0.5);close(focus()[1],160,0.5);
// THE PLANET IS PLACED UNDER THE FOCUS ON THE CHART AND UNDER THE POV FROM
// THE SEAT, in every camera: one radius down, turned so that point is its top.
for(const mode of ['top','chase']){
  ctx.camMode=mode;ctx.setChartFocus(20,160);frame();
  const [fx,fz]=mode==='top'?[ctx.panX,ctx.panZ]:[ctx.viewX(),ctx.viewZ()];
  close(ctx.planetGroup.position.x,fx,1e-6);close(ctx.planetGroup.position.z,fz,1e-6);
  close(ctx.planetGroup.position.y,-globe.GLOBE_R,1e-6);
  const [la,lo]=ctx.localToLatLon(fx,fz);
  const up=globe.latLonToUnit(la,lo).applyQuaternion(ctx.planetGroup.quaternion);
  close(up.x,0,1e-9);close(up.y,1,1e-9);close(up.z,0,1e-9);
}
ctx.camMode='top';
// Equal elapsed time gives equal zoom at 30/60/120 fps and both extremes.
for(const [from,to] of [[1,110000],[110000,1],[8,16]]){
  const values=[30,60,120].map(fps=>{let z=from;for(let i=0;i<fps;i++)z=nav.smoothChartZoom(z,to,1/fps);return z;});
  close(values[0],values[1],1e-6);close(values[1],values[2],1e-6);
  for(const z of values)assert.ok(z>=Math.min(from,to)&&z<=Math.max(from,to));
}
// A 90-DEGREE TILT LOSES THE MAP ROTATION TO FLOATING POINT. The camera's
// sideways stand-off is dist*cos(tilt); at 90 that is 4e-10m against a target
// millions of metres from the origin, so it rounds away below the ULP and
// takes the rotation with it — lookAt then falls into three's own degenerate
// guard, which nudges the look axis by a fixed 0.0001 that knows nothing about
// mapRot. Measured at 90: a heading-up chart asked for 45 degrees drew 27, 135
// drew 153, 225 drew 207, 315 drew 333, exact only on the four axes where one
// component of the offset happens to be a clean zero. chartTilt has to stay
// resolvable at the widest zoom, which is what this sweep holds.
// AND IT HAS TO BE MEASURED AWAY FROM THE ORIGIN, or it proves nothing: the
// offset is lost against the MAGNITUDE of the target, so a chart focused on
// its own origin keeps coordinates small enough that 4e-10 still resolves.
// The first cut of this sweep sat at -30,25 — panX and panZ both zero — and
// passed on the broken value.
// AND IN THE CAMERA MODE THE TILT EXISTS IN. `globeOn` is 0 off the chart, so
// `chartTilt` is a flat 70 there and the offset is kilometres — the first cut
// of this sweep ran after the alignFarShell block above had left camMode on
// 'chase', measured a regime the bug cannot occur in, and duly passed on the
// broken value.
ctx.camMode='top';
ctx.setChartFocus(40,140);ctx.zoomCur=ctx.zoomT=110000;
assert.ok(Math.hypot(ctx.panX,ctx.panZ)>1e6,'the sweep must browse far from the origin');
assert.ok(ctx.chartTilt()>85,`the sweep must run at the wide tilt (got ${ctx.chartTilt()})`);
for(let i=0;i<8;i++){
  const want=i/8*Math.PI*2;ctx.mapRot=()=>want;frame();
  const e=ctx.camera.matrixWorld.elements;
  const up=new THREE.Vector3(e[4],0,e[6]);
  assert.ok(up.lengthSq()>1e-6,`screen-up is degenerate at ${Math.round(want*180/Math.PI)} deg`);
  const drawn=Math.atan2(up.x,-up.z);
  const err=Math.abs(((drawn-want+Math.PI*3)%(Math.PI*2))-Math.PI);
  if(process.env.TILTDBG)console.log('  tilt',ctx.chartTilt(),'pan',ctx.panX,ctx.panZ,'asked',Math.round(want*180/Math.PI),'drew',Math.round(drawn*180/Math.PI),'err',err.toFixed(4));
  assert.ok(err<0.02,`map rotation ${Math.round(want*180/Math.PI)} drew ${Math.round(drawn*180/Math.PI)}`);
}
ctx.mapRot=()=>0;
assert.ok(source.includes("camMode === 'cab' || camMode === 'top'"));
assert.ok(source.indexOf('zoomCur = panPtrs.size === 2') < source.indexOf("stepGlobe(); profAdd('stepGlobe'"));
assert.ok(!source.includes('globeSpinLat *= g'));
console.log('PASS: retained focus, rig unchanged, dateline/poles, globe drag, stable hand-over, shell on the sphere, planet placed in every camera, frame-independent zoom, map rotation survives the tilt');
