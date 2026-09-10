import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildSync,transformSync} from 'esbuild';
import * as THREE from 'three';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
function mod(p){const c={module:{exports:{}},exports:{},console,performance,Float32Array,Float64Array,Uint8Array,Uint16Array,Uint32Array,setTimeout,clearTimeout};
 vm.runInNewContext(buildSync({entryPoints:[new URL(p,import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,c);return c.module.exports;}
const {bankHabitat:B,bankGroundMineralMix,bankMineralColour,sampleBankField,bankHash,bankPatch,bankWetMargin,BANK_GLSL,WATERLINE_CUT}=mod('./shoreline.ts');
const {sampleFieldSurface:S}=mod('./hydro/field-sample.ts');
// Cross-check the integer hash against float32 arithmetic, rather than itself.
const F=Math.fround,M=(x,y)=>F(x-F(y*Math.floor(F(x/y))));
const gpuHash=(x,z)=>{let h=M(F(F(M(x,4093)*73)+F(M(z,4093)*157)),4093);
 h=M(F(h*h),4093);return F(M(F(F(h*251)+109),4093)/4093);};
let err=0;
for(let i=-100000;i<=100000;i+=137)err=Math.max(err,Math.abs(bankHash(i,Math.floor(i*0.73))-gpuHash(i,Math.floor(i*0.73))));
assert.ok(err<1e-7,'CPU/GPU hash drift');
assert.equal(WATERLINE_CUT(417,29,'ocean'),0.5);
assert.equal(WATERLINE_CUT(417,29,'lagoon'),0.5);
assert.equal(bankPatch(-5802,3147),bankPatch(-5802,3147));
assert.equal(bankWetMargin(0,.5),1);
assert.ok(bankWetMargin(4,.8)>bankWetMargin(8,.8));
assert.equal(bankWetMargin(20,.5),0);
assert.equal(bankMineralColour(.4,.3,.2).map(v=>v.toFixed(4)).join(','),'0.2948,0.2340,0.1732');
const w={kind:'lake',restingLevelM:10,depthM:0.3,shoreDistanceM:1,flow:[0.1,0],wet:true};
assert.ok(bankGroundMineralMix(w,.5)>.85);
assert.ok(bankGroundMineralMix({...w,wet:false,shoreDistanceM:2},.5)>0);
assert.equal(bankGroundMineralMix({...w,kind:'ocean'},.5),0);
assert.ok(B(90,.8,18,.02,true,9.8,w).reeds>.5);
assert.equal(B(80,.8,18,.02,true,7,w).reeds,0);
assert.equal(B(80,.8,18,.02,true,7,w).mineral,0);
assert.equal(B(80,.8,18,.02,true,9.8).reeds,0);
assert.equal(B(70,.8,-5,.02,true,9.8,w).reeds,0);
assert.equal(B(30,.8,18,.02,false,10).mineral,0);
assert.equal(B(30,.8,18,.02,true,9.8,{...w,wet:false}).submerged,false);
assert.equal(B(60,.3,18,.35,true,9.8,{...w,flow:[2,0]}).reeds,0);
// A non-square world rect and a linear field: exact known values at a texel
// centre, midway between centres, and across the gutter. This would fail the
// old nearest-texel / resolution-1 code even with a matching cutoff hash.
const f={bounds:{minX:0,minZ:0,maxX:80,maxZ:40},resolution:8,gutter:1,width:10,height:10,
 elevationBaseM:100,geometry:new Float32Array(400),material:new Uint8Array(400),dynamics:new Float32Array(400)};
for(let j=0;j<10;j++)for(let i=0;i<10;i++){
 const k=(j*10+i)*4;f.geometry[k]=i/10;f.geometry[k+1]=(i-5)*10;
 f.geometry[k+2]=i*2+j*3;f.geometry[k+3]=i;f.material[k]=3;
}
const centre=S(f,5,2.5,.05);assert.ok(Math.abs(centre.restingLevelM-105)<1e-6);
const mid=S(f,10,5,.1);assert.ok(Math.abs(mid.coverage-.15)<1e-6);
assert.equal(mid.restingLevelM,107.5);assert.equal(S(f,10,5,.16),undefined);
assert.equal(S(f,-1,5,.1),undefined);
const edge=S(f,0,0,.01);assert.equal(edge.restingLevelM,102.5);
const adjacent={...f,bounds:{minX:80,minZ:0,maxX:160,maxZ:40},geometry:f.geometry.slice()};
for(let j=0;j<10;j++)for(let i=0;i<10;i++){
 const k=(j*10+i)*4;adjacent.geometry[k]=(i+8)/10;adjacent.geometry[k+2]=(i+8)*2+j*3;
}
assert.equal(S(f,80,17,.01).restingLevelM,S(adjacent,80,17,.01).restingLevelM);
assert.equal(sampleBankField(f,35,10,12).wet,false);
assert.equal(sampleBankField(f,75,10,12).wet,true);
assert.equal(sampleBankField({...f,material:new Uint8Array(400)},25,10,12),undefined);
// Real shader injection, preserving the flowers and road mask.
const main=read('./main.ts'),start=main.indexOf('const SWARD_GLSL ='),end=main.indexOf('/**\n * Bands:',start);
const SWARD_FLOW_NAMES=['Open','Wood','Water','Cliff','Ruin'].flatMap(n=>[0,1,2].map(i=>'uFlow'+n+i));
const ctx={THREE,BANK_GLSL,SWARD_FLOW_NAMES,swardU:{},windU:{},module:{exports:{}}};
vm.runInNewContext(transformSync(main.slice(start,end)+'\nmodule.exports=swardMaterial({});',{loader:'ts',format:'cjs'}).code,ctx);
const sh={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};
ctx.module.exports.onBeforeCompile(sh);
assert.ok(sh.vertexShader.includes('sMaskOk && sD < uGReach'));
assert.ok(sh.vertexShader.includes('sF.g >= 0.0 || sIsReed || sIsStone'));
assert.ok(sh.vertexShader.includes('sIsStone ? 0.0'));
assert.equal((sh.vertexShader.match(/float bankHash\(/g)||[]).length,1);
// Run the actual field producer: lake margins need no channel-grid entry,
// underwater ordinary grass is excluded, and shore=0 clears both spare lanes.
const rows=main.slice(main.indexOf('function swardRows('),main.indexOf('/** THE SWEEP YIELDS'));
const Fld=new Float32Array(4),Col=new Uint8Array(4);
const rc={SWARD_F:1,SWARD_FM:3,swardPendX:0,swardPendZ:0,swardScratchF:Fld,swardScratchC:Col,
 groundAt:()=>9.8,sampleCover:()=>80,seaOn:false,baseElev:0,elevEffAt:()=>0,
 climateAt:()=>({moisture:.8,tempC:18,treeline:2000}),swardLift:()=>1,GRASS_M2:{80:0},SHORE_ON:true,
 terrainPalette:()=>[.4,.4,.3],bankPaint:()=>30,hydroSys:{fieldAt:()=>({})},
 sampleBankField:()=>w,bankHabitat:B,bankPatch:()=>.5,bankWetMargin,
 bankMineralColour:(r,g,b)=>[r*.8,g*.8,b*.8],
 BANK_REED:[.4,.44,.2],REED_M2:.14,COVER:{water:80,wetland:90,mangrove:95},
 swardCtxAt:()=>2,clamp:(v,a,b)=>Math.max(a,Math.min(b,v))};
vm.createContext(rc);vm.runInContext(transformSync(rows,{loader:'ts',format:'cjs'}).code,rc);
vm.runInContext('swardRows(0,1)',rc);assert.ok(Fld[1]<0);assert.ok(Fld[2]>.4);
rc.sampleBankField=()=>({...w,wet:false,shoreDistanceM:0});
rc.bankPaint=()=>30;
vm.runInContext('swardRows(0,1)',rc);
assert.ok(Fld[1]>0&&Fld[1]<.45,'dry class-80 bank regrows a softened canonical margin');
rc.SHORE_ON=false;vm.runInContext('swardRows(0,1)',rc);assert.equal(Fld[2],0);assert.equal(Fld[3],0);
mod('./hydro/hydro.test.ts').runHydroSelfTest();
console.log('PASS: float32 hash parity, GPU-aligned field sampling and tile-edge continuity, habitat/depth gates, real sward producer and Three shader injection, hydro regressions');
