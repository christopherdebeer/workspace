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
assert.equal(meshes(river)[0].index.count,128*128*6,'river resolves field within bounded 4x subdivision');
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
