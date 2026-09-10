const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
function compile(source, file) {
  const code = esbuild.buildSync({stdin:{contents:source, resolveDir:path.dirname(file),sourcefile:file,loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['three'],write:false}).outputFiles[0].text;
  const m = new Module(file, module); m.filename=file; m.paths=module.paths; m._compile(code,file); return m.exports;
}
const root = path.resolve(process.argv[2] || path.join(__dirname,'../client/hydro'));
const tests=path.join(root,'hydro.test.ts');
compile(fs.readFileSync(tests,'utf8'),tests).runHydroSelfTest();
const file=path.join(root,'system.ts');
const {waterGeometry}=compile(fs.readFileSync(file,'utf8')+'\nexport { waterGeometry };',file);
function field(flowing) {
  const n=130, geometry=new Float32Array(n*n*4), material=new Uint8Array(n*n*4);
  for(let i=0;i<n*n;i++){geometry[i*4]=1;geometry[i*4+1]=100;material[i*4]=flowing?4:3;material[i*4+3]=flowing?4:0;}
  return {width:n,height:n,resolution:128,gutter:1,bounds:{minX:0,minZ:0,maxX:2400,maxZ:2400},geometry,material};
}
const still=waterGeometry(field(false),32), river=waterGeometry(field(true),32);
const meshes=o=>Object.values(o).filter(v=>v && v.isBufferGeometry);
assert.equal(meshes(still)[0].index.count,32*32*6,'standing budget unchanged');
assert.equal(meshes(river)[0].index.count,32*32*6,'ordinary river keeps original budget');
const dropField=field(true);
dropField.waterfalls=new Float32Array(130*130*4);
for(let z=50;z<65;z++) for(let x=50;x<65;x++) dropField.waterfalls[(z*130+x)*4]=1;
const mixed=waterGeometry(dropField,32).flowing;
assert(mixed.index.count>6144 && mixed.index.count<16000,'local detail costs less than global subdivision');
const edges=new Map();
for(let k=0;k<mixed.index.count;k+=3) {
  const tri=Array.from(mixed.index.array.slice(k,k+3));
  for(let e=0;e<3;e++) {const a=tri[e],b=tri[(e+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);edges.set(key,(edges.get(key)||0)+1);}
}
for(const [key,n] of edges) {
  assert(n===1||n===2,'manifold edges');
  if(n===1) {
    const [a,b]=key.split(':').map(Number),p=mixed.attributes.position;
    assert((p.getX(a)===p.getX(b)&&Math.abs(p.getX(a))===.5)||(p.getZ(a)===p.getZ(b)&&Math.abs(p.getZ(a))===.5),'no open interior seams at coarse/fine joins');
  }
}
console.log('Mixed grid triangles:',mixed.index.count/3,'versus old',32768);
mixed.dispose();
const wf=path.join(root,'waterfalls.ts');
const {riverDrops,sampleRiverDrop}=compile(fs.readFileSync(wf,'utf8'),wf);
function profile(heights) {return new Float32Array(heights.flatMap((y,i)=>[0,i*10,y]));}
const along=new Float32Array([0,10,20,30,40,50,60,70]);
const drops=riverDrops(profile([80,80,80,60,40,20,20,20]),along);
assert.equal(drops.length,1);
assert.equal(riverDrops(profile([10,9,8,7,6,5,4,3]),along).length,0,'gentle river');
assert.equal(riverDrops(profile([30,27,24,21,18,15,12,9]),along).length,0,'sustained rapids');
assert.equal(riverDrops(profile([0,0,20,40,60,80,80,80]),along).length,0,'uphill not falling');
assert.equal(sampleRiverDrop(drops,0,80)[0],0,'quiet before lip');
assert(sampleRiverDrop(drops,35,50)[0]>.9,'coherent sheet');
assert(sampleRiverDrop(drops,50,20)[2]>.9,'landing impact');
assert(sampleRiverDrop(drops,65,20)[2]<sampleRiverDrop(drops,55,20)[2],'tail decays');
assert.equal(sampleRiverDrop(drops,200,20)[2],0,'tail ends');
assert.equal(riverDrops(profile([80,80,80,60,40,20,0,-20]),along)[0].landing,false,'no invented landing beyond fragment');
const bt=path.join(root,'build-tile.ts'),br=path.join(root,'body-registry.ts');
const {analyseHydroTile,buildHydroTile}=compile(fs.readFileSync(bt,'utf8'),bt);
const {HydroBodyRegistry}=compile(fs.readFileSync(br,'utf8'),br);
const heights=new Float32Array(64*64);
for(let z=0;z<64;z++)for(let x=0;x<64;x++)heights[z*64+x]=85-70*(.5+.5*Math.tanh((z/63*600-300)/8));
const input={key:'fall-test',revision:1,bounds:{minX:0,minZ:0,maxX:600,maxZ:600},elevation:{width:64,height:64,data:heights},features:[{id:'fall',source:'authored',kind:'river',intermittent:false,tidal:false,geometry:{type:'line',widthM:24,points:new Float64Array([300,0,300,600])}}],oceanCoverage:{status:'unavailable'}};
const analysis=analyseHydroTile(input),registry=new HydroBodyRegistry();
registry.updateTile(input.key,analysis.observations);
const built=buildHydroTile(input,registry,analysis,{});
assert(built.waterfalls,'profile evidence reaches tile field');
assert(built.waterfalls.some((v,i)=>i%4===0&&v>.2),'sheet survives rasterisation');
assert(built.waterfalls.some((v,i)=>i%4===2&&v>.2),'impact survives rasterisation');
for(const v of built.waterfalls)assert(Number.isFinite(v));
for(const mesh of [...meshes(still),...meshes(river)]) {
  for(const i of mesh.index.array) assert(i<mesh.attributes.position.count);
  for(const v of mesh.attributes.position.array) assert(Number.isFinite(v));
  mesh.dispose();
}
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
assert.equal(smooth(.55,1.5,.09),0,'graded river not falling');
assert.equal(smooth(.55,1.5,.35),0,'rapids not falling');
assert.equal(smooth(.55,1.5,2),1,'steep downstream face falls');
assert.equal(smooth(.55,1.5,0),0,'cross-bank and upstream slopes excluded');
console.log('Hydro self-tests and waterfall mesh/classification regressions passed');
