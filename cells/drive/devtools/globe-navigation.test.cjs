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
  'globeSpinLatRange', 'chartPlaneAt', 'sphereRTC', 'sphereLatLon'];
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
  GLOBE_SINK:800,GLOBE_PIN_PX:4.5,GLOBE_PIN_LIFT:1.001,GLOBE_SPIN_LAT_MAX:85,
  FAR_RING_MAX:2,SIGHT_MAX:1500000,EARTH_R:6371000,farZ:5,FIXTURE:false,
  innerWidth:390,innerHeight:844,pixSize:{x:148,y:320},
  globeGroup:new THREE.Group(),globePin:new THREE.Mesh(),
  planetGroup:new THREE.Group(),globeMesh:new THREE.Mesh(),hideSet:new Set(),
  farGroup:new THREE.Group(),ovGroup:new THREE.Group(),farAxis:new THREE.Vector3(),
  // uBase is gone with the bake — the surface is a graticule now — and uNight
  // is read by the shell's copy of the same day/night term.
  globeU:{uSun:{value:new THREE.Vector3()},uNight:{value:0.14}},
  planetSunU:{uPlanetC:{value:new THREE.Vector3()},uPlanetSun:{value:new THREE.Vector3()},
    uPlanetNight:{value:0.14},uPlanetMix:{value:0}},
  envU:{uMpp:{value:0}},
  // The fling, the retired-ring culls and the near-cap test are all reached by
  // stepGlobe; a vm context throws ReferenceError on any global it lacks, so
  // an unstubbed one reads as a broken change rather than a thin stub.
  globeFlingLat:0,globeFlingLon:0,globeFlingAt:0,
  GLOBE_FLING_TAU:0.45,GLOBE_FLING_STOP:0.05,
  farRetired:[],ovRetired:[],cullRetiredFar:()=>{},cullRetiredOv:()=>{},
  capEyeUpdate:()=>{},onNearCap:()=>true,performance,
  globeVelLat:0,globeVelLon:0,globeVelAt:0,flingOn:true,GLOBE_FLING_HOLD_MS:90,GLOBE_FLING_MAX:180,
  clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),viewX:()=>0,viewZ:()=>0,mapRot:()=>0,
  toLocal:(lat,lon)=>[(lon-origin.lon)*origin.mLon,(origin.lat-lat)*111320],
  tileMetres:()=>1084000,farLevelFor:()=>5,clockHour:()=>12,
  camera:new THREE.PerspectiveCamera(55,390/844,1,1e9),
};
// main.ts adds both to the planet at construction; the stub has to as well or
// the parentage assertion is testing the stub and not the world.
ctx.planetGroup.add(ctx.farGroup); ctx.planetGroup.add(ctx.ovGroup);
ctx.planetGroup.add(ctx.globeMesh); ctx.planetGroup.add(ctx.globePin);
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
// THE PARABOLOID IS GONE, SO THE TANGENCY ASSERTION IS TOO. `chartShellMatrix`
// sheared a d*d/2R surface under the browsed focus and both far groups were held onto
// it by a matrix each; the sphere pass retired the function and there is no second
// surface left to keep tangent. What a far vertex is built from now is `sphereRTC` —
// the planet-frame point at R + height over the datum, expressed RELATIVE TO ITS OWN
// TILE'S CENTRE so that nothing at a planet's magnitude ever meets a Float32 — and the
// contract that replaced tangency is that the round trip is exact: the lat/lon the
// builder put a vertex at is the lat/lon a probe reading that vertex back asks the
// flat world about (__ovfloat, the peak march and the shell audit all do exactly
// that). Checked from the equator to past the mercator cut, where only the globe draws.
for(const [cLat,cLon] of [[0,0],[-30,25],[47,8],[84,-170]]){
  const centre=globe.latLonToUnit(cLat,cLon,new THREE.Vector3()).multiplyScalar(globe.GLOBE_R);
  for(const [dLat,dLon,y] of [[0,0,0],[0.004,0.004,123],[-1.2,2.5,-450],[4.5,-9,2300]]){
    const lat=cLat+dLat,lon=cLon+dLon;
    const v=ctx.sphereRTC(lat,lon,y,centre,new THREE.Vector3());
    // A tile's own vertices stay small, which is the whole reason for the subtraction.
    assert.ok(v.length()<2e6,`RTC vertex ${v.length()}m from its tile centre`);
    const [bLat,bLon,bY]=ctx.sphereLatLon(v.clone().add(centre));
    close(bLat,lat,1e-6);close(bLon,lon,1e-6);close(bY,y,1e-4);
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
// THE SHELL AND THE ROADS SHARE A FRAME BY PARENTAGE NOW, not by two matrices
// being kept equal. `alignFarShell` computed a paraboloid shear and wrote it
// onto farGroup and ovGroup, and these two assertions were what held the pair
// together; the sphere pass retired the function and made both groups children
// of `planetGroup`, so the guarantee is structural and there is nothing left
// to keep in step. Asserting the replacement instead: after a frame the planet
// stands exactly one radius under the chart's focus, which is what puts a far
// vertex built at R + elev where the fine world would draw the same ground.
frame();
close(ctx.planetGroup.position.x, ctx.panX, 1e-6);
close(ctx.planetGroup.position.z, ctx.panZ, 1e-6);
close(ctx.planetGroup.position.y, -ctx.EARTH_R, 1e-6);
assert.equal(ctx.farGroup.parent, ctx.planetGroup);
assert.equal(ctx.ovGroup.parent, ctx.planetGroup);
// Equal elapsed time gives equal zoom at 30/60/120 fps and both extremes.
for(const [from,to] of [[1,110000],[110000,1],[8,16]]){
  const values=[30,60,120].map(fps=>{let z=from;for(let i=0;i<fps;i++)z=nav.smoothChartZoom(z,to,1/fps);return z;});
  close(values[0],values[1],1e-6);close(values[1],values[2],1e-6);
  for(const z of values)assert.ok(z>=Math.min(from,to)&&z<=Math.max(from,to));
}
assert.ok(source.includes("camMode === 'cab' || camMode === 'top'"));
// The zoom is advanced BEFORE the planet and the shell decide who owns the frame,
// or the two disagree by a frame at the hand-over. Asserted on the source — and
// BOTH needles must be found, because an indexOf that stops matching turns this
// into a true statement about -1 rather than a false one about ordering. That is
// exactly how it went vacuous when the call was wrapped for the profiler, so the
// needle is the profiler's own label, which only the call site carries.
const zoomAt = source.indexOf('zoomCur = panPtrs.size === 2');
const stepAt = source.indexOf("profAdd('stepGlobe'");
assert.ok(zoomAt > 0 && stepAt > 0, `zoom advance ${zoomAt}, stepGlobe call ${stepAt}`);
assert.ok(zoomAt < stepAt);
assert.ok(!source.includes('globeSpinLat *= g'));
console.log('PASS: retained focus, rig unchanged, dateline/poles, globe drag, stable hand-over, sphere round trip, planet parentage, frame-independent zoom');
