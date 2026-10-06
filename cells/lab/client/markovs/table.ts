/**
 * A table of Markovs Chains (v4.2, the court game): the deal, the turns, the actions, the bot.
 * Pure state in, state out (the state is mutated in place; `clone()` for undo). The page draws
 * it; both obey the same `legal()`.
 *
 * The court: each player is dealt a King (not necessarily their own) and, in turn, places it
 * on an empty rim square that is not the middle of an edge, not beside the counter and not
 * beside another King. With fewer than four players the undealt King stands one square
 * clockwise of its edge's middle. The player who places the last King takes the first turn.
 * A turn in the race: one landscape action — lay a card (on an empty square touching a laid
 * card or on the rim, an Ace anywhere, or on top of a junction), play a Queen (swap two
 * junctions), or hold — and one movement — roll the die, or instead a Jack (walk one step your
 * way) or a Joker (a random exit) — in either order. Draw back up; next player. First arrival
 * at your own King wins; thirty movement turns without one is a draw.
 */
import { seeded as rng } from '../kit/rng';
import { ACE, COMMISSION, DIRS, JACK, JOKER, KING, QUEEN, RULES, SIZE, START, canCrown, canPlace, cardName, chaosExits, destination, distance, forecast, isKing, key, kingAt, neighbour, neutralKingAt, pack, setup, shuffle, xy, type Board, type Card, type Rules, type Tile } from './deck';

export interface Player {
  name: string;
  /** the suit of the card dealt face down: their King */
  suit: number;
  /** the King dealt to them to place in the court (not necessarily their own); -1 once placed */
  king: number;
  hand: Card[];
  bot: boolean;
}
export interface Game {
  seed: number;
  rules: Rules;
  handSize: number;
  board: Board;
  token: string;
  pile: Card[];
  discard: Card[];
  players: Player[];
  /** whose turn (an index) */
  turn: number;
  phase: 'court' | 'race' | 'over';
  /** this turn: has the landscape action been taken (lay, swap, hold)? has the counter moved? */
  laid: boolean;
  moved: boolean;
  /** movement turns taken in the race (rolls, Jacks and Jokers alike) */
  rolls: number;
  /** the last die face (0: none yet) */
  die: number;
  winner: number;
  log: string[];
  /** the dice and the shuffles */
  random: () => number;
}
export const ROLL_CAP = 30;

/** Deal a table for these players: the four Twos shuffled face down, one each — its suit is the
 *  player's King, their secret — the undealt Twos back in the box; the four Kings shuffled and
 *  dealt one each, to place in the court (the undealt King, with fewer than four, stands as a
 *  neutral destination); the Ace of spades in the centre; the rest is the pile. */
export function newGame(seed: number, names: string[], bots: boolean[], rules: Rules = RULES, handSize = 3): Game {
  const random = rng(seed);
  const twos = shuffle(pack().filter((c) => c.rank === COMMISSION), random);
  const kings = shuffle([0, 1, 2, 3], random);
  const pile = shuffle(pack().filter((c) => c.rank !== KING && c.rank !== COMMISSION && !(c.rank === ACE && c.suit === 3)), random);
  const players: Player[] = names.map((name, i) => ({ name, suit: twos[i].suit, king: kings[i], hand: [], bot: bots[i] }));
  for (const p of players) p.hand = pile.splice(0, handSize);
  const board = setup('none');
  for (const suit of kings.slice(names.length)) board.set(neutralKingAt(suit), { card: { suit, rank: KING }, rotation: 0 });
  return { seed, rules, handSize, board, token: key(2, 2), pile, discard: [], players, turn: 0, phase: 'court', laid: false, moved: false, rolls: 0, die: 0, winner: -1, log: [], random };
}
export function clone(g: Game): Game {
  return { ...g, board: new Map(g.board), pile: [...g.pile], discard: [...g.discard], players: g.players.map((p) => ({ ...p, hand: [...p.hand] })), log: [...g.log] };
}
export const current = (g: Game) => g.players[g.turn];

export type Action =
  /** the court: place your dealt King */
  | { kind: 'crown'; k: string }
  | { kind: 'lay'; k: string; i: number; rotation: number }
  | { kind: 'swap'; a: string; b: string; i: number }
  | { kind: 'pass' }
  /** instead of laying: throw a card in (a hand of Jacks can't build) */
  | { kind: 'discard'; i: number }
  | { kind: 'roll'; face?: number }
  | { kind: 'jack'; i: number; dir: number }
  | { kind: 'joker'; i: number };

/** Everything the player to move may do now. */
export function legal(g: Game): Action[] {
  if (g.phase === 'over') return [];
  const p = current(g);
  const out: Action[] = [];
  if (g.phase === 'court') {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (canCrown(g.board, key(x, y), g.token)) out.push({ kind: 'crown', k: key(x, y) });
    return out;
  }
  if (!g.laid) {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const k = key(x, y);
      p.hand.forEach((c, i) => {
        if (!canPlace(g.board, k, c, g.rules, 'race', g.token)) return;
        for (let rotation = 0; rotation < 4; rotation++) out.push({ kind: 'lay', k, i, rotation });
      });
    }
    p.hand.forEach((_, i) => out.push({ kind: 'discard', i }));
    const qi = p.hand.findIndex((c) => c.rank === QUEEN);
    if (qi >= 0) {
      const ks = [...g.board.keys()].filter((k) => !isKing(g.board.get(k)));
      for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) out.push({ kind: 'swap', a: ks[a], b: ks[b], i: qi });
    }
    out.push({ kind: 'pass' });
  }
  if (!g.moved) {
    out.push({ kind: 'roll' });
    const ji = p.hand.findIndex((c) => c.rank === JACK);
    if (ji >= 0) for (let dir = 0; dir < 4; dir++) { const n = neighbour(g.token, dir, g.rules); if (n && g.board.has(n)) out.push({ kind: 'jack', i: ji, dir }); }
    const ki = p.hand.findIndex((c) => c.rank === JOKER);
    if (ki >= 0 && chaosExits(g.board, g.token, g.rules).length) out.push({ kind: 'joker', i: ki });
  }
  return out;
}

/** Do it. Returns what happened, in words, for the log. */
export function act(g: Game, a: Action): string {
  const p = current(g);
  const who = p.name;
  let said = '';
  const take = (i: number) => { const [c] = p.hand.splice(i, 1); g.discard.push(c); return c; };
  /** the landscape action is taken: the turn ends if the counter has moved too */
  const landscaped = () => { g.laid = true; if (g.moved) endTurn(g); };
  if (a.kind === 'crown') {
    const [x, y] = xy(a.k);
    g.board.set(a.k, { card: { suit: p.king, rank: KING }, rotation: 0 });
    said = `${who} placed the King of ${['hearts', 'diamonds', 'clubs', 'spades'][p.king]} at ${x + 1},${y + 1}`;
    p.king = -1;
    if (g.players.every((q) => q.king < 0)) { g.phase = 'race'; g.log.push('The court is placed. The race begins; the last to place a King takes the first turn.'); }
    else g.turn = (g.turn + 1) % g.players.length;
  } else if (a.kind === 'lay') {
    const c = p.hand[a.i];
    const was = g.board.get(a.k);
    if (was) g.discard.push(was.card);
    g.board.set(a.k, { card: c, rotation: a.rotation, start: was?.start });
    p.hand.splice(a.i, 1);
    const [x, y] = xy(a.k);
    said = `${who} ${was ? 'covered' : 'laid'} ${cardName(c)} at ${x + 1},${y + 1}`;
    landscaped();
  } else if (a.kind === 'swap') {
    const ta = g.board.get(a.a)!;
    const tb = g.board.get(a.b)!;
    g.board.set(a.a, { ...tb, start: ta.start });
    g.board.set(a.b, { ...ta, start: tb.start });
    take(a.i);
    said = `${who} swapped ${cardName(ta.card)} and ${cardName(tb.card)}`;
    landscaped();
  } else if (a.kind === 'pass') {
    said = `${who} held`;
    landscaped();
  } else if (a.kind === 'discard') {
    said = `${who} threw in ${cardName(take(a.i))}`;
    landscaped();
  } else if (a.kind === 'roll') {
    const face = a.face ?? 1 + Math.floor(g.random() * 6);
    g.die = face;
    const res = destination(g.board, g.token, face, g.rules);
    said = `${who} rolled ${face}: ${res.reason === 'move' ? `${['north', 'east', 'south', 'west'][res.dir]} to ${xy(res.at).map((v) => v + 1).join(',')}` : res.reason === 'loop' ? 'a loop, stays' : 'an open exit, stays'}`;
    arrive(g, res.at);
  } else if (a.kind === 'jack') {
    take(a.i);
    g.die = 0;
    const n = neighbour(g.token, a.dir, g.rules)!;
    said = `${who} played a Jack: ${['north', 'east', 'south', 'west'][a.dir]} to ${xy(n).map((v) => v + 1).join(',')}`;
    arrive(g, n);
  } else if (a.kind === 'joker') {
    take(a.i);
    g.die = 0;
    const ds = chaosExits(g.board, g.token, g.rules);
    const n = ds[Math.floor(g.random() * ds.length)];
    said = `${who} played a Joker: ${ds.length} exit${ds.length > 1 ? 's' : ''}, chaos takes it to ${xy(n).map((v) => v + 1).join(',')}`;
    arrive(g, n);
  }
  g.log.push(said);
  return said;
}
function arrive(g: Game, at: string) {
  g.token = at;
  g.rolls++;
  g.moved = true;
  const t = g.board.get(at);
  if (isKing(t)) {
    const who = g.players.findIndex((p) => p.suit === t!.card.suit);
    if (who >= 0) { g.phase = 'over'; g.winner = who; g.log.push(`${g.players[who].name} arrives at the King of ${['hearts', 'diamonds', 'clubs', 'spades'][t!.card.suit]}: the chain carried them through.`); return; }
    // (nobody's King: the wrong door — back to the start)
    g.token = START;
    g.log.push(`The King of ${['hearts', 'diamonds', 'clubs', 'spades'][t!.card.suit]} is nobody's: back to the start.`);
  }
  if (g.rolls >= ROLL_CAP) { g.phase = 'over'; g.winner = -1; g.log.push('Thirty moves, and nobody home: a draw.'); return; }
  if (g.laid) endTurn(g);
}
function endTurn(g: Game) {
  const p = current(g);
  while (g.pile.length && p.hand.length < g.handSize) p.hand.push(g.pile.shift()!);
  g.turn = (g.turn + 1) % g.players.length;
  g.laid = false;
  g.moved = false;
}

// ─── the bot: one action ahead, judged by a short forecast of its own King's chances ───────────
/** how good the table looks to player `me` (a suit), counter at `at`, among `players`: their own
 *  King's chances less the others', and a nudge for where the rest of the mass lies */
export function value(board: Board, at: string, rules: Rules, me: number, players = 4): number {
  const f = forecast(board, at, rules, 4, me, players);
  let v = f.wins[me];
  for (let s = 0; s < 4; s++) if (s !== me) v -= f.wins[s] / 3;
  const home = kingAt(board, me);
  if (home) for (const [k, m] of f.mass) v -= m * distance(k, home, rules) * 0.02;
  return v;
}
/** The bot's choice among what's legal (null: nothing to do). */
export function botAction(g: Game): Action | null {
  const p = current(g);
  const me = p.suit;
  const opts = legal(g);
  if (!opts.length) return null;
  let best: { a: Action; v: number } | null = null;
  const consider = (a: Action, v: number) => { if (!best || v > best.v + 1e-9) best = { a, v }; };
  if (g.phase === 'court') {
    // own King: as near the centre as the court allows (three steps); someone else's: a corner (four)
    for (const a of opts) if (a.kind === 'crown') { const d = distance(a.k, START, g.rules); consider(a, p.king === me ? -d : d); }
    return best!.a;
  }
  if (!g.laid) {
    for (const a of opts) {
      if (a.kind === 'lay') {
        const nb: Board = new Map(g.board);
        nb.set(a.k, { card: p.hand[a.i], rotation: a.rotation, start: g.board.get(a.k)?.start });
        consider(a, value(nb, g.token, g.rules, me, g.players.length) - (g.board.has(a.k) ? 0.01 : 0));
      } else if (a.kind === 'swap') {
        const nb: Board = new Map(g.board);
        const ta = g.board.get(a.a)!, tb = g.board.get(a.b)!;
        nb.set(a.a, { ...tb, start: ta.start }); nb.set(a.b, { ...ta, start: tb.start });
        consider(a, value(nb, g.token, g.rules, me, g.players.length) - 0.005);
      } else if (a.kind === 'pass') consider(a, value(g.board, g.token, g.rules, me, g.players.length) - 0.02);
      else if (a.kind === 'discard') consider(a, value(g.board, g.token, g.rules, me, g.players.length) - 0.03 - (p.hand[a.i].rank === JACK || p.hand[a.i].rank === QUEEN ? 0.05 : 0));
    }
    return best!.a;
  }
  // (landscape first, always: the bot moves once it has laid)
  // the roll, or a card instead of it: what each is worth on average
  let roll = 0;
  for (let f = 1; f <= 6; f++) roll += value(g.board, destination(g.board, g.token, f, g.rules).at, g.rules, me, g.players.length) / 6;
  consider({ kind: 'roll' }, roll);
  for (const a of opts) {
    if (a.kind === 'jack') consider(a, value(g.board, neighbour(g.token, a.dir, g.rules)!, g.rules, me, g.players.length) - 0.08);
    if (a.kind === 'joker') {
      const ds = chaosExits(g.board, g.token, g.rules);
      consider(a, ds.reduce((s, n) => s + value(g.board, n, g.rules, me, g.players.length), 0) / ds.length - 0.08);
    }
  }
  return best!.a;
}
export { DIRS, type Tile };
