const {JSDOM}=require('jsdom');
const fs=require('fs'),assert=require('assert');
const html=fs.readFileSync('static/fab.html','utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'');
function setup(url,storage){
const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.structuredClone=structuredClone;w.crypto.randomUUID=()=>crypto.randomUUID();w.ResizeObserver=class{observe(){}};
w.Path2D=class{moveTo(){}lineTo(){}closePath(){}arc(){}};w.DOMMatrix=class{};
w.requestAnimationFrame=f=>{w.nextFrame=f;return 1};w.cancelAnimationFrame=()=>{};
let id=0;const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:()=>0,getUniformLocation:()=>({}),getExtension:()=>null}, {get(t,k){return k in t?t[k]:typeof k==='string'&&k.toUpperCase()===k?(t[k]=++id):(()=>({}));}});
const ctx=new Proxy({measureText:t=>({width:t.length*7}),createPattern:()=>({setTransform(){}}),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get(t,k){return k in t?t[k]:(()=>{});},set(t,k,v){t[k]=v;return true}});
w.HTMLCanvasElement.prototype.getContext=function(kind){return kind==='webgl2'?gl:ctx};
Object.defineProperties(w.HTMLElement.prototype,{clientWidth:{get(){return this.tagName==='CANVAS'?430:430},configurable:true},clientHeight:{get(){return this.tagName==='CANVAS'?900:100},configurable:true},offsetHeight:{get(){return 44}},offsetTop:{get(){return 0}},offsetParent:{get(){return this.parentElement}}});
w.HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:0,left:0,top:0,width:this.clientWidth,height:this.id==='bench'?180:this.clientHeight,right:430,bottom:900}};
w.HTMLElement.prototype.setPointerCapture=function(id){this._pointer=id};w.HTMLElement.prototype.hasPointerCapture=function(id){return this._pointer===id};
w.alert=()=>{};w.confirm=()=>true;w.prompt=()=> 'Test rail';
if(storage)w.localStorage.setItem('fab.outfit.v1',storage);
w.eval(fs.readFileSync('static/test-app.js','utf8'));
return w;
}
const w=setup('https://example.test/fab?fam=dress&drawer=focus');
let fab=w.__fab;assert(fab,'startup');
function click(sel){const el=w.document.querySelector(sel);assert(el,sel);el.click();}
click('[data-place="table"]');assert.equal(fab.probe().mode,'table');
assert(w.document.querySelectorAll('#pieces button').length>3,'dress pieces');
const front=[...w.document.querySelectorAll('#pieces button')].find(b=>b.textContent.startsWith('front'));assert(front);front.click();
const neck=w.document.querySelector('select[aria-label="neckline"]');assert(neck);neck.value='v';neck.dispatchEvent(new w.Event('change'));
assert.equal(fab.probe().design.neck,'v');assert(fab.journal().cursor>0);
click('#undo');assert.equal(fab.probe().design.neck,'round');click('#redo');assert.equal(fab.probe().design.neck,'v');
click('[data-place="rails"]');fab.wear(0);assert(fab.outfit().length===2,'second garment preserved');
assert(fab.outfit().some(x=>x.family==='dress'));assert(fab.outfit().some(x=>x.family==='skirt'));
const old=fab.outfit().find(x=>x.family==='dress');fab.selectItem(old.id);assert.equal(fab.probe().design.family,'dress');
click('[data-place="table"]');
// replay after a real handle gesture, and cancellation
fab.editor.selected='front';click('[data-place="bench"]');click('[data-place="table"]');
const h=fab.editor.handles.find(h=>h.key==='neckDepth');assert(h,'neck handle');const initial=fab.probe().design.neckDepth;
assert(fab.editor.down([h.x,h.y],1));fab.editor.move([h.x,h.y+10]);fab.editor.up(false);assert(fab.probe().design.neckDepth>initial);
click('#undo');assert.equal(fab.probe().design.neckDepth,initial);
console.log('PASS startup, whole dress selection, neckline operation, undo/redo, multiple garments, selection, edge drag, persistence');
const saved=w.localStorage.getItem('fab.outfit.v1'),url=w.location.href;
const reloaded=setup(url,saved);assert.equal(reloaded.__fab.outfit().length,2,'reload restores outfit with design URL');assert.equal(reloaded.__fab.probe().design.family,'dress');
console.log('PASS actual reload restores both garments and active selection');reloaded.close();w.close();
