/** Relationships, independent of scenery. A challenge is one prompt; a skill is
 * the relationship it probes; a model is optional support. No speed grading. */
export type Skill = 'bond'|'subtract'|'balance'|'product'|'factor'|'divide'|'pairs'|'derive';
export type Expr = number | {slot:number} | {op:'+'|'−'|'×'|'÷'; a:Expr; b:Expr};
export interface Challenge {
  skill: Skill; band:number; left:Expr; right:Expr; answers:number[];
  a:number; b:number; total:number; instruction:string; strategy:string; example:string;
}
export const BANDS = [
  ['Dew & counting','Small quantities, then missing parts'],
  ['Parts to 20','Missing numbers, addition and subtraction'],
  ['Relationships to 100','Bridging tens and balancing both sides'],
  ['Equal groups','2, 5 and 10 · multiplication and division'],
  ['Products to 144','All tables to 12 · factors and inverses'],
  ['Connections','Factor pairs, equivalence and derived facts'],
] as const;
export const SKILLS: Skill[][] = [[],['bond','subtract'],['bond','subtract','balance'],['product','factor','divide'],['product','factor','divide','pairs'],['balance','pairs','derive','divide','factor']];
export const slot=(n=0):Expr=>({slot:n});
export const op=(o:'+'|'−'|'×'|'÷',a:Expr,b:Expr):Expr=>({op:o,a,b});
export function evaluate(e:Expr, values:number[]):number {
  if(typeof e==='number')return e;
  if('slot' in e)return values[e.slot];
  const a=evaluate(e.a,values),b=evaluate(e.b,values);
  return e.op==='+'?a+b:e.op==='−'?a-b:e.op==='×'?a*b:a/b;
}
export function expression(e:Expr,values?:number[]):string {
  if(typeof e==='number')return String(e);
  if('slot'in e)return values?.[e.slot]===undefined?'□':String(values[e.slot]);
  return `${expression(e.a,values)} ${e.op} ${expression(e.b,values)}`;
}
export const equation=(c:Challenge,v?:number[])=>`${expression(c.left,v)} = ${expression(c.right,v)}`;
export function accepts(c:Challenge,v:number[]):boolean {
  if(v.length!==c.answers.length||v.some(n=>!Number.isInteger(n)||n<0||n>999))return false;
  if(c.skill==='pairs'&&v.some(n=>n<2||n>12))return false;
  return evaluate(c.left,v)===evaluate(c.right,v);
}
export function feedback(c:Challenge,v:number[]):string {
  if(c.skill==='pairs'&&v.some(n=>n<2||n>12))return 'Use two whole-number factors from 2 to 12.';
  const a=evaluate(c.left,v),b=evaluate(c.right,v);
  if(!Number.isFinite(a)||!Number.isFinite(b))return 'A group cannot have a size of zero here.';
  if(c.skill==='factor'&&v[0]===c.total-c.a)return 'That finds a difference. × asks for equal groups. Try the model.';
  return `Your two sides make ${Number(a.toFixed(2))} and ${Number(b.toFixed(2))}. They need to be equal.`;
}
const integer=(r:()=>number,a:number,b:number)=>a+Math.floor(r()*(b-a+1));
export function makeChallenge(band:number,skill:Skill,r:()=>number):Challenge {
  const small=band===1;
  let a=integer(r,small?2:12,small?9:49),b=integer(r,small?1:3,small?10:49);
  if(small&&a+b>20)b=20-a;
  if(['product','factor','divide','pairs','derive'].includes(skill)) {
    a=band===3?[2,5,10][integer(r,0,2)]:integer(r,2,12);b=integer(r,2,band===3?10:12);
  }
  const mult=['product','factor','divide','pairs','derive'].includes(skill);
  const total=mult?a*b:a+b;
  let left:Expr=0,right:Expr=0,answers:number[]=[b],instruction='Find the missing number.',strategy='',example='';
  switch(skill){
    case 'bond':
      left=op('+',a,slot());right=total;
      if(r()<.5)left=op('+',slot(),a);
      strategy=`${total} is the whole; ${a} is one part. What part joins it? You can count on, bridge a ten, or subtract.`;
      example='For example: 12 = □ + 7. From 7 to 10 is 3, then 2 more: the missing part is 5.';break;
    case 'subtract':
      if(r()<.5){left=op('−',total,slot());right=a;answers=[b];}
      else {left=op('−',slot(),a);right=b;answers=[total];}
      strategy='Subtraction and addition undo each other. Identify the whole and the two parts.';
      example='For example: □ − 7 = 5. The whole is 7 + 5, so it is 12.';break;
    case 'balance': {
      const c=integer(r,1,total-1);left=op('+',a,slot());right=op('+',c,total-c);
      strategy='The equals sign means the same amount on both sides. Find the right-hand total, then the missing left-hand part.';
      example='For example: 8 + □ = 6 + 7. The right side is 13; 8 needs 5 more.';break;}
    case 'product':left=op('×',a,b);right=slot();answers=[total];strategy=`Think of ${a} equal groups of ${b}. Use a known table fact or split the groups into easier parts.`;example='For example: 6 × 7 = (5 × 7) + 7 = 42.';break;
    case 'factor':left=op('×',a,slot());right=total;strategy=`${total} altogether, in ${a} equal groups. How many in each? Multiplication and division undo each other.`;example='For example: 6 × □ = 42, so 42 ÷ 6 = 7.';break;
    case 'divide':
      if(r()<.5){left=op('÷',total,a);right=slot();answers=[b];}
      else {left=op('÷',slot(),a);right=b;answers=[total];}
      strategy='Use the related multiplication: number of groups × amount in each = total.';example='For example: □ ÷ 6 = 7. Six groups of seven make 42.';break;
    case 'pairs':left=op('×',slot(0),slot(1));right=total;answers=[a,b];instruction='Find any factor pair · each number 2–12.';strategy='Try a factor you know. Divide the total by it to find its partner. More than one pair may work.';example='For example: □ × □ = 24 allows 2 × 12, 3 × 8 or 4 × 6 (and their reverses).';break;
    case 'derive':left=op('×',a,b);right=op('+',op('×',a-1,b),slot());answers=[b];strategy='One side has one extra equal group. What is the size of that group? You do not need to calculate both products.';example='For example: 6 × 7 = 5 × 7 + □. The extra group is 7.';break;
  }
  // Equality is a relationship, not an instruction to put an answer on the right.
  if(skill!=='balance'&&skill!=='derive'&&r()<.5)[left,right]=[right,left];
  return {skill,band,left,right,answers,a,b,total,instruction,strategy,example};
}
export interface Evidence {seen:number;clean:number;streak:number;last:number;next:number;}
export interface CurriculumData {band:number;counting:number;skills:Record<string,Evidence>;recent:string[];serial:number;}
export class Curriculum {
  data:CurriculumData;
  constructor(saved:Partial<CurriculumData>|null=null,legacy=0){
    const band=Number.isFinite(saved?.band)?Math.trunc(saved!.band!):legacy>=.65?3:legacy>=.35?2:legacy>=.12?1:0;
    this.data={band:Math.max(0,Math.min(5,band)),counting:saved?.counting??0,skills:saved?.skills??{},recent:saved?.recent??[],serial:saved?.serial??0};
  }
  setBand(b:number){this.data.band=Math.max(0,Math.min(5,Math.trunc(b)));if(this.data.band===0)this.data.counting=0;}
  counted(clean:boolean){if(clean&&++this.data.counting>=3)this.data.band=Math.max(1,this.data.band);}
  next(rand:()=>number):Challenge {
    const d=this.data,band=Math.max(1,d.band),skills=SKILLS[band];
    // Sample every new form, then revisit less secure/due forms. A little earlier
    // review stays relational: proficient players aren't sent back to counting.
    let selectedBand=band;
    if(d.serial%6===5&&band>1)selectedBand=band-1;
    const pool=selectedBand===band?skills:SKILLS[selectedBand];
    const ranked=pool.map(skill=>{const e=d.skills[`${selectedBand}:${skill}`];return {skill,score:!e?100:e.next<=d.serial?30-e.streak:10-e.streak};});
    const previous=d.recent[d.recent.length-1]?.split('|')[0];
    ranked.sort((a,b)=>(b.score-(b.skill===previous?12:0))-(a.score-(a.skill===previous?12:0)));
    let c:Challenge;let tries=0;
    do{c=makeChallenge(selectedBand,ranked[0].skill,rand);}while(d.recent.includes(c.skill+'|'+equation(c))&&++tries<16);
    d.recent=[...d.recent,c.skill+'|'+equation(c)].slice(-12);return c;
  }
  record(c:Challenge,clean:boolean){
    const d=this.data;d.serial++;
    const key=`${c.band}:${c.skill}`,e=d.skills[key]??{seen:0,clean:0,streak:0,last:0,next:0};
    e.seen++;if(clean)e.clean++;e.streak=clean?e.streak+1:0;e.last=d.serial;e.next=d.serial+(clean?Math.min(12,2**Math.min(3,e.streak)):1);d.skills[key]=e;
    // Broad evidence across forms, not a global speed score or one lucky answer.
    if(d.band>0&&d.band<5&&SKILLS[d.band].every(s=>(d.skills[`${d.band}:${s}`]?.streak??0)>=3))d.band++;
  }
}
