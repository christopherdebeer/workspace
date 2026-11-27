// Truth Mine / 002. A small, typed, declarative instrument algebra.
// An instrument's definition (op + parts) is independent of its default input bindings (marks).
export type Mark = { id:string; by:string; at:number; kind:'mark'; t:number };
export type Op = 'interval'|'change'|'mean'|'difference'|'ratio'|'sum';
export type Unit = 's'|'amplitude'|'scalar';
export type Instrument = { id:string; by:string; at:number; kind:'instrument'; op:Op; name:string; marks:string[]; parts?:[string,string]; derivedFrom?:string };
export type Artifact = Mark|Instrument;
export type Shape = { unit:Unit; slots:string[]; depth:number };
export const signal=(t:number)=>0.65*Math.sin(t*Math.PI/6)+0.19*Math.sin(t*Math.PI/2.5+0.8)+0.12*Math.cos(t*Math.PI/19);
export const interval=(a:Mark,b:Mark)=>Math.abs(b.t-a.t);
export const isMark=(a:Artifact|undefined):a is Mark=>a?.kind==='mark';
export const isInstrument=(a:Artifact|undefined):a is Instrument=>a?.kind==='instrument';
export const OPS:Record<Op,{label:string;formula:string;description:string}>={
 interval:{label:'Interval',formula:'|t₂ − t₁|',description:'Elapsed time between two observations.'},
 change:{label:'Change',formula:'y₂ − y₁',description:'Signed change in signal height, from first observation to second.'},
 mean:{label:'Mean',formula:'(A + B) / 2',description:'The average of two like quantities.'},
 difference:{label:'Difference',formula:'A − B',description:'Subtract the second quantity from the first.'},
 ratio:{label:'Ratio',formula:'A / B',description:'Compare like quantities as a dimensionless ratio.'},
 sum:{label:'Sum',formula:'A + B',description:'Add two like quantities.'},
};
export function shape(i:Instrument, all:Artifact[], trail:string[]=[]):Shape|null{
 if(trail.includes(i.id)||trail.length>=5)return null;
 if(i.op==='interval'||i.op==='change')return {unit:i.op==='interval'?'s':'amplitude',slots:['First moment','Second moment'],depth:1};
 if(!['mean','difference','ratio','sum'].includes(i.op)||!Array.isArray(i.parts)||i.parts.length!==2)return null;
 const a=all.find(x=>x.id===i.parts![0]), b=all.find(x=>x.id===i.parts![1]);
 if(!isInstrument(a)||!isInstrument(b))return null;
 const sa=shape(a,all,[...trail,i.id]),sb=shape(b,all,[...trail,i.id]);
 if(!sa||!sb||sa.unit!==sb.unit||sa.slots.length+sb.slots.length>16)return null;
 return {unit:i.op==='ratio'?'scalar':sa.unit,slots:[...sa.slots.map(x=>'A / '+x),...sb.slots.map(x=>'B / '+x)],depth:1+Math.max(sa.depth,sb.depth)};
}
export function evaluate(i:Instrument,all:Artifact[],bindings:string[]=i.marks):number|null{
 const s=shape(i,all);
 if(!s||bindings.length!==s.slots.length)return null;
 const marks=bindings.map(k=>all.find(a=>a.id===k));
 if(!marks.every(isMark))return null;
 if(i.op==='interval')return interval(marks[0],marks[1]);
 if(i.op==='change')return signal(marks[1].t)-signal(marks[0].t);
 const a=all.find(x=>x.id===i.parts![0]),b=all.find(x=>x.id===i.parts![1]);
 if(!isInstrument(a)||!isInstrument(b))return null;
 const n=shape(a,all)!.slots.length, x=evaluate(a,all,bindings.slice(0,n)), y=evaluate(b,all,bindings.slice(n));
 if(x===null||y===null)return null;
 const v=i.op==='mean'?(x+y)/2:i.op==='difference'?x-y:i.op==='sum'?x+y:y===0?NaN:x/y;
 return Number.isFinite(v)?v:null;
}
export function compatible(a:Instrument,b:Instrument,all:Artifact[]){
 const sa=shape(a,all),sb=shape(b,all);return !!sa&&!!sb&&sa.unit===sb.unit&&Math.max(sa.depth,sb.depth)<5&&sa.slots.length+sb.slots.length<=16;
}
export function validInstrument(i:Instrument,all:Artifact[]){
 const s=shape(i,all);
 return !!s&&Array.isArray(i.marks)&&i.marks.length===s.slots.length&&i.marks.every(k=>all.some(a=>a.id===k&&isMark(a)))&&
 (!i.derivedFrom||all.some(a=>a.id===i.derivedFrom&&isInstrument(a)&&a.op===i.op&&JSON.stringify(a.parts??[])===JSON.stringify(i.parts??[])));
}
