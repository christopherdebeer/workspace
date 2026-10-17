/** Pattern-side handles. Every gesture targets a named piece/edge; packing is frozen until release. */
import { drawSheet, type Laid } from './sheet';
import type { Design } from './pattern';
import type { Garment } from './garment';
import type { Print } from './fabric';
export interface Handle { piece: string; edge: string; key: keyof Design; x:number;y:number; axis:'x'|'y'; lo:number;hi:number; gain:number; label:string }
/** An edge of a piece that can be dragged: which dial it works, where on the piece (u, v), which way, its range, how
 * far a pixel takes it; what it's called, and (for the drawer's list) what dragging it does, one way and the other. */
export interface Edge { key: keyof Design; u:number; v:number; axis:'x'|'y'; lo:number; hi:number; gain:number; label:string; edge:string; verb:string; range:string }
/** the edges a piece offers, as it is in this design */
export function edgesOf(p: Garment['pieces'][number], d: Design): Edge[] {
  const out: Edge[] = [];
  const add=(key:keyof Design,u:number,v:number,axis:'x'|'y',lo:number,hi:number,gain:number,label:string,edge:string,verb:string,range:string)=>out.push({key,u,v,axis,lo,hi,gain,label,edge,verb,range});
  if(p.part==='bodice'){
    if(d.family==='top')add('bodyLen',.5,1,'y',-6,30,1,'length','hem','drag the hem','longer · shorter');
    add('ease',1,.4,'x',4,16,4,'room','side','drag the side','roomier · closer');
    if(p.name==='front')add('neckDepth',.5,0,'y',-4,8,1,'neck depth','neck','drag the neck','deeper · higher');
    if(d.family==='top')add('swing',1,1,'x',1,1.8,.035,'spread hem','hem','drag the hem\'s corner out','straight → swung');
  }
  if(p.part==='sleeve'){
    add('sleeveLen',.5,1,'y',2,34,1,'length','hem','drag the hem','longer · shorter');
    if(d.sleeve==='puff') add('sleeveFullness',.5,0,'x',1.03,1.8,.04,'gather head','cap','drag the head out','plain → gathered');
  }
  if(p.part==='legs'){
    add('legLen',.5,1,'y',3,34,1,'length','hem','drag the hem','longer · shorter');
    add('legWidth',1,.35,'x',1,2,.05,'width','outseam','drag the side','slim → wide');
    add('flare',1,1,'x',.8,1.8,.04,'flare','hem','drag the hem\'s corner out','tapered → flared');
  }
  if(/collar|frill/.test(p.name))add('collarWidth',.5,1,'y',1.5,8,1,'collar width','edge','drag its edge','narrow → wide');
  if(/^tier /.test(p.name)){add('length',.5,1,'y',20,62,1,'garment length','hem','drag the hem','longer · shorter');add('tierRatio',1,0,'x',1.05,2,.025,'gather join','top','drag the top corner out','flat → gathered');}
  add('grain',.5,.6,'x',0,45,2,'grain','grain','drag the grain arrow','straight → bias');
  return out;
}
export class PatternTable {
  selected = ''; laid: Laid[]=[]; handles:Handle[]=[];
  drag: null | {h:Handle;x:number;y:number;value:number;layout:Laid[];before:Design}=null;
  constructor(public cv:HTMLCanvasElement, private get:()=>{g:Garment;d:Design}, private change:(key:keyof Design,value:number,commit:boolean,target:string)=>void) {}
  draw(pr:Print|null,k:number) {
    const {g,d}=this.get(), all=g.pieces.filter(p=>p.drawn!==false);
    if(this.selected && !all.some(p=>p.name===this.selected)) this.selected='';
    const display=this.selected ? {...g,pieces:g.pieces.filter(p=>p.name===this.selected)} : g;
    this.laid=drawSheet(this.cv,display,pr,false,{bare:true,width:this.cv.clientWidth*.94,frozen:this.drag?.layout});
    const ctx=this.cv.getContext('2d')!, dpr=this.cv.width/this.cv.clientWidth;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);this.handles=[];
    if(this.selected) for(const l of this.laid){
      const p=l.piece, at=(u:number,v:number)=>l.to(p.flat(u,v)).map(x=>x*dpr) as [number,number];
      for(const s of edgesOf(p,d)){const [x,y]=at(s.u,s.v);this.handles.push({piece:p.name,edge:s.edge,key:s.key,x,y,axis:s.axis,lo:s.lo,hi:s.hi,gain:s.gain/(l.sc*dpr),label:s.label});}
    }
    const R=18*Math.max(.5,k);
    for(const h of this.handles){ctx.fillStyle='#fffaf0';ctx.strokeStyle='#b13f59';ctx.lineWidth=2*Math.max(.5,k);ctx.beginPath();ctx.arc(h.x,h.y,R,0,7);ctx.fill();ctx.stroke();ctx.fillStyle='#883044';ctx.font=`${18*Math.max(.5,k)}px sans-serif`;ctx.textAlign='center';ctx.fillText(h.axis==='x'?'↔':'↕',h.x,h.y+6*Math.max(.5,k));}
    if(this.drag){const h=this.drag.h, value=Number(d[h.key]);ctx.font=`600 ${19*k}px sans-serif`;ctx.fillStyle='#42342a';const msg=`${h.label}: ${value.toFixed(1)}${h.key==='grain'?'°':''}`;const w=ctx.measureText(msg).width;const x=Math.max(w/2+12,Math.min(this.cv.width-w/2-12,h.x));const y=Math.max(38*k,h.y-44*k);ctx.fillRect(x-w/2-10*k,y-24*k,w+20*k,34*k);ctx.fillStyle='#fffaf0';ctx.fillText(msg,x,y);}
    ctx.restore();return this.laid;
  }
  down(q:[number,number],k:number):boolean{
    const h=this.handles.reduce<Handle|null>((best,h)=>Math.hypot(q[0]-h.x,q[1]-h.y)<28*k && (!best||Math.hypot(q[0]-h.x,q[1]-h.y)<Math.hypot(q[0]-best.x,q[1]-best.y))?h:best,null);
    if(h){this.drag={h,x:q[0],y:q[1],value:Number(this.get().d[h.key]),layout:this.laid,before:structuredClone(this.get().d)};return true;}
    // A tap anywhere inside a piece selects it; no geometry changes until a handle is dragged.
    const dpr=this.cv.width/this.cv.clientWidth;
    for(const l of this.laid){const pts=Array.from({length:25},(_,i)=>[i/24,0] as [number,number]).concat(Array.from({length:25},(_,i)=>[1,i/24] as [number,number]),Array.from({length:25},(_,i)=>[1-i/24,1] as [number,number]),Array.from({length:25},(_,i)=>[0,1-i/24] as [number,number])).map(([u,v])=>l.to(l.piece.flat(u,v)).map(x=>x*dpr));let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],b=pts[j];if((a[1]>q[1])!==(b[1]>q[1])&&q[0]<(b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}if(inside){this.selected=l.piece.name;return true;}}
    return false;
  }
  move(q:[number,number]){if(!this.drag)return;const w=this.drag,h=w.h,delta=h.axis==='x'?q[0]-w.x:q[1]-w.y;const value=Math.max(h.lo,Math.min(h.hi,Math.round((w.value+delta*h.gain)*100)/100));this.change(h.key,value,false,`${h.piece}/${h.edge}`);}
  up(cancel=false){const w=this.drag;if(!w)return;this.drag=null;this.change(w.h.key,cancel?w.value:Number(this.get().d[w.h.key]),!cancel,`${w.h.piece}/${w.h.edge}`);}
}
