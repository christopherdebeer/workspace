/** Focused physics check of the two exits from one generated fork.
 * Same Squishy core as the client: not a second physics model.
 */
import { makeLevel, discover, verify } from './engine';
import { assess, type Composition } from './spatial';
export function validateFork(level:number,seed:number,composition:Composition='parallel',exitIndex=-1) {
  const a=makeLevel(level,seed,'dough',composition);
  const s=assess(a.lv,level,seed,composition),fork=s.forks[0];
  if(!fork)return {level,seed,composition,error:'No generated fork',warnings:s.warnings};
  const exits=fork.choices.filter((_,i)=>exitIndex<0||i===exitIndex).map(to=>{
    const witness=discover(a.lv,fork.at,to);
    if(!witness)return {from:fork.at,to,predicted:false};
    verify(a,witness,exitIndex<0?3:1);
    return {from:fork.at,to,predicted:true,method:witness.method,status:witness.status,control:witness.control,
      physical:witness.validation&&{total:witness.validation.total,outcomes:witness.validation.outcomes,landedAt:witness.validation.landedAt}};
  });
  return {level,seed,composition,fork:fork.at,choices:fork.choices,merge:fork.merge,exits,
    note:exitIndex>=0?'One actual soft-body witness per chosen edge; no claim of success tolerance or human difficulty.':'Three local controls per edge; no general impossibility or human difficulty claim.'};
}
