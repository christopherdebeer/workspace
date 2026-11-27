import {paperProof} from './proof';
const canvas = document.querySelector<HTMLCanvasElement>('#glass')!;
const focusDial = document.querySelector<HTMLInputElement>('#focus')!;
const relief = document.querySelector<HTMLInputElement>('#relief')!;
const lenses = document.querySelector<HTMLSelectElement>('#lens')!;
const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.strip button'));
const titles = ['The Trefoil', 'The Armillary', 'The Volute'];
const roman = ['I', 'II', 'III'];
const query = new URLSearchParams(location.search);
const preview = query.has('preview');
document.body.classList.toggle('preview', preview);
let plate = Math.max(0, ['trefoil','armillary','volute'].indexOf(query.get('plate') || 'trefoil'));
let angle = 0.27;
type V = [number,number,number];
const tau = Math.PI * 2;
const cross = (a:V,b:V):V => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = (a:V):V => {const l=Math.hypot(...a); return [a[0]/l,a[1]/l,a[2]/l]};

// A circular section swept along each centreline. The section's own coordinates carry
// the lathe cuts and lettering continuously round the bends.
function specimen(kind:number) {
  const vertices:number[] = [], indices:number[] = [];
  function tube(path:(t:number)=>V, axis:(t:number)=>V, width:number, thickness:number) {
    const base=vertices.length/8, rings=216, sides=32;
    for(let i=0;i<=rings;i++){
      const t=i/rings*tau, p=path(t), a=path(t-.001), b=path(t+.001);
      const tangent=unit([b[0]-a[0],b[1]-a[1],b[2]-a[2]]);
      const y=unit(cross(tangent,axis(t))), x=unit(cross(y,tangent));
      for(let j=0;j<=sides;j++){
        const c=Math.cos(j*tau/sides), s=Math.sin(j*tau/sides);
        const n=unit(x.map((k,d)=>k*c/width+y[d]*s/thickness) as V);
        vertices.push(...p.map((k,d)=>k+x[d]*c*width+y[d]*s*thickness),...n,i/rings,j/sides);
        if(i<rings && j<sides){const v=base+i*(sides+1)+j; indices.push(v,v+1,v+sides+1,v+1,v+sides+2,v+sides+1)}
      }
    }
  }
  if(kind===0){
    tube(t=>[(.77+.28*Math.cos(3*t))*Math.cos(2*t),(.77+.28*Math.cos(3*t))*Math.sin(2*t),.52*Math.sin(3*t)],()=>[0,0,1],.19,.16);
  }else if(kind===1){
    for(let k=0;k<4;k++){
      const az=.65+k*.78, tilt=.55+k*.52, r=1.13-k*.083;
      const x:V=[Math.cos(az),Math.sin(az),0], y:V=[-Math.sin(az)*Math.cos(tilt),Math.cos(az)*Math.cos(tilt),Math.sin(tilt)];
      tube(t=>x.map((v,d)=>r*(v*Math.cos(t)+y[d]*Math.sin(t))) as V,()=>cross(x,y),.088,.032);
    }
  }else{
    // A continuous return through the middle closes the winding into a single object.
    tube(t=>{const r=.64+.40*Math.cos(t), h=.72*Math.sin(t), a=3*t+.35;return [r*Math.cos(a),h+.18*Math.cos(a),r*Math.sin(a)]},()=>[0,1,0],.14,.095);
  }
  return {vertices:new Float32Array(vertices), indices:new Uint16Array(indices)};
}
const vs = `attribute vec3 pos,normal; attribute vec2 uv; uniform float turn,eye,focus,aspect;
varying vec3 N; varying vec2 U; varying float Z;
void main(){
 float c=cos(turn),s=sin(turn);mat3 yaw=mat3(c,0.,-s,0.,1.,0.,s,0.,c);
 float a=-.22;mat3 pitch=mat3(1.,0.,0.,0.,cos(a),sin(a),0.,-sin(a),cos(a));
 vec3 p=pitch*yaw*pos; N=pitch*yaw*normal; U=uv; Z=p.z;
 float distance=4.6-p.z, f=3.3*min(1.,aspect);
 gl_Position=vec4(f*((p.x-eye)/aspect+eye*distance/(focus*aspect)),f*p.y,distance-2.,distance);
}`;
const fs = `precision mediump float;
varying vec3 N; varying vec2 U; varying float Z; uniform sampler2D engraving;
void main(){
 vec3 n=normalize(N); float lit=dot(n,normalize(vec3(-.48,.72,.65)));
 float value=.46+.25*lit+.10*n.z+.055*Z;
 float flute=.5+.5*cos(6.28318*(U.y*24.+.3*sin(U.x*18.85)));
 value+=.09*smoothstep(.3,.88,flute);
 float border=smoothstep(.16,.19,U.y)*(1.-smoothstep(.31,.34,U.y));
 float band=texture2D(engraving,vec2(U.x*4.,clamp((U.y-.16)/.18,0.,1.))).r;
 value=mix(value,.25+.49*band,border*.92);
 gl_FragColor=vec4(vec3(value),1.);
}`;
function start(){
 const gl=canvas.getContext('webgl',{alpha:false,antialias:true,depth:true});
 let uniforms:Record<string,WebGLUniformLocation|null>={};
 if(gl){
 function shader(type:number,source:string){
   const sh=gl!.createShader(type)!;gl!.shaderSource(sh,source);gl!.compileShader(sh);
   if(!gl!.getShaderParameter(sh,gl!.COMPILE_STATUS))throw new Error(gl!.getShaderInfoLog(sh)||'Shader unavailable');return sh;
 }
 const program=gl.createProgram()!;gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('The optical plate could not be linked.');
 gl.useProgram(program);gl.enable(gl.DEPTH_TEST);
 uniforms=Object.fromEntries(['turn','focus','eye','aspect'].map(k=>[k,gl.getUniformLocation(program,k)]));
 gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer());
 for(const [name,size,offset] of [['pos',3,0],['normal',3,12],['uv',2,24]] as const){
   const loc=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,32,offset);
 }
 }
 const etch=document.createElement('canvas');etch.width=512;etch.height=64;
 const ctx=etch.getContext('2d')!;if(gl){gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
 }
 let count=0, mesh:ReturnType<typeof specimen>, ink:Uint8ClampedArray;
 function mount(){
   mesh=specimen(plate);count=mesh.indices.length;
   if(gl){gl!.bufferData(gl!.ARRAY_BUFFER,mesh.vertices,gl!.STATIC_DRAW);gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER,mesh.indices,gl!.STATIC_DRAW);}
   ctx.fillStyle='#222';ctx.fillRect(0,0,512,64);ctx.fillStyle='#ddd';ctx.font='bold 26px monospace';
   ctx.fillText('PENNY VISION  /  '+roman[plate]+'  •  1p',8,41);
   for(let x=0;x<512;x+=8)ctx.fillRect(x,0,2,x%32?6:11);
   if(gl){gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL,true);gl!.texImage2D(gl!.TEXTURE_2D,0,gl!.RGBA,gl!.RGBA,gl!.UNSIGNED_BYTE,etch);gl!.generateMipmap(gl!.TEXTURE_2D)}else ink=ctx.getImageData(0,0,512,64).data;
   buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===plate)));
   document.querySelector('#title')!.textContent=titles[plate];document.querySelector('#number')!.textContent='PLATE '+roman[plate]+' / III';
 }
 function draw(){
   const dpr=Math.min(preview?1:2,devicePixelRatio,gl?2:900/Math.max(canvas.clientWidth,canvas.clientHeight)), w=Math.max(1,Math.round(canvas.clientWidth*dpr)),h=Math.max(1,Math.round(canvas.clientHeight*dpr));
   if(w!==canvas.width||h!==canvas.height){canvas.width=w;canvas.height=h}
   const mode=lenses.selectedIndex, baseline=.0048*Number(relief.value);
   // Overprinted title acts as a second registration target on the paper surround.
   const offset=mode===4?0:(mode>=2?-1:1)*baseline*(9+Number(focusDial.value)*.06);
   document.body.style.setProperty('--register',offset+'px');
   document.body.style.setProperty('--right-ink',mode%2===1?'#3333d9':'#20bbbb');
   document.body.style.setProperty('--rack',(50-Number(focusDial.value)*.5)+'%');
   if(!gl){paperProof(canvas,mesh,ink,angle,4.6-Number(focusDial.value)*.011,baseline,mode);return}
   gl!.viewport(0,0,w,h);gl!.colorMask(true,true,true,true);gl!.clearColor(.135,.135,.135,1);gl!.clear(gl!.COLOR_BUFFER_BIT|gl!.DEPTH_BUFFER_BIT);
   gl!.uniform1f(uniforms.turn,angle);gl!.uniform1f(uniforms.aspect,w/h);
   gl!.uniform1f(uniforms.focus,4.6-Number(focusDial.value)*.011);
   if(mode%2===1){gl!.clearColor(.135,0,.135,1);gl!.clear(gl!.COLOR_BUFFER_BIT)}
   function pass(eye:number,r:boolean,g:boolean,b:boolean){
     gl!.uniform1f(uniforms.eye,eye);gl!.colorMask(r,g,b,true);gl!.clear(gl!.DEPTH_BUFFER_BIT);gl!.drawElements(gl!.TRIANGLES,count,gl!.UNSIGNED_SHORT,0);
   }
   if(mode===4)pass(0,true,true,true);
   else{const sign=mode>=2?-1:1;pass(-sign*baseline*.5,true,false,false);pass(sign*baseline*.5,false,mode%2===0,true)}
   gl!.colorMask(true,true,true,true);
 }
 buttons.forEach((b,i)=>b.onclick=()=>{plate=i;mount();draw()});
 document.querySelector<HTMLButtonElement>('.coin')!.onclick=()=>buttons[(plate+1)%buttons.length].click();
 for(const el of [focusDial,relief,lenses])el.oninput=draw;
 let drag:{id:number,x:number,y:number,angle:number,focus:number}|null=null;
 canvas.onpointerdown=e=>{if(drag)return;canvas.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,angle,focus:Number(focusDial.value)}};
 canvas.onpointermove=e=>{if(drag?.id!==e.pointerId||!drag)return;angle=drag.angle+(e.clientX-drag.x)*5/canvas.clientWidth;focusDial.value=String(drag.focus+(drag.y-e.clientY)*200/canvas.clientHeight);draw()};
 canvas.onlostpointercapture=()=>{drag=null};
 canvas.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();angle+=(e.key==='ArrowLeft'?-.1:.1);draw()}};
 mount();draw();new ResizeObserver(draw).observe(canvas);
}
import {startAds} from './ads';
import {spatialPlates} from './spatial';
try{if(query.has('ads'))startAds();else {const strip=document.querySelector<HTMLElement>('.strip')!;strip.style.gridTemplateColumns='repeat(auto-fit,minmax(90px,1fr))';for(const [i,title] of ['Classifieds','Third Dimension'].entries()){const b=document.createElement('button');b.innerHTML='<b>'+['IV','V'][i]+'</b> '+title;b.setAttribute('aria-pressed','false');b.onclick=()=>location.href=location.pathname+'?plate='+['classifieds','dimension'][i];strip.append(b)} const spatial=['classifieds','dimension'].indexOf(query.get('plate')||'');if(spatial>=0)spatialPlates(canvas,spatial);else start()}}catch(e){const error=document.querySelector('#error');if(error)error.textContent=e instanceof Error?e.message:'Viewer unavailable.';else console.error(e)}
export {};
