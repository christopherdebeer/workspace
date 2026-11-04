/**
 * The ladder, drawn (ladder.ts): what's built is realised as the settlement knows how to build it. Nothing built
 * changes, nor what it's good for: a tradition's grammar (regions.ts) is asked through here by what draws (mesh.ts,
 * facade.ts, roof.ts), and answers with what's known.
 *
 * - **Walls**: rubble, piled dry (before mortar) or bedded in it, until a mason dresses stone; the north's timber frame
 *   once a carpenter can frame it; the east's whitewash once there's lime.
 * - **Openings and spans**: square, under timber lintels, before the arch; round before the pointed; pointed before the
 *   four-centred.
 * - **Windows**: open holes before joinery; then shutters (the middle sea's) or a wooden lattice; glass in its painted
 *   panes once there's a glassworks.
 * - **Roofs**: thatch, until a kiln fires tile (or a mason splits slate); a dome needs the vault and the dome.
 * - **Fronts**: a portal faced in stone until there's glazed tile; a loggia and a gallery need the arch; a balcony, a
 *   jetty, a shopfront, a veranda need the carpenter.
 * - **Dressing**: brick needs the kiln, marble the mason.
 */
import { grammarHere as intended } from './buildings';
import { knows, ladderOn } from './ladder';
import { FOUR, POINTED, ROUND, grammarOfId, type ArchFamily, type Grammar } from './regions';
import type { BayRole } from './facades';
import type { World } from './model';

const memo = new WeakMap<World, { v: number; m: Map<string, Grammar> }>();
/** a grammar as the world's settlement can build it */
export function realise(w: World, g: Grammar): Grammar {
  if (!ladderOn(w)) return g;
  let c = memo.get(w);
  if (!c || c.v !== w.version) { c = { v: w.version, m: new Map() }; memo.set(w, c); }
  const had = c.m.get(g.id);
  if (had) return had;
  const k = (t: Parameters<typeof knows>[1]) => knows(w, t), arch = k('arch'), joinery = k('joinery');
  const fam = (f: ArchFamily): ArchFamily => (f === FOUR && !k('fourCentred') ? (k('pointed') ? POINTED : ROUND) : f === POINTED && !k('pointed') ? ROUND : f);
  const meant = g.roof === 'steep' ? 'slate' : g.roof === 'eave' ? 'grey' : 'tile';
  const cover = meant === 'slate' ? (k('slate') ? 'slate' : k('kiln') ? 'tile' : 'thatch') : k('kiln') ? meant : 'thatch';
  const stone = k('ashlar') ? 'ashlar' : 'rubble';
  const r: Grammar = {
    ...g,
    wall: g.wall === 'ashlar' ? stone : g.wall === 'frame' ? (k('frame') ? 'frame' : stone) : g.wall === 'plaster' ? (k('mortar') ? 'plaster' : 'rubble') : g.wall,
    arch: fam(g.arch), span: (n: number) => fam(g.span(n)),
    windows: arch ? g.windows : g.windows.map((s) => (s === 'arched' ? 'square' : s)),
    doorHead: arch ? g.doorHead : 'square',
    shutters: g.shutters && joinery,
    // (glass where there's a glassworks; else, where the tradition glazes, a wooden lattice (unlit); else open)
    panes: g.panes && k('glass') ? g.panes : g.panes && joinery ? { paints: [5], fine: true, lit: 0 } : null,
    cover, lintels: !arch, mosaic: k('glaze'),
  };
  c.m.set(g.id, r);
  return r;
}
/** the manner a cell's drawn in: its building's, or its district's, as the settlement can build it */
export const grammarHere = (w: World, k: number, i: number, j: number): Grammar => realise(w, intended(w, k, i, j));
/** a building's, so */
export const grammarShown = (w: World, id: number): Grammar => realise(w, grammarOfId(w, id));
/** a front's part as it can be built: the arch for a gallery, a loggia, a portal; the carpenter for a balcony, a jetty, a
 * shopfront, a veranda (else nothing: the face as buildings.ts opens it) */
export function shownRole(w: World, role: BayRole): BayRole | null {
  if (!ladderOn(w)) return role;
  if ((role === 'gallery' || role === 'loggia' || role === 'portal' || role === 'over') && !knows(w, 'arch')) return null;
  if ((role === 'balcony' || role === 'shop' || role === 'veranda') && !knows(w, 'joinery')) return null;
  if (role === 'jetty' && !knows(w, 'frame')) return null;
  return role;
}
/** a dressing's stone kind as it can be had: brick from a kiln, marble dressed by a mason; else the plain stone */
export function shownStone(w: World, mat: number): number {
  if (!ladderOn(w)) return mat;
  if (mat === 1 && !knows(w, 'kiln')) return 0;
  if (mat === 2 && !knows(w, 'ashlar')) return 0;
  return mat;
}
