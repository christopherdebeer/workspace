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
const {squareRings,nearestStable,nearestPrefix,uploadPrefix} = helperContext.module.exports;
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
// THE HISTOGRAM PREFIX IS EXACT: prefix-then-select must equal select, on
// lists with heavy ties (few distinct distances, so the k-th nearest sits
// inside a tie group that must be kept whole) and on dense ones. The prefix
// must also actually CUT where there is room to — a helper that returns its
// input passes the identity and buys nothing.
for(const n of [0,1,5,90,1000,40000]) for(const ties of [4,100,1e9]) {
  const list=Array.from({length:n},(_,i)=>({d:Math.floor(random()*ties)+(ties>1e6?random():0),id:i}));
  for(const k of [0,1,3,8,100,n>>3,n>>2,n]) {
    const expected=nearestStable(list.slice(),k,v=>v.d).map(v=>v.id);
    const pre=nearestPrefix(list,k,v=>v.d);
    assert.ok(pre.length>=Math.min(k,n),`the prefix holds at least k (n ${n} k ${k} ties ${ties})`);
    assert.equal(JSON.stringify(nearestStable(pre.slice(),k,v=>v.d).map(v=>v.id)),JSON.stringify(expected),`prefix then select equals select (n ${n} k ${k} ties ${ties})`);
    if(n>=1000&&k>0&&k<=(n>>3)&&ties>=100) assert.ok(pre.length<n/2,`the prefix cut the list (n ${n} k ${k}: kept ${pre.length})`);
  }
}
// NEGATIVE CONTROL: the same construction keeping bins STRICTLY nearer than
// the cut bucket — the off-by-one the keep test could have — loses part of
// the tie group at the edge and fails the identity. A check that cannot fail
// on the fault it names is decoration.
{
  const prefixShort=(list,k,distance,bins=512)=>{
    const n=list.length; let lo=Infinity,hi=-Infinity;
    for(const v of list){const d=distance(v); if(d<lo)lo=d; if(d>hi)hi=d;}
    const scale=bins/(hi-lo), counts=new Int32Array(bins);
    for(const v of list){let b=((distance(v)-lo)*scale)|0; if(b>=bins)b=bins-1; counts[b]++;}
    let cut=0; for(let seen=0;cut<bins;cut++){seen+=counts[cut]; if(seen>=k)break;}
    return list.filter(v=>{let b=((distance(v)-lo)*scale)|0; if(b>=bins)b=bins-1; return b<cut;});
  };
  let broke=0;
  for(const n of [1000,40000]) {
    const list=Array.from({length:n},(_,i)=>({d:Math.floor(random()*4),id:i}));
    for(const k of [3,8,100,n>>3]) {
      const expected=JSON.stringify(nearestStable(list.slice(),k,v=>v.d).map(v=>v.id));
      const got=JSON.stringify(nearestStable(prefixShort(list,k,v=>v.d).slice(),k,v=>v.d).map(v=>v.id));
      if(got!==expected)broke++;
    }
  }
  assert.ok(broke>0,'the negative control (a prefix one bucket short) must fail the identity somewhere');
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
// ── THE VETO IS THE PRODUCTION FUNCTION, NOT A STUB OF IT ──
// A stub that always answers `null` would let every card through and this
// file would certify the fault it was written to catch. Extracted like the
// refresh and run over stubbed `onCarriageway`/`hydroWet`, so what is tested
// is the rule and what is faked is only the world it asks about.
const vetoSrc=functionSource('vegSurfaceVeto');
// ── THE RUNG RULE AND THE RUNG PRICE ARE THE PRODUCTION FUNCTIONS TOO ──
// `ezRungOf` decides which mesh an admitted tree stands in from its projected
// height; `ezTierTris` is the bill the allocator reads back. Both are read by
// the refresh as free variables and both are extracted rather than stubbed, so
// the leg below that asserts the rung fires is asserting the shipped rule.
const rungSrc=functionSource('ezRungOf')+'\n'+functionSource('ezTierTris');
// `fullPx` is the pixel line the rung is chosen at. ZERO ON EVERY LEG BUT ONE:
// at zero every tree is on the full rung and the per-mesh byte identity against
// the baseline — which predates the rung — is the original claim, exactly. The
// mid leg sets it to the game's 58 and asserts a different, weaker thing (see
// there). Wiring the game's default in here would make every leg fail for a
// reason that is not a regression.
function context(code,range,ez,triCap,fullPx=0) {
  const c={THREE,performance,console,Math,Map,Set,WeakMap,Float32Array,
    nearestStable,nearestPrefix,squareRings,uploadPrefix,renderer:{},
    EZ_ADMIT_STEP:512,
    vegPhase:{},vegPhaseAt:0,vegSeedNow:0,vegSeedMsNow:0,vegSeedDeferred:0,
    vegSeedLeft:0,VEG_SEED_BUDGET:true,VEG_SEED_MS:8,frameHeavyMs:()=>0,
    state:{x:15,z:-31},VEG_CELL:220,VEG_RANGE:700,treeRange:range,
    // ── THE RENDER FOCUS IS THE RIG HERE, AND THAT IS NOT A SIMPLIFICATION ──
    //
    // `renderFocusXZ` answers the ground the CAMERA is looking at: the chart's
    // panned centre, the drone's own ground focus, and otherwise the rig. This
    // sandbox has no camera, no drone and no pan, so the rig IS the answer —
    // which is also what the baseline function (written before the authority
    // existed) reads inline, so the two stay comparable by construction rather
    // than by a stub that makes them agree.
    renderFocusXZ:()=>[c.state.x,c.state.z],
    // The canopy layer is off in this sandbox (it is `?canopy=1` in the game),
    // so it stands in for no tree and every refill compares as before.
    canopyHides:()=>false, canopyBudgetK:()=>1,
    canopyStat:{hid:0},
    ezRecord:record,EZ_FAMILIES:families,EZ_ON:ez,VEG_CAP:cap,vegScale:1,
    TREE_KINDS:families,treePopulationScale:1,treeFormScale:1,treeSizeScale:1,
    ezTiers:record(()=>Array.from({length:3},()=>({near:mesh(),far:mesh(),tris:500,midNear:mesh(),midFar:mesh(),midTris:100,n:0,nNear:0,nFar:0,nMid:0,nMidNear:0,nMidFar:0}))),
    // The design frame's pixels per metre at one metre (320 rows, a 55° lens),
    // which is what the game's constant is; the sandbox has no camera to read.
    IMP_PERCEPTIBLE_K:320/(2*Math.tan((55*Math.PI)/360)),EZ_FULL_PX:fullPx,
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
    // SIXTY-FOUR, not the game's 4096, because the claim the yield rests on
    // is that staging is separate from the instances and the commit is one
    // slice at the end — so a mid-pass yield may not change a single byte.
    // At the game's step this fixture's candidate lists never reach one, and
    // a yield that never fires cannot witness that.
    IMPOSTOR_STEP:64,
    IMPOSTOR_FORMS:['round','conic','columnar','umbrella','palm','bare'],
    IMPOSTOR_WIDTH:{round:0.9,conic:0.5,columnar:0.4,umbrella:1.2,palm:0.5,bare:0.35},
    impostorFormIndex:()=>0,impFormOf:new WeakMap(),
    // byFam/capFam are the per-family card tally: the impostor pool is water-
    // filled across the families now rather than consumed in declaration order,
    // and the pass writes both at the end of each family. A sandbox missing a
    // record the refresh WRITES throws where one missing a value it reads would
    // merely read undefined — which is the louder failure and the better one.
    // THE CENSUS FIELDS ARE PART OF THE SHAPE, not decoration: the refresh
    // clears and writes them every sweep, so a stub without them throws on
    // the first call and the whole check says nothing. This is the fault the
    // doctrine names — a sandboxed check breaks on a new free variable and
    // only running it can tell you.
    impProf:{drawn:0,offered:0,capped:0,formed:0,far:0,ms:0,byFam:{},capFam:{},
      waiting:0,locked:0,refused:new Map(),bySlot:[],why:{},whyBig:{},sweeps:0,
      horizon:{broadleaf:0,conifer:0,acacia:0,palm:0,snag:0},pxFloor:0,pxMinDrawn:Infinity,pxMaxRefused:0,hold:0,gapM:Infinity,farCull:0,farWalk:0},
    impSlotFull:false,
    // ── AND THE INVARIANT'S OWN TWO ──
    // `impThinnable` decides whether a tree's absence can be carried by a
    // canopy, which only the FAR gather asks; `IMP_PERCEPTIBLE_K` turns a
    // height into art pixels for the census. Both are free variables of the
    // refresh and both broke this check the moment they landed — which is the
    // fault the note above names, met again by the change that wrote it.
    impThinnable:(v)=>!v.anchor&&(v.role==='interior'||v.role==='polygon'),
    IMP_PERCEPTIBLE_K:320/(2*Math.tan((55*Math.PI)/360)),
    // ── AND THE CARD HORIZON'S BINS, which is the same trap for the third
    // time: the cap became a histogram walk and the histogram is module state,
    // so the refresh reads two more free variables than the sweep before it.
    // They are REAL here, not stubs — the selection this check exists to pin
    // down is now partly decided by them.
    // The cap's rationing became ONE histogram in ART PIXELS — no family in it
    // and no metres — so the sandbox's copy changes shape with it. Third time
    // this file has met the trap it documents: the refresh reads free variables
    // and only running the check finds a new one.
    IMP_PX_BINS:1024,IMP_PX_MAX:32,IMP_PX_PER_BIN:1024/32,IMP_HANDOVER_M:200,
    // The gather now applies half of LAST sweep's floor where the site is read,
    // so the threshold is module state that persists between sweeps and the
    // sandbox has to carry it too — the fourth time this file has met the trap
    // it documents. Left at 0 so the first sweep filters nothing, exactly as
    // production's first sweep does.
    impPxFloorLast:0,impTallestM:0,impPoolFullLast:false,VEG_CELL:220,
    impHisto:new Int32Array(1024),
    // HALF AGAIN THE DRAW RANGE, for the manifest's own reason one line down:
    // the REACH dial's far gather has to RUN here, or the claim that a tier
    // reaching past the draw ring disturbs nothing inside it is untested.
    impostorReach:()=>range*1.5,impostorReachAsked:()=>range*1.5,impDensityMul:1,
    impFadeU:{value:{set:()=>{}}},impGroundU:{value:{setRGB:()=>{}}},baseElev:0,
    impStage:{m:new Float32Array(512*16),c:new Float32Array(512*3),
      f:new Float32Array(512),y:new Float32Array(512)},
    impostors:impostorMesh(512),
    // THE ANALYTIC PATH, DELIBERATELY. The atlas needs a GL context and a
    // render target, which this check has neither of and does not want: the
    // claim it holds is that the tier's MEMBERSHIP does not disturb what
    // admission kept, and that claim is about the pass rather than about
    // what the card samples. A stub atlas would exercise a branch whose
    // real behaviour is a photograph nothing here can take.
    impAtlasRT:null,impSlotAt:[],impSlotFor:()=>null,impBakedNow:0,
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
    // ── THE LATTICE IS STUBBED AS THE PLANE THIS SANDBOX ACTUALLY IS ──
    //
    // The shipped `vegCellOf` carries a local point through lat/lon into the
    // absolute vegetation frame, so that the same geography seeds the same
    // trees whatever the session's origin is (see `veg-anchor.test.mjs`, which
    // is where THAT claim is held). There is no origin here and no projection:
    // the mock world is a flat unprojected plane whose grid is keyed on local
    // indices, so the honest stub is the identity on local metres.
    //
    // It matters that this is a STUB AND NOT THE RULE. Handing the sandbox the
    // real transform would make the new refresh look up absolute cell keys in a
    // locally-keyed map, find nothing, place no trees, and compare two empty
    // worlds as equal — a check that passes by drawing nothing is worse than no
    // check. What this file asserts is that the SLICED refresh refills what the
    // pre-slice one did given the same cell walk; the walk's own frame is a
    // different claim with a different test.
    vegAbsOf:(x,z)=>[x,z],
    vegCellOf:(x,z)=>[Math.floor(x/220),Math.floor(z/220)],
    groundAt:(x,z)=>Math.sin(x/30)+Math.cos(z/30),sampleCover:()=>10,
    terrainPalette:()=>[0.2,0.3,0.1],trunkReach:(k,h,s)=>h+s*0.38,
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    ezPlaced:[],ezEdgeLast:{},vegMs:0,roadCalls:0,roads:false,vegStaging:new WeakMap(),vegJob:null,
  };
  c.onCarriageway=(x,z)=>{c.roadCalls++;return {road:c.roads&&Math.abs(x%100)<18,track:false};};
  // THIS FIXTURE HAS NO WATER, and says so rather than implying it: the road
  // half is the systematic fault (`seedCell` waits for cover and the ecoregion,
  // never for OSM, so a road is ALWAYS later than the cell it crosses) and the
  // water half is the residual — the rivers OSM carries as ways. Only the first
  // can be put under a deterministic plane with no hydro system in it.
  c.hydroWet=()=>false;
  // Deterministic dense fixture. Include multiple roles, styles, equal distances
  // and roadside sites. The full production refill runs; world samplers are pure.
  seed=185;
  for(const [gx,gz] of squareRings(0,0,Math.ceil(range/220)+2)) {
    const cell=[];
    for(let i=0;i<80;i++) {
      const k=kinds[Math.floor(random()*kinds.length)];
      // `ax`/`az` are where the plant stands on EARTH, which every geographic
      // hash downstream reads instead of the local `x`/`z` that move with the
      // origin. On this unprojected plane they ARE the same numbers, which is
      // what keeps the two refreshes comparable: the old one hashed x/z and the
      // new one hashes ax/az. Omit them and the impostor tier's thinning hashes
      // NaN, which is never greater than its threshold, so it culls nothing —
      // and this file's snapshot does not cover the impostor mesh, so that
      // would pass while the tier quietly drew everything it was handed.
      const sx=gx*220+random()*220, sz=gz*220+random()*220;
      cell.push({k,x:sx,z:sz,ax:sx,az:sz,
        s:1+random()*2,h:families.includes(k)?2:0,rot:random()*6,
        sy:0.7+random()*0.6,sw:0.8+random()*0.4,tl:random()*0.1,
        c:new THREE.Color(0.2+random()*0.2,0.4,0.1),role:i%2?'interior':'fringe',anchor:i%13===0});
    }
    c.vegGrid.set(`${gx},${gz}`,cell);
  }
  vm.createContext(c);
  vm.runInContext(esbuild.transformSync(capacity+'\n'+vetoSrc+'\n'+rungSrc+'\n'+code,{loader:'ts'}).code,c);
  return c;
}
// `placed` carries a `rung` field since the mid rung and the baseline's records
// do not; it is the one key stripped, because the leg that reads it asserts
// the rung separately and every other leg runs with the rung off.
const stripRung=list=>list.map(({rung,...r})=>r);
function snapshot(c,withEz=true) {
  const snap=m=>({n:m.count,m:Array.from(m.instanceMatrix.array.subarray(0,m.count*16)),c:m.instanceColor?Array.from(m.instanceColor.array.subarray(0,m.count*3)):[]});
  return JSON.stringify({meshes:Object.fromEntries(kinds.filter(k=>k!=='grass').map(k=>[k,snap(c.vegMeshes[k])])),
    trunks:snap(c.trunks),ez:withEz?record(f=>c.ezTiers[f].map(t=>[snap(t.near),snap(t.far),t.n])):null,
    placed:stripRung(c.ezPlaced),edges:c.ezEdgeLast,roles:c.vegActiveRoles,anchors:c.vegActiveAnchors});
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
// ── THE MID RUNG MOVES TREES BETWEEN MESHES AND CHANGES NOTHING ELSE ──
// With the pixel line at the game's 58, an admitted tree lands in its variant's
// full pair or its mid pair by projected height — so the per-mesh byte identity
// above cannot hold and is not claimed. What is claimed is the MULTISET: every
// instance row (matrix and colour) the baseline wrote into a variant's near
// mesh is in the tree's near OR midNear mesh, and nothing else is; the same
// for far; every count agrees; the rung fired both ways; and the rest of the
// snapshot — the archetypes, the trunks, the placed records less their rung,
// the edges, the roles — is byte-identical. Negative control, RUN: `FULL_PX`
// at 1e9 fails on `full > 0` (every tree goes to the mid pair, and the
// multiset checks then pass by construction, since a row that moved WITH its
// neighbours is still in the union). What the multiset checks catch is a tree
// lost, duplicated or re-placed between the rungs — a slot counter that did
// not advance, a matrix written into the wrong pair — and a dropped `tn.nMid++`
// fails the count line beneath them.
{
  const FULL_PX=58;
  const a=context(oldRefresh,2800,true,1200),b=context(newRefresh,2800,true,1200,FULL_PX);
  const rows=m=>{const out=[];for(let i=0;i<m.count;i++)out.push(JSON.stringify([
    Array.from(m.instanceMatrix.array.subarray(i*16,i*16+16)),Array.from(m.instanceColor.array.subarray(i*3,i*3+3))]));return out.sort();};
  let mid=0,full=0;
  for(const [x,z,roads,scale] of [[15,-31,false,1],[250,30,true,2]]) {
    for(const c of [a,b]){c.state={x,z};c.roads=roads;c.treeSizeScale=scale;c.roadCalls=0;c.refreshVeg();}
    assert.equal(snapshot(b,false),snapshot(a,false),`the rest of the refill changed under the mid rung at ${x}/${roads}`);
    for(const f of families) a.ezTiers[f].forEach((ta,i)=>{
      const tb=b.ezTiers[f][i];
      assert.deepEqual([...rows(tb.near),...rows(tb.midNear)].sort(),rows(ta.near),`the near set differs at ${f}/${i} (${x}/${roads})`);
      assert.deepEqual([...rows(tb.far),...rows(tb.midFar)].sort(),rows(ta.far),`the far set differs at ${f}/${i} (${x}/${roads})`);
      assert.equal(tb.n,ta.n,`the count differs at ${f}/${i}`);
      assert.equal(tb.nMid,tb.midNear.count+tb.midFar.count,`nMid disagrees with the mid meshes at ${f}/${i}`);
      assert.equal(tb.n-tb.nMid,tb.near.count+tb.far.count,`the full count disagrees with the full meshes at ${f}/${i}`);
      mid+=tb.nMid; full+=tb.n-tb.nMid;
    });
  }
  assert.ok(mid>0,'the mid rung never fired at 58 px');
  assert.ok(full>0,'no tree was near enough for the full rung at 58 px');
  reports.push({leg:'mid-rung',fullPx:FULL_PX,mid,full});
}
// ── THE CARD HORIZON, ASSERTED ON THE REAL REFRESH ──
//
// `IMPOSTOR_CAP` is 512 here against roughly twenty-eight thousand candidates,
// so the card cap BINDS in this sandbox on every run — and nothing asserted on
// it, because (as the fixture's own note says) the snapshot does not cover the
// impostor mesh. That is exactly where the ring-order cap hid: the pass ran,
// the comparison passed, and the tier was refusing trees nearer than ones it
// had accepted the whole time.
//
// Two claims, both read off the STAGED INSTANCES the production pass wrote:
//   1. the cap bound and produced a finite horizon — or this proves nothing;
//   2. no card was placed beyond it. A histogram bin is a tolerance, not an
//      error: the last bin is admitted whole and `famN` trims inside it, so a
//      card may sit anywhere in that bin and the bound is the bin's far edge.
{
  const c = context(newRefresh, 2800, true, 120);
  c.state = { x: 250, z: 30 }; c.roads = true; c.treeSizeScale = 1;
  c.refreshVeg();
  const horizon = c.impProf.horizon, fams = Object.keys(horizon).filter(f => horizon[f] > 0);
  assert.ok(c.impProf.sweeps > 0, 'no impostor sweep completed — the census is unwritten');
  assert.ok(fams.length, 'the card cap never bound: this check witnesses nothing');
  // THE CLAIM, FROM BOTH SIDES. Comparing the floor against the cards it
  // selected proves nothing — it is the same expression twice, which is the
  // tautology this repo already caught once in the atlas test. So the walk
  // records the smallest tree it GAVE a card and the largest it REFUSED one,
  // and the rule says the refused one cannot be bigger, give or take the bin
  // the budget died in.
  // ── LEG ONE: THE FLOOR, ON THE UNIFORM WOOD ──
  // Read and FROZEN here, because the skewed leg below re-runs the refresh into
  // the same `impProf` and the numbers would silently become the other leg's.
  const slack = 1 / c.IMP_PX_PER_BIN + 1e-9;
  const uni = { floor: c.impProf.pxFloor, min: c.impProf.pxMinDrawn, max: c.impProf.pxMaxRefused };
  assert.ok(uni.floor > 0, 'the card budget refused nobody: this check witnesses nothing');
  assert.ok(Number.isFinite(uni.min), 'no card was placed by the floor rule at all');
  // THE CLAIM, FROM BOTH SIDES. Comparing the floor against the cards it
  // selected proves nothing — it is the same expression twice, the tautology
  // this repo already caught once in the atlas test. So the walk records the
  // smallest tree it GAVE a card and the largest it REFUSED one, and the rule
  // says the refused one cannot be bigger, give or take the bin the budget
  // died in. Handover-band cards are excluded from both sides: they are
  // admitted BELOW the floor on purpose and would compare two different rules.
  assert.ok(uni.max <= uni.min + slack,
    `a refused tree projects ${uni.max.toFixed(3)}px, larger than the smallest one given a card `
    + `(${uni.min.toFixed(3)}px) — the budget is not being spent on apparent size`);

  // ── AND NO CARD STANDS ON THE TARMAC ──
  //
  // The geometry tier has re-tested the road at place time for years and asks
  // it ONLY of the trees `ezAdmit` took; this tier draws the set admission
  // REFUSED. The two populations are disjoint by construction, so every card
  // in the game was stood up without the question being put, and no check in
  // this file could see it: the snapshot does not cover the impostor mesh and
  // `roadChecksAfter` counts the geometry tier's queries alone.
  //
  // Read off the STAGED INSTANCES the production pass wrote, against the same
  // stub the production rule asked — so a veto that fired and then staged the
  // card anyway would still fail this.
  let onRoadCards = 0;
  for (let i = 0; i < c.impostors.count; i++) {
    const m = c.impStage.m, o = i * 16;
    if (c.onCarriageway(m[o + 12], m[o + 14], 1.2).road) onRoadCards++;
  }
  // THE COUNT FIRST, so the control reports the fault rather than the guard:
  // with the card tier's veto removed this reads `77 of 400 impostors stand on
  // a carriageway` — a fifth of the tier. The guard under it is what stops a fixture with no roads in
  // it passing this vacuously.
  assert.equal(onRoadCards, 0,
    `${onRoadCards} of ${c.impostors.count} impostors stand on a carriageway`);
  assert.ok((c.impProf.why['veto:road'] ?? 0) > 0,
    'no card was vetoed for standing on tarmac: this check witnesses nothing');
  // AND A VETO IS NOT A NONE. The census fails on a perceptible `none:`, and a
  // tree the world says is not there has not lost its representation — so the
  // reason is named apart, and this is the assertion that keeps it that way.
  assert.ok(!Object.keys(c.impProf.why).some(k => k.startsWith('none:veto')),
    'a surface veto was filed as a NONE: the census will read it as a vanished tree');

  seed = 77;
  c.IMPOSTOR_CAP = 8000;
  // ── AND THE ROADS STAY ON, WHICH IS WHAT PUTS THE POOL UNDER ITS CAP ──
  // The surface veto is applied AFTER the budget decision, so a vetoed tree
  // costs the pool a slot it never fills. Under the old exact-cap gate that
  // turned the cull off and this leg had to run with its roads down; under the
  // floor-refusal gate it is the device's own condition — pool short of the
  // cap, floor still refusing — and it is the only way this fixture reaches it,
  // because the handover bands alone fill it to exactly 8000/8000 otherwise.
  c.roads = true;
  // ── AND THE FORM BUDGET MUST NOT BE THE THING THAT BINDS ──
  // At the stub's 400 the tier drew 800 of 8,151 offered and the POOL never
  // filled, so every check downstream was measuring the form budget wearing the
  // cap's name. Raised with the pool: the leg exists to put the card cap under
  // pressure, and a fixture where a different limit binds first tests nothing
  // it claims to.
  c.IMPOSTOR_FORM_BUDGET = 8000;
  c.impStage = { m: new Float32Array(8000 * 16), c: new Float32Array(8000 * 3),
    f: new Float32Array(8000), y: new Float32Array(8000) };
  c.impostors = impostorMesh(8000);
  c.vegGrid.clear();
  // ── THE CELL CULL RUNS IN THE EARTH-FIXED VEGETATION FRAME ──
  //
  // The production lattice is indexed by absolute metre cells while the
  // renderer's focus is local. The first cell cull subtracted the latter from
  // `gx * VEG_CELL`, so every real-world cell looked thousands of kilometres
  // away and the whole annulus disappeared whenever the gate opened. The
  // original zero-centred sandbox made absolute and local coordinates equal,
  // masking the fault. Put this leg around a nonzero earth origin: the shipped
  // broken subtraction retires every cell and fails `farWalk > 0`; carrying the
  // focus through `vegAbsOf` preserves the same selection as the local control.
  const absGX = -60483, absGZ = 19059;
  c.vegAbsOf = (x, z) => [x + absGX * 220, z + absGZ * 220];
  c.vegCellOf = (x, z) => {
    const [ax, az] = c.vegAbsOf(x, z);
    return [Math.floor(ax / 220), Math.floor(az / 220)];
  };
  // REACH FAR ENOUGH THAT THE CULL HAS SOMETHING TO CULL. At the default
  // 1.5x range the cull radius came out beyond the tier's own reach and the
  // check witnessed nothing — a fixture whose world ends before the mechanism
  // starts. Eight kilometres is the device's, with fewer sites per cell so the
  // check stays a check rather than a benchmark.
  c.impostorReach = () => 8000; c.impostorReachAsked = () => 8000;
  const [absCX, absCZ] = c.vegCellOf(c.state.x, c.state.z);
  for (const [gx, gz] of squareRings(absCX, absCZ, Math.ceil(8000 / 220) + 1)) {
    const cell = [];
    for (let i = 0; i < 24; i++) {
      // Nine broadleaf to one acacia: one family sets the floor, the other gets
      // a far skeleton edge and nothing above it.
      const k = random() < 0.9 ? 'broadleaf' : 'acacia';
      const ax = gx * 220 + random() * 220, az = gz * 220 + random() * 220;
      const sx = ax - absGX * 220, sz = az - absGZ * 220;
      cell.push({ k, x: sx, z: sz, ax, az,
        s: 1 + random() * 2, h: 2, rot: random() * 6,
        sy: 0.7 + random() * 0.6, sw: 0.8 + random() * 0.4, tl: random() * 0.1,
        c: new THREE.Color(0.2, 0.4, 0.1), role: i % 2 ? 'interior' : 'fringe', anchor: i % 13 === 0 });
    }
    c.vegGrid.set(`${gx},${gz}`, cell);
  }
  // Twice: the band is sized from LAST sweep's edge, so the first run on a new
  // population is the one that converges and the second is the one to read.
  c.refreshVeg(); c.refreshVeg();

  // ── AND THE BAND, FROM THE OTHER END ──
  // The floor check above cannot see the handover band at all: zeroing its
  // width changed no number this file could read, which makes it untested and
  // therefore not a guarantee. This is the claim directly — nothing is refused
  // within IMP_HANDOVER_M of the edge the skeletons stop at, so no tree can
  // cross that edge inward without having been a card first.
  // THE EXACT CLAIM, not a proxy for it. `gapM >= IMP_HANDOVER_M` reads like the
  // same thing and is trivially true whenever nothing happens to be refused near
  // an edge — it passed with the band cut to a tenth. What cannot be satisfied
  // by luck is the count of trees refused INSIDE a band, which the walk names
  // apart for exactly this reason. `hold` proves the reserve is live, or a band
  // of zero width would satisfy the invariant by having nothing to break.
  // ── THE CULL MUST CHANGE NOTHING THAT IS DRAWN ──
  //
  // It is the one optimisation here with no witness of its own: a culled tree is
  // never recorded as refused, so culling too hard LOWERS `pxMaxRefused` and the
  // floor check above passes more easily. An optimisation that makes its own
  // test easier is not tested at all.
  //
  // The claim is exact — the cull only retires trees below half the floor, and
  // nothing below the floor is ever drawn — so the same world gathered without
  // it must draw the same cards. `impPxFloorLast` at zero disables both the cell
  // cull and the site filter, which is the control.
  // WHAT THIS PINS AND WHAT IT DOES NOT. It pins the MECHANISM: it caught the
  // cull retiring trees the budget could still afford (800 drawn with it, 1,200
  // without) when the floor was high for the bands' sake rather than distance's.
  // It does NOT pin the MARGINS — halve either one and this still passes,
  // because every tree here is about the same height and the floor is steady.
  // The margins are insurance against a taller tree than any yet seen and
  // against a floor that needs to fall, and this fixture creates neither.
  const withCull = { drawn: c.impProf.drawn, floor: c.impProf.pxFloor, culled: c.impProf.farCull };
  assert.ok(withCull.culled > 0, 'no cell was culled: this check witnesses nothing');
  // ── AND THE GATE IS NOT AN EXACT CAP HIT ──
  // It was `impN >= IMPOSTOR_CAP`, which the floor's own construction makes
  // almost impossible: the histogram keeps whole bins while they fit, so the
  // admitted count lands UNDER the cap by the partial bin, and the surface veto
  // takes another slot per vetoed tree after the budget decision. A device read
  // `drawn 30871 · CAPPED at 32000` with `0/2584 cells retired unread` and
  // `impGather` at 614 ms against the 131 ms the cull was built to reach —
  // both cuts off in production, for the whole life of the cull.
  //
  // So this leg must witness the cull firing WITHOUT the cap being reached. A
  // fixture that happens to land on the cap exactly would pass the old gate and
  // prove nothing about the new one.
  assert.ok(c.impProf.drawn < c.IMPOSTOR_CAP,
    `the pool filled exactly (${c.impProf.drawn}/${c.IMPOSTOR_CAP}): this leg cannot tell `
    + 'the floor-refusal gate from the exact-cap gate it replaced');
  assert.ok(c.impProf.floorRefused > 0,
    'the floor refused nobody, so the cull is running on a budget that was not spent');
  // ── AND IT MAY NEVER RETIRE THE ANNULUS WHOLE ──
  // A device printed no far tally at all with every card reach inside the draw
  // ring: the cull radius had collapsed under `treeRange` and switched the far
  // tier off entirely, which reads in the dump as a saving. The radius is now
  // floored at the draw range, so cells just past it are always walked.
  assert.ok(c.impProf.farWalk > 0,
    'the cull retired the whole annulus: the far tier is off, not cheap');
  c.impPxFloorLast = 0; c.impTallestM = 0;
  c.refreshVeg();
  assert.equal(c.impProf.farCull, 0, 'the control still culled: it is not a control');
  assert.equal(c.impProf.drawn, withCull.drawn,
    `culling changed what is drawn: ${withCull.drawn} cards with the cull, `
    + `${c.impProf.drawn} without — the cull is retiring trees the tier would have used`);
  assert.equal(c.impProf.pxFloor.toFixed(3), withCull.floor.toFixed(3),
    `culling moved the floor: ${withCull.floor} with, ${c.impProf.pxFloor} without`);

  assert.ok(c.impProf.hold > 0, 'no card was reserved for a handover band: this check witnesses nothing');
  assert.equal(c.impProf.why['none:handover'] ?? 0, 0,
    `${c.impProf.why['none:handover']} trees were refused a card INSIDE their family's handover `
    + `band — each one arrives as a full skeleton having never been a card`);

}
const data=Array.from({length:100000},(_,i)=>({d:random()*1e6,id:i}));
function time(fn,n=15){const a=[];for(let i=0;i<n+5;i++){const t=performance.now();fn();if(i>=5)a.push(performance.now()-t);}return a.sort((a,b)=>a-b)[Math.floor(n/2)];}
const bench={n:data.length,k:8,oldMs:time(()=>data.slice().sort((a,b)=>a.d-b.d).slice(0,8)),newMs:time(()=>nearestStable(data.slice(),8,v=>v.d))};
// The admission's own shape after the mid rung: a cap a third of the ring,
// where nearestStable alone is a sort of the whole list.
{
  const ring=Array.from({length:16000},(_,i)=>[random()*1.96e6,i]);
  const k=5000;
  const sortMs=time(()=>nearestStable(ring.slice(),k,p=>p[0]));
  const prefixMs=time(()=>nearestStable(nearestPrefix(ring,k,p=>p[0]),k,p=>p[0]));
  bench.admit={n:ring.length,k,sortMs:+sortMs.toFixed(2),prefixMs:+prefixMs.toFixed(2),kept:nearestPrefix(ring,k,p=>p[0]).length};
}
console.log(JSON.stringify({checks:'PASS: ring order, stable selection incl ties, three r160 ranges, 20 production refill comparisons, card budget spent on apparent size, largest refused <= smallest drawn, handover band unbroken, cell cull changes nothing drawn and fires under the cap, no card on a carriageway',reports,selectionBenchmark:bench},null,2));
