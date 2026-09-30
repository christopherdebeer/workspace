import {BANDS, equation, type Challenge, type Expr} from './challenges';

/** The equation describes the dew being gathered on the river. No number entry. */
export class ChallengeUI {
  private root=document.createElement('section');
  private prompt=document.createElement('div');
  private tools=document.createElement('div');
  private feedback=document.createElement('p');
  private support=document.createElement('div');
  private menu=document.createElement('div');
  private range=document.createElement('button');
  private live=document.getElementById('live')!;
  private blanks:HTMLButtonElement[]=[];
  private current:Challenge|null=null;
  private active=0;
  private values:number[]=[];
  private helpStep=0;
  private visible=false;
  private solved=false;
  private helpButton:HTMLButtonElement;
  onSubmit:()=>void=()=>{};
  onSlot:(index:number)=>void=()=>{};
  onClear:()=>void=()=>{};
  onHelp:()=>void=()=>{};
  onBand:(band:number)=>void=()=>{};
  onSkip:()=>void=()=>{};
  constructor(){
    this.root.id='relationship';this.root.hidden=true;this.root.setAttribute('aria-label','Maths challenge');
    this.prompt.className='equation';this.tools.className='math-tools';this.feedback.className='math-feedback';
    this.support.className='math-support';this.support.hidden=true;
    this.menu.className='math-menu';this.menu.hidden=true;
    const button=(text:string,fn:()=>void,parent=this.tools)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;parent.append(b);return b;};
    this.helpButton=button('a hint',()=>this.help());
    button('another',()=>this.onSkip());
    button('let go',()=>this.onClear());
    button('check',()=>this.onSubmit());
    this.range.type='button';this.range.id='math-range';this.range.textContent='maths';this.range.hidden=true;
    this.range.setAttribute('aria-expanded','false');
    this.range.onclick=()=>{this.menu.hidden=!this.menu.hidden;this.range.setAttribute('aria-expanded',String(!this.menu.hidden));};
    const h=document.createElement('p');h.textContent='Choose where to begin. The river adapts from here.';this.menu.append(h);
    BANDS.forEach(([label,detail],i)=>{const b=button('',()=>{this.onBand(i);this.menu.hidden=true;this.range.setAttribute('aria-expanded','false');},this.menu);b.dataset.band=String(i);b.append(document.createTextNode(label));const s=document.createElement('small');s.textContent=detail;b.append(s);});
    button('close',()=>{this.menu.hidden=true;this.range.setAttribute('aria-expanded','false');this.range.focus();},this.menu);
    this.root.append(this.prompt,this.feedback,this.tools,this.support);
    document.getElementById('ui')!.append(this.root,this.range,this.menu);
    this.root.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){this.support.hidden=true;}});
    this.menu.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){this.menu.hidden=true;this.range.setAttribute('aria-expanded','false');this.range.focus();}});
  }
  setBand(b:number){this.menu.querySelectorAll<HTMLButtonElement>('[data-band]').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.band)===b)));this.range.title=BANDS[b][0];}
  started(){this.range.hidden=false;}
  show(c:Challenge){
    this.current=c;this.solved=false;this.visible=true;this.root.hidden=false;this.root.classList.remove('answered');
    this.prompt.replaceChildren();this.blanks=[];this.active=0;this.values=Array(c.answers.length).fill(0);this.helpStep=0;this.helpButton.textContent='a hint';
    this.support.hidden=true;this.support.replaceChildren();this.feedback.textContent=this.instructions(c);
    this.tools.querySelectorAll('button').forEach(b=>b.disabled=false);
    const render=(e:Expr,parent:HTMLElement)=>{
      if(typeof e==='number'){parent.append(document.createTextNode(String(e)));return;}
      if('slot'in e){
        const blank=document.createElement('button');blank.type='button';blank.className='math-blank';blank.textContent='?';
        blank.setAttribute('aria-label',`Gather dew for missing number ${e.slot+1} in ${equation(c)}`);
        blank.onclick=()=>{if(this.solved)return;this.active=e.slot;this.onSlot(e.slot);this.support.hidden=true;};
        this.blanks[e.slot]=blank;parent.append(blank);return;
      }
      render(e.a,parent);const sign=document.createElement('span');sign.textContent=e.op;parent.append(sign);render(e.b,parent);
    };
    render(c.left,this.prompt);const eq=document.createElement('span');eq.textContent='=';this.prompt.append(eq);render(c.right,this.prompt);
    this.progress(this.values,0);
    this.live.textContent=equation(c)+'. '+this.instructions(c);
  }
  hide(){this.visible=false;this.root.hidden=true;this.current=null;}
  suspend(value:boolean){this.root.hidden=value||!this.visible;if(value){this.menu.hidden=true;this.range.setAttribute('aria-expanded','false');}this.range.hidden=value;}
  private instructions(c:Challenge){return c.answers.length>1?'Gather dew for each blank · touch a blank to switch · factors 2–12':'Touch or trace dewy pads to fill the missing number.';}
  progress(values:number[],active:number){
    if(!this.current||this.solved)return;
    this.values=values;this.active=active;this.support.hidden=true;
    this.blanks.forEach((el,i)=>{el.textContent=values[i]?String(values[i]):'?';el.setAttribute('aria-pressed',String(i===active));el.setAttribute('aria-label',`Missing number ${i+1}: ${values[i]} drops gathered${i===active?', gathering here':''}`);});
    this.feedback.textContent=this.instructions(this.current);
    this.live.textContent=`${values[active]} drops for missing number ${active+1}. Touch a chosen pad again to let it go.`;
  }
  message(text:string){this.feedback.textContent=text;this.live.textContent=text;}
  complete(values:number[]){this.solved=true;this.blanks.forEach((el,i)=>{el.textContent=String(values[i]);el.disabled=true;});this.tools.querySelectorAll('button').forEach(b=>b.disabled=true);this.root.classList.add('answered');this.support.hidden=true;this.message('Both sides balance.');this.live.textContent=equation(this.current!,values)+'. Both sides balance.';}
  private help(){
    const c=this.current;if(!c||this.solved)return;if(this.helpStep===3){this.helpStep=0;this.support.hidden=true;this.helpButton.textContent='a hint';return;}this.onHelp();this.helpStep=Math.min(3,this.helpStep+1);this.support.hidden=false;this.support.replaceChildren();
    const p=document.createElement('p');p.textContent=this.helpStep===3?c.example:c.strategy;this.support.append(p);
    if(this.helpStep>=2&&this.helpStep<3)this.model(c);
    this.helpButton.textContent=this.helpStep===1?'show a model':this.helpStep===2?'worked example':'hide help';
    this.live.textContent=p.textContent;
  }
  private model(c:Challenge){
    const diagram=document.createElement('div');diagram.className='relationship-model';
    if(['product','factor','divide','pairs','derive'].includes(c.skill)){
      if(c.skill==='pairs'){
        const p=document.createElement('p');p.textContent=`Arrange ${c.total} into equal rows. Choose a row count from 2 to 12, then find how many fit in each row.`;diagram.append(p);
      }else{
        const row=document.createElement('div');row.className='model-groups';
        const showSize=c.skill==='product'||c.skill==='derive'||(c.skill==='divide'&&c.answers[0]===c.total);
        for(let i=0;i<c.a;i++){const g=document.createElement('span');g.textContent=showSize?String(c.b):'?';row.append(g);}
        const cap=document.createElement('p');cap.textContent=`${c.a} equal groups${showSize?' of '+c.b:' share '+c.total} · ${c.skill==='derive'?'compare with one fewer group':showSize?'what is the total?':'what is in each group?'}`;
        diagram.append(row,cap);
      }
    }else{
      // A part-whole model, intentionally not proportional: it teaches the
      // relationship without encoding the answer as a measurable length.
      const whole=document.createElement('div');whole.className='model-whole';whole.textContent=c.skill==='subtract'&&c.answers[0]===c.total?'whole ?':`whole ${c.total}`;
      const parts=document.createElement('div');parts.className='model-parts';
      const a=document.createElement('span'),b=document.createElement('span');a.textContent=String(c.a);b.textContent=c.skill==='subtract'&&c.answers[0]===c.total?String(c.b):'?';parts.append(a,b);diagram.append(whole,parts);
      if(c.skill==='balance'){const p=document.createElement('p');p.textContent='Both expressions name this same whole.';diagram.append(p);}
    }
    this.support.append(diagram);
  }
}
