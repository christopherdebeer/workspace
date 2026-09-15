import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const THREE = require('three');
const main = fs.readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const helperCode = esbuild.transformSync(fs.readFileSync(new URL('./render-work.ts', import.meta.url), 'utf8'), {loader:'ts',format:'cjs'}).code;
const helperContext = {module:{exports:{}},exports:{}};
vm.runInNewContext(helperCode,helperContext);
const {squareRings,nearestStable,uploadPrefix} = helperContext.module.exports;
let seed = 45;
const random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
function oldRing(cx,cz,reach) {
  const out=[];
  for(let d=0;d<=reach;d++) for(let x=cx-d;x<=cx+d;x++) for(let z=cz-d;z<=cz+d;z++)
    if(Math.max(Math.abs(x-cx),Math.abs(z-cz))===d)out.push([x,z]);
  return out;
}
for(const reach of [0,1,2,4,13,28])for(const [x,z] of [[0,0],[-14,9],[200,-300]])
  assert.equal(JSON.stringify(squareRings(x,z,reach)),JSON.stringify(oldRing(x,z,reach)));
for(const n of [0,1,5,90,1000,40000]) {
  const list=Array.from({length:n},(_,i)=>({d:Math.floor(random()*100),id:i}));
  for(const k of [0,1,3,8,100,n,n+1]) {
    const expected=list.slice().sort((a,b)=>a.d-b.d).slice(0,k).map(v=>v.id);
    assert.equal(JSON.stringify(nearestStable(list.slice(),k,v=>v.d).map(v=>v.id)),JSON.stringify(expected));
  }
}
// Real pinned three r160 attributes: multiple refills before rendering, then
// empty, then a newly occupied prefix. Empty ranges must never mean a full upload.
const attr=new THREE.InstancedBufferAttribute(new Float32Array(16000),16);
assert.equal(uploadPrefix(attr,10),640);
assert.deepEqual(attr.updateRanges,[{start:0,count:160}]);
uploadPrefix(attr,20);
assert.deepEqual(attr.updateRanges,[{start:0,count:320}]);
const version=attr.version;
assert.equal(uploadPrefix(attr,0),0);
assert.equal(attr.version,version);
uploadPrefix(attr,3);
assert.deepEqual(attr.updateRanges,[{start:0,count:48}]);

const families=['broadleaf','conifer','acacia','palm','snag'];
const kinds=[...families,'bush','rock','grass','cactus','fern','log','spire'];
const record=fn=>Object.fromEntries(families.map(f=>[f,fn(f)]));
const cap=Object.fromEntries(kinds.map(k=>[k, families.includes(k)?400:80]));
const geo=new THREE.BoxGeometry();
const material=new THREE.MeshBasicMaterial();
function mesh(n=64) {
  const m=new THREE.InstancedMesh(geo,material,n);m.count=0;
  m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(n*3),3);
  return m;
}
function impostorMesh(n) {
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(24),3));
  for(const k of ['aForm','aYaw'])
    g.setAttribute(k,new THREE.InstancedBufferAttribute(new Float32Array(n),1));
  const m=new THREE.InstancedMesh(g,material,n);m.count=0;
  m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(n*3),3);
  return m;
}
function functionSource(name) {
  const ts=require('typescript');
  const ast=ts.createSourceFile('main.ts',main,ts.ScriptTarget.Latest,true);
  let found;
  const walk=s=>{if(ts.isFunctionDeclaration(s)&&s.name?.text===name)found=s;else ts.forEachChild(s,walk);};
  walk(ast);
  assert.ok(found,name);
  return found.getText(ast);
}
// The refresh is a generator plus the whole-call wrapper now; both halves are the function under test.
const newRefresh=functionSource('vegRefreshSteps')+'\n'+functionSource('refreshVeg');
const oldRefresh=fs.readFileSync(new URL('./baseline-refresh.txt',import.meta.url),'utf8');
const capacity=functionSource('ensureVegCapacity');
function context(code,range,ez,triCap) {
  const c={THREE,performance,console,Math,Map,Set,WeakMap,Float32Array,
    nearestStable,squareRings,uploadPrefix,renderer:{},
    vegPhase:{},vegPhaseAt:0,vegSeedNow:0,vegSeedMsNow:0,vegSeedDeferred:0,
    vegSeedLeft:0,VEG_SEED_BUDGET:true,VEG_SEED_MS:8,frameHeavyMs:()=>0,
    state:{x:15,z:-31},VEG_CELL:220,VEG_RANGE:700,treeRange:range,
    ezRecord:record,EZ_FAMILIES:families,EZ_ON:ez,VEG_CAP:cap,vegScale:1,
    TREE_KINDS:families,treePopulationScale:1,treeFormScale:1,treeSizeScale:1,
    ezTiers:record(()=>Array.from({length:3},()=>({near:mesh(),far:mesh(),tris:500,n:0,nNear:0,nFar:0}))),
    vegMeshes:Object.fromEntries(kinds.map(k=>[k,mesh(cap[k])])),trunks:mesh(3600),
    vegDummy:new THREE.Object3D(),swardCol:new THREE.Color(),baseElev:90,shadowSpan:120,
    emptyVegRoles:()=>({interior:0,fringe:0}),vegActiveRoles:{},vegActiveAnchors:0,vegRoleDebug:false,
    isEzKind:k=>families.includes(k),isTreeKind:k=>families.includes(k),
    ezCapFor:()=>triCap,ezVariantAt:(f,x,z)=>Math.abs((Math.floor(x/32)^Math.floor(z/32)))%3,
    // THE CAP RULE IS STUBBED ON BOTH SIDES AND MUST STAY THAT WAY. The claim
    // here is that the refill is byte-identical GIVEN THE SAME CAPS; the rule
    // that sets the caps has its own A/Bs (tree-edge, tree-spend) and changed
    // three times in one day. Wiring ezCapFor to read the allocator's own
    // ezCapNow would make the baseline — which predates the allocator — differ
    // for a reason that is not a regression, and the check would then be
    // "loosened" until it meant nothing. The allocator still RUNS below, so an
    // exception in it fails here, which is what caught this file being red.
    // THE IMPOSTOR TIER RUNS HERE TOO, against a real InstancedMesh with real
    // instanced attributes, so the claim under test is that a tier drawing the
    // candidates admission turned down does not disturb what admission KEPT.
    // A stub of `impostors: null` would skip the pass and witness nothing.
    IMPOSTOR_CAP:512,IMPOSTOR_FULL_M:260,IMPOSTOR_FORM_BUDGET:400,
    IMPOSTOR_FORMS:['round','conic','columnar','umbrella','palm','bare'],
    IMPOSTOR_WIDTH:{round:0.9,conic:0.5,columnar:0.4,umbrella:1.2,palm:0.5,bare:0.35},
    impostorFormIndex:()=>0,impFormOf:new WeakMap(),
    impProf:{drawn:0,offered:0,capped:0,formed:0,far:0,ms:0},
    // HALF AGAIN THE DRAW RANGE, for the manifest's own reason one line down:
    // the REACH dial's far gather has to RUN here, or the claim that a tier
    // reaching past the draw ring disturbs nothing inside it is untested.
    impostorReach:()=>range*1.5,impostorReachAsked:()=>range*1.5,impDensityMul:1,
    impFadeU:{value:{set:()=>{}}},impGroundU:{value:{setRGB:()=>{}}},baseElev:0,
    impStage:{m:new Float32Array(512*16),c:new Float32Array(512*3),
      f:new Float32Array(512),y:new Float32Array(512)},
    impostors:impostorMesh(512),
    impostorDraw:true,
    ezVariants:()=>[{form:'round'},{form:'conic'},{form:'columnar'}],
    sampleHeight:(x,z)=>Math.sin(x/30)+Math.cos(z/30),
    hash2:(a,b)=>((Math.imul(a,73856093)^Math.imul(b,19349663))>>>0)/4294967296,
    EZ_DEMAND:true,ezCapNominal:()=>triCap,ezMeanTris:()=>500,ezTriPrice:()=>500,
    ezPriceNow:record(()=>0),EZ_PRICE_MIN:8,treeTriBudget:2.4e6,
    ezCrownReach:()=>0.1,EZ_M_PER_SCALE:record(()=>5.7),
    vegGrid:new Map(),vegSeeded:new Set(),vegSeedStats:new Map(),
    // TWICE THE DRAW RANGE, so the manifest pass actually RUNS here rather than
    // being skipped as a no-op: the claim under test is that seeding further
    // out changes no mesh, and a pass that never executes cannot witness it.
    manifestRange:()=>range*2,vegManifestDeferred:0,
    seedCell:()=>{},vegMark:()=>{},refreshShrubs:()=>{},
    groundAt:(x,z)=>Math.sin(x/30)+Math.cos(z/30),sampleCover:()=>10,
    terrainPalette:()=>[0.2,0.3,0.1],trunkReach:(k,h,s)=>h+s*0.38,
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    ezPlaced:[],ezEdgeLast:{},vegMs:0,roadCalls:0,roads:false,vegStaging:new WeakMap(),vegJob:null,
  };
  c.onCarriageway=(x,z)=>{c.roadCalls++;return {road:c.roads&&Math.abs(x%100)<18,track:false};};
  // Deterministic dense fixture. Include multiple roles, styles, equal distances
  // and roadside sites. The full production refill runs; world samplers are pure.
  seed=185;
  for(const [gx,gz] of squareRings(0,0,Math.ceil(range/220)+2)) {
    const cell=[];
    for(let i=0;i<80;i++) {
      const k=kinds[Math.floor(random()*kinds.length)];
      cell.push({k,x:gx*220+random()*220,z:gz*220+random()*220,
        s:1+random()*2,h:families.includes(k)?2:0,rot:random()*6,
        sy:0.7+random()*0.6,sw:0.8+random()*0.4,tl:random()*0.1,
        c:new THREE.Color(0.2+random()*0.2,0.4,0.1),role:i%2?'interior':'fringe',anchor:i%13===0});
    }
    c.vegGrid.set(`${gx},${gz}`,cell);
  }
  vm.createContext(c);
  vm.runInContext(esbuild.transformSync(capacity+'\n'+code,{loader:'ts'}).code,c);
  return c;
}
function snapshot(c) {
  const snap=m=>({n:m.count,m:Array.from(m.instanceMatrix.array.subarray(0,m.count*16)),c:m.instanceColor?Array.from(m.instanceColor.array.subarray(0,m.count*3)):[]});
  return JSON.stringify({meshes:Object.fromEntries(kinds.filter(k=>k!=='grass').map(k=>[k,snap(c.vegMeshes[k])])),
    trunks:snap(c.trunks),ez:record(f=>c.ezTiers[f].map(t=>[snap(t.near),snap(t.far),t.n])),
    placed:c.ezPlaced,edges:c.ezEdgeLast,roles:c.vegActiveRoles,anchors:c.vegActiveAnchors});
}
function uploads(c) {
  const meshes=[...Object.entries(c.vegMeshes).filter(([k])=>k!=='grass').map(([,m])=>m),c.trunks,
    ...families.flatMap(f=>c.ezTiers[f].flatMap(t=>[t.near,t.far]))];
  return meshes.reduce((s,m)=>{ for(const a of [m.instanceMatrix,m.instanceColor])if(a){s.allocated+=a.array.byteLength;if(m.count)s.active+=m.count*a.itemSize*4;}return s;},{allocated:0,active:0});
}
const reports=[];
for(const [range,ez,k] of [[700,true,120],[2800,true,120],[2800,true,1200],[700,false,120],[700,true,0]]) {
  const a=context(oldRefresh,range,ez,k),b=context(newRefresh,range,ez,k);
  for(const [x,z,roads,scale] of [[15,-31,false,1],[19,-31,true,1],[250,30,true,2],[250,30,false,0.5]]) {
    for(const c of [a,b]){c.state={x,z};c.roads=roads;c.treeSizeScale=scale;c.roadCalls=0;c.refreshVeg();}
    assert.equal(snapshot(b),snapshot(a),`refill changed at ${range}/${ez}/${k}/${x}/${roads}`);
  }
  reports.push({range,ez,cap:k,roadChecksBefore:a.roadCalls,roadChecksAfter:b.roadCalls,before:uploads(a),after:uploads(b)});
}
const data=Array.from({length:100000},(_,i)=>({d:random()*1e6,id:i}));
function time(fn,n=15){const a=[];for(let i=0;i<n+5;i++){const t=performance.now();fn();if(i>=5)a.push(performance.now()-t);}return a.sort((a,b)=>a-b)[Math.floor(n/2)];}
const bench={n:data.length,k:8,oldMs:time(()=>data.slice().sort((a,b)=>a.d-b.d).slice(0,8)),newMs:time(()=>nearestStable(data.slice(),8,v=>v.d))};
console.log(JSON.stringify({checks:'PASS: ring order, stable selection incl ties, three r160 ranges, 20 production refill comparisons',reports,selectionBenchmark:bench},null,2));
