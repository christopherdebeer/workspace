/** Versioned, replayable garment edits. Targets are semantic piece/edge names, never mesh indices.
 * Legacy skirt moves remain the exact cut compiler input; the journal also records dimensions, joins and materials.
 * Undo uses the cursor; a new edit after undo forks without mutating the original block. */
import type { Design, Recipe } from './pattern';
export interface State { design: Design; recipe: Omit<Recipe, 'journal'> }
export interface Operation { id: number; target: string; label: string; design: Partial<Design>; recipe: Partial<Omit<Recipe, 'journal'>> }
export interface Journal { version: 1; base: State; operations: Operation[]; cursor: number }
export const copy = <T>(x: T): T => structuredClone(x);
export function state(design: Design, recipe: Recipe): State { const { journal, ...r } = recipe; return copy({ design, recipe: r }); }
export function begin(s: State): Journal { return { version: 1, base: copy(s), operations: [], cursor: 0 }; }
export function replay(j: Journal): State {
  const s = copy(j.base);
  for (const op of j.operations.slice(0, j.cursor)) { Object.assign(s.design, copy(op.design)); Object.assign(s.recipe, copy(op.recipe)); }
  for(const k of Object.keys(s.recipe)) if((s.recipe as any)[k]===null) delete (s.recipe as any)[k];
  return s;
}
const words: Record<string,string> = { length:'lengthen skirt', bodyLen:'lengthen bodice', sleeveLen:'lengthen sleeves', legLen:'lengthen legs', ease:'shape bodice sides', neck:'shape neckline', neckDepth:'lower neckline', swing:'spread bodice hem', flare:'spread leg hem', legWidth:'spread leg width', sleeve:'shape sleeves', collar:'attach collar', collarWidth:'shape collar edge', sleeveFullness:'spread sleeve head', tierRatio:'gather tier join', tiers:'add / remove tier', panels:'divide skirt panels', grain:'turn grain', moves:'work skirt paper', family:'change blocks', fabric:'choose cloth', cloth:'change cloth properties', print:'choose print', colour:'choose colour', inks:'mix inks', printScale:'scale print' };
export function record(j: Journal, next: State, target = 'garment', label?: string): Journal {
  const prev = replay(j), dp: Partial<Design> = {}, rp: Partial<State['recipe']> = {};
  for (const k of Object.keys(next.design) as Array<keyof Design>) if (JSON.stringify(prev.design[k]) !== JSON.stringify(next.design[k])) (dp as any)[k] = next.design[k];
  // Explicit null clears survive JSON (undefined does not).
  for (const k of new Set([...Object.keys(prev.recipe), ...Object.keys(next.recipe)])) if (JSON.stringify((prev.recipe as any)[k]) !== JSON.stringify((next.recipe as any)[k])) (rp as any)[k] = (next.recipe as any)[k] ?? null;
  const keys = [...new Set([...Object.keys(dp), ...Object.keys(rp)])]; if (!keys.length) return j;
  const ops = j.operations.slice(0, j.cursor), id = Math.max(0,...j.operations.map(o=>o.id))+1;
  ops.push({id,target,label:label ?? keys.map(k=>words[k]??k).join(' · '),design:copy(dp),recipe:copy(rp)});
  return {...j,operations:ops,cursor:ops.length};
}
export function restore(j: Journal): {design:Design;recipe:Recipe} { const s=replay(j); for(const k of Object.keys(s.recipe)) if((s.recipe as any)[k]===null) delete (s.recipe as any)[k]; return {design:s.design,recipe:{...s.recipe,journal:copy(j)}}; }
export function travel(j: Journal, delta: number): Journal {return {...j,cursor:Math.max(0,Math.min(j.operations.length,j.cursor+delta))};}
