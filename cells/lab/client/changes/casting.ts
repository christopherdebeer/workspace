import type {Line} from './model';
export type Cadence = 'hourly'|'daily'|'weekly'|'monthly';
export interface CastContext {version:'changes-cast-v1';cadence:Cadence;window:string;zone:string}
export const cadences:Cadence[]=['hourly','daily','weekly','monthly'];
export function normalizeQuestion(question:string):string {
  return question.normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();
}
// Calendar labels deliberately keep both occurrences of a repeated DST hour together.
export function castContext(cadence:Cadence, now=new Date(), zone=Intl.DateTimeFormat().resolvedOptions().timeZone):CastContext {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const p=(type:string)=>parts.find(p=>p.type===type)!.value;
  const date=p('year')+'-'+p('month')+'-'+p('day');
  let window=date;
  if(cadence==='hourly')window+='T'+p('hour');
  if(cadence==='monthly')window=date.slice(0,7);
  if(cadence==='weekly'){
    const monday=new Date(Date.UTC(Number(p('year')),Number(p('month'))-1,Number(p('day'))));
    monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
    window=monday.toISOString().slice(0,10);
  }
  return {version:'changes-cast-v1',cadence,window,zone};
}
export async function deterministicCast(question:string, context:CastContext):Promise<Line[]> {
  const seed=JSON.stringify([context.version,context.cadence,context.zone,context.window,normalizeQuestion(question)]);
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(seed)));
  // Six disjoint groups of three hash bits retain the three-coin 1:3:3:1 mapping.
  return Array.from(bytes.slice(0,6),b=>(6+(b&1)+((b>>1)&1)+((b>>2)&1)) as Line);
}
