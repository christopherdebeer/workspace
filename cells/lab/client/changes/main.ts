import {cadences,castContext,deterministicCast,type Cadence,type CastContext} from './casting';
import {classical} from './classical';
import {hexagrams,identify,stableLines,moving,type Line} from './model';
const $ = <T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const params=new URLSearchParams(location.search), preview=params.has('preview');
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
let lines:Line[]=[], busy=false, question='', currentView='cast', explored=false, savedId='';
type Entry={id:string,date:string,lines:Line[],question:string,note:string,context?:CastContext};
let context:CastContext|undefined;
let cadence:Cadence='hourly';
try {const stored=localStorage.getItem('lab.changes.cadence.v1');if(cadences.includes(stored as Cadence))cadence=stored as Cadence;} catch {}
const cadenceSelect=$<HTMLSelectElement>('cadence');
cadenceSelect.value=cadence;
cadenceSelect.onchange=()=>{cadence=cadenceSelect.value as Cadence;reset();try{localStorage.setItem('lab.changes.cadence.v1',cadence);$('cadence-note').textContent='Same question, same cast within each local time window.';}catch{$('cadence-note').textContent='Preference applies for this visit; browser storage is unavailable.';}};
const storageKey='lab.changes.journal.v1';
function journal():Entry[]{try{const a=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(a)?a.filter(e=>e&&typeof e.id==='string'&&typeof e.date==='string'&&typeof e.note==='string'&&typeof e.question==='string'&&Array.isArray(e.lines)&&e.lines.length===6&&e.lines.every((n:number)=>[6,7,8,9].includes(n))).slice(0,100):[];}catch{return[];}}
function figure(values:Line[],relating=false){return Array.from({length:6},(_,i)=>{const v=values[i];const yang=v && ((v%2) ^ (relating&&moving(v)?1:0));return `<div class="line ${!v?'empty':yang?'yang':'yin'} ${v&&moving(v)&&!relating?'changing':''}" data-line="${i}"><i></i>${v&&!yang?'<i></i>':''}</div>`;}).join('');}
function describe(values:Line[]){return values.map((v,i)=>`Line ${i+1}: ${v%2?'yang':'yin'}${moving(v)?', changing':''}`).join('; ');}
function show(view:string){currentView=view;for(const id of ['cast','reading','journal','browse'])$(id).hidden=id!==view;$('back').textContent=view==='cast'?'← lab':'← cast';$('back').setAttribute('href',view==='cast'?'/':'#');window.scrollTo(0,0);if(view!=='cast')$(view).focus({preventScroll:true});}
function paint(){const f=$('figure');f.innerHTML=figure(lines);f.setAttribute('aria-label',lines.length?describe(lines):'Six uncast lines');if(lines.length===6){const h=identify(lines);$('identity').innerHTML=`<h1><span class="eyebrow">${h.number} · </span>${h.title}</h1><div class="han" lang="zh">${h.han}</div><p class="pinyin">${h.pinyin}</p>`;}else $('identity').innerHTML='';}
function setURL(){const q=new URLSearchParams();q.set('cast',lines.join(''));history.replaceState(null,'','/changes?'+q);}
function finish(){busy=false;const count=lines.filter(moving).length;$('progress').textContent=count?`${count} changing ${count===1?'line':'lines'} · marked beside the figure`:'No changing lines';$('roll').hidden=true;$('read').hidden=false;$<HTMLInputElement>('question').disabled=true;cadenceSelect.disabled=false;$('browse-button').hidden=false;setURL();}
async function roll(){
  if(busy)return;
  busy=true;explored=false;savedId='';
  question=$<HTMLInputElement>('question').value.trim();
  context=castContext(cadence); // Capture once, before hashing or animation crosses a boundary.
  lines=[];paint();$('roll').setAttribute('disabled','');$('browse-button').hidden=true;
  $<HTMLInputElement>('question').disabled=true;cadenceSelect.disabled=true;
  try{
    const result=await deterministicCast(question,context);
    for(let i=0;i<6;i++){
      if(!reduced)await new Promise(r=>setTimeout(r,480));
      lines.push(result[i]);paint();$('figure').children[i].classList.add('fresh');
      $('progress').textContent=`Line ${i+1} of 6 · ${lines[i]%2?'yang':'yin'}${moving(lines[i])?' · changing':''}`;
    }
    finish();
  }catch{
    busy=false;context=undefined;lines=[];paint();
    $('progress').textContent='Could not prepare this cast. Please try again.';
    $<HTMLInputElement>('question').disabled=false;$('browse-button').hidden=false;
  }finally{$('roll').removeAttribute('disabled');cadenceSelect.disabled=false;}
}
function reset(){if(busy)return;context=undefined;$<HTMLInputElement>('question').disabled=false;lines=[];savedId='';explored=false;$('roll').hidden=false;$('read').hidden=true;$('progress').textContent='A moment to consider.';history.replaceState(null,'','/changes');paint();show('cast');}

function classicalText(number:number, compact=false) {
  const t=classical[number];
  const source='https://sacred-texts.com/ich/ic'+String(number).padStart(2,'0')+'.htm';
  return `<div class="classical"><div class="eyebrow">The received text · James Legge, 1882</div><h3>The Judgment</h3><blockquote>${esc(t.judgment)}</blockquote><h3>The Image</h3><blockquote>${esc(t.image)}</blockquote><p class="caption"><a href="${source}" target="_blank" rel="noopener">Translation source</a> · <a href="https://sacred-texts.com/ich/icap2-${number<=30?1:2}.htm" target="_blank" rel="noopener">Image source</a></p>${compact?'':'<p class="caption">Legge’s historical wording and romanisation are retained. “The superior man” is his recurring term for the exemplary person; “NINE” and “SIX” name yang and yin lines.</p>'}</div>`;
}
function linePassage(number:number,n:number) {
  return `<div class="line-passage"><h4>Line ${n} · ${lines[n-1]%2?'yang':'yin'}${moving(lines[n-1])?' · changing':''}</h4><blockquote>${esc(classical[number].lines[n-1])}</blockquote></div>`;
}

function reading(note=''){
  const h=identify(lines), next=identify(lines,true), changes=lines.map((v,i)=>moving(v)?i+1:0).filter(Boolean);
  $('reading').innerHTML=`<div class="eyebrow">${explored?'Exploring':'Cast'} · ${h.number} of 64</div><h2>${h.pinyin} · ${h.title}</h2><div class="reading-top"><div class="figure" role="img" aria-label="${describe(lines)}">${figure(lines)}</div><div class="trigrams"><small>ABOVE</small>${h.upper.name} · ${h.upper.image}<small>BELOW</small>${h.lower.name} · ${h.lower.image}</div></div>${question?`<p class="query">${esc(question)}</p>`:''}${context&&!explored?`<p class="caption">${esc(context.cadence)} cast · ${esc(context.window)} · ${esc(context.zone)}</p>`:''}${classicalText(h.number)}<div class="section"><h3>${changes.length?'The changing lines':'The figure at rest'}</h3>${changes.length?`<p class="caption">Read from the bottom upwards. A marked line changes to its opposite in the relating figure.</p>${changes.map(n=>linePassage(h.number,n)).join('')}${changes.length===6&&classical[h.number].allChanging?`<div class="line-passage"><h4>When all six lines change</h4><blockquote>${esc(classical[h.number].allChanging!)}</blockquote></div>`:''}<div class="reading-top"><div class="figure" role="img" aria-label="Relating hexagram ${next.number}">${figure(lines,true)}</div><div><div class="eyebrow">Relating figure · ${next.number}</div><h3>${next.pinyin} · ${next.title}</h3></div></div>${classicalText(next.number,true)}<p class="caption">Read this relating figure alongside the first as a perspective on change.</p>`:'<p class="caption">No lines change in this figure. Stay with its image and the question it opens.</p>'}</div><details class="section all-lines"><summary>${changes.length?'Read all six line passages':'Read the six line passages'}</summary>${[1,2,3,4,5,6].map(n=>linePassage(h.number,n)).join('')}</details><div class="section"><h3>A question to sit with</h3><p class="reflection supplementary">${h.prompt}</p><p class="caption">A modern reflection prompt, offered alongside the classical text.</p></div>${!explored?`<div class="section"><label for="note">What do you notice?</label><p class="caption">Only saved when you choose to keep this reading.</p><textarea id="note" maxlength="5000" placeholder="A few words for later…">${esc(note)}</textarea><div class="actions"><button id="save">${savedId?'Update journal':'Keep in journal'}</button><button id="share">Copy cast link</button></div><p id="save-status" role="status"></p></div>`:''}<div class="actions"><button id="new">New cast</button><button id="explore">Explore all 64</button></div><details class="section"><summary>About this experiment</summary><p class="caption">Six deterministic three-coin throws, built bottom to top. The question and your chosen local calendar window determine the entire cast, including changing lines. Blank questions work too. Weeks begin on Monday; hourly is the default. Capitalisation and extra whitespace are ignored; punctuation is retained. Each coin contributes 2 or 3. Totals 6 and 9 change; 7 and 8 stay. The relating figure flips only the changing lines. All 64 figures use the King Wen sequence. Kǎn is labelled Water; cloud is an associated image used in the reference app.</p><p class="caption">Inspired by the supplied iOS app: open space, blue lines, a single Roll action, then a reading. English names vary between editions. The Judgment, Image and line passages are from James Legge’s 1882 public-domain translation. The short reflection prompts are newly written. This selection does not include the complete commentaries.</p><p class="caption"><a href="https://en.wikipedia.org/wiki/List_of_hexagrams_of_the_I_Ching" target="_blank" rel="noopener">Hexagram reference</a> · <a href="https://iching-bazi-fengshui.com/en/iching/coin-method/" target="_blank" rel="noopener">Casting method</a> · <a href="/changes/readme">Experiment notes</a></p></details>`;
  $('new').onclick=reset;$('explore').onclick=browse;
  if(!explored){$('save').onclick=()=>{try{const all=journal();const entry:Entry={id:savedId||crypto.randomUUID(),date:new Date().toISOString(),lines:[...lines],question,context,note:$<HTMLTextAreaElement>('note').value};const i=all.findIndex(e=>e.id===entry.id);if(i>=0)all[i]=entry;else all.unshift(entry);localStorage.setItem(storageKey,JSON.stringify(all.slice(0,100)));savedId=entry.id;$('save-status').textContent='Kept in this browser.';$('save').textContent='Update journal';}catch{$('save-status').textContent='This browser could not save the reading. You can copy your note instead.';}};$('share').onclick=async()=>{const url=location.origin+'/changes?cast='+lines.join('');try{await navigator.clipboard.writeText(url);$('save-status').textContent='Cast link copied. Your question and note are not included.';}catch{$('save-status').textContent='Cast link: '+url;}};}
  show('reading');
}
function browse(){$('browse-list').innerHTML=hexagrams.map(h=>`<button data-number="${h.number}"><span aria-hidden="true">${String.fromCodePoint(0x4dc0+h.number-1)}</span> ${h.number} · ${h.title}</button>`).join('');$('browse-list').querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.onclick=()=>{lines=stableLines(Number(b.dataset.number));explored=true;question='';context=undefined;savedId='';reading();});show('browse');}
function historyView(){if(busy)return;const all=journal();$('journal-list').innerHTML=all.length?all.map((e,i)=>{const h=identify(e.lines);return `<article class="entry"><small>${esc(new Date(e.date).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}))}</small><button data-entry="${i}">${h.number} · ${h.title} →</button>${e.question?`<p>${esc(e.question)}</p>`:''}${e.note?`<p>${esc(e.note)}</p>`:''}</article>`;}).join(''):'<p class="caption">Nothing kept yet. Cast, read, then choose “Keep in journal”.</p>';$('journal-list').querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.onclick=()=>{const e=all[Number(b.dataset.entry)];lines=[...e.lines];question=e.question;$<HTMLInputElement>('question').value=question;context=e.context;savedId=e.id;explored=false;reading(e.note);});show('journal');}
$('roll').onclick=roll;$('read').onclick=()=>reading();$('history').onclick=historyView;$('browse-button').onclick=browse;$('back').onclick=e=>{if(currentView!=='cast'){e.preventDefault();reset();}};
if(preview){document.documentElement.classList.add('preview');lines=stableLines(3);paint();}
else if(/^[6789]{6}$/.test(params.get('cast')||'')){lines=[...params.get('cast')!].map(Number) as Line[];paint();finish();}
else if(params.has('hex')&&Number(params.get('hex'))>=1&&Number(params.get('hex'))<=64&&Number.isInteger(Number(params.get('hex')))){lines=stableLines(Number(params.get('hex')));explored=true;reading();}
else paint();
