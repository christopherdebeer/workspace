import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildSync, transformSync} from 'esbuild';
import * as THREE from 'three';
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const compile = s => transformSync(s, {loader:'ts',format:'cjs'}).code;
const main = read('./main.ts');
let clock=100;
const profSource=main.slice(main.indexOf('const frameProf ='),main.indexOf('/** The session\'s telemetry as text'));
const pc=vm.createContext({performance:{now:()=>clock}});
vm.runInContext(compile(profSource),pc);
const run=s=>vm.runInContext(s,pc);
run('profFrame(100); profTickStart()');
clock=108;run('profAdd("work",100); profTickEnd("tail")');
clock=150;run('profFrame(150)');
assert.equal(run('sessSlow'),1); // exactly 50 agrees with the histogram
assert.equal(run('sessHist[3]'),1);
assert.equal(run('sessTickMax'),8);
assert.equal(run('sessProf.get("gap (unmeasured)").ms'),42);
run('profTickStart()');clock=154;run('profTickEnd("tail")');
clock=160;run('profAdd("reply",155)');clock=170;run('profFrame(170)');
assert.equal(run('sessOff'),5);
assert.equal(run('sessTick'),12);
assert.equal(run('sessWall'),70);
assert.equal(run('sessProf.get("gap (unmeasured)").ms'),53);
assert.equal(run('curFrame.size'),0);
// An unchanged float32 surface must not regenerate normals or upload buffers.
const geo=new THREE.BufferGeometry();
geo.setAttribute('position',new THREE.Float32BufferAttribute([0,1.1,0, 1,2,0, 0,3,1],3));
let normals=0,bounds=0,height=1.1;
geo.computeVertexNormals=()=>normals++;geo.computeBoundingSphere=()=>bounds++;
const d={geo,x0:0,x1:1,z0:0,z1:1,lift:0,seat:new Uint8Array([1,0,0])};
const drapeSource=main.slice(main.indexOf('function redrape('),main.indexOf('/** Build the shoulders',main.indexOf('function redrape(')));
const dc=vm.createContext({THREE,drapeGrid:{},drapeWide:[],drapedWays:[d],terrainScan:{},nearCells:()=>new Set([d]),groundAt:()=>height});
vm.runInContext(compile(drapeSource),dc);
vm.runInContext('redrape({xs:0,zs:0,w:2,h:2})',dc);
assert.equal(normals,0);assert.equal(bounds,0);
height=4;vm.runInContext('redrape({xs:0,zs:0,w:2,h:2})',dc);
assert.equal(normals,1);assert.equal(bounds,1);assert.equal(geo.attributes.position.getY(1),2);
// Audio graph: muted arm allocates nothing; rain/cab/roof controls remain bounded.
class Param {value=0;setTargetAtTime(v){this.value=v;}setValueAtTime(v){this.value=v;}exponentialRampToValueAtTime(v){this.value=v;}}
class Node {threshold=new Param();knee=new Param();ratio=new Param();attack=new Param();release=new Param();getFloatTimeDomainData(a){a.fill(0);}gain=new Param();frequency=new Param();Q=new Param();pan=new Param();delayTime=new Param();playbackRate=new Param();connect(){}start(){}stop(){}disconnect(){}}
let contexts=0;
class AC {state='running';currentTime=1;sampleRate=8000;destination=new Node();constructor(){contexts++;}createDynamicsCompressor(){return new Node();}createAnalyser(){return new Node();}createGain(){return new Node();}createBiquadFilter(){return new Node();}createOscillator(){return new Node();}createBufferSource(){return new Node();}createStereoPanner(){return new Node();}createDelay(){return new Node();}createBuffer(c,n){const a=new Float32Array(n);return {getChannelData:()=>a};}suspend(){this.state='suspended';return Promise.resolve();}resume(){this.state='running';return Promise.resolve();}}
const ac=vm.createContext({module:{exports:{}},exports:{},window:{AudioContext:AC},navigator:{},localStorage:{getItem:()=> '1',setItem(){}},performance:{now:()=>1000}});
vm.runInContext(buildSync({entryPoints:[new URL('./audio.ts',import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,ac);
const {createAudio,rainPattern}=ac.module.exports;
const a=rainPattern(8000),b=rainPattern(8000);
assert.equal(a.length,24000);assert.deepEqual(a,b);assert.ok(a.some(x=>Math.abs(x)>0.01));assert.ok(a.every(Number.isFinite));
const audio=createAudio();audio.arm();assert.equal(contexts,0);audio.toggle();assert.equal(contexts,1);
audio.space(0,0);audio.update(10,0.5,'road',1,1);const outside=audio.mix();
audio.space(0,1);audio.update(10,0.5,'road',1,1);const cab=audio.mix();
assert.ok(cab.out<outside.out);assert.ok(cab.roof>outside.roof);assert.ok(cab.muffle<outside.muffle);
audio.space(1,1);audio.update(10,0.5,'road',1,1);assert.equal(audio.mix().roof,0);
audio.space(0,0);audio.update(10,0.5,'road',1,0);assert.equal(audio.mix().roof,0);assert.equal(audio.mix().rain,0);

audio.space(0,0);
audio.update(0,0,'ground',1,0,0,0,0,0,0,0,0,1,0);assert.equal(audio.mix().rattle,0);
audio.update(15,0,'ground',1,0,0,0,0,0,0,0,0,1,0);assert.ok(audio.mix().rattle>0);
audio.update(15,0,'ground',0,0,0,0,0,0,0,0,0,1,0);assert.equal(audio.mix().rattle,0);
audio.update(20,0,'road',1,0,0,0,0,1,0,0,0,0,0);const dry=audio.mix().roar;
audio.update(20,0,'road',1,0,0,0,0,1,0,0,0,0,1);assert.ok(audio.mix().roar>dry);assert.equal(audio.mix().rain,0);
audio.drone(0,0,1);assert.equal(audio.mix().drone,0);
audio.drone(1,0,0);const near=audio.mix().drone;audio.drone(1,150,0);assert.ok(audio.mix().drone<near*0.1);
const hc=vm.createContext({module:{exports:{}},exports:{},console,performance,Float32Array,Float64Array,Uint8Array,Uint16Array,Uint32Array});
vm.runInContext(buildSync({entryPoints:[new URL('./hydro/hydro.test.ts',import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,hc);hc.module.exports.runHydroSelfTest();
console.log('PASS: existing hydro self-tests, latest calibrated audio graph, stopped/airborne rattle, retained wet-road hiss after rain, drone lifecycle/distance and prior telemetry checks');

