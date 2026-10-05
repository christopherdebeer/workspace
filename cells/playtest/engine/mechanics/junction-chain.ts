/**
 * Junction Chain — one shared counter on a table of cards (Markovs Chains).
 *
 * A 5×5 table. Four destination cards (Kings, one a suit) lie at the middle of each edge
 * and a start card in the centre, with the counter on it. Players hold hands of junction
 * cards; a junction's six die faces each name an exit (north, east, south, west) or a stay,
 * and the faces turn with the card. Nobody moves a piece of their own: on a roll, the
 * counter follows the exit printed for that face on the card it stands on.
 *
 * Two phases. **Build:** each turn, lay one card (turned any way) on an empty space touching a
 * laid card — or anywhere on the outer ring (`rim`), an ace anywhere — or throw a card in;
 * no rolling; until no space is empty. **Race:** each turn, lay a card on top of any junction
 * (`cover`), or swap two junctions (a Queen), or hold; then roll — the counter moves by the
 * card it stands on — or, instead of the roll, play a Jack (walk it a step your way) or a Joker
 * (a random exit). The roll is its own action so that what a lay does to the table is seen
 * apart from what the die then does. Off the edge comes in on the far side (`wrap`). A King nobody holds
 * sends the counter back to the start.
 *
 * Winning is the hidden-objectives mechanic's: each player's objective names a suit; the
 * player whose King the counter arrives at wins (onCheckWin). Objectives with
 * `check: { counter_at: "K♥" }` are read here, not by hidden-objectives' metrics.
 *
 * The player's view carries a forecast of the counter's chances over the next few rolls, by
 * King, as `objectiveProgress` lines ("your King ♥: 20%") — the runner's consequence labels
 * turn those into what a lay does for you. Nothing in the view is anyone else's secret.
 *
 * Config (engine_mechanics.junction_chain):
 *   size: 5 · start: "2,2" · kings: { hearts: "2,0", diamonds: "4,2", clubs: "2,4", spades: "0,2" }
 *   wrap: true · rim: true · cover: true · hand: 3 · forecast: 4 (rolls ahead)
 * Cards (engine_mechanics.cards.deck): junctions carry `exits: "N4 E2 stay1"` (faces per
 * direction, six in all), `suit`, and optionally `role: "wild"` (lay anywhere) or
 * `role: "destination"`; the start card is the deck entry named by `start_card` (default
 * "origin"). Jacks, Queens and Jokers are `role: "reroute" | "swap" | "chaos"`.
 */
import type { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, ActionDescription, ActionSchema, WinCheckContext, WinCheckResult, SharedStateInitContext, SharedStateInitResult, StateChanges } from './types';
import type { GameAction, GameState, GameConfig, Card } from '../types/game';
import { getCardsState, drawCards } from './core/cards';

const DIRS: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const DIR_NAMES = ['north', 'east', 'south', 'west'];
const DIR_GLYPH = ['↑', '→', '↓', '←'];
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const SUIT_GLYPH: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
/** the most lays offered at once (the runner simulates consequences only up to 160 options) */
const OFFER_MAX = 140;

export interface JunctionChainConfig {
  size?: number;
  start?: string;
  start_card?: string;
  kings?: Record<string, string>;
  wrap?: boolean;
  rim?: boolean;
  cover?: boolean;
  hand?: number;
  forecast?: number;
}
interface ChainCard {
  name: string;
  suit?: string;
  role?: string;
  /** six faces: an exit 0..3 or -1 to stay */
  faces: number[];
}
interface Tile {
  card: ChainCard;
  turn: number;
  king?: string;
  start?: boolean;
}
export interface ChainState {
  size: number;
  tiles: Record<string, Tile>;
  counter: string;
  start: string;
  phase: 'build' | 'race';
  rolls: number;
  /** the last die face, and the counter's last move, for the log and the view */
  lastRoll?: number;
  lastMove?: string;
  /** in the race: this turn's lay (or swap, or hold) is done; the roll, a Jack or a Joker ends it */
  laid?: boolean;
}

const key = (x: number, y: number) => `${x},${y}`;
const xy = (k: string) => k.split(',').map(Number) as [number, number];
const suitOf = (name: string) => SUITS.find((s) => name.toLowerCase().includes(s)) ?? SUITS.find((s) => name.includes(SUIT_GLYPH[s]));

function cfg(config: GameConfig): JunctionChainConfig | undefined {
  return (config.engine_mechanics as Record<string, unknown> | undefined)?.junction_chain as JunctionChainConfig | undefined;
}
/** `exits: "N4 E2 stay1"` → six faces */
export function parseExits(spec: string | undefined): number[] {
  const faces: number[] = [];
  for (const part of String(spec ?? '').trim().split(/\s+/)) {
    const m = /^(N|E|S|W|stay)(\d)$/i.exec(part);
    if (!m) continue;
    const d = m[1].toLowerCase() === 'stay' ? -1 : 'nesw'.indexOf(m[1].toLowerCase());
    for (let i = 0; i < Number(m[2]); i++) faces.push(d);
  }
  while (faces.length < 6) faces.push(-1);
  return faces.slice(0, 6);
}
function toChainCard(c: Card & { exits?: string; suit?: string; role?: string }): ChainCard {
  return { name: c.name, suit: c.suit, role: c.role, faces: parseExits(c.exits) };
}
export function chainOf(state: GameState): ChainState | undefined {
  return (state.shared as Record<string, unknown>).chain as ChainState | undefined;
}
/** a laid card's exits, turned */
export function exitsOf(t: Tile): number[] {
  if (t.king) return [-1, -1, -1, -1, -1, -1];
  return t.card.faces.map((d) => (d < 0 ? -1 : (d + t.turn) % 4));
}
function neighbour(ch: ChainState, at: string, d: number, wrap: boolean): string | null {
  const [x, y] = xy(at);
  let nx = x + DIRS[d][0];
  let ny = y + DIRS[d][1];
  if (nx < 0 || ny < 0 || nx >= ch.size || ny >= ch.size) {
    if (!wrap) return null;
    nx = (nx + ch.size) % ch.size;
    ny = (ny + ch.size) % ch.size;
  }
  return key(nx, ny);
}
/** where the counter goes from `at` on a face, and why */
function destination(ch: ChainState, at: string, face: number, wrap: boolean): { at: string; reason: 'move' | 'stay' | 'open' | 'king'; dir: number } {
  const t = ch.tiles[at];
  if (!t || t.king) return { at, reason: 'king', dir: -1 };
  const d = exitsOf(t)[face - 1];
  if (d < 0) return { at, reason: 'stay', dir: d };
  const next = neighbour(ch, at, d, wrap);
  return next && ch.tiles[next] ? { at: next, reason: 'move', dir: d } : { at, reason: 'open', dir: d };
}
function hasEmpty(ch: ChainState): boolean {
  for (let y = 0; y < ch.size; y++) for (let x = 0; x < ch.size; x++) if (!ch.tiles[key(x, y)]) return true;
  return false;
}
function canLay(ch: ChainState, c: JunctionChainConfig, k: string, card: ChainCard): boolean {
  const [x, y] = xy(k);
  if (x < 0 || y < 0 || x >= ch.size || y >= ch.size) return false;
  if (card.role === 'destination' || card.role === 'reroute' || card.role === 'swap' || card.role === 'chaos') return false;
  const here = ch.tiles[k];
  if (here) return !here.king && (ch.phase === 'race' ? c.cover !== false : !hasEmpty(ch));
  if (card.role === 'wild') return true;
  if (c.rim !== false && (x === 0 || y === 0 || x === ch.size - 1 || y === ch.size - 1)) return true;
  return DIRS.some(([dx, dy]) => { const t = ch.tiles[key(x + dx, y + dy)]; return t && !t.king; });
}
/** The counter's chances: from `at`, over `hops` rolls, the mass arriving at each King */
export function forecast(ch: ChainState, at: string, wrap: boolean, hops: number): Record<string, number> {
  let mass = new Map<string, number>([[at, 1]]);
  const wins: Record<string, number> = {};
  for (let h = 0; h < hops; h++) {
    const next = new Map<string, number>();
    for (const [k, m] of mass) {
      const t = ch.tiles[k];
      if (t?.king) { wins[t.king] = (wins[t.king] ?? 0) + m; continue; }
      for (let face = 1; face <= 6; face++) { const d = destination(ch, k, face, wrap).at; next.set(d, (next.get(d) ?? 0) + m / 6); }
    }
    mass = next;
  }
  for (const [k, m] of mass) { const t = ch.tiles[k]; if (t?.king) wins[t.king] = (wins[t.king] ?? 0) + m; }
  return wins;
}
const pct5 = (x: number) => `${Math.round((x * 100) / 5) * 5}%`;
function mySuit(ctx: { player: unknown }): string | undefined {
  const obj = (ctx.player as { objective?: { name?: string; check?: { counter_at?: string } } }).objective;
  if (!obj) return undefined;
  return suitOf(obj.check?.counter_at ?? obj.name ?? '');
}
function heldSuits(state: GameState): Set<string> {
  const out = new Set<string>();
  for (const p of state.turnOrder) { const s = mySuit({ player: state.players[p] }); if (s) out.add(s); }
  return out;
}
function tileLabel(k: string, t: Tile): string {
  if (t.king) return `${k} K${SUIT_GLYPH[t.king]}`;
  const ex = exitsOf(t);
  const by = new Map<number, number[]>();
  ex.forEach((d, i) => by.set(d, [...(by.get(d) ?? []), i + 1]));
  const faces = [...by.entries()].map(([d, fs]) => `${d < 0 ? '·' : DIR_GLYPH[d]}${fs.length > 1 ? `${fs[0]}-${fs[fs.length - 1]}` : fs[0]}`).join(' ');
  return `${k} ${t.card.name}${t.start ? ' (start)' : ''} ${faces}`;
}
/** the counter arrives: a King of someone's ends things (onCheckWin sees it), nobody's sends it home */
function arrive(ch: ChainState, state: GameState, at: string, log: string[]): void {
  ch.counter = at;
  const t = ch.tiles[at];
  if (t?.king && !heldSuits(state).has(t.king)) {
    log.push(`the King of ${t.king} is nobody's: back to the start`);
    ch.counter = ch.start;
  }
}
function moveCounter(ch: ChainState, state: GameState, wrap: boolean, face: number, log: string[]): void {
  const res = destination(ch, ch.counter, face, wrap);
  ch.lastRoll = face;
  ch.rolls++;
  if (res.reason === 'move') { log.push(`rolled ${face}: ${DIR_NAMES[res.dir]} to ${res.at}`); arrive(ch, state, res.at, log); }
  else log.push(`rolled ${face}: ${res.reason === 'stay' ? 'a stay face' : res.reason === 'open' ? 'an open exit' : 'nowhere'} — the counter stays at ${ch.counter}`);
  ch.lastMove = log[log.length - 1];
}
function refill(state: GameState, playerId: string, hand: number): void {
  const have = (state.players[playerId].hand ?? []).length;
  const deck = getCardsState(state).deck ?? [];
  const n = Math.min(hand - have, deck.length);
  if (n > 0) drawCards(state, playerId, n);
}
function distinctTurns(card: ChainCard): number[] {
  if (card.role === 'wild') return [0];
  const seen = new Set<string>();
  const out: number[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const k = card.faces.map((d) => (d < 0 ? 'x' : (d + turn) % 4)).join('');
    if (!seen.has(k)) { seen.add(k); out.push(turn); }
  }
  return out;
}
function dist(a: string, b: string): number {
  const [ax, ay] = xy(a); const [bx, by] = xy(b);
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

type Lay = { type: 'lay'; card: string; at: string; turn: number };
type Swap = { type: 'swap'; a: string; b: string };
type Reroute = { type: 'reroute'; dir: string };

export const junctionChainMechanic: MechanicHooks = {
  slug: 'junction-chain',
  name: 'Junction Chain',
  requires: ['cards'],
  configSchema: {
    type: 'object',
    description: 'One shared counter on a table of junction cards: build the table, then race the counter to your secret King by the die faces printed on the card it stands on',
    properties: {
      size: { type: 'number', description: 'Table side (default 5)' },
      start: { type: 'string', description: 'The start space, "x,y" (default the centre)' },
      kings: { type: 'object', description: 'Destination spaces by suit, "x,y" each' },
      wrap: { type: 'boolean', description: 'An exit off the edge comes in on the far side' },
      rim: { type: 'boolean', description: 'A card may be laid anywhere on the outer ring' },
      cover: { type: 'boolean', description: 'In the race, a card may be laid on top of a junction' },
      hand: { type: 'number', description: 'Hand size, refilled after every turn (default 3)' },
      forecast: { type: 'number', description: 'Rolls ahead in the chance forecast players see (default 4)' },
    },
  },

  /** The table: the Kings at the edges, the start card in the centre, the counter on it. */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const c = cfg(ctx.config);
    if (!c) return null;
    const size = c.size ?? 5;
    const mid = Math.floor(size / 2);
    const start = c.start ?? key(mid, mid);
    const deck = ((ctx.config.engine_mechanics?.cards as { deck?: Array<Card & { exits?: string; role?: string }> } | undefined)?.deck ?? []);
    const startDef = deck.find((d) => d.name === (c.start_card ?? 'origin'));
    const tiles: Record<string, Tile> = {};
    tiles[start] = { card: startDef ? toChainCard(startDef as Card) : { name: 'start', role: 'wild', faces: parseExits('N1 E2 S1 W2') }, turn: 0, start: true };
    const kings = c.kings ?? { hearts: key(mid, 0), diamonds: key(size - 1, mid), clubs: key(mid, size - 1), spades: key(0, mid) };
    for (const [suit, at] of Object.entries(kings)) tiles[at] = { card: { name: `K${SUIT_GLYPH[suit] ?? ''} DESTINATION`, suit, role: 'destination', faces: [-1, -1, -1, -1, -1, -1] }, turn: 0, king: suit };
    const chain: ChainState = { size, tiles, counter: start, start, phase: 'build', rolls: 0 };
    return { chain, alwaysCheckWin: true } as unknown as SharedStateInitResult;
  },

  getActionSchema(action: GameAction): ActionSchema | null {
    switch (action.type as string) {
      case 'lay': return { required: ['card', 'at', 'turn'], fields: { card: { type: 'string' }, at: { type: 'string' }, turn: { type: 'number' } } };
      case 'swap': return { required: ['a', 'b'], fields: { a: { type: 'string' }, b: { type: 'string' } } };
      case 'reroute': return { required: ['dir'], fields: { dir: { type: 'string' } } };
      case 'throw_in': return { required: ['card'], fields: { card: { type: 'string' } } };
      case 'hold': case 'chaos': case 'roll': return { required: [], fields: {} };
      default: return null;
    }
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    const ch = chainOf(ctx.state);
    const c = cfg(ctx.config);
    if (!ch || !c) return null;
    const type = action.type as string;
    const hand = (ctx.player.hand ?? []) as Array<Card & { exits?: string; role?: string }>;
    const find = (name: string) => hand.find((h) => h.name === name);
    // (the engine's own card actions don't fit a turn here: a draw is a throw-in, a pass a hold)
    if (type === 'play_card' || type === 'place_card' || type === 'place_location' || type === 'move') return { valid: false, error: 'Not in this game: lay a card, swap, hold, throw a card in, roll, reroute or chaos.' };
    if (type === 'pass') return { valid: false, error: ch.phase === 'build' ? 'While the table is being built you must lay a card or throw one in.' : 'A race turn ends with the roll (or a Jack or a Joker), not a pass.' };
    if (type === 'draw') return { valid: false, error: 'Hands refill by themselves here; throw a card in instead.' };
    const step2 = ['roll', 'reroute', 'chaos'].includes(type);
    if (ch.phase === 'race' && !step2 && ch.laid && type !== 'throw_in') return { valid: false, error: 'You have laid this turn: now roll (or play a Jack or a Joker).' };
    if (ch.phase === 'race' && step2 && !ch.laid) return { valid: false, error: 'First lay a card, swap, or hold.' };
    if (type === 'roll') return ch.phase === 'race' ? { valid: true } : { valid: false, error: 'No rolling while the table is being built.' };
    if (type === 'lay') {
      const a = action as unknown as Lay;
      const card = find(a.card);
      if (!card) return { valid: false, error: `${a.card} is not in your hand` };
      const cc = toChainCard(card);
      if (!canLay(ch, c, a.at, cc)) return { valid: false, error: ch.phase === 'build' ? `${a.at} is not an empty space touching a laid card${c.rim !== false ? ' or on the rim' : ''}` : `${a.at} is not a junction you may cover` };
      if (!Number.isInteger(a.turn) || a.turn < 0 || a.turn > 3) return { valid: false, error: 'turn is 0, 1, 2 or 3 (quarter turns clockwise)' };
      return { valid: true };
    }
    if (type === 'throw_in') {
      if (ch.phase === 'race') return { valid: false, error: 'In the race, lay a card on a junction or hold.' };
      const card = find((action as unknown as { card: string }).card);
      return card ? { valid: true } : { valid: false, error: 'Not in your hand' };
    }
    if (ch.phase !== 'race') return ['swap', 'hold', 'reroute', 'chaos'].includes(type) ? { valid: false, error: 'Not until the table is built' } : null;
    if (type === 'hold') return { valid: true };
    if (type === 'swap') {
      const a = action as unknown as Swap;
      if (!hand.some((h) => h.role === 'swap')) return { valid: false, error: 'You need a Queen to swap' };
      const ta = ch.tiles[a.a]; const tb = ch.tiles[a.b];
      if (!ta || !tb || ta.king || tb.king || a.a === a.b) return { valid: false, error: 'Swap two different junctions (not Kings)' };
      return { valid: true };
    }
    if (type === 'reroute') {
      const a = action as unknown as Reroute;
      if (!hand.some((h) => h.role === 'reroute')) return { valid: false, error: 'You need a Jack to reroute' };
      const d = DIR_NAMES.indexOf(a.dir);
      const n = d >= 0 ? neighbour(ch, ch.counter, d, c.wrap !== false) : null;
      if (!n || !ch.tiles[n]) return { valid: false, error: `No card ${a.dir} of the counter` };
      return { valid: true };
    }
    if (type === 'chaos') {
      if (!hand.some((h) => h.role === 'chaos')) return { valid: false, error: 'You need a Joker' };
      return { valid: true };
    }
    return null;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const ch = chainOf(ctx.state);
    const c = cfg(ctx.config);
    if (!ch || !c) return null;
    const { state, player, playerId, action } = ctx;
    const type = action.type as string;
    const hand = (player.hand ?? []) as Array<Card & { exits?: string; role?: string }>;
    const take = (name: string): Card | undefined => { const i = hand.findIndex((h) => h.name === name); if (i < 0) return undefined; const [card] = hand.splice(i, 1); (getCardsState(state).discardPile ??= []).push(card); return card; };
    const takeRole = (role: string) => { const h = hand.find((x) => x.role === role); return h ? take(h.name) : undefined; };
    const log: string[] = [];
    const wrap = c.wrap !== false;
    /** step one of a race turn: the turn goes on to the roll */
    const laid = (message: string, extra: Record<string, unknown> = {}): ActionExecutionResult => {
      if (ch.phase === 'race') { ch.laid = true; return { handled: true, advanceTurn: false, checkWin: false, logMessage: message, logData: { ...extra, phase: ch.phase, counter: ch.counter, notes: log } }; }
      return { handled: true, advanceTurn: true, checkWin: true, logMessage: message, logData: { ...extra, phase: ch.phase, counter: ch.counter, notes: log } };
    };
    /** the end of a race turn: the counter has moved (or stayed); draw back up */
    const done = (message: string, extra: Record<string, unknown> = {}): ActionExecutionResult => {
      ch.laid = false;
      return { handled: true, advanceTurn: true, checkWin: true, logMessage: message, logData: { ...extra, phase: ch.phase, counter: ch.counter, notes: log } };
    };
    if (type === 'lay') {
      const a = action as unknown as Lay;
      const card = take(a.card)!;
      const was = ch.tiles[a.at];
      ch.tiles[a.at] = { card: toChainCard(card as Card), turn: a.turn, start: was?.start };
      log.push(`${playerId} ${was ? 'covered' : 'laid'} ${a.card} at ${a.at}, turned ${a.turn}`);
      if (ch.phase === 'build' && !hasEmpty(ch)) { ch.phase = 'race'; log.push('The table is built: the race begins.'); }
      return laid('laid', { card: a.card, at: a.at, turn: a.turn, covered: !!was });
    }
    if (type === 'throw_in') { const a = action as unknown as { card: string }; take(a.card); log.push(`${playerId} threw in ${a.card}`); return laid('threw_in', { card: a.card }); }
    if (type === 'swap') { const a = action as unknown as Swap; takeRole('swap'); const ta = ch.tiles[a.a]; const tb = ch.tiles[a.b]; ch.tiles[a.a] = { ...tb, start: ta.start }; ch.tiles[a.b] = { ...ta, start: tb.start }; log.push(`${playerId} swapped ${ta.card.name} (${a.a}) and ${tb.card.name} (${a.b})`); return laid('swapped', { a: a.a, b: a.b }); }
    if (type === 'hold') { log.push(`${playerId} lays nothing`); return laid('held'); }
    if (type === 'roll') { moveCounter(ch, state, wrap, 1 + Math.floor(Math.random() * 6), log); return done('rolled', { face: ch.lastRoll, to: ch.counter }); }
    if (type === 'reroute') { const a = action as unknown as Reroute; takeRole('reroute'); const n = neighbour(ch, ch.counter, DIR_NAMES.indexOf(a.dir), c.wrap !== false)!; log.push(`${playerId} played a Jack: the counter walks ${a.dir} to ${n}`); arrive(ch, state, n, log); ch.rolls++; ch.lastMove = log[log.length - 1]; return done('rerouted', { dir: a.dir, to: n }); }
    if (type === 'chaos') {
      takeRole('chaos');
      const t = ch.tiles[ch.counter];
      const ds = [...new Set(exitsOf(t).filter((d) => d >= 0))].map((d) => neighbour(ch, ch.counter, d, c.wrap !== false)).filter((n): n is string => !!n && !!ch.tiles[n]);
      if (ds.length) { const n = ds[Math.floor(Math.random() * ds.length)]; log.push(`${playerId} played a Joker: chaos takes the counter to ${n}`); arrive(ch, state, n, log); ch.rolls++; ch.lastMove = log[log.length - 1]; }
      else log.push(`${playerId} played a Joker: no exit leads anywhere; the counter stays`);
      return done('chaos', {});
    }
    return null;
  },

  /** Hands are refilled at the start of a turn, not the end of an action: an action that drew
   *  would hide what it did (the runner shows no consequence of a move that touched the deck). */
  onTurnStart(ctx: HookContext): StateChanges | null {
    const ch = chainOf(ctx.state);
    const c = cfg(ctx.config);
    if (!ch || !c) return null;
    ch.laid = false;
    refill(ctx.state, ctx.playerId, c.hand ?? 3);
    return null;
  },

  /** A draw during the build is a throw-in: discard back down to the hand size. */
  postExecuteAction(ctx: HookContext, action: GameAction): StateChanges | null {
    const ch = chainOf(ctx.state);
    const c = cfg(ctx.config);
    if (!ch || !c || (action.type as string) !== 'draw') return null;
    const hand = ctx.player.hand ?? [];
    const over = hand.length - (c.hand ?? 3);
    if (over > 0) { const thrown = hand.splice(Math.floor(Math.random() * hand.length), over); (getCardsState(ctx.state).discardPile ??= []).push(...thrown); }
    return null;
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const ch = chainOf(ctx.state);
    if (!ch || ctx.trigger === 'timeout') return null;
    const t = ch.tiles[ch.counter];
    const suit = mySuit(ctx);
    if (!t?.king || !suit || t.king !== suit) return null;
    return { won: true, reason: `the counter arrived at the King of ${suit}: ${ctx.playerId}'s King` };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const ch = chainOf(ctx.state);
    const c = cfg(ctx.config);
    if (!ch || !c) return [];
    const hand = (ctx.player.hand ?? []) as Array<Card & { exits?: string; role?: string }>;
    const out: AvailableAction[] = [];
    // lays: every legal space × card × distinct turn, the ones nearest the counter first
    const spaces: string[] = [];
    for (let y = 0; y < ch.size; y++) for (let x = 0; x < ch.size; x++) spaces.push(key(x, y));
    const lays: GameAction[] = [];
    const seenCards = new Set<string>();
    const cards = hand.filter((h) => { if (seenCards.has(h.name)) return false; seenCards.add(h.name); return true; });
    const ranked = [...spaces].sort((a, b) => dist(a, ch.counter) - dist(b, ch.counter));
    for (const k of ranked) for (const h of cards) { const cc = toChainCard(h); if (!canLay(ch, c, k, cc)) continue; for (const turn of distinctTurns(cc)) lays.push({ type: 'lay', card: h.name, at: k, turn } as unknown as GameAction); }
    if (lays.length) out.push({ action: lays[0], priority: 60, category: 'placement', description: ch.phase === 'build' ? 'Lay a card from your hand on an empty space (turn = quarter turns clockwise)' : 'Lay a card on top of a junction', required: { card: 'A card in your hand', at: 'A space "x,y"', turn: '0–3' }, examples: lays.slice(0, OFFER_MAX) });
    const throwIns = cards.filter((h) => !lays.some((l) => (l as unknown as Lay).card === h.name));
    if (ch.phase === 'build' && (!lays.length || throwIns.length)) out.push({ action: { type: 'throw_in', card: (throwIns[0] ?? cards[0])?.name } as unknown as GameAction, priority: 20, category: 'cards', description: 'Throw a card in and draw another', required: { card: 'A card in your hand' }, examples: (throwIns.length ? throwIns : cards).map((h) => ({ type: 'throw_in', card: h.name }) as unknown as GameAction) });
    if (ch.phase === 'race' && ch.laid) {
      const step2: AvailableAction[] = [{ action: { type: 'roll' } as unknown as GameAction, priority: 50, category: 'dice', description: 'Roll the d6: the counter follows that face on the card it stands on' }];
      if (hand.some((h) => h.role === 'reroute')) {
        const dirs = DIR_NAMES.filter((_, d) => { const n = neighbour(ch, ch.counter, d, c.wrap !== false); return n && ch.tiles[n]; });
        if (dirs.length) step2.push({ action: { type: 'reroute', dir: dirs[0] } as unknown as GameAction, priority: 45, category: 'cards', description: 'Play a Jack: instead of the roll, walk the counter one space your way', required: { dir: 'north, east, south or west' }, examples: dirs.map((dir) => ({ type: 'reroute', dir }) as unknown as GameAction) });
      }
      if (hand.some((h) => h.role === 'chaos')) step2.push({ action: { type: 'chaos' } as unknown as GameAction, priority: 30, category: 'cards', description: 'Play a Joker: instead of the roll, the counter takes one of its exits at random' });
      return step2;
    }
    if (ch.phase === 'race') {
      out.push({ action: { type: 'hold' } as unknown as GameAction, priority: 10, category: 'turn', description: 'Lay nothing this turn (then roll)' });
      if (hand.some((h) => h.role === 'swap')) {
        const near = Object.keys(ch.tiles).filter((k) => !ch.tiles[k].king).sort((a, b) => dist(a, ch.counter) - dist(b, ch.counter));
        const swaps: GameAction[] = [];
        for (let i = 0; i < near.length && swaps.length < 60; i++) for (let j = i + 1; j < near.length && swaps.length < 60; j++) if (dist(near[i], ch.counter) <= 1 || dist(near[j], ch.counter) <= 1) swaps.push({ type: 'swap', a: near[i], b: near[j] } as unknown as GameAction);
        if (swaps.length) out.push({ action: swaps[0], priority: 40, category: 'cards', description: 'Play a Queen: exchange two junctions on the table', required: { a: 'A junction "x,y"', b: 'Another' }, examples: swaps });
      }
    }
    return out;
  },

  /** The table, the counter, and the forecast: where the counter is likely to arrive over the
   *  next few rolls, by King. Your own King's figure is your progress line. */
  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const ch = chainOf(ctx.state);
    const c = cfg(ctx.config);
    if (!ch || !c) return null;
    const near = c.forecast ?? 4;
    const f = forecast(ch, ch.counter, c.wrap !== false, near);
    const g = forecast(ch, ch.counter, c.wrap !== false, near * 3);
    const suit = mySuit(ctx);
    const rest = (w: Record<string, number>) => SUITS.filter((s) => s !== suit).reduce((a, s) => a + (w[s] ?? 0), 0);
    // (progress, not objectiveProgress: hidden-objectives' view is merged after this one)
    const progress = suit ? [`your King ${SUIT_GLYPH[suit]}: ${pct5(f[suit] ?? 0)} within ${near} rolls, ${pct5(g[suit] ?? 0)} within ${near * 3}`, `the other Kings together: ${pct5(rest(f))} within ${near}, ${pct5(rest(g))} within ${near * 3}`] : [];
    const under = ch.tiles[ch.counter];
    return {
      phase: ch.phase === 'build' ? `building the table (${Object.values(ch.tiles).length - 1 - Object.keys(c.kings ?? {}).length || 0} laid; ${hasEmpty(ch) ? 'spaces still empty' : 'full'})` : `the race: ${ch.rolls} rolls so far`,
      counter: `${ch.counter}, on ${under ? tileLabel(ch.counter, under).replace(/^\S+ /, '') : '?'}`,
      yourKing: suit ? `${SUIT_GLYPH[suit]} at ${Object.entries(c.kings ?? {}).find(([s]) => s === suit)?.[1] ?? '?'} (secret)` : undefined,
      table: Object.entries(ch.tiles).sort(([a], [b]) => (xy(a)[1] - xy(b)[1]) || (xy(a)[0] - xy(b)[0])).map(([k, t]) => tileLabel(k, t)),
      lastMove: ch.lastMove,
      progress,
    };
  },

  describeAction(action: GameAction): ActionDescription | null {
    const t = action.type as string;
    const d: Record<string, [string, string, string]> = {
      lay: ['Lay', 'Lay a card on the table, turned 0–3 quarter turns clockwise', 'lay card:"7♥ SWITCH" at:"2,1" turn:1'],
      throw_in: ['Throw in', 'Discard a card and draw another', 'throw_in card:"Q♠ SWAP"'],
      swap: ['Swap', 'Play a Queen: exchange two junctions', 'swap a:"2,1" b:"3,3"'],
      hold: ['Hold', 'Lay nothing this turn; the die is rolled', 'hold'],
      reroute: ['Reroute', 'Play a Jack: walk the counter one space your way instead of rolling', 'reroute dir:"north"'],
      chaos: ['Chaos', 'Play a Joker: the counter takes a random exit instead of the roll', 'chaos'],
    };
    const e = d[t];
    return e ? { type: t, label: e[0], description: e[1], examples: [e[2]] } : null;
  },
};
