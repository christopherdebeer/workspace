/** Afterword: RSVP with peripheral context; URL fragment is the only state store. */
type Mode='off'|'rail'|'passage';
type Sound='off'|'click'|'bass'|'both';
type State={text:string;i:number;wpm:number;mode:Mode;span:number;opacity:number;pause:number;font:number;sound:Sound;volume:number;group:number;run:boolean};
const SAMPLE="Reading is not a race between the eye and the page. The mind gathers meaning in phrases, anticipates what might come next, and sometimes moves backward to repair an incomplete thought.\n\nWhat changes when the next few words remain visible, but subdued? Perhaps a small preview restores anticipation without demanding a saccade. Perhaps a trace of previous words makes regression possible without losing the reading point.\n\nThis is an experiment, not a promise of faster comprehension. Find a pace that lets the sentence form. Then touch the surface: left to step back, right to step forward, swipe to scan, or use the timeline to seek.";
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const num=(s:string|null,d:number,a:number,b:number)=>clamp(s!==null&&s.trim()!==''&&Number.isFinite(+s)?+s:d,a,b);
function decode():State{
 const p=new URLSearchParams(location.hash.slice(1)),m=p.get('mode'),s=p.get('sound');
 return {text:p.get('text')??SAMPLE,i:Math.floor(num(p.get('i'),0,0,1e6)),
 wpm:Math.round(num(p.get('wpm'),350,80,1200)),mode:m==='off'||m==='passage'?m:'rail',
 span:Math.round(num(p.get('span'),7,1,24)),opacity:Math.round(num(p.get('opacity'),42,0,100)),
 pause:num(p.get('pause'),1,0,3),font:Math.round(num(p.get('font'),46,28,72)),
 sound:s==='click'||s==='bass'||s==='both'?s:'off',volume:num(p.get('volume'),38,0,100),
 group:Math.round(num(p.get('group'),4,2,8)),run:false};
}
const preview=new URLSearchParams(location.search).has('preview');
let state=decode(),words:string[]=[],timer:ReturnType<typeof setTimeout>|null=null;
let saveTimer:ReturnType<typeof setTimeout>|null=null,lastSave=0,audio:AudioContext|null=null;
let gesture:{id:number;x:number;y:number;initial:number;moved:boolean}|null=null;
const stage=$('stage'),before=$('before'),after=$('after'),progress=$<HTMLInputElement>('progress');
const controlIds=['wpm','mode','span','opacity','pause','font','sound','volume','group'] as const;
const split=(s:string)=>s.match(/\S+/gu)||[];
function fragment(){
 const p=new URLSearchParams();
 for(const [k,v] of Object.entries(state))if(k!=='run')p.set(k,String(v));
 return '#'+p.toString();
}
function save(force=false){
 if(preview)return;
 if(saveTimer!==null){clearTimeout(saveTimer);saveTimer=null;}
 const wait=force?0:Math.max(0,600-(performance.now()-lastSave));
 if(wait){saveTimer=setTimeout(()=>save(true),wait);return;}
 history.replaceState(null,'',location.pathname+location.search+fragment());lastSave=performance.now();
}
function rebuild(){words=split(state.text);if(!words.length)words=['—'];state.i=clamp(Math.floor(state.i),0,words.length-1);progress.max=String(words.length-1);}
function orp(w:string){
 const chars=Array.from(w),letters:number[]=[];
 chars.forEach((c,i)=>{if(/[\p{L}\p{N}]/u.test(c))letters.push(i);});
 const n=letters.length,rank=n<=1?0:n<=5?1:n<=9?2:n<=13?3:4;
 return letters[Math.min(rank,n-1)]??Math.floor(chars.length/2);
}
function ghost(el:HTMLElement,tokens:string[],prior:boolean){
 el.replaceChildren();el.classList.toggle('passage',state.mode==='passage');
 if(state.mode==='passage'){el.textContent=tokens.join(' ');return;}
 tokens.forEach((t,j)=>{const s=document.createElement('span');s.className='ghost-token';
 const distance=prior?tokens.length-1-j:j;
 s.style.opacity=String(clamp(1-distance/Math.max(1,state.span*1.9),.22,1));
 s.textContent=t;el.appendChild(s);});
}
function paint(){
 state.i=clamp(state.i,0,words.length-1);
 const w=words[state.i],chars=Array.from(w),p=orp(w);
 $('word-before').textContent=chars.slice(0,p).join('');
 $('word-anchor').textContent=chars[p]||' ';
 $('word-after').textContent=chars.slice(p+1).join('');
 $('readout').textContent=String(state.i+1)+' / '+words.length;
 $('percentage').textContent=Math.round(100*(state.i+1)/words.length)+'%';
 progress.value=String(state.i);
 stage.style.setProperty('--focus-size',state.font+'px');
 stage.style.setProperty('--ghost-opacity',String(state.mode==='off'?0:state.opacity/100));
 stage.classList.toggle('no-context',state.mode==='off');
 const n=state.mode==='passage'?state.span*5:state.span;
 ghost(before,words.slice(Math.max(0,state.i-n),state.i),true);
 ghost(after,words.slice(state.i+1,state.i+1+n),false);
 stage.setAttribute('aria-label','Current word '+w+'. Tap left to regress, right to advance, centre to toggle. Swipe to scan.');
}
function seek(i:number){state.i=clamp(Math.round(i),0,words.length-1);paint();save();}
function move(d:number){seek(state.i+d);}
function duration(w:string){
 const n=Array.from(w).filter(c=>/[\p{L}\p{N}]/u.test(c)).length;
 let f=clamp(1+(n-5)*.032,.86,1.4);
 if(/[,，]["'”’)]?$/.test(w))f+=.22*state.pause;
 if(/[;:—–]["'”’)]?$/.test(w))f+=.35*state.pause;
 if(/[.!?。！？]["'”’)]?$/.test(w))f+=.85*state.pause;
 return 60000/state.wpm*f;
}
function enableAudio(){
 if(state.sound==='off'||preview)return;
 try{if(!audio){const C=(window.AudioContext||(window as any).webkitAudioContext) as typeof AudioContext;audio=new C();}
 if(audio.state!=='running')void audio.resume();}
 catch{$('audio-status').textContent='Audio unavailable in this browser.';}
}
function note(freq:number,len:number,gain:number,low=0){
 if(!audio||audio.state!=='running')return;
 const t=audio.currentTime+.004,o=audio.createOscillator(),g=audio.createGain();
 o.type='sine';o.frequency.setValueAtTime(freq,t);
 if(low)o.frequency.exponentialRampToValueAtTime(low,t+len*.8);
 g.gain.setValueAtTime(.0001,t);
 g.gain.exponentialRampToValueAtTime(Math.max(.0001,gain),t+.007);
 g.gain.exponentialRampToValueAtTime(.0001,t+len);
 o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+len+.012);
 o.onended=()=>{o.disconnect();g.disconnect();};
}
function beat(){
 if(!audio||audio.state!=='running'||state.sound==='off')return;
 const v=state.volume/100;
 if(state.sound==='click'||state.sound==='both')note(1150,.032,.065*v);
 if((state.sound==='bass'||state.sound==='both')&&state.i%state.group===0)note(118,.17,.23*v,54);
}
function stop(persist=true){
 if(timer!==null){clearTimeout(timer);timer=null;}
 const was=state.run;state.run=false;$('play').textContent='▶';
 $('play').setAttribute('aria-label','Play reading');
 if(was&&persist)save(true);
}
function next(){
 timer=null;if(!state.run)return;
 if(state.i>=words.length-1){stop();return;}
 state.i++;paint();beat();save();
 timer=setTimeout(next,duration(words[state.i]));
}
function start(){
 if(state.run)return;
 if(state.i===words.length-1)state.i=0;
 state.run=true;enableAudio();paint();$('play').textContent='Ⅱ';
 $('play').setAttribute('aria-label','Pause reading');
 beat();save(true);timer=setTimeout(next,duration(words[state.i]));
}
function toggle(){if(state.run)stop();else start();}
function refresh(){
 $<HTMLInputElement>('wpm').value=String(state.wpm);
 $<HTMLSelectElement>('mode').value=state.mode;
 $<HTMLInputElement>('span').value=String(state.span);
 $<HTMLInputElement>('opacity').value=String(state.opacity);
 $<HTMLInputElement>('pause').value=String(state.pause);
 $<HTMLInputElement>('font').value=String(state.font);
 $<HTMLSelectElement>('sound').value=state.sound;
 $<HTMLInputElement>('volume').value=String(state.volume);
 $<HTMLSelectElement>('group').value=String(state.group);
 $('wpm-label').textContent=String(state.wpm);
 $('span-label').textContent=String(state.span);
 $('opacity-label').textContent=String(state.opacity)+'%';
 $('pause-label').textContent=state.pause.toFixed(1);
 $('font-label').textContent=String(state.font)+'px';
 $('volume-label').textContent=String(state.volume)+'%';
 $('sound-options').hidden=state.sound==='off';
}
function bind(){
 $('play').addEventListener('click',toggle);
 $('back').addEventListener('click',()=>{stop();move(-1);});
 $('forward').addEventListener('click',()=>{stop();move(1);});
 $('back-sentence').addEventListener('click',()=>{stop();move(-10);});
 $('forward-sentence').addEventListener('click',()=>{stop();move(10);});
 progress.addEventListener('pointerdown',()=>stop());
 progress.addEventListener('input',()=>seek(+progress.value));
 progress.addEventListener('change',()=>save(true));
 stage.addEventListener('pointerdown',(e:PointerEvent)=>{
  if(e.button!==0)return;
  gesture={id:e.pointerId,x:e.clientX,y:e.clientY,initial:state.i,moved:false};
  stage.setPointerCapture(e.pointerId);
 });
 stage.addEventListener('pointermove',(e:PointerEvent)=>{
  if(!gesture||gesture.id!==e.pointerId)return;
  const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
  if(Math.abs(dx)>10||Math.abs(dy)>14)gesture.moved=true;
  if(!gesture.moved)return;
  if(state.run)stop();
  const n=Math.sign(dx)*Math.floor(Math.pow(Math.abs(dx)/19,1.24));
  seek(gesture.initial+n);
 });
 stage.addEventListener('pointerup',(e:PointerEvent)=>{
  if(!gesture||gesture.id!==e.pointerId)return;
  const g=gesture;gesture=null;
  if(!g.moved){
   const r=stage.getBoundingClientRect(),x=(e.clientX-r.left)/r.width;
   if(x<.34){stop();move(-1);}
   else if(x>.66){stop();move(1);}
   else toggle();
  }else save(true);
 });
 stage.addEventListener('pointercancel',()=>{gesture=null;save(true);});
 addEventListener('keydown',e=>{
  if((e.target as HTMLElement).closest('input,textarea,select,button,details,[contenteditable]'))return;
  if(e.key==='ArrowLeft'){e.preventDefault();stop();move(-1);}
  else if(e.key==='ArrowRight'){e.preventDefault();stop();move(1);}
  else if(e.key===' '){e.preventDefault();toggle();}
 });
 for(const key of controlIds){
  const el=$(key) as HTMLInputElement|HTMLSelectElement;
  el.addEventListener('input',()=>{
   if(key==='wpm')state.wpm=+el.value;
   else if(key==='mode')state.mode=el.value as Mode;
   else if(key==='span')state.span=+el.value;
   else if(key==='opacity')state.opacity=+el.value;
   else if(key==='pause')state.pause=+el.value;
   else if(key==='font')state.font=+el.value;
   else if(key==='sound')state.sound=el.value as Sound;
   else if(key==='volume')state.volume=+el.value;
   else if(key==='group')state.group=+el.value;
   if(key==='sound'&&state.run)enableAudio();
   if((key==='wpm'||key==='pause')&&state.run){if(timer!==null)clearTimeout(timer);timer=setTimeout(next,duration(words[state.i]));}
   refresh();paint();save();
  });
  el.addEventListener('change',()=>save(true));
 }
 $('edit').addEventListener('click',()=>{stop();$<HTMLTextAreaElement>('source').value=state.text;$('editor').hidden=false;$<HTMLTextAreaElement>('source').focus();});
 $('close-editor').addEventListener('click',()=>{$('editor').hidden=true;});
 $('close-editor-bottom').addEventListener('click',()=>{$('editor').hidden=true;});
 $('use-text').addEventListener('click',()=>{
  const text=$<HTMLTextAreaElement>('source').value.trim();
  if(!text){$('edit-status').textContent='Paste or type some text first.';return;}
  state.text=text;state.i=0;rebuild();paint();save(true);
  $('editor').hidden=true;$('edit-status').textContent='';
 });
 $('copy').addEventListener('click',async()=>{
  save(true);
  try{await navigator.clipboard.writeText(location.href);$('share-status').textContent='Link copied with text, position and settings.';}
  catch{$('share-status').textContent='Copy this page address from your browser to share the reading.';}
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
 addEventListener('hashchange',()=>{stop(false);state=decode();rebuild();refresh();paint();});
}
rebuild();refresh();paint();
if(preview){document.documentElement.classList.add('preview');state.mode='passage';state.span=5;state.i=12;paint();}
else bind();
(window as any).__rsvp={probe:()=>({index:state.i,count:words.length,word:words[state.i],wpm:state.wpm,mode:state.mode,sound:state.sound,playing:state.run}),seek:(i:number)=>{stop();seek(i);}};
