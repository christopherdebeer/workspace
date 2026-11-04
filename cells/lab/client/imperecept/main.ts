/** Imperecept — a continuous listening skin. No remote audio dependency. */
export {};
const preview = new URLSearchParams(location.search).has('preview');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.createElement('main');
document.body.append(root);
root.innerHTML = `<canvas id="skin" tabindex="0" aria-label="Sound substrate. Arrow keys explore; hold Space to gather sound; R reveals the temporal layers."></canvas>
<header><a href="/">← lab</a><span>IMPERECEPT</span><button id="reveal" aria-pressed="false">Reveal</button></header>
<section id="intro"><small>A LISTENING SKIN</small><h1>What lies<br>between sounds.</h1><p>Move to discover. Hold to gather.<br>Leave an impression.</p><button id="begin">Enter & listen <span>↗</span></button></section>
<footer><p id="hint" role="status" aria-live="polite">Five sounds inhabit this surface.</p><div><button id="sound">Listen</button><span id="where">touch / hold / wander</span><button id="bring">+ Bring sound</button></div><small id="detail"></small></footer><input id="file" type="file" accept="audio/*" hidden>`;
const style = document.createElement('style');
style.textContent = `*{box-sizing:border-box}html,body{margin:0;overflow:hidden;background:#080d10;color:#eee8d9;font-family:system-ui,-apple-system,sans-serif}main{position:fixed;inset:0}canvas{width:100%;height:100%;display:block;touch-action:none;outline:none}canvas:focus-visible{outline:1px solid #e0c795;outline-offset:-5px}header,footer{position:absolute;left:0;right:0;padding:0 max(22px,env(safe-area-inset-right)) 0 max(22px,env(safe-area-inset-left));pointer-events:none}header{top:max(12px,env(safe-area-inset-top));display:flex;align-items:center;justify-content:space-between}header span{font-size:10px;letter-spacing:.28em;color:#bbb9af}button,a{pointer-events:auto;color:inherit;font:inherit;font-size:12px;background:none;border:0;min-height:44px;padding:10px 0;text-decoration:none;cursor:pointer}button:focus-visible,a:focus-visible{outline:1px solid #ddc28b;outline-offset:5px}header a{color:#a2aca9}#reveal[aria-pressed=true]{color:#e6bd7e}footer{bottom:max(15px,env(safe-area-inset-bottom));background:linear-gradient(transparent,#080d10bd);padding-top:30px}footer>div{display:flex;justify-content:space-between;align-items:center;gap:10px}#where{font:10px ui-monospace,monospace;letter-spacing:.06em;color:#a1b4ae;text-align:center}#hint{font-size:12px;color:#b8c3bc;text-align:center;min-height:18px;margin:0 0 10px}#detail{display:block;text-align:center;color:#9ba8a4;font:10px ui-monospace,monospace;min-height:14px}#intro{position:absolute;top:26%;left:10%;right:8%;pointer-events:none;transition:opacity 1s}#intro small{font-size:9px;letter-spacing:.28em;color:#b5c5bc}h1{font-family:Georgia,serif;font-size:clamp(44px,9vw,92px);font-weight:normal;line-height:1.05;letter-spacing:-.045em;margin:24px 0}#intro p{font-size:13px;line-height:1.9;color:#bec9c1}#begin{border-bottom:1px solid #a8b8ac;min-width:170px;text-align:left;margin-top:18px}#begin span{float:right}main.entered #intro{opacity:0;visibility:hidden}main.preview header,main.preview footer,main.preview #intro{display:none}@media(max-height:520px){#intro{top:70px;left:8%}#intro h1{font-size:32px;margin:10px 0}#intro p{display:none}#begin{margin-top:0}#hint{margin-bottom:0}footer{padding-top:8px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}`;
document.head.append(style);
const el = <T extends HTMLElement>(id:string)=>root.querySelector<T>('#'+id)!;
const canvas=el<HTMLCanvasElement>('skin'), ctx=canvas.getContext('2d',{alpha:false})!;
const hint=el('hint'), where=el('where'), detail=el('detail'), sound=el<HTMLButtonElement>('sound');
let W=innerWidth,H=innerHeight,DPR=1,entered=preview,reveal=false,revealMix=0,playing=false;
let ac:AudioContext|null=null, master:GainNode|null=null, analyser:AnalyserNode|null=null;
let audioData:Uint8Array<ArrayBuffer>|null=null, clock=0, level=0, last=performance.now(), frameId=0;
let pending:AudioBuffer|null=null, pendingName='', importing=false;
type Place={x:number;y:number;name:string;color:number[];buffer?:AudioBuffer;reverse?:AudioBuffer;weight:number;coherence:number;memory:number;next:number;phase:number;grain:number};
const places:Place[]=[
 {x:.22,y:.29,name:'rain / glass',color:[139,189,184]},
 {x:.76,y:.27,name:'bronze / air',color:[219,175,112]},
 {x:.49,y:.51,name:'pulse / breath',color:[189,148,137]},
 {x:.21,y:.73,name:'steps / stone',color:[161,181,151]},
 {x:.78,y:.74,name:'water / hollow',color:[117,158,193]},
].map((p,i)=>({...p,weight:i===2?1:0,coherence:.1,memory:0,next:0,phase:i*1.73,grain:.25}));
type Touch={x:number;y:number;speed:number;age:number};
const touches=new Map<number,Touch>();
let focus={x:.49,y:.51};
const traces:{x:number;y:number;v:number}[]=[];
let traceClock=0;
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
function resize(){W=innerWidth;H=innerHeight;DPR=Math.min(devicePixelRatio||1,1.6);canvas.width=Math.round(W*DPR);canvas.height=Math.round(H*DPR);ctx.setTransform(DPR,0,0,DPR,0,0);}
addEventListener('resize',resize);resize();
// Deterministic, distinct source compositions. They are real buffers, not shader-driven tones.
function synth(kind:number):AudioBuffer {
 const sr=24000,duration=12,b=ac!.createBuffer(1,sr*duration,sr),d=b.getChannelData(0);
 let seed=721+kind*801,low=0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296*2-1;};
 for(let i=0;i<d.length;i++){
  const t=i/sr,n=random();low=low*.97+n*.03;let v=0;
  if(kind===0){const q=t%.37;v=low*.5+n*.08+Math.sin(q*6100)*Math.exp(-q*100)*.18;}
  if(kind===1){const q=t%2;v=(Math.sin(q*1382)+.45*Math.sin(q*3671)+.23*Math.sin(q*5703))*Math.exp(-q*2.8)*Math.min(1,q*180)*.45;}
  if(kind===2){const q=t%3;v=low*Math.pow(Math.sin(Math.PI*q/3),2)*2;for(const off of [.2,.49]){const a=q-off;if(a>=0)v+=Math.sin(a*410)*Math.exp(-a*26)*Math.min(1,a*150)*.55;}}
  if(kind===3){const q=t%.6;v=(low*4+Math.sin(q*430)*.35)*Math.exp(-q*32)*Math.min(1,q*220);}
  if(kind===4){const q=t%.75;v=low*.65+Math.sin(1800*q+38*Math.sin(q*13))*Math.exp(-q*12)*Math.min(1,q*220)*.5;}
  d[i]=v*Math.min(1,t*50,(duration-t)*50);
 }
 return b;
}
function attach(p:Place,b:AudioBuffer){
 p.buffer=b;const r=ac!.createBuffer(b.numberOfChannels,b.length,b.sampleRate);
 for(let c=0;c<b.numberOfChannels;c++){const src=b.getChannelData(c),dst=r.getChannelData(c);for(let i=0;i<src.length;i++)dst[i]=src[src.length-1-i];}
 p.reverse=r;p.next=ac!.currentTime+.04;
}
function initAudio(){
 if(ac)return;ac=new AudioContext();master=ac.createGain();master.gain.value=0;
 const limit=ac.createDynamicsCompressor();limit.threshold.value=-12;limit.knee.value=12;limit.ratio.value=8;limit.attack.value=.003;limit.release.value=.2;
 analyser=ac.createAnalyser();analyser.fftSize=256;audioData=new Uint8Array(256);
 master.connect(limit);limit.connect(analyser);analyser.connect(ac.destination);
 places.forEach((p,i)=>attach(p,synth(i)));
}
async function listen(){
 try{initAudio();await ac!.resume();playing=true;entered=true;root.classList.add('entered');master!.gain.setTargetAtTime(.6,ac!.currentTime,.12);sound.textContent='Silence';hint.textContent='Hold to gather. Wander to find another sound.';}
 catch{hint.textContent='Audio could not start. Tap Listen to try again.';}
}
function silence(){playing=false;if(ac&&master)master.gain.setTargetAtTime(0,ac.currentTime,.06);sound.textContent='Listen';}
el('begin').onclick=()=>void listen();sound.onclick=()=>playing?silence():void listen();
// Scheduled Hann-windowed grains. Offsets follow the same running clock, never reset by touch.
const active=new Set<AudioBufferSourceNode>();
function schedule(){
 if(!ac||!playing||ac.state!=='running')return;
 const now=ac.currentTime;
 for(const p of places){
  if(!p.buffer||!p.reverse)continue;
  if(p.next<now)p.next=now+.025;
  if(p.weight<.008){p.next=now+.03;continue;}
  let count=0;
  while(p.next<now+.13&&count++<16){
   const dur=Math.min(p.buffer.duration,.045+(1-p.coherence)*.27);p.grain=dur;
   const phase=(p.next+p.phase)%Math.max(.01,p.buffer.duration-dur);
   // A growing forward contribution makes the settling source unambiguously recoverable.
   const forward=p.coherence*p.coherence;
   for(const rev of [false,true]){
    const mix=rev?1-forward:forward;if(mix<.005)continue;
    const src=ac.createBufferSource(),gain=ac.createGain(),pan=ac.createStereoPanner();
    src.buffer=rev?p.reverse:p.buffer;
    const offset=rev?Math.max(0,p.buffer.duration-phase-dur):phase;
    const env=new Float32Array(48),amp=p.weight*mix*.48;
    for(let i=0;i<env.length;i++)env[i]=Math.sin(Math.PI*i/(env.length-1))**2*amp;
    gain.gain.setValueCurveAtTime(env,p.next,dur);pan.pan.value=(p.x-.5)*1.3;
    src.connect(gain);gain.connect(pan);pan.connect(master!);active.add(src);
    src.onended=()=>{active.delete(src);src.disconnect();gain.disconnect();pan.disconnect();};
    src.start(p.next,offset,dur);
   }
   p.next+=dur/3;
  }
 }
}
const timer=window.setInterval(schedule,25);
function point(e:PointerEvent){return {x:clamp(e.clientX/W),y:clamp(e.clientY/H)}}
canvas.onpointerdown=e=>{
 e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);
 if(pending){placeImported(point(e));return;}
 if(touches.size>=2)return;
 const p=point(e);touches.set(e.pointerId,{...p,speed:0,age:0});focus=p;
 if(!playing)void listen();
};
canvas.onpointermove=e=>{const t=touches.get(e.pointerId);if(!t)return;const p=point(e);t.speed=clamp(t.speed+Math.hypot(p.x-t.x,p.y-t.y)*18);t.x=p.x;t.y=p.y;focus=p;};
function release(e:PointerEvent){touches.delete(e.pointerId);}
canvas.onpointerup=release;canvas.onpointercancel=release;canvas.onlostpointercapture=release;
function toggleReveal(){reveal=!reveal;el('reveal').setAttribute('aria-pressed',String(reveal));el('reveal').textContent=reveal?'Close layers':'Reveal';hint.textContent=reveal?'The moving marks follow the grains. Warm traces remember your hand.':'Hold to gather. Move between sounds. Two fingers bring places together.';}
el('reveal').onclick=toggleReveal;
canvas.onkeydown=e=>{
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)){e.preventDefault();if(!playing)void listen();
  if(e.key==='ArrowUp')focus.y=clamp(focus.y-.025,.12,.84);if(e.key==='ArrowDown')focus.y=clamp(focus.y+.025,.12,.84);
  if(e.key==='ArrowLeft')focus.x=clamp(focus.x-.025,.04,.96);if(e.key==='ArrowRight')focus.x=clamp(focus.x+.025,.04,.96);
  if(pending){if(e.key===' ')placeImported(focus);return;}
  const old=touches.get(-1);touches.set(-1,{...focus,speed:e.key===' '?0:.4,age:old?.age||0});
 }else if(e.key.toLowerCase()==='r')toggleReveal();
};
canvas.onkeyup=e=>{if(e.key===' '||e.key.startsWith('Arrow'))touches.delete(-1);};
addEventListener('blur',()=>touches.clear());
el('bring').onclick=()=>{if(pending){pending=null;hint.textContent='Placement cancelled.';el('bring').textContent='+ Bring sound';return;}el<HTMLInputElement>('file').click();};
el<HTMLInputElement>('file').onchange=async e=>{
 const input=e.target as HTMLInputElement,f=input.files?.[0];input.value='';if(!f||importing)return;
 if(f.size>25*1024*1024){hint.textContent='Choose an audio file smaller than 25 MB.';return;}
 importing=true;hint.textContent='Opening your sound…';
 try{initAudio();const decoded=await ac!.decodeAudioData(await f.arrayBuffer());
  if(decoded.duration<.05)throw new Error("Sound too short");
  const frames=Math.min(decoded.length,Math.floor(decoded.sampleRate*30));
  pending=ac!.createBuffer(Math.min(2,decoded.numberOfChannels),frames,decoded.sampleRate);
  for(let c=0;c<pending.numberOfChannels;c++)pending.copyToChannel(decoded.getChannelData(c).subarray(0,frames),c);
  pendingName=f.name.replace(/\.[^.]+$/,'').slice(0,32);hint.textContent='Touch a place for your sound. Up to 30 seconds stays on this device.';el('bring').textContent='Cancel placement';canvas.focus();
 }catch{hint.textContent='That audio could not be decoded. Try MP3, WAV or M4A.';}finally{importing=false;}
};
function placeImported(pos:{x:number;y:number}){
 if(!pending)return;
 const p:Place={...pos,y:clamp(pos.y,.15,.82),name:pendingName,color:[216,190,155],weight:0,coherence:.2,memory:.3,next:0,phase:0,grain:.2};
 // Bound audio and rendering work; replacing the oldest imported place leaves native places intact.
 if(places.length>=8)places.splice(5,1);attach(p,pending);places.push(p);pending=null;focus={x:p.x,y:p.y};
 el('bring').textContent='+ Bring sound';void listen();hint.textContent='Your sound lives here. Hold to gather it.';
}
function update(dt:number){
 const ts=[...touches.values()];for(const t of ts){t.age+=dt;t.speed*=Math.exp(-dt*5);}
 const points=ts.length?ts:[{...focus,speed:0,age:0}];
 const raw=places.map(p=>points.reduce((s,t)=>s+Math.exp(-((p.x-t.x)**2+(p.y-t.y)**2)/.048),0));
 const total=raw.reduce((a,b)=>a+b,0)||1;
 places.forEach((p,i)=>{
  p.weight+=(raw[i]/total-p.weight)*(1-Math.exp(-dt*3));
  const influence=ts.reduce((s,t)=>Math.max(s,Math.exp(-((p.x-t.x)**2+(p.y-t.y)**2)/.035)*(1-t.speed)),0);
  p.memory=clamp(p.memory+dt*(influence*.12-p.memory*.025));
  const target=clamp(.07+p.memory*.35+influence*.75);
  p.coherence+=(target-p.coherence)*(1-Math.exp(-dt*(target>p.coherence?1.4:.7)));
 });
 traceClock+=dt;if(ts.length&&traceClock>.06){traceClock=0;ts.forEach(t=>traces.push({x:t.x,y:t.y,v:1}));if(traces.length>160)traces.splice(0,traces.length-160);}
 for(let i=traces.length-1;i>=0;i--){traces[i].v-=dt/18;if(traces[i].v<=0)traces.splice(i,1);}
 revealMix+=(Number(reveal)-revealMix)*(1-Math.exp(-dt*5));
}
function paint(){
 ctx.fillStyle='#080d10';ctx.fillRect(0,0,W,H);
 // Overlapping volumes share the entire field; no tile boundaries or sample buttons.
 for(const p of places){
  const [r,g,b]=p.color,x=p.x*W,y=p.y*H,rad=Math.max(W*.43,H*.29);
  const glow=ctx.createRadialGradient(x,y,0,x,y,rad);glow.addColorStop(0,`rgba(${r},${g},${b},${.055+p.weight*.065+level*.07})`);glow.addColorStop(1,`rgba(${r},${g},${b},0)`);ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);
 }
 const separation=revealMix*22;
 for(let layer=0;layer<3;layer++){
  for(let line=0;line<48;line++){
   const yy=(.12+line/62)*H,phase=line*.31+layer*.8;
   ctx.beginPath();let tint=places[Math.floor(line/10)%places.length].color;
   for(let j=0;j<=52;j++){
    const x=j/52*W,nx=x/W,ny=yy/H;let displacement=0,coherence=0;
    for(const p of places){const dist=(nx-p.x)**2+(ny-p.y)**2,k=Math.exp(-dist/.045);
     coherence+=k*p.coherence;displacement+=k*Math.sin(nx*9+phase+p.phase+clock*(reduced?0:.12))*(19+level*55)*(1-p.coherence*.65);
    }
    for(const t of touches.values()){const dx=nx-t.x,dy=ny-t.y,k=Math.exp(-(dx*dx+dy*dy)/.022);displacement+=k*dy*H*.4;}
    for(let q=0;q<traces.length;q+=4){const t=traces[q],k=Math.exp(-((nx-t.x)**2+(ny-t.y)**2)/.004);displacement+=k*t.v*3;}
    const fine=Math.sin(nx*54+phase*3+Math.sin(nx*11+phase))*2.5*(1-clamp(coherence));
    const y=yy+displacement+fine+layer*2+separation*(layer-1)*Math.sin(nx*3+1);
    if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
   }
   ctx.strokeStyle=`rgba(${tint.join(',')},${.12+layer*.065})`;ctx.lineWidth=layer===2?.65:1;ctx.stroke();
  }
 }
 for(const t of traces){ctx.beginPath();ctx.ellipse(t.x*W,t.y*H,2+t.v*4,1.2,0,0,Math.PI*2);ctx.fillStyle=`rgba(229,199,151,${t.v*.13})`;ctx.fill();}
 if(touches.size===2){const [a,b]=[...touches.values()];ctx.beginPath();ctx.moveTo(a.x*W,a.y*H);ctx.bezierCurveTo(a.x*W,b.y*H,b.x*W,a.y*H,b.x*W,b.y*H);ctx.strokeStyle='rgba(225,207,170,.35)';ctx.lineWidth=1;ctx.stroke();}
 for(const t of touches.values()){
  const radius=18+Math.min(t.age,3)*10;const glow=ctx.createRadialGradient(t.x*W,t.y*H,0,t.x*W,t.y*H,radius*2);glow.addColorStop(0,'rgba(237,224,188,.23)');glow.addColorStop(1,'rgba(237,224,188,0)');ctx.fillStyle=glow;ctx.fillRect(t.x*W-radius*2,t.y*H-radius*2,radius*4,radius*4);
  ctx.beginPath();ctx.arc(t.x*W,t.y*H,radius,0,Math.PI*2);ctx.strokeStyle='rgba(231,219,185,.4)';ctx.lineWidth=.6;ctx.stroke();
 }
 for(const p of places){
  const x=p.x*W,y=p.y*H;ctx.fillStyle=`rgba(${p.color.join(',')},${.35+p.weight*.5})`;ctx.beginPath();ctx.arc(x,y,1.8,0,Math.PI*2);ctx.fill();
  if(revealMix>.01){ctx.save();ctx.globalAlpha=revealMix;ctx.font='10px ui-monospace,monospace';ctx.textAlign='center';ctx.fillStyle='#d5d4c4';ctx.fillText(p.name,x,y-29);ctx.fillStyle='#92a49f';ctx.fillText(`${Math.round(p.grain*1000)} ms · ${Math.round(p.coherence*100)}% gathered`,x,y-14);
   // The read head traverses an exposed temporal ribbon in reverse, using the audio clock.
   ctx.strokeStyle='rgba(184,198,182,.35)';ctx.beginPath();ctx.moveTo(x-34,y+12);ctx.lineTo(x+34,y+12);ctx.stroke();
   const ph=ac?(ac.currentTime+p.phase)%p.grain/p.grain:0;ctx.fillStyle='#e2bb7b';ctx.fillRect(x+34-ph*68,y+9,2,6);ctx.restore();}
 }
 if(pending){ctx.strokeStyle='#e6d6b7';ctx.setLineDash([3,6]);ctx.beginPath();ctx.arc(focus.x*W,focus.y*H,27,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
}
let textClock=0;
function frame(now:number){
 const dt=Math.min(.05,(now-last)/1000);last=now;clock+=dt;update(dt);
 if(analyser&&audioData&&playing){analyser.getByteTimeDomainData(audioData);let s=0;for(const a of audioData)s+=((a-128)/128)**2;level+=(Math.sqrt(s/audioData.length)*4-level)*.2;}else level*=.95;
 paint();textClock+=dt;
 if(textClock>.25){textClock=0;const ranked=[...places].sort((a,b)=>b.weight-a.weight);where.textContent=entered?ranked.filter(p=>p.weight>.23).slice(0,2).map(p=>p.name).join(' × '):'touch / hold / wander';detail.textContent=reveal?'local reversal / continuous transport / decaying touch memory':pending?'local audio · never uploaded':'';}
 frameId=requestAnimationFrame(frame);
}
if(preview)root.classList.add('preview');
frameId=requestAnimationFrame(frame);
document.addEventListener('visibilitychange',()=>{if(document.hidden){touches.clear();silence();if(ac)void ac.suspend();cancelAnimationFrame(frameId);}else{last=performance.now();frameId=requestAnimationFrame(frame);}});
addEventListener('pagehide',(event:PageTransitionEvent)=>{if(event.persisted){silence();return;}clearInterval(timer);cancelAnimationFrame(frameId);for(const s of active)try{s.stop();}catch{}if(ac)void ac.close();});
