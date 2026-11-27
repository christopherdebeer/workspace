import {SEEDS,entities,isEntity,isContainer,refs,title,names,accept,type Fact,type Entity} from './world';
import {Recorder,type Frame} from './trace';
import {observe} from './observer';
const $=(id:string)=>document.getElementById(id)!;
const svg=$('field') as unknown as SVGSVGElement;
const preview=new URLSearchParams(location.search).has('preview');
if(preview)document.body.classList.add('preview');
const uid=()=>crypto.randomUUID().replace(/-/g,'');
function read<T>(key:string,d:T):T{try{return JSON.parse(localStorage.getItem(key)||'null')??d}catch{return d}}
function store(key:string,v:unknown){try{localStorage.setItem(key,JSON.stringify(v));return true}catch{return false}}
let actor=read('things.actor.v1','');if(!actor){actor=uid();if(!preview)store('things.actor.v1',actor)}
let room=new URLSearchParams(location.hash.slice(1)).get('room')||'';if(!/^[a-f0-9]{32}$/.test(room)||preview)room='';
let local=preview?[]:read<Fact[]>('things.local.v1',[]),remote:Fact[]=[];
const facts=()=>room?remote:local;
const all=()=>entities(facts());
const get=(k:string)=>all().find(e=>e.id===k);
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const who=(s:string)=>s==='world'?'shared beginning':s===actor?'you':'inhabitant '+s.slice(0,4);
const label=(e:Entity)=>title(e,facts(),actor);
type Pt={x:number;y:number};
type View={shown:string[];hidden:string[];pos:Record<string,Pt>};
type Notebook=Record<string,View>;
let notebook:Notebook={},stack:string[]=[],selected:string[]=[],linkFrom='',nameTarget='',busy=false,syncing=false,W=640,H=440;
const ctx=()=>stack[stack.length-1]||'root';
const notebookKey=()=>['things.view.v1',room||'local',actor].join('.');
function loadView(){notebook=preview?{}:read<Notebook>(notebookKey(),{});stack=[];selected=[];linkFrom='';nameTarget=''}
function view():View{const k=ctx();return notebook[k]??(notebook[k]={shown:[],hidden:[],pos:{}})}
function saveView(){if(!preview)store(notebookKey(),notebook)}
function defaults(){if(ctx()==='root')return SEEDS.map(x=>x.id);const e=get(ctx());return e?refs(e):[]}
function visible(){const v=view(),ids=[...new Set([...defaults(),...v.shown])].filter(k=>!v.hidden.includes(k)&&get(k));return ids}
function show(k:string){const v=view();v.hidden=v.hidden.filter(x=>x!==k);if(!v.shown.includes(k)&&!defaults().includes(k))v.shown.push(k)}
function hide(ids:string[]){const v=view();for(const k of ids)if(!v.hidden.includes(k))v.hidden.push(k)}
function pos(k:string):Pt{const v=view();if(v.pos[k])return v.pos[k];const ids=visible().filter(id=>get(id)?.kind!=='relation');const n=ids.indexOf(k);if(ctx()==='root'&&k.startsWith('seed-')){const p=[{x:.25,y:.31},{x:.76,y:.38},{x:.46,y:.73}][SEEDS.findIndex(x=>x.id===k)];if(p)return p}
 const ix=n<0?visible().indexOf(k):n;const angle=ix*2.399963;const r=.10+.30*Math.sqrt((ix%30+1)/30);return {x:.5+r*Math.cos(angle),y:.5+r*Math.sin(angle)}}
function point(k:string,seen:string[]=[]):Pt{const e=get(k);if(!e||seen.includes(k))return pos(k);if(e.kind==='relation'&&e.ends.every(x=>visible().includes(x))){const a=point(e.ends[0],[...seen,k]),b=point(e.ends[1],[...seen,k]);return{x:(a.x+b.x)/2,y:(a.y+b.y)/2}}return pos(k)}
const clamp=(n:number)=>Math.max(.065,Math.min(.935,n));
const px=(p:Pt)=>({x:p.x*W,y:p.y*H});
let drag:{id?:string;start:Pt;at:Pt;path:Pt[];moved:boolean;link:boolean;began:number}|null=null;
function coords(e:PointerEvent):Pt{const r=svg.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height}}
function inside(p:Pt,poly:Pt[]){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes}return yes}
function glyph(e:Entity,x:number,y:number,chosen:boolean){const c=chosen?'#a44b34':'#315f51',fill=chosen?'#d4a98f':'#dce5d7';let g='';
 if(e.kind==='thing'){g=e.form==='square'?'<rect x="-14" y="-14" width="28" height="28" rx="1"/>':e.form==='triangle'?'<path d="M0 -17 L17 13 H-17Z"/>':'<circle r="16"/>'}
 else if(e.kind==='relation')g='<path d="M0 -9 L9 0 L0 9 L-9 0Z"/>';
 else if(e.kind==='collection')g='<circle r="18" stroke-dasharray="3 3"/><circle cx="-6" cy="-3" r="3"/><circle cx="7" cy="-3" r="3"/><circle cy="8" r="3"/>';
 else g='<circle r="22"/><circle cx="-7" cy="-5" r="3" fill="'+c+'"/><circle cx="7" cy="-5" r="3" fill="'+c+'"/><circle cy="8" r="3" fill="'+c+'"/>';
 const named=names(e.id,facts()).length>0;
 const text=named?label(e):e.kind==='thing'?'':e.kind==='relation'?'':e.kind==='collection'?'collection':'composition';
 const rr=e.kind==='relation'?15:25;
 return '<g transform="translate('+x+' '+y+')" data-id="'+e.id+'" role="button" tabindex="0" aria-label="'+esc(label(e))+'" aria-pressed="'+chosen+'"><circle r="'+rr+'" fill="transparent" stroke="none"/><g fill="'+fill+'" stroke="'+c+'" stroke-width="1.7">'+g+'</g>'+(chosen?'<circle r="'+(rr+4)+'" fill="none" stroke="'+c+'" stroke-dasharray="3 4"/>':'')+(linkFrom===e.id?'<circle r="'+(rr+8)+'" fill="none" stroke="#a44b34" stroke-width="2"/>':'')+(text?'<text y="'+(rr+12)+'" text-anchor="middle" fill="#27302d" font-size="12">'+esc(text.length>24?text.slice(0,23)+'…':text)+'</text>':'')+'</g>';
}
function draw(){
 const ids=visible(),nodes=ids.map(get).filter((e):e is Entity=>!!e);let out='';
 for(const e of nodes)if(e.kind==='collection'){
 const pts=e.members.filter(k=>ids.includes(k)).map(k=>px(point(k)));if(pts.length<2)continue;
 const x=Math.max(4,Math.min(...pts.map(p=>p.x))-35),y=Math.max(4,Math.min(...pts.map(p=>p.y))-35),r=Math.min(W-4,Math.max(...pts.map(p=>p.x))+35),b=Math.min(H-4,Math.max(...pts.map(p=>p.y))+35);
 out+='<rect x="'+x+'" y="'+y+'" width="'+(r-x)+'" height="'+(b-y)+'" rx="32" fill="#8ea58e" fill-opacity=".075" stroke="#82998e" stroke-dasharray="5 5" pointer-events="none"/>';
 }
 for(const e of nodes)if(e.kind==='relation'&&e.ends.every(k=>ids.includes(k))){const a=px(point(e.ends[0])),b=px(point(e.ends[1]));out+='<path d="M'+a.x+' '+a.y+' L'+b.x+' '+b.y+'" stroke="'+(selected.includes(e.id)?'#a44b34':'#87988c')+'" stroke-width="'+(selected.includes(e.id)?2:1.3)+'" fill="none" pointer-events="none"/>'}
 for(const e of [...nodes.filter(e=>e.kind!=='relation'),...nodes.filter(e=>e.kind==='relation')]){const p=px(point(e.id));out+=glyph(e,p.x,p.y,selected.includes(e.id))}
 if(drag&&drag.moved&&!drag.id&&drag.path.length>1){out+='<polyline points="'+drag.path.map(p=>{const a=px(p);return a.x+','+a.y}).join(' ')+'" stroke="#a44b34" fill="none" stroke-width="1.4" stroke-dasharray="4 3" pointer-events="none"/>'}
 if(drag?.link&&drag.moved&&drag.id){const a=px(point(drag.id)),b=px(drag.at);out+='<path d="M'+a.x+' '+a.y+' L'+b.x+' '+b.y+'" stroke="#a44b34" stroke-width="1.8" stroke-dasharray="4 3" pointer-events="none"/>'}
 svg.innerHTML=out;svg.setAttribute('viewBox','0 0 '+W+' '+H);
}
const btn=(action:string,text:string,extra='',key='')=>'<button data-action="'+action+'" '+(key?'data-key="'+key+'" ':'')+extra+'>'+esc(text)+'</button>';
function status(s:string,error=false){$('status').textContent=s;$('status').classList.toggle('error',error)}
function info(){$('roomInfo').textContent=(room?'Shared room':'Local notebook')+' · inhabitant '+actor.slice(0,4);$('copy').hidden=!room;$('share').textContent=room?'Leave room':'Open shared room'}
function render(){
 const ids=visible();selected=selected.filter(k=>ids.includes(k));const picked=selected.map(get).filter((e):e is Entity=>!!e),e=picked.length===1?picked[0]:undefined;
 const container=get(ctx());
 $('heading').textContent=container?label(container):ids.length===3&&facts().length===0?'Three things.':'A field of things.';
 $('crumbs').innerHTML=btn('root','Field','class="quiet"')+stack.map((k,i)=>'<span class="mono">/</span>'+btn('crumb',label(get(k)!), 'class="quiet"',String(i))).join('');
 $('hint').textContent=linkFrom?'Touch another thing to relate them; or drag from the selected thing.':picked.length===0?'Touch a thing. Drag it to arrange your view. Draw a loop around several.':picked.length===1?'One thing in attention. Touch another to consider them together.':picked.length+' things in attention. A collection keeps them together; a composition makes a new thing.';
 let tools='';
 if(!picked.length)tools=btn('new','Introduce a thing')+(ctx()!=='root'?btn('out','Return'):'');
 else{
 if(picked.length===1){tools+=btn('link',linkFrom?'Cancel relation':'Relate…',linkFrom?'class="active"':'');if(e&&(isContainer(e)||e.kind==='relation'))tools+=btn('enter','Enter','class="primary"');tools+=btn('name','Name…');if(e?.kind==='collection')tools+=btn('fromCollection','Compose collection');if(isContainer(e))tools+=btn('unfold','Expose constituents')}
 if(picked.length===2)tools+=btn('relate','Relate');
 if(picked.length>=2)tools+=btn('group','Group')+btn('compose','Compose','class="primary"');
 tools+=btn('hide','Hide here','class="quiet"')+btn('clear','Clear','class="quiet"');
 }
 $('toolbar').innerHTML=tools;
 const inspector=$('inspector');
 inspector.hidden=!e;
 if(e){
 const ns=names(e.id,facts()),members=refs(e);
 const desc=e.kind==='thing'?'An identity, independent of its position.':e.kind==='relation'?'A relation has its own identity. It does not prescribe what the connection means.':e.kind==='collection'?'A named context of shared things; the members remain independent.':'A new thing constituted from other things. Its members remain independently addressable.';
 inspector.innerHTML='<div class="panel"><div class="row"><small>'+esc(e.kind.toUpperCase())+' · '+esc(who(e.by))+'</small><span class="spacer"></span><small>'+esc(e.id.slice(0,8))+'</small></div><h2>'+esc(label(e))+'</h2><p>'+desc+'</p>'+(members.length?'<div class="row" style="margin-top:8px">'+members.map(k=>{const m=get(k);return m?btn('reveal',label(m),'class="chip"',k):''}).join('')+'</div>':'')+(ns.length?'<div id="names"><small>Names contributed by inhabitants</small>'+ns.map(n=>'<p>'+esc(n.text)+' <small>· '+esc(who(n.by))+'</small></p>').join('')+'</div>':'')+(nameTarget===e.id?'<form id="nameForm" class="row" style="margin-top:9px"><input id="nameInput" maxlength="64" placeholder="A name for this thing" aria-label="A name for this thing" required><button class="primary" type="submit">Keep name</button><button type="button" data-action="cancelName">Cancel</button></form>':'')+'</div>';
 }
 const hidden=all().filter(x=>!ids.includes(x.id)&&x.id!==ctx());
 // Contextual adjacency, never a score or an automatic rearrangement. The rest is reachable on demand.
 const adjacent=hidden.filter(x=>refs(x).some(k=>ids.includes(k)||k===ctx())||ids.some(k=>{const e=get(k);return !!e&&refs(e).includes(x.id)}));
 const tucked=hidden.filter(x=>view().hidden.includes(x.id));
 const offered=[...new Map([...adjacent,...tucked,...hidden].map(x=>[x.id,x])).values()];
 $('nearby').hidden=!hidden.length;
 $('nearHint').textContent=hidden.length+' other '+(hidden.length===1?'thing':'things')+' · '+adjacent.length+' connected to this view. Reveal without changing the shared world.';
 $('nearItems').innerHTML=offered.map(x=>btn('reveal',label(x)+' · '+who(x.by),'class="chip"',x.id)).join('');
 draw();
}
async function sync(){if(!room||syncing||busy||preview)return false;syncing=true;const r=room;try{const res=await fetch('/things/api/'+r,{cache:'no-store'});if(!res.ok)throw Error('Shared room unavailable');const d=await res.json();if(room!==r)return false;if(JSON.stringify(remote)!==JSON.stringify(d.facts)){remote=d.facts;if(!nameTarget&&!drag)render()}status('Shared room · '+remote.length+' contributions');return true}catch(e){if(room===r)status((e as Error).message,true);return false}finally{syncing=false}}
async function add(raw:Record<string,unknown>){if(busy||preview)return null;busy=true;const r=room;const f=accept({id:uid(),by:actor,...raw},facts(),Date.now());if(!f){busy=false;status('This contribution is not valid.',true);return null}try{if(r){const res=await fetch('/things/api/'+r,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f)});const d=await res.json();if(!res.ok)throw Error(d.error||'Unable to save');if(room!==r)return null;remote=d.facts;status('Kept in the shared world')}else{const next=[...local,f];if(!store('things.local.v1',next))throw Error('Local storage unavailable');local=next;status('Kept in this browser')}return f}catch(e){status((e as Error).message,true);return null}finally{busy=false}}
function choose(k:string){if(linkFrom){if(k!==linkFrom)void relate([linkFrom,k]);else{linkFrom='';render()}return}const had=selected.includes(k);selected=had?selected.filter(x=>x!==k):[...selected,k];nameTarget='';render();trace(had?'deselect':'select',{target:k})}
async function relate(ends:string[]){if(ends.length!==2)return;const existing=all().find(e=>e.kind==='relation'&&e.ends.includes(ends[0])&&e.ends.includes(ends[1]));if(existing){show(existing.id);selected=[existing.id];linkFrom='';saveView();render();trace('reveal',{target:existing.id});return}const f=await add({kind:'relation',ends});if(f&&isEntity(f)){show(f.id);selected=[f.id];linkFrom='';saveView();render();trace('contribution',{target:f.id,factKind:'relation'})}}
async function construct(kind:'collection'|'composition',members:string[],from?:string){const ps=members.map(k=>point(k)),center={x:ps.reduce((s,p)=>s+p.x,0)/ps.length,y:ps.reduce((s,p)=>s+p.y,0)/ps.length};const f=await add({kind,members,...(from?{from}:{})});if(!f)return;show(f.id);view().pos[f.id]=kind==='collection'?{x:clamp(center.x),y:clamp(Math.min(...ps.map(p=>p.y))-.13)}:center;if(kind==='composition')hide(from?[...members,from]:members);selected=[f.id];linkFrom='';saveView();render();trace('contribution',{target:f.id,factKind:kind})}
function enter(k:string){const e=get(k);if(!e||!(isContainer(e)||e.kind==='relation'))return;stack.push(k);selected=[];linkFrom='';nameTarget='';render();trace('enter',{target:k})}
function navigate(n:number){stack=stack.slice(0,n);selected=[];linkFrom='';nameTarget='';render();trace('return')}
function reveal(k:string){show(k);selected=[k];nameTarget='';saveView();render();trace('reveal',{target:k})}
function reset(){notebook={};stack=[];selected=[];linkFrom='';nameTarget='';saveView();render();trace('reset')}
function resize(){const r=svg.getBoundingClientRect();W=Math.max(200,r.width);H=Math.max(200,r.height);draw()}
function capture(kind:string,extra:Partial<Frame>={}):Frame{return {kind,ms:0,context:ctx(),selected:[...selected],nodes:visible().slice(0,160).map(k=>{const e=get(k)!,p=point(k);return{id:k,kind:e.kind,x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y)),refs:refs(e),...(e.kind==='thing'&&e.form?{form:e.form}:{})}}),...extra}}
function recordUI(){const has=!!rec.keys;$('recordStart').hidden=has;$('recordStart').toggleAttribute('disabled',rec.busy);$('recordStop').hidden=!has;$('recordStop').toggleAttribute('disabled',rec.busy);$('recordCopy').hidden=!has;$('recordDelete').hidden=!has;$('recordDelete').toggleAttribute('disabled',rec.busy);$('recordLight').hidden=!rec.active;$('recordQuickStop').toggleAttribute('disabled',rec.busy);$('recordStatus').textContent=rec.error|| (rec.active?'Recording · '+rec.count+' saved events':has?'Recording held · '+rec.count+' events saved this page. Stop to close, copy to share, or delete.':'Not recording.')}
const rec=new Recorder(capture,recordUI);
const trace=(kind:string,extra:Partial<Frame>={})=>rec.record(kind,extra);
const observeToken=new URLSearchParams(location.hash.slice(1)).get('observe');
if(!preview&&observeToken&&/^[a-f0-9]{32}$/.test(observeToken)){observe(observeToken)}else{
loadView();info();render();new ResizeObserver(resize).observe(svg);
if(!preview){
 svg.addEventListener('pointerdown',e=>{if(e.button!==0||busy)return;const id=(e.target as Element).closest('[data-id]')?.getAttribute('data-id')||undefined;const p=coords(e);drag={id,start:p,at:p,path:[p],moved:false,link:!!id&&linkFrom===id,began:performance.now()};svg.setPointerCapture(e.pointerId)});
 svg.addEventListener('pointermove',e=>{if(!drag)return;const p=coords(e);drag.at=p;if(Math.hypot((p.x-drag.start.x)*W,(p.y-drag.start.y)*H)>7)drag.moved=true;if(!drag.moved)return;if(drag.id&&!drag.link){const entity=get(drag.id);if(entity?.kind!=='relation'||!entity.ends.every(k=>visible().includes(k)))view().pos[drag.id]={x:clamp(p.x),y:clamp(p.y)}}else if(!drag.id)drag.path.push(p);draw()});
 svg.addEventListener('pointerup',e=>{if(!drag)return;const d=drag;drag=null;const p=coords(e);if(d.link&&d.moved&&d.id){const target=visible().filter(k=>k!==d.id).map(k=>({k,p:point(k)})).sort((a,b)=>Math.hypot((a.p.x-p.x)*W,(a.p.y-p.y)*H)-Math.hypot((b.p.x-p.x)*W,(b.p.y-p.y)*H))[0];if(target&&Math.hypot((target.p.x-p.x)*W,(target.p.y-p.y)*H)<35)void relate([d.id,target.k]);else{render();trace('link-miss',{target:d.id,duration:performance.now()-d.began})}return}if(d.moved){if(!d.id&&d.path.length>4){selected=visible().filter(k=>inside(point(k),d.path));linkFrom='';nameTarget=''}saveView();render();trace(d.id?'move':'lasso',{...(d.id?{target:d.id}:{}),duration:performance.now()-d.began})}else if(d.id)choose(d.id);else{selected=[];linkFrom='';nameTarget='';render();trace('clear')}});
 svg.addEventListener('pointercancel',()=>{drag=null;saveView();draw();trace('cancel')});
 svg.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const k=(e.target as Element).closest('[data-id]')?.getAttribute('data-id');if(k){e.preventDefault();choose(k)}}});
 document.querySelector('main')!.addEventListener('click',async e=>{const b=(e.target as Element).closest<HTMLButtonElement>('button[data-action]');if(!b||busy)return;const a=b.dataset.action,k=b.dataset.key||'',one=selected.length===1?get(selected[0]):undefined;
 switch(a){
 case 'root':navigate(0);break;case 'crumb':navigate(Number(k)+1);break;case 'out':navigate(stack.length-1);break;
 case 'clear':selected=[];linkFrom='';nameTarget='';render();trace('clear');break;
 case 'link':linkFrom=linkFrom?'':selected[0];render();trace(linkFrom?'link-start':'link-cancel');break;
 case 'relate':await relate([...selected]);break;
 case 'new':{const f=await add({kind:'thing'});if(f){reveal(f.id);trace('contribution',{target:f.id,factKind:'thing'})}break}
 case 'group':await construct('collection',[...selected]);break;
 case 'compose':await construct('composition',[...selected]);break;
 case 'fromCollection':if(one?.kind==='collection')await construct('composition',one.members,one.id);break;
 case 'enter':if(one)enter(one.id);break;
 case 'unfold':if(one&&isContainer(one)){for(const m of one.members)show(m);saveView();render();trace('unfold',{target:one.id})}break;
 case 'reveal':reveal(k);break;
 case 'hide':hide([...selected]);selected=[];linkFrom='';nameTarget='';saveView();render();trace('hide');break;
 case 'name':if(one){nameTarget=one.id;render();$('nameInput').focus();trace('name-open',{target:one.id})}break;
 case 'cancelName':nameTarget='';render();trace('name-cancel');break;
 }
 });
 $('inspector').addEventListener('submit',async e=>{e.preventDefault();if(!nameTarget||busy)return;const input=$('nameInput') as HTMLInputElement;const f=await add({kind:'name',target:nameTarget,text:input.value});if(f){nameTarget='';render();trace('contribution',{factKind:'name'})}});
 $('showAll').onclick=()=>{for(const e of all())if(e.id!==ctx())show(e.id);saveView();render();trace('show-all')};
 $('resetView').onclick=reset;
 $('share').onclick=async()=>{if(busy||rec.active||rec.busy){status('Stop recording before switching rooms.',true);return}if(room){room='';remote=[];history.replaceState(null,'',location.pathname+location.search);loadView();info();render();status('Local notebook');return}room=uid();history.replaceState(null,'',location.pathname+location.search+'#room='+room);loadView();info();render();if(await sync())status('Invitation ready. Local things stay local.')};
 $('identity').onclick=()=>{if(busy||rec.active||rec.busy){status('Stop recording before switching inhabitant.',true);return}actor=uid();store('things.actor.v1',actor);loadView();info();render()};
 $('copy').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);status('Invitation copied')}catch{status('Copy the address from your browser.')}};
 recordUI();
 $('recordStart').onclick=()=>void rec.start();
 $('recordStop').onclick=()=>void rec.stop();
 $('recordQuickStop').onclick=()=>void rec.stop();
 $('recordDelete').onclick=()=>{if(confirm('Delete this recording and revoke its observer link?'))void rec.remove()};
 $('recordCopy').onclick=async()=>{try{await navigator.clipboard.writeText(rec.link());$('recordStatus').textContent='Observer link copied (read-only).'}catch{prompt('Copy observer link',rec.link())}};
 void sync();setInterval(()=>{if(room&&!document.hidden)void sync()},5000);
}

}
