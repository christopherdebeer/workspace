import {BANDS, equation, expression, type Challenge, type Expr} from './challenges';

/** A small equation over the water. The keypad appears only when a blank is
 * touched; the river stays visible and playable outside these controls. */
export class ChallengeUI {
  private root=document.createElement('section');
  private prompt=document.createElement('div');
  private tools=document.createElement('div');
  private feedback=document.createElement('p');
  private support=document.createElement('div');
  private keypad=document.createElement('div');
  private menu=document.createElement('div');
  private range=document.createElement('button');
  private live=document.getElementById('live')!;
  private inputs:HTMLInputElement[]=[];
  private current:Challenge|null=null;
  private active=0;
  private helpStep=0;
  private visible=false;
  private solved=false;
  private helpButton:HTMLButtonElement;
  onSubmit:(values:number[])=>void=()=>{};
  onHelp:()=>void=()=>{};
  onBand:(band:number)=>void=()=>{};
  onSkip:()=>void=()=>{};
  constructor(){
    this.root.id='relationship';this.root.hidden=true;this.root.setAttribute('aria-label','Maths challenge');
    this.prompt.className='equation';this.tools.className='math-tools';this.feedback.className='math-feedback';
    this.support.className='math-support';this.support.hidden=true;this.keypad.className='math-keypad';this.keypad.hidden=true;
    this.menu.className='math-menu';this.menu.hidden=true;
    const button=(text:string,fn:()=>void,parent=this.tools)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;parent.append(b);return b;};
    this.helpButton=button('a hint',()=>this.help());
    button('another',()=>this.onSkip());
    button('check',()=>this.submit());
    for(const k of ['1','2','3','4','5','6','7','8','9','⌫','0','✓'])button(k,()=>{
      const input=this.inputs[this.active];if(!input||this.solved)return;
      if(k==='✓'){if(this.inputs.some(i=>!i.value)){this.active=this.inputs.findIndex(i=>!i.value);this.inputs[this.active].focus();}else this.submit();return;}
      input.value=k==='⌫'?input.value.slice(0,-1):(input.value==='0'?k:(input.value+k).slice(0,3));
      input.dispatchEvent(new Event('input'));input.focus();
    },this.keypad).setAttribute('aria-label',k==='⌫'?'Delete digit':k==='✓'?'Check answer':k);
    button('back to the river',()=>this.closeKeyboard(),this.keypad).className='keypad-close';
    this.range.type='button';this.range.id='math-range';this.range.textContent='maths';this.range.hidden=true;
    this.range.setAttribute('aria-expanded','false');
    this.range.onclick=()=>{this.menu.hidden=!this.menu.hidden;this.range.setAttribute('aria-expanded',String(!this.menu.hidden));this.keypad.hidden=true;};
    const h=document.createElement('p');h.textContent='Choose where to begin. The river adapts from here.';this.menu.append(h);
    BANDS.forEach(([label,detail],i)=>{const b=button('',()=>{this.onBand(i);this.menu.hidden=true;this.range.setAttribute('aria-expanded','false');},this.menu);b.dataset.band=String(i);b.append(document.createTextNode(label));const s=document.createElement('small');s.textContent=detail;b.append(s);});
    button('close',()=>{this.menu.hidden=true;this.range.setAttribute('aria-expanded','false');this.range.focus();},this.menu);
    this.root.append(this.prompt,this.feedback,this.tools,this.support,this.keypad);
    document.getElementById('ui')!.append(this.root,this.range,this.menu);
    this.root.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();this.submit();}if(e.key==='Escape'){this.closeKeyboard();this.support.hidden=true;}});
    this.menu.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){this.menu.hidden=true;this.range.setAttribute('aria-expanded','false');this.range.focus();}});
  }
  setBand(b:number){this.menu.querySelectorAll<HTMLButtonElement>('[data-band]').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.band)===b)));this.range.title=BANDS[b][0];}
  started(){this.range.hidden=false;}
  show(c:Challenge){
    this.current=c;this.solved=false;this.visible=true;this.root.hidden=false;this.root.classList.remove('answered');
    this.prompt.replaceChildren();this.inputs=[];this.active=0;this.helpStep=0;this.helpButton.textContent='a hint';
    this.support.hidden=true;this.support.replaceChildren();this.keypad.hidden=true;this.feedback.textContent=c.instruction;
    this.tools.querySelectorAll('button').forEach(b=>b.disabled=false);
    const render=(e:Expr,parent:HTMLElement)=>{
      if(typeof e==='number'){parent.append(document.createTextNode(String(e)));return;}
      if('slot'in e){const input=document.createElement('input');input.type='text';input.inputMode='none';input.autocomplete='off';input.maxLength=3;input.placeholder='?';input.setAttribute('aria-label',`Missing number ${e.slot+1} in ${equation(c)}`);input.pattern='[0-9]*';
        input.onfocus=()=>{if(this.solved)return;this.active=e.slot;this.keypad.hidden=false;this.support.hidden=true;};
        input.oninput=()=>{input.value=input.value.replace(/[^0-9]/g,'').slice(0,3);};
        this.inputs[e.slot]=input;parent.append(input);return;}
      render(e.a,parent);const sign=document.createElement('span');sign.textContent=e.op;parent.append(sign);render(e.b,parent);
    };
    render(c.left,this.prompt);const eq=document.createElement('span');eq.textContent='=';this.prompt.append(eq);render(c.right,this.prompt);
    this.live.textContent=equation(c)+'. '+c.instruction+' Touch a missing number to enter it.';
  }
  hide(){this.visible=false;this.root.hidden=true;this.keypad.hidden=true;this.current=null;}
  suspend(value:boolean){this.root.hidden=value||!this.visible;if(value){this.closeKeyboard();this.menu.hidden=true;this.range.setAttribute('aria-expanded','false');}this.range.hidden=value;}
  private closeKeyboard(){this.keypad.hidden=true;(document.activeElement as HTMLElement|null)?.blur();}
  private submit(){if(!this.current||this.solved)return;const v=this.inputs.map(i=>i.value===''?NaN:Number(i.value));if(v.some(n=>!Number.isInteger(n))){this.message('Fill each missing number, then check.');return;}this.onSubmit(v);}
  message(text:string){this.feedback.textContent=text;this.live.textContent=text;}
  complete(values:number[]){this.solved=true;this.closeKeyboard();this.inputs.forEach((el,i)=>{el.value=String(values[i]);el.disabled=true;});this.tools.querySelectorAll('button').forEach(b=>b.disabled=true);this.root.classList.add('answered');this.support.hidden=true;this.message('Both sides balance.');this.live.textContent=equation(this.current!,values)+'. Both sides balance.';}
  private help(){
    const c=this.current;if(!c||this.solved)return;if(this.helpStep===3){this.helpStep=0;this.support.hidden=true;this.helpButton.textContent='a hint';return;}this.onHelp();this.helpStep=Math.min(3,this.helpStep+1);this.closeKeyboard();this.support.hidden=false;this.support.replaceChildren();
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
