const fs=require('node:fs'),vm=require('node:vm'),esbuild=require('esbuild'),THREE=require('three');
const path=require('node:path');
const s=fs.readFileSync(process.argv[2]||path.join(__dirname,'../client/main.ts'),'utf8');
const funcs=['solarAngles','snapShadowCentre'].map(n=>{const i=s.indexOf('function '+n+'(');return s.slice(i,s.indexOf('\n}',i)+2)}).join('\n');
const c={THREE,Math,SUN_DIR:new THREE.Vector3(),SHADOW_SNAP:true,shadowSpan:110,
  sun:new THREE.DirectionalLight(),shX:new THREE.Vector3(),shY:new THREE.Vector3(),shZ:new THREE.Vector3(),shadowPhase:0,
  shadowAnchor:new THREE.Vector3(),shadowDelta:new THREE.Vector3(),shadowAnchored:false};
c.sun.shadow.mapSize.set(1024,1024);
vm.createContext(c);vm.runInContext(esbuild.transformSync(funcs,{loader:'ts'}).code,c);
function run(rate,offset){
  c.shadowAnchored=false;
  const anchor=new THREE.Vector3(offset,100,offset),point=anchor.clone().add(new THREE.Vector3(2,3,1));
  const epoch=Date.UTC(2026,8,9,15,0,0);let first=null,last=null,maxPhase=0,maxStep=0,prev=null;
  for(let i=0;i<=3600;i++){
    const {alt,az}=c.solarAngles(37.73627,-119.63691,new Date(epoch+i/60*1000*rate));
    c.SUN_DIR.set(Math.cos(alt)*Math.sin(az),Math.sin(alt),-Math.cos(alt)*Math.cos(az));
    const target=anchor.clone();c.snapShadowCentre(target);
    const uv=[point.clone().sub(target).dot(c.shX)/(.21484375),point.clone().sub(target).dot(c.shY)/(.21484375)];
    if(!first)first=uv;if(prev){const dx=uv[0]-prev[0],dy=uv[1]-prev[1];maxStep=Math.max(maxStep,Math.hypot(dx-Math.round(dx),dy-Math.round(dy)));}
    prev=last=uv;maxPhase=Math.max(maxPhase,c.shadowPhase);
  }
  return {rate,offset,maxFractionalTexelStepPerFrame:maxStep,maxReportedSnapResidual:maxPhase};
}
console.log(JSON.stringify([run(0,0),run(24,0),run(0,10000),run(24,10000)],null,2));
