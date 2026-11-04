// Cloudfold — a bounded, participating medium built from kaleidoscopic folds.
const qs = new URLSearchParams(location.search), preview = qs.has('preview');
const canvas = document.querySelector('canvas')!;
const gl = canvas.getContext('webgl2', {alpha:false, antialias:false, depth:false});
const message = document.getElementById('message')!;
const clamp = (v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const num = (key:string,d:number,a:number,b:number)=>{const v=Number(qs.get(key)??d);return Number.isFinite(v)?clamp(v,a,b):d;};
let seed=num('seed',1947,0,999999), conceal=num('conceal',0.85,0,1), fullness=num('fullness',0.55,0,1), folds=num('folds',6,2,8);
let theme=['day','dusk','storm'].indexOf(qs.get('light')??'day'); if(theme<0)theme=0;
let paused=qs.has('still')||matchMedia('(prefers-reduced-motion: reduce)').matches, age=num('t',12,0,1e5), az=0.22,el=0.12,dist=6.5, frames=0;
const low=preview||qs.get('q')==='low', steps=low?48:80;
const vertex=`#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`;
const fragment=`#version 300 es
precision highp float;
out vec4 color;
uniform vec2 resolution;
uniform float time, seed, conceal, fullness, folds, az, el, dist, theme;
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float density(vec3 p){
  // Envelope remains in world space; the internal domain drifts and shears.
  float envelope=1.-smoothstep(.68,1.08,length(p/vec3(2.15,1.42,1.62)));
  if(envelope<=0.)return 0.;
  vec3 origin=p;
  float phase=seed*.013;
  p+=conceal*.32*vec3(sin(p.y*1.7+phase+time*.06),sin(p.z*1.4+phase*.7),sin(p.x*1.6-time*.045));
  p.x+=conceal*.23*p.y; p+=conceal*vec3(.17,-.11,.23);
  vec3 q=p; float scale=1.; float field=10.;
  for(int i=0;i<8;i++){
    if(float(i)>=folds)break;
    q=abs(q); // the kaleidoscopic fold
    q.xy=rot(.48+conceal*(.21*sin(float(i)*2.3+phase)))*q.xy;
    q.yz=rot(.63+conceal*.18*cos(phase+float(i)))*q.yz;
    q=q*1.78-vec3(.94,.69,.81); scale*=1.78;
    field=min(field,(length(q)-.93)/scale);
  }
  float billow=1.-smoothstep(-.12,.28,field);
  float erosion=noise(origin*3.2+vec3(time*.035,phase,0.))*.65+noise(origin*7.1+phase)*.35;
  float body=billow-(1.-fullness)*.8-conceal*.36*erosion;
  return max(body,0.)*envelope*2.9;
}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*resolution)/resolution.y;
 vec3 ro=vec3(sin(az)*cos(el),sin(el),cos(az)*cos(el))*dist;
 vec3 fw=normalize(-ro), right=normalize(cross(fw,vec3(0,1,0))),up=cross(right,fw);
 vec3 rd=normalize(fw*1.85+uv.x*right+uv.y*up);
 vec3 skyTop=theme<.5?vec3(.20,.39,.58):theme<1.5?vec3(.22,.23,.39):vec3(.09,.15,.20);
 vec3 horizon=theme<.5?vec3(.73,.81,.83):theme<1.5?vec3(.82,.55,.42):vec3(.44,.50,.52);
 vec3 bg=mix(horizon,skyTop,smoothstep(-.6,.85,rd.y));
 vec3 sun=normalize(vec3(-.65,.7,.35));
 vec3 sunlight=theme<.5?vec3(1.12,1.08,.99):theme<1.5?vec3(1.35,.78,.43):vec3(.8,.88,.95);
 bg+=sunlight*.16*pow(max(dot(rd,sun),0.),24.);
 float b=dot(ro,rd),c=dot(ro,ro)-8.41,h=b*b-c;
 vec3 sum=vec3(0);float trans=1.;
 if(h>0.){
  float near=max(0.,-b-sqrt(h)),far=-b+sqrt(h);
  float stepSize=(far-near)/float(STEPS);
  float jitter=hash(vec3(gl_FragCoord.xy,17.));
  for(int i=0;i<STEPS;i++){
   vec3 p=ro+rd*(near+(float(i)+jitter)*stepSize);
   float d=density(p);
   if(d>.005){
    float shadow=0.;
    for(int j=1;j<=4;j++){float s=float(j)*.23;shadow+=density(p+sun*s)*.23;}
    float light=exp(-shadow*2.1);
    vec3 ambient=mix(vec3(.22,.29,.39),vec3(.52,.62,.73),clamp(p.y*.3+.5,0.,1.));
    if(theme>1.5)ambient*=.65;
    float forward=pow(max(dot(rd,sun),0.),8.);
    vec3 illumination=ambient*.65+sunlight*light*(.75+forward*.75);
    float alpha=1.-exp(-d*stepSize*2.2);
    sum+=trans*alpha*illumination;trans*=1.-alpha;
    if(trans<.012)break;
   }
  }
 }
 vec3 rgb=sum+bg*trans;
 rgb=pow(max(rgb,vec3(0)),vec3(.92));
 rgb+=(hash(vec3(gl_FragCoord.xy,3.))-.5)/255.;
 color=vec4(rgb,1);
}`.replaceAll('STEPS',String(steps));
function start(g:WebGL2RenderingContext){
 function shader(type:number,src:string){const s=g.createShader(type)!;g.shaderSource(s,src);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s)??'Shader failed');return s;}
 const vs=shader(g.VERTEX_SHADER,vertex),fs=shader(g.FRAGMENT_SHADER,fragment),program=g.createProgram()!;
 g.attachShader(program,vs);g.attachShader(program,fs);g.linkProgram(program);if(!g.getProgramParameter(program,g.LINK_STATUS))throw Error(g.getProgramInfoLog(program)??'Link failed');g.deleteShader(vs);g.deleteShader(fs);g.useProgram(program);g.bindVertexArray(g.createVertexArray());
 const loc=Object.fromEntries(['resolution','time','seed','conceal','fullness','folds','az','el','dist','theme'].map(k=>[k,g.getUniformLocation(program,k)]));
 let last=performance.now(), scale=low?.48:.85, slow=0;
 function frame(now:number){
  const dt=Math.min(.08,(now-last)/1000);last=now;
  if(!document.hidden){
   if(!paused)age+=dt;
   // Cap total pixels, independent of iPhone DPR; lower resolution if persistently slow.
   const area=canvas.clientWidth*canvas.clientHeight, ratio=Math.min(1.35,Math.sqrt((low?160000:620000)/Math.max(1,area)))*scale;
   const w=Math.max(1,Math.round(canvas.clientWidth*ratio)),h=Math.max(1,Math.round(canvas.clientHeight*ratio));
   if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;g.viewport(0,0,w,h);}
   g.uniform2f(loc.resolution,w,h);
   for(const [k,v] of Object.entries({time:age,seed,conceal,fullness,folds,az,el,dist,theme}))g.uniform1f(loc[k],v);
   g.drawArrays(g.TRIANGLES,0,3);frames++;
   if(frames>20&&dt>.048)slow++;else slow=Math.max(0,slow-1);
   if(slow>35&&scale>.42){scale*=.85;slow=0;}
  }
  requestAnimationFrame(frame);
 }
 requestAnimationFrame(frame);
 (window as any).__cloudfold={probe:()=>({seed,conceal,fullness,folds,theme,frames,age,width:canvas.width,height:canvas.height,steps,error:g.getError()}),setTime:(t:number)=>{age=t;paused=true;}};
}
function sync(){if(preview)return;const u=new URL(location.href);for(const [k,v]of Object.entries({seed,conceal,fullness,folds,light:['day','dusk','storm'][theme]}))u.searchParams.set(k,String(v));history.replaceState(null,'',u);document.getElementById('seed')!.textContent=String(seed);}
for(const key of ['conceal','fullness','folds']){const input=document.getElementById(key) as HTMLInputElement;input.value=String({conceal,fullness,folds}[key]);input.oninput=()=>{const v=Number(input.value);if(key==='conceal')conceal=v;else if(key==='fullness')fullness=v;else folds=v;sync();};}
const light=document.getElementById('light') as HTMLSelectElement;light.value=String(theme);light.onchange=()=>{theme=Number(light.value);sync();};
const pause=document.getElementById('pause')!;const pauseLabel=()=>pause.textContent=paused?'Let drift':'Hold time';pauseLabel();pause.onclick=()=>{paused=!paused;pauseLabel();};
document.getElementById('another')!.onclick=()=>{seed=crypto.getRandomValues(new Uint32Array(1))[0]%1000000;sync();};
const pointers=new Map<number,{x:number,y:number}>();let gap=0;
canvas.onpointerdown=e=>{pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);gap=0;};
canvas.onpointermove=e=>{const old=pointers.get(e.pointerId);if(!old)return;const dx=e.clientX-old.x,dy=e.clientY-old.y;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===1){az-=dx*.006;el=clamp(el+dy*.004,-1.1,1.1);}else{const [a,b]=[...pointers.values()];const d=Math.hypot(a.x-b.x,a.y-b.y);if(gap>0)dist=clamp(dist*gap/Math.max(1,d),4,10);gap=d;}};
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=e=>{pointers.delete(e.pointerId);gap=0;};
canvas.addEventListener('wheel',e=>{e.preventDefault();dist=clamp(dist*Math.exp(e.deltaY*.001),4,10);},{passive:false});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();message.textContent='Graphics paused. Reload to restore the cloud.';});
if(preview)document.body.classList.add('preview');sync();
if(!gl)message.textContent='This study needs WebGL 2. Please open it in a browser with graphics enabled.';else try{start(gl);}catch(e){message.textContent='The cloud could not render on this device.';console.error(e);}
export {};
