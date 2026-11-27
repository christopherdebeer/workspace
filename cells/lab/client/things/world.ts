/** A conceptual substrate: identity, association and constitution, not computation.
 * Placements, visibility, selection and navigation belong to a viewer, never the shared things.
 * All shared additions are immutable; references can only address earlier things. */
export type Base={id:string;by:string;at:number};
export type Thing=Base&{kind:'thing';form?:'round'|'square'|'triangle'};
export type Relation=Base&{kind:'relation';ends:[string,string]};
export type Collection=Base&{kind:'collection';members:string[]};
export type Composition=Base&{kind:'composition';members:string[];from?:string};
export type Naming=Base&{kind:'name';target:string;text:string};
export type Entity=Thing|Relation|Collection|Composition;
export type Fact=Entity|Naming;
export const SEEDS:Thing[]=[
 {id:'seed-a',by:'world',at:0,kind:'thing',form:'round'},
 {id:'seed-b',by:'world',at:0,kind:'thing',form:'square'},
 {id:'seed-c',by:'world',at:0,kind:'thing',form:'triangle'}
];
export const isEntity=(f:Fact|undefined):f is Entity=>!!f&&f.kind!=='name';
export const isContainer=(f:Fact|undefined):f is Collection|Composition=>f?.kind==='collection'||f?.kind==='composition';
export const entities=(facts:Fact[])=>[...SEEDS,...facts.filter(isEntity)];
export const refs=(e:Entity):string[]=>e.kind==='relation'?e.ends:isContainer(e)?e.members:[];
export function names(id:string,facts:Fact[]){return facts.filter((f):f is Naming=>f.kind==='name'&&f.target===id)}
export function title(e:Entity,facts:Fact[],actor=''){
 const n=names(e.id,facts),own=n.filter(x=>x.by===actor);
 return own[own.length-1]?.text||n[0]?.text||(e.kind==='thing'?(e.form==='round'?'Round':e.form==='square'?'Square':e.form==='triangle'?'Triangle':'Thing'):e.kind==='relation'?'Relation':e.kind==='collection'?'Collection':'Composition');
}
export const validId=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
export function accept(raw:any,facts:Fact[],at:number):Fact|null{
 if(!raw||!validId(raw.id)||!validId(raw.by)||facts.some(x=>x.id===raw.id))return null;
 const existing=entities(facts),has=(k:unknown)=>typeof k==='string'&&existing.some(x=>x.id===k);
 const base={id:raw.id,by:raw.by,at};
 if(raw.kind==='thing')return {...base,kind:'thing',...(['round','square','triangle'].includes(raw.form)?{form:raw.form}:{})};
 if(raw.kind==='relation'&&Array.isArray(raw.ends)&&raw.ends.length===2&&raw.ends.every(has)&&raw.ends[0]!==raw.ends[1])return {...base,kind:'relation',ends:[raw.ends[0],raw.ends[1]]};
 if((raw.kind==='collection'||raw.kind==='composition')&&Array.isArray(raw.members)&&raw.members.length>=2&&raw.members.length<=24&&new Set(raw.members).size===raw.members.length&&raw.members.every(has)){
  if(raw.kind==='collection')return {...base,kind:'collection',members:[...raw.members]};
  if(raw.from!==undefined){const c=existing.find(x=>x.id===raw.from);if(!isContainer(c)||JSON.stringify(c.members)!==JSON.stringify(raw.members))return null}
  return {...base,kind:'composition',members:[...raw.members],...(raw.from?{from:raw.from}:{})};
 }
 if(raw.kind==='name'&&has(raw.target)&&typeof raw.text==='string'&&raw.text.trim().length>0&&raw.text.trim().length<=64&&!/[\u0000-\u001f]/.test(raw.text))return {...base,kind:'name',target:raw.target,text:raw.text.trim()};
 return null;
}
