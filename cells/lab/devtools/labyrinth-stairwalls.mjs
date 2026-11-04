// Flights that meet a wall (node cells/lab/devtools/labyrinth-stairwalls.mjs [CASES_DIR...]): over the stories and any
// explorer cases given, each flight's head and foot looked at: run into stone (blocked), or arriving on a landing with a
// wall ahead and nowhere else to go (a dead end at a blank face), or set out from a blank face. What should be a door or
// an arch, counted.
import './labyrinth-node.mjs';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { World, replay, DIRS, key } = await import('../client/labyrinth/model.ts');
const { story } = await import('../client/labyrinth/demo.ts');
const NAV = await import('../client/labyrinth/nav.ts');
const BU = await import('../client/labyrinth/buildings.ts');
const worlds = [];
for (let s = 1; s <= 15; s++) { try { worlds.push([`story${s}`, story(s)]); } catch { /* none */ } }
for (const dir of process.argv.slice(2)) for (const c of readdirSync(dir)) { const f = join(dir, c, 'sealed.json'); if (existsSync(f)) { const b = JSON.parse(readFileSync(f, 'utf8')); try { worlds.push([c, replay(b.after ?? b.world)]); } catch { /* skip */ } } }
const tally = {}, seen = [];
export function survey(w) {
  const out = [], nav = BU.walkable(w);
  const wall = (k, i, j) => w.stone(k, i, j) && w.archway(k, i, j) < 0;
  for (const f of w.flights) {
    const [a, b] = DIRS[f.d], [kt, it, jt] = f.cells[f.cells.length - 1], [k0, i0, j0] = f.cells[0];
    const H = [kt + 1, it + a, jt + b], F = [k0, i0 - a, j0 - b];
    const exits = (c) => (nav.next.get(key(...c)) ?? []).filter((u) => u !== key(kt, it, jt)).length;
    if (wall(...H)) out.push(['head into stone', H]);
    else if (NAV.standing(w, ...H) && wall(H[0], H[1] + a, H[2] + b)) {
      const B = [H[0], H[1] + a, H[2] + b], bu = BU.buildings(w).of.get(key(...B)), op = BU.opening(w, H[0], B[1], B[2], (f.d + 2) % 4);
      out.push([`head: aimed at a ${bu ? 'building' : 'wall'}${op ? ' (with a ' + op.kind + ')' : ''}${exits(H) ? '' : ', dead end'}`, H]);
    }
    if (wall(...F) && f.founded) out.push(['foot against stone', F]);
  }
  return out;
}
if (import.meta.url.endsWith(process.argv[1])) {
  for (const [name, w] of worlds) for (const [kind, c] of survey(w)) { tally[kind] = (tally[kind] ?? 0) + 1; if (seen.length < 12) seen.push(`${name} ${kind} ${c}`); }
  console.log(worlds.length, 'worlds', tally); console.log(seen.join('\n'));
}
