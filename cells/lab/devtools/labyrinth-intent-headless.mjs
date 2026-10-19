/** True headless intent experiments: the production gesture + world solver, no DOM/WebGL.
 * prepare OUT [cases.json] creates BEFORE packets only. execute OUT requires a locked expectation.
 * Use labyrinth-intent-review.mjs next/expect/reveal/critique between commands.
 */
import './labyrinth-node.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const { World, replay, unkey, key } = await import('../client/labyrinth/model.ts');
const { trace, tap } = await import('../client/labyrinth/gesture.ts');
const { buildings, walkable } = await import('../client/labyrinth/buildings.ts');
const { navigate, reaches } = await import('../client/labyrinth/nav.ts');
import { digest, writeJSON, readJSON, validateExpectation, review } from './labyrinth-intent-review.mjs';
const [command, root, casesFile] = process.argv.slice(2);
if (!root || !['prepare', 'execute'].includes(command)) throw new Error('Usage: node labyrinth-intent-headless.mjs prepare OUT [cases.json] | execute OUT');
const sources = ['model','gesture','nav','land','buildings'].map(n => new URL(`../client/labyrinth/${n}.ts`, import.meta.url)).concat(new URL('../client/kit/rng.ts', import.meta.url));
const sourceHash = digest(Buffer.concat([...sources.map(p => readFileSync(p)),readFileSync(new URL(import.meta.url))]));
const row = (a,b,j) => Array.from({length:b-a+1},(_,n)=>[a+n,j]);
const defaults = [
  {id:'bridge', seed:7, blocks:[[2,5,2],[8,5,2]], mode:'mass', path:row(2,8,5)},
  {id:'paused-climb', seed:7, blocks:[[8,5,3]], mode:'way', path:row(2,8,5), rests:[[6,5]]},
  {id:'court', seed:7, blocks:[], mode:'mass', path:[[3,3],[4,3],[5,3],[6,3],[7,3],[7,4],[7,5],[7,6],[7,7],[6,7],[5,7],[4,7],[3,7],[3,6],[3,5],[3,4],[3,3]]},
  {id:'short-climb', seed:7, blocks:[[5,5,4]], mode:'way', path:row(3,5,5)},
  {id:'obstacle-way', seed:7, blocks:[[2,5,2],[8,5,2],[5,5,4]], mode:'way', path:row(2,8,5)},
  {id:'obstacle-mass', seed:7, blocks:[[2,5,2],[8,5,2],[5,5,4]], mode:'mass', path:row(2,8,5)},
];
function scene(w, box) {
  const cells=[];
  for(let j=box[2];j<=box[3];j++)for(let i=box[0];i<=box[1];i++){
    const ground=w.ground(i,j), solids=[],stairs=[],archways=[];
    for(let k=ground;k<w.levels;k++){if(w.archway(k,i,j)>=0)archways.push({level:k,axis:w.archway(k,i,j)});if(w.stone(k,i,j))solids.push(k);if(w.stair(k,i,j)>=0)stairs.push({level:k,direction:w.stair(k,i,j)});}
    cells.push({i,j,ground,solids,stairs,archways,water:w.pool(i,j),paved:w.paved(i,j),court:w.courts.has(key(0,i,j))});
  }
  return {box,cells,spans:w.spans.map(s=>({...s})),piers:[...w.piers.keys()].map(unkey)};
}
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function diagram(s,g,title,actualPath=null){
  const [i0,i1,j0,j1]=s.box, size=68, width=(i1-i0+1)*size+100,height=(j1-j0+1)*size+160;
  const xy=([i,j])=>[60+(i-i0)*size+size/2,65+(j-j0)*size+size/2];
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#faf7ef"/><style>text{font-family:monospace;fill:#292b2c;font-size:11px}</style><text x="18" y="24" style="font-size:17px">${esc(title)} — mode ${g.mode}</text><text x="18" y="45">Plan schematic: G ground / T highest solid top / S stair direction</text>`;
  for(const c of s.cells){const [x,y]=xy([c.i,c.j]),top=c.solids.length?Math.max(...c.solids)+1:null;
    const fill=c.water?'#b1d5df':c.stairs.length?'#e6ba75':top!==null?'#beb5a3':c.paved?'#d4dfbc':'#f2eee3';
    svg+=`<rect x="${x-size/2}" y="${y-size/2}" width="${size}" height="${size}" fill="${fill}" stroke="#d1cabc"/><text x="${x-size/2+4}" y="${y-20}">${c.i},${c.j}</text><text x="${x-size/2+4}" y="${y+13}">G${c.ground}${top!==null?' T'+top:''}</text>`;
    if(c.archways.length)svg+=`<text x="${x+5}" y="${y-20}">A${c.archways.map(a=>a.level).join(',')}</text>`;
    if(c.stairs.length)svg+=`<text x="${x-size/2+4}" y="${y+26}">S${c.stairs.map(t=>t.level+['→','↓','←','↑'][t.direction]).join(',')}</text>`;
  }
  svg+=`<polyline points="${g.path.map(p=>xy(p).join(',')).join(' ')}" fill="none" stroke="#bd3d3a" stroke-width="3" opacity=".8"/>`;
  if(actualPath)svg+=`<polyline points="${actualPath.map(p=>xy(p).join(',')).join(' ')}" fill="none" stroke="#187c87" stroke-width="5" stroke-dasharray="7 5" opacity=".85"/>`;
  const [sx,sy]=xy(g.path[0]),[ex,ey]=xy(g.path.at(-1));
  svg+=`<circle cx="${sx}" cy="${sy}" r="8" fill="white" stroke="#bd3d3a" stroke-width="3"/><rect x="${ex-5}" y="${ey-5}" width="10" height="10" fill="#bd3d3a"/>`;
  for(const p of g.rests??[]){const[x,y]=xy(p);svg+=`<circle cx="${x}" cy="${y}" r="15" stroke="#bd3d3a" fill="none" stroke-width="2" stroke-dasharray="3 3"/>`;}
  return svg+`<text x="18" y="${height-52}">White circle start; red square end; dashed circle deliberate pause.</text><text x="18" y="${height-32}">A archway level; blue dash resolved cells. No rendering/picking/UI assessment.</text></svg>`;
}
function pick(w,[i,j]){
  let k=w.ground(i,j);while(w.stone(k,i,j)||w.stair(k,i,j)>=0)k++;
  return k===w.ground(i,j)?{face:'ground',hit:[-1,i,j],to:[k,i,j]}:{face:'top',hit:[k-1,i,j],to:[k,i,j]};
}
if(command==='prepare'){
  if(existsSync(root)&&readdirSync(root).length)throw new Error('Use a fresh OUT directory');
  mkdirSync(root,{recursive:true});
  const cases=casesFile?readJSON(casesFile):defaults;
  if(!Array.isArray(cases)||!cases.length||cases.some(c=>!/^[a-zA-Z0-9_-]+$/.test(c.id))||new Set(cases.map(c=>c.id)).size!==cases.length)throw new Error('Invalid case IDs');
  for(const c of cases){
    const w=c.world?replay(c.world,c.seed??7):new World(c.seed??7,c.landSeed??0);
    if(!c.world)for(const[i,j,h]of c.blocks??[]){const add=[];for(let k=w.ground(i,j);k<h;k++)add.push([k,i,j,-100]);if(add.length)w.apply({add},-100);}
    const box=c.box??[1,9,2,8],dir=join(root,'sealed',c.id);mkdirSync(dir,{recursive:true});
    const start=c.start??pick(w,c.path[0]),end=c.end===null?null:c.end??pick(w,c.path.at(-1));
    const gesture={mode:c.mode??'mass',path:c.path,rests:c.rests??[],start,end};
    writeJSON(join(dir,'before.json'),{schema:'labyrinth-intent-before/1',id:c.id,representation:'model-space schematic',scene:scene(w,box),gesture,
      question:'What could this gesture mean? Commit expectations before execute. These are semantic gesture inputs, not screen events.'});
    writeFileSync(join(dir,'before.svg'),diagram(scene(w,box),gesture,c.id+' BEFORE'));
    writeJSON(join(dir,'input.json'),{id:c.id,world:w.encode(),seed:w.seed,box,gesture,sourceHash});
  }
  writeJSON(join(root,'manifest.json'),{schema:'labyrinth-intent/2',complete:true,backend:'headless-model',ids:cases.map(c=>c.id),sourceHash});
  console.log('Before packets prepared. No proposed gesture has been executed. Use review next, expect, then headless execute.');
}else{
  const id=review(root,'status').active;if(!id)throw new Error('No active case');
  const dir=join(root,'sealed',id),lock=readJSON(join(root,'reviews',id,'expectation.lock.json'));
  validateExpectation(lock.value,id);
  if(lock.valueHash!==digest(JSON.stringify(lock.value))||lock.packetHash!==digest(Buffer.concat([readFileSync(join(dir,'before.json')),readFileSync(join(dir,'before.svg'))])))throw new Error('Expectation/before integrity failure');
  if(existsSync(join(dir,'result.json')))throw new Error('Already executed; use review reveal');
  const input=readJSON(join(dir,'input.json'));if(input.sourceHash!==sourceHash)throw new Error('Model changed since preparation');
  const w=replay(input.world,input.seed),g=input.gesture,before=scene(w,input.box);
  const op=g.path.length===1?tap(w,g.start,0):trace(w,g.start,g.path,g.end,()=>0,0,g.rests,g.mode);
  if(op&&!('refused'in op))w.apply(op,0);
  const after=scene(w,input.box),r=op&&!('refused'in op)?w.reached.get(op)??null:null;
  const result={id,backend:'production gesture.ts + model.ts',sourceHash,op,reached:r,
    changedCells:after.cells.filter((c,n)=>JSON.stringify(c)!==JSON.stringify(before.cells[n])),after,
    navigation:g.end?{from:g.start.to,to:g.end.to,connected:reaches(navigate(w),g.start.to,g.end.to),connectedIncludingInteriors:reaches(walkable(w),g.start.to,g.end.to),includesBuildingInteriors:false}:null,
    buildings:buildings(w).list,inside:buildings(w).inside,
    limitations:['No production picking, projection, dwell detection, hysteresis or preview UI','Schematic geometry only; not a rendered aesthetic assessment','Exterior and interior-inclusive navigation are reported separately'],world:w.encode()};
  writeFileSync(join(dir,'after.svg'),diagram(after,g,id+' AFTER',r?.cells?.map(c=>[c[1],c[2]])));
  writeJSON(join(dir,'result.json'),result,true);
  console.log(`${id}: executed only after expectation commitment. Use review reveal.`);
}
