// Spatial advertising plates: alpha-cut graphic surfaces in a real off-axis stereo scene.
import {pictorial} from './pictorial';
type Part='headline'|'product'|'copy'|'ornament'|'coupon'|'background';
const names:Part[]=['headline','product','copy','ornament','coupon','background'];
type Surface={part:Part,z:number,x:number,y:number,w:number,h:number,texture:WebGLTexture,tilt:number};
export function spatialPlates(canvas:HTMLCanvasElement,initial:number){
 const gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 if(!gl){document.querySelector('#error')!.textContent='Spatial plates require WebGL.';return}
 const g=gl;
 function sh(t:number,s:string){const a=g.createShader(t)!;g.shaderSource(a,s);g.compileShader(a);if(!g.getShaderParameter(a,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(a)||'Shader');return a}
 const program=g.createProgram()!;
 g.attachShader(program,sh(g.VERTEX_SHADER,'attribute vec2 uv; varying vec2 U; uniform vec4 box; uniform float z,eye,focus,aspect,tilt; void main(){U=uv; vec2 p=box.xy+(uv-0.5)*box.zw; float zz=z+(uv.x-.5)*tilt; float d=4.6-zz; float f=3.9*min(1.,aspect*1.18); gl_Position=vec4(f*((p.x-eye)/aspect+eye*d/(focus*aspect)),f*p.y,d-2.,d);}'));
 g.attachShader(program,sh(g.FRAGMENT_SHADER,'precision mediump float; varying vec2 U; uniform sampler2D ink; uniform float binary,bands,level; void main(){vec4 c=texture2D(ink,vec2(U.x,1.-U.y)); if(c.a<.5)discard; float v=mix(c.r,level,bands); if(binary>.5)v=step(.5,v);gl_FragColor=vec4(vec3(v),1.);}'));
 g.linkProgram(program);if(!g.getProgramParameter(program,g.LINK_STATUS))throw Error(g.getProgramInfoLog(program)||'Link');
 g.useProgram(program);g.enable(g.DEPTH_TEST);g.depthFunc(g.LEQUAL);
 const u=(n:string)=>g.getUniformLocation(program,n);
 const b=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,b);g.bufferData(g.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,0,1,1,0,1,1]),g.STATIC_DRAW);const a=g.getAttribLocation(program,'uv');g.enableVertexAttribArray(a);g.vertexAttribPointer(a,2,g.FLOAT,false,0,0);
 const focus=document.querySelector<HTMLInputElement>('#focus')!,relief=document.querySelector<HTMLInputElement>('#relief')!,lens=document.querySelector<HTMLSelectElement>('#lens')!;
 const panel=document.createElement('div');panel.className='adjust';panel.style.cssText='justify-content:flex-start;border:1px solid #aaa79e;padding:9px;gap:10px';document.querySelector('.adjust')!.after(panel);
 const visible=new Set(names);
 function check(label:string,yes:boolean,fn:(v:boolean)=>void){const l=document.createElement('label');const e=document.createElement('input');e.type='checkbox';e.checked=yes;e.style.width='auto';l.append(e,label);panel.append(l);e.onchange=()=>{fn(e.checked);draw()}}
 for(const n of names)check(n,true,v=>{if(v)visible.add(n);else visible.delete(n)});
 let binary=true,bands=false;check('Binary ink',true,v=>binary=v);check('Depth proof',false,v=>bands=v);
 const explode=document.createElement('input');explode.type='range';explode.min='1';explode.max='1.6';explode.step='.05';explode.value='1';const el=document.createElement('label');el.append('Explode',explode);panel.append(el);explode.oninput=draw;
 const view=document.createElement('select');for(const s of ['Composite','Left eye','Right eye','Centre proof'])view.add(new Option(s));panel.append(view);view.onchange=draw;
 const save=document.createElement('button');save.textContent='Save PNG';panel.append(save);save.onclick=()=>{draw();const link=document.createElement('a');link.download='penny-spatial-'+plate+'.png';link.href=canvas.toDataURL();link.click()};
 let plate=initial,surfaces:Surface[]=[];
 function surface(part:Part,x:number,y:number,z:number,w:number,h:number,paint:(c:CanvasRenderingContext2D,W:number,H:number)=>void,tilt=0){
 const t=document.createElement('canvas');t.width=1024;t.height=Math.max(64,Math.round(1024*h/w));const c=t.getContext('2d')!;paint(c,t.width,t.height);
 const texture=g.createTexture()!;g.bindTexture(g.TEXTURE_2D,texture);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,t);surfaces.push({part,x,y,z,w,h,texture,tilt})
 }
 function text(c:CanvasRenderingContext2D,s:string,x:number,y:number,w:number,h:number,font='900 sans-serif',ink='#111'){c.save();c.font=font.replace(/(sans-serif|serif|monospace)$/,h+'px $1');c.textBaseline='top';c.translate(x,y);c.scale(w/Math.max(1,c.measureText(s).width),1);c.fillStyle=ink;c.fillText(s,0,0);c.restore()}
 function mount(n:number){
 plate=n;for(const s of surfaces)g.deleteTexture(s.texture);surfaces=[];
 const second=n===1;
 if(n>=2){pictorial(surface,n);document.querySelector('#title')!.textContent=n===2?'Apparition':'Flight';document.querySelector('#number')!.textContent='PLATE '+(n===2?'VI':'VII')+' / VII';document.querySelectorAll('.strip button').forEach((e,i)=>e.setAttribute('aria-pressed',String(i===n+3)));draw();return}

 surface('background',0,0,-.8,2.7,2.05,(c,W,H)=>{c.strokeStyle='#111';c.lineWidth=2;for(let i=0;i<4;i++)c.strokeRect(30+i*12,30+i*12,W-60-i*24,H-60-i*24);for(let i=0;i<28;i++){const x=40+i*(W-80)/27;c.beginPath();c.moveTo(x,H-45);c.lineTo(W*.5,H*.58);c.stroke()}for(let i=0;i<9;i++){const y=H-45-i*i*3;c.beginPath();c.moveTo(40,y);c.lineTo(W-40,y);c.stroke()}text(c,'OPTICAL AMUSEMENTS  /  SPECIMEN '+(second?'V':'IV'),55,55,W-110,30,'bold monospace')});
 surface('headline',0,.64,.48,2.04,.48,(c,W,H)=>{text(c,second?'THE THIRD':'PENNY VISION',8,0,W-16,H*.74,'900 sans-serif');text(c,second?'DIMENSION.':'VIRTUAL REALITY FOR SMALL CHANGE.',8,H*.72,W-16,H*.25,'italic bold serif')},-.06);
 surface('product',0,.02,.25,1.65,.63,(c,W,H)=>{const X=W/100,Y=H/40;c.scale(X,Y);c.fillStyle='#111';c.beginPath();c.moveTo(2,9);c.lineTo(15,3);c.lineTo(88,3);c.lineTo(98,10);c.lineTo(93,32);c.lineTo(61,32);c.lineTo(50,24);c.lineTo(39,32);c.lineTo(8,32);c.closePath();c.fill();c.fillStyle='#fff';c.beginPath();c.moveTo(8,10);c.lineTo(44,10);c.lineTo(42,25);c.lineTo(12,25);c.closePath();c.fill();c.beginPath();c.moveTo(56,10);c.lineTo(92,10);c.lineTo(88,25);c.lineTo(58,25);c.closePath();c.fill();c.strokeStyle='#111';c.lineWidth=.35;for(let i=0;i<20;i++){c.beginPath();c.moveTo(12+i*1.4,25);c.lineTo(23+i*1.4,10);c.stroke();c.beginPath();c.moveTo(58+i*1.4,25);c.lineTo(69+i*1.4,10);c.stroke()}},.42);
 // Folded temples occupy genuine depth, with a horizontal slope across each surface.
 for(const sign of [-1,1])surface('product',sign*.82,.07,-.12,.39,.17,(c,W,H)=>{c.fillStyle='#111';c.fillRect(0,H*.3,W,H*.35);c.fillStyle='#fff';for(let i=0;i<12;i++)c.fillRect(i*W/12,H*.35,2,H*.2)},sign*-.75);
 surface('ornament',second?-.9:.92,.30,-.15,.47,.47,(c,W,H)=>{c.translate(W/2,H/2);c.strokeStyle='#111';c.lineWidth=6;for(let i=0;i<20;i++){const a=i*Math.PI/10;c.beginPath();c.moveTo(Math.cos(a)*W*.28,Math.sin(a)*H*.28);c.lineTo(Math.cos(a)*W*.48,Math.sin(a)*H*.48);c.stroke()}c.beginPath();c.arc(0,0,W*.25,0,Math.PI*2);c.stroke();text(c,'3-D',-W*.2,-H*.1,W*.4,H*.2,'900 serif')});
 surface('copy',-.43,-.48,.10,1.12,.35,(c,W,H)=>{text(c,'TWO LENSES.',0,0,W,H*.36);text(c,'NO ELECTRONICS.',0,H*.39,W,H*.28);text(c,'THE FUTURE IS MADE OF CARDBOARD.',0,H*.78,W,H*.19,'bold monospace')});
 surface('coupon',.78,-.51,-.32,.73,.40,(c,W,H)=>{c.strokeStyle='#111';c.lineWidth=8;c.setLineDash([20,14]);c.strokeRect(8,8,W-16,H-16);c.setLineDash([]);text(c,'MAIL ORDER',35,30,W-70,H*.22);text(c,'SEE WHAT YOU',35,H*.33,W-70,H*.19,'bold serif');text(c,'ARE MISSING.',35,H*.54,W-70,H*.19,'bold serif');c.beginPath();c.moveTo(35,H*.81);c.lineTo(W-35,H*.81);c.stroke()});
 document.querySelector('#title')!.textContent=second?'The Third Dimension':'Optical Classifieds';document.querySelector('#number')!.textContent='PLATE '+(second?'V':'IV')+' / VII';
 document.querySelectorAll('.strip button').forEach((e,i)=>e.setAttribute('aria-pressed',String(i===n+3)));
 draw();
 }
 function draw(){
 const w=Math.max(1,Math.round(canvas.clientWidth*Math.min(2,devicePixelRatio))),h=Math.max(1,Math.round(canvas.clientHeight*Math.min(2,devicePixelRatio)));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
 g.viewport(0,0,w,h);g.colorMask(true,true,true,true);g.clearColor(1,1,1,1);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);
 g.uniform1f(u('aspect'),w/h);g.uniform1f(u('focus'),4.6-Number(focus.value)*.011);g.uniform1f(u('binary'),binary?1:0);g.uniform1f(u('bands'),bands?1:0);
 const sep=Number(relief.value)*.0048,mode=lens.selectedIndex,sign=mode>=2?-1:1;
 function pass(eye:number,r:boolean,green:boolean,blue:boolean){
 g.colorMask(r,green,blue,true);g.clear(g.DEPTH_BUFFER_BIT);g.uniform1f(u('eye'),eye);
 for(const s of surfaces){if(!visible.has(s.part))continue;g.bindTexture(g.TEXTURE_2D,s.texture);g.uniform4f(u('box'),s.x,s.y,s.w,s.h);g.uniform1f(u('z'),s.z*Number(explode.value));g.uniform1f(u('tilt'),s.tilt);g.uniform1f(u('level'),.2+(s.z+.8)*.45);g.drawArrays(g.TRIANGLES,0,6)}
 }
 if(view.selectedIndex===1)pass(-sep/2,true,true,true);else if(view.selectedIndex===2)pass(sep/2,true,true,true);else if(view.selectedIndex===3||mode===4||bands)pass(0,true,true,true);else{if(mode%2===1){g.clearColor(1,0,1,1);g.clear(g.COLOR_BUFFER_BIT)}pass(-sign*sep/2,true,false,false);pass(sign*sep/2,false,mode%2===0,true)}
 g.colorMask(true,true,true,true);
 }
 for(const e of [focus,relief,lens])e.oninput=draw;
 canvas.style.cursor='default';canvas.setAttribute('aria-label','Spatial advertising plate');
 const fig=canvas.parentElement!;fig.style.minHeight='min(65svh,650px)';fig.style.color='#555';const cap=fig.querySelector('.caption:last-child span:last-child');if(cap)cap.textContent='Inspect parts below';
 const coin=document.querySelector<HTMLButtonElement>('.coin')!;coin.onclick=()=>mount((plate+1)%4);
 const strip=document.querySelector('.strip')!;strip.querySelectorAll<HTMLButtonElement>('button').forEach((e,i)=>e.onclick=()=>{if(i<3)location.href=location.pathname+'?plate='+['trefoil','armillary','volute'][i];else mount(i-3)});
 if(initial>=2){relief.value=String(Math.min(Number(relief.max),Math.max(Number(relief.value),Number(relief.max)*.72)));} mount(initial);new ResizeObserver(draw).observe(canvas);
}
