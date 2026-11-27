import {signal,interval,shape,evaluate,compatible,OPS,isMark,isInstrument,type Mark,type Instrument,type Artifact,type Op,type Unit} from './world';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const plot=document.getElementById('plot') as unknown as SVGSVGElement;
const preview=new URLSearchParams(location.search).has('preview');
const id=()=>crypto.randomUUID().replace(/-/g,'');
const read=<T>(key:string,fallback:T):T=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}};
let inhabitant=read('truthmine.actor.v1','');if(!inhabitant){inhabitant=id();if(!preview)try{localStorage.setItem('truthmine.actor.v1',JSON.stringify(inhabitant))}catch{}}
let room=new URLSearchParams(location.hash.slice(1)).get('room')||'';if(!/^[a-f0-9]{32}$/.test(room))room='';
let local=read<Artifact[]>('truthmine.local.v1',[]),shared:Artifact[]=[],selected:string[]=[],picked:string[]=[],applying=false,active='',lens:'use'|'enter'='use',bindings:string[]=[],slot=-1;
let running=true,end=0,fixed=0,lastDraw=0,dirty=true,span=36;
const epoch=Date.UTC(2026,10,27),now=()=>Math.max(0,(Date.now()-epoch)/1000),head=()=>running?now():fixed;
const left=24,right=616,mid=150,scale=105;
const all=()=>room?shared:local;
const actorLabel=(s:string)=>s===inhabitant?'you':'inhabitant '+s.slice(0,4);
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const fmt=(n:number|null,unit:Unit='s')=>n===null?'undefined':(Math.abs(n)>=1e6?n.toExponential(2):n.toFixed(2))+(unit==='s'?' s':unit==='amplitude'?' u':'');
const status=(s:string,error=false)=>{$('status').textContent=s;$('status').classList.toggle('error',error)};
const roomURL=(r:string)=>'/truthmine/api/'+r;
let syncing=false;
async function sync(){if(!room||preview||syncing||applying)return false;const r=room;syncing=true;try{const res=await fetch(roomURL(r),{cache:'no-store'});if(!res.ok)throw Error('Room unavailable');const data=await res.json();if(room!==r)return false;const fresh=data.artifacts as Artifact[];if(JSON.stringify(fresh)!==JSON.stringify(shared)){shared=fresh;selected=selected.filter(k=>shared.some(a=>a.id===k));renderWork()}status('Shared room · '+shared.length+' objects');return true}catch{if(room===r)status('Room unavailable. Try again before contributing.',true);return false}finally{syncing=false}}
async function add(a:Artifact):Promise<boolean>{if(applying||preview)return false;applying=true;const r=room;try{if(r){const res=await fetch(roomURL(r),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a)});const d=await res.json();if(!res.ok)throw Error(d.error||'Could not save: '+res.status);if(room!==r)return false;shared=d.artifacts;status('Saved in shared room')}else{const next=[...local,a];localStorage.setItem('truthmine.local.v1',JSON.stringify(next));local=next;status('Saved in this browser')}renderWork();return true}catch(e){status((e as Error).message,true);return false}finally{applying=false}}
function stop(){if(running){fixed=head();running=false;$('pause').textContent='Resume'}$('back').hidden=false;$('forward').hidden=false;$('live').hidden=false;dirty=true}
function resume(){running=true;$('pause').textContent='Pause';$('back').hidden=true;$('forward').hidden=true;$('live').hidden=true;dirty=true}
function fitMarks(ids:string[]){const ts=ids.map(k=>all().find(x=>x.id===k)).filter(isMark).map(x=>x.t);if(!ts.length)return;stop();const lo=Math.min(...ts),hi=Math.max(...ts);span=Math.max(36,(hi-lo)*1.2);fixed=hi+span*.08;dirty=true}
function draw(time:number){requestAnimationFrame(draw);if(document.hidden||(!running&&!dirty)||time-lastDraw<50)return;lastDraw=time;dirty=false;end=head();const begin=end-span,x=(t:number)=>left+(t-begin)/span*(right-left),y=(t:number)=>mid-signal(t)*scale;
let path='';const n=Math.min(1800,Math.max(260,Math.ceil(span*10)));for(let k=0;k<=n;k++){const t=begin+k/n*span;path+=(k?'L':'M')+x(t).toFixed(1)+' '+y(t).toFixed(1)+' '}
let s='<path d="M24 150 H616" stroke="#c4c9bb" stroke-dasharray="2 5"/><path d="'+path+'" fill="none" stroke="#315f51" stroke-width="2" vector-effect="non-scaling-stroke"/>';
for(const a of all())if(isMark(a)&&a.t>=begin&&a.t<=end){const sel=selected.includes(a.id)||bindings.includes(a.id);s+='<path d="M'+x(a.t)+' 25 V275" stroke="'+(sel?'#a34827':'#9a9f91')+'" stroke-dasharray="3 5"/><circle cx="'+x(a.t)+'" cy="'+y(a.t)+'" r="'+(sel?8:5)+'" fill="'+(sel?'#a34827':'#f3f1e7')+'" stroke="#a34827" stroke-width="2"/>'}
const pair=selected.map(k=>all().find(a=>a.id===k)).filter(isMark);
if(pair.length===2&&pair.every(a=>a.t>=begin&&a.t<=end)){const a=x(pair[0].t),b=x(pair[1].t);s+='<path d="M'+a+' 18 V8 H'+b+' V18" fill="none" stroke="#a34827"/><text x="'+((a+b)/2)+'" y="38" text-anchor="middle" font-size="13" fill="#a34827">'+fmt(interval(pair[0],pair[1]))+'</text>'}
s+='<text x="24" y="294" font-size="10" fill="#627069">−'+span.toFixed(0)+' s</text><text x="616" y="294" text-anchor="end" font-size="10" fill="#627069">'+(running?'now':'view end')+'</text>';
plot.innerHTML=s}
function attend(k:string){stop();if(slot>=0&&active){bindings[slot]=k;slot=-1}else selected=selected.includes(k)?selected.filter(x=>x!==k):[...selected.slice(-1),k];const m=all().find(a=>a.id===k);if(isMark(m)&&(m.t<fixed-span||m.t>fixed)){fixed=m.t+span/2}renderWork()}
async function mark(t:number){stop();const m:Mark={kind:'mark',id:id(),by:inhabitant,at:Date.now(),t:Math.round(t*100)/100};if(await add(m))attend(m.id)}
function openInstrument(i:Instrument,view:'use'|'enter'){active=i.id;lens=view;bindings=[...i.marks];slot=-1;fitMarks(bindings);renderWork()}
function titleOf(i:Instrument){return i.name||OPS[i.op].label}
function explain(i:Instrument,items:Artifact[],depth=0):string{if(depth>4)return '';const s=shape(i,items);if(!s)return '<p>Unresolved definition</p>';let h='<div class="branch"><div class="small">'+esc(OPS[i.op].formula)+' · '+esc(s.unit)+'</div><strong>'+esc(titleOf(i))+'</strong>';if(i.parts)for(const k of i.parts){const child=items.find(a=>a.id===k);if(isInstrument(child))h+=explain(child,items,depth+1)}else h+='<div class="small">↳ first moment · second moment</div>';return h+'</div>'}
function renderWork(){
 dirty=true;const items=all(),marks=items.filter(isMark),instruments=items.filter(isInstrument),pair=selected.map(k=>marks.find(m=>m.id===k)).filter(isMark),chosen=picked.map(k=>instruments.find(i=>i.id===k)).filter(isInstrument);
 const traceName=(k:string)=>{const n=marks.findIndex(m=>m.id===k);return n<0?'missing':'trace '+(n+1)};
 $('intro').textContent=marks.length?'A trace is something you can return to.':'Watch for a little while.';
 $('hint').textContent=slot>=0?'Choose an existing trace, or touch the signal to make a new one for this input.':marks.length?(pair.length===2?'Two moments are held in attention.':'Touch the curve to mark another moment, or select a trace.'):'Touch the line where something catches your attention.';
 const w=$('work');if(!marks.length&&!instruments.length){w.innerHTML='';return}
 let s='<section><div class="row"><h2>Traces</h2><span class="spacer"></span><span class="small">'+marks.length+' observations</span></div><div class="row trace-list">'+marks.map((m,i)=>'<button data-select="'+m.id+'" '+(selected.includes(m.id)?'class="primary"':'')+' aria-pressed="'+selected.includes(m.id)+'">'+(i+1)+' · '+esc(actorLabel(m.by))+'</button>').join('')+'</div>';
 if(pair.length===2)s+='<article><div class="small">TWO MOMENTS</div><div class="row reading"><div><small>Time between</small><div class="measure">'+fmt(interval(pair[0],pair[1]))+'</div></div><div><small>Change in height</small><div class="measure">'+fmt(signal(pair[1].t)-signal(pair[0].t),'amplitude')+'</div></div></div><div class="row"><button data-create="interval" class="primary">Keep interval ruler</button><button data-create="change">Keep change measure</button></div></article>';
 s+='</section>';
 if(instruments.length){s+='<section><h2>Instruments</h2><p class="small">Use one, or select two to compose. These are made by inhabitants, not unlocks.</p><div class="instrument-grid">';
 for(const i of instruments){const sh=shape(i,items),v=evaluate(i,items);s+='<article class="'+(picked.includes(i.id)?'chosen':'')+'"><div class="small">'+esc(actorLabel(i.by))+' · '+esc(OPS[i.op]?.label||i.op)+'</div><strong>'+esc(titleOf(i))+'</strong><div class="measure">'+fmt(v,sh?.unit)+'</div><div class="row"><button data-use="'+i.id+'">Use</button><button data-enter="'+i.id+'">Enter</button><button data-pick="'+i.id+'" aria-pressed="'+picked.includes(i.id)+'">'+(picked.includes(i.id)?'Selected ✓':'Select')+'</button></div></article>'}
 s+='</div>';
 if(chosen.length===2){const ok=compatible(chosen[0],chosen[1],items);s+='<article class="chosen"><div class="small">COMPOSE / A AND B</div><p>'+esc(titleOf(chosen[0]))+' <span class="tag">＋</span> '+esc(titleOf(chosen[1]))+'</p>';
 if(ok)s+='<div class="row">'+(['mean','difference','ratio','sum'] as Op[]).map(op=>'<button data-combine="'+op+'">'+OPS[op].label+'</button>').join('')+'</div><p class="small">Each constituent retains its own definition. The new instrument has inputs of its own.</p>';
 else s+='<p>These instruments do not share a compatible quantity, or the composition exceeds this prototype’s depth limit.</p>';s+='</article>'}
 const i=instruments.find(x=>x.id===active);if(i){const sh=shape(i,items);if(sh){const changed=JSON.stringify(bindings)!==JSON.stringify(i.marks);s+='<article class="bench" id="bench"><div class="row"><span class="small">OPEN INSTRUMENT</span><span class="spacer"></span><button data-close>Close</button></div><h2>'+esc(titleOf(i))+'</h2><div class="row"><button data-lens="use" '+(lens==='use'?'class="primary"':'')+'>Use</button><button data-lens="enter" '+(lens==='enter'?'class="primary"':'')+'>Constitution</button></div><div class="measure">'+fmt(evaluate(i,items,bindings),sh.unit)+'</div>';
 if(lens==='enter'){s+='<p>'+esc(OPS[i.op].description)+'</p>'+explain(i,items);if(i.derivedFrom)s+='<p class="small">Forked from '+esc(titleOf(instruments.find(x=>x.id===i.derivedFrom)??i))+'</p>'}
 s+='<div class="slots">'+sh.slots.map((label,k)=>'<button class="'+(slot===k?'primary':'')+'" data-slot="'+k+'"><small>'+esc(label)+'</small><span>'+esc(traceName(bindings[k]))+' ↗</span></button>').join('')+'</div><p class="small">'+(slot>=0?'Select a trace above or mark a new moment on the signal.':'Change an input to try the same definition on different observations.')+'</p><div class="row"><button data-fit>See inputs on signal</button><button data-reset '+(!changed?'disabled':'')+'>Restore</button><button data-fork class="primary" '+(!changed?'disabled':'')+'>Keep variation</button></div>';
 if(i.op==='interval')s+='<p class="small">An interval is not necessarily a period. That interpretation needs evidence.</p>';s+='</article>'}}
 s+='</section>'}
 w.innerHTML=s;
}
async function create(op:Op,marks:string[],parts?:[string,string],from?:Instrument){const a:Instrument={id:id(),by:inhabitant,at:Date.now(),kind:'instrument',op,name:from?from.name:OPS[op].label+(op==='interval'?' ruler':''),marks,...(parts?{parts}:{}),...(from?{derivedFrom:from.id}:{})};if(await add(a)){picked=[];openInstrument(a,'use')}}
function roomInfo(){$('roomInfo').textContent=(room?'Shared room · ':'Local notebook · ')+'inhabitant '+inhabitant.slice(0,4);$('copy').hidden=!room;$('share').textContent=room?'Leave room':'Open a shared room'}
function resetView(){selected=[];picked=[];active='';bindings=[];slot=-1;span=36;resume();renderWork()}
if(preview){document.body.classList.add('preview');local=[];room=''}else{
 let down:{x:number;y:number}|null=null;plot.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY}});plot.addEventListener('pointercancel',()=>down=null);
 plot.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>14){down=null;return}down=null;const rect=plot.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*640;if(x<left||x>right)return;const t=end-span+(x-left)/(right-left)*span;const near=all().filter(isMark).filter(m=>Math.abs(m.t-t)/span*(right-left)<12).sort((a,b)=>Math.abs(a.t-t)-Math.abs(b.t-t))[0];if(near)attend(near.id);else void mark(t)});
 $('pause').onclick=()=>running?stop():resume();$('mark').onclick=()=>void mark(head()-2);$('back').onclick=()=>{stop();fixed-=span/2;dirty=true};$('forward').onclick=()=>{stop();fixed+=span/2;dirty=true};$('live').onclick=()=>{span=36;resume()};
 $('work').addEventListener('click',e=>{const b=(e.target as HTMLElement).closest('button');if(!b||b.disabled||applying)return;const d=b.dataset,items=all(),i=items.find(a=>a.id===active);
 if(d.select){attend(d.select);return}
 if(d.create){void create(d.create as Op,[...selected]);return}
 if(d.pick){picked=picked.includes(d.pick)?picked.filter(k=>k!==d.pick):[...picked.slice(-1),d.pick];renderWork();return}
 if(d.combine){const a=items.find(x=>x.id===picked[0]),z=items.find(x=>x.id===picked[1]);if(isInstrument(a)&&isInstrument(z)&&compatible(a,z,items))void create(d.combine as Op,[...a.marks,...z.marks],[a.id,z.id]);return}
 if(d.use||d.enter){const a=items.find(x=>x.id===(d.use||d.enter));if(isInstrument(a))openInstrument(a,d.enter?'enter':'use');return}
 if(d.close!==undefined){active='';bindings=[];slot=-1;renderWork();return}
 if(!isInstrument(i))return;
 if(d.lens){lens=d.lens==='enter'?'enter':'use';renderWork()}
 if(d.slot!==undefined){slot=slot===Number(d.slot)?-1:Number(d.slot);renderWork();if(slot>=0)plot.scrollIntoView({block:'center',behavior:'smooth'})}
 if(d.fit!==undefined){fitMarks(bindings);plot.scrollIntoView({block:'center',behavior:'smooth'})}
 if(d.reset!==undefined){bindings=[...i.marks];slot=-1;renderWork()}
 if(d.fork!==undefined)void create(i.op,[...bindings],i.parts,i);
 });
 $('share').onclick=async()=>{if(applying)return;if(room){room='';shared=[];history.replaceState(null,'',location.pathname+location.search);roomInfo();resetView();status('Local notebook');return}room=id();history.replaceState(null,'',location.pathname+location.search+'#room='+room);roomInfo();resetView();if(await sync())status('Invitation ready. Local traces stay local.')};
 $('copy').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);status('Invitation copied')}catch{status('Copy this page address from the browser.')}};
 $('newIdentity').onclick=()=>{if(applying)return;inhabitant=id();try{localStorage.setItem('truthmine.actor.v1',JSON.stringify(inhabitant))}catch{}roomInfo();resetView()};
 roomInfo();renderWork();void sync();setInterval(()=>{if(room&&!document.hidden)void sync()},6000);
}
requestAnimationFrame(draw);
